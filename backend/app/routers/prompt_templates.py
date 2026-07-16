"""Prompt template CRUD router — 内置 + 用户自定义提示词模板。"""
import uuid
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import PromptTemplate
from .. import schemas

router = APIRouter()


@router.get("", response_model=list[schemas.PromptTemplateOut])
def list_templates(
    category: Optional[str] = Query(None),
    db: Session = Depends(get_db),
):
    """List all templates; optional ?category= filter."""
    q = db.query(PromptTemplate)
    if category:
        q = q.filter(PromptTemplate.category == category)
    return [t.to_dict() for t in q.order_by(PromptTemplate.created_at.desc()).all()]


@router.get("/{template_id}", response_model=schemas.PromptTemplateOut)
def get_template(template_id: str, db: Session = Depends(get_db)):
    tmpl = db.query(PromptTemplate).filter_by(id=template_id).first()
    if not tmpl:
        raise HTTPException(404, f"Template {template_id} not found")
    return tmpl.to_dict()


@router.post("", response_model=schemas.PromptTemplateOut)
def create_template(body: schemas.PromptTemplateCreate, db: Session = Depends(get_db)):
    tmpl = PromptTemplate(
        id=f"tpl_{uuid.uuid4().hex[:12]}",
        name=body.name,
        category=body.category,
        scene=body.scene,
        positive=body.positive,
        negative=body.negative,
        params=body.params,
        is_builtin=False,
    )
    db.add(tmpl)
    db.commit()
    db.refresh(tmpl)
    return tmpl.to_dict()


@router.put("/{template_id}", response_model=schemas.PromptTemplateOut)
def update_template(
    template_id: str,
    body: schemas.PromptTemplateUpdate,
    db: Session = Depends(get_db),
):
    tmpl = db.query(PromptTemplate).filter_by(id=template_id).first()
    if not tmpl:
        raise HTTPException(404, f"Template {template_id} not found")
    if body.name is not None:
        tmpl.name = body.name
    if body.category is not None:
        tmpl.category = body.category
    if body.scene is not None:
        tmpl.scene = body.scene
    if body.positive is not None:
        tmpl.positive = body.positive
    if body.negative is not None:
        tmpl.negative = body.negative
    if body.params is not None:
        tmpl.params = body.params
    db.commit()
    db.refresh(tmpl)
    return tmpl.to_dict()


@router.delete("/{template_id}")
def delete_template(template_id: str, db: Session = Depends(get_db)):
    tmpl = db.query(PromptTemplate).filter_by(id=template_id).first()
    if not tmpl:
        raise HTTPException(404, f"Template {template_id} not found")
    if tmpl.is_builtin:
        raise HTTPException(403, "Cannot delete built-in template")
    db.delete(tmpl)
    db.commit()
    return {"ok": True}


@router.post("/batch-delete")
def batch_delete_templates(
    body: schemas.PromptTemplateBatchDelete,
    db: Session = Depends(get_db),
):
    ids = set(body.ids)
    if not ids:
        raise HTTPException(400, "No template IDs provided")
    rows = db.query(PromptTemplate).filter(PromptTemplate.id.in_(ids)).all()
    removed = 0
    for row in rows:
        if row.is_builtin:
            continue  # Skip builtins silently
        db.delete(row)
        removed += 1
    db.commit()
    return {"removed": removed}
