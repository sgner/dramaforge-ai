"""统一 Provider 路由（Plan 5 UI merge）。

合并 /api/llm-providers 和 /api/media-providers 为 /api/providers。
旧 endpoint 改为返 410 Gone（见 Task 3）。
"""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session
from typing import List, Optional

from ..database import get_db
from ..models import ProviderConfig

import json as _json

router = APIRouter()


class ProviderOut(BaseModel):
    id: int
    provider_id: str
    name: str = ""
    base_url: str
    api_key: str
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


@router.get("", response_model=List[ProviderOut])
def list_providers(db: Session = Depends(get_db)):
    """列出所有 provider（api_key 脱敏）。"""
    rows = db.query(ProviderConfig).order_by(ProviderConfig.provider_id).all()
    return [r.to_dict(mask_key=True) for r in rows]


@router.get("/{provider_id}", response_model=ProviderOut)
def get_provider(provider_id: str, db: Session = Depends(get_db)):
    """单个 provider（脱敏）。"""
    row = db.query(ProviderConfig).filter_by(provider_id=provider_id).first()
    if not row:
        raise HTTPException(status_code=404, detail="provider not found")
    return row.to_dict(mask_key=True)


class ProviderIn(BaseModel):
    """PUT body。api_key=None/空 → 保留 DB 原 key；非空 → 覆盖。"""
    name: str = ""
    base_url: str = Field(..., min_length=1, max_length=512)
    api_key: Optional[str] = None  # None/空 → preserve
    default_model: str = ""
    protocol: str = "openai"
    enabled: bool = True
    chat_models: List[str] = Field(default_factory=list)
    image_models: List[str] = Field(default_factory=list)
    video_models: List[str] = Field(default_factory=list)
    extra_config: dict = Field(default_factory=dict)


@router.put("/{provider_id}", response_model=ProviderOut)
def upsert_provider(
    provider_id: str,
    body: ProviderIn,
    db: Session = Depends(get_db),
):
    """创建或更新一个 provider。

    字段保留语义：api_key=None 或空字符串 → 保留 DB 原 key（编辑时用户没改）。
    其它字段：总是用 body 提供的值覆盖（前端表单用 GET hydrate 拿到全字段再 PUT）。
    """
    row = db.query(ProviderConfig).filter_by(provider_id=provider_id).first()
    if row is None:
        # 新建：api_key 必须非空（如果有）
        api_key_to_set = body.api_key if body.api_key else ""
        row = ProviderConfig(
            provider_id=provider_id,
            name=body.name,
            base_url=body.base_url.rstrip("/"),
            api_key=api_key_to_set,
            default_model=body.default_model,
            protocol=body.protocol,
            enabled=body.enabled,
            chat_models_json=_json.dumps(body.chat_models),
            image_models_json=_json.dumps(body.image_models),
            video_models_json=_json.dumps(body.video_models),
            extra_config_json=_json.dumps(body.extra_config),
        )
        db.add(row)
    else:
        # 更新：api_key 为空/None → 保留原值
        row.name = body.name
        row.base_url = body.base_url.rstrip("/")
        if body.api_key:  # 非空 → 覆盖
            row.api_key = body.api_key
        # else: 保留原 key
        row.default_model = body.default_model
        row.protocol = body.protocol
        row.enabled = body.enabled
        row.chat_models_json = _json.dumps(body.chat_models)
        row.image_models_json = _json.dumps(body.image_models)
        row.video_models_json = _json.dumps(body.video_models)
        row.extra_config_json = _json.dumps(body.extra_config)
    db.commit()
    db.refresh(row)
    return row.to_dict(mask_key=True)
