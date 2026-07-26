"""资产引用编排测试。"""
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import Base
from app.schemas import ConnectionOut
from app.models import Asset, Connection
from app.agent.media_service import MediaResult
from app.agent.tools.asset_registry_helpers import collect_canvas_references
from app.agent.tools.base import ToolContext
from app.agent.llm import LLMResponse


@pytest.fixture
def db_session():
    """In-memory sqlite — 不污染真实 DB（与 test_asset_registry 一致的做法）。"""
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


class TestConnectionData:
    def test_connection_out_accepts_data_field(self):
        conn = ConnectionOut(
            id="c1", from_node="n1", to_node="n2",
            data={"asset_ref": "asset-1", "role": "reference"},
        )
        assert conn.data["asset_ref"] == "asset-1"
        assert conn.data["role"] == "reference"

    def test_connection_out_data_defaults_to_empty_dict(self):
        conn = ConnectionOut(id="c1", from_node="n1", to_node="n2")
        assert conn.data == {}

    def test_old_connections_without_data_still_work(self):
        conn = ConnectionOut(id="c1", from_node="n1", to_node="n2",
                              from_port="out", to_port="in")
        assert conn.data == {}


class TestCollectCanvasReferences:
    def test_collects_asset_ref_from_connections(self, db_session):
        db_session.add(Connection(
            id="c1", project_id="p1", from_node="n1", to_node="n2",
            data={"asset_ref": "asset-1", "role": "reference"},
        ))
        db_session.commit()
        result = collect_canvas_references(db_session, "p1")
        assert "asset-1" in result

    def test_filters_by_target_node(self, db_session):
        db_session.add(Connection(
            id="c1", project_id="p1", from_node="n1", to_node="n2",
            data={"asset_ref": "asset-1"},
        ))
        db_session.add(Connection(
            id="c2", project_id="p1", from_node="n3", to_node="n4",
            data={"asset_ref": "asset-2"},
        ))
        db_session.commit()
        result = collect_canvas_references(db_session, "p1", target_node_id="n2")
        assert "asset-1" in result
        assert "asset-2" not in result

    def test_skips_connections_without_asset_ref(self, db_session):
        db_session.add(Connection(
            id="c1", project_id="p1", from_node="n1", to_node="n2",
            data={},
        ))
        db_session.commit()
        result = collect_canvas_references(db_session, "p1")
        assert result == []

    def test_deduplicates_asset_ids(self, db_session):
        db_session.add(Connection(
            id="c1", project_id="p1", from_node="n1", to_node="n2",
            data={"asset_ref": "asset-1"},
        ))
        db_session.add(Connection(
            id="c2", project_id="p1", from_node="n3", to_node="n4",
            data={"asset_ref": "asset-1"},
        ))
        db_session.commit()
        result = collect_canvas_references(db_session, "p1")
        assert result.count("asset-1") == 1

    def test_returns_empty_when_no_connections(self, db_session):
        result = collect_canvas_references(db_session, "p1")
        assert result == []


class TestGenerateToolCanvasRefs:
    def test_collect_canvas_refs_for_ctx(self, db_session):
        """手动驱动协程执行 _collect_canvas_refs_for_ctx。

        避免依赖 asyncio event loop / socketpair —— 在 Windows socket 资源
        耗尽（WinError 10055）环境下 pytest-asyncio 创建事件循环会失败。
        _collect_canvas_refs_for_ctx 内部无真实 await，手动驱动协程即可。
        """
        from app.models import Connection
        db_session.add(Connection(
            id="c1", project_id="p1", from_node="n1", to_node="n2",
            data={"asset_ref": "canvas-asset-1"},
        ))
        db_session.commit()

        ctx = ToolContext(task_id="t1", project_id="p1", db=db_session)
        from app.agent.tools.image_tools import _collect_canvas_refs_for_ctx
        coro = _collect_canvas_refs_for_ctx(ctx)
        # 手动驱动协程直到完成（无需 event loop）
        try:
            coro.send(None)
        except StopIteration as exc:
            refs = exc.value
        else:
            refs = []
            coro.close()
        assert "canvas-asset-1" in refs


class TestBackwardCompat:
    def test_old_connections_without_data_field(self, db_session):
        """旧连线（data 列为 NULL）仍能被 collect_canvas_references 处理。"""
        db_session.add(Connection(
            id="c1", project_id="p1", from_node="n1", to_node="n2",
            # data 不设置（模拟旧数据，data 列为 NULL）
        ))
        db_session.commit()
        result = collect_canvas_references(db_session, "p1")
        assert result == []

    def test_connection_batch_upsert_accepts_empty_data(self):
        """批量保存端点接受空 data 的连线。"""
        from app.schemas import ConnectionBatchUpsert
        batch = ConnectionBatchUpsert(connections=[
            ConnectionOut(id="c1", from_node="n1", to_node="n2"),
        ])
        assert batch.connections[0].data == {}

    def test_connection_out_extra_ignore_keeps_old_shape(self):
        """旧请求（无 data 字段）通过 extra=ignore 仍能构造。"""
        conn = ConnectionOut(
            id="c1", from_node="n1", to_node="n2",
            from_port="out", to_port="in",
        )
        assert conn.data == {}
        assert conn.from_port == "out"


class _RecordingMediaService:
    """记录 MediaRequest 的测试用媒体服务。"""

    def __init__(self):
        self.requests = []

    async def generate(self, request):
        self.requests.append(request)
        return MediaResult(url=f"https://example.com/{request.kind}-result", kind=request.kind)


class _PromptLLM:
    model = "test-prompt-model"

    async def generate(self, messages, **kwargs):
        return LLMResponse(content="optimized: " + messages[-1]["content"])


def _seed_canvas_ref(db_session, asset_id="a1", url="https://example.com/char.png"):
    db_session.add(Asset(
        id=asset_id, project_id="p1", kind="image",
        asset_kind="character", name="林尘", url=url,
    ))
    db_session.add(Connection(
        id="c1", project_id="p1", from_node="n1", to_node="n2",
        data={"asset_ref": asset_id},
    ))
    db_session.commit()


class TestGenerateVideoCanvasRefs:
    @pytest.mark.asyncio
    async def test_video_tool_collects_canvas_refs(self, db_session):
        """画布连线的 asset_ref 自动注入 generate_video 的 reference_urls。"""
        from app.agent.tools.video_tools import GenerateVideoTool
        _seed_canvas_ref(db_session)
        svc = _RecordingMediaService()
        ctx = ToolContext(
            task_id="t1", project_id="p1", db=db_session,
            llm_client=_PromptLLM(), media_service=svc,
        )
        result = await GenerateVideoTool().call(ctx, {
            "shot": {"scene": "咖啡店", "action": "林尘坐下", "duration_sec": 5},
        })
        assert "url" in result
        assert len(svc.requests) == 1
        assert "https://example.com/char.png" in svc.requests[0].reference_urls

    @pytest.mark.asyncio
    async def test_video_tool_preserves_explicit_reference_urls(self, db_session):
        """画布引用自动注入后，显式 reference_urls 不能被丢弃。"""
        from app.agent.tools.video_tools import GenerateVideoTool
        _seed_canvas_ref(db_session)
        svc = _RecordingMediaService()
        ctx = ToolContext(
            task_id="t1", project_id="p1", db=db_session,
            llm_client=_PromptLLM(), media_service=svc,
        )
        await GenerateVideoTool().call(ctx, {
            "shot": {"scene": "咖啡店", "action": "林尘坐下", "duration_sec": 5},
            "reference_urls": ["https://example.com/first-frame.png"],
        })
        ref_urls = svc.requests[0].reference_urls
        assert "https://example.com/char.png" in ref_urls
        assert "https://example.com/first-frame.png" in ref_urls

    @pytest.mark.asyncio
    async def test_video_tool_without_db_keeps_working(self):
        """无 db 上下文（旧行为）时 generate_video 不受影响。"""
        from app.agent.tools.video_tools import GenerateVideoTool
        svc = _RecordingMediaService()
        ctx = ToolContext(task_id="t1", llm_client=_PromptLLM(), media_service=svc)
        result = await GenerateVideoTool().call(ctx, {
            "shot": {"scene": "咖啡店", "action": "林尘坐下", "duration_sec": 5},
        })
        assert "url" in result
        assert svc.requests[0].reference_urls == []


class TestMediaBatchCanvasRefs:
    @pytest.mark.asyncio
    async def test_batch_applies_canvas_refs_to_video_and_storyboard_jobs(self, db_session):
        """批量任务中视频与分镜 job 都携带画布连线引用。"""
        from app.agent.tools.media_batch import GenerateMediaBatchTool
        _seed_canvas_ref(db_session)
        svc = _RecordingMediaService()
        ctx = ToolContext(
            task_id="t1", project_id="p1", db=db_session,
            llm_client=_PromptLLM(), media_service=svc,
        )
        result = await GenerateMediaBatchTool().call(ctx, {
            "jobs": [
                {"kind": "video", "prompt": "林尘在咖啡店坐下", "duration_sec": 5},
                {"kind": "image", "asset_kind": "storyboard", "prompt": "分镜1：咖啡店全景"},
            ],
        })
        assert result["succeeded"] == 2
        assert len(svc.requests) == 2
        for request in svc.requests:
            assert "https://example.com/char.png" in request.reference_urls
        for item in result["results"]:
            assert "a1" in item["reference_asset_ids"]

    @pytest.mark.asyncio
    async def test_batch_without_connections_behaves_as_before(self, db_session):
        """无画布连线时批量任务保持旧行为（无引用注入）。"""
        from app.agent.tools.media_batch import GenerateMediaBatchTool
        svc = _RecordingMediaService()
        ctx = ToolContext(
            task_id="t1", project_id="p1", db=db_session,
            llm_client=_PromptLLM(), media_service=svc,
        )
        result = await GenerateMediaBatchTool().call(ctx, {
            "jobs": [{"kind": "video", "prompt": "林尘在咖啡店坐下", "duration_sec": 5}],
        })
        assert result["succeeded"] == 1
        assert svc.requests[0].reference_urls == []
        assert result["results"][0]["reference_asset_ids"] == []
