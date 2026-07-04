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
