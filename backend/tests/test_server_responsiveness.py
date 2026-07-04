"""测试：创建 task 不应阻塞服务器。

背景：`create_task` 端点如果是同步函数，FastAPI 把它跑在 threadpool 里。
当 endpoint 用 `threading.Thread(daemon=True).start()` 起新线程跑
`asyncio.run(_spawn_runtime(...))` 时，每发一次 POST 就占一个线程跑完整 agent。
SQLite 多线程写有锁竞争，线程长时间等待 → 线程池耗尽 → 任何新请求都挂死。

修复：将 `create_task` 改为 `async def`，用 `asyncio.create_task` 把 runtime
调度到 FastAPI 主 event loop，与 HTTP 请求交错执行。
"""
import asyncio
import time

import pytest
from fastapi.testclient import TestClient

from app import app


@pytest.fixture
def client():
    return TestClient(app)


def test_create_task_returns_quickly(client):
    """POST /api/agent/tasks 应当在 < 1s 内返回（不阻塞整个请求）。"""
    start = time.time()
    r = client.post("/api/agent/tasks", json={
        "user_goal": "测试不阻塞",
        "max_steps": 12,
    })
    elapsed = time.time() - start
    assert r.status_code == 200
    # 必须快速返回；慢的话说明 endpoint 在等 runtime
    assert elapsed < 1.0, f"POST took {elapsed:.2f}s, should be < 1s (runtime blocks endpoint)"


def test_server_responsive_during_agent_runs(client):
    """连续创建多个 task，GET 端点必须仍能在 < 1s 内响应。"""
    # 创建 5 个 task
    task_ids = []
    for i in range(5):
        r = client.post("/api/agent/tasks", json={
            "user_goal": f"concurrent #{i}",
            "max_steps": 12,
        })
        assert r.status_code == 200
        task_ids.append(r.json()["id"])

    # 立刻 GET 列表——必须快速返回
    start = time.time()
    r = client.get("/api/agent/tasks")
    elapsed = time.time() - start
    assert r.status_code == 200
    assert elapsed < 1.0, f"GET took {elapsed:.2f}s while agents running, server is stuck"
    assert len(r.json()) >= 5

    # 立刻 GET tools——也必须快速返回
    start = time.time()
    r = client.get("/api/agent/tools")
    elapsed = time.time() - start
    assert r.status_code == 200
    assert elapsed < 1.0, f"GET tools took {elapsed:.2f}s, server is stuck"


def test_agents_actually_complete_in_background(client, seeded_provider):
    """创建 task 后等几秒，runtime 应当在后台跑完（不阻塞 endpoint）。

    Plan 5 删除 DevScriptedLLM 后，依赖 conftest.py 的 `seeded_provider` fixture
    注入 NoOp LLM，让 runtime 跑通但只产出 1 步（finish_task）。
    旧测试要求 6 步（create_plan → ... → finish_task）依赖 DevScriptedLLM 的剧本，
    那是模拟数据，删除后不再要求。
    """
    r = client.post("/api/agent/tasks", json={
        "user_goal": "后台跑完",
        "max_steps": 12,
    })
    tid = r.json()["id"]

    # 轮询等完成（最多 15s）
    deadline = time.time() + 15.0
    while time.time() < deadline:
        r = client.get(f"/api/agent/tasks/{tid}")
        if r.json()["status"] in ("done", "failed"):
            break
        time.sleep(0.3)

    r = client.get(f"/api/agent/tasks/{tid}")
    task = r.json()
    assert task["status"] == "done", f"agent did not complete: {task}"

    # 验证：至少 1 步（NoOp 跑 finish_task 一次就结束）
    r = client.get(f"/api/agent/tasks/{tid}/steps")
    steps = r.json()
    assert len(steps) >= 1, f"expected >=1 step, got {len(steps)}"
