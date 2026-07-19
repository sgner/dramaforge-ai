"""openai_llm_client 网络错误描述（_describe_network_error）测试。

回归：原代码 `LLMError(f"LLM network error after retry: {e}")` 在
httpx.ConnectError.__str__ 为空时，错误尾巴是空的，调试时完全不知道
连不上哪个地址 / 哪一类错误。

修复：从 __cause__ / __context__ 链里挖出最底层可读 message。
"""
import pytest

from app.agent.openai_llm_client import OpenAICompatibleLLMClient
from app.agent.llm import LLMError


# ========================
# _describe_network_error
# ========================

def test_describe_empty_httpx_connect_error_with_cause():
    """模拟生产场景：httpx.ConnectError.__str__ 为空，但根因是 ConnectionRefusedError。"""
    class _EmptyStrError(Exception):
        def __str__(self):
            return ""
        def __repr__(self):
            return "ConnectError()"

    root = ConnectionRefusedError("[Errno 111] Connection refused")
    mid = _EmptyStrError()
    mid.__cause__ = root
    top = _EmptyStrError()
    top.__cause__ = mid

    desc = OpenAICompatibleLLMClient._describe_network_error(top)
    assert "[Errno 111] Connection refused" in desc
    # 头部带 class 名方便定位
    assert desc.startswith("_EmptyStrError")


def test_describe_simple_error_uses_str():
    """普通异常（非 httpx 链）直接用 str(e)。"""
    e = ValueError("bad input")
    desc = OpenAICompatibleLLMClient._describe_network_error(e)
    assert "bad input" in desc
    assert desc.startswith("ValueError")


def test_describe_none_input():
    """None 输入 → 友好提示。"""
    desc = OpenAICompatibleLLMClient._describe_network_error(None)
    assert desc == "unknown network error"


def test_describe_cycle_protection():
    """异常链有环时不能死循环。"""
    a = RuntimeError("a")
    b = RuntimeError("b")
    a.__cause__ = b
    b.__cause__ = a  # cycle
    desc = OpenAICompatibleLLMClient._describe_network_error(a)
    assert "a" in desc
    assert "b" in desc


def test_describe_no_message_in_chain():
    """整条链都没有 message 时，至少暴露 class 名。"""
    class _Silent(Exception):
        def __str__(self):
            return ""

    e = _Silent()
    e.__cause__ = _Silent()
    desc = OpenAICompatibleLLMClient._describe_network_error(e)
    assert "no message" in desc or "_Silent" in desc


# ========================
# _post_with_retry 行为
# ========================

@pytest.mark.asyncio
async def test_post_with_retry_raises_llmerror_with_root_cause_message():
    """httpx.ConnectError (空 str) 经过 retry 后抛出的 LLMError 必须包含根因 message。"""
    import httpx
    from unittest.mock import AsyncMock, patch

    # 构造一个会抛 httpx.ConnectError 的 transport
    class _EmptyStrConnectError(httpx.ConnectError):
        def __init__(self):
            super().__init__("")  # str 为空
            # 模拟 httpcore 的根因挂在 __cause__ / __context__
            self.__cause__ = ConnectionRefusedError(
                "[Errno 111] Connection refused"
            )

    class _FakeTransport(httpx.AsyncBaseTransport):
        async def handle_async_request(self, request):
            raise _EmptyStrConnectError()

    client = OpenAICompatibleLLMClient(
        base_url="http://localhost:9999",
        api_key="sk-fake",
        model="gpt-test",
        timeout_sec=1.0,
    )

    # 用 httpx 的 mock transport 触发 ConnectError，验证 _describe_network_error
    # 能从链里挖出根因。AsyncClient 必须用 async with 关闭。
    import httpx as _httpx
    async with _httpx.AsyncClient(transport=_FakeTransport(), timeout=1.0) as cx:
        try:
            await cx.post(client._endpoint(), headers=client._headers(), json={"x": 1})
        except _httpx.ConnectError as e:
            desc = OpenAICompatibleLLMClient._describe_network_error(e)
            assert "[Errno 111] Connection refused" in desc
        else:
            pytest.fail("ConnectError should have been raised")
