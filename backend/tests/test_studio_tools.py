"""Studio 工具（编排层合并）测试：参数透传、事件桥接、取消。"""
import asyncio

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import Base
from app.agent import director, studio
from app.agent.tools.base import ToolContext
from app.agent.tools.studio_tools import StudioGenerateEpisodeTool, StudioGenerateShotTool


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


def _ctx(db_session, events):
    class _BindingMediaService:
        capability_bindings = {"image": {"provider_id": "img-p", "model_id": "img-model"}}

    return ToolContext(
        task_id="t-studio", project_id="p1", db=db_session,
        media_service=_BindingMediaService(),
        emit=lambda t, p: events.append((t, p)),
    )


@pytest.mark.asyncio
async def test_shot_tool_wraps_run_studio_shot(db_session, monkeypatch):
    from app.agent.studio import StudioShotResult, StudioStep

    captured = {}

    async def fake_run(db, **kwargs):
        captured.update(kwargs)
        return StudioShotResult(
            status="approved", asset_id="shot-1", url="https://cdn.test/shot.png",
            prompt="p", rounds=2, inspection={},
            trace=[
                StudioStep(round=1, role="screenwriter", action="write_shot_prompt", summary="镜头 prompt 就绪"),
                StudioStep(round=1, role="artist", action="generate_shot_image", summary="镜头图已生成"),
                StudioStep(round=2, role="critic", action="inspect_shot", summary="过审"),
            ],
        )

    monkeypatch.setattr(studio, "run_studio_shot", fake_run)
    events: list = []
    result = await StudioGenerateShotTool().call(_ctx(db_session, events), {
        "brief": "雨夜天台对峙",
        "character_card_ids": ["card1"],
        "max_rounds": 2,
    })

    assert captured["project_id"] == "p1"
    assert captured["brief"] == "雨夜天台对峙"
    assert captured["image_provider_id"] == "img-p"
    assert captured["image_model"] == "img-model"
    assert captured["max_rounds"] == 2
    assert captured["character_card_ids"] == ["card1"]
    assert result["status"] == "approved"
    assert result["asset_id"] == "shot-1"
    assert result["rounds"] == 2
    # trace → studio_step 事件，角色名中文化
    steps = [p for t, p in events if t == "studio_step"]
    assert len(steps) == 3
    assert steps[0]["role"] == "编剧"
    assert steps[1]["role"] == "美术"
    assert steps[2]["role"] == "质检"


@pytest.mark.asyncio
async def test_episode_tool_bridges_progress_to_studio_step(db_session, monkeypatch):
    async def fake_episode(db, on_progress=None, **kwargs):
        on_progress({"phase": "shooting", "current_shot": 2, "total_shots": 4, "shots": []})
        return {"status": "done", "url": "/files/ep.mp4", "asset_id": "ep-1", "shots": []}

    monkeypatch.setattr(director, "run_studio_episode", fake_episode)
    events: list = []
    result = await StudioGenerateEpisodeTool().call(_ctx(db_session, events), {
        "story_text": "一个女孩在雨夜寻找丢失的猫",
        "max_shots": 4,
    })

    assert result["status"] == "done"
    steps = [p for t, p in events if t == "studio_step"]
    assert len(steps) == 1
    assert steps[0]["role"] == "导演"
    assert steps[0]["phase"] == "shooting"
    assert steps[0]["current_shot"] == 2
    assert steps[0]["total_shots"] == 4


@pytest.mark.asyncio
async def test_shot_tool_requires_db_context():
    with pytest.raises(ValueError, match="project-scoped"):
        await StudioGenerateShotTool().call(ToolContext(task_id="t1"), {"brief": "x"})


@pytest.mark.asyncio
async def test_shot_tool_validates_brief(db_session):
    events: list = []
    with pytest.raises(Exception, match="brief"):
        await StudioGenerateShotTool().call(_ctx(db_session, events), {"brief": "  "})


@pytest.mark.asyncio
async def test_cancel_during_episode_terminates_tool(db_session, monkeypatch):
    """runtime 取消（cancel asyncio task）沿 await 链终止整集编排。"""
    started = asyncio.Event()

    async def blocking_episode(db, on_progress=None, **kwargs):
        started.set()
        await asyncio.sleep(3600)

    monkeypatch.setattr(director, "run_studio_episode", blocking_episode)
    events: list = []
    run = asyncio.create_task(StudioGenerateEpisodeTool().call(_ctx(db_session, events), {
        "story_text": "一个故事",
    }))
    await started.wait()
    run.cancel()
    with pytest.raises(asyncio.CancelledError):
        await run


@pytest.mark.asyncio
async def test_param_overrides_binding(db_session, monkeypatch):
    captured = {}

    async def fake_run(db, **kwargs):
        captured.update(kwargs)
        from app.agent.studio import StudioShotResult
        return StudioShotResult(
            status="approved", asset_id="s", url="u", prompt="p",
            rounds=1, inspection={}, trace=[],
        )

    monkeypatch.setattr(studio, "run_studio_shot", fake_run)
    events: list = []
    await StudioGenerateShotTool().call(_ctx(db_session, events), {
        "brief": "雨夜",
        "image_provider_id": "other-p",
        "image_model": "other-m",
    })
    assert captured["image_provider_id"] == "other-p"
    assert captured["image_model"] == "other-m"
