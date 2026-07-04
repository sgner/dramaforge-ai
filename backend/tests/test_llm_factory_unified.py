"""load_llm_configs 读 ProviderConfig 表的测试。"""
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.database import Base
from app.models import ProviderConfig
from app.agent.llm_factory import load_llm_configs, LLMProviderConfig


@pytest.fixture
def db():
    """in-memory sqlite，每个 test 独立 DB。"""
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(bind=engine)
    Session = sessionmaker(bind=engine)
    session = Session()
    try:
        yield session
    finally:
        session.close()


def test_load_from_provider_config(db):
    """ProviderConfig 表有 enabled+chat_models 的行 → 读出来转成 LLMProviderConfig。"""
    db.add(ProviderConfig(
        provider_id="custom-api", name="ZZ",
        base_url="https://ai.t8star.org/v1", api_key="sk-real-key",
        protocol="openai", enabled=True, default_model="gpt-4o",
        chat_models_json='["gpt-4o", "deepseek-v3"]',
    ))
    db.commit()

    configs = load_llm_configs(db)
    assert len(configs) == 1
    c = configs[0]
    assert isinstance(c, LLMProviderConfig)
    assert c.provider_id == "custom-api"
    assert c.base_url == "https://ai.t8star.org/v1"
    assert c.api_key == "sk-real-key"
    assert c.default_model == "gpt-4o"


def test_filter_disabled(db):
    """enabled=False 的行不读。"""
    db.add(ProviderConfig(
        provider_id="disabled", base_url="https://x", api_key="k",
        protocol="openai", enabled=False, chat_models_json='["a"]',
    ))
    db.add(ProviderConfig(
        provider_id="enabled", base_url="https://y", api_key="k2",
        protocol="openai", enabled=True, chat_models_json='["b"]',
    ))
    db.commit()

    configs = load_llm_configs(db)
    assert len(configs) == 1
    assert configs[0].provider_id == "enabled"


def test_filter_empty_chat_models(db):
    """chat_models 为空的行不读（不能当 LLM 用）。"""
    db.add(ProviderConfig(
        provider_id="no-chat", base_url="https://x", api_key="k",
        protocol="openai", enabled=True, chat_models_json='[]',
        image_models_json='["dall-e-3"]',
    ))
    db.commit()

    configs = load_llm_configs(db)
    assert configs == []


def test_empty_table_returns_empty(db):
    """表空 → 返回 []。"""
    assert load_llm_configs(db) == []
