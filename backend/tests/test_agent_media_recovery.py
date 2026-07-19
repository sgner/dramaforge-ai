import pytest

from app.agent.memory import AgentMemory
from app.agent.runtime import AgentRuntime, AgentState
from app.agent.tools.base import BaseTool, RetryableError, ToolParameter, ToolRegistry


class _RetryingImageTool(BaseTool):
    name = "generate_character_portrait"
    description = "image"
    category = "image"
    parameters = [ToolParameter(name="character", type="object", description="character")]

    async def execute(self, ctx, params):
        raise RetryableError("provider unavailable")


@pytest.mark.asyncio
async def test_media_retryable_failure_pauses_runtime_for_user_recovery():
    """媒体工具 RetryableError → 暂停等用户决策（retry/change_model/skip）。

    现行设计：媒体失败必须暂停，防止 agent 消费不完整的资产继续下游操作
    （见 runtime._pause_for_media_failure）。不再走"后台 recovery worker
    不暂停继续跑"的旧设计。
    """
    registry = ToolRegistry()
    registry.register(_RetryingImageTool())
    runtime = AgentRuntime("t1", object(), AgentMemory(user_goal="generate"), registry=registry)

    observation, status = await runtime._execute_tool("generate_character_portrait", {"character": {"name": "A"}})

    assert status == "paused"
    assert runtime.state == AgentState.PAUSED
    assert runtime.pending_request["type"] == "tool_error"
    assert runtime.pending_request["tool"] == "generate_character_portrait"
    assert "provider unavailable" in runtime.pending_request["error"]

