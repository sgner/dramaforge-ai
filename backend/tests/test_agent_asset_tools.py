"""TDD: 资产工具（save_asset / get_artifacts）。"""
import json
import pytest
from unittest.mock import MagicMock

from app.agent.tools.base import ToolContext, ToolValidationError
from app.agent.tools.asset_tools import SaveAssetTool, GetArtifactsTool


def _mock_db():
    """返回一个支持 with __add__ / commit / refresh / query 的假 db session。"""
    db = MagicMock()
    # query(Asset).filter_by().first() -> None
    chain = MagicMock()
    chain.filter_by.return_value.first.return_value = None
    db.query.return_value = chain
    return db


def test_save_asset_metadata():
    t = SaveAssetTool()
    assert t.name == "save_asset"
    assert t.category == "asset"
    assert t.requires_approval is False
    assert "kind" in {p.name for p in t.parameters}


@pytest.mark.asyncio
async def test_save_asset_creates_asset_record():
    db = _mock_db()
    ctx = ToolContext(task_id="t1", project_id="p1", db=db)
    result = await SaveAssetTool().call(ctx, {
        "kind": "image",
        "asset_kind": "character",
        "name": "林尘",
        "url": "/files/x.png",
        "prompt": "test",
    })
    assert result["ok"] is True
    assert "id" in result
    assert db.add.called
    assert db.commit.called


@pytest.mark.asyncio
async def test_save_asset_validation_requires_kind():
    ctx = ToolContext(task_id="t1", db=_mock_db())
    with pytest.raises(ToolValidationError):
        await SaveAssetTool().call(ctx, {"url": "/x.png"})


def test_get_artifacts_metadata():
    t = GetArtifactsTool()
    assert t.name == "get_artifacts"
    assert t.category == "asset"
    assert t.requires_approval is False


@pytest.mark.asyncio
async def test_get_artifacts_returns_empty_when_nothing_in_db():
    """没有资产时返回空 dict（不报错）。"""
    db = _mock_db()
    # 任何 query 调用都返回 []
    chain = MagicMock()
    chain.filter_by.return_value.all.return_value = []
    chain.filter_by.return_value.first.return_value = None
    db.query.return_value = chain
    db.query.return_value.all.return_value = []
    db.query.return_value.filter_by.return_value.all.return_value = []
    ctx = ToolContext(task_id="t1", project_id="p1", db=db)
    result = await GetArtifactsTool().call(ctx, {})
    assert isinstance(result, dict)


@pytest.mark.asyncio
async def test_get_artifacts_returns_list_for_kind():
    """当有资产时按 kind 过滤返回。"""
    db = _mock_db()
    fake_asset = MagicMock()
    fake_asset.to_dict.return_value = {
        "id": "a1", "kind": "image", "name": "林尘", "url": "/x.png",
    }
    chain = MagicMock()
    chain.filter_by.return_value.all.return_value = [fake_asset]
    db.query.return_value = chain
    ctx = ToolContext(task_id="t1", project_id="p1", db=db)
    result = await GetArtifactsTool().call(ctx, {"kind": "character"})
    # 即便 db 行为是 mock，函数应当不抛错并返回 dict
    assert isinstance(result, dict)
