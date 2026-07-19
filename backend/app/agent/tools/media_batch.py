"""Concurrent image/video generation for independent media jobs."""
from __future__ import annotations

import asyncio
from typing import Any

from ..media_service import MediaRequest, MediaService, get_default_media_service
from .base import BaseTool, ToolContext, ToolParameter
from ..prompt_engineering import optimize_generation_prompt


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

        async def run(index: int, job: dict) -> dict:
            source_prompt = str(job["prompt"])
            prompt = source_prompt
            try:
                prompt, source_prompt = await optimize_generation_prompt(
                    ctx,
                    source_prompt,
                    job["kind"],
                    {
                        "asset_kind": job.get("asset_kind") or job["kind"],
                        "name": job.get("name"),
                        "reference_urls": list(job.get("reference_urls") or []),
                    },
                )
                request = MediaRequest(
                    kind=job["kind"],
                    prompt=prompt,
                    model_id=job.get("model_id"),
                    duration_sec=float(job.get("duration_sec", 5)),
                    reference_urls=list(job.get("reference_urls") or []),
                    extra={"asset_kind": job.get("asset_kind"), "name": job.get("name")},
                )
                result = await service.generate(request)
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
                    "error": str(exc),
                }

        results = await asyncio.gather(*(run(index, job) for index, job in enumerate(jobs)))
        return {"results": results, "succeeded": sum(1 for item in results if item["success"]), "failed": sum(1 for item in results if not item["success"])}
