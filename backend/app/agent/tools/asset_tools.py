"""资产工具：save_asset / get_artifacts。

- save_asset 把工具产出的 url 落库到 assets 表
- get_artifacts 让 agent 在每步看到已生成的资产（用于一致性）
"""
from __future__ import annotations

import uuid
from typing import Any

from .base import BaseTool, ToolContext, ToolParameter


def _gen_id() -> str:
    return uuid.uuid4().hex[:16]


# ========================
# save_asset
# ========================

class SaveAssetTool(BaseTool):
    """把工具生成的 url 落库为 Asset 记录。"""

    name = "save_asset"
    description = (
        "把工具产出的资产（image / video / audio / text）写入 assets 表。"
        "前端通过此表查询 + 渲染画布节点。"
    )
    category = "asset"
    requires_approval = False
    estimated_cost_usd = 0.0
    estimated_time_sec = 0.05
    idempotent = False
    parameters = [
        ToolParameter(name="kind", type="string", description="资产大类：image | video | audio | text", required=True),
        ToolParameter(name="asset_kind", type="string", description="资产细类：character | prop | scene | shot | voiceover | bgm | script | novel", required=False),
        ToolParameter(name="name", type="string", description="资产名称", required=False, default=""),
        ToolParameter(name="title", type="string", description="资产标题（可空）", required=False, default=""),
        ToolParameter(name="url", type="string", description="资产 URL 或 data URL", required=False),
        ToolParameter(name="prompt", type="string", description="生成 prompt", required=False),
        ToolParameter(name="provider_id", type="string", description="provider id", required=False),
        ToolParameter(name="provider_name", type="string", description="provider 名", required=False),
        ToolParameter(name="model_id", type="string", description="model id", required=False),
        ToolParameter(name="extra", type="object", description="其他扩展字段", required=False),
    ]

    async def validate(self, ctx: ToolContext, params: dict) -> str | None:
        kind = params.get("kind")
        if not kind or not str(kind).strip():
            return "kind 不能为空"
        if str(kind) not in ("image", "video", "audio", "text"):
            return f"kind 必须是 image/video/audio/text，收到 {kind!r}"
        return None

    async def execute(self, ctx: ToolContext, params: dict) -> dict:
        if ctx.db is None:
            # 没有 db 上下文：返回 id 占位即可（v1 演示用）
            return {
                "ok": True,
                "id": _gen_id(),
                "kind": params["kind"],
                "asset_kind": params.get("asset_kind"),
                "name": params.get("name") or "",
                "title": params.get("title") or "",
                "url": params.get("url"),
                "prompt": params.get("prompt"),
                "note": "no db, asset not persisted",
            }

        # 延迟导入避免循环
        from app import models  # noqa: F401

        asset_id = _gen_id()
        asset = models.Asset(
            id=asset_id,
            project_id=ctx.project_id,
            kind=params["kind"],
            asset_kind=params.get("asset_kind"),
            title=params.get("title") or "",
            name=params.get("name") or "",
            url=params.get("url"),
            prompt=params.get("prompt"),
            provider_id=params.get("provider_id"),
            provider_name=params.get("provider_name"),
            model_id=params.get("model_id"),
            failed=False,
            extra=params.get("extra") or {},
        )
        ctx.db.add(asset)
        ctx.db.commit()
        ctx.db.refresh(asset)
        return {
            "ok": True,
            "id": asset_id,
            "kind": params["kind"],
            "asset_kind": params.get("asset_kind"),
            "name": params.get("name") or "",
            "title": params.get("title") or "",
            "url": params.get("url"),
            "prompt": params.get("prompt"),
            "provider_id": params.get("provider_id"),
            "provider_name": params.get("provider_name"),
            "model_id": params.get("model_id"),
            "extra": params.get("extra") or {},
        }


# ========================
# get_artifacts
# ========================

class GetArtifactsTool(BaseTool):
    """查询已生成的资产。"""

    name = "get_artifacts"
    description = (
        "按 kind / asset_kind / name 查询已生成的资产。"
        "agent 在生成新资产前应调用此工具，避免重复。"
    )
    category = "asset"
    requires_approval = False
    estimated_cost_usd = 0.0
    estimated_time_sec = 0.05
    idempotent = True
    parameters = [
        ToolParameter(name="kind", type="string", description="大类过滤", required=False),
        ToolParameter(name="asset_kind", type="string", description="细类过滤", required=False),
        ToolParameter(name="name", type="string", description="名称模糊匹配", required=False),
    ]

    async def validate(self, ctx: ToolContext, params: dict) -> str | None:
        return None

    async def execute(self, ctx: ToolContext, params: dict) -> dict:
        if ctx.db is None:
            return {"items": [], "count": 0}

        from app import models  # noqa: F401

        q = ctx.db.query(models.Asset)
        if ctx.project_id is not None:
            q = q.filter(models.Asset.project_id == ctx.project_id)
        if params.get("kind"):
            q = q.filter(models.Asset.kind == params["kind"])
        if params.get("asset_kind"):
            q = q.filter(models.Asset.asset_kind == params["asset_kind"])
        if params.get("name"):
            q = q.filter(models.Asset.name.like(f"%{params['name']}%"))
        rows = q.order_by(models.Asset.created_at.desc()).limit(50).all()
        items = []
        for r in rows:
            d = {
                "id": r.id,
                "kind": r.kind,
                "asset_kind": r.asset_kind,
                "name": r.name,
                "title": r.title,
                "url": r.url,
                "prompt": r.prompt,
            }
            items.append(d)
        return {"items": items, "count": len(items)}
