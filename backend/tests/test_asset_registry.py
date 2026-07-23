"""资产复用层测试。"""
import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import Base
from app.models import Asset, _ensure_story_entity
from app.routers.assets import identify_asset, router as assets_router, search_assets_api
from app.schemas import AssetIdentifyRequest
from app.agent.tools.asset_registry_helpers import search_assets, group_by_entity
from app.agent.tools.asset_registry_tools import SearchProjectAssetsTool
from app.agent.tools.base import ToolContext


@pytest.fixture
def db_session():
    """In-memory sqlite — 不污染真实 DB（与 test_providers_crud 一致的做法）。"""
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


class TestStoryEntityId:
    def test_ensure_story_entity_generates_id_from_name(self):
        """资产有 name 但没 story_entity_id 时，用 name 生成确定性 ID。"""
        asset = Asset(
            id="a1", project_id="p1", kind="image",
            asset_kind="character", name="林尘",
        )
        assert asset.story_entity_id is None
        _ensure_story_entity(asset)
        assert asset.story_entity_id is not None
        assert len(asset.story_entity_id) == 16
        assert asset.story_entity_name == "林尘"

    def test_ensure_story_entity_is_deterministic(self):
        """同一 project_id + asset_kind + name 生成同一 entity_id。"""
        a1 = Asset(id="a1", project_id="p1", kind="image", asset_kind="character", name="林尘")
        a2 = Asset(id="a2", project_id="p1", kind="image", asset_kind="character", name="林尘")
        _ensure_story_entity(a1)
        _ensure_story_entity(a2)
        assert a1.story_entity_id == a2.story_entity_id

    def test_ensure_story_entity_differs_by_project(self):
        """不同项目的同名资产生成不同 entity_id。"""
        a1 = Asset(id="a1", project_id="p1", kind="image", asset_kind="character", name="林尘")
        a2 = Asset(id="a2", project_id="p2", kind="image", asset_kind="character", name="林尘")
        _ensure_story_entity(a1)
        _ensure_story_entity(a2)
        assert a1.story_entity_id != a2.story_entity_id

    def test_ensure_story_entity_skips_if_already_set(self):
        """已有 story_entity_id 时不覆盖。"""
        asset = Asset(
            id="a1", project_id="p1", kind="image",
            asset_kind="character", name="林尘",
            story_entity_id="existing_id",
        )
        _ensure_story_entity(asset)
        assert asset.story_entity_id == "existing_id"

    def test_ensure_story_entity_skips_if_no_name(self):
        """没有 name 时不生成 entity_id。"""
        asset = Asset(id="a1", project_id="p1", kind="image", asset_kind="character")
        _ensure_story_entity(asset)
        assert asset.story_entity_id is None


class TestSearchAssets:
    def _make_asset(self, db, **kwargs):
        """辅助：创建并保存一个 Asset。"""
        defaults = dict(
            id=f"a-{kwargs.get('name', 'x')}",
            project_id="p1", kind="image", name="test",
        )
        defaults.update(kwargs)
        from app.models import Asset
        a = Asset(**defaults)
        db.add(a)
        db.commit()
        return a

    def test_search_by_name_returns_matching(self, db_session):
        """按 name 模糊匹配返回资产。"""
        self._make_asset(db_session, name="林尘角色卡", asset_kind="character")
        results = search_assets(db_session, "p1", "林尘")
        assert len(results) == 1
        assert results[0]["name"] == "林尘角色卡"

    def test_search_by_asset_kind_filters(self, db_session):
        """asset_kind 精确过滤。"""
        self._make_asset(db_session, id="a1", name="林尘", asset_kind="character")
        self._make_asset(db_session, id="a2", name="林尘", asset_kind="prop")
        results = search_assets(db_session, "p1", "林尘", asset_kind="character")
        assert len(results) == 1
        assert results[0]["asset_kind"] == "character"

    def test_search_excludes_failed(self, db_session):
        """排除 failed 资产。"""
        self._make_asset(db_session, name="林尘", asset_kind="character", failed=True)
        results = search_assets(db_session, "p1", "林尘")
        assert len(results) == 0

    def test_search_excludes_generating(self, db_session):
        """排除 generating 资产。"""
        self._make_asset(db_session, name="林尘", asset_kind="character", generating=True)
        results = search_assets(db_session, "p1", "林尘")
        assert len(results) == 0

    def test_search_excludes_unidentified_by_default(self, db_session):
        """默认排除未标识资产（asset_kind=NULL 且 inspection_status=pending）。"""
        self._make_asset(
            db_session, name="upload1", asset_kind=None,
            inspection_status="pending",
        )
        results = search_assets(db_session, "p1", "upload1")
        assert len(results) == 0

    def test_search_includes_unidentified_when_flag_set(self, db_session):
        """include_unidentified=True 时包含未标识资产。"""
        self._make_asset(
            db_session, name="upload1", asset_kind=None,
            inspection_status="pending",
        )
        results = search_assets(db_session, "p1", "upload1", include_unidentified=True)
        assert len(results) == 1

    def test_search_returns_empty_when_no_match(self, db_session):
        """无匹配返回空列表。"""
        self._make_asset(db_session, name="林尘", asset_kind="character")
        results = search_assets(db_session, "p1", "不存在的名字")
        assert results == []

    def test_search_matches_title(self, db_session):
        """title 也能匹配。"""
        self._make_asset(
            db_session, name="x", title="林尘的冒险",
            asset_kind="character",
        )
        results = search_assets(db_session, "p1", "林尘")
        assert len(results) == 1


class TestGroupByEntity:
    def test_groups_by_story_entity_id(self):
        """按 story_entity_id 聚合。"""
        assets = [
            {"id": "a1", "name": "林尘角色卡", "story_entity_id": "e1", "story_entity_name": "林尘", "asset_kind": "character"},
            {"id": "a2", "name": "林尘概念图", "story_entity_id": "e1", "story_entity_name": "林尘", "asset_kind": "character"},
            {"id": "a3", "name": "咖啡杯", "story_entity_id": "e2", "story_entity_name": "咖啡杯", "asset_kind": "prop"},
        ]
        result = group_by_entity(assets)
        assert result["total_entities"] == 2
        assert result["total_assets"] == 3
        entities = {e["story_entity_id"]: e for e in result["entities"]}
        assert len(entities["e1"]["assets"]) == 2
        assert len(entities["e2"]["assets"]) == 1

    def test_groups_null_entity_id_separately(self):
        """story_entity_id=NULL 的资产各自独立。"""
        assets = [
            {"id": "a1", "name": "x", "story_entity_id": None, "story_entity_name": None, "asset_kind": "character"},
            {"id": "a2", "name": "y", "story_entity_id": None, "story_entity_name": None, "asset_kind": "character"},
        ]
        result = group_by_entity(assets)
        assert result["total_entities"] == 2
        assert result["total_assets"] == 2


class TestSearchProjectAssetsTool:
    def test_metadata(self):
        t = SearchProjectAssetsTool()
        assert t.name == "search_project_assets"
        assert t.category == "asset"
        assert t.requires_approval is False
        assert {"query"} <= {p.name for p in t.parameters}

    @pytest.mark.asyncio
    async def test_returns_grouped_results(self, db_session):
        """工具返回按 entity 聚合的结果。"""
        from app.models import Asset
        db_session.add(Asset(
            id="a1", project_id="p1", kind="image",
            asset_kind="character", name="林尘",
        ))
        db_session.commit()

        ctx = ToolContext(task_id="t1", project_id="p1", db=db_session)
        result = await SearchProjectAssetsTool().call(ctx, {"query": "林尘"})
        assert "entities" in result
        assert result["total_assets"] == 1
        assert result["entities"][0]["story_entity_name"] == "林尘"

    @pytest.mark.asyncio
    async def test_returns_empty_when_no_match(self, db_session):
        ctx = ToolContext(task_id="t1", project_id="p1", db=db_session)
        result = await SearchProjectAssetsTool().call(ctx, {"query": "不存在"})
        assert result["total_assets"] == 0
        assert result["entities"] == []

    @pytest.mark.asyncio
    async def test_filters_by_asset_kind(self, db_session):
        from app.models import Asset
        db_session.add(Asset(id="a1", project_id="p1", kind="image", asset_kind="character", name="林尘"))
        db_session.add(Asset(id="a2", project_id="p1", kind="image", asset_kind="prop", name="林尘"))
        db_session.commit()

        ctx = ToolContext(task_id="t1", project_id="p1", db=db_session)
        result = await SearchProjectAssetsTool().call(ctx, {
            "query": "林尘", "asset_kind": "character",
        })
        assert result["total_assets"] == 1
        assert result["entities"][0]["asset_kind"] == "character"


def _find_route(path: str, method: str):
    """从 assets_router 中按 path+method 找路由对象（path 不含 /api/assets 前缀）。"""
    for route in assets_router.routes:
        if getattr(route, "path", None) == path and method in (getattr(route, "methods", set()) or set()):
            return route
    return None


class TestSearchAssetsAPI:
    """GET /api/assets/search 端点测试。

    直接调用路由处理函数（FastAPI 路由到的同一个函数）验证行为，避开
    TestClient——本机 WinError 10055（系统套接字缓冲区耗尽）导致 anyio
    blocking portal 无法创建。这等价于 ASGI 层调用：处理函数签名、依赖
    注入后的 db session 与真实请求一致。路由注册 + Query 校验声明由
    test_search_empty_query_returns_422 单独覆盖。
    """

    def test_search_returns_results(self, db_session):
        """API 搜索返回聚合结果。"""
        db_session.add(Asset(
            id="a1", project_id="p1", kind="image",
            asset_kind="character", name="林尘",
        ))
        db_session.commit()

        result = search_assets_api(project_id="p1", q="林尘", db=db_session)
        assert result["total_assets"] == 1
        assert result["entities"][0]["story_entity_name"] == "林尘"

    def test_search_empty_query_returns_422(self):
        """q 为空串时 Query(min_length=1) 校验失败返回 422。

        校验发生在 ASGI 层（请求体进入处理函数前），无法通过直接调用函数触发，
        故改为检查路由声明：确认 q 参数 required 且 min_length=1，这是 FastAPI
        产生 422 的根因。
        """
        route = _find_route("/search", "GET")
        assert route is not None, "GET /api/assets/search 路由未注册"
        q_param = next(p for p in route.dependant.query_params if p.name == "q")
        # min_length 存于 field_info.metadata 的 MinLen 约束里
        min_len = next(
            (getattr(m, "min_length", None) for m in q_param.field_info.metadata if hasattr(m, "min_length")),
            None,
        )
        assert min_len == 1, f"q 的 min_length 应为 1（空串触发 422），实际 {min_len}"
        assert q_param.field_info.is_required(), "q 应为必填"


class TestIdentifyAssetAPI:
    """POST /api/assets/{asset_id}/identify 端点测试。

    同 TestSearchAssetsAPI，直接调用路由处理函数验证行为。
    """

    def test_identify_updates_asset(self, db_session):
        """手动标识上传资产：写入 asset_kind/name，生成 story_entity_id，标记 ready。"""
        db_session.add(Asset(
            id="a1", project_id="p1", kind="image",
            name="upload1", inspection_status="pending",
        ))
        db_session.commit()

        payload = AssetIdentifyRequest(asset_kind="character", name="林尘")
        result = identify_asset("a1", payload, db=db_session)

        assert result["asset_kind"] == "character"
        assert result["name"] == "林尘"
        assert result["inspection_status"] == "ready"
        assert result["story_entity_id"] is not None

        # 验证 DB 真的持久化了
        db_asset = db_session.get(Asset, "a1")
        assert db_asset.asset_kind == "character"
        assert db_asset.inspection_status == "ready"
        assert db_asset.story_entity_id is not None

    def test_identify_404_for_missing_asset(self, db_session):
        """标识不存在的资产返回 404。"""
        payload = AssetIdentifyRequest(asset_kind="character", name="林尘")
        with pytest.raises(HTTPException) as exc_info:
            identify_asset("nonexistent", payload, db=db_session)
        assert exc_info.value.status_code == 404


from app.agent.llm import ASSET_INTELLIGENCE_POLICY


class TestAssetReusePolicy:
    def test_policy_contains_reuse_rules(self):
        """系统提示包含资产复用规则。"""
        assert "search_project_assets" in ASSET_INTELLIGENCE_POLICY
        assert "ASSET_REUSE_PREVIEW" in ASSET_INTELLIGENCE_POLICY
        assert "reference_asset_ids" in ASSET_INTELLIGENCE_POLICY
        assert "inspect_asset" in ASSET_INTELLIGENCE_POLICY
