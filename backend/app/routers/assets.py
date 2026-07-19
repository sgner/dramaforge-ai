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
