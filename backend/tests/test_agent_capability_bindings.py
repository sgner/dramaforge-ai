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


def test_resolve_capability_bindings_accepts_and_validates_ref_model(db_session):
    """refModelId 可选：存在时必须在 provider 模型列表里，否则报配置错误。"""
    _provider(db_session)
    db_session.add(UserPreference(key="model_bindings", value_json=json.dumps([
        {"kind": "llm", "providerId": "p1", "modelId": "chat-1"},
        {"kind": "image", "providerId": "p1", "modelId": "image-1", "refModelId": "image-i2i"},
    ])))
    db_session.commit()
    # image-i2i 不在列表 → 报错
    with pytest.raises(CapabilityConfigurationError, match="ref model"):
        resolve_capability_bindings(db_session)

    # 加进列表 → 通过且保留 ref_model_id
    row = db_session.query(ProviderConfig).filter_by(provider_id="p1").first()
    row.image_models_json = json.dumps(["image-1", "image-i2i"])
    db_session.commit()
    bindings = resolve_capability_bindings(db_session)
    assert bindings["image"]["ref_model_id"] == "image-i2i"
    assert bindings["llm"].get("ref_model_id") is None


@pytest.mark.asyncio
async def test_media_service_uses_ref_model_when_refs_present(db_session):
    """DatabaseMediaService：有参考图时用 ref_model_id，没有时用 model_id。"""
    from app.agent.media_service import DatabaseMediaService, MediaRequest

    _provider(db_session)
    svc = DatabaseMediaService(db_session, capability_bindings={
        "image": {"provider_id": "p1", "model_id": "image-1", "ref_model_id": "image-i2i"},
    })
    row = db_session.query(ProviderConfig).filter_by(provider_id="p1").first()
    row.image_models_json = json.dumps(["image-1", "image-i2i"])
    db_session.commit()

    no_refs = svc._provider(MediaRequest(kind="image", prompt="p"))
    assert no_refs["selected_model"] == "image-1"
    with_refs = svc._provider(MediaRequest(kind="image", prompt="p", reference_urls=["https://x/ref.png"]))
    assert with_refs["selected_model"] == "image-i2i"
