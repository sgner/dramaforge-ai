"""Project-scoped logical asset references used by media generation tools."""

from sqlalchemy.orm import Session

from .asset_intelligence import resolve_reference_assets


def resolve_asset_references(
    db: Session,
    project_id: str,
    asset_ids: list[str],
    *,
    media_kind: str,
) -> list[dict]:
    refs = resolve_reference_assets(db, project_id, asset_ids, role=media_kind)
    return [
        {
            "asset_id": item["asset_id"],
            "source_asset_id": item.get("source_asset_id"),
            "asset_kind": item.get("asset_kind"),
            "url": item.get("url"),
        }
        for item in refs
    ]
