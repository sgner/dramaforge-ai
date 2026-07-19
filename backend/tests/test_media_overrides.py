"""extra_config 自定义覆盖测试：endpoint / payload_extra / async_task 轮询 / 字段映射。

背景：seedance 等非 OpenAI 兼容供应商的图像/视频生成是任务式 API
（POST 返回 task_id，GET 轮询取 result_url），且端点路径与 OpenAI 不同。
provider.extra_config["image"|"video"] 的自定义配置覆盖默认行为，
避免为每个供应商硬编码协议适配。
"""
import json
from unittest.mock import patch

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

from app import app
from app.database import SessionLocal
from app.models import ProviderConfig
from app.routers.media import ImageGenerateIn, _openai_image


def _provider(extra_config=None):
    return {
        "provider_id": "test-provider",
        "base_url": "https://api.test/v1",
        "api_key": "sk-test",
        "protocol": "openai",
        "extra_config": extra_config or {},
    }


class _Resp:
    def __init__(self, payload, status_code=200):
        self._payload = payload
        self.status_code = status_code
        self.text = json.dumps(payload, ensure_ascii=False)

    def json(self):
        return self._payload


@pytest.mark.asyncio
async def test_default_openai_path_unchanged():
    """无 extra_config → 走默认 /v1/images/generations 同步路径（行为不回归）。"""
    calls = []

    async def fake_post(self, url, headers=None, json=None):
        calls.append((url, json))
        return _Resp({"data": [{"url": "https://cdn.test/x.png"}]})

    with patch("app.routers.media.httpx.AsyncClient.post", new=fake_post):
        out = await _openai_image(_provider(), ImageGenerateIn(provider_id="test-provider", model="m", prompt="p"))
    assert out.url == "https://cdn.test/x.png"
    assert calls[0][0] == "https://api.test/v1/images/generations"


@pytest.mark.asyncio
async def test_custom_endpoint_and_payload_extra():
    """endpoint 覆盖 + payload_extra 合并进提交 payload。"""
    calls = []

    async def fake_post(self, url, headers=None, json=None):
        calls.append((url, json))
        return _Resp({"task_id": "task_1", "status": "queued"})

    async def fake_get(self, url, headers=None):
        return _Resp({"data": {"status": "SUCCESS", "result_url": "https://cdn.test/done.jpg"}})

    provider = _provider({
        "image": {
            "endpoint": "/v1/image/generations",
            "payload_extra": {"metadata": {"resolution": "2k", "output_format": "jpeg"}},
            "async_task": True,
            "poll_interval_sec": 0.01,
        }
    })
    with patch("app.routers.media.httpx.AsyncClient.post", new=fake_post), \
         patch("app.routers.media.httpx.AsyncClient.get", new=fake_get):
        out = await _openai_image(provider, ImageGenerateIn(provider_id="test-provider", model="m", prompt="p"))
    assert out.url == "https://cdn.test/done.jpg"
    url, payload = calls[0]
    assert url == "https://api.test/v1/image/generations"
    assert payload["metadata"] == {"resolution": "2k", "output_format": "jpeg"}
    assert payload["model"] == "m" and payload["prompt"] == "p"


@pytest.mark.asyncio
async def test_async_task_polls_until_success():
    """async_task：IN_PROGRESS 继续轮询，SUCCESS 后取 result_url。"""
    polls = []

    async def fake_post(self, url, headers=None, json=None):
        return _Resp({"task_id": "task_9", "status": "queued"})

    async def fake_get(self, url, headers=None):
        polls.append(url)
        if len(polls) < 2:
            return _Resp({"data": {"status": "IN_PROGRESS"}})
        return _Resp({"data": {"status": "SUCCESS", "result_url": "https://cdn.test/final.png"}})

    provider = _provider({"image": {"endpoint": "/v1/image/generations", "async_task": True, "poll_interval_sec": 0.01}})
    with patch("app.routers.media.httpx.AsyncClient.post", new=fake_post), \
         patch("app.routers.media.httpx.AsyncClient.get", new=fake_get):
        out = await _openai_image(provider, ImageGenerateIn(provider_id="test-provider", model="m", prompt="p"))
    assert out.url == "https://cdn.test/final.png"
    assert polls[0] == "https://api.test/v1/image/generations/task_9"
    assert len(polls) == 2


@pytest.mark.asyncio
async def test_async_task_failure_raises_502():
    """任务终态失败 → 502，detail 含上游 fail_reason。"""

    async def fake_post(self, url, headers=None, json=None):
        return _Resp({"task_id": "task_bad", "status": "queued"})

    async def fake_get(self, url, headers=None):
        return _Resp({"data": {"status": "FAIL", "fail_reason": "content rejected"}})

    provider = _provider({"image": {"endpoint": "/v1/image/generations", "async_task": True, "poll_interval_sec": 0.01}})
    with patch("app.routers.media.httpx.AsyncClient.post", new=fake_post), \
         patch("app.routers.media.httpx.AsyncClient.get", new=fake_get):
        with pytest.raises(HTTPException) as exc:
            await _openai_image(provider, ImageGenerateIn(provider_id="test-provider", model="m", prompt="p"))
    assert exc.value.status_code == 502
    assert "content rejected" in str(exc.value.detail)


@pytest.mark.asyncio
async def test_sync_custom_result_url_field():
    """同步响应 + result_url_field 自定义提取路径。"""

    async def fake_post(self, url, headers=None, json=None):
        return _Resp({"output": {"image": "https://cdn.test/custom.png"}})

    provider = _provider({"image": {"result_url_field": "output.image"}})
    with patch("app.routers.media.httpx.AsyncClient.post", new=fake_post):
        out = await _openai_image(provider, ImageGenerateIn(provider_id="test-provider", model="m", prompt="p"))
    assert out.url == "https://cdn.test/custom.png"


def test_upsert_provider_preserves_extra_config_when_omitted():
    """PUT 不传 extra_config → 保留 DB 原值；显式传 {} → 清空。

    防止不知情的调用方（如 agent 启动前的防御性同步）把用户配置的
    自定义覆盖清掉。
    """
    pid = "test-extra-config-preserve"
    with TestClient(app) as client:
        r = client.put(f"/api/providers/{pid}", json={
            "base_url": "https://api.test/v1",
            "api_key": "sk-x",
            "extra_config": {"image": {"endpoint": "/v1/image/generations"}},
        })
        assert r.status_code == 200, r.text
        assert r.json()["extra_config"]["image"]["endpoint"] == "/v1/image/generations"

        r2 = client.put(f"/api/providers/{pid}", json={
            "base_url": "https://api.test/v1",
            "name": "renamed",
        })
        assert r2.status_code == 200, r2.text
        assert r2.json()["extra_config"]["image"]["endpoint"] == "/v1/image/generations"
        assert r2.json()["name"] == "renamed"

        r3 = client.put(f"/api/providers/{pid}", json={
            "base_url": "https://api.test/v1",
            "extra_config": {},
        })
        assert r3.status_code == 200, r3.text
        assert r3.json()["extra_config"] == {}

        client.delete(f"/api/providers/{pid}")

    with SessionLocal() as db:
        assert db.query(ProviderConfig).filter_by(provider_id=pid).first() is None
