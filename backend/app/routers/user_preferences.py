"""UserPreference 路由。

替代散落在 localStorage 的小数据（language / current_canvas_id / deleted_ids / emoji / step_bindings）。
key-value 存储，value 是任意 JSON。
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List, Optional, Any

from ..database import get_db
from .. import models, schemas
import json as _json

router = APIRouter()


@router.get("", response_model=List[schemas.UserPreferenceItem])
def list_preferences(db: Session = Depends(get_db)):
    """列出所有偏好。"""
    rows = db.query(models.UserPreference).order_by(models.UserPreference.key).all()
    return [r.to_dict() for r in rows]


@router.get("/{key}", response_model=schemas.UserPreferenceItem)
def get_preference(key: str, db: Session = Depends(get_db)):
    row = db.query(models.UserPreference).filter(models.UserPreference.key == key).first()
    if not row:
        # 不存在时返 200 + value=null（前端 fetch 单个 key 不需要判 404）
        return schemas.UserPreferenceItem(key=key, value=None, updated_at=None)
    return row.to_dict()


@router.put("/{key}", response_model=schemas.UserPreferenceItem)
def upsert_preference(
    key: str,
    body: schemas.UserPreferenceUpsert,
    db: Session = Depends(get_db),
):
    row = db.query(models.UserPreference).filter(models.UserPreference.key == key).first()
    if row is None:
        row = models.UserPreference(key=key, value_json=_json.dumps(body.value))
        db.add(row)
    else:
        row.value_json = _json.dumps(body.value)
    db.commit()
    db.refresh(row)
    return row.to_dict()


@router.post("/_batch", response_model=List[schemas.UserPreferenceItem])
def batch_upsert_preferences(
    body: schemas.UserPreferencesBatchUpsert,
    db: Session = Depends(get_db),
):
    """批量写入：一次 POST 多个 key。用于前端挂载时一次性同步所有偏好。"""
    out: List[schemas.UserPreferenceItem] = []
    for k, v in (body.items or {}).items():
        row = db.query(models.UserPreference).filter(models.UserPreference.key == k).first()
        if row is None:
            row = models.UserPreference(key=k, value_json=_json.dumps(v))
            db.add(row)
        else:
            row.value_json = _json.dumps(v)
        out.append({"key": k, "value": v, "updated_at": None})
    db.commit()
    return out


@router.delete("/{key}")
def delete_preference(key: str, db: Session = Depends(get_db)):
    row = db.query(models.UserPreference).filter(models.UserPreference.key == key).first()
    if not row:
        raise HTTPException(404, "Preference not found")
    db.delete(row)
    db.commit()
    return {"ok": True, "deleted": key}
