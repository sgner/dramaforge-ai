"""Concurrent image/video generation for independent media jobs."""
from __future__ import annotations

import asyncio
from typing import Any

from ..media_service import MediaRequest, MediaService, get_default_media_service
from .base import BaseTool, ToolContext, ToolParameter
from .image_tools import CHARACTER_DESIGN_SHEET_PROMPT, PROP_FOUR_VIEW_LAYOUT, STORYBOARD_SIX_GRID_PROMPT
from .llm_tools import _cap_prompt_length
from ..asset_references import generate_with_reference_check, resolve_asset_references
from ..prompt_engineering import optimize_generation_prompt, resolve_reference_ids_by_text


# canonical 资产的布局硬约束：agent 走 generate_media_batch 时 job prompt 是 LLM
# 自由发挥的，经常丢掉设计表结构（线上实锤：批量角色图没有 4 区域布局、道具
# 没有四视图）。这些 asset_kind 不再二次改写，确定性拼接布局段。
_CANONICAL_LAYOUT_BY_KIND = {
    "character": CHARACTER_DESIGN_SHEET_PROMPT,
    "storyboard": STORYBOARD_SIX_GRID_PROMPT,
    "prop": PROP_FOUR_VIEW_LAYOUT,
    "scene": (
        "environment-only scene reference image, no people, no characters, "
        "no foreground subjects, realistic style, cinematic quality, 8K ultra detail"
    ),
}


class GenerateMediaBatchTool(BaseTool):
    name = "generate_media_batch"
    description = "并行生成多个独立的图片或视频资产；单个任务失败不会取消其他任务。"
    # Listed with image tools to keep the existing six frontend categories stable.
    category = "image"
    requires_approval = True
    estimated_cost_usd = 0.5
    estimated_time_sec = 60.0
    idempotent = True
    parameters = [
        ToolParameter(
            name="jobs",
            type="array",
            description="媒体任务列表，每项包含 kind(image/video)、prompt，可选 name、asset_kind、duration_sec、reference_urls、model_id",
            required=True,
        ),
    ]

    async def validate(self, ctx: ToolContext, params: dict) -> str | None:
        jobs = params.get("jobs")
        if not isinstance(jobs, list) or not jobs:
            return "jobs 必须是非空数组"
        for index, job in enumerate(jobs):
            if not isinstance(job, dict):
                return f"jobs[{index}] 必须是对象"
            if job.get("kind") not in {"image", "video"}:
                return f"jobs[{index}].kind 必须是 image 或 video"
            if not str(job.get("prompt") or "").strip():
                return f"jobs[{index}].prompt 不能为空"
        return None

    async def execute(self, ctx: ToolContext, params: dict) -> dict:
        service: MediaService = ctx.media_service or get_default_media_service()
        jobs = list(params["jobs"])

        # 从画布连线收集 asset_ref，应用到每个 job（与单个生成工具一致：
        # 用户在画布上连到生成节点的资产即视为参考资产）。
        canvas_refs: list[str] = []
        if ctx.db and ctx.project_id:
            from .asset_registry_helpers import collect_canvas_references
            canvas_refs = collect_canvas_references(ctx.db, ctx.project_id)

        async def run(index: int, job: dict) -> dict:
            source_prompt = str(job["prompt"])
            prompt = source_prompt
            asset_kind = job.get("asset_kind") or job["kind"]
            canonical = _CANONICAL_LAYOUT_BY_KIND.get(asset_kind)
            # 分镜：按文本出现解析角色/场景/道具参考资产（角色卡名出现在
            # job name/prompt 中即引用），否则批量分镜没有任何参考图。
            ref_ids: list[str] = list(canvas_refs)
            ref_urls = list(job.get("reference_urls") or [])
            if asset_kind == "storyboard":
                for ref_id in resolve_reference_ids_by_text(
                    getattr(ctx, "artifacts", None),
                    f"{job.get('name') or ''}\n{source_prompt}",
                ):
                    if ref_id not in ref_ids:
                        ref_ids.append(ref_id)
            if ref_ids and ctx.db and ctx.project_id:
                items = resolve_asset_references(ctx.db, ctx.project_id, ref_ids, media_kind=job["kind"])
                url_by_id = {
                    item["asset_id"]: item["url"]
                    for item in items
                }
                resolved_urls = [url_by_id[i] for i in ref_ids if i in url_by_id]
                resolved_urls += [
                    item["fallback_url"] for item in items
                    if item.get("fallback_url") and item["fallback_url"] not in resolved_urls
                ]
                ref_urls = resolved_urls + ref_urls
            try:
                if canonical:
                    # canonical 资产：agent 的 job prompt 已是 LLM 写好的描述，
                    # 不再二次改写（改写会丢布局段），确定性拼接布局 + 长度兜底
                    if canonical not in prompt:
                        prompt = f"{prompt}\n\n{canonical}"
                    prompt = _cap_prompt_length(prompt)
                else:
                    prompt, source_prompt = await optimize_generation_prompt(
                        ctx,
                        source_prompt,
                        job["kind"],
                        {
                            "asset_kind": asset_kind,
                            "name": job.get("name"),
                            "reference_urls": list(job.get("reference_urls") or []),
                        },
                    )
                request = MediaRequest(
                    kind=job["kind"],
                    prompt=prompt,
                    model_id=job.get("model_id"),
                    duration_sec=float(job.get("duration_sec", 5)),
                    reference_urls=ref_urls,
                    extra={"asset_kind": job.get("asset_kind"), "name": job.get("name")},
                )
                result = await generate_with_reference_check(ctx, service, request)
                dev_fallback = bool((result.raw or {}).get("dev_fallback"))
                return {
                    "job_index": index,
                    # dev fallback（上游无端点的占位 URL）不算真实成功交付
                    "success": not dev_fallback,
                    "dev_fallback": dev_fallback,
                    "kind": job["kind"],
                    "name": job.get("name") or "",
                    "asset_kind": job.get("asset_kind") or ("video" if job["kind"] == "video" else "image"),
                    "url": result.url,
                    "prompt": prompt,
                    "source_prompt": source_prompt,
                    "reference_asset_ids": ref_ids,
                    "reference_urls": ref_urls,
                    "cost_usd": result.cost_usd,
                    "elapsed_sec": result.elapsed_sec,
                }
            except Exception as exc:
                return {
                    "job_index": index,
                    "success": False,
                    "kind": job["kind"],
                    "name": job.get("name") or "",
                    "asset_kind": job.get("asset_kind") or ("video" if job["kind"] == "video" else "image"),
                    "prompt": prompt,
                    "source_prompt": source_prompt,
                    "reference_asset_ids": ref_ids,
                    "error": str(exc),
                }

        results = await asyncio.gather(*(run(index, job) for index, job in enumerate(jobs)))
        return {"results": results, "succeeded": sum(1 for item in results if item["success"]), "failed": sum(1 for item in results if not item["success"])}
