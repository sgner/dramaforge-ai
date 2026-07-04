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
    """事件总线：按 task_id 路由事件。

    维护 per-task 事件日志：所有 publish 的事件都先 append 到日志，再 fan-out 给 subscribers。
    新 subscriber 调用 get_replay(task_id) 即可拿到该 task 的全部历史事件，
    用于解决"runtime 启动与 SSE subscribe 之间的竞态丢失"问题。

    日志清理：调用 clear_log(task_id) 释放内存（例如 task 终态后一段时间）。
    """

    # 单个 task 的事件日志上限（防止内存泄漏）。LMM 长 task 大约 emit 几十~上百条，
    # 设 5000 足够任何常规任务。
    MAX_LOG_PER_TASK = 5000

    def __init__(self):
        self._subscribers: dict[str, list[asyncio.Queue]] = defaultdict(list)
        self._event_log: dict[str, list[AgentEvent]] = defaultdict(list)

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
        # 1. 写入 per-task 日志（供 late subscriber 重放）
        log = self._event_log[event.task_id]
        log.append(event)
        if len(log) > self.MAX_LOG_PER_TASK:
            # 超过上限：丢弃最早的事件（FIFO）。对前端 UI 来说，最新事件最重要。
            del log[: len(log) - self.MAX_LOG_PER_TASK]

        # 2. Fan-out 给当前所有 subscriber
        queues = self._subscribers.get(event.task_id, [])
        for q in queues:
            await q.put(event)

    def get_replay(self, task_id: str) -> list[AgentEvent]:
        """返回该 task 目前为止发布过的全部事件（不修改 subscribers）。

        新 SSE subscriber 在创建 queue 之后、开始 await queue.get() 之前，
        应先调用本方法把历史事件一次性 yield 给客户端，
        再 await queue.get() 接收 live 事件——这样无论客户端何时打开 SSE
        都能看到完整流程，不会出现"既无想法也无动作"的空白。
        """
        return list(self._event_log.get(task_id, []))

    def clear_log(self, task_id: str) -> None:
        """清空某 task 的事件日志（task 终态后回收内存）。"""
        self._event_log.pop(task_id, None)

    def subscriber_count(self, task_id: str) -> int:
        return len(self._subscribers.get(task_id, []))


# 全局单例
event_bus = EventBus()
