"""TDD: 关键外键必须有索引，否则大表查询是全表扫描。

回归性能问题：进入首页 / 打开项目时 3-10s。
根因：nodes.project_id / connections.project_id / assets.project_id /
agent_steps.task_id / agent_tasks.project_id 没有索引，外键查找走全表扫描。
"""
import pytest
from sqlalchemy import inspect
from sqlalchemy.pool import StaticPool
from sqlalchemy import create_engine

from app.database import Base


def _make_engine():
    return create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )


def _has_column_index(inspector, table: str, column: str) -> bool:
    """检查表上是否有包含指定列的索引（不限索引名）。"""
    for idx in inspector.get_indexes(table):
        cols = [c.lower() for c in idx["column_names"]]
        if column.lower() in cols:
            return True
    return False


def test_node_project_id_has_index():
    """nodes.project_id 必须有索引。"""
    from app import models  # noqa: F401
    engine = _make_engine()
    Base.metadata.create_all(bind=engine)
    inspector = inspect(engine)
    indexes = {idx["name"] for idx in inspector.get_indexes("nodes")}
    assert _has_column_index(inspector, "nodes", "project_id"), (
        f"nodes.project_id 缺少索引，外键查询会全表扫描。索引列表: {indexes}"
    )


def test_asset_project_id_has_index():
    """assets.project_id 必须有索引。"""
    from app import models  # noqa: F401
    engine = _make_engine()
    Base.metadata.create_all(bind=engine)
    inspector = inspect(engine)
    indexes = {idx["name"] for idx in inspector.get_indexes("assets")}
    assert _has_column_index(inspector, "assets", "project_id"), (
        f"assets.project_id 缺少索引。索引列表: {indexes}"
    )


def test_connection_project_id_has_index():
    """connections.project_id 必须有索引。"""
    from app import models  # noqa: F401
    engine = _make_engine()
    Base.metadata.create_all(bind=engine)
    inspector = inspect(engine)
    indexes = {idx["name"] for idx in inspector.get_indexes("connections")}
    assert _has_column_index(inspector, "connections", "project_id"), (
        f"connections.project_id 缺少索引。索引列表: {indexes}"
    )


def test_agent_step_task_id_has_index():
    """agent_steps.task_id 必须有索引。"""
    from app import models  # noqa: F401
    engine = _make_engine()
    Base.metadata.create_all(bind=engine)
    inspector = inspect(engine)
    indexes = {idx["name"] for idx in inspector.get_indexes("agent_steps")}
    assert _has_column_index(inspector, "agent_steps", "task_id"), (
        f"agent_steps.task_id 缺少索引。索引列表: {indexes}"
    )


def test_agent_task_project_id_has_index():
    """agent_tasks.project_id 必须有索引。"""
    from app import models  # noqa: F401
    engine = _make_engine()
    Base.metadata.create_all(bind=engine)
    inspector = inspect(engine)
    indexes = {idx["name"] for idx in inspector.get_indexes("agent_tasks")}
    assert _has_column_index(inspector, "agent_tasks", "project_id"), (
        f"agent_tasks.project_id 缺少索引。索引列表: {indexes}"
    )


def test_migrate_indexes_creates_missing_on_existing_db(tmp_path, monkeypatch):
    """迁移函数必须为已有数据库补建索引（idempotent）。"""
    from app.database import _migrate_performance_indexes
    import app.models  # noqa: F401
    from app import database as db_module

    # 临时数据库，先 create_all 建空表（不建索引）
    test_db = tmp_path / "test.db"
    test_engine = create_engine(f"sqlite:///{test_db}")
    Base.metadata.create_all(bind=test_engine)
    # 手动 DROP 索引模拟老库
    with test_engine.begin() as conn:
        for idx_name in [
            "ix_nodes_project_id", "ix_connections_project_id",
            "ix_assets_project_id", "ix_agent_tasks_project_id",
            "ix_agent_steps_task_id",
        ]:
            conn.exec_driver_sql(f'DROP INDEX IF EXISTS "{idx_name}"')

    # 把模块级 engine 替换成测试 engine，让 _migrate_performance_indexes 写入测试库
    monkeypatch.setattr(db_module, "engine", test_engine)
    # 调用迁移：应该全部补建
    _migrate_performance_indexes()

    inspector = inspect(test_engine)
    assert _has_column_index(inspector, "nodes", "project_id")
    assert _has_column_index(inspector, "assets", "project_id")
    assert _has_column_index(inspector, "connections", "project_id")
    assert _has_column_index(inspector, "agent_steps", "task_id")
    assert _has_column_index(inspector, "agent_tasks", "project_id")

    # 再次调用应该幂等（不抛错）
    _migrate_performance_indexes()
