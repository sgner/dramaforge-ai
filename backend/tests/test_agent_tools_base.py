"""Tool 基类 + Registry 单元测试。

TDD 规则：先写测试看红，再写实现看绿。
"""
import pytest
import asyncio
from typing import Any

from app.agent.tools.base import (
    Tool,
    BaseTool,
    ToolContext,
    ToolParameter,
    ToolRegistry,
    ToolValidationError,
    RetryableError,
    NonRetryableError,
)


# ========================
# Tool 基类测试
# ========================

class _EchoTool(Tool):
    """用于测试的 echo 工具。"""
    name = "echo"
    description = "Echo back the input"
    category = "test"
    requires_approval = False
    estimated_cost_usd = 0.0
    estimated_time_sec = 0.0
    idempotent = True

    parameters = [
        ToolParameter(
            name="text",
            type="string",
            description="Text to echo",
            required=True,
        ),
    ]

    async def validate(self, ctx, params):
        if "text" not in params:
            return "Missing required parameter: text"
        return None

    async def execute(self, ctx, params):
        return {"echo": params["text"]}


class _FailTool(Tool):
    name = "fail"
    description = "Always fails"
    category = "test"
    requires_approval = False
    parameters = [ToolParameter(name="x", type="number", description="ignored", required=False)]

    async def validate(self, ctx, params):
        return None

    async def execute(self, ctx, params):
        raise RetryableError("network timeout")


def test_tool_default_validate_passes():
    """Tool 默认 validate 应通过。"""
    class _NoValidate(Tool):
        name = "no_validate"
        description = "x"
        category = "test"
        parameters = []
        async def execute(self, ctx, params):
            return {}
    t = _NoValidate()
    err = asyncio.run(t.validate(None, {}))
    assert err is None


def test_tool_execute_returns_dict():
    """Tool.execute 返回 dict。"""
    t = _EchoTool()
    result = asyncio.run(t.execute(None, {"text": "hello"}))
    assert result == {"echo": "hello"}


def test_tool_validate_returns_error_for_missing_param():
    """缺参数时 validate 返回错误信息。"""
    t = _EchoTool()
    err = asyncio.run(t.validate(None, {}))
    assert err is not None
    assert "text" in err


def test_tool_validate_returns_none_when_valid():
    """参数完整时 validate 返回 None。"""
    t = _EchoTool()
    err = asyncio.run(t.validate(None, {"text": "hi"}))
    assert err is None


def test_tool_call_validates_then_executes():
    """call() 应先 validate 再 execute，错误参数不执行。"""
    called = []

    class _T(BaseTool):
        name = "spy"
        description = "spy"
        category = "test"
        parameters = [ToolParameter(name="a", type="string", description="x", required=True)]
        async def validate(self, ctx, params):
            called.append(("validate", params))
            return "bad"
        async def execute(self, ctx, params):
            called.append(("execute", params))
            return {}

    t = _T()
    with pytest.raises(ToolValidationError):
        asyncio.run(t.call(None, {}))
    # validate 被调用了，execute 没被调用
    assert len(called) == 1
    assert called[0][0] == "validate"


# ========================
# ToolRegistry 测试
# ========================

def test_registry_register_and_get():
    """注册工具后能取出。"""
    reg = ToolRegistry()
    t = _EchoTool()
    reg.register(t)
    assert reg.get("echo") is t


def test_registry_get_returns_none_for_missing():
    """不存在的工具返回 None。"""
    reg = ToolRegistry()
    assert reg.get("nope") is None


def test_registry_list_all():
    """列出所有工具。"""
    reg = ToolRegistry()
    reg.register(_EchoTool())
    reg.register(_FailTool())
    assert len(reg.list()) == 2


def test_registry_list_by_category():
    """按类别过滤工具。"""
    reg = ToolRegistry()
    reg.register(_EchoTool())  # category=test
    assert len(reg.list(category="test")) == 1
    assert len(reg.list(category="image")) == 0


def test_registry_to_openai_schema():
    """转换为 OpenAI function calling schema。"""
    reg = ToolRegistry()
    reg.register(_EchoTool())
    schema = reg.to_openai_schema()
    assert len(schema) == 1
    s = schema[0]
    assert s["type"] == "function"
    assert s["function"]["name"] == "echo"
    assert "text" in s["function"]["parameters"]["properties"]
    assert "text" in s["function"]["parameters"]["required"]


def test_registry_unregister():
    """取消注册后工具消失。"""
    reg = ToolRegistry()
    reg.register(_EchoTool())
    reg.unregister("echo")
    assert reg.get("echo") is None
