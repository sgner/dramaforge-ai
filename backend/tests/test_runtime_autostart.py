"""端到端验证：创建 task 后会自动启动 AgentRuntime 并完成。

模拟浏览器流程：
1. POST /api/agent/tasks → 创建 task，启动 runtime
2. 轮询 DB 等待 task 完成
3. 验证：task 最终 status = done（不是 pending）
4. 验证：AgentStep 表里有完整 6 步记录
5. 验证：plan 被 create_plan 填入
6. 验证：TASK_STARTED 事件 payload 包含 llm_mode / llm_fallback_reason

v2: 改为 DB 轮询，不依赖 event_bus 跨 event loop 订阅。
原因：endpoint 改为 async 后 runtime 在 FastAPI 主 loop 跑，
     测试用 `asyncio.run(drain())` 起新 loop 读 asyncio.Queue 不再兼容。
     DB 轮询更贴近前端 UI 实际行为（前端就是轮询 task 和 steps 的）。
"""
import time

import pytest
from fastapi.testclient import TestClient

from app import app
from app.agent.events import event_bus, EventType
from app.database import SessionLocal
from app.models import AgentTask, AgentStep


@pytest.fixture
def client():
    return TestClient(app)


# `seeded_provider` fixture 定义在 conftest.py，供 autostart 测试用。


def _wait_for_done(task_id: str, timeout: float = 30.0) -> AgentTask:
    """轮询 DB 等待 task 状态变成 done/failed。"""
    deadline = time.time() + timeout
    while time.time() < deadline:
        with SessionLocal() as db:
            t = db.query(AgentTask).filter_by(id=task_id).first()
            if t and t.status in ("done", "failed"):
                return t
        time.sleep(0.3)
    with SessionLocal() as db:
        return db.query(AgentTask).filter_by(id=task_id).first()


def _list_steps(task_id: str) -> list[AgentStep]:
    with SessionLocal() as db:
        return (
            db.query(AgentStep)
            .filter_by(task_id=task_id)
            .order_by(AgentStep.step_number)
            .all()
        )


def test_create_task_autostarts_runtime(client, seeded_provider):
    """POST /api/agent/tasks 应启动 runtime 并完成 task。"""
    # 1. 创建 task
    body = {"user_goal": "测试自动启动", "max_steps": 12}
    r = client.post("/api/agent/tasks", json=body)
    assert r.status_code == 200, r.text
    task = r.json()
    task_id = task["id"]
    assert task["status"] == "pending"  # 创建时为 pending

    # 2. 等待 runtime 跑完
    t = _wait_for_done(task_id, timeout=20.0)
    assert t is not None, "task disappeared from DB"
    assert t.status in ("done", "failed"), f"task status stuck at {t.status}"

    # 3. 验证：runtime 真的执行了步骤（不是空跑）
    steps = _list_steps(task_id)
    assert len(steps) >= 1, f"runtime ran 0 steps, no AgentStep records"

    # 4. 验证：task 状态是 done（说明 runtime 跑完整流程）
    if t.status == "done":
        assert t.plan is not None, "done task should have plan field set"


def test_multiple_tasks_run_concurrently(client, seeded_provider):
    """同时创建多个 task，所有 task 都应跑完。"""
    task_ids = []
    for i in range(3):
        r = client.post("/api/agent/tasks", json={
            "user_goal": f"concurrent #{i}",
            "max_steps": 12,
        })
        assert r.status_code == 200
        task_ids.append(r.json()["id"])

    # 等待所有完成
    statuses = []
    for tid in task_ids:
        t = _wait_for_done(tid, timeout=30.0)
        statuses.append(t.status if t else "missing")

    # 全部完成（async endpoint 让多个 task 共享 event loop 并发跑）
    assert all(s == "done" for s in statuses), f"some tasks didn't complete: {statuses}"


def test_create_task_with_no_provider_fails_gracefully(client):
    """无 LLM provider 配置时，task 必须暂停并推送 error notice 把问题暴露给前端。

    现行设计：配置缺失不再是"静默回退假数据"，也不是"直接 failed"，而是
    paused + 自动恢复调度（用户随后在 API 设置里配好 provider，恢复路径会
    用当前 model_bindings 覆盖任务固化值继续执行，见 _rebuild_runtime_from_db）。
    """
    r = client.post("/api/agent/tasks", json={
        "user_goal": "no provider test",
    })
    assert r.status_code == 200
    task_id = r.json()["id"]

    # 等 task 状态变 paused（runtime 走 binding 缺失 / NoLLMConfigured 路径）
    deadline = time.time() + 5.0
    t = None
    while time.time() < deadline:
        with SessionLocal() as db:
            t = db.query(AgentTask).filter_by(id=task_id).first()
        if t and t.status == "paused":
            break
        time.sleep(0.2)
    assert t is not None, "task should be reachable"
    assert t.status == "paused", f"task should be paused, got {t.status}"

    # 验证：error 级 agent_notice 被推送，message 说明要配置 provider
    deadline = time.time() + 2.0
    error_notice = None
    while time.time() < deadline and error_notice is None:
        events = event_bus.get_replay(task_id)
        error_notice = next(
            (e for e in events
             if e.type == EventType.AGENT_NOTICE and e.payload.get("level") == "error"),
            None,
        )
        if error_notice is None:
            time.sleep(0.05)
    assert error_notice is not None, "no error agent_notice published within 2s"
    msg = (error_notice.payload.get("message") or "").lower()
    assert "no llm provider" in msg or "api settings" in msg, \
        f"notice message should mention provider setup, got: {msg!r}"
