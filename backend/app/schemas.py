"""Pydantic schema"""
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator
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

    @field_validator("w", "h", mode="before")
    @classmethod
    def _round_fractional_dimension(cls, v):
        # 前端画布节点尺寸可能是小数（拖拽缩放/自动布局产生），DB 列是 Integer，
        # 落库前四舍五入，避免 Pydantic v2 int_from_float 直接 422。
        if isinstance(v, float):
            return round(v)
        return v


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
    data: Dict[str, Any] = Field(default_factory=dict)

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
    status: str = "uploaded"
    version: int = 1
    derived_from: List[str] = Field(default_factory=list)
    reference_role: Optional[str] = None
    prompt_source: Optional[str] = None
    prompt_optimized: Optional[str] = None
    inspection_status: str = "pending"
    inspection: Dict[str, Any] = Field(default_factory=dict)
    visual_identity: Dict[str, Any] = Field(default_factory=dict)
    reference_capabilities: Dict[str, Any] = Field(default_factory=dict)
    usage_count: int = 0
    # 角色声音画像：资产级音色绑定（TTS 默认音色）
    voice_id: Optional[str] = None
    # Story Bible 实体外键
    story_entity_id: Optional[str] = None
    story_entity_name: Optional[str] = None
    # 文本资产正文（小说/脚本）— 来自 extra.body
    body: Optional[str] = None
    # 文本资产统计：words / scenes / chapters
    text_stats: Dict[str, Any] = Field(default_factory=dict)
    # 任意扩展字段
    extra: Dict[str, Any] = Field(default_factory=dict)
    # 生成相关
    failed: bool = False
    error: Optional[str] = None
    generating: bool = False
    provider_id: Optional[str] = None
    provider_name: Optional[str] = None
    model_id: Optional[str] = None
    created_at: Optional[str] = None
    updated_at: Optional[str] = None

    class Config:
        from_attributes = True

    @model_validator(mode="before")
    @classmethod
    def _coerce_datetime_fields(cls, data: Any) -> Any:
        """ORM Asset 模型上 created_at / updated_at 是 datetime，而 AssetOut 字段
        是 str（统一 ISO 8601 给前端）。Pydantic 默认会拒绝 datetime 写入 str 字段，
        触发 `Input should be a valid string`。

        关键修复：在 before 阶段把 datetime 转 isoformat 字符串，避免所有
        `AssetOut.model_validate(orm_asset)` 调用都报 422。

        注意：from_attributes=True 时 data 可能是 ORM 对象本身（不是 dict），
        此时 Pydantic 会自己负责抓取字段，但 datetime 仍会进入验证。所以我们
        也需要把对象里这两个 datetime 属性提前转字符串。
        """
        if isinstance(data, dict):
            new_data = dict(data)
            for field in ("created_at", "updated_at"):
                value = new_data.get(field)
                if value is None or isinstance(value, str):
                    continue
                if hasattr(value, "isoformat"):
                    new_data[field] = value.isoformat()
            return new_data
        # ORM 对象：直接覆盖 datetime 属性为字符串
        for field in ("created_at", "updated_at"):
            value = getattr(data, field, None)
            if value is None or isinstance(value, str):
                continue
            if hasattr(value, "isoformat"):
                try:
                    setattr(data, field, value.isoformat())
                except (AttributeError, TypeError):
                    pass
        return data

    @classmethod
    def from_asset_model(cls, a) -> "AssetOut":
        """从 ORM Asset 模型构造。

        把 extra 字典里的 body / text_stats 提升到顶层字段，方便前端直接使用。
        """
        extra = a.extra or {}
        return cls(
            id=a.id,
            project_id=a.project_id,
            kind=a.kind or "image",
            asset_kind=a.asset_kind,
            title=a.title or "",
            name=a.name or "",
            url=a.url,
            prompt=a.prompt,
            origin=a.origin or "generated",
            source_asset_id=a.source_asset_id,
            status=a.status or "uploaded",
            version=a.version or 1,
            derived_from=a.derived_from or [],
            reference_role=a.reference_role,
            prompt_source=a.prompt_source,
            prompt_optimized=a.prompt_optimized,
            inspection_status=a.inspection_status or "pending",
            inspection=a.inspection or {},
            visual_identity=a.visual_identity or {},
            reference_capabilities=a.reference_capabilities or {},
            usage_count=a.usage_count or 0,
            voice_id=getattr(a, "voice_id", None),
            story_entity_id=getattr(a, "story_entity_id", None),
            story_entity_name=getattr(a, "story_entity_name", None),
            body=extra.get("body") or a.url,  # 兼容：旧数据 url 即 body
            text_stats=extra.get("text_stats") or {},
            extra=extra,
            failed=bool(a.failed),
            error=a.error,
            generating=bool(a.generating),
            provider_id=a.provider_id,
            provider_name=a.provider_name,
            model_id=a.model_id,
            created_at=a.created_at.isoformat() if getattr(a, "created_at", None) else None,
            updated_at=a.updated_at.isoformat() if getattr(a, "updated_at", None) else None,
        )


# ========================
# Agent Schemas (v1.0 改造新增)
# ========================

class AgentTaskCreate(BaseModel):
    user_goal: str
    language: Literal["zh", "en", "ja", "ko"] = "en"
    project_id: Optional[str] = None
    max_steps: int = 30
    skip_confirm: bool = False
    # LLM 选择（仅 provider_id / model_id；API key 走后端 env）
    llm_provider_id: Optional[str] = None
    llm_model_id: Optional[str] = None
    # 幂等键：重复提交（双击/重试）返回已有任务，不创建第二条执行链
    client_request_id: Optional[str] = None


class AgentTaskUpdate(BaseModel):
    # 状态转换受路由层 _TASK_TRANSITIONS 守卫，非法转换 409
    status: Optional[Literal["pending", "running", "paused", "done", "failed", "cancelled"]] = None
    plan: Optional[list] = None
    artifacts: Optional[dict] = None
    pending_response: Optional[dict] = None
    pending_question: Optional[dict] = None
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
    pending_question: Optional[dict] = None
    task_profile: Optional[dict] = None
    rule_pack_version: Optional[str] = None
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
    # 回答绑定：对应问题的 step_id。与当前 pending 问题不匹配时 409（防旧回答被新问题消费）
    question_id: Optional[str] = None
    # Spec B: 失败恢复决策
    recovery_action: Optional[Literal["retry", "change_model", "skip"]] = None
    new_model_id: Optional[str] = None

    class Config:
        from_attributes = True


class ContinueConversationRequest(BaseModel):
    """任务完成后继续对话的请求体。"""
    message: str

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
    status: str = "uploaded"
    version: int = 1
    derived_from: List[str] = Field(default_factory=list)
    reference_role: Optional[str] = None
    prompt_source: Optional[str] = None
    prompt_optimized: Optional[str] = None
    inspection_status: str = "pending"
    inspection: Dict[str, Any] = Field(default_factory=dict)
    visual_identity: Dict[str, Any] = Field(default_factory=dict)
    reference_capabilities: Dict[str, Any] = Field(default_factory=dict)
    usage_count: int = 0
    # 角色声音画像：资产级音色绑定（TTS 默认音色）
    voice_id: Optional[str] = None
    # 文本资产正文（novel/script 用）— 持久化到 extra.body
    # exclude=True 让 model_dump() 不输出这两个字段（已被 _move_text_fields_to_extra
    # 移到 extra），避免 `Asset(**payload.model_dump())` 报
    # `TypeError: 'body' is an invalid keyword argument for Asset`。
    body: Optional[str] = Field(default=None, exclude=True)
    # 文本统计：words / scenes / chapters
    text_stats: Optional[Dict[str, Any]] = Field(default=None, exclude=True)

    @model_validator(mode="before")
    @classmethod
    def _move_text_fields_to_extra(cls, data: Any) -> Any:
        """Asset ORM 没有 body / text_stats 列，传给 ORM 构造函数会报
        `TypeError: 'body' is an invalid keyword argument for Asset`。

        关键修复：构造前把 body / text_stats 复制到 extra，并从顶层移除这两个
        字段，避免 model_dump() 后再传给 Asset(**) 时仍然包含它们。
        AssetOut.from_asset_model 会从 extra.body / extra.text_stats 提回顶层。
        """
        if not isinstance(data, dict):
            return data
        # 不修改调用方传入的 dict
        new_data = dict(data)
        extra = dict(new_data.get("extra") or {})
        body = new_data.pop("body", None)
        if body is not None and "body" not in extra:
            extra["body"] = body
        text_stats = new_data.pop("text_stats", None)
        if text_stats is not None and "text_stats" not in extra:
            extra["text_stats"] = text_stats
        if extra:
            new_data["extra"] = extra
        return new_data


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
    status: Optional[str] = None
    version: Optional[int] = None
    derived_from: Optional[List[str]] = None
    reference_role: Optional[str] = None
    prompt_source: Optional[str] = None
    prompt_optimized: Optional[str] = None
    # 文本资产
    body: Optional[str] = None
    text_stats: Optional[Dict[str, Any]] = None
    inspection_status: Optional[str] = None
    inspection: Optional[Dict[str, Any]] = None
    visual_identity: Optional[Dict[str, Any]] = None
    reference_capabilities: Optional[Dict[str, Any]] = None
    usage_count: Optional[int] = None
    voice_id: Optional[str] = None


class AssetIdentifyRequest(BaseModel):
    """手动标识上传资产的请求体（前端资产面板调用）。"""
    asset_kind: str
    name: str
    story_entity_name: Optional[str] = None
    # 角色声音画像：标识角色时可直接指定音色
    voice_id: Optional[str] = None
    # 标识为角色时，用 vision LLM 提取身份指纹写 visual_identity（汇聚建卡）
    extract_identity: bool = False


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
