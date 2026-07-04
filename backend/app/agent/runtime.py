"""AgentRuntime：ReAct 主循环。

单步执行流程：
1. think() —— 让 LLM 决定下一步
2. parse_decision() —— 解析 LLM 输出
3. execute_action() —— 执行工具 / 处理 finish_task
4. add_step() —— 记录到 memory
5. emit event —— 通知订阅者
"""
from __future__ import annotations

import asyncio
import json
import re
from enum import Enum
from typing import Any

from .events import AgentEvent, EventType, event_bus
from .llm import build_react_prompt
from .memory import AgentMemory
from .tools.base import (
    BaseTool,
    NonRetryableError,
    RetryableError,
    RetryableTool,
    ToolContext,
    ToolRegistry,
    ToolValidationError,
)


class AgentState(str, Enum):
    PENDING = "pending"
    RUNNING = "running"
    PAUSED = "paused"
    DONE = "done"
    FAILED = "failed"


def parse_decision(raw: str) -> dict:
    """从 LLM 文本输出中解析决策 JSON。处理 markdown 代码块。"""
    text = raw.strip()
    # 去掉 markdown 代码块
    fence_match = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", text, re.DOTALL)
    if fence_match:
        text = fence_match.group(1)
    try:
        return json.loads(text)
    except json.JSONDecodeError as e:
        raise ValueError(f"Invalid decision JSON: {e}\n{text[:200]}")


# ========================
# AgentRuntime
# ========================

class AgentRuntime:
    """ReAct 主循环。"""

    DEFAULT_MAX_STEPS = 30

    def __init__(
        self,
        task_id: str,
        llm: Any,
        memory: AgentMemory,
        registry: ToolRegistry | None = None,
        project_id: str | None = None,
        db: Any | None = None,
        api_config: Any | None = None,
        max_steps: int = DEFAULT_MAX_STEPS,
        skip_confirm: bool = False,
        pending_request: dict | None = None,
    ):
        self.task_id = task_id
        self.llm = llm
        self.memory = memory
        self.registry = registry or ToolRegistry()
        self.project_id = project_id
        self.db = db
        self.api_config = api_config
        self.max_steps = max_steps
        self.skip_confirm = skip_confirm
        self.pending_request = pending_request
        self.state = AgentState.PENDING
        self._step_count = 0

    # ---------------- 主循环 ----------------

    async def step(self) -> bool:
        """执行一个 ReAct 步。返回 True 表示任务完成。"""
        if self.state == AgentState.DONE:
            return True
        if self.state == AgentState.PAUSED:
            return False

        self.state = AgentState.RUNNING
        self._step_count += 1

        if self._step_count > self.max_steps:
            await self._emit(EventType.TASK_FAILED, {"error": f"超过最大步数 {self.max_steps}"})
            self.state = AgentState.DONE
            return True

        # 1. think
        messages = self._build_messages()
        response = await self.llm.generate(messages)

        if response.tool_name is None:
            # LLM 没调用工具，按 content 解析为决策
            if not response.content:
                await self._add_failed_step("LLM returned empty response", {})
                return False
            try:
                decision = parse_decision(response.content)
            except ValueError as e:
                await self._add_failed_step(str(e), {})
                return False
            thought = decision.get("thought", "")
            action = decision.get("action", {})
        else:
            thought = "(structured tool call)"
            action = {"tool": response.tool_name, "params": response.tool_args or {}}

        await self._emit(EventType.THOUGHT, {"text": thought, "step": self._step_count})

        # 2. 决策：finish_task / 调工具 / ask_user
        tool_name = action.get("tool", "")
        if tool_name == "finish_task":
            # 记录 finish_task 这一步到 memory（与正常 tool 步骤一致，便于持久化）
            self.memory.add_step(
                step_number=self._step_count,
                thought=thought,
                action=action,
                observation={"summary": action.get("params", {})},
                status="success",
                cost_usd=response.cost_usd,
                tokens=response.total_tokens,
            )
            await self._emit(EventType.TASK_DONE, {"summary": action.get("params", {})})
            self.state = AgentState.DONE
            return True

        if tool_name == "ask_user":
            # 暂停等待用户输入
            self.pending_request = {
                "type": "ask_user",
                "question": action.get("params", {}).get("question", ""),
                "options": action.get("params", {}).get("options", []),
            }
            await self._emit(EventType.REQUEST_USER_INPUT, self.pending_request)
            self.state = AgentState.PAUSED
            self.memory.add_step(
                step_number=self._step_count,
                thought=thought,
                action=action,
                observation={"pending": "awaiting_user_input"},
                status="pending",
                cost_usd=response.cost_usd,
                tokens=response.total_tokens,
            )
            return False

        # 3. 执行工具
        await self._emit(EventType.ACTION, {
            "tool": tool_name,
            "params": action.get("params", {}),
            "step": self._step_count,
            "requires_approval": self._requires_approval(tool_name),
        })

        observation, status = await self._execute_tool(tool_name, action.get("params", {}))

        # 4. 记录 step
        self.memory.add_step(
            step_number=self._step_count,
            thought=thought,
            action=action,
            observation=observation,
            status=status,
            cost_usd=response.cost_usd,
            tokens=response.total_tokens,
        )

        # 5. 通知
        await self._emit(EventType.OBSERVATION, {
            "step": self._step_count,
            "success": status == "success",
            "result": observation.get("result") if status == "success" else None,
            "error": observation.get("error"),
        })

        # bridge: create_plan → memory.plan
        if tool_name == "create_plan" and isinstance(observation, dict) and isinstance(observation.get("result"), list):
            self.memory.plan = observation["result"]

        return False

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

    # ---------------- 辅助 ----------------

    def _build_messages(self) -> list[dict]:
        """构造发给 LLM 的消息列表。"""
        tool_summaries = [
            {"name": t.name, "description": t.description}
            for t in self.registry.list()
        ]
        recent = [
            {
                "step_number": s.step_number,
                "thought": s.thought,
                "action": s.action,
                "status": s.status,
            }
            for s in self.memory.recent_steps(10)
        ]
        prompt = build_react_prompt(
            user_goal=self.memory.user_goal,
            plan=self.memory.plan,
            artifacts=self.memory.artifacts,
            recent_steps=recent,
            tool_summaries=tool_summaries,
        )
        return [
            {"role": "system", "content": prompt},
        ]

    def _requires_approval(self, tool_name: str) -> bool:
        tool = self.registry.get(tool_name)
        if not tool:
            return False
        return getattr(tool, "requires_approval", False)

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
            # 与 retry/change_model 一致：仅记录 step 并返回 False，
            # 由调用方决定何时再次推进 step()
            return False

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

    async def _add_failed_step(self, error: str, action: dict) -> None:
        self.memory.add_step(
            step_number=self._step_count,
            thought="",
            action=action,
            observation={"error": error},
            status="failed",
        )

    async def _emit(self, event_type: str, payload: dict) -> None:
        event = AgentEvent(
            task_id=self.task_id,
            step_id=str(self._step_count),
            type=event_type,
            payload=payload,
        )
        await event_bus.publish(event)

    def _emit_sync(self, event_type: str, payload: dict) -> None:
        """ToolContext.emit 的同步包装。"""
        try:
            loop = asyncio.get_running_loop()
        except RuntimeError:
            return
        loop.create_task(self._emit(event_type, payload))
