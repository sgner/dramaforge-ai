"""Tool 基类 + Registry。

agent 可调用的原子能力。工具 = 一段带 schema 的异步函数。
"""
from __future__ import annotations

import asyncio
from typing import Any, Protocol, runtime_checkable
from pydantic import BaseModel, Field


# ========================
# 错误类型
# ========================

class ToolError(Exception):
    """工具调用错误基类。"""
    pass


class ToolValidationError(ToolError):
    """参数校验失败。"""
    pass


class RetryableError(ToolError):
    """可重试的错误（网络超时、限流等）。"""
    pass


class NonRetryableError(ToolError):
    """不可重试的错误（参数错误、权限错误等）。"""
    pass


# ========================
# 参数 schema
# ========================

class ToolParameter(BaseModel):
    name: str
    type: str  # "string" | "number" | "integer" | "boolean" | "array" | "object"
    description: str
    required: bool = True
    enum: list[Any] | None = None
    default: Any = None


# ========================
# Tool 上下文
# ========================

class ToolContext:
    """工具执行上下文（轻量级 dataclass，按需扩展字段）。"""

    def __init__(
        self,
        task_id: str,
        project_id: str | None = None,
        db: Any | None = None,
        task_profile: Any | None = None,
        llm_client: Any | None = None,
        media_service: Any | None = None,
        api_config: Any | None = None,
        global_refs: list[Any] | None = None,
        artifacts: dict | None = None,
        emit: Any | None = None,
        skip_confirm: bool = False,
    ):
        self.task_id = task_id
        self.project_id = project_id
        self.db = db
        self.task_profile = task_profile
        self.llm_client = llm_client
        self.media_service = media_service
        self.api_config = api_config
        self.global_refs = global_refs or []
        # 关键修复：用 `is None` 而不是 `or {}`。`AgentMemory.artifacts` 初始是空 dict，
        # `{} or {}` 会短路为新空 dict，runtime 后续从 self.memory.artifacts 读看不到
        # 工具内对 ctx.artifacts 的写入 → 工具生成的脚本/文本资产对 agent 不可见 →
        # LLM 反复重试同一工具 → max_steps 耗尽 → TASK_FAILED → SSE 关闭。
        # 用 `is None` 保留同一个对象引用，工具写 ctx.artifacts 就是写 memory.artifacts。
        self.artifacts = artifacts if artifacts is not None else {}
        self.emit = emit
        self.skip_confirm = skip_confirm

    def emit_event(self, event_type: str, payload: dict) -> None:
        if self.emit is not None:
            try:
                self.emit(event_type, payload)
            except Exception:
                pass

    async def generate_llm(self, messages: list[dict], **kwargs):
        """Prefer provider SSE and surface text deltas to the Agent event stream."""
        if self.llm_client is None:
            raise RuntimeError("LLM client is not configured")
        streaming = getattr(self.llm_client, "generate_streaming", None)
        if callable(streaming):
            async def emit_delta(text: str):
                self.emit_event("text_delta", {"text": text})
            return await streaming(messages, on_delta=emit_delta, **kwargs)
        return await self.llm_client.generate(messages, **kwargs)


# ========================
# Tool 抽象
# ========================

@runtime_checkable
class Tool(Protocol):
    name: str
    description: str
    category: str
    requires_approval: bool
    parameters: list[ToolParameter]
    estimated_cost_usd: float
    estimated_time_sec: float
    idempotent: bool

    async def validate(self, ctx: ToolContext, params: dict) -> str | None: ...
    async def execute(self, ctx: ToolContext, params: dict) -> dict: ...


# ========================
# 便利基类
# ========================

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


# ========================
# Tool Registry
# ========================

class ToolRegistry:
    def __init__(self):
        self._tools: dict[str, Any] = {}

    def register(self, tool) -> None:
        if not tool.name:
            raise ValueError("Tool.name is required")
        if tool.name in self._tools:
            raise ValueError(f"Tool {tool.name!r} already registered")
        self._tools[tool.name] = tool

    def unregister(self, name: str) -> None:
        self._tools.pop(name, None)

    def get(self, name: str):
        return self._tools.get(name)

    def list(self, category: str | None = None) -> list:
        tools = list(self._tools.values())
        if category:
            tools = [t for t in tools if getattr(t, "category", None) == category]
        return tools

    def categories(self) -> list[str]:
        return sorted({getattr(t, "category", "general") for t in self._tools.values()})

    def to_openai_schema(self) -> list[dict]:
        """转成 OpenAI function calling schema。"""
        out = []
        for t in self._tools.values():
            properties: dict = {}
            required: list[str] = []
            for p in t.parameters:
                prop: dict = {"type": _json_type_to_openai(p.type), "description": p.description}
                if p.enum:
                    prop["enum"] = list(p.enum)
                properties[p.name] = prop
                if p.required:
                    required.append(p.name)
            out.append({
                "type": "function",
                "function": {
                    "name": t.name,
                    "description": t.description,
                    "parameters": {
                        "type": "object",
                        "properties": properties,
                        "required": required,
                    },
                },
            })
        return out


def _json_type_to_openai(t: str) -> str:
    """将 JSON Schema 类型名映射到 OpenAI 支持的类型。"""
    mapping = {
        "str": "string",
        "string": "string",
        "int": "integer",
        "integer": "integer",
        "float": "number",
        "number": "number",
        "bool": "boolean",
        "boolean": "boolean",
        "list": "array",
        "array": "array",
        "dict": "object",
        "object": "object",
    }
    return mapping.get(t, "string")


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
