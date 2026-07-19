"""媒体生成统一路由 — 画布生成的图片/视频/音频都由后端代理。

前端不再直接调供应商，统一 POST 到这里：
  POST /api/generate/image  { provider_id, model, prompt, ref_urls, aspect_ratio, signal }
  POST /api/generate/video  { provider_id, model, prompt, ref_urls, aspect_ratio, duration_sec, signal }

后端从 DB 读 MediaProviderConfig，用明文 api_key 调供应商，返回生成的 url。
"""
from __future__ import annotations

import asyncio
import base64
import json
import logging
import mimetypes
import time
from pathlib import Path
from typing import Any, List, Optional

import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import ProviderConfig


router = APIRouter()
logger = logging.getLogger("dramaforge.media")


# ============ Schemas ============

class ImageGenerateIn(BaseModel):
    provider_id: str
    model: str
    prompt: str
    ref_urls: List[str] = Field(default_factory=list)
    aspect_ratio: str = "1:1"
    extra: dict = Field(default_factory=dict)


class VideoGenerateIn(BaseModel):
    provider_id: str
    model: str
    prompt: str
    ref_urls: List[str] = Field(default_factory=list)
    aspect_ratio: str = "16:9"
    duration_sec: int = 5
    extra: dict = Field(default_factory=dict)


class GenerateOut(BaseModel):
    url: str
    provider_id: str
    model: str
    raw: dict = Field(default_factory=dict)
    # 上游无端点时返回的 dev fallback 占位结果显式标记，
    # 调用方（agent / 前端）不得把它当作真实交付物。
    dev_fallback: bool = False


# ============ Helpers ============

def _load_provider(db: Session, provider_id: str) -> dict:
    """读 provider 明文配置（统一表 provider_configs）；找不到抛 404。"""
    row = db.query(ProviderConfig).filter_by(provider_id=provider_id).first()
    if not row:
        raise HTTPException(status_code=404, detail=f"provider '{provider_id}' not found in DB")
    if not row.enabled:
        raise HTTPException(status_code=400, detail=f"provider '{provider_id}' is disabled")
    return row.to_internal_dict()


def _strip_v1_suffix(url: str) -> str:
    s = (url or "").rstrip("/")
    if s.endswith("/v1"):
        s = s[: -len("/v1")]
    return s


_UPLOAD_DIR = Path(__file__).resolve().parent.parent / "uploads"


def _resolve_ref_model(provider: dict, model: str, has_refs: bool, kind: str) -> str:
    """按有无参考图选择 t2x/i2x 变体模型。

    线上事故：image 绑定的是 i2i 变体（seedream-v5-pro-i2i），纯文生图任务
    （角色概念图，无参考图）被上游 400 "image-to-image requires at least one
    input image"。反之，有参考图但绑了 t2i 变体时参考图不会生效。
    只在同族变体存在于 provider 模型列表时切换，否则保持原样。
    """
    t2x, i2x = ("-t2i", "-i2i") if kind == "image" else ("-t2v", "-i2v")
    models = provider.get(f"{kind}_models") or []
    if has_refs and model.endswith(t2x):
        cand = model[: -len(t2x)] + i2x
        if cand in models:
            return cand
    if not has_refs and model.endswith(i2x):
        cand = model[: -len(i2x)] + t2x
        if cand in models:
            return cand
    return model


def _ref_to_image_value(ref: str) -> Optional[str]:
    """把单个参考图引用转成上游可消费的 image 值。

    - /files/<name>（或裸文件名）→ 读 uploads 目录转 base64 data URI；
      上游供应商无法访问 localhost URL，必须内联图片内容。
    - http(s) / data: → 原样传递。
    - 解析失败（文件不存在/目录穿越）→ None，调用方跳过。
    """
    ref = (ref or "").strip()
    if not ref:
        return None
    if ref.startswith(("http://", "https://", "data:")):
        return ref
    name = ref.split("?")[0]
    if name.startswith("/files/"):
        name = name[len("/files/"):]
    try:
        path = (_UPLOAD_DIR / name).resolve()
        if not path.is_relative_to(_UPLOAD_DIR.resolve()) or not path.is_file():
            return None
        mime = mimetypes.guess_type(path.name)[0] or "image/png"
        b64 = base64.b64encode(path.read_bytes()).decode("ascii")
        return f"data:{mime};base64,{b64}"
    except OSError:
        return None


def _headers(provider: dict) -> dict[str, str]:
    h = {"Content-Type": "application/json"}
    if provider.get("api_key"):
        if provider.get("protocol") == "gemini":
            return h
        h["Authorization"] = f"Bearer {provider['api_key']}"
    return h


def _dig(data: Any, path: str):
    """按点分路径从嵌套 dict 取值（自定义响应字段映射用）。"""
    cur: Any = data
    for part in str(path or "").split("."):
        if not isinstance(cur, dict):
            return None
        cur = cur.get(part)
    return cur


def _media_overrides(provider: dict, kind: str) -> dict:
    """读取 provider.extra_config[kind] 的自定义覆盖（非 OpenAI 兼容供应商用）。

    支持字段（全部可选）：
    - endpoint: 提交路径覆盖，如 "/v1/image/generations"
    - payload_extra: 合并进提交 payload 的字段，如 {"metadata": {"resolution": "2k"}}
    - ref_field: 参考图字段名覆盖（默认 "image"，图生图/图生视频时参考图以字符串/逗号拼接传入）
    - async_task: true → 提交返回任务 id，轮询取结果（seedance 等任务式 API）
    - poll_endpoint: 轮询路径模板（{task_id} 占位，默认 "{endpoint}/{task_id}"）
    - task_id_field / status_field / result_url_field: 点分字段路径
      （默认 "task_id" / "data.status" / "data.result_url"）
    - success_values / fail_values: 终态值列表（大小写不敏感）
    - poll_interval_sec / timeout_sec: 轮询节奏（默认 3s / 300s）
    - result_url_field 对同步响应同样生效（自定义 URL 提取路径）
    """
    extra = provider.get("extra_config") or {}
    section = extra.get(kind) if isinstance(extra, dict) else None
    return section if isinstance(section, dict) else {}


async def _poll_async_task(
    cx: httpx.AsyncClient,
    provider: dict,
    base: str,
    endpoint: str,
    ov: dict,
    submit_data: dict,
    kind: str,
    model: str,
) -> tuple[str, dict]:
    """任务式 API 轮询：提交返回 task_id，轮询到终态后提取结果 URL。"""
    task_id = _dig(submit_data, ov.get("task_id_field", "task_id")) or _dig(submit_data, "id")
    if not task_id:
        raise HTTPException(
            status_code=502,
            detail=f"{kind} provider '{provider['provider_id']}' async submit returned no task id: {submit_data}",
        )
    poll_tpl = ov.get("poll_endpoint") or f"{endpoint}/{{task_id}}"
    poll_url = f"{base}{poll_tpl.format(task_id=task_id)}"
    status_field = ov.get("status_field", "data.status")
    result_field = ov.get("result_url_field", "data.result_url")
    success = {str(v).upper() for v in (ov.get("success_values") or ["SUCCESS"])}
    failed = {str(v).upper() for v in (ov.get("fail_values") or ["FAIL", "FAILED", "ERROR", "CANCELLED"])}
    interval = float(ov.get("poll_interval_sec", 3))
    timeout = float(ov.get("timeout_sec", 300))
    deadline = time.monotonic() + timeout
    while True:
        if time.monotonic() >= deadline:
            raise HTTPException(
                status_code=504,
                detail=f"{kind} provider '{provider['provider_id']}' model '{model}' "
                       f"task polling timed out after {timeout:.0f}s",
            )
        await asyncio.sleep(interval)
        try:
            pr = await cx.get(poll_url, headers=_headers(provider))
            data = pr.json()
        except (httpx.HTTPError, ValueError):
            continue  # 轮询瞬时失败不是终态，继续等
        status = str(_dig(data, status_field) or "").upper()
        if status in success:
            url_out = (
                _dig(data, result_field)
                or _dig(data, "data.data.content.image_url")
                or _dig(data, "data.url")
            )
            if not url_out:
                raise HTTPException(
                    status_code=502,
                    detail=f"{kind} task succeeded but no result url: {data}",
                )
            return url_out, data
        if status in failed:
            reason = _dig(data, "data.fail_reason") or _dig(data, "fail_reason") or status
            raise HTTPException(status_code=502, detail=f"{kind} task failed: {reason}")


# OpenAI 兼容图片生成（很多供应商走这个协议：dall-e / kling-image / qwen-image / cogview 等）
# 非兼容供应商用 extra_config.image 覆盖端点/payload/异步任务轮询（见 _media_overrides）。
async def _openai_image(provider: dict, body: ImageGenerateIn) -> GenerateOut:
    base = _strip_v1_suffix(provider["base_url"])
    ov = _media_overrides(provider, "image")
    endpoint = ov.get("endpoint") or "/v1/images/generations"
    url = f"{base}{endpoint}"
    model = _resolve_ref_model(provider, body.model, bool(body.ref_urls), "image")
    payload = {
        "model": model,
        "prompt": body.prompt,
        "n": 1,
    }
    if body.aspect_ratio and body.aspect_ratio != "1:1":
        payload["size"] = _aspect_to_size(body.aspect_ratio)
    if body.ref_urls:
        # 图生图：参考图真正放进 image 字段传给供应商，而不是把 URL 文本糊进 prompt
        # （相对 /files/ 路径对上游毫无意义）。网关 image 字段为字符串，多图逗号拼接
        # （实测该网关数组会被 400 拒绝）。字段名可用 extra_config.image.ref_field 覆盖。
        images = [v for v in (_ref_to_image_value(u) for u in body.ref_urls) if v]
        if images:
            payload[ov.get("ref_field") or "image"] = ",".join(images)
        else:
            logger.warning(
                "image provider '%s': ref_urls 全部无法解析，按纯文生图提交: %s",
                provider["provider_id"], body.ref_urls,
            )
    extra_payload = ov.get("payload_extra")
    if isinstance(extra_payload, dict):
        payload.update(extra_payload)
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(120.0)) as cx:
            r = await cx.post(url, headers=_headers(provider), json=payload)
            if r.status_code >= 400:
                raise HTTPException(
                    status_code=502,
                    detail=f"image provider '{provider['provider_id']}' model '{model}' HTTP {r.status_code} at {url}: {r.text[:300]}",
                )
            try:
                data = r.json()
            except ValueError as e:
                raise HTTPException(status_code=502, detail=f"image API returned invalid JSON: {e}")
            if ov.get("async_task"):
                url_out, raw = await _poll_async_task(
                    cx, provider, base, endpoint, ov, data, "image", model,
                )
                return GenerateOut(url=url_out, provider_id=provider["provider_id"], model=model, raw=raw)
    except httpx.HTTPError as e:
        raise HTTPException(
            status_code=502,
            detail=f"image provider '{provider['provider_id']}' model '{model}' network error: {e}",
        )
    custom_field = ov.get("result_url_field")
    url_out = (
        (_dig(data, custom_field) if custom_field else None)
        or (data.get("data") or [{}])[0].get("url")
        or (data.get("data") or [{}])[0].get("b64_json")
        or data.get("url")
    )
    if not url_out:
        raise HTTPException(status_code=502, detail=f"image API returned no url: {data}")
    return GenerateOut(url=url_out, provider_id=provider["provider_id"], model=model, raw=data)


# OpenAI 兼容视频生成（placeholder：很多供应商还没标准 /videos/generations，先用 /chat/completions 走通链路）
async def _openai_video(provider: dict, body: VideoGenerateIn) -> GenerateOut:
    base = _strip_v1_suffix(provider["base_url"])
    ov = _media_overrides(provider, "video")
    endpoint = ov.get("endpoint") or "/v1/videos/generations"
    url = f"{base}{endpoint}"
    model = _resolve_ref_model(provider, body.model, bool(body.ref_urls), "video")
    payload = {
        "model": model,
        "prompt": body.prompt,
        "duration": body.duration_sec,
        "aspect_ratio": body.aspect_ratio,
    }
    if body.ref_urls:
        # 图生视频（i2v）：与图生图同一契约 —— image 字段为字符串，多图逗号拼接
        # （实测该网关数组会被 400 拒绝）。本地 /files/ 转 base64 data URI。
        images = [v for v in (_ref_to_image_value(u) for u in body.ref_urls) if v]
        if images:
            payload[ov.get("ref_field") or "image"] = ",".join(images)
        else:
            logger.warning(
                "video provider '%s': ref_urls 全部无法解析，按纯文生视频提交: %s",
                provider["provider_id"], body.ref_urls,
            )
    extra_payload = ov.get("payload_extra")
    if isinstance(extra_payload, dict):
        payload.update(extra_payload)
    async with httpx.AsyncClient(timeout=httpx.Timeout(300.0)) as cx:
        try:
            r = await cx.post(url, headers=_headers(provider), json=payload)
        except httpx.HTTPError as e:
            raise HTTPException(status_code=502, detail=f"video API network error: {e}")
        if r.status_code == 404:
            # 上游供应商还没实现 /v1/videos/generations（绝大多数 dev 阶段供应商都这样）。
            # 返回 dev fallback URL 让前端能继续播放/预览，不阻塞工作流。
            # 关键：必须显式标记 dev_fallback=True（顶层字段 + raw），调用方
            # （agent finish_media_asset）会把对应资产标为 warning/failed 而不是 ready，
            # 避免"假成功"资产通过 finish_task 的交付物校验。
            logger.warning(
                "video provider '%s' model '%s' endpoint not found (%s); using dev fallback",
                provider["provider_id"], model, url,
            )
            return GenerateOut(
                url="/files/dev-fallback.mp4",
                provider_id=provider["provider_id"],
                model=model,
                raw={"fallback": True, "dev_fallback": True, "reason": "upstream_404", "endpoint": url},
                dev_fallback=True,
            )
        if r.status_code >= 400:
            raise HTTPException(
                status_code=502,
                detail=f"video provider '{provider['provider_id']}' model '{model}' HTTP {r.status_code} at {url}: {r.text[:300]}",
            )
        try:
            data = r.json()
        except ValueError as e:
            raise HTTPException(status_code=502, detail=f"video API returned invalid JSON: {e}")
        if ov.get("async_task"):
            url_out, raw = await _poll_async_task(
                cx, provider, base, endpoint, ov, data, "video", model,
            )
            return GenerateOut(url=url_out, provider_id=provider["provider_id"], model=model, raw=raw)
    custom_field = ov.get("result_url_field")
    url_out = (
        (_dig(data, custom_field) if custom_field else None)
        or (data.get("data") or {}).get("url")
        or data.get("url")
        or data.get("video_url")
    )
    if not url_out:
        raise HTTPException(status_code=502, detail=f"video API returned no url: {data}")
    return GenerateOut(url=url_out, provider_id=provider["provider_id"], model=model, raw=data)


def _aspect_to_size(ar: str) -> str:
    return {
        "1:1": "1024x1024",
        "16:9": "1280x720",
        "9:16": "720x1280",
        "4:3": "1024x768",
        "3:4": "768x1024",
    }.get(ar, "1024x1024")


# ============ Routes ============

@router.post("/generate/image", response_model=GenerateOut)
async def generate_image(body: ImageGenerateIn, db: Session = Depends(get_db)):
    provider = _load_provider(db, body.provider_id)
    if provider.get("protocol") == "gemini":
        raise HTTPException(status_code=501, detail="gemini image gen not yet implemented on backend")
    return await _openai_image(provider, body)


@router.post("/generate/video", response_model=GenerateOut)
async def generate_video(body: VideoGenerateIn, db: Session = Depends(get_db)):
    provider = _load_provider(db, body.provider_id)
    if provider.get("protocol") == "gemini":
        raise HTTPException(status_code=501, detail="gemini video gen not yet implemented on backend")
    return await _openai_video(provider, body)
