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
        self.llm_client = llm_client
        self.media_service = media_service
        self.api_config = api_config
        self.global_refs = global_refs or []
        self.artifacts = artifacts or {}
        self.emit = emit
        self.skip_confirm = skip_confirm

    def emit_event(self, event_type: str, payload: dict) -> None:
        if self.emit is not None:
            try:
                self.emit(event_type, payload)
            except Exception:
                pass


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
