"""AgentRuntime ReAct 主循环测试。"""
import asyncio
import pytest
from unittest.mock import AsyncMock, MagicMock

from app.agent.runtime import AgentRuntime, AgentState, parse_decision
from app.agent.events import EventType
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
async def test_runtime_projects_saved_asset_into_memory_artifacts():
    """save_asset 成功后必须进入 artifacts，供前端生成普通资产节点。"""
    llm = _StubLLM([{"tool_name": "save_asset", "tool_args": {}, "content": None}])
    memory = AgentMemory(user_goal="郑明传奇", plan=[])
    runtime = AgentRuntime(task_id="t1", llm=llm, memory=memory)
    runtime.registry.register(_SaveAssetTool())

    await runtime.step()

    assert memory.artifacts["script"][0]["id"] == "asset-1"


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
    # 第 4 次：_step_count=4 > max_steps=3，强制结束（状态为 FAILED 而非 DONE，
    # 因为超限是一种失败，_run_runtime_loop 据此不发 TASK_DONE 覆盖 TASK_FAILED）
    is_done = await runtime.step()
    assert is_done is True
    assert runtime.state == AgentState.FAILED


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
