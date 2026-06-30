"""图像生成工具：4 个 — 角色三视图 / 道具 / 场景 / 分镜图。

所有工具都通过 ctx.media_service 调底层 provider，requires_approval=True。
"""
from __future__ import annotations

from typing import Any

from ..media_service import MediaRequest, MediaService, get_default_media_service
from .base import BaseTool, ToolContext, ToolParameter


def _resolve_service(ctx: ToolContext) -> MediaService:
    return ctx.media_service or get_default_media_service()


def _build_character_prompt(character: dict, style: str = "cinematic") -> str:
    parts = [
        f"Character portrait of {character.get('name', 'character')}",
        f"age {character.get('age', 25)}, {character.get('gender', '')}".strip(),
        character.get("appearance", ""),
        character.get("personality", ""),
        "four-view character sheet, front / side / back / 3/4 view",
        "white background, high detail, consistent across views",
        style + " style, professional lighting",
    ]
    return ", ".join(p for p in parts if p)


def _build_prop_prompt(prop: dict) -> str:
    parts = [
        f"Object: {prop.get('name', 'prop')}",
        prop.get("description", ""),
        "product photo, white background, high detail, sharp focus, soft shadows",
    ]
    return ", ".join(p for p in parts if p)


def _build_scene_prompt(scene: dict) -> str:
    parts = [
        f"Scene: {scene.get('name', 'scene')}",
        scene.get("time", "day") + " time",
        scene.get("weather", ""),
        scene.get("mood", ""),
        scene.get("description", ""),
        "cinematic composition, wide shot, atmospheric lighting, 8k, high detail",
    ]
    return ", ".join(p for p in parts if p)


def _build_storyboard_prompt(shot: dict, characters: list | None = None) -> str:
    char_names = ", ".join(c.get("name", "") for c in (characters or []) if c.get("name"))
    parts = [
        f"{shot.get('camera', 'medium shot')}",
        shot.get("movement", "static"),
        shot.get("action", ""),
        f"scene: {shot.get('scene', '')}",
    ]
    if char_names:
        parts.append(f"featuring {char_names}")
    parts.append("storyboard frame, sketch style, cinematic framing")
    return ", ".join(p for p in parts if p)


# ========================
# generate_character_portrait
# ========================

class GenerateCharacterPortraitTool(BaseTool):
    """生成角色三视图（4-view character sheet）。"""

    name = "generate_character_portrait"
    description = "生成角色三视图：正面/侧面/背面/3/4 视角，便于后续分镜一致性。"
    category = "image"
    requires_approval = True
    estimated_cost_usd = 0.05
    estimated_time_sec = 25.0
    idempotent = False
    parameters = [
        ToolParameter(name="character", type="object", description="角色 dict（含 name/age/gender/appearance/personality）", required=True),
        ToolParameter(name="style", type="string", description="风格：cinematic | anime | realistic | illustration", required=False, default="cinematic"),
        ToolParameter(name="model_id", type="string", description="可选：指定模型 id", required=False),
    ]

    async def validate(self, ctx: ToolContext, params: dict) -> str | None:
        if not isinstance(params.get("character"), dict):
            return "character 必须是 dict"
        return None

    async def execute(self, ctx: ToolContext, params: dict) -> dict:
        svc = _resolve_service(ctx)
        char = params["character"]
        prompt = _build_character_prompt(char, style=params.get("style") or "cinematic")
        req = MediaRequest(
            kind="image",
            prompt=prompt,
            model_id=params.get("model_id"),
            width=1024, height=1024,
            extra={"asset_kind": "character", "character": char.get("name")},
        )
        result = await svc.generate(req)
        return {
            "url": result.url,
            "character": char.get("name"),
            "kind": "character_portrait",
            "cost_usd": result.cost_usd,
            "elapsed_sec": result.elapsed_sec,
            "prompt": prompt,
        }


# ========================
# generate_prop_image
# ========================

class GeneratePropImageTool(BaseTool):
    """生成道具图。"""

    name = "generate_prop_image"
    description = "为关键道具生成产品图（白底+细节）。"
    category = "image"
    requires_approval = True
    estimated_cost_usd = 0.03
    estimated_time_sec = 15.0
    idempotent = False
    parameters = [
        ToolParameter(name="prop", type="object", description="道具 dict", required=True),
        ToolParameter(name="model_id", type="string", description="可选：指定模型 id", required=False),
    ]

    async def validate(self, ctx: ToolContext, params: dict) -> str | None:
        if not isinstance(params.get("prop"), dict):
            return "prop 必须是 dict"
        return None

    async def execute(self, ctx: ToolContext, params: dict) -> dict:
        svc = _resolve_service(ctx)
        prop = params["prop"]
        prompt = _build_prop_prompt(prop)
        req = MediaRequest(
            kind="image",
            prompt=prompt,
            model_id=params.get("model_id"),
            width=1024, height=1024,
            extra={"asset_kind": "prop", "prop": prop.get("name")},
        )
        result = await svc.generate(req)
        return {
            "url": result.url,
            "prop": prop.get("name"),
            "kind": "prop_image",
            "cost_usd": result.cost_usd,
            "elapsed_sec": result.elapsed_sec,
            "prompt": prompt,
        }


# ========================
# generate_scene_image
# ========================

class GenerateSceneImageTool(BaseTool):
    """生成场景概念图。"""

    name = "generate_scene_image"
    description = "为拍摄场景生成环境概念图（wide shot）。"
    category = "image"
    requires_approval = True
    estimated_cost_usd = 0.05
    estimated_time_sec = 25.0
    idempotent = False
    parameters = [
        ToolParameter(name="scene", type="object", description="场景 dict", required=True),
        ToolParameter(name="model_id", type="string", description="可选：指定模型 id", required=False),
    ]

    async def validate(self, ctx: ToolContext, params: dict) -> str | None:
        if not isinstance(params.get("scene"), dict):
            return "scene 必须是 dict"
        return None

    async def execute(self, ctx: ToolContext, params: dict) -> dict:
        svc = _resolve_service(ctx)
        scene = params["scene"]
        prompt = _build_scene_prompt(scene)
        req = MediaRequest(
            kind="image",
            prompt=prompt,
            model_id=params.get("model_id"),
            width=1280, height=720,  # 16:9 视频比例
            extra={"asset_kind": "scene", "scene": scene.get("name")},
        )
        result = await svc.generate(req)
        return {
            "url": result.url,
            "scene": scene.get("name"),
            "kind": "scene_image",
            "cost_usd": result.cost_usd,
            "elapsed_sec": result.elapsed_sec,
            "prompt": prompt,
        }


# ========================
# generate_storyboard_image
# ========================

class GenerateStoryboardImageTool(BaseTool):
    """生成分镜草图。"""

    name = "generate_storyboard_image"
    description = "为分镜生成草图（sketch 风格），用于预览构图。"
    category = "image"
    requires_approval = True
    estimated_cost_usd = 0.02
    estimated_time_sec = 12.0
    idempotent = False
    parameters = [
        ToolParameter(name="shot", type="object", description="分镜 dict", required=True),
        ToolParameter(name="characters", type="array", description="可选：角色列表", required=False),
        ToolParameter(name="model_id", type="string", description="可选：指定模型 id", required=False),
    ]

    async def validate(self, ctx: ToolContext, params: dict) -> str | None:
        if not isinstance(params.get("shot"), dict):
            return "shot 必须是 dict"
        return None

    async def execute(self, ctx: ToolContext, params: dict) -> dict:
        svc = _resolve_service(ctx)
        shot = params["shot"]
        prompt = _build_storyboard_prompt(shot, params.get("characters"))
        req = MediaRequest(
            kind="image",
            prompt=prompt,
            model_id=params.get("model_id"),
            width=1280, height=720,
            extra={"asset_kind": "shot", "shot_index": shot.get("index")},
        )
        result = await svc.generate(req)
        return {
            "url": result.url,
            "shot_index": shot.get("index"),
            "kind": "storyboard_image",
            "cost_usd": result.cost_usd,
            "elapsed_sec": result.elapsed_sec,
            "prompt": prompt,
        }
