# 工具失败恢复 (Tool Failure Recovery) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 agent 在工具调用失败时自我恢复（自动重试 + 换模型），最后决策权交给用户（重试/换模型/跳过）。

**Architecture:** 在 `BaseTool` 上加 3 个类属性（`max_retries` / `retry_backoff_base` / `fallback_model_id`），新增 `RetryableTool` 包装器实现自动重试 + fallback 降级。`AgentRuntime._execute_tool` 捕获 `RetryableError` 后挂起任务（PAUSED）+ 推送 `tool_error` 事件。`resume()` 新增 `_resume_from_tool_error` 分派 retry/change_model/skip。前端 `useAgentStore` 新增 `pendingErrorRecovery` 状态 + `ErrorRecoveryCard` 模态卡组件。

**Tech Stack:** Python 3.11 + FastAPI + Pydantic + pytest + asyncio | TypeScript + React + zustand + Vitest + React Testing Library

## Global Constraints

- 现有 100 个前端测试 + 131 个后端测试必须全过
- `Tool` / `BaseTool` / `ToolContext` / `ToolRegistry` 现有 API 保持兼容（只增字段/方法）
- `EventType` 枚举只增不改
- `AgentUserResponse` schema 只增字段不改语义
- 不引入新的外部依赖
- Python 包管理使用 uv（已确认）
- TDD：每个任务先写失败测试，再实现，最后验证全绿
- 测试运行命令：
  - 后端：`cd backend; uv run pytest -q`
  - 前端：`cd c:\Users\25315\PycharmProjects\dramaforge-ai; npm test -- --run`
- Spec 文件：[2026-06-30-tool-failure-recovery-design.md](file:///c:/Users/25315/PycharmProjects/dramaforge-ai/docs/superpowers/specs/2026-06-30-tool-failure-recovery-design.md)
- BaseTool 现有定义：[base.py](file:///c:/Users/25315/PycharmProjects/dramaforge-ai/backend/app/agent/tools/base.py)
- AgentRuntime 现有定义：[runtime.py](file:///c:/Users/25315/PycharmProjects/dramaforge-ai/backend/app/agent/runtime.py)
- useAgentStore 现有定义：[use-agent-store.ts](file:///c:/Users/25315/PycharmProjects/dramaforge-ai/agent/use-agent-store.ts)

---

## 文件结构

| 文件 | 责任 |
|---|---|
| `backend/app/agent/tools/base.py` (改) | + `RetryableTool` 类 + `BaseTool` 3 字段 |
| `backend/app/agent/events.py` (改) | + 4 个 EventType |
| `backend/app/agent/runtime.py` (改) | `_execute_tool` 改造 + `_resume_from_tool_error` + `_list_available_models` |
| `backend/app/schemas.py` (改) | `AgentUserResponse` + 2 字段 |
| `backend/app/routers/agent.py` (改) | `user_respond` 传递 recovery 字段 |
| `agent/use-agent-store.ts` (改) | + `pendingErrorRecovery` + 4 个 case + `clearErrorRecovery` |
| `agent/error-recovery-card.tsx` (新) | 模态卡组件 |
| `agent/agent-mode.tsx` (改) | 挂载 ErrorRecoveryCard |
| `agent/thought-stream.tsx` (改) | fmtPayload 增强 |
| `backend/tests/test_retryable_tool.py` (新) | RetryableTool 单测 |
| `backend/tests/test_agent_runtime.py` (改) | runtime 改造测试 |
| `backend/tests/test_agent_events.py` (改) | 新 EventType 测试 |
| `tests/agent/error-recovery-card.test.tsx` (新) | 组件测试 |
| `tests/agent/use-agent-store.test.ts` (改) | store 扩展测试 |
| `tests/agent/thought-stream.test.tsx` (改) | 显示增强测试 |

## 任务依赖图

```
Task 1 (RetryableTool + BaseTool fields)
   ↓
Task 2 (EventType + events.py)
   ↓
Task 3 (Runtime _execute_tool + _resume_from_tool_error)
   ↓
Task 4 (Schema + Router)
   ↓
Task 5 (useAgentStore + ErrorRecoveryCard)
   ↓
Task 6 (AgentMode integration + ThoughtStream)
```

任务间严格串行：后端 runtime 完成后前端才能集成。

---

### Task 1: RetryableTool 包装器 + BaseTool 扩展字段

**Files:**
- Modify: `c:\Users\25315\PycharmProjects\dramaforge-ai\backend\app\agent\tools\base.py:111-135` (BaseTool 类)
- Modify: `c:\Users\25315\PycharmProjects\dramaforge-ai\backend\app\agent\tools\base.py` (末尾新增 RetryableTool 类)
- Test: `c:\Users\25315\PycharmProjects\dramaforge-ai\backend\tests\test_retryable_tool.py` (新)

**Interfaces:**
- Consumes: `BaseTool` / `ToolContext` / `RetryableError` / `NonRetryableError` / `ToolValidationError`（已存在于 base.py）
- Produces:
  - `BaseTool.max_retries: int = 2`（类属性）
  - `BaseTool.retry_backoff_base: float = 1.0`（类属性）
  - `BaseTool.fallback_model_id: str | None = None`（类属性）
  - `RetryableTool(tool: BaseTool, max_retries: int | None = None, backoff_base: float | None = None)` 构造函数
  - `RetryableTool.call(ctx: ToolContext, params: dict) -> dict` 异步方法
  - `RetryableTool.__getattr__` 委托给 `self.tool`

- [ ] **Step 1: 写失败测试**

`backend/tests/test_retryable_tool.py` 内容：

```python
"""RetryableTool 包装器测试：自动重试 + fallback_model 降级。"""
import asyncio
import pytest
from unittest.mock import AsyncMock, MagicMock, patch

from app.agent.tools.base import (
    BaseTool,
    ToolContext,
    ToolParameter,
    RetryableError,
    NonRetryableError,
    ToolValidationError,
    RetryableTool,
)


class _SuccessTool(BaseTool):
    """总是成功的工具。"""
    name = "success_tool"
    description = "always succeeds"
    category = "test"
    parameters = []
    async def execute(self, ctx, params):
        return {"ok": True}


class _RetryableFailTool(BaseTool):
    """总是抛 RetryableError 的工具。"""
    name = "retryable_fail"
    description = "always fails with RetryableError"
    category = "test"
    parameters = []
    async def execute(self, ctx, params):
        raise RetryableError("network timeout")


class _FailTwiceTool(BaseTool):
    """前两次失败，第三次成功。"""
    name = "fail_twice"
    description = "fails twice then succeeds"
    category = "test"
    parameters = []
    def __init__(self):
        super().__init__()
        self.call_count = 0
    async def execute(self, ctx, params):
        self.call_count += 1
        if self.call_count < 3:
            raise RetryableError(f"attempt {self.call_count} failed")
        return {"ok": True, "attempt": self.call_count}


class _NonRetryableFailTool(BaseTool):
    """总是抛 NonRetryableError 的工具。"""
    name = "non_retryable_fail"
    description = "always fails with NonRetryableError"
    category = "test"
    parameters = []
    async def execute(self, ctx, params):
        raise NonRetryableError("permission denied")


class _ValidationFailTool(BaseTool):
    """总是抛 ToolValidationError 的工具。"""
    name = "validation_fail"
    description = "always fails with ToolValidationError"
    category = "test"
    parameters = []
    async def execute(self, ctx, params):
        raise ToolValidationError("bad params")


class _FallbackTool(BaseTool):
    """有 fallback_model_id 的工具，原模型失败后换 fallback 成功。"""
    name = "fallback_tool"
    description = "fails on primary, succeeds on fallback"
    category = "image"
    fallback_model_id = "fallback-model-v1"
    parameters = [ToolParameter(name="model_id", type="string", description="model", required=False)]
    def __init__(self):
        super().__init__()
        self.call_count = 0
    async def execute(self, ctx, params):
        self.call_count += 1
        if params.get("model_id") == "fallback-model-v1":
            return {"ok": True, "model": "fallback"}
        raise RetryableError("primary model unavailable")


class _FallbackFailTool(BaseTool):
    """有 fallback_model_id 但 fallback 也失败。"""
    name = "fallback_fail"
    description = "fails on both primary and fallback"
    category = "image"
    fallback_model_id = "fallback-model-v1"
    max_retries = 1
    parameters = [ToolParameter(name="model_id", type="string", description="model", required=False)]
    async def execute(self, ctx, params):
        raise RetryableError("all models unavailable")


def _make_ctx():
    """构造测试用 ToolContext。"""
    ctx = MagicMock(spec=ToolContext)
    ctx.emit_event = MagicMock()
    return ctx


class TestRetryableToolSuccess:
    """成功路径测试。"""

    @pytest.mark.asyncio
    async def test_success_no_retry(self):
        """成功调用：不重试，直接返回结果。"""
        tool = _SuccessTool()
        wrapped = RetryableTool(tool)
        ctx = _make_ctx()
        result = await wrapped.call(ctx, {})
        assert result == {"ok": True}
        # 不应该有 retrying 事件
        ctx.emit_event.assert_not_called()

    @pytest.mark.asyncio
    async def test_success_after_retries(self):
        """前两次失败，第三次成功：应重试到成功。"""
        tool = _FailTwiceTool()
        wrapped = RetryableTool(tool, max_retries=3)
        ctx = _make_ctx()
        with patch("app.agent.tools.base.asyncio.sleep", new=AsyncMock()):
            result = await wrapped.call(ctx, {})
        assert result["ok"] is True
        assert result["attempt"] == 3
        # 应该 emit 了 2 次 tool_retrying 事件
        retrying_calls = [c for c in ctx.emit_event.call_args_list if c.args[0] == "tool_retrying"]
        assert len(retrying_calls) == 2


class TestRetryableToolFailure:
    """失败路径测试。"""

    @pytest.mark.asyncio
    async def test_retry_exhausted_no_fallback_raises(self):
        """重试耗尽 + 无 fallback → 抛 RetryableError。"""
        tool = _RetryableFailTool()
        wrapped = RetryableTool(tool, max_retries=2)
        ctx = _make_ctx()
        with patch("app.agent.tools.base.asyncio.sleep", new=AsyncMock()):
            with pytest.raises(RetryableError):
                await wrapped.call(ctx, {})

    @pytest.mark.asyncio
    async def test_non_retryable_not_retried(self):
        """NonRetryableError 不重试，直接抛出。"""
        tool = _NonRetryableFailTool()
        wrapped = RetryableTool(tool, max_retries=3)
        ctx = _make_ctx()
        with pytest.raises(NonRetryableError):
            await wrapped.call(ctx, {})
        ctx.emit_event.assert_not_called()

    @pytest.mark.asyncio
    async def test_validation_error_not_retried(self):
        """ToolValidationError 不重试，直接抛出。"""
        tool = _ValidationFailTool()
        wrapped = RetryableTool(tool, max_retries=3)
        ctx = _make_ctx()
        with pytest.raises(ToolValidationError):
            await wrapped.call(ctx, {})
        ctx.emit_event.assert_not_called()


class TestRetryableToolFallback:
    """Fallback 模型降级测试。"""

    @pytest.mark.asyncio
    async def test_fallback_model_succeeds(self):
        """原模型失败 → 换 fallback_model_id → 成功。"""
        tool = _FallbackTool()
        wrapped = RetryableTool(tool, max_retries=1)
        ctx = _make_ctx()
        with patch("app.agent.tools.base.asyncio.sleep", new=AsyncMock()):
            result = await wrapped.call(ctx, {"model_id": "primary-model"})
        assert result["ok"] is True
        assert result["model"] == "fallback"
        # 应该 emit 了 tool_fallback_model 事件
        fallback_calls = [c for c in ctx.emit_event.call_args_list if c.args[0] == "tool_fallback_model"]
        assert len(fallback_calls) == 1
        assert fallback_calls[0].args[1]["to_model"] == "fallback-model-v1"

    @pytest.mark.asyncio
    async def test_fallback_model_also_fails_raises(self):
        """原模型失败 + fallback 也失败 → 抛 RetryableError。"""
        tool = _FallbackFailTool()
        wrapped = RetryableTool(tool, max_retries=1)
        ctx = _make_ctx()
        with patch("app.agent.tools.base.asyncio.sleep", new=AsyncMock()):
            with pytest.raises(RetryableError):
                await wrapped.call(ctx, {"model_id": "primary-model"})

    @pytest.mark.asyncio
    async def test_fallback_not_attempted_when_already_using_fallback_model(self):
        """params 已用 fallback_model_id → 不再换 fallback（避免循环）。"""
        tool = _FallbackTool()
        wrapped = RetryableTool(tool, max_retries=1)
        ctx = _make_ctx()
        with patch("app.agent.tools.base.asyncio.sleep", new=AsyncMock()):
            with pytest.raises(RetryableError):
                await wrapped.call(ctx, {"model_id": "fallback-model-v1"})
        # 不应该有 fallback 事件
        fallback_calls = [c for c in ctx.emit_event.call_args_list if c.args[0] == "tool_fallback_model"]
        assert len(fallback_calls) == 0


class TestRetryableToolConfig:
    """配置测试：max_retries / backoff_base 来源。"""

    @pytest.mark.asyncio
    async def test_uses_tool_max_retries_by_default(self):
        """不传 max_retries 时用 tool.max_retries。"""
        tool = _RetryableFailTool()
        tool.max_retries = 1
        wrapped = RetryableTool(tool)
        assert wrapped.max_retries == 1

    @pytest.mark.asyncio
    async def test_explicit_max_retries_overrides_tool(self):
        """显式传 max_retries 覆盖 tool.max_retries。"""
        tool = _RetryableFailTool()
        tool.max_retries = 5
        wrapped = RetryableTool(tool, max_retries=1)
        assert wrapped.max_retries == 1

    @pytest.mark.asyncio
    async def test_backoff_sleep_called_with_exponential_delay(self):
        """指数退避：sleep 被调用，delay = backoff_base * 2^attempt。"""
        tool = _RetryableFailTool()
        wrapped = RetryableTool(tool, max_retries=2, backoff_base=1.0)
        ctx = _make_ctx()
        mock_sleep = AsyncMock()
        with patch("app.agent.tools.base.asyncio.sleep", new=mock_sleep):
            with pytest.raises(RetryableError):
                await wrapped.call(ctx, {})
        # 2 次 sleep：delay 1.0 (2^0) 和 2.0 (2^1)
        assert mock_sleep.call_count == 2
        assert mock_sleep.call_args_list[0].args[0] == 1.0
        assert mock_sleep.call_args_list[1].args[0] == 2.0


class TestRetryableToolAttrDelegation:
    """__getattr__ 委托测试。"""

    def test_delegates_name(self):
        tool = _SuccessTool()
        wrapped = RetryableTool(tool)
        assert wrapped.name == "success_tool"

    def test_delegates_category(self):
        tool = _SuccessTool()
        wrapped = RetryableTool(tool)
        assert wrapped.category == "test"

    def test_delegates_parameters(self):
        tool = _FallbackTool()
        wrapped = RetryableTool(tool)
        assert len(wrapped.parameters) == 1
        assert wrapped.parameters[0].name == "model_id"

    def test_delegates_fallback_model_id(self):
        tool = _FallbackTool()
        wrapped = RetryableTool(tool)
        assert wrapped.fallback_model_id == "fallback-model-v1"
```

- [ ] **Step 2: 运行测试，预期失败**

Run: `cd "c:\Users\25315\PycharmProjects\dramaforge-ai\backend"; uv run pytest tests/test_retryable_tool.py -v`
Expected: FAIL with "ImportError: cannot import name 'RetryableTool' from 'app.agent.tools.base'"

- [ ] **Step 3: 修改 base.py — BaseTool 加 3 个类属性**

在 `backend/app/agent/tools/base.py` 的 `BaseTool` 类中，在 `idempotent: bool = False` 后添加 3 行：

```python
class BaseTool:
    """Tool 的便利基类，集成 validate + call 流程。"""

    name: str = ""
    description: str = ""
    category: str = "general"
    requires_approval: bool = False
    parameters: list[ToolParameter] = []
    estimated_cost_usd: float = 0.0
    estimated_time_sec: float = 0.0
    idempotent: bool = False
    # 失败恢复配置（Spec B）
    max_retries: int = 2
    retry_backoff_base: float = 1.0
    fallback_model_id: str | None = None

    async def validate(self, ctx: ToolContext, params: dict) -> str | None:
        """子类可重写。返回 None 表示 OK。"""
        return None

    async def execute(self, ctx: ToolContext, params: dict) -> dict:
        raise NotImplementedError

    async def call(self, ctx: ToolContext, params: dict) -> dict:
        """统一入口：先 validate 再 execute。"""
        err = await self.validate(ctx, params)
        if err is not None:
            raise ToolValidationError(f"[{self.name}] {err}")
        return await self.execute(ctx, params)
```

- [ ] **Step 4: 修改 base.py — 末尾新增 RetryableTool 类**

在 `backend/app/agent/tools/base.py` 文件末尾（`_json_type_to_openai` 函数之后）添加：

```python
# ========================
# RetryableTool 包装器
# ========================

class RetryableTool:
    """包装 Tool，实现自动重试 + fallback_model 降级。

    流程：
    1. 尝试原始 params 调用
    2. RetryableError → 指数退避重试 max_retries 次
    3. 仍失败 → 若 tool.fallback_model_id 存在，换模型重试 1 次
    4. 仍失败 → 抛 RetryableError 让 runtime 进入 PAUSED

    属性透传：通过 __getattr__ 委托给 self.tool，
    使 RetryableTool 可像 BaseTool 一样被 registry 使用。
    """

    def __init__(
        self,
        tool: BaseTool,
        max_retries: int | None = None,
        backoff_base: float | None = None,
    ):
        self.tool = tool
        self.max_retries = max_retries if max_retries is not None else getattr(tool, "max_retries", 2)
        self.backoff_base = backoff_base if backoff_base is not None else getattr(tool, "retry_backoff_base", 1.0)

    async def call(self, ctx: ToolContext, params: dict) -> dict:
        """执行工具，带自动重试 + fallback_model 降级。"""
        last_error: Exception | None = None
        original_model_id = params.get("model_id")

        for attempt in range(self.max_retries + 1):
            try:
                return await self.tool.call(ctx, params)
            except RetryableError as e:
                last_error = e
                if attempt < self.max_retries:
                    delay = self.backoff_base * (2 ** attempt)
                    ctx.emit_event("tool_retrying", {
                        "tool": self.tool.name,
                        "attempt": attempt + 1,
                        "max_retries": self.max_retries,
                        "delay_sec": delay,
                        "error": str(e),
                    })
                    await asyncio.sleep(delay)
                    continue
                # 重试耗尽 → 尝试 fallback_model
                fb = getattr(self.tool, "fallback_model_id", None)
                if fb and params.get("model_id") != fb:
                    new_params = {**params, "model_id": fb}
                    ctx.emit_event("tool_fallback_model", {
                        "tool": self.tool.name,
                        "from_model": original_model_id,
                        "to_model": fb,
                    })
                    try:
                        return await self.tool.call(ctx, new_params)
                    except RetryableError as e2:
                        last_error = e2
                # fallback 也失败或无 fallback → 抛出让 runtime 挂起
                break
            except NonRetryableError:
                raise  # 不可重试直接抛出
        raise last_error  # type: ignore[misc]

    def __getattr__(self, name: str):
        """委托未定义属性给 self.tool。"""
        return getattr(self.tool, name)
```

- [ ] **Step 5: 运行测试，预期通过**

Run: `cd "c:\Users\25315\PycharmProjects\dramaforge-ai\backend"; uv run pytest tests/test_retryable_tool.py -v`
Expected: PASS (15 tests)

- [ ] **Step 6: 运行全量后端测试，确保无回归**

Run: `cd "c:\Users\25315\PycharmProjects\dramaforge-ai\backend"; uv run pytest -q`
Expected: PASS (原 131 + 新 15 = 146 tests)

- [ ] **Step 7: 提交**

```bash
cd "c:\Users\25315\PycharmProjects\dramaforge-ai"
git add backend/app/agent/tools/base.py backend/tests/test_retryable_tool.py
git commit -m "feat(tools): add RetryableTool wrapper + BaseTool retry/fallback fields"
```

---

### Task 2: EventType 新增 4 类 + events.py

**Files:**
- Modify: `c:\Users\25315\PycharmProjects\dramaforge-ai\backend\app\agent\events.py:15-32` (EventType 枚举)
- Test: `c:\Users\25315\PycharmProjects\dramaforge-ai\backend\tests\test_agent_events.py` (改，新增 case)

**Interfaces:**
- Consumes: 无
- Produces:
  - `EventType.TOOL_RETRYING = "tool_retrying"`
  - `EventType.TOOL_FALLBACK_MODEL = "tool_fallback_model"`
  - `EventType.TOOL_ERROR = "tool_error"`
  - `EventType.TOOL_RESUMED = "tool_resumed"`

- [ ] **Step 1: 写失败测试**

在 `backend/tests/test_agent_events.py` 末尾添加：

```python
class TestToolFailureRecoveryEvents:
    """Spec B: 工具失败恢复相关事件类型。"""

    def test_tool_retrying_event_type_exists(self):
        """TOOL_RETRYING 事件类型存在。"""
        assert EventType.TOOL_RETRYING.value == "tool_retrying"

    def test_tool_fallback_model_event_type_exists(self):
        """TOOL_FALLBACK_MODEL 事件类型存在。"""
        assert EventType.TOOL_FALLBACK_MODEL.value == "tool_fallback_model"

    def test_tool_error_event_type_exists(self):
        """TOOL_ERROR 事件类型存在。"""
        assert EventType.TOOL_ERROR.value == "tool_error"

    def test_tool_resumed_event_type_exists(self):
        """TOOL_RESUMED 事件类型存在。"""
        assert EventType.TOOL_RESUMED.value == "tool_resumed"

    def test_tool_error_event_sse_format(self):
        """tool_error 事件转 SSE 格式正确。"""
        event = AgentEvent(
            task_id="t1",
            type=EventType.TOOL_ERROR,
            payload={"tool": "generate_image", "error": "timeout", "step_id": "3"},
        )
        sse = event.to_sse()
        assert "event: tool_error" in sse
        assert '"tool": "generate_image"' in sse

    def test_tool_resumed_event_sse_format(self):
        """tool_resumed 事件转 SSE 格式正确。"""
        event = AgentEvent(
            task_id="t1",
            type=EventType.TOOL_RESUMED,
            payload={"step_id": "3", "action": "retry"},
        )
        sse = event.to_sse()
        assert "event: tool_resumed" in sse
        assert '"action": "retry"' in sse
```

- [ ] **Step 2: 运行测试，预期失败**

Run: `cd "c:\Users\25315\PycharmProjects\dramaforge-ai\backend"; uv run pytest tests/test_agent_events.py::TestToolFailureRecoveryEvents -v`
Expected: FAIL with "AttributeError: TOOL_RETRYING is not a valid EventType"

- [ ] **Step 3: 修改 events.py**

在 `backend/app/agent/events.py` 的 `EventType` 枚举中，在 `STEP_RETRYING = "step_retrying"` 后添加 4 个新成员：

```python
class EventType(str, Enum):
    """agent 事件类型。"""
    TASK_STARTED = "task_started"
    GOAL_PARSED = "goal_parsed"
    THOUGHT = "thought"
    ACTION = "action"
    OBSERVATION = "observation"
    PLAN_READY = "plan_ready"
    PLAN_REVISED = "plan_revised"
    REQUEST_USER_INPUT = "request_user_input"
    USER_INPUT_RECEIVED = "user_input_received"
    ARTIFACT_CREATED = "artifact_created"
    COST_UPDATE = "cost_update"
    TASK_PAUSED = "task_paused"
    TASK_RESUMED = "task_resumed"
    TASK_DONE = "task_done"
    TASK_FAILED = "task_failed"
    STEP_RETRYING = "step_retrying"
    # Spec B: 工具失败恢复
    TOOL_RETRYING = "tool_retrying"
    TOOL_FALLBACK_MODEL = "tool_fallback_model"
    TOOL_ERROR = "tool_error"
    TOOL_RESUMED = "tool_resumed"
```

- [ ] **Step 4: 运行测试，预期通过**

Run: `cd "c:\Users\25315\PycharmProjects\dramaforge-ai\backend"; uv run pytest tests/test_agent_events.py -v`
Expected: PASS (原 + 新 6 = 全部通过)

- [ ] **Step 5: 运行全量后端测试，确保无回归**

Run: `cd "c:\Users\25315\PycharmProjects\dramaforge-ai\backend"; uv run pytest -q`
Expected: PASS

- [ ] **Step 6: 提交**

```bash
cd "c:\Users\25315\PycharmProjects\dramaforge-ai"
git add backend/app/agent/events.py backend/tests/test_agent_events.py
git commit -m "feat(events): add TOOL_RETRYING/TOOL_FALLBACK_MODEL/TOOL_ERROR/TOOL_RESUMED event types"
```

---

### Task 3: Runtime _execute_tool 改造 + _resume_from_tool_error

**Files:**
- Modify: `c:\Users\25315\PycharmProjects\dramaforge-ai\backend\app\agent\runtime.py:186-207` (resume 方法)
- Modify: `c:\Users\25315\PycharmProjects\dramaforge-ai\backend\app\agent\runtime.py:243-267` (_execute_tool 方法)
- Test: `c:\Users\25315\PycharmProjects\dramaforge-ai\backend\tests\test_agent_runtime.py` (改，新增 case)

**Interfaces:**
- Consumes: `RetryableTool` (Task 1) + `EventType.TOOL_ERROR` / `EventType.TOOL_RESUMED` (Task 2)
- Produces:
  - `AgentRuntime._execute_tool` 改造：用 RetryableTool 包装，捕获 RetryableError → PAUSED + pending_request
  - `AgentRuntime._resume_from_tool_error(user_response: dict) -> bool`
  - `AgentRuntime._list_available_models(tool) -> list[dict]`
  - `AgentRuntime.pending_request` 新增 `"type": "tool_error"` 分支

- [ ] **Step 1: 写失败测试**

在 `backend/tests/test_agent_runtime.py` 末尾添加：

```python
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
```

需要在 test 文件顶部新增 import：

```python
from app.agent.tools.base import (
    BaseTool,
    ToolContext,
    ToolParameter,
    RetryableError,
    NonRetryableError,
    ToolValidationError,
    RetryableTool,
)
```

- [ ] **Step 2: 运行测试，预期失败**

Run: `cd "c:\Users\25315\PycharmProjects\dramaforge-ai\backend"; uv run pytest tests/test_agent_runtime.py::TestRuntimeToolErrorRecovery -v`
Expected: FAIL (7 tests fail — runtime 还没改造)

- [ ] **Step 3: 修改 runtime.py — import RetryableTool + NonRetryableError**

在 `backend/app/agent/runtime.py` 的 import 区域，修改 `from .tools.base import` 部分：

```python
from .tools.base import (
    BaseTool,
    NonRetryableError,
    RetryableError,
    RetryableTool,
    ToolContext,
    ToolRegistry,
    ToolValidationError,
)
```

- [ ] **Step 4: 修改 runtime.py — _execute_tool 改造**

替换 `backend/app/agent/runtime.py` 的 `_execute_tool` 方法（243-267 行）：

```python
    async def _execute_tool(self, tool_name: str, params: dict) -> tuple[dict, str]:
        """执行工具，返回 (observation, status)。

        Spec B: 用 RetryableTool 包装 BaseTool，实现自动重试 + fallback 降级。
        RetryableError 耗尽后挂起任务（PAUSED）等待用户决策。
        """
        tool = self.registry.get(tool_name)
        if not tool:
            return {"error": f"Unknown tool: {tool_name}"}, "failed"

        ctx = ToolContext(
            task_id=self.task_id,
            project_id=self.project_id,
            db=self.db,
            llm_client=self.llm,
            api_config=self.api_config,
            artifacts=self.memory.artifacts,
            skip_confirm=self.skip_confirm,
            emit=lambda t, p: self._emit_sync(t, p),
        )
        # 用 RetryableTool 包装 BaseTool（自动重试 + fallback）
        wrapped = RetryableTool(tool) if isinstance(tool, BaseTool) else tool
        try:
            result = await wrapped.call(ctx, params)
            return {"success": True, "result": result}, "success"
        except ToolValidationError as e:
            return {"error": str(e)}, "failed"
        except RetryableError as e:
            # 挂起等待用户决策
            self.pending_request = {
                "type": "tool_error",
                "step_id": str(self._step_count),
                "tool": tool_name,
                "error": str(e),
                "params": params,
                "fallback_model_id": getattr(tool, "fallback_model_id", None),
                "available_models": self._list_available_models(tool),
            }
            await self._emit(EventType.TOOL_ERROR, self.pending_request)
            self.state = AgentState.PAUSED
            return {"error": str(e), "pending": "awaiting_user_recovery"}, "paused"
        except NonRetryableError as e:
            return {"error": str(e), "non_retryable": True}, "failed"
        except Exception as e:
            return {"error": str(e), "type": type(e).__name__}, "failed"
```

- [ ] **Step 5: 修改 runtime.py — resume() 新增 tool_error 分支**

替换 `backend/app/agent/runtime.py` 的 `resume` 方法（186-207 行）：

```python
    async def resume(self, user_response: Any) -> bool:
        """从 PAUSED 恢复，继续执行。

        Spec B: 支持 tool_error 恢复（retry/change_model/skip）和原有 ask_user。
        """
        if self.state != AgentState.PAUSED:
            return False

        req = self.pending_request or {}
        req_type = req.get("type", "ask_user")

        if req_type == "tool_error":
            return await self._resume_from_tool_error(user_response)

        # 原有 ask_user 逻辑：把用户响应作为 observation 注入最近 step
        if self.memory.short_term and self.memory.short_term[-1].status == "pending":
            last = self.memory.short_term[-1]
            last.observation = {"success": True, "user_response": user_response}
            last.status = "success"
        else:
            self.memory.add_step(
                step_number=self._step_count + 1,
                thought="(user input)",
                action={"tool": "ask_user_response"},
                observation={"user_response": user_response},
                status="success",
            )
        self.pending_request = None
        self.state = AgentState.RUNNING
        await self._emit(EventType.USER_INPUT_RECEIVED, {"response": user_response})
        return await self.step()
```

- [ ] **Step 6: 修改 runtime.py — 新增 _resume_from_tool_error + _list_available_models**

在 `backend/app/agent/runtime.py` 的 `_execute_tool` 方法之后、`_add_failed_step` 之前添加两个新方法：

```python
    async def _resume_from_tool_error(self, user_response: Any) -> bool:
        """用户对 tool_error 的响应：retry / change_model / skip。

        Spec B: 用户决策后恢复执行。
        - retry: 用原 params 重新执行
        - change_model: 更新 params.model_id 后重新执行
        - skip: 注入 user_skip observation，agent 继续 think
        """
        # 兼容 dict 和裸值
        if isinstance(user_response, dict):
            action = user_response.get("recovery_action", "retry")
            new_model_id = user_response.get("new_model_id")
        else:
            action = "retry"
            new_model_id = None

        step_id = self.pending_request["step_id"]
        tool_name = self.pending_request["tool"]
        params = self.pending_request["params"]
        error_msg = self.pending_request["error"]

        await self._emit(EventType.TOOL_RESUMED, {"step_id": step_id, "action": action})

        if action == "skip":
            # 注入 user_skip observation，step 标 skipped，agent 继续 think
            self.memory.add_step(
                step_number=self._step_count,
                thought="(user skipped)",
                action={"tool": tool_name, "params": params},
                observation={"success": False, "user_skip": True, "error": error_msg},
                status="skipped",
            )
            self.pending_request = None
            self.state = AgentState.RUNNING
            return await self.step()

        # retry / change_model → 重新执行该 step
        if action == "change_model" and new_model_id:
            params = {**params, "model_id": new_model_id}

        self.pending_request = None
        self.state = AgentState.RUNNING
        # 重新执行同一步（_step_count 不变）
        observation, status = await self._execute_tool(tool_name, params)
        # 记录 step + emit observation
        self.memory.add_step(
            step_number=self._step_count,
            thought="(retry after user recovery)",
            action={"tool": tool_name, "params": params},
            observation=observation,
            status=status,
        )
        await self._emit(EventType.OBSERVATION, {
            "step": self._step_count,
            "success": status == "success",
            "result": observation.get("result") if status == "success" else None,
            "error": observation.get("error"),
        })
        # 无论成功失败，都返回 False 让主循环继续 think 下一步
        return False

    def _list_available_models(self, tool) -> list[dict]:
        """查询同 category 的可用模型列表（供前端下拉）。

        Spec B: api_config 提供 list_models(category) 方法时返回模型列表，
        否则返回空列表（用户仍可手动输入 model_id）。
        """
        if not self.api_config:
            return []
        category = getattr(tool, "category", "")
        if not hasattr(self.api_config, "list_models"):
            return []
        models = self.api_config.list_models(category)
        return [
            {"id": m.get("id"), "label": m.get("label", m.get("id"))}
            for m in models
        ]
```

- [ ] **Step 7: 运行测试，预期通过**

Run: `cd "c:\Users\25315\PycharmProjects\dramaforge-ai\backend"; uv run pytest tests/test_agent_runtime.py -v`
Expected: PASS (原 + 新 7 = 全部通过)

- [ ] **Step 8: 运行全量后端测试，确保无回归**

Run: `cd "c:\Users\25315\PycharmProjects\dramaforge-ai\backend"; uv run pytest -q`
Expected: PASS

- [ ] **Step 9: 提交**

```bash
cd "c:\Users\25315\PycharmProjects\dramaforge-ai"
git add backend/app/agent/runtime.py backend/tests/test_agent_runtime.py
git commit -m "feat(runtime): tool failure recovery — pause on RetryableError + resume with retry/change_model/skip"
```

---

### Task 4: Schema 扩展 + Router 改造

**Files:**
- Modify: `c:\Users\25315\PycharmProjects\dramaforge-ai\backend\app\schemas.py:149-159` (AgentUserResponse)
- Modify: `c:\Users\25315\PycharmProjects\dramaforge-ai\backend\app\routers\agent.py:170-184` (user_respond)
- Test: `c:\Users\25315\PycharmProjects\dramaforge-ai\backend\tests\test_agent_routes.py` (改，新增 case)

**Interfaces:**
- Consumes: 无
- Produces:
  - `schemas.AgentUserResponse.recovery_action: Optional[Literal["retry", "change_model", "skip"]] = None`
  - `schemas.AgentUserResponse.new_model_id: Optional[str] = None`
  - `routers/agent.py` `user_respond` 把 recovery 字段写入 `task.pending_response`

- [ ] **Step 1: 写失败测试**

在 `backend/tests/test_agent_routes.py` 末尾添加：

```python
class TestUserRespondRecovery:
    """Spec B: user_respond 支持 recovery_action / new_model_id。"""

    def test_respond_with_recovery_action_retry(self, client, db_session):
        """POST /respond 带 recovery_action=retry → pending_response 含 recovery_action。"""
        task = AgentTask(
            id="t-rec-1",
            project_id="p1",
            user_goal="x",
            status="paused",
            plan=[],
            artifacts={},
            total_cost_usd=0.0,
            total_tokens=0,
            max_steps=30,
            skip_confirm=False,
        )
        db_session.add(task)
        db_session.commit()

        resp = client.post(f"/api/agent/tasks/t-rec-1/respond", json={
            "response": "retry",
            "approved": True,
            "recovery_action": "retry",
        })
        assert resp.status_code == 200
        db_session.refresh(task)
        assert task.pending_response["recovery_action"] == "retry"

    def test_respond_with_recovery_action_change_model(self, client, db_session):
        """POST /respond 带 recovery_action=change_model + new_model_id。"""
        task = AgentTask(
            id="t-rec-2",
            project_id="p1",
            user_goal="x",
            status="paused",
            plan=[],
            artifacts={},
            total_cost_usd=0.0,
            total_tokens=0,
            max_steps=30,
            skip_confirm=False,
        )
        db_session.add(task)
        db_session.commit()

        resp = client.post(f"/api/agent/tasks/t-rec-2/respond", json={
            "response": "change_model",
            "approved": True,
            "recovery_action": "change_model",
            "new_model_id": "dall-e-2",
        })
        assert resp.status_code == 200
        db_session.refresh(task)
        assert task.pending_response["recovery_action"] == "change_model"
        assert task.pending_response["new_model_id"] == "dall-e-2"

    def test_respond_without_recovery_action_still_works(self, client, db_session):
        """不传 recovery_action 时原有逻辑不变（向后兼容）。"""
        task = AgentTask(
            id="t-rec-3",
            project_id="p1",
            user_goal="x",
            status="paused",
            plan=[],
            artifacts={},
            total_cost_usd=0.0,
            total_tokens=0,
            max_steps=30,
            skip_confirm=False,
        )
        db_session.add(task)
        db_session.commit()

        resp = client.post(f"/api/agent/tasks/t-rec-3/respond", json={
            "response": "ok",
            "approved": True,
        })
        assert resp.status_code == 200
        db_session.refresh(task)
        assert "recovery_action" not in task.pending_response
        assert task.pending_response["response"] == "ok"
```

需要在 test 文件顶部确保 import：

```python
from app.models import AgentTask
```

- [ ] **Step 2: 运行测试，预期失败**

Run: `cd "c:\Users\25315\PycharmProjects\dramaforge-ai\backend"; uv run pytest tests/test_agent_routes.py::TestUserRespondRecovery -v`
Expected: FAIL (response 不含 recovery_action 字段)

- [ ] **Step 3: 修改 schemas.py — AgentUserResponse 加 2 字段**

在 `backend/app/schemas.py` 的 `AgentUserResponse` 类中添加 2 个字段。首先在文件顶部 import `Literal`：

```python
from typing import Optional, Dict, Any, List, Literal
```

然后修改 `AgentUserResponse`：

```python
class AgentUserResponse(BaseModel):
    """用户对 ask_user / plan 审核的响应。

    response 允许任意可 JSON 序列化的值（字符串 / 字典 / 列表），
    由后端 runtime 决定如何解读。

    Spec B: 新增 recovery_action / new_model_id 支持工具失败恢复。
    """
    response: Optional[Any] = None
    approved: bool = True
    # Spec B: 失败恢复决策
    recovery_action: Optional[Literal["retry", "change_model", "skip"]] = None
    new_model_id: Optional[str] = None

    class Config:
        from_attributes = True
```

- [ ] **Step 4: 修改 routers/agent.py — user_respond 传递 recovery 字段**

替换 `backend/app/routers/agent.py` 的 `user_respond` 函数（170-184 行）：

```python
@router.post("/tasks/{task_id}/respond")
async def user_respond(task_id: str, body: schemas.AgentUserResponse, db: Session = Depends(get_db)):
    """接收用户对 ask_user / plan 审核 / 工具失败恢复的响应。

    Spec B: 支持 recovery_action / new_model_id 字段。
    """
    task = db.query(AgentTask).filter_by(id=task_id).first()
    if not task:
        raise HTTPException(404, f"Task {task_id} not found")
    task.pending_response = {"response": body.response, "approved": body.approved}
    if body.recovery_action:
        task.pending_response["recovery_action"] = body.recovery_action
    if body.new_model_id:
        task.pending_response["new_model_id"] = body.new_model_id
    if body.approved is False and task.status == "paused":
        task.status = "failed"  # 用户拒绝
    db.commit()
    # 推送 USER_INPUT_RECEIVED 事件
    await event_bus.publish(AgentEvent(
        task_id=task_id, type=EventType.USER_INPUT_RECEIVED,
        payload={
            "response": body.response,
            "approved": body.approved,
            "recovery_action": body.recovery_action,
            "new_model_id": body.new_model_id,
        },
    ))
    return {"ok": True}
```

- [ ] **Step 5: 运行测试，预期通过**

Run: `cd "c:\Users\25315\PycharmProjects\dramaforge-ai\backend"; uv run pytest tests/test_agent_routes.py -v`
Expected: PASS

- [ ] **Step 6: 运行全量后端测试，确保无回归**

Run: `cd "c:\Users\25315\PycharmProjects\dramaforge-ai\backend"; uv run pytest -q`
Expected: PASS

- [ ] **Step 7: 提交**

```bash
cd "c:\Users\25315\PycharmProjects\dramaforge-ai"
git add backend/app/schemas.py backend/app/routers/agent.py backend/tests/test_agent_routes.py
git commit -m "feat(api): extend AgentUserResponse with recovery_action + new_model_id fields"
```

---

### Task 5: useAgentStore 扩展 + ErrorRecoveryCard 组件

**Files:**
- Modify: `c:\Users\25315\PycharmProjects\dramaforge-ai\agent\use-agent-store.ts` (新增 pendingErrorRecovery + 4 case)
- Create: `c:\Users\25315\PycharmProjects\dramaforge-ai\agent\error-recovery-card.tsx` (新)
- Test: `c:\Users\25315\PycharmProjects\dramaforge-ai\tests\agent\use-agent-store.test.ts` (改)
- Test: `c:\Users\25315\PycharmProjects\dramaforge-ai\tests\agent\error-recovery-card.test.tsx` (新)

**Interfaces:**
- Consumes: 无
- Produces:
  - `useAgentStore.pendingErrorRecovery: PendingErrorRecovery | null`
  - `useAgentStore.clearErrorRecovery: () => void`
  - `useAgentStore.applyEvent` 新增 case: `tool_retrying` / `tool_fallback_model` / `tool_error` / `tool_resumed`
  - `<ErrorRecoveryCard />` 组件

- [ ] **Step 1: 写失败测试 — use-agent-store.test.ts**

在 `tests/agent/use-agent-store.test.ts` 末尾添加：

```typescript
  it('applyEvent tool_error sets pendingErrorRecovery and status=paused', () => {
    const s = useAgentStore.getState();
    s.setTask('t-1', 'running');
    s.applyEvent({
      type: 'tool_error',
      payload: {
        step_id: '3',
        tool: 'generate_image',
        error: 'network timeout',
        params: { model_id: 'dall-e-3' },
        fallback_model_id: 'dall-e-2',
        available_models: [{ id: 'dall-e-2', label: 'DALL-E 2' }],
      },
      timestamp: 1,
    });
    const after = useAgentStore.getState();
    expect(after.status).toBe('paused');
    expect(after.pendingErrorRecovery).toEqual({
      stepId: '3',
      tool: 'generate_image',
      error: 'network timeout',
      params: { model_id: 'dall-e-3' },
      fallbackModelId: 'dall-e-2',
      availableModels: [{ id: 'dall-e-2', label: 'DALL-E 2' }],
    });
  });

  it('applyEvent tool_resumed clears pendingErrorRecovery and sets status=running', () => {
    const s = useAgentStore.getState();
    s.setTask('t-1', 'running');
    // 先触发 tool_error
    s.applyEvent({
      type: 'tool_error',
      payload: { step_id: '1', tool: 'x', error: 'e', params: {}, fallback_model_id: null, available_models: [] },
      timestamp: 1,
    });
    expect(useAgentStore.getState().pendingErrorRecovery).not.toBeNull();
    // 再触发 tool_resumed
    s.applyEvent({ type: 'tool_resumed', payload: { step_id: '1', action: 'retry' }, timestamp: 2 });
    const after = useAgentStore.getState();
    expect(after.pendingErrorRecovery).toBeNull();
    expect(after.status).toBe('running');
  });

  it('applyEvent tool_retrying appends to thoughts', () => {
    const s = useAgentStore.getState();
    s.setTask('t-1', 'running');
    s.applyEvent({
      type: 'tool_retrying',
      payload: { tool: 'generate_image', attempt: 1, max_retries: 2, delay_sec: 1.0, error: 'timeout' },
      timestamp: 1,
    });
    expect(useAgentStore.getState().thoughts).toHaveLength(1);
    expect(useAgentStore.getState().thoughts[0].type).toBe('tool_retrying');
  });

  it('applyEvent tool_fallback_model appends to thoughts', () => {
    const s = useAgentStore.getState();
    s.setTask('t-1', 'running');
    s.applyEvent({
      type: 'tool_fallback_model',
      payload: { tool: 'generate_image', from_model: 'dall-e-3', to_model: 'dall-e-2' },
      timestamp: 1,
    });
    expect(useAgentStore.getState().thoughts).toHaveLength(1);
    expect(useAgentStore.getState().thoughts[0].type).toBe('tool_fallback_model');
  });

  it('clearErrorRecovery clears pendingErrorRecovery', () => {
    const s = useAgentStore.getState();
    s.setTask('t-1', 'running');
    s.applyEvent({
      type: 'tool_error',
      payload: { step_id: '1', tool: 'x', error: 'e', params: {}, fallback_model_id: null, available_models: [] },
      timestamp: 1,
    });
    expect(useAgentStore.getState().pendingErrorRecovery).not.toBeNull();
    useAgentStore.getState().clearErrorRecovery();
    expect(useAgentStore.getState().pendingErrorRecovery).toBeNull();
  });
```

- [ ] **Step 2: 写失败测试 — error-recovery-card.test.tsx**

创建 `tests/agent/error-recovery-card.test.tsx`：

```typescript
/**
 * TDD: ErrorRecoveryCard — 工具失败恢复模态卡。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ErrorRecoveryCard } from '@/agent/error-recovery-card';
import { useAgentStore } from '@/agent/use-agent-store';

vi.mock('@/services/apiClient', () => ({
  api: {
    respond: vi.fn().mockResolvedValue({ ok: true }),
  },
}));

describe('<ErrorRecoveryCard />', () => {
  beforeEach(() => {
    useAgentStore.getState().reset();
    useAgentStore.getState().setTask('t-1', 'running');
    vi.clearAllMocks();
  });

  it('renders nothing when pendingErrorRecovery is null', () => {
    const { container } = render(<ErrorRecoveryCard />);
    expect(container.firstChild).toBeNull();
  });

  it('renders modal card when pendingErrorRecovery is set', () => {
    useAgentStore.getState().applyEvent({
      type: 'tool_error',
      payload: {
        step_id: '3',
        tool: 'generate_image',
        error: 'network timeout',
        params: {},
        fallback_model_id: null,
        available_models: [],
      },
      timestamp: 1,
    });
    render(<ErrorRecoveryCard />);
    expect(screen.getByTestId('error-recovery-card')).toBeInTheDocument();
    expect(screen.getByTestId('erc-tool')).toHaveTextContent('generate_image');
    expect(screen.getByTestId('erc-error')).toHaveTextContent('network timeout');
  });

  it('defaults to retry action', () => {
    useAgentStore.getState().applyEvent({
      type: 'tool_error',
      payload: {
        step_id: '1', tool: 'x', error: 'e', params: {},
        fallback_model_id: null, available_models: [],
      },
      timestamp: 1,
    });
    render(<ErrorRecoveryCard />);
    const retryRadio = screen.getByDisplayValue('retry') as HTMLInputElement;
    expect(retryRadio.checked).toBe(true);
  });

  it('shows model select when change_model is selected', () => {
    useAgentStore.getState().applyEvent({
      type: 'tool_error',
      payload: {
        step_id: '1', tool: 'x', error: 'e', params: {},
        fallback_model_id: 'dall-e-2',
        available_models: [{ id: 'dall-e-2', label: 'DALL-E 2' }, { id: 'sdxl', label: 'SDXL' }],
      },
      timestamp: 1,
    });
    render(<ErrorRecoveryCard />);
    // 初始不显示 select
    expect(screen.queryByTestId('erc-model-select')).toBeNull();
    // 选 change_model
    fireEvent.click(screen.getByDisplayValue('change_model'));
    expect(screen.getByTestId('erc-model-select')).toBeInTheDocument();
  });

  it('calls api.respond with correct payload on confirm', async () => {
    const { api } = await import('@/services/apiClient');
    useAgentStore.getState().applyEvent({
      type: 'tool_error',
      payload: {
        step_id: '1', tool: 'x', error: 'e', params: {},
        fallback_model_id: 'dall-e-2',
        available_models: [{ id: 'dall-e-2', label: 'DALL-E 2' }],
      },
      timestamp: 1,
    });
    render(<ErrorRecoveryCard />);
    fireEvent.click(screen.getByDisplayValue('change_model'));
    fireEvent.click(screen.getByTestId('erc-confirm'));
    await waitFor(() => {
      expect(api.respond).toHaveBeenCalledWith('t-1', {
        response: 'change_model',
        recovery_action: 'change_model',
        new_model_id: 'dall-e-2',
      });
    });
  });

  it('skip action sends new_model_id=null', async () => {
    const { api } = await import('@/services/apiClient');
    useAgentStore.getState().applyEvent({
      type: 'tool_error',
      payload: {
        step_id: '1', tool: 'x', error: 'e', params: {},
        fallback_model_id: null, available_models: [],
      },
      timestamp: 1,
    });
    render(<ErrorRecoveryCard />);
    fireEvent.click(screen.getByDisplayValue('skip'));
    fireEvent.click(screen.getByTestId('erc-confirm'));
    await waitFor(() => {
      expect(api.respond).toHaveBeenCalledWith('t-1', {
        response: 'skip',
        recovery_action: 'skip',
        new_model_id: null,
      });
    });
  });
});
```

- [ ] **Step 3: 运行测试，预期失败**

Run: `cd "c:\Users\25315\PycharmProjects\dramaforge-ai"; npm test -- --run error-recovery-card use-agent-store`
Expected: FAIL

- [ ] **Step 4: 修改 use-agent-store.ts — 新增 PendingErrorRecovery + 4 case**

在 `agent/use-agent-store.ts` 中：

1. 在 `PendingQuestion` 接口后添加 `PendingErrorRecovery`：

```typescript
export interface PendingErrorRecovery {
  stepId: string;
  tool: string;
  error: string;
  params: Record<string, any>;
  fallbackModelId: string | null;
  availableModels: { id: string; label: string }[];
}
```

2. 在 `AgentState` 接口中 `pendingPlan` 后添加：

```typescript
  pendingErrorRecovery: PendingErrorRecovery | null;
```

3. 在 `AgentState` 接口的 actions 部分添加：

```typescript
  clearErrorRecovery: () => void;
```

4. 在 `INITIAL` 常量中 `pendingPlan: null,` 后添加：

```typescript
  pendingErrorRecovery: null,
```

5. 在 `applyEvent` 的 switch 中 `case 'user_input_received':` 后添加 4 个新 case：

```typescript
        case 'tool_retrying':
          return { thoughts: [...state.thoughts, event] };
        case 'tool_fallback_model':
          return { thoughts: [...state.thoughts, event] };
        case 'tool_error':
          return {
            pendingErrorRecovery: {
              stepId: p.step_id,
              tool: p.tool,
              error: p.error,
              params: p.params,
              fallbackModelId: p.fallback_model_id,
              availableModels: p.available_models || [],
            },
            status: 'paused',
          };
        case 'tool_resumed':
          return { pendingErrorRecovery: null, status: 'running' };
```

6. 在 `clearPendingQuestion` 后添加 `clearErrorRecovery`：

```typescript
  clearErrorRecovery: () => set({ pendingErrorRecovery: null }),
```

- [ ] **Step 5: 创建 error-recovery-card.tsx**

创建 `agent/error-recovery-card.tsx`：

```typescript
/**
 * ErrorRecoveryCard — 工具失败恢复模态卡（画布中央）。
 *
 * 当 agent 工具调用失败且自动重试耗尽后，后端推送 tool_error 事件，
 * useAgentStore.pendingErrorRecovery 填充后此卡显示。
 * 用户可选：重试 / 换模型 / 跳过。
 */
import React, { useEffect, useState } from 'react';
import { useAgentStore } from './use-agent-store';
import { api } from '@/services/apiClient';

export const ErrorRecoveryCard: React.FC = () => {
  const pending = useAgentStore((s) => s.pendingErrorRecovery);
  const taskId = useAgentStore((s) => s.taskId);
  const [action, setAction] = useState<'retry' | 'change_model' | 'skip'>('retry');
  const [modelId, setModelId] = useState<string>('');

  useEffect(() => {
    if (pending) {
      setAction('retry');
      setModelId(pending.fallbackModelId || (pending.availableModels[0]?.id ?? ''));
    }
  }, [pending]);

  if (!pending) return null;

  const onConfirm = async () => {
    await api.respond(taskId, {
      response: action,
      recovery_action: action,
      new_model_id: action === 'change_model' ? modelId : null,
    });
  };

  const overlayStyle: React.CSSProperties = {
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
    background: 'rgba(0,0,0,0.3)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 40,
  };

  const cardStyle: React.CSSProperties = {
    background: 'white',
    borderRadius: 12,
    padding: 24,
    minWidth: 360,
    maxWidth: 480,
    boxShadow: '0 8px 32px rgba(0,0,0,0.16)',
    fontFamily: 'ui-sans-serif, system-ui, sans-serif',
    fontSize: 13,
  };

  return (
    <div data-testid="error-recovery-card" style={overlayStyle}>
      <div style={cardStyle}>
        <h3 style={{ margin: '0 0 12px 0', color: '#dc2626' }}>⚠ 工具执行失败</h3>
        <div data-testid="erc-tool" style={{ marginBottom: 6 }}>
          工具: <code style={{ background: '#f1f5f9', padding: '2px 6px', borderRadius: 4 }}>{pending.tool}</code>
        </div>
        <div data-testid="erc-error" style={{ marginBottom: 16, color: '#64748b' }}>
          错误: {pending.error}
        </div>

        <div role="radiogroup" style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
          <label style={{ cursor: 'pointer' }}>
            <input
              type="radio"
              name="erc-action"
              value="retry"
              checked={action === 'retry'}
              onChange={() => setAction('retry')}
              style={{ marginRight: 8 }}
            />
            重试（用相同参数重新执行）
          </label>
          <label style={{ cursor: 'pointer' }}>
            <input
              type="radio"
              name="erc-action"
              value="change_model"
              checked={action === 'change_model'}
              onChange={() => setAction('change_model')}
              style={{ marginRight: 8 }}
            />
            换模型
          </label>
          <label style={{ cursor: 'pointer' }}>
            <input
              type="radio"
              name="erc-action"
              value="skip"
              checked={action === 'skip'}
              onChange={() => setAction('skip')}
              style={{ marginRight: 8 }}
            />
            跳过（让 agent 决定如何继续）
          </label>
        </div>

        {action === 'change_model' && (
          <select
            data-testid="erc-model-select"
            value={modelId}
            onChange={(e) => setModelId(e.target.value)}
            style={{
              width: '100%',
              padding: 8,
              borderRadius: 6,
              border: '1px solid #cbd5e1',
              marginBottom: 16,
              fontSize: 13,
            }}
          >
            {pending.availableModels.length === 0 && (
              <option value="">（无可用模型，请手动输入）</option>
            )}
            {pending.availableModels.map((m) => (
              <option key={m.id} value={m.id}>{m.label}</option>
            ))}
          </select>
        )}

        <button
          data-testid="erc-confirm"
          type="button"
          onClick={onConfirm}
          style={{
            width: '100%',
            padding: '10px 16px',
            borderRadius: 6,
            border: 0,
            background: '#6366f1',
            color: 'white',
            cursor: 'pointer',
            fontSize: 14,
            fontWeight: 600,
          }}
        >
          确认
        </button>
      </div>
    </div>
  );
};
```

- [ ] **Step 6: 运行测试，预期通过**

Run: `cd "c:\Users\25315\PycharmProjects\dramaforge-ai"; npm test -- --run error-recovery-card use-agent-store`
Expected: PASS

- [ ] **Step 7: 运行全量前端测试，确保无回归**

Run: `cd "c:\Users\25315\PycharmProjects\dramaforge-ai"; npm test -- --run`
Expected: PASS (原 100 + 新 11 = 111 tests)

- [ ] **Step 8: 提交**

```bash
cd "c:\Users\25315\PycharmProjects\dramaforge-ai"
git add agent/use-agent-store.ts agent/error-recovery-card.tsx tests/agent/use-agent-store.test.ts tests/agent/error-recovery-card.test.tsx
git commit -m "feat(frontend): add ErrorRecoveryCard + pendingErrorRecovery store state"
```

---

### Task 6: AgentMode 集成 + ThoughtStream 增强

**Files:**
- Modify: `c:\Users\25315\PycharmProjects\dramaforge-ai\agent\agent-mode.tsx` (挂载 ErrorRecoveryCard)
- Modify: `c:\Users\25315\PycharmProjects\dramaforge-ai\agent\thought-stream.tsx` (fmtPayload 增强)
- Test: `c:\Users\25315\PycharmProjects\dramaforge-ai\tests\agent\thought-stream.test.tsx` (改)
- Test: `c:\Users\25315\PycharmProjects\dramaforge-ai\tests\agent\agent-mode-canvas.test.tsx` (改)

**Interfaces:**
- Consumes: `ErrorRecoveryCard` (Task 5) + `useAgentStore.pendingErrorRecovery` (Task 5)
- Produces: AgentMode 画布容器内挂载 ErrorRecoveryCard + ThoughtStream 显示重试/切换气泡

- [ ] **Step 1: 写失败测试 — thought-stream.test.tsx**

在 `tests/agent/thought-stream.test.tsx` 末尾添加：

```typescript
  it('renders tool_retrying event with retry icon and attempt count', () => {
    useAgentStore.getState().applyEvent({
      type: 'tool_retrying',
      payload: { tool: 'generate_image', attempt: 1, max_retries: 2, delay_sec: 1.0, error: 'timeout' },
      timestamp: 1,
    });
    render(<ThoughtStream />);
    expect(screen.getByText(/重试中.*1.*2/)).toBeInTheDocument();
  });

  it('renders tool_fallback_model event with switch icon and model name', () => {
    useAgentStore.getState().applyEvent({
      type: 'tool_fallback_model',
      payload: { tool: 'generate_image', from_model: 'dall-e-3', to_model: 'dall-e-2' },
      timestamp: 1,
    });
    render(<ThoughtStream />);
    expect(screen.getByText(/已切换到备选模型.*dall-e-2/)).toBeInTheDocument();
  });
```

- [ ] **Step 2: 写失败测试 — agent-mode-canvas.test.tsx**

在 `tests/agent/agent-mode-canvas.test.tsx` 末尾添加：

```typescript
  it('renders ErrorRecoveryCard when pendingErrorRecovery is set', async () => {
    const { useAgentStore } = await import('@/agent/use-agent-store');
    render(<AgentMode projectId="p1" />);
    // 初始不显示
    expect(screen.queryByTestId('error-recovery-card')).toBeNull();
    // 触发 tool_error
    useAgentStore.getState().applyEvent({
      type: 'tool_error',
      payload: {
        step_id: '1', tool: 'x', error: 'e', params: {},
        fallback_model_id: null, available_models: [],
      },
      timestamp: 1,
    });
    await waitFor(() => {
      expect(screen.getByTestId('error-recovery-card')).toBeInTheDocument();
    });
  });
```

- [ ] **Step 3: 运行测试，预期失败**

Run: `cd "c:\Users\25315\PycharmProjects\dramaforge-ai"; npm test -- --run thought-stream agent-mode-canvas`
Expected: FAIL

- [ ] **Step 4: 修改 thought-stream.tsx — fmtPayload 增强**

在 `agent/thought-stream.tsx` 的 `fmtPayload` 函数开头添加 2 个 case：

```typescript
function fmtPayload(ev: AgentEventLike): string {
  const p = ev.payload || {};
  // Spec B: 工具失败恢复事件格式化
  if (ev.type === 'tool_retrying') return `🔄 重试中 (第 ${p.attempt}/${p.max_retries} 次): ${p.error}`;
  if (ev.type === 'tool_fallback_model') return `↩ 已切换到备选模型: ${p.to_model}`;
  // 现有逻辑
  if (typeof p.text === 'string') return p.text;
  if (typeof p.tool === 'string') {
    const params = p.params ? JSON.stringify(p.params) : '';
    return `${p.tool}${params ? ' ' + params : ''}`;
  }
  if (p.result !== undefined) {
    const r = p.result;
    if (r && typeof r === 'object' && 'ok' in r) {
      return r.ok ? 'ok' : `error: ${(r as any).error || 'unknown'}`;
    }
    return JSON.stringify(r).slice(0, 200);
  }
  return JSON.stringify(p).slice(0, 200);
}
```

- [ ] **Step 5: 修改 agent-mode.tsx — 挂载 ErrorRecoveryCard**

在 `agent/agent-mode.tsx` 中：

1. 在顶部 import 区添加：

```typescript
import { ErrorRecoveryCard } from './error-recovery-card';
```

2. 在画布容器 div 内 `<InfiniteCanvas />` 之后添加 `<ErrorRecoveryCard />`：

找到：
```tsx
                <div data-testid="agent-mode-canvas-container" style={{ position: 'absolute', inset: 0 }}>
                  <InfiniteCanvas projectId={projectId} />
                </div>
```

替换为：
```tsx
                <div data-testid="agent-mode-canvas-container" style={{ position: 'absolute', inset: 0 }}>
                  <InfiniteCanvas projectId={projectId} />
                  <ErrorRecoveryCard />
                </div>
```

- [ ] **Step 6: 运行测试，预期通过**

Run: `cd "c:\Users\25315\PycharmProjects\dramaforge-ai"; npm test -- --run thought-stream agent-mode-canvas`
Expected: PASS

- [ ] **Step 7: 运行全量前端测试，确保无回归**

Run: `cd "c:\Users\25315\PycharmProjects\dramaforge-ai"; npm test -- --run`
Expected: PASS

- [ ] **Step 8: 提交**

```bash
cd "c:\Users\25315\PycharmProjects\dramaforge-ai"
git add agent/agent-mode.tsx agent/thought-stream.tsx tests/agent/thought-stream.test.tsx tests/agent/agent-mode-canvas.test.tsx
git commit -m "feat(frontend): mount ErrorRecoveryCard in AgentMode + ThoughtStream retry/fallback display"
```

---

## Self-Review

### 1. Spec coverage

| Spec 章节 | 覆盖任务 |
|---|---|
| §3.1 RetryableTool 包装器 | Task 1 |
| §3.2 BaseTool 扩展字段 | Task 1 |
| §3.3 新增 EventType | Task 2 |
| §3.4 Runtime _execute_tool 改造 | Task 3 |
| §3.5 resume() 扩展 | Task 3 |
| §3.6 Schema 扩展 | Task 4 |
| §3.7 Router 改造 | Task 4 |
| §4.1 useAgentStore 扩展 | Task 5 |
| §4.2 ErrorRecoveryCard 组件 | Task 5 |
| §4.3 AgentMode 集成 | Task 6 |
| §4.4 ThoughtStream 增强 | Task 6 |

### 2. Placeholder scan

无 placeholder。所有步骤含完整代码。

### 3. Type consistency

- `PendingErrorRecovery` 接口在 Task 5 定义，在 Task 6 使用 — 一致
- `recovery_action: Literal["retry", "change_model", "skip"]` 在 Task 4 (后端) 和 Task 5 (前端) 一致
- `EventType.TOOL_ERROR` / `TOOL_RESUMED` 在 Task 2 定义，Task 3 使用 — 一致
- `RetryableTool` 在 Task 1 定义，Task 3 使用 — 一致
