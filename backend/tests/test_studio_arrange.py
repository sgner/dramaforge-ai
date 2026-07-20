"""资产智能编排端点测试（POST /api/studio/arrange）。

- 编排成功：mock LLM 返回乱序 + 逐镜头 sec/caption，断言响应顺序与字段
- LLM 漏项：漏掉的资产按原输入顺序补到末尾（默认 sec / 空 caption）
- LLM 输出不可解析：降级为原顺序 + 默认值，不报错
- 无 LLM 配置 → 400
- asset_ids < 2 / 资产不存在 → 400
"""
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app import app
from app.database import get_db, Base
from app.models import Asset
from app.routers import studio as studio_router


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


def _add_asset(db, aid, name, kind="image", prompt="", project_id="p1"):
    db.add(Asset(
        id=aid, project_id=project_id, kind=kind, name=name, title=name,
        prompt=prompt, url=f"https://cdn.test/{aid}.png", status="ready",
    ))
    db.commit()


@pytest.fixture
def three_assets(db_session):
    _add_asset(db_session, "a1", "开场-雨夜", prompt="rainy night rooftop")
    _add_asset(db_session, "a2", "对峙", prompt="two people arguing")
    _add_asset(db_session, "a3", "和解", prompt="sunrise reconciliation")
    return ["a1", "a2", "a3"]


class _Resp:
    def __init__(self, content):
        self.content = content


class FakeLLM:
    def __init__(self, content):
        self.content = content
        self.calls = []

    async def generate_structured(self, messages, json_schema=None, temperature=0.7, max_tokens=4096):
        self.calls.append(messages)
        return _Resp(self.content)


def _patch_llm(monkeypatch, content):
    llm = FakeLLM(content)
    monkeypatch.setattr(studio_router, "select_llm_for_task", lambda *a, **k: llm)
    return llm


def test_arrange_orders_by_llm(client, three_assets, monkeypatch):
    """LLM 返回乱序 + sec/caption → 响应按 LLM 顺序，字段透传。"""
    _patch_llm(monkeypatch, (
        '{"items": ['
        '{"asset_id": "a3", "sec": 4.5, "caption": "结局先亮"},'
        '{"asset_id": "a1", "sec": 2.0, "caption": "雨夜开场"},'
        '{"asset_id": "a2", "sec": 3.5, "caption": "矛盾激化"}'
        "]}"
    ))
    r = client.post("/api/studio/arrange", json={
        "project_id": "p1", "asset_ids": three_assets, "story_hint": "倒叙",
    })
    assert r.status_code == 200, r.text
    items = r.json()["items"]
    assert [it["asset_id"] for it in items] == ["a3", "a1", "a2"]
    assert items[0] == {"asset_id": "a3", "sec": 4.5, "caption": "结局先亮"}
    assert items[1]["sec"] == 2.0 and items[2]["caption"] == "矛盾激化"


def test_arrange_appends_missing_in_input_order(client, three_assets, monkeypatch):
    """LLM 只返回 1 个 → 漏掉的按原输入顺序补末尾，sec=3.0 / caption=""。"""
    _patch_llm(monkeypatch, '{"items": [{"asset_id": "a2", "sec": 5, "caption": "先对峙"}]}')
    r = client.post("/api/studio/arrange", json={
        "project_id": "p1", "asset_ids": three_assets,
    })
    assert r.status_code == 200, r.text
    items = r.json()["items"]
    assert [it["asset_id"] for it in items] == ["a2", "a1", "a3"]
    assert items[1] == {"asset_id": "a1", "sec": 3.0, "caption": ""}
    assert items[2] == {"asset_id": "a3", "sec": 3.0, "caption": ""}


def test_arrange_fallback_on_unparseable(client, three_assets, monkeypatch):
    """LLM 输出不是 JSON → 降级为原顺序 + 默认值，200 不报错。"""
    _patch_llm(monkeypatch, "I cannot help with that, no json here")
    r = client.post("/api/studio/arrange", json={
        "project_id": "p1", "asset_ids": three_assets,
    })
    assert r.status_code == 200, r.text
    items = r.json()["items"]
    assert [it["asset_id"] for it in items] == three_assets
    assert all(it["sec"] == 3.0 and it["caption"] == "" for it in items)


def test_arrange_400_without_llm(client, three_assets):
    """DB 里没有任何 LLM provider → NoLLMConfigured → 400。"""
    r = client.post("/api/studio/arrange", json={
        "project_id": "p1", "asset_ids": three_assets,
    })
    assert r.status_code == 400
    assert "LLM" in r.json()["detail"] or "llm" in r.json()["detail"].lower()


def test_arrange_400_on_too_few_and_unknown(client, db_session):
    _add_asset(db_session, "a1", "只有一个")
    r = client.post("/api/studio/arrange", json={
        "project_id": "p1", "asset_ids": ["a1"],
    })
    assert r.status_code == 400

    r = client.post("/api/studio/arrange", json={
        "project_id": "p1", "asset_ids": ["a1", "ghost"],
    })
    assert r.status_code == 400
    assert "not found" in r.json()["detail"]
