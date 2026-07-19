"""OpenAI 兼容 LLM 客户端实现。

支持的 endpoint：所有 OpenAI 兼容的 /v1/chat/completions
（OpenAI / DeepSeek / Kimi / Qwen / 火山引擎 / 本地 vllm 等）。

实现 LLMClient Protocol（见 app/agent/llm.py）。
"""
from __future__ import annotations

import asyncio
import inspect
import json
import logging
import random
from typing import Any

import httpx

from .llm import LLMError, LLMResponse, _parse_function_call
from .token_limits import DEEPSEEK_V4_PRO_MAX_OUTPUT_TOKENS


logger = logging.getLogger("dramaforge.openai_llm_client")


# 估算成本（USD/1K token）。覆盖常用模型；未知模型按 gpt-4o-mini 计。
# 实际计费由前端 cost_update 事件显示，估算仅作 fallback。
_COST_PER_1K = {
    "gpt-4o-mini": {"input": 0.00015, "output": 0.0006},
    "gpt-4o":      {"input": 0.0025,  "output": 0.01},
    "deepseek-chat": {"input": 0.00014, "output": 0.00028},
    "moonshot-v1-8k": {"input": 0.001, "output": 0.001},
    "qwen-turbo":  {"input": 0.0003, "output": 0.0003},
    "qwen-plus":   {"input": 0.0008, "output": 0.002},
    "qwen-max":    {"input": 0.02,    "output": 0.06},
}


def _estimate_cost(model: str, prompt_tokens: int, completion_tokens: int) -> float:
    table = _COST_PER_1K.get(model) or _COST_PER_1K["gpt-4o-mini"]
    return round(
        prompt_tokens / 1000 * table["input"]
        + completion_tokens / 1000 * table["output"],
        6,
    )


class OpenAICompatibleLLMClient:
    """OpenAI 兼容 chat 客户端。

    重试策略：5xx/429/timeout/network error 用指数退避重试 max_retries 次
    （delay = backoff_base * 2^attempt + jitter，上限 max_backoff_sec）。
              4xx (除 429) 立刻 raise（认证/参数错误重试无意义）。
    """

    def __init__(
        self,
        base_url: str,
        api_key: str,
        model: str,
        timeout_sec: float = 60.0,
        max_retries: int = 3,
        backoff_base: float = 1.0,
        max_backoff_sec: float = 30.0,
    ):
        # 兼容用户填 base_url 时是否带 /v1 后缀
        #  - 官方 OpenAI: https://api.openai.com/v1
        #  - DeepSeek/Kimi/Qwen: https://api.deepseek.com/v1
        #  - 自定义代理: http://localhost:8765/v1
        #  - 也有少数用户会填根: http://localhost:8765
        # 统一规整为 <root>/v1/chat/completions
        self.base_url = self._normalize_base_url(base_url)
        self.api_key = api_key
        self.model = model
        self._timeout = httpx.Timeout(timeout_sec)
        # 重试配置：max_retries=0 表示不重试，max_retries=3 表示总共 4 次尝试
        # （与项目里 RetryableTool 语义保持一致：attempt 从 0 计数）。
        if max_retries < 0:
            raise ValueError(f"max_retries must be >= 0, got {max_retries}")
        if backoff_base < 0:
            raise ValueError(f"backoff_base must be >= 0, got {backoff_base}")
        self.max_retries = max_retries
        self.backoff_base = backoff_base
        self.max_backoff_sec = max_backoff_sec

    @staticmethod
    def _normalize_base_url(base_url: str) -> str:
        s = (base_url or "").rstrip("/")
        if s.endswith("/v1"):
            s = s[: -len("/v1")]
        return s

    def _headers(self) -> dict[str, str]:
        return {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }

    def _endpoint(self) -> str:
        return f"{self.base_url}/v1/chat/completions"

    def _compute_backoff(self, attempt: int) -> float:
        """计算第 N 次重试前的 sleep 秒数。

        delay = backoff_base * 2^attempt + uniform(0, backoff_base)
        - attempt=0: ~[1.0, 2.0)
        - attempt=1: ~[2.0, 3.0)
        - attempt=2: ~[4.0, 5.0)
        - attempt=3: ~[8.0, 9.0)
        jitter 防止多 agent 同时撞同一时刻重试（thundering herd）。
        """
        exp = self.backoff_base * (2 ** attempt)
        # 抖动区间与 base 对齐：base=1.0 → 0~1s 抖动
        jitter = random.uniform(0, self.backoff_base) if self.backoff_base > 0 else 0.0
        return min(exp + jitter, self.max_backoff_sec)

    async def _post_with_retry(self, body: dict) -> dict:
        """指数退避重试。

        重试条件：5xx / 429 / httpx.TimeoutException / httpx.NetworkError /
                  httpx.ProtocolError（含 RemoteProtocolError "Server disconnected"）
        不重试：其它 4xx（401/403/404/422 等认证/参数错误，重试无意义）。

        attempt 计数从 0 开始，max_retries=3 表示最多重试 3 次
        （首次失败 + 3 次重试 = 总共 4 次请求）。

        关键：必须捕获 httpx.ProtocolError。上游服务器在响应过程中突然断开连接
        （如网关 keepalive 过期 / 负载均衡摘除 / 进程重启）时，httpcore 会抛
        `RemoteProtocolError: Server disconnected without sending a response`，
        这是 ProtocolError 的子类但不是 NetworkError 的子类。如果不捕获，整个
        agent 任务会直接 TASK_FAILED，用户需要重跑整段对话。
        """
        last_exc: Exception | None = None
        last_status: int | None = None
        for attempt in range(self.max_retries + 1):
            try:
                async with httpx.AsyncClient(timeout=self._timeout) as cx:
                    r = await cx.post(self._endpoint(), headers=self._headers(), json=body)
                if r.status_code == 429 or 500 <= r.status_code < 600:
                    last_status = r.status_code
                    last_exc = LLMError(f"LLM HTTP {r.status_code}: {r.text[:200]}")
                    if attempt < self.max_retries:
                        delay = self._compute_backoff(attempt)
                        await asyncio.sleep(delay)
                        continue
                    # 已达 max_retries 上限 → 抛出
                    raise last_exc
                if r.status_code >= 400:
                    # 不可重试（401/403/404/422 等）
                    raise LLMError(f"LLM HTTP {r.status_code}: {r.text[:200]}")
                return r.json()
            except (httpx.TimeoutException, httpx.NetworkError, httpx.ProtocolError) as e:
                last_exc = e
                if attempt < self.max_retries:
                    delay = self._compute_backoff(attempt)
                    logger.warning(
                        "LLM transient error on attempt %d/%d (%s: %s); retrying in %.2fs",
                        attempt + 1, self.max_retries + 1,
                        type(e).__name__, str(e) or "(no message)", delay,
                    )
                    await asyncio.sleep(delay)
                    continue
                # httpx.ConnectError / RemoteProtocolError 的 __str__ 可能为空，
                # 必须从 cause 链里挖根因（httpcore 的 message 才是真正可读的，
                # 例如 "Server disconnected without sending a response"）。
                raise LLMError(
                    f"LLM network error after {self.max_retries + 1} attempts: {self._describe_network_error(e)}"
                ) from e
        # 理论上循环里一定会 raise，这里兜底让 type checker 满意
        raise LLMError(
            f"LLM request failed (status={last_status}): {self._describe_network_error(last_exc)}"
        )

    @staticmethod
    def _describe_network_error(e: BaseException | None) -> str:
        """从 httpx / httpcore 异常链里挖出最底层可读消息。

        httpx 包装异常（ConnectError / ReadError / TimeoutException 等）默认
        __str__ 为空，调用方只能看到一个 "LLMError: LLM network error after retry: "
        的空尾巴。顺着 __cause__ / __context__ 一路找，把所有非空片段拼起来。
        """
        if e is None:
            return "unknown network error"
        parts: list[str] = []
        seen: set[int] = set()
        cur: BaseException | None = e
        depth = 0
        while cur is not None and depth < 10 and id(cur) not in seen:
            seen.add(id(cur))
            depth += 1
            msg = str(cur).strip()
            if msg and msg != type(cur).__name__ and msg not in parts:
                parts.append(msg)
            cur = cur.__cause__ or cur.__context__
        if not parts:
            # 全部都是裸的类名 → 至少暴露一个 class 名
            parts.append(f"{type(e).__name__} (no message)")
        # 头部加上 endpoint 方便定位
        return f"{type(e).__name__}: " + " | ".join(parts)

    @staticmethod
    def _build_body(
        messages: list[dict],
        model: str,
        tools: list[dict] | None,
        temperature: float,
        max_tokens: int,
        response_format: dict | None = None,
    ) -> dict:
        body: dict[str, Any] = {
            "model": model,
            "messages": messages,
            "temperature": temperature,
            "max_tokens": max_tokens,
            "stream": False,
        }
        if tools:
            body["tools"] = tools
            body["tool_choice"] = "auto"
        if response_format:
            body["response_format"] = response_format
        return body

    @staticmethod
    def _parse_response(raw: dict, model: str) -> LLMResponse:
        tool_name, tool_args, content = _parse_function_call(raw)
        usage = raw.get("usage") or {}
        prompt_tokens = int(usage.get("prompt_tokens", 0))
        completion_tokens = int(usage.get("completion_tokens", 0))
        return LLMResponse(
            content=content,
            tool_name=tool_name,
            tool_args=tool_args,
            model=model,
            prompt_tokens=prompt_tokens,
            completion_tokens=completion_tokens,
            cost_usd=_estimate_cost(model, prompt_tokens, completion_tokens),
            raw=raw,
        )

    async def generate(
        self,
        messages: list[dict],
        tools: list[dict] | None = None,
        temperature: float = 0.7,
        max_tokens: int = DEEPSEEK_V4_PRO_MAX_OUTPUT_TOKENS,
    ) -> LLMResponse:
        body = self._build_body(messages, self.model, tools, temperature, max_tokens)
        raw = await self._post_with_retry(body)
        return self._parse_response(raw, self.model)

    async def generate_streaming(
        self,
        messages: list[dict],
        tools: list[dict] | None = None,
        temperature: float = 0.7,
        max_tokens: int = DEEPSEEK_V4_PRO_MAX_OUTPUT_TOKENS,
        on_delta: Any | None = None,
    ) -> LLMResponse:
        """Read OpenAI-compatible SSE deltas while retaining the normal response contract."""
        body = self._build_body(messages, self.model, tools, temperature, max_tokens)
        body["stream"] = True
        content_parts: list[str] = []
        tool_name = ""
        tool_args = ""
        usage: dict[str, Any] = {}
        async with httpx.AsyncClient(timeout=self._timeout) as cx:
            async with cx.stream("POST", self._endpoint(), headers=self._headers(), json=body) as response:
                if response.status_code >= 400:
                    raise LLMError(f"LLM HTTP {response.status_code}: {(await response.aread()).decode(errors='replace')[:200]}")
                async for line in response.aiter_lines():
                    if not line.startswith("data:"):
                        continue
                    data = line[5:].strip()
                    if data == "[DONE]":
                        break
                    try:
                        chunk = json.loads(data)
                    except json.JSONDecodeError:
                        continue
                    usage.update(chunk.get("usage") or {})
                    delta = ((chunk.get("choices") or [{}])[0].get("delta") or {})
                    text = delta.get("content")
                    if text:
                        content_parts.append(str(text))
                        if on_delta:
                            result = on_delta(str(text))
                            if inspect.isawaitable(result):
                                await result
                    for call in delta.get("tool_calls") or []:
                        fn = call.get("function") or {}
                        tool_name += str(fn.get("name") or "")
                        tool_args += str(fn.get("arguments") or "")
        content = "".join(content_parts) or None
        raw: dict[str, Any] = {"choices": [{"message": {"content": content}}], "usage": usage}
        if tool_name:
            raw["choices"][0]["message"]["tool_calls"] = [{
                "type": "function",
                "function": {"name": tool_name, "arguments": tool_args or "{}"},
            }]
        return self._parse_response(raw, self.model)

    async def generate_structured(
        self,
        messages: list[dict],
        json_schema: dict | None = None,
        temperature: float = 0.7,
        max_tokens: int = DEEPSEEK_V4_PRO_MAX_OUTPUT_TOKENS,
    ) -> LLMResponse:
        body = self._build_body(
            messages, self.model, None, temperature, max_tokens,
            response_format={"type": "json_object"},
        )
        raw = await self._post_with_retry(body)
        return self._parse_response(raw, self.model)
