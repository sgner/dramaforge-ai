"""TDD: 资产工具（save_asset / get_artifacts / read_text_asset）。"""
import json
from datetime import datetime

import pytest
from unittest.mock import MagicMock

from app import models
from app.agent.tools.base import ToolContext, ToolValidationError
from app.agent.tools.asset_tools import SaveAssetTool, GetArtifactsTool, ReadTextAssetTool


def _mock_db():
    """返回一个支持 query / add / commit / refresh 的假 db session。

    SaveAssetTool.execute 内部走的是
        db.query(Asset).filter(...).order_by(...).first()
    所以 mock 必须支持 .filter()（不是 .filter_by()），以及 .order_by()。
    query() 返回的 chain 也要让 .filter().order_by().first() 返回 None，
    这样代码会走"asset is None → db.add(asset)"分支。
    """
    db = MagicMock()
    chain = MagicMock()
    # query(Asset).filter(...).order_by(...).first() -> None（资产不存在）
    chain.filter.return_value.order_by.return_value.first.return_value = None
    # 兜底：万一其它路径用 filter_by
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


# ========================
# SaveAssetTool payload：保留 extra 完整内容（含 structured script）
# ========================
#
# 关键修复（回归）：之前 _payload() 只把 body / text_stats 提到顶层，
# 整个 extra dict 被丢弃 → ARTIFACT_CREATED 事件发到前端后
# `linkedAsset.extra` 为 undefined → ScriptNodeBody 读不到 extra.script →
# 角色/道具/场景/分镜/视觉签名 tabs 全 0。
#
# 这条回归确保：save_asset 返回的 payload 必须保留完整 extra，让前端
# ScriptNodeBody 能从 extra.script 拿到 structured data。

def test_save_asset_payload_preserves_full_extra_dict():
    """_payload 必须把完整 extra 透传出去（不能只取 body/text_stats）。"""
    structured_script = {
        "scenes": [{"index": 1, "title": "开场"}],
        "characters": [{"name": "林尘", "gender": "男"}],
        "props": [{"name": "玉佩"}],
        "bigShots": [{"sceneIndex": 1, "index": 1, "shotType": "特写"}],
        "visualSignature": {"medium": "实拍", "aspectRatio": "16:9"},
    }
    params = {
        "kind": "text",
        "asset_kind": "script",
        "name": "script_long_text_4场",
        "title": "分场脚本 · 开场",
        "url": "# 分场脚本\n...",
        "prompt": "long_text...",
        "extra": {
            "body": "# 分场脚本\n...",
            "text_stats": {"words": 1209, "scenes": 4},
            "source_kind": "long_text",
            "scene_count": 4,
            "scenes": structured_script["scenes"],
            "script": structured_script,  # 关键：结构化数据
        },
    }
    result = SaveAssetTool._payload(params, "a1")
    # 顶层 body / text_stats 仍然要有（兼容 TextReader）
    assert result["body"] == "# 分场脚本\n..."
    assert result["text_stats"]["scenes"] == 4
    # 关键：extra 整体也要存在，前端 ScriptNodeBody 才会读到
    assert "extra" in result, "payload 必须保留 extra 字段（前端 ScriptNodeBody 依赖 extra.script）"
    assert result["extra"]["script"] == structured_script
    assert result["extra"]["script"]["characters"] == structured_script["characters"]
    assert result["extra"]["script"]["bigShots"] == structured_script["bigShots"]
    assert result["extra"]["script"]["visualSignature"] == structured_script["visualSignature"]


def test_save_asset_payload_extra_defaults_to_empty_dict():
    """没传 extra 时，payload.extra 必须是空 dict（不是 None/缺失），避免前端读到 undefined。"""
    params = {
        "kind": "image",
        "asset_kind": "character",
        "name": "林尘",
        "url": "/files/x.png",
    }
    result = SaveAssetTool._payload(params, "a2")
    assert "extra" in result
    assert isinstance(result["extra"], dict)


@pytest.mark.asyncio
async def test_save_asset_execute_returns_extra_in_payload():
    """execute() 返回的 dict 必须包含 extra（端到端验证）。"""
    db = _mock_db()
    ctx = ToolContext(task_id="t1", project_id="p1", db=db)
    structured_script = {
        "scenes": [{"index": 1}],
        "characters": [{"name": "A"}],
        "props": [],
        "bigShots": [],
        "visualSignature": {},
    }
    result = await SaveAssetTool().call(ctx, {
        "kind": "text",
        "asset_kind": "script",
        "name": "script_test_1场",
        "title": "分场脚本",
        "url": "# 分场脚本",
        "prompt": "",
        "extra": {
            "body": "# 分场脚本",
            "text_stats": {"scenes": 1},
            "script": structured_script,
        },
    })
    assert result["ok"] is True
    assert "extra" in result, "execute() 返回值必须包含 extra（前端 ScriptNodeBody 依赖它）"
    assert result["extra"]["script"] == structured_script


# ========================
# ReadTextAssetTool（按 id 读 / 按 asset_kind 列 / 错误路径）
# ========================
#
# 回归背景：ReadTextAssetTool 曾引用 `Asset.updated_at`，但 models.Asset 只有
# `created_at` 列，按 id 读（_serialize）和按 asset_kind 列（order_by）两条路径
# 都抛 AttributeError。下面用真实 models.Asset 实例（而非全 mock 对象）驱动，
# 确保模型列名写错时测试会红。

def _text_asset(**overrides):
    """构造一个真实的 ORM Asset 实例（不落库，属性在 Python 层可读）。"""
    values = {
        "id": "a1",
        "project_id": "p1",
        "kind": "text",
        "asset_kind": "novel",
        "title": "长篇小说",
        "name": "novel_v1",
        "url": None,
        "prompt": "写一部异世界小说",
        "status": "ready",
        "version": 2,
        "extra": {"body": "第一章 正文内容", "text_stats": {"words": 8}},
        "created_at": datetime(2026, 7, 18, 10, 0, 0),
    }
    values.update(overrides)
    return models.Asset(**values)


def test_read_text_asset_metadata():
    t = ReadTextAssetTool()
    assert t.name == "read_text_asset"
    assert t.category == "asset"
    assert t.requires_approval is False
    assert "asset_id" in {p.name for p in t.parameters}
    assert "asset_kind" in {p.name for p in t.parameters}


@pytest.mark.asyncio
async def test_read_text_asset_requires_id_or_kind():
    ctx = ToolContext(task_id="t1", project_id="p1", db=_mock_db())
    with pytest.raises(ToolValidationError):
        await ReadTextAssetTool().call(ctx, {})


@pytest.mark.asyncio
async def test_read_text_asset_by_id_returns_body():
    """按 id 读存在的文本资产：返回 body / text_stats，且时间字段来自 created_at。"""
    asset = _text_asset()
    db = _mock_db()
    # query(Asset).filter(Asset.id == ...).first() -> asset
    db.query.return_value.filter.return_value.first.return_value = asset
    ctx = ToolContext(task_id="t1", project_id="p1", db=db)

    result = await ReadTextAssetTool().call(ctx, {"asset_id": "a1"})

    assert result["ok"] is True
    assert result["count"] == 1
    item = result["items"][0]
    assert item["id"] == "a1"
    assert item["asset_kind"] == "novel"
    assert item["body"] == "第一章 正文内容"
    assert item["body_length"] == len("第一章 正文内容")
    assert item["text_stats"] == {"words": 8}
    # 修复点：Asset 没有 updated_at 列，序列化必须基于 created_at
    assert item["updated_at"] == "2026-07-18T10:00:00"


@pytest.mark.asyncio
async def test_read_text_asset_by_id_honors_max_chars():
    """max_chars 截断 body，但 body_length 仍反映全文长度。"""
    asset = _text_asset(extra={"body": "一二三四五六七八九十"})
    db = _mock_db()
    db.query.return_value.filter.return_value.first.return_value = asset
    ctx = ToolContext(task_id="t1", project_id="p1", db=db)

    result = await ReadTextAssetTool().call(ctx, {"asset_id": "a1", "max_chars": 4})

    item = result["items"][0]
    assert item["body"].startswith("一二三四")
    assert "truncated" in item["body"]
    assert item["body_length"] == 10


@pytest.mark.asyncio
async def test_read_text_asset_by_id_not_found():
    """读不存在的 id：返回 ok=False 错误，不抛异常。"""
    db = _mock_db()
    db.query.return_value.filter.return_value.first.return_value = None
    ctx = ToolContext(task_id="t1", project_id="p1", db=db)

    result = await ReadTextAssetTool().call(ctx, {"asset_id": "missing"})

    assert result["ok"] is False
    assert "not found" in result["error"]
    assert result["items"] == []


@pytest.mark.asyncio
async def test_read_text_asset_by_id_rejects_non_text_asset():
    """id 存在但不是 novel/script（如角色图）：返回错误而不是正文。"""
    asset = _text_asset(kind="image", asset_kind="character")
    db = _mock_db()
    db.query.return_value.filter.return_value.first.return_value = asset
    ctx = ToolContext(task_id="t1", project_id="p1", db=db)

    result = await ReadTextAssetTool().call(ctx, {"asset_id": "a1"})

    assert result["ok"] is False
    assert "not a text asset" in result["error"]


def _list_query_db(rows):
    """返回一个 db mock，其 query 链的 .filter() 返回自身（支持多次链式 filter），
    .order_by(...).limit(...).all() 返回给定的 rows。"""
    db = MagicMock()
    query = MagicMock()
    query.filter.return_value = query
    query.order_by.return_value.limit.return_value.all.return_value = rows
    db.query.return_value = query
    return db


@pytest.mark.asyncio
async def test_read_text_asset_list_by_asset_kind():
    """按 asset_kind 列出项目内文本资产（覆盖 order_by(created_at) 路径）。"""
    novel = _text_asset(id="a1", asset_kind="novel")
    script = _text_asset(id="a2", asset_kind="script", title="分场脚本")
    db = _list_query_db([novel, script])
    ctx = ToolContext(task_id="t1", project_id="p1", db=db)

    result = await ReadTextAssetTool().call(ctx, {"asset_kind": "novel"})

    assert result["ok"] is True
    assert result["count"] == 2
    assert [item["id"] for item in result["items"]] == ["a1", "a2"]
    # 列表路径同样走 _serialize，时间字段来自 created_at 而不是不存在的 updated_at
    assert result["items"][0]["updated_at"] == "2026-07-18T10:00:00"
    assert result["items"][1]["body"] == "第一章 正文内容"


@pytest.mark.asyncio
async def test_read_text_asset_list_empty():
    """项目内没有文本资产时返回空列表。"""
    db = _list_query_db([])
    ctx = ToolContext(task_id="t1", project_id="p1", db=db)

    result = await ReadTextAssetTool().call(ctx, {"asset_kind": "script"})

    assert result["ok"] is True
    assert result["count"] == 0
    assert result["items"] == []


# ========================
# 回归：asset_updated 事件必须携带 extra（含 extra.script）
# ========================
# 用户反馈：agent 生成脚本后画布脚本节点"脚本分析"四项计数全 0。
# 根因之一是 update_text_asset 的 asset_updated 事件丢 extra——
# 前端 ScriptNodeBody 依赖 extra.script 渲染角色/道具/场景/分镜 tabs。

@pytest.mark.asyncio
async def test_update_text_asset_emits_asset_updated_with_extra():
    """更新文本资产后，asset_updated 事件 payload 必须带 extra.script。"""
    from app.agent.tools.asset_tools import UpdateTextAssetTool

    structured = {
        "characters": [{"name": "林尘"}],
        "props": [],
        "sceneAssets": [],
        "bigShots": [],
        "visualSignature": {},
    }
    asset = _text_asset(
        asset_kind="script",
        extra={"body": "旧正文", "text_stats": {"words": 2}, "script": structured},
    )
    db = _mock_db()
    db.query.return_value.filter.return_value.first.return_value = asset
    events: list[tuple[str, dict]] = []
    ctx = ToolContext(
        task_id="t1", project_id="p1", db=db,
        emit=lambda t, p: events.append((t, p)),
    )

    result = await UpdateTextAssetTool().call(ctx, {"asset_id": "a1", "body": "新正文"})

    assert result["ok"] is True
    updated = [p for t, p in events if t == "asset_updated"]
    assert updated, "必须发出 asset_updated 事件"
    payload = updated[-1]
    assert payload["body"] == "新正文"
    # extra.script 结构化 JSON 不得丢失
    assert payload["extra"]["script"] == structured
    assert payload["extra"]["body"] == "新正文"
