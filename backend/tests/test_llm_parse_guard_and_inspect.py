"""回归测试：LLM 解析失败守卫 + inspect_asset 资产保护。

背景（线上真实事故链）：
1. deepseek 返回空 content / 非法 JSON → generate_script 静默降级为
   {"scenes": []} 标 success 并落库空脚本资产；extract_characters 两次返回
   {"characters": []} 也标 success。
2. agent 拿空脚本调 inspect_asset → 视觉检查把 markdown 当图片 URL 发给
   vision LLM，且 asset_kind 被 LLM 返回的 "missing" 无条件覆盖，
   脚本资产损坏（read_text_asset 拒绝读取），任务卡死无报错。

修复契约：
- 解析失败（非 JSON / 缺目标 list 字段）→ RuntimeError，step 记 failed；
- 合法 JSON 但数组为空 → 保持现状返回空（不误伤）；
- generate_script 解析失败时不得 save_asset 落库；
- inspect_asset 拒绝非视觉资产；无效 asset_type 不覆盖原 asset_kind。
"""
import json
from unittest.mock import MagicMock

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import Base
from app.models import Asset
from app.agent.asset_intelligence import inspect_asset
from app.agent.llm import LLMResponse
from app.agent.tools.base import RetryableError, ToolContext
from app.agent.tools.asset_intelligence_tools import InspectAssetTool
from app.agent.tools.llm_tools import (
    GenerateScriptTool,
    ExtractCharactersTool,
    ExtractPropsTool,
    ExtractScenesTool,
    ExtractShotsTool,
)


def _stub_llm(content):
    class _StubLLM:
        async def generate(self, messages, tools=None, **kwargs):
            return LLMResponse(content=content)

    return _StubLLM()


def _mock_db():
    db = MagicMock()
    chain = MagicMock()
    chain.filter.return_value.order_by.return_value.first.return_value = None
    db.query.return_value = chain
    return db


# ========================
# Bug 1：generate_script 解析失败 → 抛错且不落库
# ========================

@pytest.mark.asyncio
async def test_generate_script_raises_on_invalid_json_and_does_not_save():
    """LLM 返回非法 JSON → RuntimeError，且不得 save_asset 落库空脚本。"""
    db = _mock_db()
    ctx = ToolContext(
        task_id="t1", project_id="p1", db=db,
        llm_client=_stub_llm("这不是 JSON，模型输出坏了"),
    )
    with pytest.raises(RetryableError, match="分场脚本"):
        await GenerateScriptTool().call(ctx, {"novel_text": "林尘走进咖啡店..."})
    assert not db.add.called, "解析失败时不得落库空脚本资产"
    assert not db.commit.called


@pytest.mark.asyncio
async def test_generate_script_raises_on_empty_content():
    """LLM 返回空 content（deepseek 常见）→ RuntimeError，不落库。"""
    db = _mock_db()
    ctx = ToolContext(
        task_id="t1", project_id="p1", db=db,
        llm_client=_stub_llm(""),
    )
    with pytest.raises(RetryableError, match="分场脚本"):
        await GenerateScriptTool().call(ctx, {"novel_text": "林尘走进咖啡店..."})
    assert not db.add.called


@pytest.mark.asyncio
async def test_generate_script_raises_when_scenes_field_missing():
    """JSON 合法但缺 scenes 字段（或不是 list）→ 视为解析失败抛错。"""
    db = _mock_db()
    ctx = ToolContext(
        task_id="t1", project_id="p1", db=db,
        llm_client=_stub_llm(json.dumps({"characters": []})),
    )
    with pytest.raises(RetryableError, match="scenes"):
        await GenerateScriptTool().call(ctx, {"novel_text": "林尘走进咖啡店..."})
    assert not db.add.called


@pytest.mark.asyncio
async def test_generate_script_allows_legit_empty_scenes():
    """合法 JSON 且 scenes 确实为空数组 → 保持现状返回空，不抛错。"""
    db = _mock_db()
    ctx = ToolContext(
        task_id="t1", project_id="p1", db=db,
        llm_client=_stub_llm(json.dumps({"scenes": []})),
    )
    result = await GenerateScriptTool().call(ctx, {"novel_text": "林尘走进咖啡店..."})
    assert result["scenes"] == []


# ========================
# Bug 1：extract_* 解析失败 → 抛错
# ========================

@pytest.mark.asyncio
async def test_extract_characters_raises_on_invalid_json():
    ctx = ToolContext(
        task_id="t1",
        llm_client=_stub_llm("{"),  # 截断 JSON（max_tokens 不够的典型症状）
    )
    with pytest.raises(RetryableError, match="角色提取"):
        await ExtractCharactersTool().call(ctx, {"script": {"scenes": []}})


@pytest.mark.asyncio
async def test_extract_characters_raises_on_empty_content():
    ctx = ToolContext(task_id="t1", llm_client=_stub_llm(None))
    with pytest.raises(RetryableError, match="角色提取"):
        await ExtractCharactersTool().call(ctx, {"script": {"scenes": []}})


@pytest.mark.asyncio
async def test_extract_characters_allows_legit_empty_list():
    """合法 JSON 但 characters 确实为空 → 返回空数组，不抛错。"""
    ctx = ToolContext(
        task_id="t1",
        llm_client=_stub_llm(json.dumps({"characters": []})),
    )
    result = await ExtractCharactersTool().call(ctx, {"script": {"scenes": []}})
    assert result == {"characters": []}


@pytest.mark.asyncio
async def test_extract_props_raises_on_invalid_json():
    ctx = ToolContext(task_id="t1", llm_client=_stub_llm("no json here"))
    with pytest.raises(RetryableError, match="道具提取"):
        await ExtractPropsTool().call(ctx, {"script": {}})


@pytest.mark.asyncio
async def test_extract_scenes_raises_on_invalid_json():
    ctx = ToolContext(task_id="t1", llm_client=_stub_llm("```json\n{\"scenes\": [未闭合"))
    with pytest.raises(RetryableError, match="场景提取"):
        await ExtractScenesTool().call(ctx, {"script": {}})


@pytest.mark.asyncio
async def test_extract_shots_raises_on_invalid_json():
    ctx = ToolContext(task_id="t1", llm_client=_stub_llm("分镜如下：……"))
    with pytest.raises(RetryableError, match="分镜提取"):
        await ExtractShotsTool().call(ctx, {"script": {}})


# ========================
# Bug 2：inspect_asset 资产保护
# ========================

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


class _VisionLLM:
    def __init__(self, content: str):
        self._content = content
        self.called = False

    async def generate_structured(self, messages, **kwargs):
        self.called = True
        return LLMResponse(content=self._content)


@pytest.mark.asyncio
async def test_inspect_asset_rejects_text_asset_and_preserves_asset_kind(db_session):
    """kind=text 的脚本资产 → 报错且不做视觉检查，asset_kind 不变。"""
    asset = Asset(
        id="script-1",
        project_id="project-a",
        kind="text",
        asset_kind="script",
        name="分场脚本",
        url="# 分场脚本\n\n第1场 · 开场\n...",
        origin="generated",
        inspection_status="pending",
    )
    db_session.add(asset)
    db_session.commit()

    llm = _VisionLLM('{"asset_type":"missing"}')
    with pytest.raises(ValueError, match="视觉资产"):
        await inspect_asset(db_session, "project-a", "script-1", llm)

    assert not llm.called, "文本资产不得发起视觉 LLM 调用"
    row = db_session.query(Asset).filter_by(id="script-1").one()
    assert row.asset_kind == "script", "文本资产的 asset_kind 不得被改写"


@pytest.mark.asyncio
async def test_inspect_asset_tool_routes_text_assets_to_text_reader(db_session):
    """Agent 误选 inspect_asset 时，小说/脚本应自动读取而不是产生视觉检查失败。"""
    asset = Asset(
        id="novel-1",
        project_id="project-a",
        kind="text",
        asset_kind="novel",
        name="扩写小说",
        url="第一章\n完整故事正文",
        extra={"body": "第一章\n完整故事正文"},
        origin="generated",
    )
    db_session.add(asset)
    db_session.commit()

    ctx = ToolContext(task_id="t1", project_id="project-a", db=db_session, llm_client=None)
    result = await InspectAssetTool().call(ctx, {"asset_id": "novel-1"})

    assert result["ok"] is True
    assert result["routed_tool"] == "read_text_asset"
    assert result["text_asset"]["items"][0]["body"] == "第一章\n完整故事正文"


@pytest.mark.asyncio
async def test_inspect_asset_keeps_original_kind_when_llm_returns_missing(db_session):
    """LLM 返回 asset_type='missing' → 保留原 asset_kind，其余字段照写。"""
    asset = Asset(
        id="uploaded-prop",
        project_id="project-a",
        kind="image",
        asset_kind="prop",
        name="道具图",
        url="/files/prop.png",
        origin="uploaded",
        inspection_status="pending",
    )
    db_session.add(asset)
    db_session.commit()

    llm = _VisionLLM('{"asset_type":"missing","confidence":0.2,"meets_standard":false}')
    result = await inspect_asset(db_session, "project-a", "uploaded-prop", llm)

    row = db_session.query(Asset).filter_by(id="uploaded-prop").one()
    assert row.asset_kind == "prop", "无效 asset_type='missing' 不得覆盖原 asset_kind"
    assert row.inspection.get("asset_type") == "missing", "inspection 结果照写"
    assert result["asset_type"] == "missing"


@pytest.mark.asyncio
async def test_inspect_asset_keeps_original_kind_when_llm_returns_unknown_or_blank(db_session):
    """LLM 返回 'unknown' / 空值 → 同样不得覆盖原 asset_kind。"""
    for idx, payload in enumerate(
        ('{"asset_type":"unknown","confidence":0.1}', '{"confidence":0.0}')
    ):
        asset = Asset(
            id=f"uploaded-scene-{idx}",
            project_id="project-a",
            kind="image",
            asset_kind="scene",
            name="场景图",
            url="/files/scene.png",
            origin="uploaded",
            inspection_status="pending",
        )
        db_session.add(asset)
    db_session.commit()

    for idx, payload in enumerate(
        ('{"asset_type":"unknown","confidence":0.1}', '{"confidence":0.0}')
    ):
        await inspect_asset(
            db_session, "project-a", f"uploaded-scene-{idx}", _VisionLLM(payload)
        )
        row = db_session.query(Asset).filter_by(id=f"uploaded-scene-{idx}").one()
        assert row.asset_kind == "scene"


@pytest.mark.asyncio
async def test_inspect_asset_writes_back_valid_asset_type(db_session):
    """LLM 返回有效类型（character）→ 正常回写 asset_kind。"""
    asset = Asset(
        id="uploaded-new",
        project_id="project-a",
        kind="image",
        asset_kind=None,
        name="新上传图",
        url="/files/new.png",
        origin="uploaded",
        inspection_status="pending",
    )
    db_session.add(asset)
    db_session.commit()

    llm = _VisionLLM(
        '{"asset_type":"character","confidence":0.95,"meets_standard":true}'
    )
    await inspect_asset(db_session, "project-a", "uploaded-new", llm)

    row = db_session.query(Asset).filter_by(id="uploaded-new").one()
    assert row.asset_kind == "character"
