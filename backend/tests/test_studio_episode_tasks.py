"""整集生成异步化测试：任务注册表 + 轮询端点 + 角色卡列表端点。

hermetic：director.run_studio_episode 在模块级被替换成快速 fake，
不触碰真实 LLM / 供应商 / ffmpeg。后台任务通过注册表里的 asyncio.Task
对象直接 await（注册表测试）或轮询到终态（HTTP 测试），无 sleep 竞态。
"""
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app import app
from app.database import get_db, Base
from app.models import Asset
from app.agent import director, studio_tasks


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


@pytest.fixture(autouse=True)
def _clear_registry():
    studio_tasks._tasks.clear()
    yield
    studio_tasks._tasks.clear()


def _fake_episode(result):
    """立即完成的 run_studio_episode 替身：上报一次进度后返回固定结果。"""

    async def fake(db, *, on_progress=None, **kwargs):
        if on_progress:
            on_progress({
                "phase": "shooting", "current_shot": 1, "total_shots": 1,
                "shots": [{"title": "s1", "status": "running", "rounds": 0}],
            })
        return result

    return fake


_EPISODE_BODY = {
    "project_id": "p1",
    "story_text": "一段故事",
    "image_provider_id": "img-p",
    "image_model": "img-model",
}


# ---------- 任务注册表 ----------

@pytest.mark.asyncio
async def test_registry_task_completes(monkeypatch):
    result = {"status": "done", "url": "/files/ep.mp4", "shots": []}
    monkeypatch.setattr(director, "run_studio_episode", _fake_episode(result))
    task_id = studio_tasks.start_episode_task(**_EPISODE_BODY)
    # 直接 await 注册表里的 task 对象，确定性等待完成
    await studio_tasks._tasks[task_id]["task"]

    entry = studio_tasks.get_episode_task(task_id)
    assert entry["status"] == "done"
    assert entry["result"] == result
    assert entry["error"] is None
    # on_progress 上报被写入注册表
    assert entry["progress"]["phase"] == "shooting"
    assert entry["progress"]["total_shots"] == 1


@pytest.mark.asyncio
async def test_registry_task_error(monkeypatch):
    async def boom(db, **kwargs):
        raise ValueError("director agent 未能从故事拆出有效镜头")

    monkeypatch.setattr(director, "run_studio_episode", boom)
    task_id = studio_tasks.start_episode_task(**_EPISODE_BODY)
    await studio_tasks._tasks[task_id]["task"]

    entry = studio_tasks.get_episode_task(task_id)
    assert entry["status"] == "error"
    assert "未能从故事拆出有效镜头" in entry["error"]
    assert entry["result"] is None


def test_registry_unknown_task():
    assert studio_tasks.get_episode_task("ghost") is None


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


def test_episodes_post_202_and_poll_until_done(client, monkeypatch):
    result = {"status": "done", "url": "/files/ep.mp4", "shots": []}
    monkeypatch.setattr(director, "run_studio_episode", _fake_episode(result))

    r = client.post("/api/studio/episodes", json=_EPISODE_BODY)
    assert r.status_code == 202, r.text
    task_id = r.json()["task_id"]
    assert task_id

    # 轮询直到终态：fake 立即完成，有限次 GET 内必到 done（轮询即等待，无 sleep）
    data = None
    for _ in range(100):
        resp = client.get(f"/api/studio/episodes/{task_id}")
        assert resp.status_code == 200
        data = resp.json()
        if data["status"] != "running":
            break
    assert data["status"] == "done"
    assert data["task_id"] == task_id
    assert data["result"] == result
    assert data["error"] is None
    assert data["progress"]["total_shots"] == 1
    assert data["progress"]["shots"][0]["title"] == "s1"


def test_episodes_poll_error_state(client, monkeypatch):
    async def boom(db, **kwargs):
        raise RuntimeError("llm down")

    monkeypatch.setattr(director, "run_studio_episode", boom)
    task_id = client.post("/api/studio/episodes", json=_EPISODE_BODY).json()["task_id"]

    data = None
    for _ in range(100):
        data = client.get(f"/api/studio/episodes/{task_id}").json()
        if data["status"] != "running":
            break
    assert data["status"] == "error"
    assert data["error"] == "llm down"
    assert data["result"] is None


def test_episodes_get_unknown_404(client):
    r = client.get("/api/studio/episodes/ghost")
    assert r.status_code == 404


def test_episodes_post_validation_unchanged(client):
    # story_text 为空仍被 pydantic 拒绝
    r = client.post("/api/studio/episodes", json={**_EPISODE_BODY, "story_text": ""})
    assert r.status_code == 422


def test_character_cards_list_filtered(client, db_session):
    db_session.add(Asset(
        id="c1", project_id="p1", kind="image", asset_kind="character",
        name="Hero", url="https://cdn.test/hero.png", status="ready",
        visual_identity={"face_anchor": "sharp jaw"},
        extra={"character_card": True, "reference_asset_ids": ["r1", "r2"]},
    ))
    # 同项目 asset_kind=character 但无 character_card 标记 → 不算角色卡
    db_session.add(Asset(
        id="c2", project_id="p1", kind="image", asset_kind="character",
        name="Plain", url="https://cdn.test/plain.png", status="ready", extra={},
    ))
    # 其它项目的角色卡 → 不返回
    db_session.add(Asset(
        id="c3", project_id="p2", kind="image", asset_kind="character",
        name="Other", url="https://cdn.test/other.png", status="ready",
        extra={"character_card": True},
    ))
    db_session.commit()

    r = client.get("/api/studio/character-cards", params={"project_id": "p1"})
    assert r.status_code == 200, r.text
    cards = r.json()
    assert [c["card_id"] for c in cards] == ["c1"]
    assert cards[0]["name"] == "Hero"
    assert cards[0]["identity"] == {"face_anchor": "sharp jaw"}
    assert cards[0]["reference_asset_ids"] == ["r1", "r2"]
    assert cards[0]["url"] == "https://cdn.test/hero.png"
