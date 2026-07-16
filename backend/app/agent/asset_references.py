"""Project-scoped logical asset references used by media generation tools."""

from sqlalchemy.orm import Session

from ..models import Asset


def resolve_asset_references(
    db: Session,
    project_id: str,
    asset_ids: list[str],
    *,
    media_kind: str,
) -> list[dict]:
    """Resolve logical asset IDs to usable project-local media references.

    A normalized derivative is preferred when it explicitly supports the
    requested media kind. This keeps later shots consistent with the same
    character/prop while allowing an uploaded source to remain unchanged.
    """
    refs: list[dict] = []
    for asset_id in asset_ids:
        source = db.query(Asset).filter(Asset.id == asset_id).first()
        if source is None:
            raise ValueError(f"asset '{asset_id}' not found")
        if source.project_id != project_id:
            raise ValueError(f"asset '{asset_id}' does not belong to project '{project_id}'")

        normalized = (
            db.query(Asset)
            .filter(
                Asset.project_id == project_id,
                Asset.source_asset_id == source.id,
                Asset.origin == "normalized",
                Asset.inspection_status == "ready",
                Asset.url.isnot(None),
            )
            .order_by(Asset.created_at.desc())
            .all()
        )
        selected = next(
            (candidate for candidate in normalized
             if (candidate.reference_capabilities or {}).get(media_kind, False)),
            None,
        )
        if selected is None:
            if not source.url or source.inspection_status not in {"ready", "skipped"}:
                raise ValueError(f"asset '{asset_id}' is not ready for {media_kind}")
            selected = source

        selected.usage_count = (selected.usage_count or 0) + 1
        refs.append({
            "asset_id": selected.id,
            "source_asset_id": source.id if selected.id != source.id else None,
            "asset_kind": selected.asset_kind,
            "url": selected.url,
        })
    db.commit()
    return refs
