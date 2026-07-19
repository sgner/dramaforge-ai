"""分镜参考图解析测试：资产名文本出现兜底（工具路径 + 批量路径）。"""
import pytest

from app.agent.media_service import MediaResult
from app.agent.prompt_engineering import (
    collect_storyboard_reference_asset_ids,
    resolve_reference_ids_by_text,
)
from app.agent.tools.base import ToolContext
from app.agent.tools.media_batch import GenerateMediaBatchTool


def _artifacts():
    return {
        "character": [
            {"id": "char-1", "name": "陈默", "url": "https://cdn.test/chenmo.png"},
            {"id": "char-2", "name": "失败角色", "url": "x", "failed": True},
        ],
        "scene": [
            {"id": "scene-1", "name": "穿越天花板", "url": "https://cdn.test/scene.png"},
        ],
        "prop": [
            {"id": "prop-1", "name": "手电筒", "url": "https://cdn.test/torch.png"},
        ],
    }


def test_resolve_by_text_matches_names_in_shot_text():
    arts = _artifacts()
    ids = resolve_reference_ids_by_text(arts, "陈默在第3场·穿越天花板中站起，举起手电筒")
    assert ids == ["scene-1", "char-1", "prop-1"]  # 顺序 scene→character→prop
    # 失败/生成中资产不匹配
    assert "char-2" not in ids
    # 空文本 / 无 artifacts
    assert resolve_reference_ids_by_text(arts, "") == []
    assert resolve_reference_ids_by_text(None, "陈默") == []
    # 单字符名不匹配（防误伤）
    arts2 = {"character": [{"id": "c", "name": "王", "url": "u"}]}
    assert resolve_reference_ids_by_text(arts2, "王子来了") == []


def test_collector_falls_back_to_text_matching():
    """shot 卡没有 characters 字段、scene 带'第3场 · '前缀时，也能解析出引用。"""
    params = {
        "shot": {
            "scene": "第3场 · 穿越天花板",
            "action": "陈默站起，手电筒扫过墙面",
        }
    }
    ids = collect_storyboard_reference_asset_ids(params, _artifacts())
    assert "scene-1" in ids
    assert "char-1" in ids
    assert "prop-1" in ids


@pytest.mark.asyncio
async def test_batch_storyboard_job_resolves_refs():
    """批量分镜 job：按 name/prompt 文本解析参考图，结果带 reference_asset_ids。"""
    captured = []

    class _Svc:
        async def generate(self, request):
            captured.append(request)
            return MediaResult(url="https://cdn.test/board.png", kind=request.kind)

    ctx = ToolContext(
        task_id="t1",
        llm_client=None,
        media_service=_Svc(),
        artifacts=_artifacts(),
    )
    out = await GenerateMediaBatchTool().call(ctx, {
        "jobs": [{
            "kind": "image", "asset_kind": "storyboard", "name": "分镜_陈默穿越天花板",
            "prompt": "陈默拿出手电筒",
        }],
    })
    item = out["results"][0]
    assert item["success"] is True
    assert set(item["reference_asset_ids"]) == {"char-1", "scene-1", "prop-1"}
    # ctx.db 为空时不解析 URL，但 id 仍记录在结果里
    assert item["reference_urls"] == []


@pytest.mark.asyncio
async def test_batch_non_storyboard_untouched():
    """非分镜 job 不做文本引用解析。"""
    captured = []

    class _Svc:
        async def generate(self, request):
            captured.append(request)
            return MediaResult(url="https://cdn.test/x.png", kind=request.kind)

    ctx = ToolContext(task_id="t1", llm_client=None, media_service=_Svc(), artifacts=_artifacts())
    out = await GenerateMediaBatchTool().call(ctx, {
        "jobs": [{"kind": "image", "asset_kind": "character", "name": "陈默", "prompt": "陈默的设定图"}],
    })
    item = out["results"][0]
    assert item["reference_asset_ids"] == []
    assert captured[0].reference_urls == []
