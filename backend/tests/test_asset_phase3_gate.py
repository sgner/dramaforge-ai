"""阶段 3 闸门验证（roadmap 3.4 / asset-intelligence Phase 3 gate）。

覆盖：
1. 上传单人物图片 → 检查 → 标准化衍生，源图保留；
2. 一个道具被多个分镜引用（一个道具资产，多条 usage）；
3. 分镜图同时携带场景、角色、道具参考；
4. 失败重试不产生重复资产；
5. 相同角色跨 3 个分镜的引用与提示词保持一致。
"""
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import Base
from app.models import Asset, AssetUsage
from app.agent.llm import LLMResponse
from app.agent.media_service import MediaResult
from app.agent.tools.base import ToolContext


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


class _PromptLLM:
    model = "test-prompt-model"

    async def generate(self, messages, **kwargs):
        return LLMResponse(content="optimized: " + messages[-1]["content"])


class _RecordingMediaService:
    def __init__(self):
        self.requests = []

    async def generate(self, request):
        self.requests.append(request)
        return MediaResult(url=f"https://example.com/out-{len(self.requests)}.png", kind=request.kind)


def _ctx(db_session, svc):
    return ToolContext(
        task_id="t-gate", project_id="p1", db=db_session,
        llm_client=_PromptLLM(), media_service=svc,
    )


def _seed_scene_character_prop(db_session):
    db_session.add_all([
        Asset(id="scene-1", project_id="p1", kind="image", asset_kind="scene", name="咖啡店", url="https://example.com/cafe.png"),
        Asset(id="char-1", project_id="p1", kind="image", asset_kind="character", name="林尘", url="https://example.com/char.png"),
        Asset(id="prop-1", project_id="p1", kind="image", asset_kind="prop", name="青铜剑", url="https://example.com/sword.png"),
    ])
    db_session.commit()


class TestGate1UploadInspectNormalize:
    @pytest.mark.asyncio
    async def test_upload_single_person_inspect_normalize_source_preserved(self, db_session):
        """上传单人物图 → 多模态检查判定需标准化 → 衍生图生成，源图完整保留。"""
        from app.agent.asset_intelligence import inspect_asset, prepare_asset

        db_session.add(Asset(
            id="upload-1", project_id="p1", kind="image", asset_kind="character",
            name="林尘", url="/files/linchen.png",
            origin="uploaded", inspection_status="pending", status="uploaded",
        ))
        db_session.commit()

        class VisionLLM:
            async def generate_structured(self, messages, **kwargs):
                return LLMResponse(content=(
                    '{"asset_type":"character","confidence":0.95,'
                    '"subjects":["single_person"],"meets_standard":false,'
                    '"missing_fields":["front_view","side_view"],'
                    '"recommended_action":"prepare_character_asset",'
                    '"reference_role":"character"}'
                ))

        inspection = await inspect_asset(db_session, "p1", "upload-1", VisionLLM())
        assert inspection["asset_type"] == "character"

        derivative = prepare_asset(db_session, "p1", "upload-1", "character")

        # 源图完整保留
        source = db_session.query(Asset).filter_by(id="upload-1").one()
        assert source.origin == "uploaded"
        assert source.url == "/files/linchen.png"
        assert source.failed is False
        # 衍生图与源图关联，且二者共存
        assert derivative.id != "upload-1"
        assert derivative.source_asset_id == "upload-1"
        assert derivative.origin == "normalized"
        assert db_session.query(Asset).filter_by(project_id="p1").count() == 2


class TestGate2And3ReferenceReuse:
    @pytest.mark.asyncio
    async def test_storyboard_carries_scene_character_prop_references(self, db_session):
        """闸门 3：分镜图同时携带场景、角色、道具参考。"""
        from app.agent.tools.image_tools import GenerateStoryboardImageTool
        _seed_scene_character_prop(db_session)
        svc = _RecordingMediaService()
        result = await GenerateStoryboardImageTool().call(_ctx(db_session, svc), {
            "shot": {"index": 1, "scene": "咖啡店", "action": "林尘拔剑"},
            "scene": {"asset_id": "scene-1", "name": "咖啡店"},
            "characters": [{"asset_id": "char-1", "name": "林尘"}],
            "props": [{"asset_id": "prop-1", "name": "青铜剑"}],
        })
        assert set(result["reference_asset_ids"]) == {"scene-1", "char-1", "prop-1"}
        ref_urls = svc.requests[0].reference_urls
        assert "https://example.com/cafe.png" in ref_urls
        assert "https://example.com/char.png" in ref_urls
        assert "https://example.com/sword.png" in ref_urls

    @pytest.mark.asyncio
    async def test_one_prop_referenced_by_multiple_storyboards(self, db_session):
        """闸门 2：一个道具被多个分镜引用 → 一个道具资产，多条 usage。"""
        from app.agent.tools.image_tools import GenerateStoryboardImageTool
        from app.agent.media_assets import begin_media_asset, finish_media_asset
        _seed_scene_character_prop(db_session)
        svc = _RecordingMediaService()
        tool = GenerateStoryboardImageTool()

        for index in (1, 2, 3):
            result = await tool.call(_ctx(db_session, svc), {
                "shot": {"index": index, "scene": "咖啡店", "action": f"镜头{index}"},
                "props": [{"asset_id": "prop-1", "name": "青铜剑"}],
            })
            assert "prop-1" in result["reference_asset_ids"]
            # 模拟 runtime 的资产生命周期，验证 finish 时记录 usage
            pending = begin_media_asset(
                db_session, project_id="p1", kind="image", asset_kind="storyboard",
                name=f"分镜{index}", prompt=result["prompt"],
            )
            finish_media_asset(
                db_session, pending["id"], url=result["url"],
                extra={"reference_asset_ids": result["reference_asset_ids"]},
            )

        # 道具资产只有一行
        assert db_session.query(Asset).filter(Asset.asset_kind == "prop").count() == 1
        # 三条 usage 记录，usage_count == 3
        rows = db_session.query(AssetUsage).filter(AssetUsage.asset_id == "prop-1").all()
        assert len(rows) == 3
        assert db_session.query(Asset).filter_by(id="prop-1").one().usage_count == 3


class TestGate4RetryNoDuplicate:
    def test_failed_retry_reuses_same_asset_row(self, db_session):
        """闸门 4：失败重试复用同一资产行，不追加重复资产。"""
        from app.agent.media_assets import begin_media_asset, finish_media_asset

        first = begin_media_asset(
            db_session, project_id="p1", kind="image", asset_kind="prop",
            name="青铜剑", prompt="prop prompt v1",
        )
        finish_media_asset(db_session, first["id"], error="provider 502")
        assert db_session.query(Asset).filter_by(project_id="p1").count() == 1

        retry = begin_media_asset(
            db_session, project_id="p1", kind="image", asset_kind="prop",
            name="青铜剑", prompt="prop prompt v1",
        )
        assert retry["id"] == first["id"]
        finish_media_asset(db_session, retry["id"], url="https://example.com/sword.png")
        assert db_session.query(Asset).filter_by(project_id="p1").count() == 1
        row = db_session.query(Asset).filter_by(id=first["id"]).one()
        assert row.failed is False
        assert row.url == "https://example.com/sword.png"


class TestGate5ConsistentCharacterAcrossStoryboards:
    @pytest.mark.asyncio
    async def test_same_character_consistent_across_three_storyboards(self, db_session):
        """闸门 5：相同角色跨 3 个分镜的引用和提示词保持一致。"""
        from app.agent.tools.image_tools import GenerateStoryboardImageTool
        _seed_scene_character_prop(db_session)
        svc = _RecordingMediaService()
        tool = GenerateStoryboardImageTool()

        ref_id_sets = []
        prompts = []
        for index in (1, 2, 3):
            result = await tool.call(_ctx(db_session, svc), {
                "shot": {"index": index, "scene": "咖啡店", "action": f"林尘动作{index}"},
                "characters": [{"asset_id": "char-1", "name": "林尘"}],
            })
            ref_id_sets.append(set(result["reference_asset_ids"]))
            prompts.append(result["prompt"])

        # 三个分镜解析出完全相同的引用集合
        assert ref_id_sets[0] == ref_id_sets[1] == ref_id_sets[2]
        assert "char-1" in ref_id_sets[0]
        # 三个分镜的提示词都携带同一角色身份锚点
        for prompt in prompts:
            assert "林尘" in prompt
        # 三个分镜请求都携带同一角色参考图
        for request in svc.requests:
            assert "https://example.com/char.png" in request.reference_urls
