"""Pydantic schema"""
from pydantic import BaseModel, ConfigDict, Field
from typing import Optional, Dict, Any, List, Literal
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
    origin: str = "generated"
    source_asset_id: Optional[str] = None
    inspection_status: str = "pending"
    inspection: Dict[str, Any] = Field(default_factory=dict)
    visual_identity: Dict[str, Any] = Field(default_factory=dict)
    reference_capabilities: Dict[str, Any] = Field(default_factory=dict)
    usage_count: int = 0

    class Config:
        from_attributes = True


# ========================
# Agent Schemas (v1.0 改造新增)
# ========================

class AgentTaskCreate(BaseModel):
    user_goal: str
    project_id: Optional[str] = None
    max_steps: int = 30
    skip_confirm: bool = False
    # LLM 选择（仅 provider_id / model_id；API key 走后端 env）
    llm_provider_id: Optional[str] = None
    llm_model_id: Optional[str] = None


class AgentTaskUpdate(BaseModel):
    status: Optional[str] = None
    plan: Optional[list] = None
    artifacts: Optional[dict] = None
    pending_response: Optional[dict] = None
    total_cost_usd: Optional[float] = None
    total_tokens: Optional[int] = None
    skip_confirm: Optional[bool] = None


class AgentTaskRetry(BaseModel):
    """重试时可覆盖为画布当前绑定的 LLM。"""
    llm_provider_id: Optional[str] = None
    llm_model_id: Optional[str] = None


class AgentTaskOut(BaseModel):
    id: str
    project_id: Optional[str] = None
    user_goal: Optional[str] = None
    status: str
    plan: list = Field(default_factory=list)
    artifacts: dict = Field(default_factory=dict)
    pending_response: Optional[dict] = None
    total_cost_usd: float = 0.0
    total_tokens: int = 0
    max_steps: int = 30
    skip_confirm: bool = False
    llm_provider_id: Optional[str] = None
    llm_model_id: Optional[str] = None
    created_at: Optional[str] = None
    updated_at: Optional[str] = None

    class Config:
        from_attributes = True


class AgentStepOut(BaseModel):
    id: str
    task_id: str
    step_number: int
    thought: Optional[str] = None
    action: dict = Field(default_factory=dict)
    observation: dict = Field(default_factory=dict)
    status: str
    cost_usd: float = 0.0
    tokens: int = 0
    started_at: Optional[str] = None
    finished_at: Optional[str] = None

    class Config:
        from_attributes = True


class AgentUserResponse(BaseModel):
    """用户对 ask_user / plan 审核的响应。

    response 允许任意可 JSON 序列化的值（字符串 / 字典 / 列表），
    由后端 runtime 决定如何解读。

    Spec B: 新增 recovery_action / new_model_id 支持工具失败恢复。
    """
    response: Optional[Any] = None
    custom_text: Optional[str] = None
    approved: bool = True
    # Spec B: 失败恢复决策
    recovery_action: Optional[Literal["retry", "change_model", "skip"]] = None
    new_model_id: Optional[str] = None

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
    origin: str = "generated"
    source_asset_id: Optional[str] = None
    inspection_status: str = "pending"
    inspection: Dict[str, Any] = Field(default_factory=dict)
    visual_identity: Dict[str, Any] = Field(default_factory=dict)
    reference_capabilities: Dict[str, Any] = Field(default_factory=dict)
    usage_count: int = 0


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
    origin: Optional[str] = None
    source_asset_id: Optional[str] = None
    inspection_status: Optional[str] = None
    inspection: Optional[Dict[str, Any]] = None
    visual_identity: Optional[Dict[str, Any]] = None
    reference_capabilities: Optional[Dict[str, Any]] = None
    usage_count: Optional[int] = None


# ============ DramaTask ============
class DramaTaskOut(BaseModel):
    """DramaTask 全量数据。data 字段是完整 JSON 对象。"""
    id: str
    name: str = "Untitled"
    deleted: bool = False
    data: Dict[str, Any] = Field(default_factory=dict)
    created_at: Optional[str] = None
    updated_at: Optional[str] = None


class DramaTaskUpsert(BaseModel):
    """DramaTask 写入载荷：前端传整个 DramaTask 的 JSON。"""
    name: Optional[str] = None
    deleted: Optional[bool] = None
    data: Dict[str, Any] = Field(default_factory=dict)


class DramaTaskPatch(BaseModel):
    """DramaTask 局部更新。data 走 deep-merge，其它字段直接覆盖。"""
    name: Optional[str] = None
    deleted: Optional[bool] = None
    data: Optional[Dict[str, Any]] = None


# ============ UserPreference ============
class UserPreferenceItem(BaseModel):
    key: str
    value: Any = None
    updated_at: Optional[str] = None


class UserPreferenceUpsert(BaseModel):
    """单个偏好写入。value 是任意可序列化对象。"""
    value: Any = None


class UserPreferencesBatchUpsert(BaseModel):
    """批量写入偏好（一次 POST 多个 key）。"""
    items: Dict[str, Any]  # key → value


# ============ Full project snapshot (load/save) ============
class ProjectSnapshot(BaseModel):
    project: ProjectOut
    nodes: List[NodeOut]
    connections: List[ConnectionOut]
    assets: List[AssetOut]


# ============ Tool Metadata (ToolPalette) ============
class ToolMetadataOut(BaseModel):
    name: str
    description: str
    category: str
    requires_approval: bool
    model_config = ConfigDict(from_attributes=True)


# ============ PromptTemplate ============
class PromptTemplateOut(BaseModel):
    id: str
    name: str
    category: str
    scene: str = ""
    positive: str = ""
    negative: str = ""
    params: dict = {}
    is_builtin: bool = False
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None


class PromptTemplateCreate(BaseModel):
    name: str
    category: str = "custom"
    scene: str = ""
    positive: str = ""
    negative: str = ""
    params: dict = {}


class PromptTemplateUpdate(BaseModel):
    name: Optional[str] = None
    category: Optional[str] = None
    scene: Optional[str] = None
    positive: Optional[str] = None
    negative: Optional[str] = None
    params: Optional[dict] = None


class PromptTemplateBatchDelete(BaseModel):
    ids: List[str] = []
