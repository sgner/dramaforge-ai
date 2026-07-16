"""Persist and query project assets."""
from __future__ import annotations

import uuid

from .base import BaseTool, ToolContext, ToolParameter


def _gen_id() -> str:
    return uuid.uuid4().hex[:16]


def _asset_status(params: dict) -> str:
    if params.get("failed"):
        return "failed"
    if params.get("generating"):
        return "processing"
    if params.get("url"):
        return "ready"
    return str(params.get("status") or "uploaded")


def _derived_from(params: dict) -> list[str]:
    derived = params.get("derived_from")
    if isinstance(derived, list):
        return [str(item) for item in derived if str(item).strip()]
    source = params.get("source_asset_id")
    return [str(source)] if source else []


class SaveAssetTool(BaseTool):
    """Create or update one logical asset idempotently."""

    name = "save_asset"
    description = "Persist generated or uploaded image, video, audio, or text assets."
    category = "asset"
    requires_approval = False
    estimated_cost_usd = 0.0
    estimated_time_sec = 0.05
    idempotent = False
    parameters = [
        ToolParameter(name="kind", type="string", description="image, video, audio, or text", required=True),
        ToolParameter(name="asset_kind", type="string", description="character, prop, scene, storyboard, script, etc.", required=False),
        ToolParameter(name="name", type="string", description="logical asset name", required=False, default=""),
        ToolParameter(name="title", type="string", description="display title", required=False, default=""),
        ToolParameter(name="url", type="string", description="asset URL or data URL", required=False),
        ToolParameter(name="prompt", type="string", description="generation prompt", required=False),
        ToolParameter(name="provider_id", type="string", description="provider id", required=False),
        ToolParameter(name="provider_name", type="string", description="provider name", required=False),
        ToolParameter(name="model_id", type="string", description="model id", required=False),
        ToolParameter(name="extra", type="object", description="additional metadata", required=False),
    ]

    async def validate(self, ctx: ToolContext, params: dict) -> str | None:
        kind = params.get("kind")
        if not kind:
            return "kind is required"
        if str(kind) not in {"image", "video", "audio", "text"}:
            return "kind must be image, video, audio, or text"
        return None

    @staticmethod
    def _payload(params: dict, asset_id: str) -> dict:
        return {
            "ok": True,
            "id": asset_id,
            "kind": params.get("kind"),
            "asset_kind": params.get("asset_kind"),
            "name": params.get("name") or "",
            "title": params.get("title") or "",
            "url": params.get("url"),
            "prompt": params.get("prompt"),
            "status": _asset_status(params),
            "version": int(params.get("version") or 1),
            "source_asset_id": params.get("source_asset_id"),
            "derived_from": _derived_from(params),
            "reference_role": params.get("reference_role"),
            "prompt_source": params.get("prompt_source"),
            "prompt_optimized": params.get("prompt_optimized"),
        }

    async def execute(self, ctx: ToolContext, params: dict) -> dict:
        if ctx.db is None:
            result = self._payload(params, _gen_id())
            result["note"] = "no db, asset not persisted"
            return result

        from app import models

        source_asset_id = params.get("source_asset_id")
        name = params.get("name") or ""
        prompt = params.get("prompt") or ""
        asset = (
            ctx.db.query(models.Asset)
            .filter(
                models.Asset.project_id == ctx.project_id,
                models.Asset.kind == params["kind"],
                models.Asset.asset_kind == params.get("asset_kind"),
                models.Asset.name == name,
                models.Asset.prompt == prompt,
                models.Asset.source_asset_id == source_asset_id,
            )
            .order_by(models.Asset.created_at.desc())
            .first()
        )
        values = {
            "title": params.get("title") or "",
            "name": name,
            "url": params.get("url"),
            "prompt": prompt,
            "provider_id": params.get("provider_id"),
            "provider_name": params.get("provider_name"),
            "model_id": params.get("model_id"),
            "failed": bool(params.get("failed", False)),
            "generating": bool(params.get("generating", False)),
            "error": params.get("error"),
            "extra": params.get("extra") or {},
            "origin": params.get("origin") or "generated",
            "source_asset_id": source_asset_id,
            "status": _asset_status(params),
            "version": int(params.get("version") or 1),
            "derived_from": _derived_from(params),
            "reference_role": params.get("reference_role"),
            "prompt_source": params.get("prompt_source"),
            "prompt_optimized": params.get("prompt_optimized"),
            "inspection_status": params.get("inspection_status") or "pending",
        }
        if asset is None:
            asset = models.Asset(
                id=_gen_id(), project_id=ctx.project_id, kind=params["kind"],
                asset_kind=params.get("asset_kind"), **values,
            )
            ctx.db.add(asset)
        else:
            for key, value in values.items():
                if value is not None or key in {"failed", "generating", "status", "version"}:
                    setattr(asset, key, value)
        if not asset.failed and asset.url and asset.status in {"uploaded", "processing"}:
            asset.status = "ready"
        ctx.db.commit()
        ctx.db.refresh(asset)
        return self._payload({**params, "status": asset.status, "version": asset.version, "source_asset_id": asset.source_asset_id, "derived_from": asset.derived_from}, asset.id)


class GetArtifactsTool(BaseTool):
    """Query persisted project assets."""

    name = "get_artifacts"
    description = "Query existing assets by kind, asset_kind, or name to avoid duplicates."
    category = "asset"
    requires_approval = False
    estimated_cost_usd = 0.0
    estimated_time_sec = 0.05
    idempotent = True
    parameters = [
        ToolParameter(name="kind", type="string", description="kind filter", required=False),
        ToolParameter(name="asset_kind", type="string", description="asset kind filter", required=False),
        ToolParameter(name="name", type="string", description="name filter", required=False),
    ]

    async def validate(self, ctx: ToolContext, params: dict) -> str | None:
        return None

    async def execute(self, ctx: ToolContext, params: dict) -> dict:
        if ctx.db is None:
            return {"items": [], "count": 0}
        from app import models
        query = ctx.db.query(models.Asset)
        if ctx.project_id is not None:
            query = query.filter(models.Asset.project_id == ctx.project_id)
        if params.get("kind"):
            query = query.filter(models.Asset.kind == params["kind"])
        if params.get("asset_kind"):
            query = query.filter(models.Asset.asset_kind == params["asset_kind"])
        if params.get("name"):
            query = query.filter(models.Asset.name.like(f"%{params['name']}%"))
        rows = query.order_by(models.Asset.created_at.desc()).limit(50).all()
        items = []
        for asset in rows:
            items.append({
                "id": asset.id, "kind": asset.kind, "asset_kind": asset.asset_kind,
                "name": asset.name, "title": asset.title, "url": asset.url,
                "prompt": asset.prompt, "status": asset.status, "version": asset.version,
                "source_asset_id": asset.source_asset_id, "derived_from": asset.derived_from or [],
                "reference_role": asset.reference_role, "prompt_source": asset.prompt_source,
                "prompt_optimized": asset.prompt_optimized,
            })
        return {"items": items, "count": len(items)}
