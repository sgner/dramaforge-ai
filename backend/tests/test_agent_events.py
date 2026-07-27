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
    assert EventType.ASSET_INSPECTION_STARTED == "asset_inspection_started"
    assert EventType.ASSET_INSPECTION_FINISHED == "asset_inspection_finished"
    assert EventType.ASSET_NORMALIZATION_STARTED == "asset_normalization_started"


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


class TestToolFailureRecoveryEvents:
    """Spec B: 工具失败恢复相关事件类型。"""

    def test_tool_retrying_event_type_exists(self):
        """TOOL_RETRYING 事件类型存在。"""
        assert EventType.TOOL_RETRYING.value == "tool_retrying"

    def test_tool_fallback_model_event_type_exists(self):
        """TOOL_FALLBACK_MODEL 事件类型存在。"""
        assert EventType.TOOL_FALLBACK_MODEL.value == "tool_fallback_model"

    def test_tool_error_event_type_exists(self):
        """TOOL_ERROR 事件类型存在。"""
        assert EventType.TOOL_ERROR.value == "tool_error"

    def test_tool_resumed_event_type_exists(self):
        """TOOL_RESUMED 事件类型存在。"""
        assert EventType.TOOL_RESUMED.value == "tool_resumed"

    def test_tool_error_event_sse_format(self):
        """tool_error 事件转 SSE 格式正确。"""
        event = AgentEvent(
            task_id="t1",
            type=EventType.TOOL_ERROR,
            payload={"tool": "generate_image", "error": "timeout", "step_id": "3"},
        )
        sse = event.to_sse()
        assert "event: tool_error" in sse
        assert '"tool": "generate_image"' in sse

    def test_tool_resumed_event_sse_format(self):
        """tool_resumed 事件转 SSE 格式正确。"""
        event = AgentEvent(
            task_id="t1",
            type=EventType.TOOL_RESUMED,
            payload={"step_id": "3", "action": "retry"},
        )
        sse = event.to_sse()
        assert "event: tool_resumed" in sse
        assert '"action": "retry"' in sse


# ========================
# 事件序号（阶段 2.2：续传/去重/缺页检测）
# ========================

@pytest.mark.asyncio
async def test_publish_assigns_monotonic_seq_per_task():
    from app.agent.events import EventBus, AgentEvent
    bus = EventBus()
    await bus.publish(AgentEvent(task_id="t1", type="thought"))
    await bus.publish(AgentEvent(task_id="t1", type="action"))
    await bus.publish(AgentEvent(task_id="t2", type="thought"))
    log1 = bus.get_replay("t1")
    log2 = bus.get_replay("t2")
    assert [e.seq for e in log1] == [1, 2]
    assert [e.seq for e in log2] == [1]
    # to_dict 带 seq
    assert log1[0].to_dict()["seq"] == 1


@pytest.mark.asyncio
async def test_get_replay_after_seq_returns_only_newer():
    from app.agent.events import EventBus, AgentEvent
    bus = EventBus()
    for _ in range(4):
        await bus.publish(AgentEvent(task_id="t1", type="thought"))
    replay = bus.get_replay("t1", after_seq=2)
    assert [e.seq for e in replay] == [3, 4]
    # after_seq=0 = 全量（默认行为）
    assert len(bus.get_replay("t1")) == 4


@pytest.mark.asyncio
async def test_clear_log_resets_seq():
    from app.agent.events import EventBus, AgentEvent
    bus = EventBus()
    await bus.publish(AgentEvent(task_id="t1", type="thought"))
    bus.clear_log("t1")
    await bus.publish(AgentEvent(task_id="t1", type="thought"))
    assert bus.get_replay("t1")[0].seq == 1


@pytest.mark.asyncio
async def test_fifo_overflow_keeps_seq_for_gap_detection():
    from app.agent.events import EventBus, AgentEvent
    bus = EventBus()
    bus.MAX_LOG_PER_TASK = 3
    for _ in range(5):
        await bus.publish(AgentEvent(task_id="t1", type="thought"))
    log = bus.get_replay("t1")
    # 最早的 2 条被丢弃，但序号保留 → 前端可发现 1/2 缺页
    assert [e.seq for e in log] == [3, 4, 5]


@pytest.mark.asyncio
async def test_stream_resumes_from_last_seq():
    """?last_seq=N 续传：只补断线后的事件，SSE id 为事件序号，终态后关流。"""
    from fastapi.testclient import TestClient
    from app import app
    from app.agent.events import event_bus, AgentEvent, EventType

    task_id = "t-seq-resume"
    event_bus.clear_log(task_id)
    for i in range(3):
        await event_bus.publish(AgentEvent(task_id=task_id, type="thought", payload={"i": i}))
    await event_bus.publish(AgentEvent(task_id=task_id, type=EventType.TASK_DONE, payload={}))

    client = TestClient(app)
    # 全量重放
    full = client.get(f"/api/agent/tasks/{task_id}/stream")
    assert "id: 1" in full.text
    assert "id: 4" in full.text
    # 续传：只补 seq > 2 的事件
    resumed = client.get(f"/api/agent/tasks/{task_id}/stream?last_seq=2")
    assert "id: 1" not in resumed.text
    assert "id: 2" not in resumed.text
    assert "id: 3" in resumed.text
    assert "id: 4" in resumed.text
    event_bus.clear_log(task_id)


@pytest.mark.asyncio
async def test_stream_resumes_from_last_event_id_header():
    """Last-Event-ID 头（EventSource 自动重连）与 ?last_seq= 等效。"""
    from fastapi.testclient import TestClient
    from app import app
    from app.agent.events import event_bus, AgentEvent, EventType

    task_id = "t-seq-header"
    event_bus.clear_log(task_id)
    for i in range(3):
        await event_bus.publish(AgentEvent(task_id=task_id, type="thought", payload={"i": i}))
    await event_bus.publish(AgentEvent(task_id=task_id, type=EventType.TASK_DONE, payload={}))

    client = TestClient(app)
    resumed = client.get(
        f"/api/agent/tasks/{task_id}/stream",
        headers={"Last-Event-ID": "3"},
    )
    assert "id: 3" not in resumed.text
    assert "id: 4" in resumed.text
    event_bus.clear_log(task_id)
