"""Agent tools for inspecting uploaded assets before generation."""

from .base import BaseTool, ToolContext, ToolParameter
from ..asset_intelligence import create_character_normalization_asset, inspect_asset, prepare_asset


class InspectAssetTool(BaseTool):
    name = "inspect_asset"
    description = "使用当前项目绑定的多模态 LLM 检查上传资产类型、主体和可复用能力。"
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
        if not ctx.llm_client:
            return "vision-capable LLM is required"
        if not params.get("asset_id"):
            return "asset_id is required"
        return None

    async def execute(self, ctx: ToolContext, params: dict) -> dict:
        result = await inspect_asset(ctx.db, ctx.project_id, params["asset_id"], ctx.llm_client)
        return {"ok": True, "asset_id": params["asset_id"], "inspection": result}


class PrepareCharacterAssetTool(BaseTool):
    name = "prepare_character_asset"
    description = "为不符合角色标准的上传图创建关联的角色设计图/三视图标准化资产。"
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
