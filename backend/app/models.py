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
