"""Bug 2 回归：视频上游 404 的 dev fallback 不得被标为 ready 交付物。

修复前：上游无 /v1/videos/generations 时返回 /files/dev-fallback.mp4 假 URL，
finish_media_asset 把资产标 ready，finish_task 完成度校验认为视频已交付。
修复后：GenerateOut 显式带 dev_fallback 标记；finish_media_asset 把这类资产
标 failed + status="warning"，compute_assets_summary 不计入已交付。
"""
import json
import os
import sys
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from app import app  # noqa: E402
from app.database import Base  # noqa: E402
from app.agent.media_assets import begin_media_asset, finish_media_asset  # noqa: E402
from app.agent.runtime import compute_assets_summary  # noqa: E402


# ============ 路由层：404 响应必须显式带 dev_fallback 标记 ============

@pytest.fixture
def client():
    from app.database import SessionLocal, engine
    from app.models import ProviderConfig
    Base.metadata.create_all(bind=engine)
    with SessionLocal() as s:
        s.query(ProviderConfig).delete()
        s.commit()
    with TestClient(app) as c:
        yield c
    with SessionLocal() as s:
        s.query(ProviderConfig).delete()
        s.commit()


def _seed_provider(client, provider_id: str, **kwargs):
    body = {
        "name": kwargs.get("name", provider_id),
        "base_url": kwargs.get("base_url", "https://api.openai.com/v1"),
        "api_key": kwargs.get("api_key", "sk-x"),
        "protocol": "openai",
        "enabled": True,
        "image_models": [],
        "chat_models": [],
        "video_models": kwargs.get("video_models", ["sora-1.0"]),
    }
    r = client.put(f"/api/providers/{provider_id}", json=body)
    assert r.status_code == 200, f"seed failed: {r.text}"


def test_video_404_response_marks_dev_fallback(client):
    """上游 404 时：保留 fallback URL（可调试），但必须显式标记 dev_fallback。"""
    _seed_provider(client, "openai")

    class MockResp404:
        status_code = 404
        text = "not found"

        def json(self):
            return {"detail": "Not Found"}

    async def fake_post(self, url, headers=None, json=None, **kwargs):
        return MockResp404()

    with patch("app.routers.media.httpx.AsyncClient.post", new=fake_post):
        r = client.post(
            "/api/media/generate/video",
            json={"provider_id": "openai", "model": "sora-1.0", "prompt": "x"},
        )

    assert r.status_code == 200
    data = r.json()
    # fallback 仍可用（本地开发可调试）
    assert data["url"] == "/files/dev-fallback.mp4"
    # 但必须有机器可判的显式标记
    assert data["dev_fallback"] is True
    assert data["raw"]["dev_fallback"] is True
    assert data["raw"]["reason"] == "upstream_404"


# ============ 资产层：dev fallback 资产不得标 ready ============

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


def test_finish_media_asset_dev_fallback_not_ready(db_session):
    """dev fallback 的资产：failed=True + status='warning'，不计入可用资产。"""
    pending = begin_media_asset(
        db_session,
        project_id="p1",
        kind="video",
        asset_kind="video",
        name="shot 1",
        prompt="video prompt",
    )

    updated = finish_media_asset(
        db_session,
        pending["id"],
        url="/files/dev-fallback.mp4",
        dev_fallback=True,
    )

    assert updated["failed"] is True
    assert updated["status"] == "warning"
    assert updated["error"]  # 有用户可理解的错误说明
    assert updated["url"] == "/files/dev-fallback.mp4"  # URL 保留供调试
    assert updated["extra"]["dev_fallback"] is True

    # 关键：完成度校验不把它算作已交付资产
    summary = compute_assets_summary({"video": [updated]})
    assert summary.get("video", 0) == 0


def test_finish_media_asset_normal_success_still_ready(db_session):
    """对照组：正常成功（无 dev_fallback 标记）仍然标 ready。"""
    pending = begin_media_asset(
        db_session,
        project_id="p1",
        kind="video",
        asset_kind="video",
        name="shot 2",
        prompt="video prompt 2",
    )
    updated = finish_media_asset(db_session, pending["id"], url="https://cdn.test/v.mp4")

    assert updated["failed"] is False
    assert updated["status"] == "ready"
    assert compute_assets_summary({"video": [updated]}).get("video") == 1


def test_video_tool_result_propagates_dev_fallback(db_session):
    """端到端（服务层）：上游 404 → DatabaseMediaService → generate_video 工具
    返回结果带 dev_fallback=True，runtime 可据此熔断 ready 标记。"""
    import asyncio
    from app.agent.media_service import DatabaseMediaService, MediaRequest
    from app.models import ProviderConfig

    db_session.add(ProviderConfig(
        provider_id="openai",
        name="OpenAI",
        base_url="https://api.openai.com/v1",
        api_key="sk-x",
        protocol="openai",
        enabled=True,
        default_model="sora-1.0",
        chat_models_json="[]",
        image_models_json="[]",
        video_models_json=json.dumps(["sora-1.0"]),
        extra_config_json="{}",
    ))
    db_session.commit()

    svc = DatabaseMediaService(
        db_session,
        capability_bindings={"video": {"provider_id": "openai", "model_id": "sora-1.0"}},
    )

    class MockResp404:
        status_code = 404
        text = "not found"

        def json(self):
            return {"detail": "Not Found"}

    async def fake_post(self, url, headers=None, json=None, **kwargs):
        return MockResp404()

    async def _run():
        with patch("app.routers.media.httpx.AsyncClient.post", new=fake_post):
            return await svc.generate(MediaRequest(kind="video", prompt="x"))

    result = asyncio.run(_run())
    assert result.url == "/files/dev-fallback.mp4"
    assert result.raw.get("dev_fallback") is True
