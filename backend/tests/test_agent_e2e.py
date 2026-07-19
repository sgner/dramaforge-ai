"""
端到端 Agent 流程测试：Plan → Script → Characters → Scenes → Shots。

策略：用 ScriptedLLM（按 sequence 返回决策）+ StubMediaService + 真实 18 工具注册表，
跑通一次完整流程，验证 5 个阶段都生成正确资产。
"""
import asyncio
import json
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
    """按调用来源分发的脚本化 LLM。

    两类调用走完全不同的路径（靠 system prompt 区分）：

    1. **决策调用**（runtime ReAct 循环，system 含 "Director Agent"）：
       维持原行为 —— 按调用顺序 pop sequence，返回 (tool_name, tool_args)。
    2. **工具内部调用**（create_plan / generate_script / extract_* 在 execute 内
       经 ctx.generate_llm 发起的专家调用，各用自己的 system prompt）：
       不碰决策队列，按 system prompt 中的专家角色关键字返回对应的
       canned JSON，让工具内 _coerce_json 能解析出非空结果。

    计数：decision_calls / internal_calls 分别累计；calls 记录全部 messages。
    """

    def __init__(self, sequence: list[tuple[str | None, dict]]):
        self.sequence = sequence
        self.calls: list[list[dict]] = []
        self.decision_calls = 0
        self.internal_calls = 0
        self.model = "scripted-stub"

    @staticmethod
    def _system_prompt(messages: list[dict]) -> str:
        for m in messages:
            if isinstance(m, dict) and m.get("role") == "system":
                return str(m.get("content") or "")
        return ""

    def _canned_for(self, system: str) -> dict:
        """按专家 system prompt 角色关键字选择 canned JSON。"""
        # 顺序敏感：先匹配更具体的角色。关键字取自各工具 system prompt 首行
        # （"你是 DramaForge 制作经理/编剧/角色分析师/道具师/美术指导/摄影指导"）。
        for keyword, payload in _INTERNAL_CANNED_RESPONSES:
            if keyword in system:
                return payload
        return {}

    async def generate(
        self,
        messages: list[dict],
        tools: list[dict] | None = None,
        temperature: float = 0.7,
        max_tokens: int = 4000,
    ) -> LLMResponse:
        self.calls.append(messages)
        system = self._system_prompt(messages)

        # 工具内部调用：返回 canned JSON content，不吃决策队列
        if "Director Agent" not in system:
            self.internal_calls += 1
            return LLMResponse(
                content=json.dumps(self._canned_for(system), ensure_ascii=False),
                prompt_tokens=50,
                completion_tokens=100,
                cost_usd=0.0,
            )

        # 决策调用：pop 决策队列
        self.decision_calls += 1
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

# 结构化目标（parse_user_goal 输出形状），新版 create_plan 要求 goal 必须是 dict
GOAL_PAYLOAD = {
    "title": "雨夜",
    "genre": "悬疑",
    "duration_sec": 30,
    "num_characters": 2,
    "summary": "少年林尘在雨夜遇到神秘女孩",
}

# ========================
# 工具内部 LLM 调用的 canned 响应（非决策调用）
# ========================
# 每个工具的 execute() 会经 ctx.generate_llm 再调一次 LLM（各自的专家
# system prompt），并用 _coerce_json 解析 resp.content。这里按各工具的
# 解析路径给出最小但合法的 JSON：
# - create_plan        → data["steps"]            (list[dict])
# - generate_script    → data["scenes"] 必填 list，其余 characters/props/bigShots/visualSignature 可选
# - extract_characters → data["characters"]       (list)
# - extract_props      → data["props"]            (list)
# - extract_scenes     → data["scenes"]           (list)
# - extract_shots      → data["shots"]            (list)

CANNED_PLAN_JSON = {"steps": PLAN_STEPS}

CANNED_SCRIPT_JSON = {
    "scenes": [
        {
            "index": 1,
            "title": "雨夜街道",
            "location": "城市街道",
            "time": "夜晚",
            "characters": ["林尘", "神秘女孩"],
            "dialogue": "林尘：你是谁？",
            "description": "雨夜的城市霓虹闪烁，林尘独自走在街上",
            "duration_sec": 30,
        },
    ],
    "characters": CHARACTERS_PAYLOAD["characters"],
    "props": [],
    "bigShots": [
        {
            "sceneIndex": 1,
            "index": 1,
            "shotType": "中景",
            "cameraMove": "跟拍",
            "action": "林尘走在街上",
            "dialogue": "",
            "durationSec": 5,
        },
    ],
    "visualSignature": {
        "medium": "实拍",
        "aspectRatio": "16:9",
        "colorIds": ["冷蓝霓虹"],
        "coreTheme": "雨夜",
    },
}

CANNED_CHARACTERS_JSON = {"characters": CHARACTERS_PAYLOAD["characters"]}
CANNED_PROPS_JSON = {"props": []}
CANNED_SCENES_JSON = SCENES_PAYLOAD
CANNED_SHOTS_JSON = SHOTS_PAYLOAD

# system prompt 角色关键字 → canned JSON。
# 关键字取自各工具 system prompt 首行（planning.py / llm_tools.py），
# 顺序敏感：都是"你是 DramaForge <角色>"格式，互不包含。
_INTERNAL_CANNED_RESPONSES: tuple[tuple[str, dict], ...] = (
    ("制作经理", CANNED_PLAN_JSON),          # CreatePlanTool
    ("编剧", CANNED_SCRIPT_JSON),            # GenerateScriptTool
    ("角色分析师", CANNED_CHARACTERS_JSON),  # ExtractCharactersTool
    ("道具师", CANNED_PROPS_JSON),           # ExtractPropsTool
    ("美术指导", CANNED_SCENES_JSON),        # ExtractScenesTool
    ("摄影指导", CANNED_SHOTS_JSON),         # ExtractShotsTool
)


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
        ("create_plan", {"goal": GOAL_PAYLOAD}),
        ("generate_script", {"novel_text": SCRIPT_PAYLOAD["script"]}),
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

        # 验证：决策调用 6 次（5 阶段 + finish_task）。
        # 每个阶段工具的 execute() 内部还会经 ctx.generate_llm 各调 1 次
        # （专家 system prompt，ScriptedLLM 返回 canned JSON，不吃决策队列），
        # 即内部调用 5 次 → 总调用 11 次。
        assert llm.decision_calls == 6, f"expected 6 decision calls, got {llm.decision_calls}"
        assert llm.internal_calls == 5, f"expected 5 internal tool calls, got {llm.internal_calls}"
        assert len(llm.calls) == 11, f"expected 11 total LLM calls, got {len(llm.calls)}"

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

        # 验证：memory 里有 6 条 step 记录（5 阶段 + finish_task），全部成功
        assert len(memory.short_term) == 6
        for s in memory.short_term:
            assert s.status == "success", (
                f"step {s.action.get('tool')} failed: {s.observation}"
            )

        # 验证：5 个阶段的产物都非空
        results = {
            s.action.get("tool"): s.observation.get("result")
            for s in memory.short_term
        }
        # 1) create_plan → list[dict]，且 bridge 到 memory.plan
        assert isinstance(results["create_plan"], list) and results["create_plan"], (
            f"create_plan result empty: {results['create_plan']}"
        )
        assert memory.plan, "memory.plan should be populated from create_plan result"
        # 2) generate_script → scenes + body（ctx.db=None 时跳过 save_asset，不报错）
        script_result = results["generate_script"]
        assert script_result["scenes"], "generate_script scenes empty"
        assert script_result["body"], "generate_script body empty"
        # 3) extract_characters →  canned 角色列表
        characters = results["extract_characters"]["characters"]
        assert characters and characters[0]["name"] == "林尘"
        # 4) extract_scenes → canned 场景列表
        scenes = results["extract_scenes"]["scenes"]
        assert scenes and scenes[0]["name"] == "雨夜街道"
        # 5) extract_shots → canned 分镜列表
        shots = results["extract_shots"]["shots"]
        assert shots and shots[0]["scene"] == "雨夜街道"
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
    """max_steps 是单轮保护：超限自动扩展检查点窗口继续执行，而不是判失败。"""
    # 10 个 create_plan（不主动结束）；脚本耗尽后 ScriptedLLM 默认 finish_task
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
    # 超过 max_steps=3 后窗口已自动扩展（超限只是单轮保护，不是任务失败），
    # runtime 得以继续跑到 finish_task 正常完成。
    assert runtime.max_steps > 3
    assert runtime.state.value == "done"


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
