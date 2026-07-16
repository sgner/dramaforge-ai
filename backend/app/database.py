"""SQLite 数据库 — SQLAlchemy ORM"""
import logging
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.orm import sessionmaker, declarative_base

logger = logging.getLogger("dramaforge.db")

BASE_DIR = __import__('pathlib').Path(__file__).resolve().parent.parent
DB_PATH = BASE_DIR / "dramaforge.db"

SQLALCHEMY_DATABASE_URL = f"sqlite:///{DB_PATH}"

engine = create_engine(
    SQLALCHEMY_DATABASE_URL,
    connect_args={"check_same_thread": False},
)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


def init_db():
    """建表"""
    from . import models  # noqa: F401
    Base.metadata.create_all(bind=engine)
    _migrate_asset_intelligence_columns()
    _migrate_performance_indexes()


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


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
