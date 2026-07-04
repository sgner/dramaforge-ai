"""provider 数据迁移脚本测试。"""
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.database import Base
from app.models import MediaProviderConfig, LLMProviderConfig, ProviderConfig
from scripts.migrate_providers import migrate


@pytest.fixture
def db():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(bind=engine)
    Session = sessionmaker(bind=engine)
    session = Session()
    try:
        yield session
    finally:
        session.close()


def test_migrate_media_only(db):
    """media 表有数据，llm 表空 → 全迁到 provider_configs。"""
    db.add(MediaProviderConfig(
        provider_id="custom-api", name="ZZ",
        base_url="https://ai.t8star.org/v1", api_key="sk-abc1234567",
        protocol="openai", enabled=True,
        chat_models_json='["gpt-4o", "deepseek-v3"]',
        image_models_json='["dall-e-3"]', video_models_json='[]',
    ))
    db.commit()

    migrate(db)

    rows = db.query(ProviderConfig).all()
    assert len(rows) == 1
    r = rows[0]
    assert r.provider_id == "custom-api"
    assert r.name == "ZZ"
    assert r.base_url == "https://ai.t8star.org/v1"
    assert r.api_key == "sk-abc1234567"
    assert r.protocol == "openai"
    assert r.enabled is True
    assert r.chat_models_json == '["gpt-4o", "deepseek-v3"]'
    # media 表没有 default_model → 留空
    assert r.default_model == ""


def test_migrate_llm_only(db):
    """llm 表有数据，media 表空 → 全迁，default_model 保留。"""
    db.add(LLMProviderConfig(
        provider_id="openai", base_url="https://api.openai.com/v1",
        api_key="sk-xyz", default_model="gpt-4o-mini",
        chat_models_json='["gpt-4o-mini"]',
    ))
    db.commit()

    migrate(db)

    rows = db.query(ProviderConfig).all()
    assert len(rows) == 1
    r = rows[0]
    assert r.provider_id == "openai"
    assert r.default_model == "gpt-4o-mini"
    assert r.chat_models_json == '["gpt-4o-mini"]'
    # llm 表没有 name/protocol → 默认值
    assert r.name == ""
    assert r.protocol == "openai"


def test_migrate_both_same_provider_id(db):
    """两张表都有同 provider_id → media 字段优先，llm 补 default_model。"""
    db.add(MediaProviderConfig(
        provider_id="dup", name="FromMedia",
        base_url="https://media.url/v1", api_key="sk-media-key",
        protocol="openai", enabled=True, chat_models_json='["a"]',
        image_models_json='[]', video_models_json='[]',
    ))
    db.add(LLMProviderConfig(
        provider_id="dup", base_url="https://llm.url/v1",
        api_key="sk-llm-key", default_model="gpt-4o",
        chat_models_json='["a", "b"]',
    ))
    db.commit()

    migrate(db)

    rows = db.query(ProviderConfig).all()
    assert len(rows) == 1
    r = rows[0]
    # media 优先
    assert r.name == "FromMedia"
    assert r.base_url == "https://media.url/v1"
    assert r.api_key == "sk-media-key"
    # llm 补 default_model
    assert r.default_model == "gpt-4o"


def test_migrate_idempotent(db):
    """重复迁移不会产生重复行。"""
    db.add(MediaProviderConfig(
        provider_id="x", base_url="https://x", api_key="k",
        protocol="openai", enabled=True, chat_models_json='[]',
        image_models_json='[]', video_models_json='[]',
    ))
    db.commit()

    migrate(db)
    migrate(db)  # 第二次

    assert db.query(ProviderConfig).count() == 1
