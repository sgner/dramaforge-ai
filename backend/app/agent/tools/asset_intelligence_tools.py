"""Agent tools for inspecting uploaded assets before generation."""

from .base import BaseTool, ToolContext, ToolParameter
from .asset_tools import ReadTextAssetTool
from ..asset_intelligence import create_character_normalization_asset, inspect_asset, prepare_asset
from ...models import Asset


class InspectAssetTool(BaseTool):
    name = "inspect_asset"
    description = (
        "Inspect an uploaded visual image/video asset with the project's multimodal LLM. "
        "Never use this for novel/script text assets; use read_text_asset for text. "
        "If called with a novel/script id by mistake, it safely routes to read_text_asset."
    )
    category = "asset"
    idempotent = True
    parameters = [
        ToolParameter(name="asset_id", type="string", description="项目内资产 ID"),
    ]

    async def validate(self, ctx: ToolContext, params: dict) -> str | None:
        if not ctx.project_id:
            return "project_id is required"
        if not ctx.db:
            return "database is required"
        if not params.get("asset_id"):
            return "asset_id is required"
        asset = ctx.db.query(Asset).filter(Asset.id == params["asset_id"]).first()
        if asset is None:
            return f"asset '{params['asset_id']}' not found"
        if asset.project_id != ctx.project_id:
            return f"asset '{params['asset_id']}' does not belong to current project"
        is_text = asset.kind == "text" and asset.asset_kind in {"novel", "script"}
        if not is_text and not ctx.llm_client:
            return "vision-capable LLM is required"
        return None

    async def execute(self, ctx: ToolContext, params: dict) -> dict:
        asset = ctx.db.query(Asset).filter(Asset.id == params["asset_id"]).first()
        if asset is not None and asset.kind == "text" and asset.asset_kind in {"novel", "script"}:
            text_result = await ReadTextAssetTool().call(
                ctx,
                {"asset_id": asset.id, "include_body": True, "max_chars": 0},
            )
            return {
                "ok": True,
                "asset_id": asset.id,
                "routed_tool": "read_text_asset",
                "inspection": {
                    "asset_type": "text",
                    "asset_kind": asset.asset_kind,
                    "meets_standard": True,
                    "recommended_action": "use_text_content",
                },
                "text_asset": text_result,
            }
        result = await inspect_asset(ctx.db, ctx.project_id, params["asset_id"], ctx.llm_client)
        return {"ok": True, "asset_id": params["asset_id"], "inspection": result}


class PrepareCharacterAssetTool(BaseTool):
    name = "prepare_character_asset"
    description = "为不符合角色标准的上传图创建关联的角色概念表资产（V3.0 B.4 4 区域布局：主视觉区+补充信息区+局部细节区+半身照比例照）。"
    category = "asset"
    idempotent = True
    parameters = [
        ToolParameter(name="asset_id", type="string", description="待标准化的源角色资产 ID"),
    ]

    async def validate(self, ctx: ToolContext, params: dict) -> str | None:
        if not ctx.project_id or not ctx.db:
            return "project_id and database are required"
        if not params.get("asset_id"):
            return "asset_id is required"
        return None

    async def execute(self, ctx: ToolContext, params: dict) -> dict:
        derivative = prepare_asset(ctx.db, ctx.project_id, params["asset_id"], "character")
        return {
            "ok": True,
            "asset_id": derivative.id,
            "source_asset_id": derivative.source_asset_id,
            "generating": derivative.generating,
            "prompt": derivative.prompt,
            "status": derivative.status,
            "version": derivative.version,
            "reference_role": derivative.reference_role,
            "derived_from": derivative.derived_from or [],
            "next": "generate_media_batch or generate_character_portrait",
        }
