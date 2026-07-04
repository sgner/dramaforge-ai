"""ProviderConfig 统一模型测试。"""
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.database import Base
from app.models import ProviderConfig


@pytest.fixture
def db():
    """in-memory sqlite，每个 test 独立 DB，不污染真实 dramaforge.db。"""
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(bind=engine)
    Session = sessionmaker(bind=engine)
    session = Session()
    try:
        yield session
    finally:
        session.close()


def test_provider_config_can_be_created_and_read(db):
    """能插入一行并读回来，to_internal_dict 含明文 key。"""
    row = ProviderConfig(
        provider_id="test-provider",
        name="Test",
        base_url="https://example.com/v1",
        api_key="sk-test-1234567890abcdef",
        protocol="openai",
        enabled=True,
        default_model="gpt-4o-mini",
        chat_models_json='["gpt-4o-mini", "gpt-4o"]',
        image_models_json='["dall-e-3"]',
        video_models_json='[]',
        extra_config_json='{}',
    )
    db.add(row)
    db.commit()
    db.refresh(row)

    out = row.to_dict(mask_key=True)
    assert out["provider_id"] == "test-provider"
    assert out["name"] == "Test"
    assert out["api_key"] == "sk-t***cdef"  # 脱敏
    assert out["chat_models"] == ["gpt-4o-mini", "gpt-4o"]
    assert out["default_model"] == "gpt-4o-mini"

    internal = row.to_internal_dict()
    assert internal["api_key"] == "sk-test-1234567890abcdef"  # 明文
    assert internal["protocol"] == "openai"
    assert internal["enabled"] is True


def test_provider_config_default_values(db):
    """新行有合理默认值。"""
    row = ProviderConfig(
        provider_id="min",
        base_url="https://x.com",
        api_key="k",
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    out = row.to_dict()
    assert out["name"] == ""
    assert out["protocol"] == "openai"
    assert out["enabled"] is True
    assert out["default_model"] == ""
    assert out["chat_models"] == []
    assert out["image_models"] == []
    assert out["video_models"] == []
    assert out["extra_config"] == {}
