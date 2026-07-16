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
            content = "optimized: " + messages[-1]["content"]
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
