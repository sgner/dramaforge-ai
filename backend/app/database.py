"""SQLite 数据库 — SQLAlchemy ORM"""
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.orm import sessionmaker, declarative_base

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


def _migrate_asset_intelligence_columns():
    """Add new asset-intelligence columns to existing local SQLite databases."""
    required = {
        "origin": "VARCHAR NOT NULL DEFAULT 'generated'",
        "source_asset_id": "VARCHAR",
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


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
