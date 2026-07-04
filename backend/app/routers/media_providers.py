"""Media Provider Config — 画布媒体供应商配置。

端点：
  GET    /api/media-providers                  — 列出所有（api_key 脱敏）
  GET    /api/media-providers/{provider_id}     — 单个（脱敏）
  PUT    /api/media-providers/{provider_id}     — upsert（创建或更新）
  PATCH  /api/media-providers/{provider_id}     — 部分更新（api_key 为空则不改）
  DELETE /api/media-providers/{provider_id}     — 删除

设计目标：所有供应商配置（agent LLM / 画布图片视频）统一通过后端 DB 存储；
前端不再持有明文 api_key，不再直连供应商。
"""
from __future__ import annotations

import json
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import MediaProviderConfig


router = APIRouter()


# ============ Pydantic schemas ============

class MediaProviderIn(BaseModel):
    """PUT body — 完整 upsert。"""
    name: str = Field(default="", max_length=128)
    base_url: str = Field(..., min_length=1, max_length=512)
    api_key: str = Field(default="", max_length=4096)  # 允许空（仅改其他字段）
    protocol: str = Field(default="openai", max_length=32)
    enabled: bool = True
    image_models: List[str] = Field(default_factory=list)
    chat_models: List[str] = Field(default_factory=list)
    video_models: List[str] = Field(default_factory=list)
    extra_config: dict = Field(default_factory=dict)


class MediaProviderPatch(BaseModel):
    """PATCH body — 部分更新。api_key 为空字符串时不变（保持 DB 原值）。"""
    name: Optional[str] = None
    base_url: Optional[str] = None
    api_key: Optional[str] = None  # None 或空字符串 = 不变；非空 = 覆盖
    protocol: Optional[str] = None
    enabled: Optional[bool] = None
    image_models: Optional[List[str]] = None
    chat_models: Optional[List[str]] = None
    video_models: Optional[List[str]] = None
    extra_config: Optional[dict] = None


class MediaProviderOut(BaseModel):
    id: int
    provider_id: str
    name: str
    base_url: str
    api_key: str  # 脱敏后的
    protocol: str
    enabled: bool
    image_models: List[str] = Field(default_factory=list)
    chat_models: List[str] = Field(default_factory=list)
    video_models: List[str] = Field(default_factory=list)
    extra_config: dict = Field(default_factory=dict)
    has_key: bool = False
    key_preview: str = ""
    created_at: Optional[str] = None
    updated_at: Optional[str] = None


# ============ Helpers ============

def _to_out(p: MediaProviderConfig) -> dict:
    return p.to_dict(mask_key=True)


def _apply_payload(row: MediaProviderConfig, payload: dict) -> None:
    """把 payload 字段写到 row。空 api_key 不覆盖（保留原值）。"""
    if "name" in payload and payload["name"] is not None:
        row.name = payload["name"]
    if "base_url" in payload and payload["base_url"] is not None:
        row.base_url = payload["base_url"].rstrip("/")
    if "api_key" in payload and payload["api_key"]:
        row.api_key = payload["api_key"]
    if "protocol" in payload and payload["protocol"] is not None:
        row.protocol = payload["protocol"]
    if "enabled" in payload and payload["enabled"] is not None:
        row.enabled = bool(payload["enabled"])
    if "image_models" in payload and payload["image_models"] is not None:
        row.image_models_json = json.dumps(payload["image_models"])
    if "chat_models" in payload and payload["chat_models"] is not None:
        row.chat_models_json = json.dumps(payload["chat_models"])
    if "video_models" in payload and payload["video_models"] is not None:
        row.video_models_json = json.dumps(payload["video_models"])
    if "extra_config" in payload and payload["extra_config"] is not None:
        row.extra_config_json = json.dumps(payload["extra_config"])


# ============ Routes ============

@router.get("", response_model=List[MediaProviderOut])
def list_media_providers(db: Session = Depends(get_db)):
    """列出所有 media provider 配置（api_key 脱敏）。"""
    rows = db.query(MediaProviderConfig).order_by(MediaProviderConfig.provider_id).all()
    return [_to_out(r) for r in rows]


@router.get("/{provider_id}", response_model=MediaProviderOut)
def get_media_provider(provider_id: str, db: Session = Depends(get_db)):
    row = db.query(MediaProviderConfig).filter_by(provider_id=provider_id).first()
    if not row:
        raise HTTPException(status_code=404, detail="provider not found")
    return _to_out(row)


@router.put("/{provider_id}", response_model=MediaProviderOut)
def upsert_media_provider(
    provider_id: str,
    body: MediaProviderIn,
    db: Session = Depends(get_db),
):
    """创建或完整替换一个 provider 配置。"""
    row = db.query(MediaProviderConfig).filter_by(provider_id=provider_id).first()
    if row:
        _apply_payload(row, body.model_dump())
    else:
        row = MediaProviderConfig(
            provider_id=provider_id,
            name=body.name or provider_id,
            base_url=body.base_url.rstrip("/"),
            api_key=body.api_key or "",
            protocol=body.protocol or "openai",
            enabled=body.enabled,
            image_models_json=json.dumps(body.image_models or []),
            chat_models_json=json.dumps(body.chat_models or []),
            video_models_json=json.dumps(body.video_models or []),
            extra_config_json=json.dumps(body.extra_config or {}),
        )
        db.add(row)
    db.commit()
    db.refresh(row)
    return _to_out(row)


@router.patch("/{provider_id}", response_model=MediaProviderOut)
def patch_media_provider(
    provider_id: str,
    body: MediaProviderPatch,
    db: Session = Depends(get_db),
):
    """部分更新。api_key=None 或空字符串 = 不变；非空 = 覆盖。"""
    row = db.query(MediaProviderConfig).filter_by(provider_id=provider_id).first()
    if not row:
        raise HTTPException(status_code=404, detail="provider not found")
    payload = body.model_dump(exclude_unset=True)
    _apply_payload(row, payload)
    db.commit()
    db.refresh(row)
    return _to_out(row)


@router.delete("/{provider_id}")
def delete_media_provider(provider_id: str, db: Session = Depends(get_db)):
    row = db.query(MediaProviderConfig).filter_by(provider_id=provider_id).first()
    if not row:
        raise HTTPException(status_code=404, detail="provider not found")
    db.delete(row)
    db.commit()
    return {"deleted": provider_id}
