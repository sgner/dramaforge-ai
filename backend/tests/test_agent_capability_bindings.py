import json

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import Base
from app.models import ProviderConfig, UserPreference
from app.agent.capabilities import CapabilityConfigurationError, resolve_capability_bindings


@pytest.fixture
def db_session():
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    session = sessionmaker(bind=engine)()
    yield session
    session.close()
    engine.dispose()


def _provider(session, provider_id="p1"):
    session.add(ProviderConfig(
        provider_id=provider_id,
        name=provider_id,
        base_url="https://example.test/v1",
        api_key="secret",
        enabled=True,
        chat_models_json=json.dumps(["chat-1"]),
        image_models_json=json.dumps(["image-1"]),
        video_models_json=json.dumps(["video-1"]),
    ))
    session.commit()


def test_resolve_capability_bindings_requires_llm_binding(db_session):
    _provider(db_session)
    db_session.add(UserPreference(key="model_bindings", value_json=json.dumps([
        {"kind": "image", "providerId": "p1", "modelId": "image-1"},
        {"kind": "video", "providerId": "p1", "modelId": "video-1"},
    ])))
    db_session.commit()

    with pytest.raises(CapabilityConfigurationError, match="llm"):
        resolve_capability_bindings(db_session)


def test_resolve_capability_bindings_uses_exact_saved_provider_and_model(db_session):
    _provider(db_session)
    db_session.add(UserPreference(key="model_bindings", value_json=json.dumps([
        {"kind": "llm", "providerId": "p1", "modelId": "chat-1"},
        {"kind": "image", "providerId": "p1", "modelId": "image-1"},
        {"kind": "video", "providerId": "p1", "modelId": "video-1"},
    ])))
    db_session.commit()

    result = resolve_capability_bindings(db_session)

    assert result["llm"] == {"provider_id": "p1", "model_id": "chat-1"}
    assert result["image"] == {"provider_id": "p1", "model_id": "image-1"}
    assert result["video"] == {"provider_id": "p1", "model_id": "video-1"}


def test_resolve_capability_bindings_rejects_model_not_declared_by_provider(db_session):
    _provider(db_session)
    db_session.add(UserPreference(key="model_bindings", value_json=json.dumps([
        {"kind": "llm", "providerId": "p1", "modelId": "old-default"},
    ])))
    db_session.commit()

    with pytest.raises(CapabilityConfigurationError, match="old-default"):
        resolve_capability_bindings(db_session)
