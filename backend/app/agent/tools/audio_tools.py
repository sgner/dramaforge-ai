"""音频生成工具：generate_voiceover / generate_bgm。"""
from __future__ import annotations

from ..media_service import MediaRequest, MediaService, get_default_media_service
from .base import BaseTool, ToolContext, ToolParameter


def _resolve_service(ctx: ToolContext) -> MediaService:
    return ctx.media_service or get_default_media_service()


class GenerateVoiceoverTool(BaseTool):
    """文本转语音（旁白 / 角色对白）。"""

    name = "generate_voiceover"
    description = "把文本转为语音。voice 决定音色（male_calm / female_warm / child / elder 等）。"
    category = "audio"
    requires_approval = True
    estimated_cost_usd = 0.02
    estimated_time_sec = 10.0
    idempotent = False
    parameters = [
        ToolParameter(name="text", type="string", description="要朗读的文本", required=True),
        ToolParameter(name="voice", type="string", description="音色 id", required=False, default="female_warm"),
        ToolParameter(name="model_id", type="string", description="可选：指定 TTS 模型", required=False),
    ]

    async def validate(self, ctx: ToolContext, params: dict) -> str | None:
        if not params.get("text") or not str(params["text"]).strip():
            return "text 不能为空"
        return None

    async def execute(self, ctx: ToolContext, params: dict) -> dict:
        svc = _resolve_service(ctx)
        req = MediaRequest(
            kind="audio",
            prompt=str(params["text"]),
            voice=params.get("voice") or "female_warm",
            model_id=params.get("model_id"),
            extra={"asset_kind": "voiceover", "voice": params.get("voice")},
        )
        result = await svc.generate(req)
        return {
            "url": result.url,
            "text": params["text"],
            "voice": req.voice,
            "kind": "voiceover",
            "cost_usd": result.cost_usd,
            "elapsed_sec": result.elapsed_sec,
        }


class GenerateBgmTool(BaseTool):
    """生成背景音乐。"""

    name = "generate_bgm"
    description = "按情绪/时长生成背景音乐。"
    category = "audio"
    requires_approval = True
    estimated_cost_usd = 0.05
    estimated_time_sec = 20.0
    idempotent = False
    parameters = [
        ToolParameter(name="mood", type="string", description="情绪：warm / tense / sad / epic / romantic / mysterious", required=True),
        ToolParameter(name="duration_sec", type="number", description="时长（秒）", required=False, default=60),
        ToolParameter(name="style", type="string", description="风格：orchestral / piano / electronic / acoustic", required=False, default="orchestral"),
        ToolParameter(name="model_id", type="string", description="可选：指定模型", required=False),
    ]

    async def validate(self, ctx: ToolContext, params: dict) -> str | None:
        if not params.get("mood") or not str(params["mood"]).strip():
            return "mood 不能为空"
        return None

    async def execute(self, ctx: ToolContext, params: dict) -> dict:
        svc = _resolve_service(ctx)
        duration = float(params.get("duration_sec") or 60)
        prompt = f"{params['mood']} {params.get('style', 'orchestral')} background music, {int(duration)} seconds, loop-friendly, no vocals"
        req = MediaRequest(
            kind="audio",
            prompt=prompt,
            duration_sec=duration,
            model_id=params.get("model_id"),
            extra={"asset_kind": "bgm", "mood": params["mood"]},
        )
        result = await svc.generate(req)
        return {
            "url": result.url,
            "mood": params["mood"],
            "duration_sec": duration,
            "kind": "bgm",
            "cost_usd": result.cost_usd,
            "elapsed_sec": result.elapsed_sec,
            "prompt": prompt,
        }
