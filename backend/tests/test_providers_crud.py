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


def test_upsert_provider_create(client):
    """新建 provider"""
    r = client.put("/api/providers/newone", json={
        "name": "New One",
        "base_url": "https://new.example.com",
        "api_key": "sk-newkey",
        "default_model": "new-model",
        "protocol": "openai",
        "enabled": True,
        "chat_models": ["new-model"],
        "image_models": [],
        "video_models": [],
    })
    assert r.status_code == 200
    data = r.json()
    assert data["provider_id"] == "newone"
    assert data["name"] == "New One"
    assert data["default_model"] == "new-model"


def test_upsert_provider_update_full(client, db_session):
    """更新现有 provider 全部字段"""
    db_session.add(ProviderConfig(
        provider_id="custom-api", base_url="https://old.example.com",
        api_key="sk-old", default_model="old-model", chat_models_json='["old"]',
    ))
    db_session.commit()
    r = client.put("/api/providers/custom-api", json={
        "name": "Updated",
        "base_url": "https://new.example.com",
        "api_key": "sk-new",
        "default_model": "new-model",
        "protocol": "openai",
        "enabled": True,
        "chat_models": ["new"],
        "image_models": [],
        "video_models": [],
    })
    assert r.status_code == 200
    data = r.json()
    assert data["name"] == "Updated"
    assert data["default_model"] == "new-model"
    assert data["chat_models"] == ["new"]


def test_upsert_provider_preserves_api_key_when_omitted(client, db_session):
    """api_key 不传 → 保留 DB 原 key（关键测试：用户编辑时没改 key）"""
    db_session.add(ProviderConfig(
        provider_id="custom-api", base_url="https://api.example.com",
        api_key="sk-originalkey",
    ))
    db_session.commit()
    r = client.put("/api/providers/custom-api", json={
        "name": "Renamed",
        "base_url": "https://api.example.com",
        # api_key 不传
        "default_model": "",
        "protocol": "openai",
        "enabled": True,
    })
    assert r.status_code == 200
    # 重新查 DB 确认 key 未变
    row = db_session.query(ProviderConfig).filter_by(provider_id="custom-api").first()
    assert row.api_key == "sk-originalkey"


def test_upsert_provider_preserves_api_key_when_empty_string(client, db_session):
    """api_key 传空字符串 → 保留 DB 原 key（前端表单行为）"""
    db_session.add(ProviderConfig(
        provider_id="custom-api", base_url="https://api.example.com",
        api_key="sk-originalkey",
    ))
    db_session.commit()
    r = client.put("/api/providers/custom-api", json={
        "name": "Renamed",
        "base_url": "https://api.example.com",
        "api_key": "",  # 空字符串视为不传
        "default_model": "",
        "enabled": True,
    })
    assert r.status_code == 200
    row = db_session.query(ProviderConfig).filter_by(provider_id="custom-api").first()
    assert row.api_key == "sk-originalkey"


def test_upsert_provider_422_on_missing_base_url(client):
    """缺 base_url 返 422"""
    r = client.put("/api/providers/foo", json={"name": "no url"})
    assert r.status_code == 422


def test_delete_provider_success(client, db_session):
    """DELETE /api/providers/{id} → 200 + 真的从 DB 删了"""
    db_session.add(ProviderConfig(
        provider_id="todelete", base_url="https://x.com", api_key="k",
    ))
    db_session.commit()
    r = client.delete("/api/providers/todelete")
    assert r.status_code == 200
    assert r.json() == {"deleted": "todelete"}
    # 确认 DB 删了
    assert db_session.query(ProviderConfig).filter_by(provider_id="todelete").first() is None


def test_delete_provider_404(client):
    """DELETE 不存在的 provider → 404"""
    r = client.delete("/api/providers/nonexistent")
    assert r.status_code == 404


@pytest.mark.parametrize("method,path", [
    ("GET", "/api/llm-providers"),
    ("GET", "/api/llm-providers/custom-api"),
    ("PUT", "/api/llm-providers/custom-api"),
    ("DELETE", "/api/llm-providers/custom-api"),
    ("GET", "/api/media-providers"),
    ("GET", "/api/media-providers/custom-api"),
    ("PUT", "/api/media-providers/custom-api"),
    ("PATCH", "/api/media-providers/custom-api"),
    ("DELETE", "/api/media-providers/custom-api"),
])
def test_old_endpoints_return_410(client, method, path):
    """旧 endpoint 返 410 Gone（Plan 5 spec §3.1）"""
    r = client.request(method, path, json={})
    assert r.status_code == 410, f"{method} {path} got {r.status_code}, expected 410"
    assert "moved to /api/providers" in r.json()["detail"]
