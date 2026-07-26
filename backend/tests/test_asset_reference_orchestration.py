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


class TestRecordAssetUsage:
    def test_records_usage_and_increments_count(self, db_session):
        from app.agent.media_assets import record_asset_usage
        from app.models import AssetUsage
        db_session.add(Asset(id="prop-1", project_id="p1", kind="image", asset_kind="prop", name="剑", url="https://example.com/sword.png"))
        db_session.commit()

        recorded = record_asset_usage(
            db_session, project_id="p1", asset_ids=["prop-1"],
            consumer_type="media_asset", consumer_id="shot-1", role="image",
        )
        assert len(recorded) == 1
        rows = db_session.query(AssetUsage).filter(AssetUsage.asset_id == "prop-1").all()
        assert len(rows) == 1
        assert rows[0].consumer_id == "shot-1"
        assert rows[0].role == "image"
        asset = db_session.query(Asset).filter(Asset.id == "prop-1").one()
        assert asset.usage_count == 1

    def test_idempotent_per_consumer(self, db_session):
        """同一 consumer 重复记录（重试/重复 finish）不重复计数。"""
        from app.agent.media_assets import record_asset_usage
        from app.models import AssetUsage
        db_session.add(Asset(id="prop-1", project_id="p1", kind="image", asset_kind="prop", name="剑", url="https://example.com/sword.png"))
        db_session.commit()

        for _ in range(2):
            record_asset_usage(
                db_session, project_id="p1", asset_ids=["prop-1"],
                consumer_type="media_asset", consumer_id="shot-1", role="image",
            )
        rows = db_session.query(AssetUsage).filter(AssetUsage.asset_id == "prop-1").all()
        assert len(rows) == 1
        assert db_session.query(Asset).filter(Asset.id == "prop-1").one().usage_count == 1

    def test_same_prop_used_by_multiple_consumers(self, db_session):
        """计划示例：一个道具被多个分镜引用 → 一个道具资产，多行 usage。"""
        from app.agent.media_assets import record_asset_usage
        from app.models import AssetUsage
        db_session.add(Asset(id="prop-1", project_id="p1", kind="image", asset_kind="prop", name="剑", url="https://example.com/sword.png"))
        db_session.commit()

        for consumer_id in ("char-1", "char-2", "shot-1", "shot-2", "shot-3"):
            record_asset_usage(
                db_session, project_id="p1", asset_ids=["prop-1"],
                consumer_type="media_asset", consumer_id=consumer_id, role="image",
            )
        rows = db_session.query(AssetUsage).filter(AssetUsage.asset_id == "prop-1").all()
        assert len(rows) == 5
        assert db_session.query(Asset).filter(Asset.id == "prop-1").one().usage_count == 5
        assert db_session.query(Asset).filter(Asset.name == "剑").count() == 1

    def test_skips_assets_from_other_projects(self, db_session):
        from app.agent.media_assets import record_asset_usage
        from app.models import AssetUsage
        db_session.add(Asset(id="a-other", project_id="p2", kind="image", asset_kind="prop", name="剑", url="https://example.com/sword.png"))
        db_session.commit()

        recorded = record_asset_usage(
            db_session, project_id="p1", asset_ids=["a-other"],
            consumer_type="media_asset", consumer_id="shot-1", role="image",
        )
        assert recorded == []
        assert db_session.query(AssetUsage).count() == 0


class TestFinishMediaAssetUsage:
    def _seed(self, db_session):
        db_session.add(Asset(id="ref-1", project_id="p1", kind="image", asset_kind="character", name="林尘", url="https://example.com/char.png"))
        db_session.add(Asset(id="m-1", project_id="p1", kind="video", asset_kind="shot", name="镜头1", generating=True, status="processing"))
        db_session.commit()

    def test_success_records_usage(self, db_session):
        from app.agent.media_assets import finish_media_asset
        from app.models import AssetUsage
        self._seed(db_session)
        finish_media_asset(
            db_session, "m-1",
            url="https://example.com/video.mp4",
            extra={"reference_asset_ids": ["ref-1"]},
        )
        rows = db_session.query(AssetUsage).filter(AssetUsage.asset_id == "ref-1").all()
        assert len(rows) == 1
        assert rows[0].consumer_type == "media_asset"
        assert rows[0].consumer_id == "m-1"
        assert rows[0].role == "video"
        assert db_session.query(Asset).filter(Asset.id == "ref-1").one().usage_count == 1

    def test_failure_does_not_record(self, db_session):
        from app.agent.media_assets import finish_media_asset
        from app.models import AssetUsage
        self._seed(db_session)
        finish_media_asset(
            db_session, "m-1",
            error="provider timeout",
            extra={"reference_asset_ids": ["ref-1"]},
        )
        assert db_session.query(AssetUsage).count() == 0
        assert db_session.query(Asset).filter(Asset.id == "ref-1").one().usage_count == 0

    def test_dev_fallback_does_not_record(self, db_session):
        from app.agent.media_assets import finish_media_asset
        from app.models import AssetUsage
        self._seed(db_session)
        finish_media_asset(
            db_session, "m-1",
            url="https://example.com/placeholder.mp4",
            extra={"reference_asset_ids": ["ref-1"]},
            dev_fallback=True,
        )
        assert db_session.query(AssetUsage).count() == 0


class TestAssetUsageEndpoint:
    def test_usage_endpoint_returns_rows(self):
        import uuid as _uuid
        from fastapi.testclient import TestClient
        from app import app
        from app.database import SessionLocal
        from app.models import AssetUsage

        suffix = _uuid.uuid4().hex[:8]
        asset_id = f"usage-asset-{suffix}"
        db = SessionLocal()
        try:
            db.add(Asset(id=asset_id, project_id="p-usage", kind="image", asset_kind="prop", name="剑", url="https://example.com/sword.png", usage_count=1))
            db.add(AssetUsage(
                id=f"usage-{suffix}", project_id="p-usage", asset_id=asset_id,
                consumer_type="media_asset", consumer_id="shot-1", role="image",
            ))
            db.commit()

            client = TestClient(app)
            resp = client.get(f"/api/assets/{asset_id}/usage")
            assert resp.status_code == 200
            payload = resp.json()
            assert payload["asset_id"] == asset_id
            assert payload["usage_count"] == 1
            assert len(payload["usages"]) == 1
            assert payload["usages"][0]["consumer_id"] == "shot-1"

            resp404 = client.get("/api/assets/nonexistent-asset/usage")
            assert resp404.status_code == 404
        finally:
            db.query(AssetUsage).filter(AssetUsage.asset_id == asset_id).delete()
            db.query(Asset).filter(Asset.id == asset_id).delete()
            db.commit()
            db.close()


class TestGenerateVideoReferenceInheritance:
    @pytest.mark.asyncio
    async def test_video_inherits_scene_character_refs_from_shot_text(self, db_session):
        """generate_video 按 shot 文本继承项目已生成的场景/角色/道具引用。"""
        from app.agent.tools.video_tools import GenerateVideoTool
        db_session.add(Asset(id="char-1", project_id="p1", kind="image", asset_kind="character", name="林尘", url="https://example.com/char.png"))
        db_session.add(Asset(id="scene-1", project_id="p1", kind="image", asset_kind="scene", name="咖啡店", url="https://example.com/cafe.png"))
        db_session.commit()
        artifacts = {
            "character": [{"id": "char-1", "name": "林尘", "url": "https://example.com/char.png"}],
            "scene": [{"id": "scene-1", "name": "咖啡店", "url": "https://example.com/cafe.png"}],
        }
        svc = _RecordingMediaService()
        ctx = ToolContext(
            task_id="t1", project_id="p1", db=db_session,
            llm_client=_PromptLLM(), media_service=svc, artifacts=artifacts,
        )
        result = await GenerateVideoTool().call(ctx, {
            "shot": {"scene": "咖啡店", "action": "林尘坐下", "duration_sec": 5},
        })
        assert set(result["reference_asset_ids"]) == {"char-1", "scene-1"}
        ref_urls = svc.requests[0].reference_urls
        assert "https://example.com/char.png" in ref_urls
        assert "https://example.com/cafe.png" in ref_urls

    @pytest.mark.asyncio
    async def test_video_skips_failed_or_generating_artifacts(self, db_session):
        """失败/生成中的资产不作为引用继承。"""
        from app.agent.tools.video_tools import GenerateVideoTool
        db_session.add(Asset(id="char-1", project_id="p1", kind="image", asset_kind="character", name="林尘", url="https://example.com/char.png"))
        db_session.commit()
        artifacts = {
            "character": [
                {"id": "char-1", "name": "林尘", "url": "https://example.com/char.png", "failed": True},
                {"id": "char-2", "name": "林尘", "url": "https://example.com/char2.png", "generating": True},
            ],
        }
        svc = _RecordingMediaService()
        ctx = ToolContext(
            task_id="t1", project_id="p1", db=db_session,
            llm_client=_PromptLLM(), media_service=svc, artifacts=artifacts,
        )
        result = await GenerateVideoTool().call(ctx, {
            "shot": {"scene": "咖啡店", "action": "林尘坐下", "duration_sec": 5},
        })
        assert result["reference_asset_ids"] == []

    @pytest.mark.asyncio
    async def test_video_inherited_refs_merge_with_canvas_refs(self, db_session):
        """继承引用与画布连线引用合并，不互相覆盖。"""
        from app.agent.tools.video_tools import GenerateVideoTool
        _seed_canvas_ref(db_session, asset_id="canvas-1", url="https://example.com/canvas.png")
        db_session.add(Asset(id="char-1", project_id="p1", kind="image", asset_kind="character", name="林尘", url="https://example.com/char.png"))
        db_session.commit()
        artifacts = {
            "character": [{"id": "char-1", "name": "林尘", "url": "https://example.com/char.png"}],
        }
        svc = _RecordingMediaService()
        ctx = ToolContext(
            task_id="t1", project_id="p1", db=db_session,
            llm_client=_PromptLLM(), media_service=svc, artifacts=artifacts,
        )
        result = await GenerateVideoTool().call(ctx, {
            "shot": {"scene": "咖啡店", "action": "林尘坐下", "duration_sec": 5},
        })
        assert set(result["reference_asset_ids"]) == {"canvas-1", "char-1"}
        ref_urls = svc.requests[0].reference_urls
        assert "https://example.com/canvas.png" in ref_urls
        assert "https://example.com/char.png" in ref_urls


class TestFallbackReference:
    def _seed_upload_with_derivative(self, db_session):
        db_session.add(Asset(
            id="raw-1", project_id="p1", kind="image", asset_kind="character",
            name="林尘", url="https://example.com/raw.png", origin="uploaded",
        ))
        db_session.add(Asset(
            id="norm-1", project_id="p1", kind="image", asset_kind="character",
            name="林尘", url="https://example.com/norm.png",
            origin="normalized", source_asset_id="raw-1",
        ))
        db_session.commit()

    def test_resolve_includes_raw_upload_as_fallback(self, db_session):
        """选中标准化衍生图时，原始上传图作为 fallback_url 保留。"""
        from app.agent.asset_references import resolve_asset_references
        self._seed_upload_with_derivative(db_session)
        refs = resolve_asset_references(db_session, "p1", ["raw-1"], media_kind="image")
        assert refs[0]["asset_id"] == "norm-1"
        assert refs[0]["fallback_url"] == "https://example.com/raw.png"

    def test_no_fallback_when_source_itself_selected(self, db_session):
        from app.agent.asset_references import resolve_asset_references
        db_session.add(Asset(
            id="raw-1", project_id="p1", kind="image", asset_kind="character",
            name="林尘", url="https://example.com/raw.png", origin="uploaded",
        ))
        db_session.commit()
        refs = resolve_asset_references(db_session, "p1", ["raw-1"], media_kind="image")
        assert refs[0]["asset_id"] == "raw-1"
        assert refs[0]["fallback_url"] is None

    def test_reference_urls_with_fallback_orders_primary_first(self):
        from app.agent.asset_references import reference_urls_with_fallback
        items = [
            {"url": "a", "fallback_url": "b"},
            {"url": "c", "fallback_url": "a"},
        ]
        assert reference_urls_with_fallback(items) == ["a", "c", "b"]

    @pytest.mark.asyncio
    async def test_video_reference_urls_include_fallback(self, db_session):
        """视频工具的 reference_urls：衍生图在前，原始上传图兜底在后。"""
        from app.agent.tools.video_tools import GenerateVideoTool
        self._seed_upload_with_derivative(db_session)
        svc = _RecordingMediaService()
        ctx = ToolContext(
            task_id="t1", project_id="p1", db=db_session,
            llm_client=_PromptLLM(), media_service=svc,
        )
        await GenerateVideoTool().call(ctx, {
            "shot": {"scene": "咖啡店", "action": "林尘坐下", "duration_sec": 5},
            "reference_asset_ids": ["raw-1"],
        })
        assert svc.requests[0].reference_urls == [
            "https://example.com/norm.png",
            "https://example.com/raw.png",
        ]


class TestCheckReferenceSupport:
    def _provider(self, db_session, models):
        import json
        from app.models import ProviderConfig
        db_session.add(ProviderConfig(
            provider_id="p1", name="p1",
            base_url="https://example.test/v1", api_key="secret", enabled=True,
            image_models_json=json.dumps(models),
        ))
        db_session.commit()

    def _svc(self, db_session, binding):
        from app.agent.media_service import DatabaseMediaService
        return DatabaseMediaService(db_session, capability_bindings={"image": binding})

    def test_t2i_without_i2i_variant_is_unsupported(self, db_session):
        from app.agent.media_service import MediaRequest
        self._provider(db_session, ["seedream-t2i"])
        svc = self._svc(db_session, {"provider_id": "p1", "model_id": "seedream-t2i"})
        verdict = svc.check_reference_support(
            MediaRequest(kind="image", prompt="p", reference_urls=["https://x/ref.png"])
        )
        assert verdict["supported"] is False
        assert verdict["provider_id"] == "p1"
        assert verdict["model_id"] == "seedream-t2i"
        assert verdict["reference_count"] == 1
        assert "-t2i" in verdict["reason"]

    def test_i2i_variant_available_is_supported(self, db_session):
        from app.agent.media_service import MediaRequest
        self._provider(db_session, ["seedream-t2i", "seedream-i2i"])
        svc = self._svc(db_session, {"provider_id": "p1", "model_id": "seedream-t2i"})
        assert svc.check_reference_support(
            MediaRequest(kind="image", prompt="p", reference_urls=["https://x/ref.png"])
        ) is None

    def test_ref_model_id_binding_is_supported(self, db_session):
        from app.agent.media_service import MediaRequest
        self._provider(db_session, ["seedream-t2i", "seedream-i2i"])
        svc = self._svc(db_session, {
            "provider_id": "p1", "model_id": "seedream-t2i", "ref_model_id": "seedream-i2i",
        })
        assert svc.check_reference_support(
            MediaRequest(kind="image", prompt="p", reference_urls=["https://x/ref.png"])
        ) is None

    def test_no_references_returns_none(self, db_session):
        from app.agent.media_service import MediaRequest
        self._provider(db_session, ["seedream-t2i"])
        svc = self._svc(db_session, {"provider_id": "p1", "model_id": "seedream-t2i"})
        assert svc.check_reference_support(MediaRequest(kind="image", prompt="p")) is None

    def test_unsuffixed_model_treated_as_supported(self, db_session):
        from app.agent.media_service import MediaRequest
        self._provider(db_session, ["seedream-4-0"])
        svc = self._svc(db_session, {"provider_id": "p1", "model_id": "seedream-4-0"})
        assert svc.check_reference_support(
            MediaRequest(kind="image", prompt="p", reference_urls=["https://x/ref.png"])
        ) is None


class TestGenerateWithReferenceCheck:
    @pytest.mark.asyncio
    async def test_degrades_and_annotates_when_unsupported(self):
        """provider 不支持参考图：降级为无参考生成 + agent_notice + raw 标注。"""
        from app.agent.asset_references import generate_with_reference_check
        from app.agent.media_service import MediaRequest

        class UnsupportedSvc:
            def check_reference_support(self, request):
                return {
                    "supported": False, "reason": "text-only",
                    "provider_id": "p1", "model_id": "m-t2i",
                    "media_kind": "image",
                    "reference_count": len(request.reference_urls),
                }

            async def generate(self, request):
                self.last = request
                return MediaResult(url="https://x/out.png", kind=request.kind)

        events = []
        ctx = ToolContext(task_id="t1", emit=lambda t, p: events.append((t, p)))
        svc = UnsupportedSvc()
        result = await generate_with_reference_check(
            ctx, svc, MediaRequest(kind="image", prompt="p", reference_urls=["https://x/ref.png"]),
        )
        assert svc.last.reference_urls == []
        assert result.raw["unsupported_references"]["supported"] is False
        notices = [p for t, p in events if t == "agent_notice"]
        assert len(notices) == 1
        assert notices[0]["level"] == "warning"

    @pytest.mark.asyncio
    async def test_passes_through_when_no_checker(self):
        """服务无 check_reference_support（如 Stub）时参考图原样传递。"""
        from app.agent.asset_references import generate_with_reference_check
        from app.agent.media_service import MediaRequest
        svc = _RecordingMediaService()
        ctx = ToolContext(task_id="t1")
        result = await generate_with_reference_check(
            ctx, svc, MediaRequest(kind="image", prompt="p", reference_urls=["https://x/ref.png"]),
        )
        assert svc.requests[0].reference_urls == ["https://x/ref.png"]
        assert "unsupported_references" not in (result.raw or {})


class TestMediaBatchExplicitReferenceIds:
    @pytest.mark.asyncio
    async def test_batch_job_accepts_explicit_reference_asset_ids(self, db_session):
        """Task 4.1.2：批量 job 显式 reference_asset_ids 被解析并传给 provider。"""
        from app.agent.tools.media_batch import GenerateMediaBatchTool
        db_session.add(Asset(
            id="a1", project_id="p1", kind="image",
            asset_kind="character", name="林尘", url="https://example.com/char.png",
        ))
        db_session.commit()
        svc = _RecordingMediaService()
        ctx = ToolContext(
            task_id="t1", project_id="p1", db=db_session,
            llm_client=_PromptLLM(), media_service=svc,
        )
        result = await GenerateMediaBatchTool().call(ctx, {
            "jobs": [
                {"kind": "video", "prompt": "林尘在咖啡店坐下", "reference_asset_ids": ["a1"]},
                {"kind": "image", "prompt": "无引用任务"},
            ],
        })
        assert result["succeeded"] == 2
        assert result["results"][0]["reference_asset_ids"] == ["a1"]
        assert result["results"][1]["reference_asset_ids"] == []
        video_request = next(r for r in svc.requests if r.kind == "video")
        image_request = next(r for r in svc.requests if r.kind == "image")
        assert video_request.reference_urls == ["https://example.com/char.png"]
        assert image_request.reference_urls == []


class TestCharacterVoiceProfile:
    @pytest.mark.asyncio
    async def test_voiceover_inherits_character_voice(self, db_session):
        """角色资产的声音画像作为 generate_voiceover 的默认音色。"""
        from app.agent.tools.audio_tools import GenerateVoiceoverTool
        db_session.add(Asset(
            id="char-1", project_id="p1", kind="image", asset_kind="character",
            name="林尘", url="https://example.com/char.png", voice_id="male_calm",
        ))
        db_session.commit()
        svc = _RecordingMediaService()
        ctx = ToolContext(task_id="t1", project_id="p1", db=db_session, media_service=svc)
        result = await GenerateVoiceoverTool().call(ctx, {
            "text": "我回来了。",
            "character_asset_id": "char-1",
        })
        assert result["voice"] == "male_calm"
        assert result["character"] == "林尘"
        assert svc.requests[0].voice == "male_calm"

    @pytest.mark.asyncio
    async def test_explicit_voice_wins_over_character_voice(self, db_session):
        from app.agent.tools.audio_tools import GenerateVoiceoverTool
        db_session.add(Asset(
            id="char-1", project_id="p1", kind="image", asset_kind="character",
            name="林尘", url="https://example.com/char.png", voice_id="male_calm",
        ))
        db_session.commit()
        svc = _RecordingMediaService()
        ctx = ToolContext(task_id="t1", project_id="p1", db=db_session, media_service=svc)
        result = await GenerateVoiceoverTool().call(ctx, {
            "text": "我回来了。",
            "character_asset_id": "char-1",
            "voice": "elder",
        })
        assert result["voice"] == "elder"

    @pytest.mark.asyncio
    async def test_character_without_voice_falls_back_to_default(self, db_session):
        from app.agent.tools.audio_tools import GenerateVoiceoverTool
        db_session.add(Asset(
            id="char-1", project_id="p1", kind="image", asset_kind="character",
            name="林尘", url="https://example.com/char.png",
        ))
        db_session.commit()
        ctx = ToolContext(task_id="t1", project_id="p1", db=db_session, media_service=_RecordingMediaService())
        result = await GenerateVoiceoverTool().call(ctx, {
            "text": "我回来了。",
            "character_asset_id": "char-1",
        })
        assert result["voice"] == "female_warm"

    @pytest.mark.asyncio
    async def test_character_from_other_project_rejected(self, db_session):
        from app.agent.tools.audio_tools import GenerateVoiceoverTool
        db_session.add(Asset(
            id="char-x", project_id="p2", kind="image", asset_kind="character",
            name="外人", url="https://example.com/x.png", voice_id="elder",
        ))
        db_session.commit()
        ctx = ToolContext(task_id="t1", project_id="p1", db=db_session, media_service=_RecordingMediaService())
        with pytest.raises(ValueError, match="not found"):
            await GenerateVoiceoverTool().call(ctx, {
                "text": "我回来了。",
                "character_asset_id": "char-x",
            })


class TestVoiceIdSchema:
    def test_asset_out_exposes_voice_id(self, db_session):
        from app.schemas import AssetOut
        db_session.add(Asset(
            id="char-1", project_id="p1", kind="image", asset_kind="character",
            name="林尘", url="https://example.com/char.png", voice_id="male_calm",
        ))
        db_session.commit()
        asset = db_session.query(Asset).filter_by(id="char-1").one()
        assert AssetOut.from_asset_model(asset).voice_id == "male_calm"

    def test_update_asset_sets_voice_id(self):
        import uuid as _uuid
        from fastapi.testclient import TestClient
        from app import app
        from app.database import SessionLocal

        asset_id = f"voice-asset-{_uuid.uuid4().hex[:8]}"
        db = SessionLocal()
        try:
            db.add(Asset(id=asset_id, project_id="p-voice", kind="image", asset_kind="character", name="林尘", url="https://example.com/char.png"))
            db.commit()
            client = TestClient(app)
            resp = client.patch(f"/api/assets/{asset_id}", json={"voice_id": "female_warm"})
            assert resp.status_code == 200
            assert resp.json()["voice_id"] == "female_warm"
            db.expire_all()
            assert db.query(Asset).filter_by(id=asset_id).one().voice_id == "female_warm"
        finally:
            db.query(Asset).filter(Asset.id == asset_id).delete()
            db.commit()
            db.close()
