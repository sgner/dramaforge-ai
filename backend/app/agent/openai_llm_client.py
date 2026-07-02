"""OpenAI 兼容 LLM 客户端实现。

支持的 endpoint：所有 OpenAI 兼容的 /v1/chat/completions
（OpenAI / DeepSeek / Kimi / Qwen / 火山引擎 / 本地 vllm 等）。

实现 LLMClient Protocol（见 app/agent/llm.py）。
"""
from __future__ import annotations

import asyncio
from typing import Any

import httpx

from .llm import LLMError, LLMResponse, _parse_function_call


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

    重试策略：5xx/429/timeout retry 1 次（指数退避 1s）。
              4xx (除 429) 立刻 raise。
    """

    def __init__(
        self,
        base_url: str,
        api_key: str,
        model: str,
        timeout_sec: float = 60.0,
    ):
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key
        self.model = model
        self._timeout = httpx.Timeout(timeout_sec)

    def _headers(self) -> dict[str, str]:
        return {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }

    def _endpoint(self) -> str:
        return f"{self.base_url}/v1/chat/completions"

    async def _post_with_retry(self, body: dict) -> dict:
        last_exc: Exception | None = None
        for attempt in (0, 1):
            try:
                async with httpx.AsyncClient(timeout=self._timeout) as cx:
                    r = await cx.post(self._endpoint(), headers=self._headers(), json=body)
                if r.status_code == 429 or 500 <= r.status_code < 600:
                    if attempt == 0:
                        await asyncio.sleep(1.0)
                        continue
                    raise LLMError(f"LLM HTTP {r.status_code}: {r.text[:200]}")
                if r.status_code >= 400:
                    # 不可重试（401/403/404/422 等）
                    raise LLMError(f"LLM HTTP {r.status_code}: {r.text[:200]}")
                return r.json()
            except (httpx.TimeoutException, httpx.NetworkError) as e:
                last_exc = e
                if attempt == 0:
                    await asyncio.sleep(1.0)
                    continue
                raise LLMError(f"LLM network error after retry: {e}") from e
        raise LLMError(f"LLM request failed: {last_exc}")

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
        max_tokens: int = 4000,
    ) -> LLMResponse:
        body = self._build_body(messages, self.model, tools, temperature, max_tokens)
        raw = await self._post_with_retry(body)
        return self._parse_response(raw, self.model)

    async def generate_structured(
        self,
        messages: list[dict],
        json_schema: dict | None = None,
        temperature: float = 0.7,
        max_tokens: int = 4000,
    ) -> LLMResponse:
        body = self._build_body(
            messages, self.model, None, temperature, max_tokens,
            response_format={"type": "json_object"},
        )
        raw = await self._post_with_retry(body)
        return self._parse_response(raw, self.model)
