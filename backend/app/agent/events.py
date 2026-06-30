"""事件系统：AgentEvent + EventBus。

agent 在执行过程中产生事件，通过 EventBus 分发给所有订阅者（SSE 推送、前端 UI 等）。
"""
from __future__ import annotations

import asyncio
import json
import time
from collections import defaultdict
from enum import Enum
from typing import Any


class EventType(str, Enum):
    """agent 事件类型。"""
    TASK_STARTED = "task_started"
    GOAL_PARSED = "goal_parsed"
    THOUGHT = "thought"
    ACTION = "action"
    OBSERVATION = "observation"
    PLAN_READY = "plan_ready"
    PLAN_REVISED = "plan_revised"
    REQUEST_USER_INPUT = "request_user_input"
    USER_INPUT_RECEIVED = "user_input_received"
    ARTIFACT_CREATED = "artifact_created"
    COST_UPDATE = "cost_update"
    TASK_PAUSED = "task_paused"
    TASK_RESUMED = "task_resumed"
    TASK_DONE = "task_done"
    TASK_FAILED = "task_failed"
    STEP_RETRYING = "step_retrying"
    # Spec B: 工具失败恢复
    TOOL_RETRYING = "tool_retrying"
    TOOL_FALLBACK_MODEL = "tool_fallback_model"
    TOOL_ERROR = "tool_error"
    TOOL_RESUMED = "tool_resumed"


class AgentEvent:
    """agent 事件（轻量级 dict-friendly 对象）。"""

    __slots__ = ("task_id", "step_id", "type", "payload", "timestamp")

    def __init__(
        self,
        task_id: str,
        type: str | EventType,
        payload: dict | None = None,
        step_id: str | None = None,
        timestamp: float | None = None,
    ):
        self.task_id = task_id
        self.step_id = step_id
        self.type = type.value if isinstance(type, EventType) else type
        self.payload = payload or {}
        self.timestamp = timestamp if timestamp is not None else time.time()

    def to_dict(self) -> dict:
        return {
            "task_id": self.task_id,
            "step_id": self.step_id,
            "type": self.type,
            "payload": self.payload,
            "timestamp": self.timestamp,
        }

    def to_json(self) -> str:
        return json.dumps(self.to_dict(), ensure_ascii=False)

    def to_sse(self, event_id: int | None = None) -> str:
        """转成 SSE 协议字符串。"""
        lines = [f"event: {self.type}", f"data: {self.to_json()}"]
        if event_id is not None:
            lines.insert(0, f"id: {event_id}")
        return "\n".join(lines) + "\n\n"

    def __repr__(self) -> str:
        return f"AgentEvent(type={self.type!r}, task_id={self.task_id!r})"


class EventBus:
    """事件总线：按 task_id 路由事件。"""

    def __init__(self):
        self._subscribers: dict[str, list[asyncio.Queue]] = defaultdict(list)

    def subscribe(self, task_id: str) -> asyncio.Queue:
        q: asyncio.Queue = asyncio.Queue()
        self._subscribers[task_id].append(q)
        return q

    def unsubscribe(self, task_id: str, queue: asyncio.Queue) -> None:
        if task_id in self._subscribers:
            try:
                self._subscribers[task_id].remove(queue)
            except ValueError:
                pass
            if not self._subscribers[task_id]:
                del self._subscribers[task_id]

    async def publish(self, event: AgentEvent) -> None:
        queues = self._subscribers.get(event.task_id, [])
        for q in queues:
            await q.put(event)

    def subscriber_count(self, task_id: str) -> int:
        return len(self._subscribers.get(task_id, []))


# 全局单例
event_bus = EventBus()
