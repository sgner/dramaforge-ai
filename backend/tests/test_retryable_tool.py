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
        # _FallbackFailTool 总是抛 RetryableError（即使传入 fallback_model_id），
        # 用于验证 RetryableTool 不会重复切换到同一个 fallback 模型。
        tool = _FallbackFailTool()
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


class _GenerateFailTool(BaseTool):
    """模拟媒体生成工具：前两次失败，第三次成功。"""

    name = "generate_video"
    description = "fails twice then succeeds"
    category = "video"
    parameters = []

    def __init__(self):
        super().__init__()
        self.call_count = 0

    async def execute(self, ctx, params):
        self.call_count += 1
        if self.call_count < 3:
            raise RetryableError(f"provider 502 (attempt {self.call_count})")
        return {"ok": True}


class TestMediaRecoveryProgress:
    """媒体工具重试/降级时发射 media_recovery_progress（Task 4.3 可见性）。"""

    @pytest.mark.asyncio
    async def test_generate_tool_retry_emits_progress(self):
        tool = _GenerateFailTool()
        wrapped = RetryableTool(tool, max_retries=2)
        ctx = _make_ctx()
        with patch("app.agent.tools.base.asyncio.sleep", new=AsyncMock()):
            result = await wrapped.call(ctx, {})
        assert result["ok"] is True
        progress = [c for c in ctx.emit_event.call_args_list if c.args[0] == "media_recovery_progress"]
        assert len(progress) == 2
        first = progress[0].args[1]
        assert first["status"] == "retrying"
        assert first["attempt"] == 1
        assert first["max_attempts"] == 2
        assert first["tool"] == "generate_video"
        assert progress[1].args[1]["attempt"] == 2

    @pytest.mark.asyncio
    async def test_non_generate_tool_does_not_emit_progress(self):
        """非媒体工具重试只发 tool_retrying，不发 media_recovery_progress。"""
        tool = _FailTwiceTool()
        wrapped = RetryableTool(tool, max_retries=2)
        ctx = _make_ctx()
        with patch("app.agent.tools.base.asyncio.sleep", new=AsyncMock()):
            await wrapped.call(ctx, {})
        progress = [c for c in ctx.emit_event.call_args_list if c.args[0] == "media_recovery_progress"]
        assert progress == []
