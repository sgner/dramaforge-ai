import asyncio
import time

import pytest

from app.agent.media_service import MediaResult
from app.agent.tools.base import ToolContext
from app.agent.tools.media_batch import GenerateMediaBatchTool


class _ParallelMediaService:
    def __init__(self):
        self.active = 0
        self.max_active = 0

    async def generate(self, request):
        self.active += 1
        self.max_active = max(self.max_active, self.active)
        try:
            await asyncio.sleep(0.05)
            if "fail" in request.prompt:
                raise RuntimeError("provider failed")
            return MediaResult(url=f"https://cdn.test/{request.kind}.bin", kind=request.kind)
        finally:
            self.active -= 1


class _PromptLLM:
    async def generate(self, messages, **kwargs):
        class Response:
            # 从用户消息里提取 "【原始 prompt】" 之后的实际 prompt 文本，
            # 模拟一个最小化的 LLM：返回 "optimized: <原 prompt>"。
            # 不透传整个 messages[-1] 是因为 _sanitize_optimized_prompt 会把
            # "原始 prompt" / "上下文" 这种 token 当成元描述并错误剥离。
            user_msg = messages[-1]["content"] if messages else ""
            prompt_text = user_msg
            if "【原始 prompt】" in user_msg:
                prompt_text = user_msg.split("【原始 prompt】", 1)[1]
                if "【上下文】" in prompt_text:
                    prompt_text = prompt_text.split("【上下文】", 1)[0]
            content = "optimized: " + prompt_text.strip()
        return Response()


@pytest.mark.asyncio
async def test_media_batch_runs_image_and_video_concurrently_and_isolates_failure():
    service = _ParallelMediaService()
    tool = GenerateMediaBatchTool()
    started = time.perf_counter()

    result = await tool.call(ToolContext(task_id="t1", media_service=service, llm_client=_PromptLLM()), {
        "jobs": [
            {"kind": "image", "prompt": "portrait"},
            {"kind": "video", "prompt": "fail video"},
        ],
    })

    assert time.perf_counter() - started < 0.09
    assert service.max_active == 2
    assert result["results"][0]["success"] is True
    assert result["results"][1]["success"] is False


@pytest.mark.asyncio
async def test_media_batch_character_job_keeps_sheet_layout():
    """线上回归：批量角色资产的 prompt 必须含 4 区域概念表布局段，
    且不再被 optimize LLM 二次改写。"""
    from app.agent.tools.image_tools import CHARACTER_DESIGN_SHEET_PROMPT

    captured = []

    class _Svc:
        async def generate(self, request):
            captured.append(request.prompt)
            return MediaResult(url="https://cdn.test/x.png", kind=request.kind)

    class _FailLLM:
        async def generate(self, messages, **kwargs):
            raise AssertionError("canonical 资产不应再调 optimize LLM")

    ctx = ToolContext(task_id="t1", llm_client=_FailLLM(), media_service=_Svc())
    out = await GenerateMediaBatchTool().call(ctx, {
        "jobs": [{"kind": "image", "asset_kind": "character", "name": "主角", "prompt": "male explorer, short black hair"}],
    })
    assert out["succeeded"] == 1
    assert CHARACTER_DESIGN_SHEET_PROMPT in captured[0]
    assert "male explorer" in captured[0]


@pytest.mark.asyncio
async def test_media_batch_prop_and_scene_jobs_get_canonical_layout():
    """道具四视图 / 场景 environment-only 尾缀在批量路径确定性拼接。"""
    captured = []

    class _Svc:
        async def generate(self, request):
            captured.append(request.prompt)
            return MediaResult(url="https://cdn.test/x.png", kind=request.kind)

    ctx = ToolContext(task_id="t1", llm_client=_PromptLLM(), media_service=_Svc())
    await GenerateMediaBatchTool().call(ctx, {
        "jobs": [
            {"kind": "image", "asset_kind": "prop", "name": "断手电", "prompt": "broken flashlight"},
            {"kind": "image", "asset_kind": "scene", "name": "走廊", "prompt": "yellow corridor"},
            {"kind": "image", "asset_kind": "other", "name": "x", "prompt": "a cat"},
        ],
    })
    assert "four-view composition" in captured[0]
    assert "environment-only scene reference image" in captured[1]
    # 非 canonical 资产仍走 optimize 通道（_PromptLLM 会加 "optimized: " 前缀）
    assert captured[2].startswith("optimized:")
