"""视频生成工具：generate_video。"""
from __future__ import annotations

from ..media_service import MediaRequest, MediaService, get_default_media_service
from .base import BaseTool, ToolContext, ToolParameter


def _resolve_service(ctx: ToolContext) -> MediaService:
    return ctx.media_service or get_default_media_service()


class GenerateVideoTool(BaseTool):
    """基于分镜生成视频片段。"""

    name = "generate_video"
    description = "基于分镜 dict 生成视频片段。首帧可用 reference_urls 提供（角色/场景参考图）。"
    category = "video"
    requires_approval = True
    estimated_cost_usd = 0.5
    estimated_time_sec = 60.0
    idempotent = False
    parameters = [
        ToolParameter(name="shot", type="object", description="分镜 dict（含 scene/action/duration_sec/dialogue 等）", required=True),
        ToolParameter(name="reference_urls", type="array", description="可选：参考图 URL 列表（角色/场景首帧）", required=False),
        ToolParameter(name="model_id", type="string", description="可选：指定视频模型 id", required=False),
    ]

    async def validate(self, ctx: ToolContext, params: dict) -> str | None:
        if not isinstance(params.get("shot"), dict):
            return "shot 必须是 dict"
        return None

    async def execute(self, ctx: ToolContext, params: dict) -> dict:
        svc = _resolve_service(ctx)
        shot = params["shot"]
        parts = [
            shot.get("action", ""),
            f"{shot.get('camera', 'medium shot')}, {shot.get('movement', 'static')}",
            f"scene: {shot.get('scene', '')}",
            "cinematic, 24fps, high detail",
        ]
        if shot.get("dialogue"):
            parts.append(f"character says: {shot['dialogue']}")
        prompt = ", ".join(p for p in parts if p)
        req = MediaRequest(
            kind="video",
            prompt=prompt,
            model_id=params.get("model_id"),
            duration_sec=float(shot.get("duration_sec", 5)),
            reference_urls=list(params.get("reference_urls") or []),
            extra={"asset_kind": "shot_video", "shot_index": shot.get("index")},
        )
        result = await svc.generate(req)
        return {
            "url": result.url,
            "shot_index": shot.get("index"),
            "duration_sec": req.duration_sec,
            "kind": "shot_video",
            "cost_usd": result.cost_usd,
            "elapsed_sec": result.elapsed_sec,
            "prompt": prompt,
        }
