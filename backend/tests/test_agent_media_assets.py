import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import Base
from app.models import Asset
from app.agent.media_assets import begin_media_asset, finish_media_asset
from app.agent.memory import AgentMemory
from app.agent.runtime import AgentRuntime


@pytest.fixture
def db_session():
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    session = sessionmaker(bind=engine)()
    yield session
    session.close()
    engine.dispose()


def test_media_asset_is_visible_before_generation_and_updated_after_success(db_session):
    pending = begin_media_asset(
        db_session,
        project_id="p1",
        kind="image",
        asset_kind="character",
        name="林夜",
        prompt="portrait",
        provider_id="p1",
        model_id="image-1",
    )

    row = db_session.query(Asset).filter_by(id=pending["id"]).one()
    assert row.generating is True
    assert row.url is None

    updated = finish_media_asset(db_session, pending["id"], url="https://cdn.test/portrait.png")

    assert updated["id"] == pending["id"]
    assert updated["generating"] is False
    assert db_session.query(Asset).filter_by(id=pending["id"]).one().url.endswith("portrait.png")


def test_media_asset_failure_keeps_node_with_error(db_session):
    pending = begin_media_asset(db_session, project_id="p1", kind="video", asset_kind="shot_video", name="shot 1", prompt="video")

    updated = finish_media_asset(db_session, pending["id"], error="HTTP 404: endpoint not found")

    assert updated["failed"] is True
    assert updated["error"] == "HTTP 404: endpoint not found"


def test_batch_creates_all_generating_assets_before_provider_runs(db_session):
    runtime = AgentRuntime("t1", object(), AgentMemory(user_goal="media"), project_id="p1", db=db_session)

    assets = runtime._begin_media_batch_assets({
        "jobs": [
            {"kind": "image", "asset_kind": "character", "name": "A", "prompt": "portrait A"},
            {"kind": "video", "asset_kind": "shot_video", "name": "shot 1", "prompt": "video 1"},
        ],
    })

    assert len(assets) == 2
    assert all(item["generating"] is True for item in assets)
    assert db_session.query(Asset).filter_by(project_id="p1", generating=True).count() == 2


def test_retry_reuses_failed_asset_identity_and_updates_prompt(db_session):
    first = begin_media_asset(
        db_session,
        project_id="p1",
        kind="image",
        asset_kind="character",
        name="阿瑞斯",
        prompt="old prompt",
    )
    finish_media_asset(db_session, first["id"], error="provider unavailable")

    retried = begin_media_asset(
        db_session,
        project_id="p1",
        kind="image",
        asset_kind="character",
        name="阿瑞斯",
        prompt="old prompt",
    )

    assert retried["id"] == first["id"]
    assert retried["generating"] is True
    assert retried["failed"] is False
    assert db_session.query(Asset).filter_by(project_id="p1", name="阿瑞斯").count() == 1


# ========================
# 防御重复资产（用户最近反馈）
# ========================
# 历史 bug：之前 begin_media_asset 只对 failed.is_(True) 的资产做去重。当 agent 在
# plan 重跑 / retry / error recovery 等场景下重复调用同一 generate_* 工具时，
# 第一次成功的资产不会被复用，会被创建一个新的不同 id 的资产，导致画布节点
# 和资产库侧栏出现重复条目。
# 修复：去重时同时匹配 status='ready'/'processing'/'uploaded' 且 failed=False
# 的资产，返回已有记录（idempotent）。

def test_repeated_call_for_succeeded_asset_is_idempotent(db_session):
    """同一 generate_* 工具被重复调用时，已成功的资产应被复用，不创建新记录。"""
    first = begin_media_asset(
        db_session,
        project_id="p1",
        kind="image",
        asset_kind="prop",
        name="火把道具",
        prompt="a torch made of wood",
    )
    finish_media_asset(db_session, first["id"], url="https://cdn.test/torch.png", prompt="a torch made of wood")

    # 第二次"生成"火把道具（同样的 name/prompt/source_asset_id），应该是 idempotent
    second = begin_media_asset(
        db_session,
        project_id="p1",
        kind="image",
        asset_kind="prop",
        name="火把道具",
        prompt="a torch made of wood",
    )

    assert second["id"] == first["id"]
    # 第二次调用不应清空已有 url（idempotent 语义：复用已有资产）
    assert second["url"] == "https://cdn.test/torch.png"
    # 数据库中只有 1 条记录
    assert db_session.query(Asset).filter_by(project_id="p1", name="火把道具").count() == 1


def test_repeated_call_with_different_name_creates_new_asset(db_session):
    """同名但不同 name（不同实体）时，应允许创建新资产。"""
    first = begin_media_asset(
        db_session,
        project_id="p1",
        kind="image",
        asset_kind="prop",
        name="火把",
        prompt="a torch made of wood",
    )
    finish_media_asset(db_session, first["id"], url="https://cdn.test/torch1.png")

    # 不同 name（不同实体），应创建新资产
    second = begin_media_asset(
        db_session,
        project_id="p1",
        kind="image",
        asset_kind="prop",
        name="钥匙",
        prompt="a rusty key",
    )

    assert second["id"] != first["id"]
    assert db_session.query(Asset).filter_by(project_id="p1").count() == 2


def test_repeated_call_with_different_prompt_creates_new_asset(db_session):
    """同一实体但 prompt 不同时（用户主动要求"换风格"），应创建新版本。"""
    first = begin_media_asset(
        db_session,
        project_id="p1",
        kind="image",
        asset_kind="prop",
        name="火把",
        prompt="a torch made of wood (oil painting style)",
    )
    finish_media_asset(db_session, first["id"], url="https://cdn.test/torch1.png")

    # 同一实体但不同 prompt（用户要求"换成写实风格"）
    second = begin_media_asset(
        db_session,
        project_id="p1",
        kind="image",
        asset_kind="prop",
        name="火把",
        prompt="a torch made of wood (photorealistic style)",
    )

    assert second["id"] != first["id"]
    assert db_session.query(Asset).filter_by(project_id="p1", name="火把").count() == 2


def test_repeated_call_does_not_break_batch_dedup(db_session):
    """batch 场景下，failed 资产仍应被复用（不破坏原 retry 语义）。"""
    # 第一次 batch 创建并失败
    first = begin_media_asset(
        db_session,
        project_id="p1",
        kind="image",
        asset_kind="prop",
        name="批次道具",
        prompt="batch prop",
        extra={"batch": True},
    )
    finish_media_asset(db_session, first["id"], error="provider down")

    # 第二次 batch（retry）应复用同一记录
    second = begin_media_asset(
        db_session,
        project_id="p1",
        kind="image",
        asset_kind="prop",
        name="批次道具",
        prompt="batch prop",
        extra={"batch": True},
    )

    assert second["id"] == first["id"]
    assert db_session.query(Asset).filter_by(project_id="p1", name="批次道具").count() == 1


def test_repeated_call_does_not_affect_different_projects(db_session):
    """不同项目的同名同 prompt 资产不应互相去重。"""
    first = begin_media_asset(
        db_session,
        project_id="project-A",
        kind="image",
        asset_kind="prop",
        name="火把",
        prompt="a torch",
    )
    finish_media_asset(db_session, first["id"], url="https://cdn.test/A.png")

    second = begin_media_asset(
        db_session,
        project_id="project-B",
        kind="image",
        asset_kind="prop",
        name="火把",
        prompt="a torch",
    )

    assert second["id"] != first["id"]
    assert db_session.query(Asset).count() == 2


@pytest.mark.asyncio
async def test_batch_pending_asset_events_emitted_before_first_provider_call(db_session):
    """Task 4.2：所有 pending 资产的 artifact_created 事件必须先于首个 provider 调用。

    在 media service 首次 generate 时快照事件日志：此时两个 pending 资产的
    artifact_created（generating=True）必须已经全部发出。
    """
    from app.agent.events import event_bus, EventType
    from app.agent.llm import LLMResponse
    from app.agent.media_service import MediaResult
    from app.agent.tools.media_batch import GenerateMediaBatchTool
    from app.agent.tools.base import ToolRegistry

    class _BatchLLM:
        def __init__(self):
            self.calls = 0

        async def generate(self, messages, tools=None, **kwargs):
            self.calls += 1
            return LLMResponse(
                content=None,
                tool_name="generate_media_batch",
                tool_args={"jobs": [
                    {"kind": "image", "asset_kind": "character", "name": "角色A", "prompt": "portrait A"},
                    {"kind": "image", "asset_kind": "character", "name": "角色B", "prompt": "portrait B"},
                ]},
                prompt_tokens=1, completion_tokens=1, cost_usd=0.0,
            )

    class _SnapshotMediaService:
        def __init__(self):
            self.pending_events_at_first_call = None

        async def generate(self, request):
            if self.pending_events_at_first_call is None:
                self.pending_events_at_first_call = [
                    e for e in event_bus.get_replay("t-batch-order")
                    if e.type == EventType.ARTIFACT_CREATED and e.payload.get("generating")
                ]
            return MediaResult(url="https://cdn.test/out.png", kind=request.kind)

    event_bus.clear_log("t-batch-order")
    registry = ToolRegistry()
    registry.register(GenerateMediaBatchTool())
    svc = _SnapshotMediaService()
    # 用户已确认 deliverables → structured source 门禁直接通过，
    # 单步内就会执行 generate_media_batch（否则 runtime 会先 ask_user 暂停）。
    from app.agent.task_profiles import TaskProfile
    profile = TaskProfile(
        task_type="custom", input_mode="text", source_kind="prompt",
        script_required=False, needs_clarification=False,
        deliverables=["character"], asset_strategy="generate",
        rule_pack_id="custom.v1", user_confirmed_deliverables=["character"],
    )
    runtime = AgentRuntime(
        "t-batch-order", _BatchLLM(), AgentMemory(user_goal="两个角色"),
        registry=registry, project_id="p1", db=db_session, media_service=svc,
        profile=profile,
    )

    await runtime.step()

    assert svc.pending_events_at_first_call is not None
    assert len(svc.pending_events_at_first_call) == 2
    assert db_session.query(Asset).filter_by(project_id="p1").count() == 2
