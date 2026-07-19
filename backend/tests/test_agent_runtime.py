"""AgentRuntime ReAct 主循环测试。"""
import asyncio
import pytest
from unittest.mock import AsyncMock, MagicMock

from app.agent.runtime import AgentRuntime, AgentState, parse_decision
from app.agent.events import EventType, event_bus
from app.agent.tools import base as tools_base
from app.agent.tools.base import (
    BaseTool,
    ToolContext,
    ToolParameter,
    RetryableError,
    NonRetryableError,
    ToolValidationError,
    RetryableTool,
)
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


def test_parse_decision_extracts_json_after_model_prose():
    """模型偶尔会在决策 JSON 前追加说明文字，仍应解析出完整对象。"""
    raw = '我将继续执行下一步：\n{"thought": "继续规划", "action": {"tool": "create_plan", "params": {"goal": {"title": "天帝之怒"}}}}'
    d = parse_decision(raw)
    assert d["action"]["tool"] == "create_plan"
    assert d["action"]["params"]["goal"]["title"] == "天帝之怒"


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


class _SaveAssetTool(BaseTool):
    name = "save_asset"
    description = "save asset"
    category = "asset"
    parameters = []

    async def execute(self, ctx, params):
        return {
            "ok": True,
            "id": "asset-1",
            "kind": "text",
            "asset_kind": "script",
            "name": "郑明传奇剧本",
            "url": "/assets/script-1.txt",
        }


class _RetryingMediaTool(BaseTool):
    name = "generate_scene_image"
    description = "test media retry"
    category = "image"
    parameters = []

    def __init__(self, failures=2):
        self.calls = 0
        self.failures = failures

    async def execute(self, ctx, params):
        self.calls += 1
        if self.calls <= self.failures:
            raise RetryableError(f"temporary media failure #{self.calls}")
        return {"url": "https://cdn.test/scene.png"}


class _AlwaysFailingMediaTool(_RetryingMediaTool):
    def __init__(self):
        super().__init__(failures=99)


class _PartialBatchMediaTool(BaseTool):
    name = "generate_media_batch"
    description = "test partial batch"
    category = "image"
    parameters = []

    async def execute(self, ctx, params):
        return {
            "results": [
                {"job_index": 0, "success": True, "url": "https://cdn.test/ok.png"},
                {"job_index": 1, "success": False, "error": "provider failed"},
            ],
            "succeeded": 1,
            "failed": 1,
        }


class _BlockingLLM:
    def __init__(self):
        self.started = asyncio.Event()
        self.release = asyncio.Event()

    async def generate(self, messages, tools=None, **kwargs):
        self.started.set()
        await self.release.wait()
        from app.agent.llm import LLMResponse
        return LLMResponse(tool_name="echo", tool_args={"text": "must-not-run"})


def test_agent_state_enum():
    """状态枚举。"""
    assert AgentState.PENDING.value == "pending"
    assert AgentState.RUNNING.value == "running"
    assert AgentState.DONE.value == "done"
    assert AgentState.FAILED.value == "failed"


def test_runtime_messages_include_user_response_observation():
    """runtime 传给 LLM 的消息必须包含 ask_user 的用户回答。"""
    llm = _StubLLM([])
    memory = AgentMemory(user_goal="郑明传奇", plan=[])
    memory.add_step(
        step_number=1,
        thought="等待用户补充",
        action={"tool": "ask_user"},
        observation={"success": True, "user_response": {"response": "郑明传奇"}},
        status="success",
    )
    runtime = AgentRuntime(task_id="t1", llm=llm, memory=memory)

    messages = runtime._build_messages()

    assert "郑明传奇" in messages[0]["content"]
    assert "user_response" in messages[0]["content"]


@pytest.mark.asyncio
async def test_runtime_does_not_execute_after_cancel_during_llm_call():
    """主动停止后，即使正在等待 LLM 返回，也不得执行已经返回的旧动作。"""
    llm = _BlockingLLM()
    runtime = AgentRuntime(task_id="t-stop", llm=llm, memory=AgentMemory(user_goal="x"))
    tool = _EchoTool()
    tool.execute = AsyncMock(return_value={"echo": "must-not-run"})
    runtime.registry.register(tool)

    running = asyncio.create_task(runtime.step())
    await llm.started.wait()
    runtime.state = AgentState.CANCELLED
    llm.release.set()
    await running

    tool.execute.assert_not_awaited()
    assert runtime.state == AgentState.CANCELLED


@pytest.mark.asyncio
async def test_runtime_pauses_before_media_when_script_is_missing():
    """A vague goal must ask for a script before creating any media asset."""
    from app.agent.events import event_bus

    task_id = "t-script-required"
    event_bus.clear_log(task_id)
    llm = _StubLLM([{
        "tool_name": "generate_media_batch",
        "tool_args": {"jobs": [{"kind": "image", "prompt": "a martial arts master"}]},
        "content": None,
    }])
    memory = AgentMemory(user_goal="功夫", plan=[])
    runtime = AgentRuntime(task_id=task_id, llm=llm, memory=memory)

    done = await runtime.step()

    assert done is False
    assert runtime.state == AgentState.PAUSED
    assert runtime.pending_request["type"] == "ask_user"
    assert runtime.pending_request["options"] == ["由 agent 编写脚本"]
    assert runtime.pending_request["allow_custom"] is True
    assert memory.short_term[-1].action["tool"] == "ask_user"
    assert memory.short_term[-1].observation["reason"] == "script_required_before_media"
    assert not any(event.type == EventType.ACTION for event in event_bus.get_replay(task_id))


@pytest.mark.asyncio
async def test_script_requirement_answer_resumes_into_script_generation():
    """Answering the precondition question must return to Agent execution."""
    class _GenerateScriptTool(BaseTool):
        name = "generate_script"
        description = "generate script"
        category = "llm"
        parameters = []

        async def execute(self, ctx, params):
            return {"title": "功夫", "scenes": []}

    llm = _StubLLM([
        {
            "tool_name": "generate_media_batch",
            "tool_args": {"jobs": []},
            "content": None,
        },
        {
            "tool_name": "generate_script",
            "tool_args": {},
            "content": None,
        },
    ])
    memory = AgentMemory(user_goal="功夫", plan=[])
    runtime = AgentRuntime(task_id="t-script-resume", llm=llm, memory=memory)
    runtime.registry.register(_GenerateScriptTool())

    await runtime.step()
    await runtime.resume("由 agent 编写脚本")

    assert llm.call_count == 2
    assert runtime.state == AgentState.RUNNING
    assert memory.short_term[-1].action["tool"] == "generate_script"
    assert memory.short_term[-1].status == "success"


@pytest.mark.asyncio
async def test_runtime_projects_saved_asset_into_memory_artifacts():
    """save_asset 成功后必须进入 artifacts，供前端生成普通资产节点。"""
    llm = _StubLLM([{"tool_name": "save_asset", "tool_args": {}, "content": None}])
    memory = AgentMemory(user_goal="郑明传奇", plan=[])
    runtime = AgentRuntime(task_id="t1", llm=llm, memory=memory)
    runtime.registry.register(_SaveAssetTool())

    await runtime.step()

    assert memory.artifacts["script"][0]["id"] == "asset-1"


@pytest.mark.asyncio
async def test_runtime_fills_missing_thought_for_action_only_decision():
    from app.agent.events import event_bus

    task_id = "t-missing-thought"
    event_bus.clear_log(task_id)
    llm = _StubLLM([{
        "content": '{"action": {"tool": "echo", "params": {"text": "x"}}}',
        "tool_name": None,
    }])
    runtime = AgentRuntime(task_id=task_id, llm=llm, memory=AgentMemory(user_goal="x"))
    runtime.registry.register(_EchoTool())

    await runtime.step()

    thoughts = [event for event in event_bus.get_replay(task_id) if event.type == "thought"]
    assert thoughts
    assert thoughts[-1].payload["text"] == "准备执行：echo"


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


# ========================
# finish_task 资产完成度校验测试
# ========================

def _drama_profile(deliverables=("script", "storyboard", "video")) -> "TaskProfile":
    from app.agent.task_profiles import TaskProfile
    return TaskProfile(
        task_type="drama_short",
        input_mode="complete_script",
        source_kind="script",
        script_required=True,
        needs_clarification=False,
        deliverables=list(deliverables),
        asset_strategy="reuse_inspected_assets",
        confidence=0.95,
        missing_inputs=[],
        rule_pack_id="drama_short.v1",
    )


@pytest.mark.asyncio
async def test_finish_task_emits_assets_summary_and_missing_deliverables():
    """finish_task 必须在 TASK_DONE payload 中包含真实资产统计和缺失项。

    回归问题：此前 finish_task 分支只传 summary 参数，不校验 artifacts，
    导致 agent 仅生成文本就能"假完成"，前端无法发现实际资产未生成。
    """
    from app.agent.events import event_bus

    task_id = "t-finish-empty"
    event_bus.clear_log(task_id)
    llm = _StubLLM([{"tool_name": "finish_task", "tool_args": {}, "content": None}])
    memory = AgentMemory(user_goal="功夫短剧", plan=[])
    runtime = AgentRuntime(
        task_id=task_id, llm=llm, memory=memory, profile=_drama_profile(),
    )
    runtime.registry.register(_FinishLLMTool())

    is_done = await runtime.step()

    assert is_done is True
    assert runtime.state == AgentState.DONE
    done_events = [e for e in event_bus.get_replay(task_id) if e.type == EventType.TASK_DONE]
    assert done_events, "应发射 TASK_DONE 事件"
    payload = done_events[-1].payload
    # 空 artifacts → 全部 deliverables 缺失
    assert payload["assets_summary"] == {}
    assert set(payload["missing_deliverables"]) == {"script", "storyboard", "video"}
    assert payload["incomplete"] is True
    assert payload["total_assets"] == 0
    # memory 中的 step observation 也应包含摘要（用于持久化恢复）
    assert memory.short_term[-1].observation["assets_summary"] == {}
    assert "missing_deliverables" in memory.short_term[-1].observation


@pytest.mark.asyncio
async def test_finish_task_with_partial_assets_reports_partial_completion():
    """部分资产已生成时，assets_summary 应反映真实数量，missing_deliverables 只列缺失项。"""
    from app.agent.events import event_bus

    task_id = "t-finish-partial"
    event_bus.clear_log(task_id)
    llm = _StubLLM([{"tool_name": "finish_task", "tool_args": {}, "content": None}])
    memory = AgentMemory(user_goal="功夫短剧", plan=[])
    # 预置一个 script 资产（模拟 generate_script 成功后的 artifacts）
    memory.set_artifact("script", {
        "id": "script-1", "kind": "text", "asset_kind": "script",
        "name": "功夫短剧剧本", "url": "/assets/script-1.txt", "failed": False,
    })
    runtime = AgentRuntime(
        task_id=task_id, llm=llm, memory=memory, profile=_drama_profile(),
    )
    runtime.registry.register(_FinishLLMTool())

    is_done = await runtime.step()

    assert is_done is True
    done_events = [e for e in event_bus.get_replay(task_id) if e.type == EventType.TASK_DONE]
    payload = done_events[-1].payload
    # script 已生成，storyboard 和 video 缺失
    assert payload["assets_summary"] == {"script": 1}
    assert set(payload["missing_deliverables"]) == {"storyboard", "video"}
    assert payload["incomplete"] is True
    assert payload["total_assets"] == 1


@pytest.mark.asyncio
async def test_finish_task_complete_when_all_deliverables_present():
    """所有 deliverables 都已生成时，incomplete 应为 False，missing_deliverables 为空。"""
    from app.agent.events import event_bus

    task_id = "t-finish-complete"
    event_bus.clear_log(task_id)
    llm = _StubLLM([{"tool_name": "finish_task", "tool_args": {}, "content": None}])
    memory = AgentMemory(user_goal="功夫短剧", plan=[])
    memory.set_artifact("script", {"id": "s1", "failed": False})
    memory.set_artifact("storyboard", {"id": "sb1", "failed": False})
    memory.set_artifact("video", {"id": "v1", "failed": False})
    runtime = AgentRuntime(
        task_id=task_id, llm=llm, memory=memory, profile=_drama_profile(),
    )
    runtime.registry.register(_FinishLLMTool())

    await runtime.step()

    done_events = [e for e in event_bus.get_replay(task_id) if e.type == EventType.TASK_DONE]
    payload = done_events[-1].payload
    assert payload["assets_summary"] == {"script": 1, "storyboard": 1, "video": 1}
    assert payload["missing_deliverables"] == []
    assert payload["incomplete"] is False
    assert payload["total_assets"] == 3


def test_compute_assets_summary_excludes_failed_and_generating():
    """compute_assets_summary 应排除 failed 和 generating 状态的资产。"""
    from app.agent.runtime import compute_assets_summary

    artifacts = {
        "script": [
            {"id": "s1", "failed": False},
            {"id": "s2", "failed": True},
        ],
        "scene": [
            {"id": "sc1", "generating": True},
            {"id": "sc2", "generating": False},
        ],
        "character": [
            {"id": "c1"},
            {"id": "c2"},
        ],
    }
    summary = compute_assets_summary(artifacts)
    assert summary == {"script": 1, "scene": 1, "character": 2}


def test_compute_missing_deliverables_normalizes_promotional_video():
    """compute_missing_deliverables 应把 promotional_video 归一到 video asset_kind。"""
    from app.agent.runtime import compute_missing_deliverables

    summary = {"video": 1, "storyboard": 2}
    deliverables = ["script", "storyboard", "promotional_video"]
    missing = compute_missing_deliverables(summary, deliverables)
    assert "storyboard" not in missing
    assert "promotional_video" not in missing
    assert "script" in missing


def test_begin_media_asset_rejects_thought_as_prompt():
    """_begin_media_asset 不应把 character.description（可能含 thought 文本）作为 prompt。

    回归问题：LLM 把思考内容塞进 character.description，_begin_media_asset
    用 source.get("prompt") or source.get("description") 作为 prompt，
    导致 thought 被写入 Asset 节点浮窗。
    修复后强制使用 _build_character_prompt 等结构化构建函数。
    """
    from app.agent.tools.image_tools import _build_character_prompt

    # 模拟 LLM 把 thought 塞进 description
    character_with_thought = {
        "name": "林尘",
        "age": 25,
        "gender": "女",
        "appearance": "黑色短发，绿色眼睛，穿皮夹克",
        "personality": "冷静果断",
        "description": "我需要先构思一个赛博朋克风格的女主角，她应该有冷酷的气质...",
        "prompt": "这是一个思考过程的 prompt，不应该被使用",
    }

    # _build_character_prompt 只用结构化字段，忽略 prompt/description
    prompt = _build_character_prompt(character_with_thought, style="cinematic")
    assert "林尘" in prompt
    assert "黑色短发" in prompt
    assert "皮夹克" in prompt
    # thought 文本不应出现在 prompt 中
    assert "我需要先构思" not in prompt
    assert "思考过程" not in prompt


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
async def test_add_failed_step_emits_observation_on_parse_error():
    """LLM 输出格式错误时，_add_failed_step 必须发射 OBSERVATION 事件，让前端看到反馈。

    回归问题：此前 _add_failed_step 只记录到 memory 不发事件，前端在连续格式错误时
    看不到任何反馈，agent 看似"卡住"，直到 max_steps 耗尽才收到 TASK_FAILED。
    """
    from app.agent.events import event_bus

    task_id = "t-parse-error"
    event_bus.clear_log(task_id)
    llm = _StubLLM([
        # LLM 返回无效 JSON，触发 parse_decision 失败
        {"content": "not json at all", "tool_name": None},
    ])
    memory = AgentMemory(user_goal="x", plan=[])
    runtime = AgentRuntime(task_id=task_id, llm=llm, memory=memory)

    await runtime.step()

    # 验证 memory 中有 failed step
    assert memory.short_term[0].status == "failed"
    assert "error" in memory.short_term[0].observation

    # 验证发射了 OBSERVATION 事件（前端能看到格式错误反馈）
    observations = [
        event for event in event_bus.get_replay(task_id)
        if event.type == "observation"
    ]
    assert observations, "前端应收到 OBSERVATION 事件，否则格式错误时 agent 看似卡住"
    assert observations[-1].payload["success"] is False
    assert observations[-1].payload["error"]


@pytest.mark.asyncio
async def test_empty_response_is_retried_without_user_visible_failure():
    """单次空响应属于内部恢复，不应写成用户可见失败。"""
    from app.agent.events import event_bus

    task_id = "t-empty-response"
    event_bus.clear_log(task_id)
    llm = _StubLLM([
        {"content": None, "tool_name": None},
    ])
    memory = AgentMemory(user_goal="x", plan=[])
    runtime = AgentRuntime(task_id=task_id, llm=llm, memory=memory)

    await runtime.step()

    observations = [
        event for event in event_bus.get_replay(task_id)
        if event.type == "observation"
    ]
    assert observations == []
    assert not any(step.status == "failed" for step in memory.short_term)
    notices = [
        event for event in event_bus.get_replay(task_id)
        if event.type == "agent_notice"
    ]
    assert notices
    assert notices[-1].payload["level"] == "warning"


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
    # 第 4 次：_step_count=4 > max_steps=3，强制结束（状态为 FAILED 而非 DONE，
    # 因为超限是一种失败，_run_runtime_loop 据此不发 TASK_DONE 覆盖 TASK_FAILED）
    is_done = await runtime.step()
    assert is_done is True
    assert runtime.state == AgentState.FAILED


# ========================
# 继续对话 + 记忆压缩测试
# ========================

@pytest.mark.asyncio
async def test_continue_conversation_rejects_when_not_done():
    """continue_conversation 只能在 DONE 状态调用。"""
    from app.agent.events import event_bus

    task_id = "t-continue-not-done"
    event_bus.clear_log(task_id)
    llm = _StubLLM([])
    memory = AgentMemory(user_goal="x", plan=[])
    runtime = AgentRuntime(task_id=task_id, llm=llm, memory=memory)
    runtime.state = AgentState.RUNNING

    result = await runtime.continue_conversation("追加需求")

    assert result is False
    assert runtime.state == AgentState.RUNNING


@pytest.mark.asyncio
async def test_continue_conversation_injects_followup_and_resumes():
    """DONE 状态下 continue_conversation 注入 user_followup step 并切回 RUNNING。"""
    from app.agent.events import event_bus

    task_id = "t-continue-basic"
    event_bus.clear_log(task_id)
    llm = _StubLLM([
        # continue_conversation 调用后 step() 会消费这个响应
        {"tool_name": "finish_task", "tool_args": {}, "content": None},
    ])
    memory = AgentMemory(user_goal="原始目标", plan=[])
    runtime = AgentRuntime(task_id=task_id, llm=llm, memory=memory)
    runtime.registry.register(_FinishLLMTool())
    runtime.state = AgentState.DONE

    result = await runtime.continue_conversation("再生成一个反派角色")

    assert result is True  # step() 跑完后 finish_task 返回 True
    # user_goal 应追加用户消息
    assert "[用户追加] 再生成一个反派角色" in memory.user_goal
    assert "原始目标" in memory.user_goal
    # 应注入 user_followup step
    followup_steps = [s for s in memory.short_term if s.action.get("tool") == "user_followup"]
    assert len(followup_steps) == 1
    assert followup_steps[0].observation["user_message"] == "再生成一个反派角色"
    # 应发射 CONVERSATION_CONTINUED 事件
    continued_events = [e for e in event_bus.get_replay(task_id) if e.type == EventType.CONVERSATION_CONTINUED]
    assert continued_events, "应发射 CONVERSATION_CONTINUED 事件"
    assert continued_events[-1].payload["user_message"] == "再生成一个反派角色"


@pytest.mark.asyncio
async def test_continue_conversation_empty_message_rejected():
    """空消息应被拒绝，不改变状态。"""
    llm = _StubLLM([])
    memory = AgentMemory(user_goal="x", plan=[])
    runtime = AgentRuntime(task_id="t1", llm=llm, memory=memory)
    runtime.state = AgentState.DONE

    result = await runtime.continue_conversation("   ")

    assert result is False
    assert runtime.state == AgentState.DONE


@pytest.mark.asyncio
async def test_compress_conversation_memory_compresses_early_steps():
    """步数超过阈值时，_compress_conversation_memory 把早期步骤压缩为摘要。"""
    from app.agent.events import event_bus

    task_id = "t-compress"
    event_bus.clear_log(task_id)
    # 压缩用 LLM 返回摘要文本
    llm = _StubLLM([
        {"content": "已生成脚本和 3 个角色，用户确认了武侠风格。", "tool_name": None, "tool_args": None},
    ])
    memory = AgentMemory(user_goal="武侠短剧", plan=[])
    # 预置 20 个 step（超过阈值 15）
    for i in range(1, 21):
        memory.add_step(
            step_number=i,
            thought=f"思考 {i}",
            action={"tool": "echo", "params": {"text": str(i)}},
            observation={"result": {"ok": True, "text": str(i)}},
            status="success",
        )
    runtime = AgentRuntime(task_id=task_id, llm=llm, memory=memory)

    await runtime._compress_conversation_memory(
        turn=1, user_message="继续生成场景", keep_recent=10,
    )

    # 早期 10 步被压缩，只保留最近 10 步
    assert len(memory.short_term) == 10
    assert memory.short_term[0].step_number == 11  # 保留的是 11-20
    # 摘要应被存入 compressed_summary
    assert "武侠" in memory.compressed_summary or "脚本" in memory.compressed_summary
    # conversation_turns 应记录这一轮
    assert len(memory.conversation_turns) == 1
    turn = memory.conversation_turns[0]
    assert turn["turn"] == 1
    assert turn["user_message"] == "继续生成场景"
    assert turn["step_range"] == [1, 10]
    # 应发射 MEMORY_COMPRESSED 事件
    compressed_events = [e for e in event_bus.get_replay(task_id) if e.type == EventType.MEMORY_COMPRESSED]
    assert compressed_events, "应发射 MEMORY_COMPRESSED 事件"
    assert compressed_events[-1].payload["compressed_count"] == 10


@pytest.mark.asyncio
async def test_compress_skips_when_below_threshold():
    """步数不超过 keep_recent 时不压缩。"""
    llm = _StubLLM([])
    memory = AgentMemory(user_goal="x", plan=[])
    for i in range(1, 6):  # 只有 5 步
        memory.add_step(step_number=i, thought="t", action={}, observation={}, status="success")
    runtime = AgentRuntime(task_id="t1", llm=llm, memory=memory)

    await runtime._compress_conversation_memory(turn=1, user_message="msg", keep_recent=10)

    assert len(memory.short_term) == 5  # 未变
    assert memory.compressed_summary == ""
    assert len(memory.conversation_turns) == 0


def test_build_react_prompt_includes_compressed_summary_and_turns():
    """build_react_prompt 应注入 compressed_summary 和 conversation_turns 段落。"""
    from app.agent.llm import build_react_prompt

    prompt = build_react_prompt(
        user_goal="武侠短剧",
        plan=[],
        artifacts={},
        recent_steps=[],
        tool_summaries=[],
        compressed_summary="第 1 轮已完成脚本生成和 3 个角色。",
        conversation_turns=[
            {"turn": 1, "user_message": "生成武侠短剧", "agent_summary": "已生成脚本", "step_range": [1, 10]},
        ],
    )
    assert "【早期执行摘要】" in prompt
    assert "第 1 轮已完成脚本生成" in prompt
    assert "【历史对话轮次】" in prompt
    assert "生成武侠短剧" in prompt


class TestRuntimeToolErrorRecovery:
    """Spec B: Runtime 工具失败恢复路径测试。"""

    @pytest.mark.asyncio
    async def test_execute_tool_retryable_error_sets_pending_and_paused(self):
        """RetryableError → pending_request 填充 + state=PAUSED。"""
        class _RetryableFailTool(BaseTool):
            name = "retryable_fail"
            description = "always fails with RetryableError"
            category = "test"
            parameters = []
            max_retries = 0  # 不重试，直接进入 PAUSED
            async def execute(self, ctx, params):
                raise RetryableError("network timeout")

        from app.agent.tools.base import RetryableTool
        llm = _StubLLM([
            {"tool_name": "retryable_fail", "tool_args": {}, "content": None},
        ])
        memory = AgentMemory(user_goal="x", plan=[])
        runtime = AgentRuntime(task_id="t1", llm=llm, memory=memory)
        runtime.registry.register(_RetryableFailTool())

        await runtime.step()

        assert runtime.state == AgentState.PAUSED
        assert runtime.pending_request is not None
        assert runtime.pending_request["type"] == "tool_error"
        assert runtime.pending_request["tool"] == "retryable_fail"
        assert "network timeout" in runtime.pending_request["error"]

    @pytest.mark.asyncio
    async def test_execute_tool_retryable_error_emits_tool_error_event(self):
        """RetryableError → emit TOOL_ERROR 事件。"""
        from app.agent.events import event_bus
        from app.agent.tools.base import RetryableError

        class _FailTool(BaseTool):
            name = "fail_tool"
            description = "fails"
            category = "test"
            parameters = []
            max_retries = 0
            async def execute(self, ctx, params):
                raise RetryableError("boom")

        llm = _StubLLM([
            {"tool_name": "fail_tool", "tool_args": {}, "content": None},
        ])
        memory = AgentMemory(user_goal="x", plan=[])
        runtime = AgentRuntime(task_id="t1", llm=llm, memory=memory)
        runtime.registry.register(_FailTool())

        events_received = []
        queue = event_bus.subscribe("t1")

        async def collect():
            try:
                for _ in range(10):
                    ev = await asyncio.wait_for(queue.get(), timeout=1.0)
                    events_received.append(ev)
                    if ev.type == "tool_error":
                        break
            except asyncio.TimeoutError:
                pass

        await asyncio.gather(runtime.step(), collect())

        tool_error_events = [e for e in events_received if e.type == "tool_error"]
        assert len(tool_error_events) == 1
        assert tool_error_events[0].payload["tool"] == "fail_tool"

        event_bus.unsubscribe("t1", queue)

    @pytest.mark.asyncio
    async def test_resume_from_tool_error_skip_injects_user_skip_observation(self):
        """skip → step 状态 skipped + observation 注入 user_skip。"""
        class _FailTool(BaseTool):
            name = "fail_tool"
            description = "fails"
            category = "test"
            parameters = []
            max_retries = 0
            async def execute(self, ctx, params):
                raise RetryableError("boom")

        # 第 1 步：失败 → PAUSED
        llm = _StubLLM([
            {"tool_name": "fail_tool", "tool_args": {}, "content": None},
        ])
        memory = AgentMemory(user_goal="x", plan=[])
        runtime = AgentRuntime(task_id="t1", llm=llm, memory=memory)
        runtime.registry.register(_FailTool())

        await runtime.step()
        assert runtime.state == AgentState.PAUSED

        # resume with skip
        await runtime.resume({"recovery_action": "skip"})

        # step 应标记 skipped，observation 含 user_skip
        last_step = memory.short_term[-1]
        assert last_step.status == "skipped"
        assert last_step.observation.get("user_skip") is True

    @pytest.mark.asyncio
    async def test_resume_from_tool_error_change_model_retries_with_new_model(self):
        """change_model → params.model_id 更新后重新执行。"""
        class _ModelAwareTool(BaseTool):
            name = "model_aware"
            description = "fails on primary, succeeds on fallback"
            category = "image"
            parameters = [ToolParameter(name="model_id", type="string", description="model", required=False)]
            max_retries = 0
            async def execute(self, ctx, params):
                if params.get("model_id") == "new-model":
                    return {"ok": True}
                raise RetryableError("primary model down")

        # 第 1 步：失败 → PAUSED
        llm = _StubLLM([
            {"tool_name": "model_aware", "tool_args": {"model_id": "primary"}, "content": None},
        ])
        memory = AgentMemory(user_goal="x", plan=[])
        runtime = AgentRuntime(task_id="t1", llm=llm, memory=memory)
        runtime.registry.register(_ModelAwareTool())

        await runtime.step()
        assert runtime.state == AgentState.PAUSED

        # resume with change_model
        await runtime.resume({
            "recovery_action": "change_model",
            "new_model_id": "new-model",
        })

        # 第 2 次 step 应成功
        last_step = memory.short_term[-1]
        assert last_step.status == "success"

    @pytest.mark.asyncio
    async def test_resume_from_tool_error_retry_retries_same_params(self):
        """retry → 用原 params 重新执行。"""
        class _FailOnceTool(BaseTool):
            name = "fail_once"
            description = "fails once then succeeds"
            category = "test"
            parameters = []
            max_retries = 0
            def __init__(self):
                super().__init__()
                self.call_count = 0
            async def execute(self, ctx, params):
                self.call_count += 1
                if self.call_count == 1:
                    raise RetryableError("first attempt fails")
                return {"ok": True}

        # 第 1 步：失败 → PAUSED
        llm = _StubLLM([
            {"tool_name": "fail_once", "tool_args": {}, "content": None},
        ])
        memory = AgentMemory(user_goal="x", plan=[])
        runtime = AgentRuntime(task_id="t1", llm=llm, memory=memory)
        tool = _FailOnceTool()
        runtime.registry.register(tool)

        await runtime.step()
        assert runtime.state == AgentState.PAUSED

        # resume with retry
        await runtime.resume({"recovery_action": "retry"})

        # 第 2 次 step 应成功
        last_step = memory.short_term[-1]
        assert last_step.status == "success"

    @pytest.mark.asyncio
    async def test_list_available_models_returns_empty_when_no_api_config(self):
        """api_config 为 None → available_models 空列表。"""
        llm = _StubLLM([])
        memory = AgentMemory(user_goal="x", plan=[])
        runtime = AgentRuntime(task_id="t1", llm=llm, memory=memory, api_config=None)
        tool = _EchoTool()
        models = runtime._list_available_models(tool)
        assert models == []

    @pytest.mark.asyncio
    async def test_list_available_models_queries_api_config(self):
        """api_config 有 list_models 方法 → 返回模型列表。"""
        class _MockApiConfig:
            def list_models(self, category: str):
                if category == "image":
                    return [{"id": "dall-e-3", "label": "DALL-E 3"}, {"id": "dall-e-2", "label": "DALL-E 2"}]
                return []

        llm = _StubLLM([])
        memory = AgentMemory(user_goal="x", plan=[])
        runtime = AgentRuntime(task_id="t1", llm=llm, memory=memory, api_config=_MockApiConfig())
        tool = _EchoTool()
        tool.category = "image"
        models = runtime._list_available_models(tool)
        assert len(models) == 2
        assert models[0] == {"id": "dall-e-3", "label": "DALL-E 3"}


@pytest.mark.asyncio
async def test_media_tool_retries_transient_failure_before_success(monkeypatch):
    monkeypatch.setattr(tools_base.asyncio, "sleep", AsyncMock())
    runtime = AgentRuntime(task_id="t-media-retry", llm=_StubLLM([]), memory=AgentMemory("x"))
    tool = _RetryingMediaTool()
    runtime.registry.register(tool)
    observation, status = await runtime._execute_tool("generate_scene_image", {})
    assert status == "success"
    assert observation["result"]["url"] == "https://cdn.test/scene.png"
    assert tool.calls == 3


@pytest.mark.asyncio
async def test_media_failure_pauses_agent_after_retries_and_blocks_followup(monkeypatch):
    monkeypatch.setattr(tools_base.asyncio, "sleep", AsyncMock())
    runtime = AgentRuntime(task_id="t-media-failed", llm=_StubLLM([]), memory=AgentMemory("x"))
    tool = _AlwaysFailingMediaTool()
    runtime.registry.register(tool)
    observation, status = await runtime._execute_tool("generate_scene_image", {})
    assert status == "paused"
    assert runtime.state == AgentState.PAUSED
    assert runtime.pending_request["type"] == "tool_error"
    assert tool.calls == 3
    assert observation["pending"] == "awaiting_user_recovery"


@pytest.mark.asyncio
async def test_partial_media_batch_pauses_before_agent_can_continue():
    runtime = AgentRuntime(task_id="t-media-partial", llm=_StubLLM([]), memory=AgentMemory("x"))
    runtime.registry.register(_PartialBatchMediaTool())
    observation, status = await runtime._execute_tool("generate_media_batch", {})
    assert status == "paused"
    assert runtime.state == AgentState.PAUSED
    assert runtime.pending_request["type"] == "tool_error"
    assert "1 个资产生成失败" in runtime.pending_request["error"]
    assert observation["pending"] == "awaiting_user_recovery"
