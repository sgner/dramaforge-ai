"""多 agent 协同骨架测试（Track B）：编剧→美术→质检三角闭环。

不碰真实供应商/真实 LLM：
- LLM 用 FakeLLM（generate_structured 返回编剧 JSON）
- 美术生成 monkeypatch studio._openai_image
- 质检 monkeypatch studio.inspect_asset
"""
import json

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.agent import studio
from app import app
from app.database import get_db, Base
from app.models import ProviderConfig, Asset
from app.agent.studio import run_studio_shot


@pytest.fixture
def db_session():
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine)
    session = Session()
    # 图像供应商（_load_provider 需要）+ LLM 供应商（load_llm_configs 需要）
    session.add(ProviderConfig(
        provider_id="img-p", base_url="https://api.test/v1", api_key="sk-img",
        image_models_json='["img-model"]', enabled=True,
    ))
    session.add(ProviderConfig(
        provider_id="llm-p", base_url="https://llm.test/v1", api_key="sk-llm",
        chat_models_json='["chat-model"]', default_model="chat-model", enabled=True,
    ))
    session.commit()
    yield session
    session.close()
    engine.dispose()


class _Resp:
    def __init__(self, content):
        self.content = content


class FakeLLM:
    """记录编剧收到的 user 消息，用于断言质检反馈被回传。"""

    def __init__(self, shot_prompt="a hero stands in the rain"):
        self.shot_prompt = shot_prompt
        self.calls = []

    async def generate_structured(self, messages, json_schema=None, temperature=0.7, max_tokens=4096):
        self.calls.append(messages)
        return _Resp(json.dumps({"shot_prompt": self.shot_prompt, "shot_notes": "establishing"}))


@pytest.fixture
def fake_llm(monkeypatch):
    llm = FakeLLM()
    monkeypatch.setattr(studio, "select_llm_for_task", lambda *a, **k: llm)
    return llm


@pytest.fixture
def fake_media(monkeypatch):
    class Out:
        url = "https://cdn.test/shot.png"

    async def fake_openai_image(provider, body):
        return Out()

    monkeypatch.setattr(studio, "_openai_image", fake_openai_image)


def _inspection(approved, notes=""):
    return {
        "meets_standard": approved,
        "missing_fields": [] if approved else ["face detail"],
        "notes": notes,
        "recommended_action": "approve_asset" if approved else "regenerate",
    }


@pytest.mark.asyncio
async def test_approved_first_round(db_session, fake_llm, fake_media, monkeypatch):
    """一轮过审：status=approved，trace 含三角各一步。"""
    monkeypatch.setattr(studio, "inspect_asset",
                        lambda *a, **k: _async_return(_inspection(True)))
    result = await run_studio_shot(
        db_session, project_id="p1", brief="雨夜英雄登场",
        image_provider_id="img-p", image_model="img-model",
    )
    assert result.status == "approved"
    assert result.rounds == 1
    assert result.url == "https://cdn.test/shot.png"
    roles = [s.role for s in result.trace]
    assert roles == ["screenwriter", "artist", "critic"]
    # 资产落库
    asset = db_session.query(Asset).filter_by(id=result.asset_id).first()
    assert asset is not None and asset.asset_kind == "shot" and asset.status == "ready"
    assert asset.prompt == "a hero stands in the rain"


async def _async_return(value):
    return value


@pytest.mark.asyncio
async def test_critic_rejection_loops_back_to_screenwriter(db_session, fake_llm, fake_media, monkeypatch):
    """第一轮打回 → 第二轮编剧必须收到质检反馈；第二轮过审。"""
    calls = {"n": 0}

    async def fake_inspect(db, project_id, asset_id, llm):
        calls["n"] += 1
        return _inspection(calls["n"] >= 2, notes="ok" if calls["n"] >= 2 else "脸糊了")

    monkeypatch.setattr(studio, "inspect_asset", fake_inspect)
    result = await run_studio_shot(
        db_session, project_id="p1", brief="雨夜英雄登场",
        image_provider_id="img-p", image_model="img-model",
    )
    assert result.status == "approved"
    assert result.rounds == 2
    # 编剧被调了两次，第二次的 user 消息必须包含质检反馈
    assert len(fake_llm.calls) == 2
    second_user_msg = fake_llm.calls[1][1]["content"]
    assert "CRITIC FEEDBACK" in second_user_msg
    assert "脸糊了" in second_user_msg


@pytest.mark.asyncio
async def test_max_rounds_exceeded(db_session, fake_llm, fake_media, monkeypatch):
    """始终不过审 → max_rounds_exceeded，轮数正确。"""
    monkeypatch.setattr(studio, "inspect_asset",
                        lambda *a, **k: _async_return(_inspection(False)))
    result = await run_studio_shot(
        db_session, project_id="p1", brief="雨夜英雄登场",
        image_provider_id="img-p", image_model="img-model", max_rounds=2,
    )
    assert result.status == "max_rounds_exceeded"
    assert result.rounds == 2
    assert len([s for s in result.trace if s.role == "critic"]) == 2


@pytest.mark.asyncio
async def test_empty_brief_rejected(db_session, fake_llm, fake_media):
    with pytest.raises(ValueError):
        await run_studio_shot(
            db_session, project_id="p1", brief="  ",
            image_provider_id="img-p", image_model="img-model",
        )


# ---------- HTTP 端点 ----------

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


def test_studio_shots_endpoint(client, fake_llm, fake_media, monkeypatch):
    monkeypatch.setattr(studio, "inspect_asset",
                        lambda *a, **k: _async_return(_inspection(True)))
    r = client.post("/api/studio/shots", json={
        "project_id": "p1", "brief": "雨夜英雄登场",
        "image_provider_id": "img-p", "image_model": "img-model",
    })
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["status"] == "approved"
    assert [s["role"] for s in data["trace"]] == ["screenwriter", "artist", "critic"]


def test_studio_shots_unknown_image_provider_404(client, fake_llm, fake_media):
    r = client.post("/api/studio/shots", json={
        "project_id": "p1", "brief": "x",
        "image_provider_id": "nope", "image_model": "m",
    })
    assert r.status_code == 404
