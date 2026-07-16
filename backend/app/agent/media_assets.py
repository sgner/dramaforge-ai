"""Persist media generation lifecycle records used by the existing canvas asset nodes."""
from __future__ import annotations

import uuid
from typing import Any


def _asset_dict(row: Any) -> dict:
    return {
        "id": row.id,
        "kind": row.kind,
        "asset_kind": row.asset_kind,
        "name": row.name or "",
        "title": row.title or "",
        "url": row.url,
        "prompt": row.prompt,
        "provider_id": row.provider_id,
        "provider_name": row.provider_name,
        "model_id": row.model_id,
        "failed": bool(row.failed),
        "error": row.error,
        "generating": bool(row.generating),
        "extra": row.extra or {},
        "status": getattr(row, "status", None),
        "version": getattr(row, "version", None),
        "source_asset_id": getattr(row, "source_asset_id", None),
        "derived_from": getattr(row, "derived_from", None) or [],
        "reference_role": getattr(row, "reference_role", None),
        "prompt_source": getattr(row, "prompt_source", None),
        "prompt_optimized": getattr(row, "prompt_optimized", None),
    }


def begin_media_asset(db: Any, *, project_id: str | None, kind: str, asset_kind: str | None, name: str, prompt: str, provider_id: str | None = None, provider_name: str | None = None, model_id: str | None = None, extra: dict | None = None) -> dict:
    from ..models import Asset

    query = db.query(Asset).filter(
        Asset.project_id == project_id,
        Asset.kind == kind,
        Asset.asset_kind == asset_kind,
        Asset.name == (name or ""),
        Asset.prompt == prompt,
        Asset.source_asset_id == (extra or {}).get("source_asset_id"),
    )
    if not (extra or {}).get("batch"):
        query = query.filter(Asset.failed.is_(True))
    existing = query.order_by(Asset.created_at.desc()).first()
    if existing:
        existing.generating = True
        existing.failed = False
        existing.error = None
        existing.url = None
        existing.status = "processing"
        if provider_id is not None:
            existing.provider_id = provider_id
        if provider_name is not None:
            existing.provider_name = provider_name
        if model_id is not None:
            existing.model_id = model_id
        if extra:
            existing.extra = extra
        db.commit()
        db.refresh(existing)
        return _asset_dict(existing)

    row = Asset(
        id=f"agent-{uuid.uuid4().hex[:16]}",
        project_id=project_id,
        kind=kind,
        asset_kind=asset_kind,
        name=name or "",
        title=name or "",
        prompt=prompt,
        provider_id=provider_id,
        provider_name=provider_name,
        model_id=model_id,
        generating=True,
        failed=False,
        extra=extra or {},
        status="processing",
        version=1,
        derived_from=[(extra or {}).get("source_asset_id")] if (extra or {}).get("source_asset_id") else [],
        reference_role=(extra or {}).get("reference_role"),
        prompt_source=(extra or {}).get("prompt_source") or prompt,
        prompt_optimized=(extra or {}).get("prompt_optimized") or prompt,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return _asset_dict(row)


def finish_media_asset(
    db: Any,
    asset_id: str,
    *,
    url: str | None = None,
    error: str | None = None,
    prompt: str | None = None,
    prompt_source: str | None = None,
    prompt_optimized: str | None = None,
    extra: dict | None = None,
) -> dict:
    from ..models import Asset

    row = db.query(Asset).filter(Asset.id == asset_id).one()
    row.generating = False
    row.failed = bool(error)
    row.error = error
    if url is not None:
        row.url = url
    if prompt is not None:
        row.prompt = prompt
    if prompt_source is not None:
        row.prompt_source = prompt_source
    if prompt_optimized is not None:
        row.prompt_optimized = prompt_optimized
    if extra:
        row.extra = {**(row.extra or {}), **extra}
    row.status = "failed" if error else "ready"
    db.commit()
    db.refresh(row)
    return _asset_dict(row)
