# backend/app/agent/tools/asset_registry_tools.py
"""资产注册表工具：搜索项目资产库。"""
from __future__ import annotations

from .base import BaseTool, ToolContext, ToolParameter
from .asset_registry_helpers import search_assets, group_by_entity


class SearchProjectAssetsTool(BaseTool):
    """搜索项目资产库，返回匹配资产供 agent 复用。"""

    name = "search_project_assets"
    description = (
        "搜索当前项目的已有资产库，在生成新资产前先查是否已有可复用资产。\n"
        "【两层过滤】\n"
        "1. 名称+类型先筛：按 name 模糊匹配 + asset_kind 精确匹配\n"
        "2. 角色卡指纹精确匹配（如有 visual_identity）\n"
        "【返回】按 story_entity_id 聚合的资产列表\n"
        "【使用时机】生成角色/道具/场景/分镜前必须先调此工具"
    )
    category = "asset"
    requires_approval = False
    estimated_cost_usd = 0.0
    estimated_time_sec = 0.5
    idempotent = True

    parameters = [
        ToolParameter(
            name="query",
            type="string",
            description="搜索关键词（资产名称或描述片段）",
            required=True,
        ),
        ToolParameter(
            name="asset_kind",
            type="string",
            description="资产类型：character / prop / scene / shot / script / video",
            required=False,
            enum=["character", "prop", "scene", "shot", "script", "video"],
        ),
        ToolParameter(
            name="include_unidentified",
            type="boolean",
            description="是否包含未标识的上传资产（默认 false）",
            required=False,
            default=False,
        ),
    ]

    async def validate(self, ctx: ToolContext, params: dict) -> str | None:
        query = str(params.get("query") or "").strip()
        if not query:
            return "query 不能为空"
        if not ctx.db or not ctx.project_id:
            return "search_project_assets 需要项目上下文（db + project_id）"
        return None

    async def execute(self, ctx: ToolContext, params: dict) -> dict:
        query = params["query"].strip()
        asset_kind = params.get("asset_kind")
        include_unidentified = bool(params.get("include_unidentified", False))

        results = search_assets(
            ctx.db,
            ctx.project_id,
            query,
            asset_kind=asset_kind,
            include_unidentified=include_unidentified,
        )
        return group_by_entity(results)
