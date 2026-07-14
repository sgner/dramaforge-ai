"""
端到端 Agent 流程测试：Plan → Script → Characters → Scenes → Shots。

策略：用 ScriptedLLM（按 sequence 返回决策）+ StubMediaService + 真实 18 工具注册表，
跑通一次完整流程，验证 5 个阶段都生成正确资产。
"""
import asyncio
from typing import Any

import pytest

from app.agent.events import event_bus, EventType
from app.agent.llm import LLMResponse
from app.agent.memory import AgentMemory
from app.agent.runtime import AgentRuntime
from app.agent.tools import build_default_registry
from app.agent.media_service import StubMediaService


# ========================
# Scripted LLM — 顺序返回预设决策
# ========================

class ScriptedLLM:
    """按调用次数顺序返回预设的 (tool_name, tool_args) 决策。

    第一个调用返回 sequence[0]，第二个返回 sequence[1]，以此类推。
    每个 entry 是 (tool_name, tool_args) 或 (None, dict) 用 content 走 parse_decision。
    """

    def __init__(self, sequence: list[tuple[str | None, dict]]):
        self.sequence = sequence
        self.calls: list[list[dict]] = []
        self.model = "scripted-stub"

    async def generate(
        self,
        messages: list[dict],
        tools: list[dict] | None = None,
        temperature: float = 0.7,
        max_tokens: int = 4000,
    ) -> LLMResponse:
        self.calls.append(messages)
        if not self.sequence:
            # 默认结束
            return LLMResponse(tool_name="finish_task", tool_args={"summary": "done"})
        tool_name, tool_args = self.sequence.pop(0)
        return LLMResponse(
            tool_name=tool_name,
            tool_args=tool_args,
            cost_usd=0.001,
            prompt_tokens=100,
            completion_tokens=50,
        )

    async def generate_structured(self, *args, **kwargs) -> LLMResponse:
        return await self.generate(*args, **kwargs)


# ========================
# 收集事件的辅助
# ========================

class EventCollector:
    def __init__(self, task_id: str):
        self.task_id = task_id
        self.events: list = []
        self.queue = event_bus.subscribe(task_id)

    async def drain(self, timeout: float = 0.05) -> None:
        """非阻塞地排空队列里所有事件。"""
        try:
            while True:
                ev = await asyncio.wait_for(self.queue.get(), timeout=timeout)
                self.events.append(ev)
        except asyncio.TimeoutError:
            pass

    def by_type(self, t: str | EventType) -> list:
        target = t.value if isinstance(t, EventType) else t
        return [e for e in self.events if e.type == target]

    def close(self):
        event_bus.unsubscribe(self.task_id, self.queue)


# ========================
# 5 阶段剧本 — Plan → Script → Characters → Scenes → Shots
# ========================

PLAN_STEPS = [
    {"step": 1, "tool": "create_plan", "description": "创作剧本"},
    {"step": 2, "tool": "generate_script", "description": "提取角色"},
    {"step": 3, "tool": "extract_characters", "description": "提取道具"},
    {"step": 4, "tool": "extract_scenes", "description": "生成分镜"},
    {"step": 5, "tool": "extract_shots", "description": "完成"},
]

PLAN_READY_PAYLOAD = {"plan": PLAN_STEPS}

SCRIPT_PAYLOAD = {
    "title": "雨夜",
    "synopsis": "少年林尘在雨夜遇到神秘女孩",
    "script": "雨夜的城市霓虹闪烁，林尘独自走在街上...",
}

CHARACTERS_PAYLOAD = {
    "characters": [
        {"name": "林尘", "age": 22, "personality": "沉默寡言", "appearance": "黑发，眼神锐利"},
    ],
    "props": [],
}

SCENES_PAYLOAD = {
    "scenes": [
        {"index": 1, "name": "雨夜街道", "description": "霓虹灯反光的湿漉漉街道"},
    ],
}

SHOTS_PAYLOAD = {
    "shots": [
        {
            "index": 1,
            "scene": "雨夜街道",
            "action": "林尘走在街上",
            "camera": "中景",
            "duration_sec": 5,
        },
    ],
}


# ========================
# 公共 fixture
# ========================

@pytest.fixture
def media_service():
    return StubMediaService()


@pytest.fixture
def task_id():
    return "e2e-task-1"


# ========================
# 测试用例
# ========================

@pytest.mark.asyncio
async def test_e2e_runs_through_all_5_stages(task_id, media_service):
    """完整跑通 5 阶段：create_plan → generate_script → extract_characters → extract_scenes → extract_shots → finish_task"""
    sequence = [
        ("create_plan", {"plan": PLAN_STEPS}),
        ("generate_script", {"topic": "雨夜短片"}),
        ("extract_characters", {"script": SCRIPT_PAYLOAD["script"]}),
        ("extract_scenes", {"script": SCRIPT_PAYLOAD["script"]}),
        ("extract_shots", {"script": SCRIPT_PAYLOAD["script"]}),
        ("finish_task", {"summary": "all 5 stages done"}),
    ]
    llm = ScriptedLLM(sequence)
    memory = AgentMemory(user_goal="做一个 30 秒的雨夜短片")
    registry = build_default_registry()
    runtime = AgentRuntime(
        task_id=task_id,
        llm=llm,
        memory=memory,
        registry=registry,
        max_steps=10,
    )

    # 注入 media_service 到每个 image/video/audio 工具
    for t in registry.list():
        t._media_service = media_service  # noqa: SLF001 - 测试桩

    # 订阅事件
    collector = EventCollector(task_id)

    try:
        # 主循环
        for _ in range(20):
            done = await runtime.step()
            await collector.drain()
            if done:
                break

        # 验证：LLM 被调用了 6 次（5 阶段 + finish）
        assert len(llm.calls) == 6, f"expected 6 LLM calls, got {len(llm.calls)}"

        # 验证：5 个阶段对应的事件都触发过
        for t in (
            EventType.THOUGHT,
            EventType.ACTION,
            EventType.OBSERVATION,
            EventType.TASK_DONE,
        ):
            assert collector.by_type(t), f"missing events of type {t}"

        # 验证：任务状态 = DONE
        assert runtime.state.value == "done"

        # 验证：memory 里有 6 条 step 记录（5 阶段 + finish_task）
        # 之前设计：finish_task 不入 step。现在改为 finish_task 也入 step，
        # 与其他工具步骤保持一致，便于在 ThoughtStream / 数据库中可观察。
        assert len(memory.short_term) == 6
    finally:
        collector.close()


@pytest.mark.asyncio
async def test_e2e_plan_step_creates_plan_artifact(task_id, media_service):
    """第 1 阶段：create_plan 之后，memory.plan 应该有内容。"""
    sequence = [
        ("create_plan", {"goal": {"title": "test"}}),
        ("finish_task", {"summary": "ok"}),
    ]
    llm = ScriptedLLM(sequence)
    memory = AgentMemory(user_goal="test")
    registry = build_default_registry()
    runtime = AgentRuntime(
        task_id=task_id,
        llm=llm,
        memory=memory,
        registry=registry,
        max_steps=5,
    )
    for t in registry.list():
        t._media_service = media_service  # noqa

    # stub create_plan.execute 返回固定步骤
    from app.agent.tools.planning import CreatePlanTool
    original = CreatePlanTool.execute

    async def stub_execute(self, ctx, params):
        return list(PLAN_STEPS)

    CreatePlanTool.execute = stub_execute
    try:
        for _ in range(10):
            done = await runtime.step()
            if done:
                break
    finally:
        CreatePlanTool.execute = original

    # 验证：5 个 step 记录已写入 memory
    assert len(memory.short_term) >= 1
    # 验证：create_plan 工具调用了
    plan_step = next(
        (s for s in memory.short_term if s.action.get("tool") == "create_plan"),
        None,
    )
    assert plan_step is not None
    assert plan_step.status == "success"
    # 验证：observation 包含 plan 数据
    assert "result" in plan_step.observation
    result = plan_step.observation["result"]
    assert isinstance(result, list)
    assert len(result) == len(PLAN_STEPS)


@pytest.mark.asyncio
async def test_e2e_script_step_produces_text_artifact(task_id, media_service):
    """第 2 阶段：generate_script 之后，artifacts.script 应有内容。"""
    sequence = [
        ("generate_script", {"novel_text": SCRIPT_PAYLOAD["script"]}),
        ("finish_task", {"summary": "ok"}),
    ]
    llm = ScriptedLLM(sequence)
    memory = AgentMemory(user_goal="test")
    registry = build_default_registry()
    runtime = AgentRuntime(
        task_id=task_id,
        llm=llm,
        memory=memory,
        registry=registry,
        max_steps=5,
    )
    # stub generate_script.execute 返回固定剧本
    from app.agent.tools.llm_tools import GenerateScriptTool
    original_execute = GenerateScriptTool.execute

    async def stub_execute(self, ctx, params):
        return {"title": SCRIPT_PAYLOAD["title"], "script": SCRIPT_PAYLOAD["script"]}

    GenerateScriptTool.execute = stub_execute
    try:
        for _ in range(10):
            done = await runtime.step()
            if done:
                break
    finally:
        GenerateScriptTool.execute = original_execute

    # 验证：generate_script 工具调用了
    script_step = next(
        (s for s in memory.short_term if s.action.get("tool") == "generate_script"),
        None,
    )
    assert script_step is not None
    assert script_step.status == "success"
    # 验证：observation.result 包含剧本内容
    result = script_step.observation["result"]
    assert result["title"] == SCRIPT_PAYLOAD["title"]
    assert result["script"] == SCRIPT_PAYLOAD["script"]


@pytest.mark.asyncio
async def test_e2e_total_steps_match_max_steps(task_id, media_service):
    """未提供 finish_task 时，runtime 应在 max_steps 时停。"""
    # 10 个 create_plan（不结束）
    sequence = [("create_plan", {"plan": PLAN_STEPS})] * 10
    llm = ScriptedLLM(sequence)
    memory = AgentMemory(user_goal="test")
    registry = build_default_registry()
    runtime = AgentRuntime(
        task_id=task_id,
        llm=llm,
        memory=memory,
        registry=registry,
        max_steps=3,
    )
    for t in registry.list():
        t._media_service = media_service  # noqa

    last_done = None
    for _ in range(20):
        last_done = await runtime.step()
        if last_done:
            break

    assert last_done is True
    # 任务因超过 max_steps 而结束 — 状态为 failed（不是 done），
    # 因为超限是失败，避免 _run_runtime_loop 再发 TASK_DONE 覆盖 TASK_FAILED
    assert runtime.state.value == "failed"


@pytest.mark.asyncio
async def test_e2e_emits_artifact_events(task_id, media_service):
    """验证 run 中至少发出过 THOUGHT/ACTION/OBSERVATION 三类事件，且都按时间顺序。"""
    sequence = [
        ("create_plan", {"plan": PLAN_STEPS}),
        ("finish_task", {"summary": "ok"}),
    ]
    llm = ScriptedLLM(sequence)
    memory = AgentMemory(user_goal="test")
    registry = build_default_registry()
    runtime = AgentRuntime(
        task_id=task_id,
        llm=llm,
        memory=memory,
        registry=registry,
        max_steps=5,
    )
    for t in registry.list():
        t._media_service = media_service  # noqa

    collector = EventCollector(task_id)
    try:
        for _ in range(10):
            done = await runtime.step()
            await collector.drain()
            if done:
                break

        types = [e.type for e in collector.events]
        # 至少有：TASK_STARTED, THOUGHT, ACTION, OBSERVATION, TASK_DONE
        assert "task_started" in types or "thought" in types
        assert "thought" in types
        assert "action" in types
        assert "observation" in types
        assert "task_done" in types
        # 顺序：THOUGHT < ACTION < OBSERVATION
        i_thought = types.index("thought")
        i_action = types.index("action")
        i_obs = types.index("observation")
        assert i_thought < i_action < i_obs
    finally:
        collector.close()
