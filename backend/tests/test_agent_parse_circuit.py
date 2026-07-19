"""Bug 1 回归：LLM 输出连续解析失败（空响应/非法 JSON）应熔断暂停。

修复前：每次解析失败只 _add_failed_step 后 return False，主循环立即用全量
prompt 再调 LLM，格式持续错误时白烧 max_steps 次才 TASK_FAILED。
修复后：连续 N 次（MAX_CONSECUTIVE_PARSE_FAILURES）解析失败 → PAUSED +
TASK_PAUSED 事件 + 用户可理解的 pending_request；中间有成功则计数重置。
"""
import pytest

from app.agent.runtime import AgentRuntime, AgentState
from app.agent.events import EventType, event_bus
from app.agent.memory import AgentMemory
from app.agent.llm import LLMResponse
from app.agent.tools.base import BaseTool, ToolParameter


def test_runtime_replaces_summary_with_preserved_script_source():
    """agent 调 generate_script 时，边界层必须把概要替换回原始素材。"""
    memory = AgentMemory(user_goal="用户提交了一篇完整小说……")
    runtime = AgentRuntime.__new__(AgentRuntime)
    runtime.memory = memory
    runtime._latest_parsed_goal = lambda: {"summary": "两三百字概要", "source_text": "完整小说原文"}

    params = runtime._prepare_generate_script_params({"long_text": "两三百字概要"})

    assert params["long_text"] == "完整小说原文"


class _StubLLM:
    """按序列返回固定响应；序列用完后重复最后一个。"""

    def __init__(self, responses: list[dict]):
        self.responses = list(responses)
        self.call_count = 0

    async def generate(self, messages, tools=None, **kwargs):
        resp = self.responses[min(self.call_count, len(self.responses) - 1)]
        self.call_count += 1
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


_BAD = {"content": "这不是 JSON，模型输出格式坏了"}
_GOOD = {"content": '{"thought": "调 echo", "action": {"tool": "echo", "params": {"text": "hi"}}}'}


def _make_runtime(responses, max_steps=30):
    llm = _StubLLM(responses)
    rt = AgentRuntime(
        task_id="t-parse-circuit",
        llm=llm,
        memory=AgentMemory(user_goal="test parse circuit"),
        max_steps=max_steps,
    )
    rt.registry.register(_EchoTool())
    return rt, llm


@pytest.mark.asyncio
async def test_consecutive_parse_failures_pause_instead_of_burning_max_steps():
    """连续非法输出 N 次后 PAUSED，而不是一路烧到 max_steps 才 FAILED。"""
    rt, llm = _make_runtime([_BAD] * 30, max_steps=30)
    event_bus.clear_log(rt.task_id)

    for _ in range(AgentRuntime.MAX_CONSECUTIVE_PARSE_FAILURES + 2):
        done = await rt.step()
        assert done is False
        if rt.state == AgentState.PAUSED:
            break

    # 熔断暂停：PAUSED，而非 FAILED / 烧到 max_steps
    assert rt.state == AgentState.PAUSED
    # LLM 调用次数 == 熔断阈值，远小于 max_steps
    assert llm.call_count == AgentRuntime.MAX_CONSECUTIVE_PARSE_FAILURES
    assert rt._step_count < rt.max_steps

    # 发了 TASK_PAUSED，原因可读
    events = event_bus.get_replay(rt.task_id)
    paused = [e for e in events if e.type == EventType.TASK_PAUSED]
    assert paused, "expected TASK_PAUSED event"
    assert paused[-1].payload["reason"] == "llm_output_parse_failed"

    # pending_request 给用户可理解的提示
    assert rt.pending_request is not None
    assert "无法解析" in rt.pending_request["question"]


@pytest.mark.asyncio
async def test_parse_failure_counter_resets_after_success():
    """中间有一次成功解析 → 连续计数重置，不会误触发熔断。"""
    # 2 次失败 + 1 次成功 + 2 次失败：不应暂停（成功重置了计数）
    rt, llm = _make_runtime([_BAD, _BAD, _GOOD, _BAD, _BAD])
    for _ in range(5):
        await rt.step()

    assert llm.call_count == 5
    assert rt.state == AgentState.RUNNING  # 未熔断
    assert rt._consecutive_parse_failures == 2

    # 再失败 1 次，凑满连续 N 次 → 暂停
    await rt.step()
    assert rt.state == AgentState.PAUSED


@pytest.mark.asyncio
async def test_empty_response_counts_toward_circuit_breaker():
    """空响应同样计入连续失败并触发熔断。"""
    rt, llm = _make_runtime([{"content": ""}] * 10)
    for _ in range(AgentRuntime.MAX_CONSECUTIVE_PARSE_FAILURES):
        await rt.step()
    assert rt.state == AgentState.PAUSED
    assert llm.call_count == AgentRuntime.MAX_CONSECUTIVE_PARSE_FAILURES


@pytest.mark.asyncio
async def test_resume_after_pause_gets_fresh_retry_budget():
    """暂停后 resume：计数已清零，用户获得完整的一轮重试预算。"""
    rt, llm = _make_runtime([_BAD] * 30)
    for _ in range(AgentRuntime.MAX_CONSECUTIVE_PARSE_FAILURES):
        await rt.step()
    assert rt.state == AgentState.PAUSED

    # 用户回复重试 → 立即又跑了一步（resume 内部调 step()）
    await rt.resume("重试")
    assert rt.state in (AgentState.RUNNING, AgentState.PAUSED)
    # 计数已清零：需要再连续失败 N 次才会再次暂停
    remaining = AgentRuntime.MAX_CONSECUTIVE_PARSE_FAILURES - 1
    for _ in range(remaining):
        if rt.state == AgentState.PAUSED:
            break
        await rt.step()
    assert rt.state == AgentState.PAUSED
    # resume 后总共又调了 N 次 LLM（完整重试预算），而不是 1 次就停
    assert llm.call_count == 2 * AgentRuntime.MAX_CONSECUTIVE_PARSE_FAILURES
