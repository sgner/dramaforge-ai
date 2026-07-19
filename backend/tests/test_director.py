"""导演 agent / 整集编排测试。

hermetic：run_studio_shot 与 export_sequence 在 director 模块级被替换，
不触碰真实 LLM / 供应商 / ffmpeg。
"""
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.agent import director
from app.agent.director import _parse_shot_list, plan_episode_shots, run_studio_episode
from app.database import Base
from app.models import Asset


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


class _Resp:
    def __init__(self, content):
        self.content = content


class FakeLLM:
    def __init__(self, content):
        self._content = content
        self.calls = []

    async def generate_structured(self, messages, json_schema=None, temperature=0.7, max_tokens=4096):
        self.calls.append(messages)
        return _Resp(self._content)


def test_parse_shot_list_valid_and_cap():
    text = '{"shots": [{"title": "a", "brief": "开场"}, {"title": "b", "brief": "冲突"}, {"title": "c", "brief": "收尾"}]}'
    shots = _parse_shot_list(text, max_shots=2)
    assert [s["title"] for s in shots] == ["a", "b"]  # cap 生效


def test_parse_shot_list_garbage_returns_empty():
    assert _parse_shot_list("not json", 5) == []
    assert _parse_shot_list('{"shots": [{"title": "x"}]}', 5) == []  # 缺 brief 被过滤


@pytest.mark.asyncio
async def test_plan_episode_shots_calls_llm():
    llm = FakeLLM('{"shots": [{"title": "雨夜", "brief": "主角出场"}, {"title": "天台", "brief": "对峙"}]}')
    shots = await plan_episode_shots(llm, "一段故事", max_shots=5)
    assert len(shots) == 2
    assert shots[0]["brief"] == "主角出场"
    # user 消息带故事原文
    assert "一段故事" in llm.calls[0][-1]["content"]


class _ShotResult:
    def __init__(self, status, asset_id, url, rounds=1):
        self.status = status
        self.asset_id = asset_id
        self.url = url
        self.rounds = rounds


@pytest.fixture
def mock_pipeline(db_session, monkeypatch):
    """导演拆 3 个镜头；闭环按 brief 决定过不过审；导出记录收到的 asset_ids。"""
    monkeypatch.setattr(director, "select_llm_for_task", lambda *a, **k: FakeLLM(
        '{"shots": [{"title": "s1", "brief": "开场"}, {"title": "s2", "brief": "冲突"}, {"title": "s3", "brief": "收尾"}]}'
    ))
    monkeypatch.setattr(director, "load_llm_configs", lambda db: [])
    monkeypatch.setattr(director, "load_character_cards", lambda db, pid, ids: [])

    async def fake_shot(db, *, project_id, brief, **kwargs):
        if brief == "冲突":
            return _ShotResult("max_rounds_exceeded", "", "", rounds=3)
        return _ShotResult("approved", f"asset-{brief}", f"https://cdn.test/{brief}.png")

    monkeypatch.setattr(director, "run_studio_shot", fake_shot)

    exported = {}

    async def fake_export(db, *, project_id, asset_ids, sec_per_image, title):
        exported["asset_ids"] = list(asset_ids)
        return {"asset_id": "ep1", "url": "/files/export_ep1.mp4", "segments": len(asset_ids)}

    monkeypatch.setattr(director, "export_sequence", fake_export)
    return exported


@pytest.mark.asyncio
async def test_episode_partial_export_approved_only(db_session, mock_pipeline):
    """3 镜头 1 个不过审 → status=partial，成片只含过审的 2 个。"""
    result = await run_studio_episode(
        db_session, project_id="p1", story_text="一段故事",
        image_provider_id="img-p", image_model="m",
    )
    assert result["status"] == "partial"
    assert result["planned_shots"] == 3 and result["approved_shots"] == 2
    assert mock_pipeline["asset_ids"] == ["asset-开场", "asset-收尾"]
    assert result["url"] == "/files/export_ep1.mp4"
    failed = [s for s in result["shots"] if s["status"] != "approved"]
    assert failed[0]["title"] == "s2"


@pytest.mark.asyncio
async def test_episode_done_when_all_approved(db_session, mock_pipeline, monkeypatch):
    async def all_approved(db, *, project_id, brief, **kwargs):
        return _ShotResult("approved", f"asset-{brief}", "u")

    monkeypatch.setattr(director, "run_studio_shot", all_approved)
    result = await run_studio_episode(
        db_session, project_id="p1", story_text="一段故事",
        image_provider_id="img-p", image_model="m",
    )
    assert result["status"] == "done"
    assert result["export"]["segments"] == 3


@pytest.mark.asyncio
async def test_episode_failed_when_none_approved(db_session, mock_pipeline, monkeypatch):
    async def none_approved(db, *, project_id, brief, **kwargs):
        return _ShotResult("max_rounds_exceeded", "", "", rounds=3)

    monkeypatch.setattr(director, "run_studio_shot", none_approved)
    result = await run_studio_episode(
        db_session, project_id="p1", story_text="一段故事",
        image_provider_id="img-p", image_model="m",
    )
    assert result["status"] == "failed"
    assert result["export"] is None and result["url"] == ""


@pytest.mark.asyncio
async def test_episode_empty_story_rejected(db_session):
    with pytest.raises(ValueError):
        await run_studio_episode(
            db_session, project_id="p1", story_text="  ",
            image_provider_id="img-p", image_model="m",
        )


@pytest.mark.asyncio
async def test_episode_director_no_shots_rejected(db_session, monkeypatch):
    monkeypatch.setattr(director, "select_llm_for_task", lambda *a, **k: FakeLLM("garbage"))
    monkeypatch.setattr(director, "load_llm_configs", lambda db: [])
    monkeypatch.setattr(director, "load_character_cards", lambda db, pid, ids: [])
    with pytest.raises(ValueError, match="未能从故事拆出有效镜头"):
        await run_studio_episode(
            db_session, project_id="p1", story_text="一段故事",
            image_provider_id="img-p", image_model="m",
        )
