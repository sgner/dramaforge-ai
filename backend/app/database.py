"""SQLite 数据库 — SQLAlchemy ORM"""
import logging
import os
from sqlalchemy import create_engine, inspect, text, event
from sqlalchemy.orm import sessionmaker, declarative_base

logger = logging.getLogger("dramaforge.db")

BASE_DIR = __import__('pathlib').Path(__file__).resolve().parent.parent
# 关键：支持用环境变量覆盖 DB 路径。测试套件（tests/conftest.py）会把它指向
# 独立的测试库文件——此前测试直连本开发库，test_media_providers /
# test_video_dev_fallback 里的 query(ProviderConfig).delete() 和 conftest 的
# DELETE FROM drama_tasks 会把用户真实 API 配置和任务记录清空。
DB_PATH = os.environ.get("DRAMAFORGE_DB_PATH") or str(BASE_DIR / "dramaforge.db")

SQLALCHEMY_DATABASE_URL = f"sqlite:///{DB_PATH}"

engine = create_engine(
    SQLALCHEMY_DATABASE_URL,
    connect_args={"check_same_thread": False},
)

# 启用 SQLite WAL 模式 + 优化 pragma
# WAL 模式下读不阻塞写、写不阻塞读，显著缓解高并发场景下的锁竞争
# （如 TaskList 轮询读 + 保存 API 配置写同时发生时不再卡顿）。
# busy_timeout 让写操作在锁冲突时等待 5s 而不是立即报错。
@event.listens_for(engine, "connect")
def _set_sqlite_pragma(dbapi_connection, connection_record):
    cursor = dbapi_connection.cursor()
    cursor.execute("PRAGMA journal_mode=WAL")
    cursor.execute("PRAGMA synchronous=NORMAL")
    cursor.execute("PRAGMA busy_timeout=5000")
    cursor.close()

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


def init_db():
    """建表"""
    from . import models  # noqa: F401
    Base.metadata.create_all(bind=engine)
    _migrate_asset_intelligence_columns()
    _migrate_performance_indexes()
    _migrate_agent_conversation_columns()
    _migrate_connection_data_column()


def _migrate_connection_data_column():
    """Add data column to connections for asset reference orchestration.

    连线 data 字段携带 asset_ref 语义，用于画布连线传递资产引用。
    """
    existing = {column["name"] for column in inspect(engine).get_columns("connections")}
    if "data" in existing:
        return
    with engine.begin() as connection:
        connection.execute(text('ALTER TABLE connections ADD COLUMN "data" JSON'))


def _migrate_performance_indexes():
    """为高频外键列补建索引。

    回归性能问题：进入首页 / 打开项目 3-10s。根因：nodes.project_id、
    connections.project_id、assets.project_id、agent_steps.task_id、
    agent_tasks.project_id 没有索引，外键查找走全表扫描。

    `create_all` 只对全新数据库建索引；已有数据库需要本迁移补建。
    索引名约定：ix_<table>_<column>（与 SQLAlchemy 自动生成一致）。
    """
    required_indexes = [
        ("nodes", "project_id"),
        ("connections", "project_id"),
        ("assets", "project_id"),
        ("agent_tasks", "project_id"),
        ("agent_steps", "task_id"),
    ]
    inspector = inspect(engine)
    with engine.begin() as connection:
        for table, column in required_indexes:
            index_name = f"ix_{table}_{column}"
            existing = {idx["name"] for idx in inspector.get_indexes(table)}
            if index_name in existing:
                continue
            # 表存在性检查（老库可能还没建对应表，跳过）
            if table not in inspector.get_table_names():
                continue
            # 列存在性检查
            cols = {c["name"] for c in inspector.get_columns(table)}
            if column not in cols:
                continue
            connection.execute(text(
                f'CREATE INDEX IF NOT EXISTS "{index_name}" ON "{table}" ("{column}")'
            ))
            logger.info(f"[index] created {index_name} on {table}({column})")


def _migrate_asset_intelligence_columns():
    """Add new asset-intelligence columns to existing local SQLite databases."""
    required = {
        "origin": "VARCHAR NOT NULL DEFAULT 'generated'",
        "source_asset_id": "VARCHAR",
        "status": "VARCHAR NOT NULL DEFAULT 'uploaded'",
        "version": "INTEGER NOT NULL DEFAULT 1",
        "derived_from": "JSON",
        "reference_role": "VARCHAR",
        "prompt_source": "TEXT",
        "prompt_optimized": "TEXT",
        "inspection_status": "VARCHAR NOT NULL DEFAULT 'pending'",
        "inspection": "JSON",
        "visual_identity": "JSON",
        "reference_capabilities": "JSON",
        "usage_count": "INTEGER NOT NULL DEFAULT 0",
    }
    existing = {column["name"] for column in inspect(engine).get_columns("assets")}
    missing = [(name, definition) for name, definition in required.items() if name not in existing]
    if not missing:
        return
    with engine.begin() as connection:
        for name, definition in missing:
            connection.execute(text(f'ALTER TABLE assets ADD COLUMN "{name}" {definition}'))
        connection.execute(text("""
            UPDATE assets
            SET status = CASE
                WHEN failed = 1 THEN 'failed'
                WHEN generating = 1 THEN 'processing'
                WHEN url IS NOT NULL AND TRIM(url) != '' THEN 'ready'
                ELSE 'pending'
            END
            WHERE status IS NULL OR status = 'uploaded'
        """))
        connection.execute(text("""
            UPDATE assets
            SET reference_role = COALESCE(reference_role, asset_kind)
            WHERE reference_role IS NULL OR TRIM(reference_role) = ''
        """))
        connection.execute(text("""
            UPDATE assets
            SET derived_from = CASE
                WHEN derived_from IS NULL AND source_asset_id IS NOT NULL THEN json_array(source_asset_id)
                ELSE derived_from
            END
            WHERE derived_from IS NULL
        """))


def _migrate_agent_conversation_columns():
    """Add conversation memory columns to agent_tasks for multi-turn dialogue.

    - conversation_turns: JSON list of {turn, user_message, agent_summary, step_range}
    - memory_summary: TEXT compressed summary of early steps (token budget control)
    """
    existing = {column["name"] for column in inspect(engine).get_columns("agent_tasks")}
    missing = {
        "conversation_turns": "JSON",
        "memory_summary": "TEXT",
    }
    to_add = [(name, definition) for name, definition in missing.items() if name not in existing]
    if not to_add:
        return
    with engine.begin() as connection:
        for name, definition in to_add:
            connection.execute(text(f'ALTER TABLE agent_tasks ADD COLUMN "{name}" {definition}'))


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
