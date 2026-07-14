"""DramaTask 路由。

替代前端 localStorage 的 dramaforge_tasks 持久化。
后端用 SQLite 存整段 JSON（data 字段），与 Project/Canvas 解耦：
- DramaTask 侧重 pipeline 产物（characters/bigShots/...）
- Project 侧重画布节点 / 连接 / 资产
- DramaTask.id === Project.id（前端用同一个 id 同时进 ProjectList 和 CanvasGate）
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List, Optional

from ..database import get_db
from .. import models, schemas
import json as _json

router = APIRouter()


def _deep_merge(base: dict, patch: dict) -> dict:
    """递归合并两个 dict。patch 中的 list 整体覆盖 base。"""
    out = dict(base or {})
    for k, v in (patch or {}).items():
        if isinstance(v, dict) and isinstance(out.get(k), dict):
            out[k] = _deep_merge(out[k], v)
        else:
            out[k] = v
    return out


@router.get("", response_model=List[schemas.DramaTaskOut])
def list_drama_tasks(
    include_deleted: bool = False,
    db: Session = Depends(get_db),
):
    """列出所有 DramaTask。

    include_deleted=False（默认）：返回 deleted=False 的。
    include_deleted=True：trash 视图。
    """
    q = db.query(models.DramaTask).order_by(models.DramaTask.updated_at.desc())
    if not include_deleted:
        q = q.filter(models.DramaTask.deleted == False)  # noqa: E712
    rows = q.all()
    return [r.to_dict() for r in rows]


@router.get("/{task_id}", response_model=schemas.DramaTaskOut)
def get_drama_task(task_id: str, db: Session = Depends(get_db)):
    row = db.query(models.DramaTask).filter(models.DramaTask.id == task_id).first()
    if not row:
        raise HTTPException(404, "DramaTask not found")
    return row.to_dict()


@router.put("/{task_id}", response_model=schemas.DramaTaskOut)
def upsert_drama_task(
    task_id: str,
    body: schemas.DramaTaskUpsert,
    db: Session = Depends(get_db),
):
    """创建或整体替换一个 DramaTask。data 字段被序列化进 data_json。"""
    row = db.query(models.DramaTask).filter(models.DramaTask.id == task_id).first()
    if row is None:
        row = models.DramaTask(
            id=task_id,
            name=body.name or "Untitled",
            deleted=bool(body.deleted) if body.deleted is not None else False,
            data_json=_json.dumps(body.data or {}),
        )
        db.add(row)
    else:
        if body.name is not None:
            row.name = body.name
        if body.deleted is not None:
            row.deleted = bool(body.deleted)
        row.data_json = _json.dumps(body.data or {})
    db.commit()
    db.refresh(row)
    return row.to_dict()


@router.patch("/{task_id}", response_model=schemas.DramaTaskOut)
def patch_drama_task(
    task_id: str,
    body: schemas.DramaTaskPatch,
    db: Session = Depends(get_db),
):
    """局部更新。data 走 deep-merge（避免覆盖未提供的 pipeline 字段）。"""
    row = db.query(models.DramaTask).filter(models.DramaTask.id == task_id).first()
    if not row:
        raise HTTPException(404, "DramaTask not found")
    if body.name is not None:
        row.name = body.name
    if body.deleted is not None:
        row.deleted = bool(body.deleted)
    if body.data is not None:
        try:
            base = _json.loads(row.data_json) if row.data_json else {}
        except Exception:
            base = {}
        merged = _deep_merge(base, body.data)
        row.data_json = _json.dumps(merged)
    db.commit()
    db.refresh(row)
    return row.to_dict()


@router.delete("/{task_id}")
def delete_drama_task(task_id: str, db: Session = Depends(get_db)):
    row = db.query(models.DramaTask).filter(models.DramaTask.id == task_id).first()
    if not row:
        raise HTTPException(404, "DramaTask not found")
    db.delete(row)
    db.commit()
    return {"ok": True, "deleted": task_id}
