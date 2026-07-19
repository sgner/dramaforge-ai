"""OpenAICompatibleLLMClient 指数退避重试测试。

覆盖：
1. _compute_backoff 公式正确（backoff_base * 2^attempt + jitter）
2. 多次 5xx 重试到 max_retries 上限后失败
3. 重试期间 sleep 次数 / 顺序与 backoff 公式一致
4. 429 重试
5. 4xx (非 429) 不重试
6. network error 重试到上限后抛 LLMError，message 含尝试次数
7. max_retries=0 表示不重试
8. _compute_backoff 有上限（max_backoff_sec 不会无限增长）
"""
import asyncio
import time
from unittest.mock import AsyncMock, patch

import pytest
import respx
from httpx import Response

from app.agent.llm import LLMError
from app.agent.openai_llm_client import OpenAICompatibleLLMClient


# ========================
# _compute_backoff 公式
# ========================

def test_compute_backoff_exponential_growth():
    """backoff_base=1.0, no jitter 路径：delay 必须 = 1.0 * 2^attempt。"""
    c = OpenAICompatibleLLMClient(
        base_url="https://api.openai.com", api_key="sk-x", model="m",
        max_retries=5, backoff_base=1.0, max_backoff_sec=60.0,
    )
    # 关掉 jitter 让断言可预测
    with patch("app.agent.openai_llm_client.random.uniform", return_value=0.0):
        assert c._compute_backoff(0) == 1.0
        assert c._compute_backoff(1) == 2.0
        assert c._compute_backoff(2) == 4.0
        assert c._compute_backoff(3) == 8.0
        assert c._compute_backoff(4) == 16.0


def test_compute_backoff_includes_jitter_within_base():
    """jitter 必须在 [0, backoff_base) 区间。"""
    c = OpenAICompatibleLLMClient(
        base_url="https://api.openai.com", api_key="sk-x", model="m",
        max_retries=3, backoff_base=1.0, max_backoff_sec=60.0,
    )
    # 把 random.uniform 写成 (0, base) 半开区间内
    with patch("app.agent.openai_llm_client.random.uniform", return_value=0.5):
        # attempt=0: 1.0 * 1.0 + 0.5 = 1.5
        assert c._compute_backoff(0) == pytest.approx(1.5)
    with patch("app.agent.openai_llm_client.random.uniform", return_value=0.99):
        # attempt=2: 1.0 * 4.0 + 0.99 = 4.99
        assert c._compute_backoff(2) == pytest.approx(4.99)


def test_compute_backoff_capped_by_max_backoff_sec():
    """长尾的 backoff 必须被 max_backoff_sec 截断。"""
    c = OpenAICompatibleLLMClient(
        base_url="https://api.openai.com", api_key="sk-x", model="m",
        max_retries=10, backoff_base=1.0, max_backoff_sec=8.0,
    )
    with patch("app.agent.openai_llm_client.random.uniform", return_value=1.0):
        # attempt=10 时 1.0 * 2^10 + 1 = 1025 → 截到 8.0
        assert c._compute_backoff(10) == 8.0


def test_compute_backoff_zero_base_no_jitter():
    """backoff_base=0：exp=0, jitter=0 → delay=0。"""
    c = OpenAICompatibleLLMClient(
        base_url="https://api.openai.com", api_key="sk-x", model="m",
        max_retries=3, backoff_base=0.0, max_backoff_sec=10.0,
    )
    # 任何 uniform 调用都不应被使用（短路），即使 random 抛错也安全
    with patch("app.agent.openai_llm_client.random.uniform", side_effect=AssertionError("should not call")):
        assert c._compute_backoff(0) == 0.0
        assert c._compute_backoff(5) == 0.0


# ========================
# _post_with_retry 行为
# ========================

def _ok_response(content: str = "hi") -> Response:
    return Response(200, json={
        "choices": [{"message": {"role": "assistant", "content": content, "tool_calls": None}}],
        "usage": {"prompt_tokens": 1, "completion_tokens": 1, "total_tokens": 2},
    })


def test_retry_exhausted_raises_llmerror():
    """5xx 一直返回 → 调用 (max_retries+1) 次后抛 LLMError。"""
    c = OpenAICompatibleLLMClient(
        base_url="https://api.openai.com", api_key="sk-x", model="m",
        max_retries=2, backoff_base=0.0, max_backoff_sec=0.0,
    )
    with respx.mock(base_url="https://api.openai.com") as mock:
        route = mock.post("/v1/chat/completions").mock(return_value=Response(500, text="server down"))
        with pytest.raises(LLMError, match="500"):
            asyncio.run(c.generate([{"role": "user", "content": "x"}]))
        # 首次 + 2 次重试 = 3 次
        assert route.call_count == 3


def test_retry_eventually_succeeds_within_max_retries():
    """5xx 重试 2 次后第 3 次成功。"""
    c = OpenAICompatibleLLMClient(
        base_url="https://api.openai.com", api_key="sk-x", model="m",
        max_retries=3, backoff_base=0.0, max_backoff_sec=0.0,
    )
    with respx.mock(base_url="https://api.openai.com") as mock:
        route = mock.post("/v1/chat/completions").mock(side_effect=[
            Response(503, text="busy"),
            Response(502, text="bad gateway"),
            _ok_response("recovered"),
        ])
        r = asyncio.run(c.generate([{"role": "user", "content": "x"}]))
        assert r.content == "recovered"
        assert route.call_count == 3


def test_retry_429_treated_as_retryable():
    """429 rate limit 必须重试。"""
    c = OpenAICompatibleLLMClient(
        base_url="https://api.openai.com", api_key="sk-x", model="m",
        max_retries=1, backoff_base=0.0, max_backoff_sec=0.0,
    )
    with respx.mock(base_url="https://api.openai.com") as mock:
        route = mock.post("/v1/chat/completions").mock(side_effect=[
            Response(429, text="rate limit"),
            _ok_response("ok"),
        ])
        r = asyncio.run(c.generate([{"role": "user", "content": "x"}]))
        assert r.content == "ok"
        assert route.call_count == 2


def test_retry_sleep_calls_exponential_delays():
    """重试期间的 sleep delay 必须按 backoff 公式递增。"""
    c = OpenAICompatibleLLMClient(
        base_url="https://api.openai.com", api_key="sk-x", model="m",
        max_retries=2, backoff_base=1.0, max_backoff_sec=10.0,
    )
    with respx.mock(base_url="https://api.openai.com") as mock:
        mock.post("/v1/chat/completions").mock(return_value=Response(500, text="oops"))
        with patch("app.agent.openai_llm_client.asyncio.sleep", new=AsyncMock()) as mock_sleep:
            with patch("app.agent.openai_llm_client.random.uniform", return_value=0.0):
                with pytest.raises(LLMError):
                    asyncio.run(c.generate([{"role": "user", "content": "x"}]))
    # max_retries=2 → 2 次 sleep：attempt=0 触发 1.0, attempt=1 触发 2.0
    assert mock_sleep.call_count == 2
    assert mock_sleep.call_args_list[0].args[0] == pytest.approx(1.0)
    assert mock_sleep.call_args_list[1].args[0] == pytest.approx(2.0)


def test_max_retries_zero_no_retry():
    """max_retries=0 → 失败立即抛，不 sleep。"""
    c = OpenAICompatibleLLMClient(
        base_url="https://api.openai.com", api_key="sk-x", model="m",
        max_retries=0, backoff_base=1.0, max_backoff_sec=10.0,
    )
    with respx.mock(base_url="https://api.openai.com") as mock:
        route = mock.post("/v1/chat/completions").mock(return_value=Response(500, text="oops"))
        with patch("app.agent.openai_llm_client.asyncio.sleep", new=AsyncMock()) as mock_sleep:
            with pytest.raises(LLMError, match="500"):
                asyncio.run(c.generate([{"role": "user", "content": "x"}]))
    assert route.call_count == 1
    assert mock_sleep.call_count == 0


def test_4xx_except_429_not_retried():
    """400/401/403/404/422 等不重试。"""
    for status in (400, 401, 403, 404, 422):
        c = OpenAICompatibleLLMClient(
            base_url="https://api.openai.com", api_key="sk-x", model="m",
            max_retries=3, backoff_base=0.0, max_backoff_sec=0.0,
        )
        with respx.mock(base_url="https://api.openai.com") as mock:
            route = mock.post("/v1/chat/completions").mock(return_value=Response(status, text="bad"))
            with patch("app.agent.openai_llm_client.asyncio.sleep", new=AsyncMock()) as mock_sleep:
                with pytest.raises(LLMError, match=str(status)):
                    asyncio.run(c.generate([{"role": "user", "content": "x"}]))
            assert route.call_count == 1, f"status {status} should not retry"
            assert mock_sleep.call_count == 0, f"status {status} should not sleep"


def test_network_error_retries_with_exponential_backoff():
    """httpx.NetworkError 必须重试；max_retries 耗尽后抛 LLMError，message 含 attempts 计数。"""
    import httpx

    class _EmptyStrConnectError(httpx.ConnectError):
        def __init__(self):
            super().__init__("")
            self.__cause__ = ConnectionRefusedError("[Errno 111] Connection refused")

    c = OpenAICompatibleLLMClient(
        base_url="http://localhost:9999", api_key="sk-fake", model="m",
        timeout_sec=1.0, max_retries=2, backoff_base=0.0, max_backoff_sec=0.0,
    )

    # 直接 mock httpx.AsyncClient.post，让其抛 ConnectError。
    # 这样能精确触发 _post_with_retry 的 except (TimeoutException, NetworkError) 分支，
    # 不依赖 respx 的 transport 注入。
    call_count = 0

    async def _raising_post(self, url, **kwargs):
        nonlocal call_count
        call_count += 1
        raise _EmptyStrConnectError()

    with patch("app.agent.openai_llm_client.asyncio.sleep", new=AsyncMock()):
        with patch("httpx.AsyncClient.post", new=_raising_post):
            with pytest.raises(LLMError) as excinfo:
                asyncio.run(c.generate([{"role": "user", "content": "x"}]))

    # 首次 + 2 次重试 = 3 次
    assert call_count == 3
    # 错误信息必须包含 attempts 计数 + 根因 message
    msg = str(excinfo.value)
    assert "3 attempts" in msg, f"expected '3 attempts' in error, got: {msg}"
    assert "[Errno 111] Connection refused" in msg, f"expected root cause in error, got: {msg}"


def test_init_validates_negative_max_retries():
    """max_retries 负数必须抛 ValueError。"""
    with pytest.raises(ValueError, match="max_retries"):
        OpenAICompatibleLLMClient(
            base_url="https://api.openai.com", api_key="sk-x", model="m",
            max_retries=-1,
        )


def test_remote_protocol_error_is_retried():
    """回归：httpx.RemoteProtocolError（"Server disconnected without sending a response"）
    必须像 NetworkError 一样被重试。修复前它不在 except 列表里，整个 agent 任务
    会立即 TASK_FAILED 而不是走 backoff 重试。

    模拟生产场景：上游网关 keepalive 过期 → httpcore 抛 RemoteProtocolError
    （ProtocolError 子类，不是 NetworkError 子类）。
    """
    import httpx

    class _ServerDisconnectError(httpx.RemoteProtocolError):
        def __init__(self):
            super().__init__("Server disconnected without sending a response.")

    c = OpenAICompatibleLLMClient(
        base_url="http://localhost:9999", api_key="sk-fake", model="m",
        timeout_sec=1.0, max_retries=2, backoff_base=0.0, max_backoff_sec=0.0,
    )

    call_count = 0

    async def _raising_post(self, url, **kwargs):
        nonlocal call_count
        call_count += 1
        # 第一次断开后第二次成功
        if call_count == 1:
            raise _ServerDisconnectError()
        from httpx import Response
        return Response(200, json={
            "choices": [{"message": {"role": "assistant", "content": "ok", "tool_calls": None}}],
            "usage": {"prompt_tokens": 1, "completion_tokens": 1, "total_tokens": 2},
        })

    with patch("app.agent.openai_llm_client.asyncio.sleep", new=AsyncMock()):
        with patch("httpx.AsyncClient.post", new=_raising_post):
            r = asyncio.run(c.generate([{"role": "user", "content": "x"}]))

    # 必须调用 2 次：第一次断开（重试），第二次成功
    assert call_count == 2
    assert r.content == "ok"


def test_remote_protocol_error_exhausted_raises_llmerror():
    """RemoteProtocolError 持续触发 → 重试 max_retries 次后抛 LLMError，message 含尝试次数 + 根因。"""
    import httpx

    class _ServerDisconnectError(httpx.RemoteProtocolError):
        def __init__(self):
            super().__init__("Server disconnected without sending a response.")

    c = OpenAICompatibleLLMClient(
        base_url="http://localhost:9999", api_key="sk-fake", model="m",
        timeout_sec=1.0, max_retries=2, backoff_base=0.0, max_backoff_sec=0.0,
    )

    call_count = 0

    async def _raising_post(self, url, **kwargs):
        nonlocal call_count
        call_count += 1
        raise _ServerDisconnectError()

    with patch("app.agent.openai_llm_client.asyncio.sleep", new=AsyncMock()):
        with patch("httpx.AsyncClient.post", new=_raising_post):
            with pytest.raises(LLMError) as excinfo:
                asyncio.run(c.generate([{"role": "user", "content": "x"}]))

    # 首次 + 2 次重试 = 3 次
    assert call_count == 3
    msg = str(excinfo.value)
    assert "3 attempts" in msg, f"expected '3 attempts' in error, got: {msg}"
    assert "Server disconnected" in msg, f"expected root cause in error, got: {msg}"


def test_init_validates_negative_backoff_base():
    """backoff_base 负数必须抛 ValueError。"""
    with pytest.raises(ValueError, match="backoff_base"):
        OpenAICompatibleLLMClient(
            base_url="https://api.openai.com", api_key="sk-x", model="m",
            backoff_base=-0.5,
        )


def test_default_max_retries_is_three():
    """默认 max_retries=3（首次 + 3 次重试 = 4 次请求）。"""
    c = OpenAICompatibleLLMClient(
        base_url="https://api.openai.com", api_key="sk-x", model="m",
    )
    assert c.max_retries == 3


def test_realistic_exponential_timing():
    """真实运行时不 mock sleep：backoff_base=0.05, max_retries=3。

    期望 sleep 总时长下限 ~0.35s (无 jitter)，上限 ~0.50s (jitter 全开)。
    加 respx + asyncio.run 的 ~0.2-1.5s 系统开销，宽松区间 [0.30, 2.5]s。
    关键：必须比 max_retries=0 的 0s 慢、比 max_retries=1 的 ~0.10s 慢得多。
    """
    c = OpenAICompatibleLLMClient(
        base_url="https://api.openai.com", api_key="sk-x", model="m",
        max_retries=3, backoff_base=0.05, max_backoff_sec=1.0,
    )
    with respx.mock(base_url="https://api.openai.com") as mock:
        mock.post("/v1/chat/completions").mock(return_value=Response(500, text="oops"))

        start = time.monotonic()
        with pytest.raises(LLMError):
            asyncio.run(c.generate([{"role": "user", "content": "x"}]))
        elapsed = time.monotonic() - start

    # 关键不变量：3 次重试 × ~0.05-0.25s sleep + 4 次 mock 调用 ≥ 0.30s
    assert 0.30 < elapsed < 3.0, f"expected 0.30~3.00s elapsed, got {elapsed:.3f}s"
