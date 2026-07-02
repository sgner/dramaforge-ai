"""Tests for /api/llm-providers CRUD 路由（前端 ApiSettingsModal 写入）。

覆盖：
- list 初始为空
- PUT 新建 → GET 出现（key 脱敏）
- PUT 覆盖（同一 provider_id 二次 PUT → 更新 base_url/key/model）
- GET 单个 404
- GET 列表时 key 脱敏：前 4 后 4
- DELETE → GET 404
- 异常：缺失字段 → 422
"""
import pytest
from fastapi.testclient import TestClient

from app import app
from app.database import Base, engine
from app.models import LLMProviderConfig


@pytest.fixture
def client():
    Base.metadata.create_all(bind=engine)
    # 清空已有行
    from app.database import SessionLocal
    with SessionLocal() as s:
        s.query(LLMProviderConfig).delete()
        s.commit()
    with TestClient(app) as c:
        yield c


def test_list_empty(client):
    r = client.get("/api/llm-providers")
    assert r.status_code == 200
    assert r.json() == []


def test_put_creates_and_gets_with_masked_key(client):
    """PUT 新建 → 列表出现；api_key 字段被脱敏。"""
    r = client.put(
        "/api/llm-providers/openai",
        json={
            "base_url": "https://api.openai.com",
            "api_key": "sk-abc123456789xyz",
            "default_model": "gpt-4o-mini",
            "chat_models": ["gpt-4o-mini", "gpt-4o"],
        },
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["provider_id"] == "openai"
    assert body["base_url"] == "https://api.openai.com"
    assert body["default_model"] == "gpt-4o-mini"
    assert body["chat_models"] == ["gpt-4o-mini", "gpt-4o"]
    # key 被脱敏：前 4 + *** + 后 4
    assert body["api_key"] == "sk-a***9xyz"
    # key 不应等于明文
    assert "abc123456789" not in body["api_key"] or body["api_key"].count("*") >= 3

    # GET 列表也脱敏
    listed = client.get("/api/llm-providers").json()
    assert len(listed) == 1
    assert listed[0]["api_key"] == "sk-a***9xyz"


def test_put_updates_existing(client):
    """同一 provider_id 二次 PUT 应覆盖 base_url / key / model。"""
    client.put("/api/llm-providers/openai", json={
        "base_url": "https://api.openai.com",
        "api_key": "sk-111111111111",
        "default_model": "gpt-4o-mini",
    })
    r = client.put("/api/llm-providers/openai", json={
        "base_url": "https://api.example.com/v1",
        "api_key": "sk-222222222222",
        "default_model": "gpt-4o",
    })
    assert r.status_code == 200
    body = r.json()
    assert body["base_url"] == "https://api.example.com/v1"
    assert body["default_model"] == "gpt-4o"
    # 列表里也只有 1 行（不是新增）
    listed = client.get("/api/llm-providers").json()
    assert len(listed) == 1
    assert listed[0]["base_url"] == "https://api.example.com/v1"


def test_get_single_404(client):
    r = client.get("/api/llm-providers/nonexistent")
    assert r.status_code == 404


def test_delete_then_get_404(client):
    client.put("/api/llm-providers/openai", json={
        "base_url": "https://api.openai.com",
        "api_key": "sk-xyz",
        "default_model": "gpt-4o-mini",
    })
    r = client.delete("/api/llm-providers/openai")
    assert r.status_code == 200
    assert r.json() == {"deleted": "openai"}
    r2 = client.get("/api/llm-providers/openai")
    assert r2.status_code == 404


def test_delete_404(client):
    r = client.delete("/api/llm-providers/nonexistent")
    assert r.status_code == 404


def test_put_missing_field_returns_422(client):
    """缺 api_key / base_url / default_model → 422 校验失败。"""
    r = client.put("/api/llm-providers/openai", json={
        "base_url": "https://api.openai.com",
        # 缺 api_key + default_model
    })
    assert r.status_code == 422
