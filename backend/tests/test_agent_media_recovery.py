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
async def test_media_retryable_failure_is_recovered_without_pausing_runtime():
    registry = ToolRegistry()
    registry.register(_RetryingImageTool())
    runtime = AgentRuntime("t1", object(), AgentMemory(user_goal="generate"), registry=registry)

    observation, status = await runtime._execute_tool("generate_character_portrait", {"character": {"name": "A"}})

    assert status == "failed"
    assert runtime.state != AgentState.PAUSED
    assert observation["recovery"]["success"] is False

