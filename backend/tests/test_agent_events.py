"""EventBus + AgentEvent 测试。"""
import asyncio
import json
import pytest
import time

from app.agent.events import AgentEvent, EventBus, EventType


# ========================
# AgentEvent 测试
# ========================

def test_event_serializes_to_json():
    """事件能序列化为 JSON。"""
    e = AgentEvent(
        task_id="task_1",
        step_id="step_1",
        type=EventType.THOUGHT,
        payload={"text": "我先做角色设计"},
        timestamp=1234567890.0,
    )
    j = e.to_json()
    data = json.loads(j)
    assert data["task_id"] == "task_1"
    assert data["type"] == "thought"
    assert data["payload"]["text"] == "我先做角色设计"


def test_event_sse_format():
    """事件能转成 SSE 字符串。"""
    e = AgentEvent(
        task_id="t1", type=EventType.THOUGHT, payload={"x": 1}, timestamp=1.0,
    )
    sse = e.to_sse()
    assert sse.startswith("event: thought\n")
    assert "data: " in sse
    assert sse.endswith("\n\n")


def test_event_type_values():
    """事件类型枚举有所有需要的值。"""
    assert EventType.THOUGHT == "thought"
    assert EventType.ACTION == "action"
    assert EventType.OBSERVATION == "observation"
    assert EventType.PLAN_READY == "plan_ready"
    assert EventType.REQUEST_USER_INPUT == "request_user_input"
    assert EventType.ARTIFACT_CREATED == "artifact_created"
    assert EventType.TASK_DONE == "task_done"
    assert EventType.TASK_FAILED == "task_failed"


# ========================
# EventBus 测试
# ========================

def test_eventbus_subscribe_returns_queue():
    """订阅返回 asyncio.Queue。"""
    bus = EventBus()
    q = bus.subscribe("task_1")
    assert isinstance(q, asyncio.Queue)
    bus.unsubscribe("task_1", q)


def test_eventbus_publish_to_subscriber():
    """发布事件能传到订阅者。"""
    bus = EventBus()
    q = bus.subscribe("task_1")
    e = AgentEvent(task_id="task_1", type=EventType.THOUGHT, payload={"x": 1}, timestamp=1.0)
    asyncio.run(bus.publish(e))
    received = asyncio.run(q.get())
    assert received.type == "thought"
    bus.unsubscribe("task_1", q)


def test_eventbus_only_delivers_to_matching_task():
    """事件只发给同 task_id 的订阅者。"""
    bus = EventBus()
    q1 = bus.subscribe("task_1")
    q2 = bus.subscribe("task_2")
    e = AgentEvent(task_id="task_1", type=EventType.THOUGHT, payload={}, timestamp=1.0)
    asyncio.run(bus.publish(e))
    # q1 收到
    assert asyncio.run(q1.get()).type == "thought"
    # q2 没收到（q2 应该是空的）
    assert q2.empty()
    bus.unsubscribe("task_1", q1)
    bus.unsubscribe("task_2", q2)


def test_eventbus_multiple_subscribers_same_task():
    """同 task 多个订阅者都收到。"""
    bus = EventBus()
    q1 = bus.subscribe("task_1")
    q2 = bus.subscribe("task_1")
    e = AgentEvent(task_id="task_1", type=EventType.THOUGHT, payload={}, timestamp=1.0)
    asyncio.run(bus.publish(e))
    asyncio.run(q1.get())
    asyncio.run(q2.get())
    bus.unsubscribe("task_1", q1)
    bus.unsubscribe("task_1", q2)


def test_eventbus_unsubscribe_stops_delivery():
    """取消订阅后不再收到。"""
    bus = EventBus()
    q = bus.subscribe("task_1")
    bus.unsubscribe("task_1", q)
    e = AgentEvent(task_id="task_1", type=EventType.THOUGHT, payload={}, timestamp=1.0)
    asyncio.run(bus.publish(e))
    assert q.empty()
