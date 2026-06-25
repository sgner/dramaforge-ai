"""Pydantic schema"""
from pydantic import BaseModel, Field
from typing import Optional, Dict, Any, List
from datetime import datetime


# ============ Project ============
class ViewportState(BaseModel):
    x: float = 0.0
    y: float = 0.0
    scale: int = 100


class ProjectCreate(BaseModel):
    id: Optional[str] = None
    name: str = "Untitled"


class ProjectOut(BaseModel):
    id: str
    name: str
    created_at: datetime
    updated_at: datetime
    viewport: ViewportState

    @classmethod
    def from_orm_project(cls, p) -> "ProjectOut":
        return cls(
            id=p.id,
            name=p.name,
            created_at=p.created_at,
            updated_at=p.updated_at,
            viewport=ViewportState(x=p.viewport_x or 0, y=p.viewport_y or 0, scale=p.viewport_scale or 100),
        )

    class Config:
        from_attributes = True


class ProjectUpdate(BaseModel):
    name: Optional[str] = None
    viewport: Optional[ViewportState] = None


# ============ Node ============
class NodeOut(BaseModel):
    id: str = ""
    type: str = "image"
    x: float = 0.0
    y: float = 0.0
    w: int = 200
    h: int = 200
    data: Dict[str, Any] = Field(default_factory=dict)

    class Config:
        from_attributes = True
        extra = "ignore"


class NodeBatchUpsert(BaseModel):
    """批量保存项目所有节点（前端用）"""
    nodes: List[NodeOut]


# ============ Connection ============
class ConnectionOut(BaseModel):
    id: str = ""
    from_node: str = ""
    to_node: str = ""
    from_port: str = "out"
    to_port: str = "in"

    class Config:
        from_attributes = True
        extra = "ignore"


class ConnectionBatchUpsert(BaseModel):
    connections: List[ConnectionOut]


# ============ Asset ============
class AssetOut(BaseModel):
    id: str
    project_id: Optional[str] = None
    kind: str
    asset_kind: Optional[str] = None
    title: str = ""
    name: str = ""
    url: Optional[str] = None
    prompt: Optional[str] = None
    provider_id: Optional[str] = None
    provider_name: Optional[str] = None
    model_id: Optional[str] = None
    failed: bool = False
    error: Optional[str] = None
    generating: bool = False
    extra: Dict[str, Any] = Field(default_factory=dict)
    created_at: datetime

    class Config:
        from_attributes = True


class AssetCreate(BaseModel):
    id: Optional[str] = None  # 前端可传入 id 保持一致；后端默认生成
    project_id: Optional[str] = None
    kind: str = "image"
    asset_kind: Optional[str] = None
    title: str = ""
    name: str = ""
    url: Optional[str] = None
    prompt: Optional[str] = None
    provider_id: Optional[str] = None
    provider_name: Optional[str] = None
    model_id: Optional[str] = None
    failed: bool = False
    error: Optional[str] = None
    generating: bool = False
    extra: Dict[str, Any] = Field(default_factory=dict)


class AssetUpdate(BaseModel):
    url: Optional[str] = None
    prompt: Optional[str] = None
    provider_id: Optional[str] = None
    provider_name: Optional[str] = None
    model_id: Optional[str] = None
    failed: Optional[bool] = None
    error: Optional[str] = None
    generating: Optional[bool] = None
    extra: Optional[Dict[str, Any]] = None


# ============ Full project snapshot (load/save) ============
class ProjectSnapshot(BaseModel):
    project: ProjectOut
    nodes: List[NodeOut]
    connections: List[ConnectionOut]
    assets: List[AssetOut]
