"""视频生成工具：generate_video。"""
from __future__ import annotations

from ..media_service import MediaRequest, MediaService, get_default_media_service
from ..asset_references import resolve_asset_references
from ..prompt_engineering import optimize_generation_prompt
from .base import BaseTool, ToolContext, ToolParameter


def _resolve_service(ctx: ToolContext) -> MediaService:
    return ctx.media_service or get_default_media_service()


def _resolve_reference_urls(ctx: ToolContext, params: dict) -> list[str]:
    asset_ids = list(params.get("reference_asset_ids") or [])
    if not asset_ids:
        return list(params.get("reference_urls") or [])
    if not ctx.db or not ctx.project_id:
        raise ValueError("reference_asset_ids require a project-scoped database context")
    return [item["url"] for item in resolve_asset_references(ctx.db, ctx.project_id, asset_ids, media_kind="video")]


def _build_video_prompt(shot: dict, references: list[dict] | None = None) -> str:
    ref_names = ", ".join(
        str(item.get("name") or item.get("title") or item.get("asset_kind") or "").strip()
        for item in (references or [])
        if isinstance(item, dict) and (item.get("name") or item.get("title") or item.get("asset_kind"))
    )
    parts = [
        shot.get("action", ""),
        f"{shot.get('camera', 'medium shot')}, {shot.get('movement', 'static')}",
        f"scene: {shot.get('scene', '')}",
        "cinematic, 24fps, high detail",
    ]
    continuity = shot.get("continuity") or {}
    if isinstance(continuity, dict):
        continuity_bits = [
            continuity.get("scene"),
            continuity.get("characters"),
            continuity.get("props"),
            continuity.get("camera"),
        ]
        continuity_text = ", ".join(str(bit).strip() for bit in continuity_bits if bit)
        if continuity_text:
            parts.append(f"continuity: {continuity_text}")
    if shot.get("dialogue"):
        parts.append(f"character says: {shot['dialogue']}")
    if ref_names:
        parts.append(f"references: {ref_names}")
    return ", ".join(p for p in parts if p)


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
        ToolParameter(name="reference_asset_ids", type="array", description="project-scoped reference asset IDs", required=False),
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
        ref_ids = list(params.get("reference_asset_ids") or [])
        ref_payloads = [{"name": shot.get("scene") or "", "asset_kind": "scene"}]
        source_prompt = _build_video_prompt(shot, ref_payloads)
        prompt, source_prompt = await optimize_generation_prompt(ctx, source_prompt, "video", {
            "asset_kind": "shot_video",
            "shot": shot,
            "reference_asset_ids": ref_ids,
            "continuity": {
                "scene": shot.get("scene"),
                "characters": shot.get("characters") or shot.get("charactersInvolved") or [],
                "props": shot.get("props") or [],
                "camera": shot.get("camera"),
                "movement": shot.get("movement"),
            },
        })
        req = MediaRequest(
            kind="video",
            prompt=prompt,
            model_id=params.get("model_id"),
            duration_sec=float(shot.get("duration_sec", 5)),
            reference_urls=_resolve_reference_urls(ctx, params),
            extra={
                "asset_kind": "shot_video",
                "shot_index": shot.get("index"),
                "continuity": {
                    "scene": shot.get("scene"),
                    "characters": shot.get("characters") or shot.get("charactersInvolved") or [],
                    "props": shot.get("props") or [],
                    "camera": shot.get("camera"),
                    "movement": shot.get("movement"),
                },
            },
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
            "source_prompt": source_prompt,
            "continuity": req.extra.get("continuity"),
        }
