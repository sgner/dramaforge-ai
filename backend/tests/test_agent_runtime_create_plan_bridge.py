"""TDD: runtime 应在 create_plan 工具成功时把结果写入 memory.plan。

背景：E2E 测试发现前端拿不到结构化 plan，因为 runtime 只把 plan
放进 observation，没有同步到 memory.plan。
"""
import pytest
from app.agent.llm import LLMResponse
from app.agent.memory import AgentMemory
from app.agent.runtime import AgentRuntime
from app.agent.tools import build_default_registry
from app.agent.tools.planning import CreatePlanTool
from app.agent.media_service import StubMediaService
from app.agent.events import event_bus

PLAN = [{"step": 1, "tool": "x"}, {"step": 2, "tool": "y"}]


class StaticLLM:
    model = "stub"
    def __init__(self, name, args):
        self._name = name
        self._args = args
        self.calls = []
    async def generate(self, messages, tools=None, **kw):
        self.calls.append(messages)
        return LLMResponse(tool_name=self._name, tool_args=self._args, cost_usd=0)
    async def generate_structured(self, *a, **kw):
        return await self.generate(*a, **kw)


@pytest.mark.asyncio
async def test_create_plan_writes_result_to_memory_plan():
    llm = StaticLLM("create_plan", {"goal": {"title": "x"}})
    memory = AgentMemory(user_goal="x")
    registry = build_default_registry()
    for t in registry.list():
        t._media_service = StubMediaService()
    original = CreatePlanTool.execute
    async def stub(self, ctx, params):
        return list(PLAN)
    CreatePlanTool.execute = stub
    try:
        runtime = AgentRuntime(task_id="t1", llm=llm, memory=memory, registry=registry, max_steps=3)
        for _ in range(5):
            if await runtime.step():
                break
    finally:
        CreatePlanTool.execute = original
    assert memory.plan is not None
    assert len(memory.plan) == 2
    assert memory.plan[0]["step"] == 1


@pytest.mark.asyncio
async def test_create_plan_publishes_plan_ready_event():
    task_id = "t-plan-ready"
    event_bus.clear_log(task_id)
    llm = StaticLLM("create_plan", {"goal": {"title": "x"}})
    memory = AgentMemory(user_goal="x")
    registry = build_default_registry()
    for t in registry.list():
        t._media_service = StubMediaService()
    original = CreatePlanTool.execute
    async def stub(self, ctx, params):
        return list(PLAN)
    CreatePlanTool.execute = stub
    try:
        runtime = AgentRuntime(task_id=task_id, llm=llm, memory=memory, registry=registry, max_steps=1)
        await runtime.step()
    finally:
        CreatePlanTool.execute = original

    plan_events = [event for event in event_bus.get_replay(task_id) if event.type == "plan_ready"]
    assert len(plan_events) == 1
    assert plan_events[0].payload["plan"] == PLAN
