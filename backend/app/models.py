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
