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
from ..models import ProviderConfig

router = APIRouter()


class LLMProviderIn(BaseModel):
    """PUT body。前端表单提交。"""
    name: str = Field(default="", max_length=128)
    base_url: str = Field(..., min_length=1, max_length=512)
    api_key: str = Field(..., min_length=1)
    default_model: str = Field(default="", max_length=128)
    protocol: str = Field(default="openai", max_length=32)
    enabled: bool = True
    chat_models: List[str] = Field(default_factory=list)
    image_models: List[str] = Field(default_factory=list)
    video_models: List[str] = Field(default_factory=list)
    extra_config: dict = Field(default_factory=dict)


class LLMProviderOut(BaseModel):
    id: int
    provider_id: str
    name: str = ""
    base_url: str
    api_key: str  # 脱敏
    default_model: str = ""
    protocol: str = "openai"
    enabled: bool = True
    chat_models: List[str] = Field(default_factory=list)
    image_models: List[str] = Field(default_factory=list)
    video_models: List[str] = Field(default_factory=list)
    extra_config: dict = Field(default_factory=dict)
    has_key: bool = False
    key_preview: str = ""
    created_at: Optional[str] = None
    updated_at: Optional[str] = None


def _orm_to_out(p: ProviderConfig) -> dict:
    return p.to_dict(mask_key=True)


@router.get("", response_model=List[LLMProviderOut])
def list_llm_providers(db: Session = Depends(get_db)):
    """列出所有 provider 配置（api_key 脱敏）。"""
    rows = db.query(ProviderConfig).order_by(ProviderConfig.provider_id).all()
    return [_orm_to_out(r) for r in rows]


@router.get("/{provider_id}", response_model=LLMProviderOut)
def get_llm_provider(provider_id: str, db: Session = Depends(get_db)):
    """单个 provider 配置（api_key 脱敏）。"""
    row = db.query(ProviderConfig).filter_by(provider_id=provider_id).first()
    if not row:
        raise HTTPException(status_code=404, detail="provider not found")
    return _orm_to_out(row)


@router.put("/{provider_id}", response_model=LLMProviderOut)
def upsert_llm_provider(
    provider_id: str,
    body: LLMProviderIn,
    db: Session = Depends(get_db),
):
    """创建或更新一个 provider 配置（统一表）。"""
    import json as _json
    row = db.query(ProviderConfig).filter_by(provider_id=provider_id).first()
    if row:
        row.name = body.name
        row.base_url = body.base_url.rstrip("/")
        row.api_key = body.api_key
        row.default_model = body.default_model
        row.protocol = body.protocol
        row.enabled = body.enabled
        row.chat_models_json = _json.dumps(body.chat_models or [])
        row.image_models_json = _json.dumps(body.image_models or [])
        row.video_models_json = _json.dumps(body.video_models or [])
        row.extra_config_json = _json.dumps(body.extra_config or {})
    else:
        row = ProviderConfig(
            provider_id=provider_id,
            name=body.name,
            base_url=body.base_url.rstrip("/"),
            api_key=body.api_key,
            default_model=body.default_model,
            protocol=body.protocol,
            enabled=body.enabled,
            chat_models_json=_json.dumps(body.chat_models or []),
            image_models_json=_json.dumps(body.image_models or []),
            video_models_json=_json.dumps(body.video_models or []),
            extra_config_json=_json.dumps(body.extra_config or {}),
        )
        db.add(row)
    db.commit()
    db.refresh(row)
    return _orm_to_out(row)


@router.delete("/{provider_id}")
def delete_llm_provider(provider_id: str, db: Session = Depends(get_db)):
    """删除一个 provider 配置。"""
    row = db.query(ProviderConfig).filter_by(provider_id=provider_id).first()
    if not row:
        raise HTTPException(status_code=404, detail="provider not found")
    db.delete(row)
    db.commit()
    return {"deleted": provider_id}
