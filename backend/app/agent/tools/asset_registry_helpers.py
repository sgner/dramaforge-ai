# backend/app/agent/tools/asset_registry_helpers.py
"""资产搜索和聚合逻辑（工具与 API 共用）。"""
from __future__ import annotations

from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from ...models import Asset, _ensure_story_entity


def search_assets(
    db: Session,
    project_id: str,
    query: str,
    *,
    asset_kind: str | None = None,
    include_unidentified: bool = False,
) -> list[dict]:
    """搜索项目资产库。

    第一层过滤：名称+类型先筛（name/title/story_entity_name 模糊匹配 + asset_kind 精确匹配）。
    排除 failed 和 generating 资产。
    默认排除未标识资产（asset_kind=NULL 且 inspection_status=pending）。
    """
    query = query.strip()
    if not query:
        return []

    stmt = select(Asset).where(
        Asset.project_id == project_id,
        Asset.failed == False,  # noqa: E712
        Asset.generating == False,  # noqa: E712
        or_(
            Asset.name.ilike(f"%{query}%"),
            Asset.title.ilike(f"%{query}%"),
            Asset.story_entity_name.ilike(f"%{query}%"),
        ),
    )
    if asset_kind:
        stmt = stmt.where(Asset.asset_kind == asset_kind)
    if not include_unidentified:
        stmt = stmt.where(
            or_(
                Asset.asset_kind.isnot(None),
                Asset.inspection_status != "pending",
            )
        )

    results = db.execute(stmt).scalars().all()

    # 确保每个资产都有 story_entity_id（懒生成）
    for asset in results:
        _ensure_story_entity(asset)
    if results:
        db.commit()

    return [_asset_to_dict(a) for a in results]


def _asset_to_dict(asset: Asset) -> dict:
    return {
        "id": asset.id,
        "name": asset.name,
        "title": asset.title,
        "kind": asset.kind,
        "asset_kind": asset.asset_kind,
        "url": asset.url,
        "status": asset.status,
        "version": asset.version,
        "story_entity_id": asset.story_entity_id,
        "story_entity_name": asset.story_entity_name,
        "visual_identity": getattr(asset, 'visual_identity', None),
    }


def group_by_entity(assets: list[dict]) -> dict:
    """按 story_entity_id 聚合资产。"""
    groups: dict[str, list[dict]] = {}
    for asset in assets:
        entity_id = asset.get("story_entity_id") or f"_unnamed_{asset['id']}"
        groups.setdefault(entity_id, []).append(asset)

    entities = []
    for entity_id, group in groups.items():
        first = group[0]
        entities.append({
            "story_entity_id": entity_id if not entity_id.startswith("_unnamed_") else None,
            "story_entity_name": first.get("story_entity_name"),
            "asset_kind": first.get("asset_kind"),
            "assets": group,
            "total_count": len(group),
        })

    return {
        "entities": entities,
        "total_entities": len(entities),
        "total_assets": len(assets),
    }
