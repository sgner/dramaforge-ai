"""媒体生成统一路由 — 画布生成的图片/视频/音频都由后端代理。

前端不再直接调供应商，统一 POST 到这里：
  POST /api/generate/image  { provider_id, model, prompt, ref_urls, aspect_ratio, signal }
  POST /api/generate/video  { provider_id, model, prompt, ref_urls, aspect_ratio, duration_sec, signal }

后端从 DB 读 MediaProviderConfig，用明文 api_key 调供应商，返回生成的 url。
"""
from __future__ import annotations

import asyncio
import json
import logging
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


def _headers(provider: dict) -> dict[str, str]:
    h = {"Content-Type": "application/json"}
    if provider.get("api_key"):
        if provider.get("protocol") == "gemini":
            return h
        h["Authorization"] = f"Bearer {provider['api_key']}"
    return h


# OpenAI 兼容图片生成（很多供应商走这个协议：dall-e / kling-image / qwen-image / cogview 等）
async def _openai_image(provider: dict, body: ImageGenerateIn) -> GenerateOut:
    base = _strip_v1_suffix(provider["base_url"])
    url = f"{base}/v1/images/generations"
    payload = {
        "model": body.model,
        "prompt": body.prompt,
        "n": 1,
    }
    if body.aspect_ratio and body.aspect_ratio != "1:1":
        payload["size"] = _aspect_to_size(body.aspect_ratio)
    if body.ref_urls:
        # OpenAI edits 模式：略简化为把 ref urls 注入 prompt 描述
        ref_desc = " ".join(body.ref_urls)
        payload["prompt"] = f"{body.prompt} (refs: {ref_desc})"
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(120.0)) as cx:
            r = await cx.post(url, headers=_headers(provider), json=payload)
    except httpx.HTTPError as e:
        raise HTTPException(
            status_code=502,
            detail=f"image provider '{provider['provider_id']}' model '{body.model}' network error: {e}",
        )
    if r.status_code >= 400:
        raise HTTPException(
            status_code=502,
            detail=f"image provider '{provider['provider_id']}' model '{body.model}' HTTP {r.status_code} at {url}: {r.text[:300]}",
        )
    try:
        data = r.json()
    except ValueError as e:
        raise HTTPException(status_code=502, detail=f"image API returned invalid JSON: {e}")
    url_out = (
        (data.get("data") or [{}])[0].get("url")
        or (data.get("data") or [{}])[0].get("b64_json")
        or data.get("url")
    )
    if not url_out:
        raise HTTPException(status_code=502, detail=f"image API returned no url: {data}")
    return GenerateOut(url=url_out, provider_id=provider["provider_id"], model=body.model, raw=data)


# OpenAI 兼容视频生成（placeholder：很多供应商还没标准 /videos/generations，先用 /chat/completions 走通链路）
async def _openai_video(provider: dict, body: VideoGenerateIn) -> GenerateOut:
    base = _strip_v1_suffix(provider["base_url"])
    url = f"{base}/v1/videos/generations"
    payload = {
        "model": body.model,
        "prompt": body.prompt,
        "duration": body.duration_sec,
        "aspect_ratio": body.aspect_ratio,
    }
    async with httpx.AsyncClient(timeout=httpx.Timeout(300.0)) as cx:
        try:
            r = await cx.post(url, headers=_headers(provider), json=payload)
        except httpx.HTTPError as e:
            raise HTTPException(status_code=502, detail=f"video API network error: {e}")
    if r.status_code == 404:
        raise HTTPException(
            status_code=502,
            detail=f"video provider '{provider['provider_id']}' model '{body.model}' endpoint not found: {url}",
        )
    if r.status_code >= 400:
        raise HTTPException(
            status_code=502,
            detail=f"video provider '{provider['provider_id']}' model '{body.model}' HTTP {r.status_code} at {url}: {r.text[:300]}",
        )
    try:
        data = r.json()
    except ValueError as e:
        raise HTTPException(status_code=502, detail=f"video API returned invalid JSON: {e}")
    url_out = (
        (data.get("data") or {}).get("url")
        or data.get("url")
        or data.get("video_url")
    )
    if not url_out:
        raise HTTPException(status_code=502, detail=f"video API returned no url: {data}")
    return GenerateOut(url=url_out, provider_id=provider["provider_id"], model=body.model, raw=data)


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
