"""LLM Provider Config — Agent 用的 provider 列表由前端 ApiSettingsModal 写入。

端点：
  GET    /api/llm-providers                 — 列出所有 provider（api_key 脱敏）
  GET    /api/llm-providers/{provider_id}    — 单个（脱敏）
  PUT    /api/llm-providers/{provider_id}    — upsert（创建或更新）
  DELETE /api/llm-providers/{provider_id}    — 删除

api_key 在 GET 列表时返回脱敏（保留前 4 + 后 4 位），完整 key 仅在 PUT 时回显。
"""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session
from typing import List, Optional

from ..database import get_db
from ..models import LLMProviderConfig

router = APIRouter()


class LLMProviderIn(BaseModel):
    """PUT body。前端表单提交。"""
    base_url: str = Field(..., min_length=1, max_length=512)
    api_key: str = Field(..., min_length=1)
    default_model: str = Field(..., min_length=1, max_length=128)
    chat_models: List[str] = Field(default_factory=list)


class LLMProviderOut(BaseModel):
    id: int
    provider_id: str
    base_url: str
    api_key: str  # 脱敏后的
    default_model: str
    chat_models: List[str] = Field(default_factory=list)
    created_at: Optional[str] = None
    updated_at: Optional[str] = None


def _orm_to_out(p: LLMProviderConfig) -> dict:
    return p.to_dict(mask_key=True)


@router.get("", response_model=List[LLMProviderOut])
def list_llm_providers(db: Session = Depends(get_db)):
    """列出所有 provider 配置（api_key 脱敏）。"""
    rows = db.query(LLMProviderConfig).order_by(LLMProviderConfig.provider_id).all()
    return [_orm_to_out(r) for r in rows]


@router.get("/{provider_id}", response_model=LLMProviderOut)
def get_llm_provider(provider_id: str, db: Session = Depends(get_db)):
    """单个 provider 配置（api_key 脱敏）。"""
    row = db.query(LLMProviderConfig).filter_by(provider_id=provider_id).first()
    if not row:
        raise HTTPException(status_code=404, detail="provider not found")
    return _orm_to_out(row)


@router.put("/{provider_id}", response_model=LLMProviderOut)
def upsert_llm_provider(
    provider_id: str,
    body: LLMProviderIn,
    db: Session = Depends(get_db),
):
    """创建或更新一个 provider 配置。"""
    import json as _json
    row = db.query(LLMProviderConfig).filter_by(provider_id=provider_id).first()
    if row:
        row.base_url = body.base_url.rstrip("/")
        row.api_key = body.api_key
        row.default_model = body.default_model
        row.chat_models_json = _json.dumps(body.chat_models or [])
    else:
        row = LLMProviderConfig(
            provider_id=provider_id,
            base_url=body.base_url.rstrip("/"),
            api_key=body.api_key,
            default_model=body.default_model,
            chat_models_json=_json.dumps(body.chat_models or []),
        )
        db.add(row)
    db.commit()
    db.refresh(row)
    return _orm_to_out(row)


@router.delete("/{provider_id}")
def delete_llm_provider(provider_id: str, db: Session = Depends(get_db)):
    """删除一个 provider 配置。"""
    row = db.query(LLMProviderConfig).filter_by(provider_id=provider_id).first()
    if not row:
        raise HTTPException(status_code=404, detail="provider not found")
    db.delete(row)
    db.commit()
    return {"deleted": provider_id}
