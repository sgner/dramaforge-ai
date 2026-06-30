"""AgentRuntime ReAct 主循环测试。"""
import asyncio
import pytest
from unittest.mock import AsyncMock, MagicMock

from app.agent.runtime import AgentRuntime, AgentState, parse_decision
from app.agent.events import EventType
from app.agent.tools.base import BaseTool, ToolContext, ToolParameter
from app.agent.memory import AgentMemory


# ========================
# parse_decision 测试
# ========================

def test_parse_decision_basic():
    """解析 LLM 输出的 JSON 决策。"""
    raw = '{"thought": "我先做X", "action": {"tool": "a", "params": {"x": 1}}}'
    d = parse_decision(raw)
    assert d["thought"] == "我先做X"
    assert d["action"]["tool"] == "a"
    assert d["action"]["params"] == {"x": 1}


def test_parse_decision_finish_task():
    """finish_task 决策。"""
    raw = '{"thought": "做完了", "action": {"tool": "finish_task", "params": {}}}'
    d = parse_decision(raw)
    assert d["action"]["tool"] == "finish_task"


def test_parse_decision_with_markdown_fences():
    """LLM 输出可能带 markdown 代码块。"""
    raw = '```json\n{"thought": "x", "action": {"tool": "a", "params": {}}}\n```'
    d = parse_decision(raw)
    assert d["action"]["tool"] == "a"


def test_parse_decision_invalid_raises():
    """无效 JSON 抛错。"""
    with pytest.raises(ValueError):
        parse_decision("not json")


# ========================
# AgentRuntime 测试
# ========================

class _StubLLM:
    """假 LLM，按序列返回固定响应。"""
    def __init__(self, responses: list[dict]):
        self.responses = list(responses)
        self.call_count = 0
        self.last_messages = None

    async def generate(self, messages, tools=None, **kwargs):
        self.last_messages = messages
        if self.call_count >= len(self.responses):
            raise RuntimeError("No more stub responses")
        resp = self.responses[self.call_count]
        self.call_count += 1
        from app.agent.llm import LLMResponse
        return LLMResponse(
            content=resp.get("content"),
            tool_name=resp.get("tool_name"),
            tool_args=resp.get("tool_args"),
            prompt_tokens=10,
            completion_tokens=20,
            cost_usd=0.001,
        )


class _EchoTool(BaseTool):
    name = "echo"
    description = "echo"
    category = "llm"
    requires_approval = False
    parameters = [ToolParameter(name="text", type="string", description="x", required=True)]

    async def validate(self, ctx, params):
        return None

    async def execute(self, ctx, params):
        return {"echo": params["text"]}


class _FinishLLMTool(BaseTool):
    """first call returns finish_task"""
    name = "finish_task"
    description = "finish"
    category = "planning"
    parameters = []
    async def execute(self, ctx, params):
        return {"done": True}


def test_agent_state_enum():
    """状态枚举。"""
    assert AgentState.PENDING.value == "pending"
    assert AgentState.RUNNING.value == "running"
    assert AgentState.DONE.value == "done"
    assert AgentState.FAILED.value == "failed"


@pytest.mark.asyncio
async def test_runtime_calls_think_then_action():
    """runtime 应按 ReAct 顺序执行 think → action → observation。"""
    llm = _StubLLM([
        # 第一次 think: 决定调 echo
        {"tool_name": "echo", "tool_args": {"text": "hello"}, "content": None},
    ])
    memory = AgentMemory(user_goal="test", plan=[])
    runtime = AgentRuntime(task_id="t1", llm=llm, memory=memory)
    runtime.registry.register(_EchoTool())

    state_result = await runtime.step()

    # LLM 被调了 1 次
    assert llm.call_count == 1
    # memory 记录了 1 个 step
    assert len(memory.short_term) == 1
    assert memory.short_term[0].action["tool"] == "echo"
    assert memory.short_term[0].status == "success"


@pytest.mark.asyncio
async def test_runtime_finish_task_marks_done():
    """finish_task 应让 runtime 标记完成。"""
    llm = _StubLLM([
        {"tool_name": "finish_task", "tool_args": {}, "content": None},
    ])
    memory = AgentMemory(user_goal="x", plan=[])
    runtime = AgentRuntime(task_id="t1", llm=llm, memory=memory)
    runtime.registry.register(_FinishLLMTool())

    is_done = await runtime.step()

    assert is_done is True
    assert runtime.state == AgentState.DONE


@pytest.mark.asyncio
async def test_runtime_handles_tool_failure():
    """工具失败时 observation 标记 failed。"""
    class _FailTool(BaseTool):
        name = "fail"
        description = "always fails"
        category = "test"
        parameters = []
        async def execute(self, ctx, params):
            raise RuntimeError("boom")

    llm = _StubLLM([
        {"tool_name": "fail", "tool_args": {}, "content": None},
    ])
    memory = AgentMemory(user_goal="x", plan=[])
    runtime = AgentRuntime(task_id="t1", llm=llm, memory=memory)
    runtime.registry.register(_FailTool())

    await runtime.step()

    assert memory.short_term[0].status == "failed"
    assert "error" in memory.short_term[0].observation
    # runtime 不应标记为 done（允许重试）
    assert runtime.state == AgentState.RUNNING


@pytest.mark.asyncio
async def test_runtime_max_steps_protection():
    """达到 max_steps 强制结束。"""
    llm = _StubLLM([
        {"tool_name": "echo", "tool_args": {"text": "1"}, "content": None},
    ] * 100)
    memory = AgentMemory(user_goal="x", plan=[])
    runtime = AgentRuntime(task_id="t1", llm=llm, memory=memory, max_steps=3)
    runtime.registry.register(_EchoTool())

    is_done = await runtime.step()
    assert is_done is False
    is_done = await runtime.step()
    assert is_done is False
    is_done = await runtime.step()
    assert is_done is False
    # 第 4 次：_step_count=4 > max_steps=3，强制结束
    is_done = await runtime.step()
    assert is_done is True
    assert runtime.state == AgentState.DONE
