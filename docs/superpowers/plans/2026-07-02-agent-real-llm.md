# Agent 真实 LLM 集成 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 env 配齐时让 agent 用真实 OpenAI 兼容 LLM 跑，缺 / 出错自动退回 stub；前端只发 provider_id 不发 key；现有 127 前端 + 172 后端测试不回归。

**Architecture:** 后端新增 `OpenAICompatibleLLMClient`（实现已有 `LLMClient` Protocol）+ `llm_factory` 按 env 选真实或 stub；AgentTask schema 加 `llm_provider_id`/`llm_model_id`；前端 `api.startAgent` 多接一个 opts 传 provider_id；ApiSettingsModal 顶部加 env 说明横幅。Media 工具继续 stub（不在本期范围）。

**Tech Stack:** 后端 FastAPI + httpx + pytest + respx（HTTP mock）；前端 React 19 + zustand + vitest + @testing-library/react；Python 包管理用 uv。

**Spec:** [2026-07-02-agent-real-llm-design.md](../specs/2026-07-02-agent-real-llm-design.md)

## Global Constraints

- 现有 127 前端测试 + 172 后端测试必须全过（外加本 plan 新增 4 类测试）
- 不动 `useAgentStore` / `LLMClient` Protocol 的对外 API
- 不动 18 工具的 `name` / `category` 字段
- API key 不进 DB、不进前端请求体；只从后端 env 读
- 保留 `DevScriptedLLM` + `StubMediaService` 作为默认行为
- 任何 LLM 客户端失败必须能退回 stub，不能让 task 完全跑不起来
- 每个 Task 结尾独立可测；每个 Step 含实际代码（无 placeholder）

---

## Task 1: 后端 — env 解析 + LLMProviderConfig dataclass

**Files:**
- Create: `backend/app/agent/llm_factory.py`
- Test: `backend/tests/test_llm_factory.py`

**Interfaces:**
- Consumes: `os.environ`（`LLM_API_KEY`、`LLM_BASE_URL`、`LLM_MODEL`、`LLM_PROVIDERS_JSON`、`LLM_DEFAULT_PROVIDER`）
- Produces: `LLMProviderConfig` dataclass；`load_llm_configs_from_env() -> list[LLMProviderConfig]`

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/test_llm_factory.py
import os
import pytest
from app.agent.llm_factory import (
    LLMProviderConfig,
    load_llm_configs_from_env,
)


def test_load_single_provider_from_short_env(monkeypatch):
    """短 env（LLM_API_KEY / LLM_BASE_URL / LLM_MODEL）合成一个 provider。"""
    monkeypatch.setenv("LLM_API_KEY", "sk-test-123")
    monkeypatch.setenv("LLM_BASE_URL", "https://api.openai.com")
    monkeypatch.setenv("LLM_MODEL", "gpt-4o-mini")
    monkeypatch.delenv("LLM_PROVIDERS_JSON", raising=False)

    configs = load_llm_configs_from_env()

    assert len(configs) == 1
    c = configs[0]
    assert c.provider_id == "openai"
    assert c.api_key == "sk-test-123"
    assert c.base_url == "https://api.openai.com"
    assert c.default_model == "gpt-4o-mini"


def test_load_multiple_providers_from_json(monkeypatch):
    """LLM_PROVIDERS_JSON 解析多 provider（openai / deepseek / kimi 等）。"""
    import json
    monkeypatch.delenv("LLM_API_KEY", raising=False)
    monkeypatch.delenv("LLM_BASE_URL", raising=False)
    monkeypatch.delenv("LLM_MODEL", raising=False)
    monkeypatch.setenv("LLM_PROVIDERS_JSON", json.dumps({
        "openai": {"api_key": "sk-1", "base_url": "https://api.openai.com", "default_model": "gpt-4o-mini"},
        "deepseek": {"api_key": "sk-2", "base_url": "https://api.deepseek.com", "default_model": "deepseek-chat"},
    }))

    configs = load_llm_configs_from_env()

    ids = sorted(c.provider_id for c in configs)
    assert ids == ["deepseek", "openai"]
    by_id = {c.provider_id: c for c in configs}
    assert by_id["openai"].default_model == "gpt-4o-mini"
    assert by_id["deepseek"].base_url == "https://api.deepseek.com"


def test_load_returns_empty_when_no_env(monkeypatch):
    """env 完全没配 → 返回空列表（不是抛错）。"""
    for k in ("LLM_API_KEY", "LLM_BASE_URL", "LLM_MODEL", "LLM_PROVIDERS_JSON"):
        monkeypatch.delenv(k, raising=False)

    configs = load_llm_configs_from_env()

    assert configs == []


def test_short_env_requires_all_three_or_returns_empty(monkeypatch):
    """短 env 只配了 LLM_API_KEY 但没 LLM_BASE_URL → 返回空（不能瞎猜 base_url）。"""
    monkeypatch.setenv("LLM_API_KEY", "sk-test-123")
    monkeypatch.delenv("LLM_BASE_URL", raising=False)
    monkeypatch.delenv("LLM_MODEL", raising=False)
    monkeypatch.delenv("LLM_PROVIDERS_JSON", raising=False)

    configs = load_llm_configs_from_env()

    assert configs == []
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && uv run pytest tests/test_llm_factory.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'app.agent.llm_factory'`

- [ ] **Step 3: Write minimal implementation**

```python
# backend/app/agent/llm_factory.py
"""LLM 配置加载：从环境变量构造 LLMProviderConfig 列表。

支持两种 env 模式：

1. 短模式（单 provider）：
   LLM_API_KEY=sk-xxx
   LLM_BASE_URL=https://api.openai.com
   LLM_MODEL=gpt-4o-mini

2. 长模式（多 provider 共享一个 task）：
   LLM_PROVIDERS_JSON={"openai":{...},"deepseek":{...}}
   LLM_DEFAULT_PROVIDER=openai

任一模式返回 list[LLMProviderConfig]；env 缺 → 返回空 list。
"""
from __future__ import annotations

import json
import os
from dataclasses import dataclass


@dataclass
class LLMProviderConfig:
    provider_id: str
    base_url: str
    api_key: str
    default_model: str


def _load_short_env() -> list[LLMProviderConfig]:
    """从 LLM_API_KEY/BASE_URL/MODEL 合成一个 provider。"""
    api_key = os.environ.get("LLM_API_KEY", "").strip()
    base_url = os.environ.get("LLM_BASE_URL", "").strip().rstrip("/")
    model = os.environ.get("LLM_MODEL", "").strip()
    if not (api_key and base_url and model):
        return []
    return [LLMProviderConfig(
        provider_id="openai",  # 短模式默认 OpenAI 协议
        base_url=base_url,
        api_key=api_key,
        default_model=model,
    )]


def _load_json_env() -> list[LLMProviderConfig]:
    """从 LLM_PROVIDERS_JSON 解析多个 provider。"""
    raw = os.environ.get("LLM_PROVIDERS_JSON", "").strip()
    if not raw:
        return []
    data = json.loads(raw)
    if not isinstance(data, dict):
        return []
    out: list[LLMProviderConfig] = []
    for provider_id, cfg in data.items():
        if not isinstance(cfg, dict):
            continue
        api_key = str(cfg.get("api_key", "")).strip()
        base_url = str(cfg.get("base_url", "")).strip().rstrip("/")
        default_model = str(cfg.get("default_model", "")).strip()
        if not (api_key and base_url and default_model):
            continue
        out.append(LLMProviderConfig(
            provider_id=provider_id,
            base_url=base_url,
            api_key=api_key,
            default_model=default_model,
        ))
    return out


def load_llm_configs_from_env() -> list[LLMProviderConfig]:
    """优先解析 LLM_PROVIDERS_JSON；空则尝试短 env。两者都空 → 返回 []。"""
    return _load_json_env() or _load_short_env()
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && uv run pytest tests/test_llm_factory.py -v`
Expected: PASS（4 tests passed）

- [ ] **Step 5: Commit**

```bash
git add backend/app/agent/llm_factory.py backend/tests/test_llm_factory.py
git commit -m "feat(agent): add llm_factory — env-based LLMProviderConfig loader"
```

---

## Task 2: 后端 — `OpenAICompatibleLLMClient` 实现

**Files:**
- Create: `backend/app/agent/openai_llm_client.py`
- Create: `backend/tests/test_openai_llm_client.py`
- Modify: `backend/pyproject.toml`（如果没 httpx / respx 就加）

**Interfaces:**
- Consumes: `base_url`, `api_key`, `model`（构造时绑定）
- Produces: 实现 `LLMClient` Protocol 的 `generate()` / `generate_structured()`，返回 `LLMResponse`
- HTTP 错误语义：401/403/404 → 立刻 raise `LLMError`（不 retry）；5xx/429/timeout → retry 1 次（指数退避 1s）；仍失败 → raise

- [ ] **Step 1: 确认依赖（httpx + respx）**

Run: `cd backend && uv pip list 2>/dev/null | grep -E "httpx|respx" || echo "need install"`
If need install:
Run: `cd backend && uv add httpx respx --dev`

- [ ] **Step 2: Write the failing test**

```python
# backend/tests/test_openai_llm_client.py
import json
import pytest
import respx
from httpx import Response
from app.agent.openai_llm_client import OpenAICompatibleLLMClient
from app.agent.llm import LLMError


@pytest.fixture
def client():
    return OpenAICompatibleLLMClient(
        base_url="https://api.openai.com",
        api_key="sk-test-123",
        model="gpt-4o-mini",
        timeout_sec=5.0,
    )


def test_generate_sends_chat_completions_request(client):
    """验证请求 URL、headers、body schema 正确。"""
    with respx.mock(base_url="https://api.openai.com") as mock:
        route = mock.post("/v1/chat/completions").mock(
            return_value=Response(200, json={
                "choices": [{"message": {"role": "assistant", "content": "hi", "tool_calls": None}}],
                "usage": {"prompt_tokens": 10, "completion_tokens": 5, "total_tokens": 15},
            })
        )
        import asyncio
        r = asyncio.run(client.generate([
            {"role": "user", "content": "hello"}
        ]))
        assert r.content == "hi"
        assert r.prompt_tokens == 10
        assert r.completion_tokens == 5
        # 验证请求体
        sent = route.calls.last.request
        assert sent.headers["authorization"] == "Bearer sk-test-123"
        body = json.loads(sent.content)
        assert body["model"] == "gpt-4o-mini"
        assert body["messages"] == [{"role": "user", "content": "hello"}]
        assert body["stream"] is False


def test_generate_parses_tool_call_response(client):
    """验证 OpenAI tool_calls 格式解析为 (tool_name, tool_args, content)。"""
    with respx.mock(base_url="https://api.openai.com") as mock:
        mock.post("/v1/chat/completions").mock(
            return_value=Response(200, json={
                "choices": [{
                    "message": {
                        "role": "assistant",
                        "content": None,
                        "tool_calls": [{
                            "id": "call_1",
                            "type": "function",
                            "function": {
                                "name": "finish_task",
                                "arguments": json.dumps({"summary": "all done"})
                            }
                        }]
                    }
                }],
                "usage": {"prompt_tokens": 20, "completion_tokens": 8, "total_tokens": 28},
            })
        )
        import asyncio
        r = asyncio.run(client.generate([{"role": "user", "content": "go"}]))
        assert r.tool_name == "finish_task"
        assert r.tool_args == {"summary": "all done"}


def test_generate_passes_tools_to_request(client):
    """tools 参数必须被加进 body.tools。"""
    with respx.mock(base_url="https://api.openai.com") as mock:
        route = mock.post("/v1/chat/completions").mock(
            return_value=Response(200, json={
                "choices": [{"message": {"role": "assistant", "content": "ok"}}],
                "usage": {"prompt_tokens": 1, "completion_tokens": 1, "total_tokens": 2},
            })
        )
        import asyncio
        tools = [{
            "type": "function",
            "function": {
                "name": "create_plan",
                "description": "Make a plan",
                "parameters": {"type": "object", "properties": {"steps": {"type": "array"}}}
            }
        }]
        asyncio.run(client.generate([{"role": "user", "content": "x"}], tools=tools))
        body = json.loads(route.calls.last.request.content)
        assert body["tools"] == tools


def test_generate_raises_on_401(client):
    """401 立刻 raise，不 retry。"""
    with respx.mock(base_url="https://api.openai.com") as mock:
        mock.post("/v1/chat/completions").mock(return_value=Response(401, json={"error": "bad key"}))
        import asyncio
        with pytest.raises(LLMError, match="401"):
            asyncio.run(client.generate([{"role": "user", "content": "x"}]))


def test_generate_retries_on_5xx_then_succeeds(client):
    """5xx retry 1 次后成功。"""
    with respx.mock(base_url="https://api.openai.com") as mock:
        route = mock.post("/v1/chat/completions").mock(side_effect=[
            Response(503, json={"error": "overloaded"}),
            Response(200, json={
                "choices": [{"message": {"role": "assistant", "content": "retry-ok"}}],
                "usage": {"prompt_tokens": 1, "completion_tokens": 1, "total_tokens": 2},
            }),
        ])
        import asyncio
        r = asyncio.run(client.generate([{"role": "user", "content": "x"}]))
        assert r.content == "retry-ok"
        assert route.call_count == 2


def test_generate_structured_sets_json_response_format(client):
    """generate_structured 必须传 response_format=json_object。"""
    with respx.mock(base_url="https://api.openai.com") as mock:
        route = mock.post("/v1/chat/completions").mock(
            return_value=Response(200, json={
                "choices": [{"message": {"role": "assistant", "content": '{"a": 1}'}}],
                "usage": {"prompt_tokens": 1, "completion_tokens": 1, "total_tokens": 2},
            })
        )
        import asyncio
        r = asyncio.run(client.generate_structured(
            [{"role": "user", "content": "give json"}],
            json_schema={"type": "object", "properties": {"a": {"type": "integer"}}}
        ))
        body = json.loads(route.calls.last.request.content)
        assert body["response_format"] == {"type": "json_object"}
        assert r.content == '{"a": 1}'
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd backend && uv run pytest tests/test_openai_llm_client.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'app.agent.openai_llm_client'`

- [ ] **Step 4: Write minimal implementation**

```python
# backend/app/agent/openai_llm_client.py
"""OpenAI 兼容 LLM 客户端实现。

支持的 endpoint：所有 OpenAI 兼容的 /v1/chat/completions
（OpenAI / DeepSeek / Kimi / Qwen / 火山引擎 / 本地 vllm 等）。

实现 LLMClient Protocol（见 app/agent/llm.py）。
"""
from __future__ import annotations

import asyncio
import json
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
                    # 可重试错误
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
        # 兜底（实际不会到这里）
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
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd backend && uv run pytest tests/test_openai_llm_client.py -v`
Expected: PASS（6 tests passed）

- [ ] **Step 6: Commit**

```bash
git add backend/app/agent/openai_llm_client.py backend/tests/test_openai_llm_client.py backend/pyproject.toml backend/uv.lock
git commit -m "feat(agent): add OpenAICompatibleLLMClient (chat/completions + tool_calls)"
```

---

## Task 3: 后端 — `select_llm_for_task` factory + 降级策略

**Files:**
- Modify: `backend/app/agent/llm_factory.py:1-99`（追加）
- Modify: `backend/tests/test_llm_factory.py:1-99`（追加 4 个测试）

**Interfaces:**
- Consumes: `task_provider_id: str | None`、`configs: list[LLMProviderConfig]`、可选 `task_model_id: str | None`
- Produces: `(LLMClient, mode: Literal["real", "stub"], fallback_reason: str | None)`
  - mode="real" 时 LLMClient 是 `OpenAICompatibleLLMClient`；mode="stub" 时是 `DevScriptedLLM`
  - `fallback_reason` 仅在 mode="stub" 且用户实际请求了 real 时有值，否则 None

- [ ] **Step 1: Write the failing test（追加到 test_llm_factory.py）**

```python
# 追加到 backend/tests/test_llm_factory.py
from app.agent.llm_factory import select_llm_for_task
from app.agent.openai_llm_client import OpenAICompatibleLLMClient
from app.agent.dev_scripted_llm import DevScriptedLLM


def test_select_returns_real_llm_when_provider_match():
    """env 配了 openai，task_provider_id='openai' → 返回 OpenAICompatibleLLMClient。"""
    configs = [LLMProviderConfig("openai", "https://api.openai.com", "sk-1", "gpt-4o-mini")]
    llm, mode, reason = select_llm_for_task("openai", configs)
    assert mode == "real"
    assert reason is None
    assert isinstance(llm, OpenAICompatibleLLMClient)
    assert llm.model == "gpt-4o-mini"


def test_select_falls_back_to_stub_when_provider_not_in_env():
    """task_provider_id 不在 env configs 里 → 退回 stub，reason 不为 None。"""
    configs = [LLMProviderConfig("openai", "https://api.openai.com", "sk-1", "gpt-4o-mini")]
    llm, mode, reason = select_llm_for_task("deepseek", configs)
    assert mode == "stub"
    assert reason is not None
    assert "deepseek" in reason.lower() or "not found" in reason.lower()
    assert isinstance(llm, DevScriptedLLM)


def test_select_falls_back_to_stub_when_no_env_at_all():
    """configs 为空且 task_provider_id 不为 None → 退回 stub，reason 提示未配置。"""
    llm, mode, reason = select_llm_for_task("openai", [])
    assert mode == "stub"
    assert reason is not None
    assert isinstance(llm, DevScriptedLLM)


def test_select_returns_stub_silently_when_task_provider_id_is_none():
    """task_provider_id 为 None（用户没选）→ 直接 stub，reason 为 None。"""
    llm, mode, reason = select_llm_for_task(None, [])
    assert mode == "stub"
    assert reason is None
    assert isinstance(llm, DevScriptedLLM)


def test_select_uses_task_model_id_override():
    """如果 task 显式指定 model_id，应覆盖 config 的 default_model。"""
    configs = [LLMProviderConfig("openai", "https://api.openai.com", "sk-1", "gpt-4o-mini")]
    llm, mode, _ = select_llm_for_task("openai", configs, task_model_id="gpt-4o")
    assert mode == "real"
    assert isinstance(llm, OpenAICompatibleLLMClient)
    assert llm.model == "gpt-4o"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && uv run pytest tests/test_llm_factory.py -v`
Expected: FAIL — `ImportError: cannot import name 'select_llm_for_task'`

- [ ] **Step 3: Write minimal implementation（追加到 llm_factory.py）**

```python
# 追加到 backend/app/agent/llm_factory.py 末尾
from typing import Literal
from .llm import LLMClient
from .dev_scripted_llm import DevScriptedLLM
from .openai_llm_client import OpenAICompatibleLLMClient


def select_llm_for_task(
    task_provider_id: str | None,
    configs: list[LLMProviderConfig],
    task_model_id: str | None = None,
) -> tuple[LLMClient, Literal["real", "stub"], str | None]:
    """为单个 task 选 LLM 客户端。

    决策树：
    1. task_provider_id 为 None → 静默回 stub（用户没指定就是 dev 模式）
    2. configs 为空 → 回 stub，reason="no LLM configured in env"
    3. configs 中找不到 task_provider_id → 回 stub，reason="provider not found in env"
    4. 找到 → 用真实 client；model 优先用 task_model_id，否则 config.default_model

    Returns: (client, mode, fallback_reason_or_none)
    """
    if task_provider_id is None:
        return DevScriptedLLM(user_goal=""), "stub", None

    if not configs:
        return DevScriptedLLM(user_goal=""), "stub", "no LLM configured in env (set LLM_API_KEY or LLM_PROVIDERS_JSON)"

    for c in configs:
        if c.provider_id == task_provider_id:
            model = task_model_id or c.default_model
            client = OpenAICompatibleLLMClient(
                base_url=c.base_url,
                api_key=c.api_key,
                model=model,
            )
            return client, "real", None

    available = ", ".join(c.provider_id for c in configs) or "(none)"
    return DevScriptedLLM(user_goal=""), "stub", (
        f"provider '{task_provider_id}' not found in env; available: {available}"
    )
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && uv run pytest tests/test_llm_factory.py -v`
Expected: PASS（9 tests passed — 4 from Task 1 + 5 new）

- [ ] **Step 5: Commit**

```bash
git add backend/app/agent/llm_factory.py backend/tests/test_llm_factory.py
git commit -m "feat(agent): add select_llm_for_task factory with stub fallback"
```

---

## Task 4: 后端 — AgentTask schema 加 `llm_provider_id` / `llm_model_id`

**Files:**
- Modify: `backend/app/models/agent_task.py`（加 2 字段 + to_dict）
- Modify: `backend/app/schemas/agent.py`（加 2 字段到 `AgentTaskCreate` / `AgentTaskOut`）
- Modify: `backend/app/routers/agent.py:30-90`（`create_task` 接收新字段）
- Test: `backend/tests/test_agent_routes.py`（追加 1 case）

**Interfaces:**
- `AgentTaskCreate.llm_provider_id: str | None = None`
- `AgentTaskCreate.llm_model_id: str | None = None`
- `AgentTask.llm_provider_id: str | None`
- `AgentTask.llm_model_id: str | None`
- `AgentTask.to_dict()` 返回这两个字段

- [ ] **Step 1: Read current model + schema**

Read: `backend/app/models/agent_task.py` and `backend/app/schemas/agent.py` to confirm field naming convention.

- [ ] **Step 2: Modify AgentTask model**

In `backend/app/models/agent_task.py`, add to the `AgentTask` class:

```python
llm_provider_id: Mapped[str | None] = mapped_column(String(64), nullable=True, default=None)
llm_model_id: Mapped[str | None] = mapped_column(String(128), nullable=True, default=None)
```

In the same file's `to_dict()` method, add:

```python
"llm_provider_id": self.llm_provider_id,
"llm_model_id": self.llm_model_id,
```

- [ ] **Step 3: Modify schemas**

In `backend/app/schemas/agent.py`, add to `AgentTaskCreate`:

```python
llm_provider_id: str | None = None
llm_model_id: str | None = None
```

Add the same to `AgentTaskOut` (or `AgentTaskInfo`, whichever is the response schema for create).

- [ ] **Step 4: Modify create_task route**

In `backend/app/routers/agent.py`, in `create_task` (~line 30-50), after the `AgentTask(...)` constructor, set the new fields:

```python
task = AgentTask(
    project_id=body.project_id,
    user_goal=body.user_goal,
    # ... existing fields ...
    llm_provider_id=body.llm_provider_id,
    llm_model_id=body.llm_model_id,
)
```

- [ ] **Step 5: Write the failing test**

```python
# 追加到 backend/tests/test_agent_routes.py（如果该文件已有，添加；如果没有，新建）

def test_create_task_with_llm_provider_fields(client):
    """POST /api/agent/tasks 带 llm_provider_id / llm_model_id 应被存进 task 行。"""
    from fastapi.testclient import TestClient
    from app import app
    c = TestClient(app)
    r = c.post("/api/agent/tasks", json={
        "project_id": None,
        "user_goal": "test goal",
        "llm_provider_id": "openai",
        "llm_model_id": "gpt-4o-mini",
    })
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["llm_provider_id"] == "openai"
    assert body["llm_model_id"] == "gpt-4o-mini"
```

- [ ] **Step 6: Run test to verify it passes（如果失败说明 schema/model 没改对，按错误信息修正）**

Run: `cd backend && uv run pytest tests/test_agent_routes.py -v -k llm_provider`
Expected: PASS

- [ ] **Step 7: Run all backend tests to verify no regression**

Run: `cd backend && uv run pytest --timeout=30 -q`
Expected: 172 + 4 (from Task 1) + 5 (from Task 2) + 5 (from Task 3) + 1 (Task 4) = 187 tests passed

- [ ] **Step 8: Commit**

```bash
git add backend/app/models/agent_task.py backend/app/schemas/agent.py backend/app/routers/agent.py backend/tests/test_agent_routes.py
git commit -m "feat(agent): AgentTask.llm_provider_id / llm_model_id fields"
```

---

## Task 5: 后端 — `_spawn_runtime` 用 factory 选 LLM，并在 task_started payload 报告 mode

**Files:**
- Modify: `backend/app/routers/agent.py:250-330`（`_spawn_runtime` 改造）
- Test: `backend/tests/test_runtime_autostart.py`（追加 1 case，验证 stub fallback 在没有 env 时正常）

**Interfaces:**
- `_spawn_runtime` 现在用 `select_llm_for_task` 选 LLM
- `task_started` 事件 payload 多两字段：`llm_mode: "real"|"stub"`、`llm_fallback_reason: str | None`

- [ ] **Step 1: Read current _spawn_runtime**

Read: `backend/app/routers/agent.py:250-330` to see the current structure.

- [ ] **Step 2: Modify _spawn_runtime**

In `backend/app/routers/agent.py`, replace the section that constructs `llm` (~line 263):

```python
# 1. 构造 LLM：按 env + task.llm_provider_id 选真实 or stub
from app.agent.llm_factory import select_llm_for_task, load_llm_configs_from_env

configs = load_llm_configs_from_env()
llm, llm_mode, llm_fallback_reason = select_llm_for_task(
    task_provider_id=task_dict.get("llm_provider_id"),
    configs=configs,
    task_model_id=task_dict.get("llm_model_id"),
)
```

Then, find where `task_started` event is published and add the new fields. Look for `EventType.TASK_STARTED` and the dict passed; add:

```python
"llm_mode": llm_mode,
"llm_fallback_reason": llm_fallback_reason,
```

- [ ] **Step 3: Write the failing test**

```python
# 追加到 backend/tests/test_runtime_autostart.py

def test_spawn_runtime_uses_stub_when_no_env(monkeypatch, tmp_db):
    """env 没配时，task_started payload.llm_mode 应为 'stub'，reason 不为 None。"""
    from fastapi.testclient import TestClient
    from app import app
    from app.agent.events import event_bus, EventType
    from app.database import init_db
    init_db()
    for k in ("LLM_API_KEY", "LLM_BASE_URL", "LLM_MODEL", "LLM_PROVIDERS_JSON"):
        monkeypatch.delenv(k, raising=False)

    c = TestClient(app)
    r = c.post("/api/agent/tasks", json={
        "project_id": None,
        "user_goal": "fallback test",
        "llm_provider_id": "openai",   # 显式请求真实，但 env 没配
    })
    assert r.status_code == 200
    task_id = r.json()["id"]

    # 通过 event_log 读 task_started
    events = event_bus.get_replay(task_id)
    started = next((e for e in events if e.type == EventType.TASK_STARTED), None)
    assert started is not None
    assert started.payload.get("llm_mode") == "stub"
    assert started.payload.get("llm_fallback_reason") is not None
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && uv run pytest tests/test_runtime_autostart.py -v -k fallback`
Expected: PASS

- [ ] **Step 5: Run all backend tests to verify no regression**

Run: `cd backend && uv run pytest --timeout=30 -q`
Expected: 188 tests passed

- [ ] **Step 6: Commit**

```bash
git add backend/app/routers/agent.py backend/tests/test_runtime_autostart.py
git commit -m "feat(agent): _spawn_runtime uses select_llm_for_task; reports llm_mode in task_started"
```

---

## Task 6: 前端 — `api.startAgent` 接受 provider_id opts

**Files:**
- Modify: `services/apiClient.ts`（`startAgent` 加可选 opts）
- Modify: `agent/agent-mode.tsx`（`onSubmit` 传 opts）
- Test: `tests/services/api-client.test.ts`（如果存在，加 case）

**Interfaces:**
- `api.startAgent(projectId, goal, opts?: { providerId?: string; modelId?: string })` — providerId 来自 `useCanvasStore.apiConfig.stepBindings.llm.providerId`（前端已有的"LLM 用哪个 provider"绑定），不发 key

- [ ] **Step 1: Read current startAgent**

Read: `services/apiClient.ts` to find `startAgent` definition.

- [ ] **Step 2: Modify startAgent**

In `services/apiClient.ts`, change the signature:

```typescript
startAgent(
  projectId: string,
  goal: string,
  opts?: { providerId?: string; modelId?: string }
): Promise<AgentTask> {
  return http.post('/api/agent/tasks', {
    project_id: projectId,
    user_goal: goal,
    llm_provider_id: opts?.providerId ?? null,
    llm_model_id: opts?.modelId ?? null,
  }).then(r => r.data);
}
```

- [ ] **Step 3: Modify agent-mode.tsx onSubmit**

In `agent/agent-mode.tsx`, in `onSubmit` (~line 124-141), change:

```typescript
const t = await api.startAgent(projectId, goal.trim());
```

to:

```typescript
// 从前端 apiConfig 里读 LLM provider 选择（仅 provider_id，不发 key）
const llmProviderId = useCanvasStore.getState().apiConfig.stepBindings?.llm?.providerId;
const t = await api.startAgent(projectId, goal.trim(), {
  providerId: llmProviderId || undefined,
});
```

(Import `useCanvasStore` is already present in agent-mode.tsx.)

- [ ] **Step 4: Run all frontend tests to verify no regression**

Run: `cd <repo-root> && npx vitest run`
Expected: 127 tests passed (no new tests needed; this is a thin wire)

- [ ] **Step 5: Commit**

```bash
git add services/apiClient.ts agent/agent-mode.tsx
git commit -m "feat(agent): api.startAgent accepts providerId opts (no key sent to backend)"
```

---

## Task 7: 前端 — ApiSettingsModal 顶部加 env 说明横幅

**Files:**
- Modify: `components/infinite-canvas/ApiSettingsModal.tsx`（加横幅 + 提示文字）
- Modify: `locales.ts`（加 2 个 i18n key：zh / en）
- Test: `tests/components/api-settings.test.tsx`（如果存在，加 case）

**Interfaces:**
- Modal 顶部固定一条提示横幅：「Agent 流程使用后端环境变量中的 API key；此处的 key 仅供画布自身生成使用」

- [ ] **Step 1: Read current modal header**

Read: `components/infinite-canvas/ApiSettingsModal.tsx` near the modal opening JSX (~line 1000-1100).

- [ ] **Step 2: Add locales**

In `locales.ts`, add to both `zh` and `en` objects:

```typescript
canvasApiSettingsEnvHintTitle: "Agent 流程使用后端环境变量",
canvasApiSettingsEnvHintBody: "本页配置的 API Key 仅供画布自身（图像/视频/音频生成）使用。Agent Director 任务使用后端环境变量 LLM_API_KEY / LLM_PROVIDERS_JSON，请联系后端管理员配置。",
```

- [ ] **Step 3: Add hint banner to modal**

In `ApiSettingsModal.tsx`, right after the modal `<div className="api-modal">` opens (or right after the modal title), add:

```tsx
<div className="api-env-hint" role="note">
  <Info size={14} />
  <div>
    <div className="api-env-hint-title">{t('canvasApiSettingsEnvHintTitle')}</div>
    <div className="api-env-hint-body">{t('canvasApiSettingsEnvHintBody')}</div>
  </div>
</div>
```

Add `Info` to the existing lucide-react import at the top of the file (check if already imported; if not, add).

- [ ] **Step 4: Add CSS for the hint**

In `agent/agent.css` (or wherever the api-modal styles live — search for `.api-modal`), add:

```css
.api-env-hint {
  display: flex;
  gap: 10px;
  align-items: flex-start;
  padding: 10px 14px;
  margin: 0 0 12px 0;
  border-radius: 10px;
  background: var(--soft);
  border: 1px solid var(--line);
  color: var(--text);
  font-size: 12px;
  line-height: 1.5;
}
.api-env-hint-title { font-weight: 700; margin-bottom: 2px; }
.api-env-hint-body { color: var(--muted); }
```

- [ ] **Step 5: Run all frontend tests**

Run: `npx vitest run`
Expected: 127 tests passed

- [ ] **Step 6: Commit**

```bash
git add components/infinite-canvas/ApiSettingsModal.tsx agent/agent.css locales.ts
git commit -m "feat(api-settings): hint that Agent uses backend env LLM, not this page's key"
```

---

## Task 8: 最终回归 — 全量测试 + 手动端到端

**Files:** (no changes)

- [ ] **Step 1: Run all backend tests**

Run: `cd backend && uv run pytest --timeout=30 -q`
Expected: 188 tests passed (172 baseline + 4 from Task 1 + 6 from Task 2 + 5 from Task 3 + 1 from Task 4 + 1 from Task 5)

If any fail, fix before proceeding.

- [ ] **Step 2: Run all frontend tests**

Run: `npx vitest run`
Expected: 127 tests passed

- [ ] **Step 3: Manual end-to-end smoke (no env)**

1. 不设任何 env，启动后端 `uv run uvicorn app:app --reload`
2. 启动前端 `npm run dev`
3. 打开 Agent Mode，输入 "做一个 30 秒的雨夜短片"
4. 观察：ThoughtStream 应有完整 6 步流程，task 走 stub 完成（行为与之前完全一致）

Expected: 与改前完全一致，0 回归

- [ ] **Step 4: Manual end-to-end smoke (with env)**

1. 终端设 env：
   ```bash
   export LLM_API_KEY=sk-...实际测试key
   export LLM_BASE_URL=https://api.deepseek.com
   export LLM_MODEL=deepseek-chat
   ```
2. 重启后端
3. 同样输入目标，观察：
   - 后端启动日志应有 "real LLM mode" 之类提示
   - ThoughtStream 应显示 6 个步骤的 thought / action / observation
   - task 完成后，后端日志应能看到实际 POST 到 deepseek 的请求
   - 用户在 DeepSeek 控制台**能看到 token 消耗**（这才是修复目标）

Expected: 真实 LLM 调用 + 用户额度真实消耗

- [ ] **Step 5: Final commit (if any fixup)**

Only if Step 1-4 surfaced a small fixup needed. Otherwise no commit.

---

## Self-Review (filled after writing)

**Spec coverage check:**
- §4.1 LLM Factory ✓ Task 1, 3
- §4.2 OpenAICompatibleLLMClient ✓ Task 2
- §4.3 AgentTask schema 加字段 ✓ Task 4
- §4.4 api.startAgent 接受 opts ✓ Task 6
- §4.4 ApiSettingsModal 顶部说明 ✓ Task 7
- §6 错误处理 / 降级 ✓ Task 2 (5xx retry / 4xx raise) + Task 3 (env 缺退 stub) + Task 5 (reason 上报)
- §7 测试 ✓ 每个 task 都有测试
- §8 实施顺序 ✓ Tasks 1-7 按顺序

**No placeholders:** confirmed — 每个 step 都有完整代码或命令。

**Type consistency:**
- `LLMProviderConfig` 字段：`provider_id`, `base_url`, `api_key`, `default_model` — Task 1 定义，Task 3 引用 ✓
- `select_llm_for_task` 返回 `(client, mode, reason)` — Task 3 定义，Task 5 引用 ✓
- `OpenAICompatibleLLMClient(base_url, api_key, model, timeout_sec)` — Task 2 定义，Task 3 引用 ✓
- `task_started` payload 字段 `llm_mode` / `llm_fallback_reason` — Task 5 定义 ✓
- 前端 `api.startAgent(projectId, goal, opts?)` — Task 6 定义 ✓
