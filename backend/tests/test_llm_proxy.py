"""Tests for /api/llm/generate 后端代理。

背景：前端提示词优化曾直连供应商，store 里的 apiKey 可能为空（列表脱敏后清空）
或 localStorage 过期值，导致上游 401"无效的令牌"。改为后端用 DB 明文 key 代理。
"""
import pytest
import app.routers.llm as llm_router
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app import app
from app.database import get_db, Base
from app.models import ProviderConfig


@pytest.fixture
def db_session():
    """In-memory sqlite — 不污染真实 DB"""
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


class _FakeResponse:
    def __init__(self, status_code=200, payload=None, text=""):
        self.status_code = status_code
        self._payload = payload or {}
        self.text = text

    def json(self):
        return self._payload


def _fake_client_class(captured, response):
    class FakeClient:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return False

        async def post(self, url, headers=None, json=None):
            captured["url"] = url
            captured["headers"] = headers or {}
            captured["json"] = json or {}
            return response

    return FakeClient


def test_generate_text_uses_unmasked_db_key(client, db_session, monkeypatch):
    """必须用 DB 里的真实 key 调上游 /v1/chat/completions，非流式。"""
    db_session.add(ProviderConfig(
        provider_id="custom-api-2", base_url="https://api.example.com/v1",
        api_key="sk-real-secret", protocol="openai", enabled=True,
    ))
    db_session.commit()

    captured = {}
    resp = _FakeResponse(payload={"choices": [{"message": {"content": "optimized prompt"}}]})
    monkeypatch.setattr(llm_router.httpx, "AsyncClient", lambda **kw: _fake_client_class(captured, resp)())

    r = client.post("/api/llm/generate", json={
        "provider_id": "custom-api-2",
        "model": "some-chat-model",
        "prompt": "Original Prompt: a cat",
        "system_instruction": "you are a prompt optimizer",
    })
    assert r.status_code == 200
    body = r.json()
    assert body["text"] == "optimized prompt"
    assert body["provider_id"] == "custom-api-2"
    assert captured["url"] == "https://api.example.com/v1/chat/completions"
    assert captured["headers"]["Authorization"] == "Bearer sk-real-secret"
    assert captured["json"]["messages"] == [
        {"role": "system", "content": "you are a prompt optimizer"},
        {"role": "user", "content": "Original Prompt: a cat"},
    ]
    assert captured["json"]["stream"] is False


def test_generate_text_provider_not_found(client):
    """provider 不在 DB → 404"""
    r = client.post("/api/llm/generate", json={
        "provider_id": "nope", "model": "m", "prompt": "p",
    })
    assert r.status_code == 404


def test_generate_text_upstream_401_surfaces_detail(client, db_session, monkeypatch):
    """上游 401（无效的令牌）→ 502，detail 带上游原文便于定位。"""
    db_session.add(ProviderConfig(
        provider_id="custom-api-2", base_url="https://api.example.com/v1",
        api_key="sk-bad", protocol="openai", enabled=True,
    ))
    db_session.commit()

    resp = _FakeResponse(status_code=401, text='{"error":{"message":"无效的令牌"}}')
    monkeypatch.setattr(llm_router.httpx, "AsyncClient", lambda **kw: _fake_client_class({}, resp)())

    r = client.post("/api/llm/generate", json={
        "provider_id": "custom-api-2", "model": "m", "prompt": "p",
    })
    assert r.status_code == 502
    assert "无效的令牌" in r.json()["detail"]


def test_generate_text_multipart_content_joined(client, db_session, monkeypatch):
    """content 为 part 列表时拼接 text 段。"""
    db_session.add(ProviderConfig(
        provider_id="p1", base_url="https://api.example.com",
        api_key="sk-x", protocol="openai", enabled=True,
    ))
    db_session.commit()

    resp = _FakeResponse(payload={"choices": [{"message": {"content": [
        {"type": "text", "text": "hello "},
        {"type": "text", "text": "world"},
    ]}}]})
    monkeypatch.setattr(llm_router.httpx, "AsyncClient", lambda **kw: _fake_client_class({}, resp)())

    r = client.post("/api/llm/generate", json={
        "provider_id": "p1", "model": "m", "prompt": "p",
    })
    assert r.status_code == 200
    assert r.json()["text"] == "hello world"
