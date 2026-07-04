"""ORM 模型"""
from sqlalchemy import Column, String, Integer, Float, Text, Boolean, DateTime, ForeignKey, JSON
from sqlalchemy.orm import relationship
from datetime import datetime

from .database import Base


class Project(Base):
    """画布项目"""
    __tablename__ = "projects"

    id = Column(String, primary_key=True)
    name = Column(String, nullable=False, default="Untitled")
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    # 视口状态
    viewport_x = Column(Float, default=0.0)
    viewport_y = Column(Float, default=0.0)
    viewport_scale = Column(Integer, default=100)  # 存 100 = 1.0

    nodes = relationship("Node", back_populates="project", cascade="all, delete-orphan")
    connections = relationship("Connection", back_populates="project", cascade="all, delete-orphan")
    assets = relationship("Asset", back_populates="project", cascade="all, delete-orphan")


class Node(Base):
    """画布节点"""
    __tablename__ = "nodes"

    id = Column(String, primary_key=True)
    project_id = Column(String, ForeignKey("projects.id", ondelete="CASCADE"), nullable=False)
    type = Column(String, nullable=False)
    x = Column(Float, default=0.0)
    y = Column(Float, default=0.0)
    w = Column(Integer, default=200)
    h = Column(Integer, default=200)

    # 业务字段（全部用 JSON 容纳节点复杂属性，schema-less）
    data = Column(JSON, default=dict)

    project = relationship("Project", back_populates="nodes")


class Connection(Base):
    """画布连接线"""
    __tablename__ = "connections"

    id = Column(String, primary_key=True)
    project_id = Column(String, ForeignKey("projects.id", ondelete="CASCADE"), nullable=False)
    from_node = Column(String, nullable=False)
    to_node = Column(String, nullable=False)
    from_port = Column(String, default="out")
    to_port = Column(String, default="in")

    project = relationship("Project", back_populates="connections")


class Asset(Base):
    """资产库条目（图片 / 视频 / 文本 / 失败记录）"""
    __tablename__ = "assets"

    id = Column(String, primary_key=True)
    project_id = Column(String, ForeignKey("projects.id", ondelete="CASCADE"), nullable=True)
    kind = Column(String, nullable=False)  # image / video / text
    asset_kind = Column(String, nullable=True)  # character / prop / scene / shot / novel / script
    title = Column(String, default="")
    name = Column(String, default="")
    url = Column(Text, nullable=True)
    prompt = Column(Text, nullable=True)
    provider_id = Column(String, nullable=True)
    provider_name = Column(String, nullable=True)
    model_id = Column(String, nullable=True)
    failed = Column(Boolean, default=False)
    error = Column(Text, nullable=True)
    generating = Column(Boolean, default=False)
    extra = Column(JSON, default=dict)  # 其他扩展字段
    created_at = Column(DateTime, default=datetime.utcnow)

    project = relationship("Project", back_populates="assets")


# ========================
# Agent 模型（v1.0 改造新增）
# ========================

class AgentTask(Base):
    """Agent 任务：一次完整的视频创作会话。"""
    __tablename__ = "agent_tasks"

    id = Column(String, primary_key=True)
    project_id = Column(String, ForeignKey("projects.id"), nullable=True)
    user_goal = Column(Text, nullable=True)
    status = Column(String, default="pending")  # pending | running | paused | done | failed
    plan = Column(JSON, default=list)            # 计划步骤
    artifacts = Column(JSON, default=dict)        # 已生成资产 {characters: [], props: [], ...}
    pending_response = Column(JSON, nullable=True)  # 等待用户输入
    total_cost_usd = Column(Float, default=0.0)
    total_tokens = Column(Integer, default=0)
    max_steps = Column(Integer, default=30)
    skip_confirm = Column(Boolean, default=False)  # 本任务是否已勾选免审
    # LLM 选择（仅 provider_id / model_id；key 不入库）
    llm_provider_id = Column(String(64), nullable=True, default=None)
    llm_model_id = Column(String(128), nullable=True, default=None)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    steps = relationship("AgentStep", back_populates="task", cascade="all, delete-orphan")

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "project_id": self.project_id,
            "user_goal": self.user_goal,
            "status": self.status,
            "plan": self.plan or [],
            "artifacts": self.artifacts or {},
            "pending_response": self.pending_response,
            "total_cost_usd": self.total_cost_usd or 0.0,
            "total_tokens": self.total_tokens or 0,
            "max_steps": self.max_steps or 30,
            "skip_confirm": bool(self.skip_confirm),
            "llm_provider_id": self.llm_provider_id,
            "llm_model_id": self.llm_model_id,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
        }

    @classmethod
    def from_dict(cls, d: dict) -> "AgentTask":
        return cls(
            id=d["id"],
            project_id=d.get("project_id"),
            user_goal=d.get("user_goal"),
            status=d.get("status", "pending"),
            plan=d.get("plan", []),
            artifacts=d.get("artifacts", {}),
            pending_response=d.get("pending_response"),
            total_cost_usd=d.get("total_cost_usd", 0.0),
            total_tokens=d.get("total_tokens", 0),
            max_steps=d.get("max_steps", 30),
            skip_confirm=bool(d.get("skip_confirm", False)),
            llm_provider_id=d.get("llm_provider_id"),
            llm_model_id=d.get("llm_model_id"),
        )


class AgentStep(Base):
    """Agent 执行步骤记录。"""
    __tablename__ = "agent_steps"

    id = Column(String, primary_key=True)
    task_id = Column(String, ForeignKey("agent_tasks.id"), nullable=False)
    step_number = Column(Integer, default=0)
    thought = Column(Text, nullable=True)
    action = Column(JSON, default=dict)      # {tool, params}
    observation = Column(JSON, default=dict)  # {success, result/error}
    status = Column(String, default="pending")  # pending | running | success | failed | retrying | skipped
    cost_usd = Column(Float, default=0.0)
    tokens = Column(Integer, default=0)
    started_at = Column(DateTime, default=datetime.utcnow)
    finished_at = Column(DateTime, nullable=True)

    task = relationship("AgentTask", back_populates="steps")

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "task_id": self.task_id,
            "step_number": self.step_number,
            "thought": self.thought,
            "action": self.action or {},
            "observation": self.observation or {},
            "status": self.status,
            "cost_usd": self.cost_usd or 0.0,
            "tokens": self.tokens or 0,
            "started_at": self.started_at.isoformat() if self.started_at else None,
            "finished_at": self.finished_at.isoformat() if self.finished_at else None,
        }


class LLMProviderConfig(Base):
    """[DEPRECATED] 已迁移到 ProviderConfig 统一表。保留此类仅作数据回滚兜底，
    下一版清理时删除。新代码不要用。

    Agent LLM provider 配置（前端 ApiSettingsModal 写入，后端实际用）。
    与 env 的关系：DB 行优先于 env，env 是 fallback。
    api_key 字段为明文（dev 工具暂不加密；生产应改为加密存储）。
    """
    __tablename__ = "llm_provider_configs"

    id = Column(Integer, primary_key=True, autoincrement=True)
    provider_id = Column(String(64), nullable=False, unique=True)  # 如 "openai" / "deepseek"
    base_url = Column(String(512), nullable=False)
    api_key = Column(Text, nullable=False)
    default_model = Column(String(128), nullable=False)
    # 模型列表 JSON (e.g. ["gpt-4o-mini", "gpt-4o"])，供 UI 展示
    chat_models_json = Column(Text, default="[]")
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    def to_dict(self, mask_key: bool = True) -> dict:
        """默认脱敏 api_key（GET 列表时不暴露明文 key，只回显最后 4 位）。"""
        key = self.api_key or ""
        masked = (key[:4] + "***" + key[-4:]) if (len(key) > 8 and mask_key) else key
        return {
            "id": self.id,
            "provider_id": self.provider_id,
            "base_url": self.base_url,
            "api_key": masked,
            "default_model": self.default_model,
            "chat_models": _parse_json_list(self.chat_models_json),
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
        }

    def to_internal_dict(self) -> dict:
        """内部使用：含明文 api_key，供 LLMFactory 用。"""
        return {
            "id": self.id,
            "provider_id": self.provider_id,
            "base_url": self.base_url,
            "api_key": self.api_key,
            "default_model": self.default_model,
        }


class MediaProviderConfig(Base):
    """[DEPRECATED] 已迁移到 ProviderConfig 统一表。保留此类仅作数据回滚兜底，
    下一版清理时删除。新代码不要用。

    画布媒体供应商配置（图片 / 视频 / 音频生成）。
    与 LLMProviderConfig 的关系：
    - LLMProviderConfig 仅给 agent LLM 调用用（chat-only）
    - MediaProviderConfig 给画布媒体生成用（image / video / audio + 一些 chat 辅助）

    api_key 字段为明文（dev 工具暂不加密；生产应改为加密存储）。
    GET 列表时脱敏（保留前 4 + 后 4 位）。
    """
    __tablename__ = "media_provider_configs"

    id = Column(Integer, primary_key=True, autoincrement=True)
    provider_id = Column(String(64), nullable=False, unique=True)  # 如 "openai" / "nano-banana" / "kling"
    name = Column(String(128), nullable=False, default="")
    base_url = Column(String(512), nullable=False)
    api_key = Column(Text, nullable=False, default="")
    protocol = Column(String(32), nullable=False, default="openai")  # openai / gemini / runninghub / volcengine
    enabled = Column(Boolean, default=True)
    # 模型列表 JSON（按类别）
    image_models_json = Column(Text, default="[]")
    chat_models_json = Column(Text, default="[]")
    video_models_json = Column(Text, default="[]")
    # 扩展配置（volcengine 区域、runninghub workflow 等）
    extra_config_json = Column(Text, default="{}")
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    def to_dict(self, mask_key: bool = True) -> dict:
        """默认脱敏 api_key。"""
        key = self.api_key or ""
        masked = (key[:4] + "***" + key[-4:]) if (len(key) > 8 and mask_key) else key
        return {
            "id": self.id,
            "provider_id": self.provider_id,
            "name": self.name,
            "base_url": self.base_url,
            "api_key": masked,
            "protocol": self.protocol,
            "enabled": bool(self.enabled),
            "image_models": _parse_json_list(self.image_models_json),
            "chat_models": _parse_json_list(self.chat_models_json),
            "video_models": _parse_json_list(self.video_models_json),
            "extra_config": _parse_json_obj(self.extra_config_json),
            "has_key": bool(self.api_key),
            "key_preview": masked if masked and masked != key else "",
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
        }

    def to_internal_dict(self) -> dict:
        """内部使用：含明文 api_key，供后端调供应商用。"""
        return {
            "id": self.id,
            "provider_id": self.provider_id,
            "name": self.name,
            "base_url": self.base_url,
            "api_key": self.api_key,
            "protocol": self.protocol,
            "enabled": bool(self.enabled),
            "image_models": _parse_json_list(self.image_models_json),
            "chat_models": _parse_json_list(self.chat_models_json),
            "video_models": _parse_json_list(self.video_models_json),
            "extra_config": _parse_json_obj(self.extra_config_json),
        }


class ProviderConfig(Base):
    """统一 provider 配置（合并 LLMProviderConfig + MediaProviderConfig）。

    agent runtime 和 canvas 媒体生成都读这张表，用户配一次即可在两处使用。
    api_key 明文存储（dev 工具暂不加密；生产应改加密）。
    GET 列表脱敏（前 4 + *** + 后 4）。
    """
    __tablename__ = "provider_configs"

    id = Column(Integer, primary_key=True, autoincrement=True)
    provider_id = Column(String(64), nullable=False, unique=True)
    name = Column(String(128), nullable=False, default="")
    base_url = Column(String(512), nullable=False)
    api_key = Column(Text, nullable=False, default="")
    protocol = Column(String(32), nullable=False, default="openai")
    enabled = Column(Boolean, default=True)
    # agent LLM 默认模型（LLMProviderConfig 原有，MediaProviderConfig 没有）
    default_model = Column(String(128), nullable=False, default="")
    # 模型列表 JSON（按类别）
    image_models_json = Column(Text, default="[]")
    chat_models_json = Column(Text, default="[]")
    video_models_json = Column(Text, default="[]")
    extra_config_json = Column(Text, default="{}")
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    def to_dict(self, mask_key: bool = True) -> dict:
        key = self.api_key or ""
        masked = (key[:4] + "***" + key[-4:]) if (len(key) > 8 and mask_key) else key
        return {
            "id": self.id,
            "provider_id": self.provider_id,
            "name": self.name,
            "base_url": self.base_url,
            "api_key": masked,
            "protocol": self.protocol,
            "enabled": bool(self.enabled),
            "default_model": self.default_model or "",
            "image_models": _parse_json_list(self.image_models_json),
            "chat_models": _parse_json_list(self.chat_models_json),
            "video_models": _parse_json_list(self.video_models_json),
            "extra_config": _parse_json_obj(self.extra_config_json),
            "has_key": bool(self.api_key),
            "key_preview": masked if masked and masked != key else "",
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
        }

    def to_internal_dict(self) -> dict:
        """含明文 api_key，供后端调供应商用。"""
        return {
            "id": self.id,
            "provider_id": self.provider_id,
            "name": self.name,
            "base_url": self.base_url,
            "api_key": self.api_key,
            "protocol": self.protocol,
            "enabled": bool(self.enabled),
            "default_model": self.default_model or "",
            "image_models": _parse_json_list(self.image_models_json),
            "chat_models": _parse_json_list(self.chat_models_json),
            "video_models": _parse_json_list(self.video_models_json),
            "extra_config": _parse_json_obj(self.extra_config_json),
        }


def _parse_json_list(raw: str | None) -> list:
    if not raw:
        return []
    try:
        import json
        v = json.loads(raw)
        return v if isinstance(v, list) else []
    except Exception:
        return []


def _parse_json_obj(raw: str | None) -> dict:
    if not raw:
        return {}
    try:
        import json
        v = json.loads(raw)
        return v if isinstance(v, dict) else {}
    except Exception:
        return {}
