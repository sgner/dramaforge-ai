"""测试 media_providers CRUD + media/generate/* 路由。"""
import json
import os
import sys
from unittest.mock import patch, AsyncMock

import pytest
from fastapi.testclient import TestClient

# 添加项目路径
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from app import app  # noqa: E402  (FastAPI instance lives in app/__init__.py)
from app.database import Base, engine  # noqa: E402


@pytest.fixture
def client():
    """每个测试用临时 in-memory DB。"""
    from app.database import SessionLocal
    from app.models import MediaProviderConfig
    Base.metadata.create_all(bind=engine)
    # 清空该表的已有行（不影响其它测试用到的表）
    with SessionLocal() as s:
        s.query(MediaProviderConfig).delete()
        s.commit()
    with TestClient(app) as c:
        yield c
    # 测试结束后清空（避免影响其他测试）
    with SessionLocal() as s:
        s.query(MediaProviderConfig).delete()
        s.commit()


# ============ CRUD ============

def test_list_empty(client):
    r = client.get("/api/media-providers")
    assert r.status_code == 200
    assert r.json() == []


def test_upsert_create(client):
    body = {
        "name": "OpenAI 官方",
        "base_url": "https://api.openai.com/v1",
        "api_key": "sk-test-12345678",
        "protocol": "openai",
        "enabled": True,
        "image_models": ["dall-e-3"],
        "chat_models": ["gpt-4o"],
        "video_models": ["sora-1.0"],
    }
    r = client.put("/api/media-providers/openai", json=body)
    assert r.status_code == 200
    data = r.json()
    assert data["provider_id"] == "openai"
    assert data["name"] == "OpenAI 官方"
    # api_key 脱敏
    assert "sk-t***5678" == data["api_key"]
    assert data["has_key"] is True
    assert data["enabled"] is True
    assert "dall-e-3" in data["image_models"]


def test_upsert_update_no_key(client):
    """已有 provider，无 apiKey → 不覆盖原 key。"""
    body = {
        "base_url": "https://api.openai.com/v1",
        "api_key": "sk-original-key-9999",
    }
    r = client.put("/api/media-providers/openai", json=body)
    assert r.status_code == 200
    assert r.json()["api_key"] == "sk-o***9999"

    # 更新时不传 api_key
    body2 = {
        "base_url": "https://api.openai.com",
        "image_models": ["dall-e-2"],
    }
    r2 = client.put("/api/media-providers/openai", json=body2)
    assert r2.status_code == 200
    assert r2.json()["api_key"] == "sk-o***9999"  # key 没变
    assert "dall-e-2" in r2.json()["image_models"]
    # base_url 末尾 / 被去掉
    assert r2.json()["base_url"] == "https://api.openai.com"


def test_patch_partial(client):
    """PATCH 部分字段。"""
    client.put(
        "/api/media-providers/openai",
        json={"base_url": "https://api.openai.com/v1", "api_key": "sk-1234567890"},
    )
    r = client.patch(
        "/api/media-providers/openai",
        json={"enabled": False, "image_models": ["dall-e-2"]},
    )
    assert r.status_code == 200
    data = r.json()
    assert data["enabled"] is False
    assert data["image_models"] == ["dall-e-2"]
    # api_key 不变
    assert "sk-1***7890" == data["api_key"]


def test_delete(client):
    client.put(
        "/api/media-providers/openai",
        json={"base_url": "https://api.openai.com/v1", "api_key": "sk-test"},
    )
    r = client.delete("/api/media-providers/openai")
    assert r.status_code == 200
    assert r.json() == {"deleted": "openai"}
    # 再次 GET 404
    r2 = client.get("/api/media-providers/openai")
    assert r2.status_code == 404


def test_get_not_found(client):
    r = client.get("/api/media-providers/unknown")
    assert r.status_code == 404


# ============ Generate ============

def test_generate_image_unknown_provider(client):
    """未知 provider_id → 404。"""
    r = client.post(
        "/api/media/generate/image",
        json={"provider_id": "ghost", "model": "dall-e-3", "prompt": "x"},
    )
    assert r.status_code == 404


def test_generate_image_disabled(client):
    """disabled provider → 400。"""
    client.put(
        "/api/media-providers/dis",
        json={"base_url": "https://api.openai.com/v1", "api_key": "sk-x", "enabled": False},
    )
    r = client.post(
        "/api/media/generate/image",
        json={"provider_id": "dis", "model": "dall-e-3", "prompt": "x"},
    )
    assert r.status_code == 400


def test_generate_image_calls_upstream(client):
    """mock 掉 httpx，确认后端会拿 DB 里的 api_key 调上游。"""
    # 准备 provider
    client.put(
        "/api/media-providers/openai",
        json={"base_url": "https://api.openai.com/v1", "api_key": "sk-from-db-12345"},
    )

    # mock 掉 _openai_image 里的 httpx.AsyncClient.post
    class MockResp:
        def __init__(self):
            self.status_code = 200
            self._text = json.dumps({"data": [{"url": "https://example.com/img.png"}]})
        def json(self):
            return json.loads(self._text)
        @property
        def text(self):
            return self._text

    async def fake_post(self, url, headers=None, json=None, **kwargs):
        # 校验：header Authorization 用了 DB 里的明文 key
        assert headers.get("Authorization") == "Bearer sk-from-db-12345", (
            f"expected DB key, got {headers}"
        )
        # 校验：URL 是 base_url + /v1/images/generations
        assert url == "https://api.openai.com/v1/images/generations", f"unexpected URL: {url}"
        return MockResp()

    with patch("app.routers.media.httpx.AsyncClient.post", new=fake_post):
        r = client.post(
            "/api/media/generate/image",
            json={"provider_id": "openai", "model": "dall-e-3", "prompt": "a cat", "aspect_ratio": "1:1"},
        )

    assert r.status_code == 200
    data = r.json()
    assert data["url"] == "https://example.com/img.png"
    assert data["provider_id"] == "openai"
    assert data["model"] == "dall-e-3"


def test_generate_image_base_url_v1_normalization(client):
    """base_url 带 /v1 也能正确调。"""
    client.put(
        "/api/media-providers/openai",
        json={"base_url": "https://api.openai.com/v1", "api_key": "sk-x"},
    )

    class MockResp:
        status_code = 200
        _text = json.dumps({"data": [{"url": "https://example.com/x.png"}]})
        def json(self): return json.loads(self._text)
        @property
        def text(self): return self._text

    captured_urls = []
    async def fake_post(self, url, headers=None, json=None, **kwargs):
        captured_urls.append(url)
        return MockResp()

    with patch("app.routers.media.httpx.AsyncClient.post", new=fake_post):
        client.post(
            "/api/media/generate/image",
            json={"provider_id": "openai", "model": "dall-e-3", "prompt": "x"},
        )

    # 不应变成 /v1/v1/...
    assert captured_urls[0] == "https://api.openai.com/v1/images/generations"


def test_generate_video_fallback_on_404(client):
    """video 上游 404 时返回 dev fallback URL（不抛错）。"""
    client.put(
        "/api/media-providers/openai",
        json={"base_url": "https://api.openai.com/v1", "api_key": "sk-x"},
    )

    class MockResp404:
        status_code = 404
        text = "not found"
        def json(self): return {"detail": "Not Found"}

    async def fake_post(self, url, headers=None, json=None, **kwargs):
        return MockResp404()

    with patch("app.routers.media.httpx.AsyncClient.post", new=fake_post):
        r = client.post(
            "/api/media/generate/video",
            json={"provider_id": "openai", "model": "sora-1.0", "prompt": "x"},
        )

    assert r.status_code == 200
    assert "mp4" in r.json()["url"]
