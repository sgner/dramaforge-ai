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


def test_create_task_autostarts_runtime(client):
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
    tool_names = [s.action.get("tool") for s in steps]
    assert any(n == "create_plan" for n in tool_names), f"no create_plan step: {tool_names}"

    # 4. 验证：plan 被 create_plan 填入
    if t.status == "done":
        assert t.plan, "done task should have plan"
        assert isinstance(t.plan, list)


def test_multiple_tasks_run_concurrently(client):
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


def test_dev_scripted_llm_runs_full_six_step_flow(client):
    """端到端：DevScriptedLLM 驱动 runtime 跑完 6 步且全部 success。

    6 步：
        create_plan → generate_script → extract_characters
        → extract_scenes → extract_shots → finish_task
    """
    body = {"user_goal": "完整 5 步流程测试", "max_steps": 12}
    r = client.post("/api/agent/tasks", json=body)
    assert r.status_code == 200, r.text
    task_id = r.json()["id"]

    # 等待 runtime 跑完
    t = _wait_for_done(task_id, timeout=30.0)
    assert t is not None
    assert t.status == "done", f"task should be done, got {t.status}"

    # 验证：6 个 step 全部 success
    steps = _list_steps(task_id)
    tool_names = [s.action.get("tool") for s in steps]
    assert len(steps) == 6, (
        f"expected 6 steps, got {len(steps)}: {tool_names}"
    )
    assert tool_names == [
        "create_plan",
        "generate_script",
        "extract_characters",
        "extract_scenes",
        "extract_shots",
        "finish_task",
    ], f"unexpected tool sequence: {tool_names}"

    for i, s in enumerate(steps):
        assert s.status == "success", (
            f"step {i} ({tool_names[i]}) status={s.status}, "
            f"observation={s.observation}"
        )


def test_spawn_runtime_uses_stub_when_no_env(monkeypatch, client):
    """env 没配时，task_started payload.llm_mode 应为 'stub'，reason 不为 None。"""
    # 清空 LLM 相关 env
    for k in ("LLM_API_KEY", "LLM_BASE_URL", "LLM_MODEL", "LLM_PROVIDERS_JSON"):
        monkeypatch.delenv(k, raising=False)

    r = client.post("/api/agent/tasks", json={
        "user_goal": "fallback test",
        "llm_provider_id": "openai",  # 显式请求真实，但 env 没配
    })
    assert r.status_code == 200
    task_id = r.json()["id"]

    # 通过 event_bus.get_replay 读 TASK_STARTED 事件
    # _spawn_runtime 走 async task，可能晚于 _wait_for_done 准备好；最多等 2s
    started = None
    deadline = time.time() + 2.0
    while time.time() < deadline and started is None:
        events = event_bus.get_replay(task_id)
        started = next((e for e in events if e.type == EventType.TASK_STARTED), None)
        if started is None:
            time.sleep(0.05)

    assert started is not None, "no TASK_STARTED event published within 2s"
    payload = started.payload
    assert payload.get("llm_mode") == "stub", f"expected stub, got {payload.get('llm_mode')}"
    assert payload.get("llm_fallback_reason") is not None, "fallback_reason should be set"
    assert "openai" in payload.get("llm_fallback_reason", "").lower() or "no LLM" in payload.get("llm_fallback_reason", "")
