"""资产库 CRUD"""
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from typing import Optional, List

from ..database import get_db
from .. import models, schemas
import uuid

router = APIRouter()


def _gen_id() -> str:
    return uuid.uuid4().hex[:16]


@router.get("", response_model=List[schemas.AssetOut])
def list_assets(
    project_id: Optional[str] = Query(None),
    db: Session = Depends(get_db),
):
    q = db.query(models.Asset)
    if project_id is not None:
        q = q.filter(models.Asset.project_id == project_id)
    return [schemas.AssetOut.from_asset_model(a) for a in q.order_by(models.Asset.created_at.desc()).all()]


@router.post("", response_model=schemas.AssetOut)
def create_asset(payload: schemas.AssetCreate, db: Session = Depends(get_db)):
    # 优先使用前端传入的 id（保持前后端 ID 一致），否则自动生成
    asset_id = payload.id or _gen_id()
    # 文本资产（novel/script）把 body 放在 extra.body 持久化；url 保留兼容旧读取
    extra = dict(payload.extra or {})
    if payload.asset_kind in ("novel", "script"):
        if payload.body and "body" not in extra:
            extra["body"] = payload.body
    asset = models.Asset(
        id=asset_id,
        project_id=payload.project_id,
        kind=payload.kind,
        asset_kind=payload.asset_kind,
        title=payload.title,
        name=payload.name,
        url=payload.url,
        prompt=payload.prompt,
        provider_id=payload.provider_id,
        provider_name=payload.provider_name,
        model_id=payload.model_id,
        failed=payload.failed,
        error=payload.error,
        generating=payload.generating,
        extra=extra,
        origin=payload.origin,
        source_asset_id=payload.source_asset_id,
        inspection_status=payload.inspection_status,
        inspection=payload.inspection,
        visual_identity=payload.visual_identity,
        reference_capabilities=payload.reference_capabilities,
        usage_count=payload.usage_count,
    )
    db.add(asset)
    db.commit()
    db.refresh(asset)
    return schemas.AssetOut.from_asset_model(asset)


@router.patch("/{asset_id}", response_model=schemas.AssetOut)
def update_asset(asset_id: str, payload: schemas.AssetUpdate, db: Session = Depends(get_db)):
    asset = db.query(models.Asset).filter(models.Asset.id == asset_id).first()
    if not asset:
        raise HTTPException(404, "Asset not found")
    updates = payload.model_dump(exclude_unset=True)
    # 文本资产 body 写入 extra.body
    if "body" in updates:
        body_val = updates.pop("body")
        if asset.asset_kind in ("novel", "script") and body_val is not None:
            extra = dict(asset.extra or {})
            extra["body"] = body_val
            updates["extra"] = extra
    # text_stats 同理
    if "text_stats" in updates:
        ts = updates.pop("text_stats")
        if ts is not None:
            extra = dict(asset.extra or {})
            extra["text_stats"] = ts
            updates["extra"] = extra
    for k, v in updates.items():
        setattr(asset, k, v)
    db.commit()
    db.refresh(asset)
    return schemas.AssetOut.from_asset_model(asset)


@router.delete("/{asset_id}")
def delete_asset(asset_id: str, db: Session = Depends(get_db)):
    asset = db.query(models.Asset).filter(models.Asset.id == asset_id).first()
    if not asset:
        raise HTTPException(404, "Asset not found")
    db.delete(asset)
    db.commit()
    return {"ok": True}


@router.post("/rebuild-from-nodes/{project_id}")
def rebuild_assets_from_nodes(project_id: str, db: Session = Depends(get_db)):
    """兜底重建：从节点的 _assetKind 字段反向构造资产记录（兼容旧数据）"""
    nodes = db.query(models.Node).filter(models.Node.project_id == project_id).all()
    created = 0
    for n in nodes:
        data = n.data or {}
        asset_kind = data.get("_assetKind")
        if not asset_kind:
            continue
        # 检查是否已有对应资产（按 url 或 prompt 匹配）
        existing = db.query(models.Asset).filter(
            models.Asset.project_id == project_id,
            models.Asset.prompt == data.get("_assetPrompt"),
        ).first()
        if existing:
            continue
        db.add(models.Asset(
            id=_gen_id(),
            project_id=project_id,
            kind=n.type if n.type in ("image", "video") else "text",
            asset_kind=asset_kind,
            title=data.get("title") or data.get("name") or "",
            name=data.get("name") or "",
            url=data.get("url"),
            prompt=data.get("_assetPrompt"),
            provider_id=data.get("_assetProviderId"),
            provider_name=data.get("_assetProviderName"),
            model_id=data.get("_assetModelId"),
            failed=bool(data.get("_assetFailed")),
            error=data.get("_assetError"),
        ))
        created += 1
    db.commit()
    return {"ok": True, "created": created}


@router.get("/search")
def search_assets_api(
    project_id: str = Query(...),
    q: str = Query(..., min_length=1),
    asset_kind: Optional[str] = None,
    include_unidentified: bool = False,
    db: Session = Depends(get_db),
):
    """项目资产搜索（供前端资产面板 + agent 工具共用）。

    返回按 story_entity 聚合的结果，结构与 SearchProjectAssetsTool 一致。
    """
    from app.agent.tools.asset_registry_helpers import search_assets, group_by_entity
    results = search_assets(
        db, project_id, q,
        asset_kind=asset_kind,
        include_unidentified=include_unidentified,
    )
    return group_by_entity(results)


@router.get("/{asset_id}/usage")
def get_asset_usage(asset_id: str, db: Session = Depends(get_db)):
    """资产使用记录：哪些任务/分镜/媒体资产引用了该资产。"""
    asset = db.query(models.Asset).filter(models.Asset.id == asset_id).first()
    if not asset:
        raise HTTPException(status_code=404, detail="Asset not found")
    rows = (
        db.query(models.AssetUsage)
        .filter(models.AssetUsage.asset_id == asset_id)
        .order_by(models.AssetUsage.created_at.desc())
        .all()
    )
    return {
        "asset_id": asset_id,
        "usage_count": asset.usage_count or 0,
        "usages": [
            {
                "id": row.id,
                "project_id": row.project_id,
                "consumer_type": row.consumer_type,
                "consumer_id": row.consumer_id,
                "role": row.role,
                "created_at": row.created_at.isoformat() if row.created_at else None,
            }
            for row in rows
        ],
    }


@router.post("/{asset_id}/identify")
def identify_asset(
    asset_id: str,
    payload: schemas.AssetIdentifyRequest,
    db: Session = Depends(get_db),
):
    """手动标识上传资产。

    前端资产面板对未标识资产（asset_kind=NULL 且 inspection_status=pending）
    调用此端点补充 asset_kind / name，并生成 story_entity_id，标记为 ready。
    """
    asset = db.query(models.Asset).filter(models.Asset.id == asset_id).first()
    if not asset:
        raise HTTPException(status_code=404, detail="Asset not found")
    asset.asset_kind = payload.asset_kind
    asset.name = payload.name
    if payload.story_entity_name:
        asset.story_entity_name = payload.story_entity_name
    models._ensure_story_entity(asset)
    asset.inspection_status = "ready"
    db.commit()
    return {
        "id": asset.id,
        "asset_kind": asset.asset_kind,
        "name": asset.name,
        "inspection_status": asset.inspection_status,
        "story_entity_id": asset.story_entity_id,
    }
