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
    }


def begin_media_asset(db: Any, *, project_id: str | None, kind: str, asset_kind: str | None, name: str, prompt: str, provider_id: str | None = None, provider_name: str | None = None, model_id: str | None = None, extra: dict | None = None) -> dict:
    from ..models import Asset

    existing = db.query(Asset).filter(
        Asset.project_id == project_id,
        Asset.kind == kind,
        Asset.asset_kind == asset_kind,
        Asset.name == (name or ""),
        Asset.prompt == prompt,
        Asset.failed.is_(True),
    ).order_by(Asset.created_at.desc()).first()
    if existing:
        existing.generating = True
        existing.failed = False
        existing.error = None
        existing.url = None
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
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return _asset_dict(row)


def finish_media_asset(db: Any, asset_id: str, *, url: str | None = None, error: str | None = None, prompt: str | None = None) -> dict:
    from ..models import Asset

    row = db.query(Asset).filter(Asset.id == asset_id).one()
    row.generating = False
    row.failed = bool(error)
    row.error = error
    if url is not None:
        row.url = url
    if prompt is not None:
        row.prompt = prompt
    db.commit()
    db.refresh(row)
    return _asset_dict(row)
