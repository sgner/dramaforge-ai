"""回归测试：SSE 端点必须能补发历史事件给晚到的订阅者。

症状：前端 SSE 显示"0 thoughts, 0 actions"，
      但后端 AgentStep 表里有完整 step 记录。

根因：create_task 返回后，asyncio.create_task(_spawn_runtime) 立即调度 runtime；
     runtime 第一时间 emit TASK_STARTED / THOUGHT 等事件时，SSE stream 端点
     还没收到 GET 请求、event_bus 还没有 subscriber，
     早期事件全部进 void queue。

修复：event_bus 维护 per-task event log；subscribe 时 stream 端点先把
     log 全部重放给新客户端，再切到 live。
"""
import asyncio
import time

import pytest
from fastapi.testclient import TestClient

from app import app
from app.agent.events import event_bus, EventType
from app.agent.dev_scripted_llm import DevScriptedLLM
from app.agent.runtime import AgentRuntime
from app.agent.memory import AgentMemory
from app.agent.tools import build_default_registry
from app.agent.media_service import StubMediaService


@pytest.fixture
def client():
    return TestClient(app)


def _build_runtime(task_id: str, user_goal: str = "replay test") -> AgentRuntime:
    """构造与 _spawn_runtime 一样的 runtime 实例。"""
    llm = DevScriptedLLM(user_goal=user_goal)
    memory = AgentMemory(user_goal=user_goal)
    registry = build_default_registry()
    media = StubMediaService()
    for tool in registry.list():
        if tool.category in ("image", "video", "audio"):
            try:
                tool._media_service = media
            except Exception:
                pass
    return AgentRuntime(
        task_id=task_id,
        llm=llm,
        memory=memory,
        registry=registry,
        max_steps=10,
        skip_confirm=True,
    )


def test_event_bus_get_replay_returns_past_events():
    """EventBus.get_replay 必须返回 publish 过的全部事件。"""
    bus = eventBus = event_bus  # use global singleton
    task_id = f"replay-unit-{id(bus)}"

    # 清空可能残留的旧日志
    bus.clear_log(task_id)

    # 模拟 runtime 早期 emit
    async def emit_some():
        from app.agent.events import AgentEvent
        await bus.publish(AgentEvent(task_id=task_id, type=EventType.TASK_STARTED, payload={"task_id": task_id}))
        await bus.publish(AgentEvent(task_id=task_id, type=EventType.THOUGHT, payload={"text": "thought-1"}))
        await bus.publish(AgentEvent(task_id=task_id, type=EventType.ACTION, payload={"tool": "create_plan"}))
        await bus.publish(AgentEvent(task_id=task_id, type=EventType.OBSERVATION, payload={"result": {"ok": True}}))
        await bus.publish(AgentEvent(task_id=task_id, type=EventType.TASK_DONE, payload={"summary": "ok"}))

    asyncio.run(emit_some())

    replay = bus.get_replay(task_id)
    assert len(replay) == 5, f"expected 5 replay events, got {len(replay)}"
    assert [e.type for e in replay] == [
        EventType.TASK_STARTED,
        EventType.THOUGHT,
        EventType.ACTION,
        EventType.OBSERVATION,
        EventType.TASK_DONE,
    ]

    # 清理
    bus.clear_log(task_id)


def test_event_bus_publish_appends_to_log_and_fanout():
    """publish 必须同时写日志和 fan-out 给 subscribers。"""
    bus = event_bus
    task_id = f"replay-fanout-{id(bus)}"
    bus.clear_log(task_id)

    q = bus.subscribe(task_id)

    async def run():
        from app.agent.events import AgentEvent
        await bus.publish(AgentEvent(task_id=task_id, type=EventType.THOUGHT, payload={"text": "live"}))

    asyncio.run(run())

    # subscriber 收到了
    received = asyncio.run(q.get())
    assert received.type == EventType.THOUGHT
    # log 也有
    replay = bus.get_replay(task_id)
    assert len(replay) == 1
    assert replay[0].type == EventType.THOUGHT

    bus.unsubscribe(task_id, q)
    bus.clear_log(task_id)


def test_stream_endpoint_replays_history_to_subscriber():
    """核心修复验证：runtime 早期 emit 的事件，必须被后打开的 SSE 端点补发给客户端。

    模拟用户场景：runtime 已经 emit TASK_STARTED + THOUGHT + ACTION + OBSERVATION 后
                 才打开 SSE，客户端应能收到全部 4 个历史事件。

    实现：直接调用 stream_events() 返回的 StreamingResponse，提取 event_generator，
         收集所有 yield 的 SSE chunk。这样不依赖 TestClient 的长连接，
         不会卡在 live event 循环上。
    """
    task_id = f"replay-stream-{int(time.time() * 1000)}"
    event_bus.clear_log(task_id)

    from app.agent.events import AgentEvent

    async def emit_history():
        await event_bus.publish(AgentEvent(
            task_id=task_id, type=EventType.TASK_STARTED, payload={"task_id": task_id}
        ))
        await event_bus.publish(AgentEvent(
            task_id=task_id, type=EventType.THOUGHT, payload={"text": "history-thought"}
        ))
        await event_bus.publish(AgentEvent(
            task_id=task_id, type=EventType.ACTION, payload={"tool": "create_plan", "params": {}}
        ))
        await event_bus.publish(AgentEvent(
            task_id=task_id, type=EventType.OBSERVATION, payload={"result": {"ok": True}}
        ))

    asyncio.run(emit_history())

    # 直接调用 stream_events 拿 StreamingResponse，body_iterator 是 event_generator
    from app.routers.agent import stream_events

    async def collect_replay():
        # stream_events 是 async 函数，必须先 await 拿 StreamingResponse
        resp = await stream_events(task_id)
        # StreamingResponse 的 body_iterator 暴露内部 generator
        gen = resp.body_iterator
        chunks = []
        # 只收集前 4 个 chunk（每个 event 一个 chunk），不等 live loop
        async for chunk in gen:
            chunks.append(chunk)
            # 收到 observation 后停止（4 个 history event 之后是 live loop 阻塞）
            if len(chunks) >= 4:
                # 取消 generator，避免它在 live loop 阻塞
                await gen.aclose()
                break
        return chunks

    chunks = asyncio.run(collect_replay())

    # 解析每个 chunk 中的 event 类型
    collected_types = []
    for chunk in chunks:
        for line in chunk.split("\n"):
            if line.startswith("event:"):
                collected_types.append(line.split(":", 1)[1].strip())
                break

    # 4 个历史事件应按原顺序补发
    assert collected_types == [
        "task_started",
        "thought",
        "action",
        "observation",
    ], f"SSE replay mismatch, got {collected_types}"

    event_bus.clear_log(task_id)


def test_stream_endpoint_returns_replay_for_already_done_task():
    """SSE 端点必须能为已完成的 task 返回完整历史（用户事后打开页面）。

    实现：直接调用 stream_events()，从 body_iterator 拉取所有 chunk，
         看到 task_done 后退出。流式端点应在 replay 完最后一个 event
         （task_done）后调用 return 关闭流，不会卡在 live loop。
    """
    task_id = f"replay-already-done-{int(time.time() * 1000)}"
    event_bus.clear_log(task_id)

    from app.agent.events import AgentEvent

    async def emit_full_history():
        await event_bus.publish(AgentEvent(task_id=task_id, type=EventType.TASK_STARTED, payload={"task_id": task_id}))
        await event_bus.publish(AgentEvent(task_id=task_id, type=EventType.THOUGHT, payload={"text": "a"}))
        await event_bus.publish(AgentEvent(task_id=task_id, type=EventType.THOUGHT, payload={"text": "b"}))
        await event_bus.publish(AgentEvent(task_id=task_id, type=EventType.TASK_DONE, payload={"summary": "x"}))

    asyncio.run(emit_full_history())

    from app.routers.agent import stream_events

    async def collect_all():
        # stream_events 是 async 函数，必须先 await 拿 StreamingResponse
        resp = await stream_events(task_id)
        chunks = []
        async for chunk in resp.body_iterator:
            chunks.append(chunk)
        return chunks

    chunks = asyncio.run(collect_all())

    # 解析 event types
    seen = []
    for chunk in chunks:
        for line in chunk.split("\n"):
            if line.startswith("event:"):
                seen.append(line.split(":", 1)[1].strip())
                break

    # 修复后，stream 端点遇到 task_done 应 return，不再 yield 任何东西；
    # 我们应能拿到完整 4 个历史事件
    assert seen == ["task_started", "thought", "thought", "task_done"], (
        f"replay should return full history in order, got {seen}"
    )

    event_bus.clear_log(task_id)
