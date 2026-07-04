"""Tests for unified /api/providers CRUD (Plan 5 UI merge).

合并自 test_llm_providers_crud.py + test_media_providers.py 的覆盖。
本 task 只测 GET endpoints，PUT/DELETE 留给 Task 2/3。
"""
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app import app
from app.database import get_db, Base
from app.models import ProviderConfig


@pytest.fixture
def db_session():
    """In-memory sqlite — 不污染真实 DB（Plan 1 Global Constraint #1）"""
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine)
    session = Session()
    yield session
    session.close()
    engine.dispose()


@pytest.fixture
def client(db_session):
    def _override():
        try:
            yield db_session
        finally:
            pass
    app.dependency_overrides[get_db] = _override
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.clear()


def test_list_providers_empty(client):
    """空表返空 list"""
    r = client.get("/api/providers")
    assert r.status_code == 200
    assert r.json() == []


def test_list_providers_returns_all(client, db_session):
    """插入 2 行后 GET 返 2 行，按 provider_id 排序"""
    db_session.add(ProviderConfig(
        provider_id="custom-api", base_url="https://api.example.com",
        api_key="sk-1234567890", chat_models_json='["gpt-4o"]', enabled=True,
    ))
    db_session.add(ProviderConfig(
        provider_id="nano-banana", base_url="https://banana.example.com",
        api_key="", chat_models_json='[]', image_models_json='["banana-v1"]',
        protocol="gemini", enabled=True,
    ))
    db_session.commit()
    r = client.get("/api/providers")
    assert r.status_code == 200
    data = r.json()
    assert len(data) == 2
    assert data[0]["provider_id"] == "custom-api"
    assert data[1]["provider_id"] == "nano-banana"
    # api_key 脱敏
    assert "sk-1" in data[0]["api_key"]  # 前 4 位
    assert "7890" in data[0]["api_key"]  # 后 4 位
    assert "***" in data[0]["api_key"]


def test_get_provider_success(client, db_session):
    """GET /api/providers/{id} 返单个 provider"""
    db_session.add(ProviderConfig(
        provider_id="custom-api", base_url="https://api.example.com",
        api_key="sk-abc", chat_models_json='["gpt-4o"]', default_model="gpt-4o",
    ))
    db_session.commit()
    r = client.get("/api/providers/custom-api")
    assert r.status_code == 200
    data = r.json()
    assert data["provider_id"] == "custom-api"
    assert data["default_model"] == "gpt-4o"
    assert data["chat_models"] == ["gpt-4o"]


def test_get_provider_404(client):
    """不存在的 provider 返 404"""
    r = client.get("/api/providers/nonexistent")
    assert r.status_code == 404
