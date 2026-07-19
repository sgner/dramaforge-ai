import uuid
import asyncio

import pytest
from fastapi.testclient import TestClient

from app import app
from app.agent.events import event_bus, AgentEvent, EventType
from app.database import SessionLocal
from app.models import AgentTask, AgentStep, Project


@pytest.fixture
def client():
    return TestClient(app)


@pytest.fixture
def db_session():
    """与 app 共享同一 engine 的 session，确保 client 写入对 db_session 可见。"""
    session = SessionLocal()
    try:
        yield session
    finally:
        # 清理测试数据：硬编码 id (t-rec-1/2/3...) 跨测试复用，结束后必须删
        # 用独立 session 避免主 session 的 identity map 缓存
        try:
            from app.models import AgentTask, AgentStep
            from app.database import SessionLocal as _SL
            with _SL() as cleanup_db:
                for tid in ("t-rec-1", "t-rec-2", "t-rec-3", "t-stop", "t-retry", "t-retry-stale", "t-resume-running", "t-rollback-1", "t-rollback-2", "t-continue-1", "t-continue-bad", "t-zombie-startup"):
                    cleanup_db.query(AgentStep).filter_by(task_id=tid).delete()
                    cleanup_db.query(AgentTask).filter_by(id=tid).delete()
                cleanup_db.commit()
        except Exception:
            pass
        session.close()


def test_create_agent_task(client):
    """POST /api/agent/tasks 创建任务。"""
    resp = client.post("/api/agent/tasks", json={
        "user_goal": "把小说变脚本",
        "project_id": None,
    })
    assert resp.status_code == 200
    data = resp.json()
    assert "id" in data
    assert data["user_goal"] == "把小说变脚本"
    assert data["status"] == "pending"


def test_create_task_with_llm_provider_fields(client):
    """POST /api/agent/tasks 带 llm_provider_id / llm_model_id 应被存进 task 行。"""
    resp = client.post("/api/agent/tasks", json={
        "user_goal": "test goal with llm",
        "project_id": None,
        "llm_provider_id": "openai",
        "llm_model_id": "gpt-4o-mini",
    })
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["llm_provider_id"] == "openai"
    assert body["llm_model_id"] == "gpt-4o-mini"

    # 二次 GET 确认持久化
    again = client.get(f"/api/agent/tasks/{body['id']}")
    assert again.status_code == 200
    again_body = again.json()
    assert again_body["llm_provider_id"] == "openai"
    assert again_body["llm_model_id"] == "gpt-4o-mini"


def test_create_task_without_llm_fields_defaults_to_null(client):
    """不传 llm_* 字段时，新字段为 None（向后兼容）。"""
    resp = client.post("/api/agent/tasks", json={
        "user_goal": "no llm fields",
    })
    assert resp.status_code == 200
    body = resp.json()
    assert body["llm_provider_id"] is None
    assert body["llm_model_id"] is None


def test_list_agent_tasks(client):
    """GET /api/agent/tasks 列出任务。"""
    client.post("/api/agent/tasks", json={"user_goal": "x"})
    client.post("/api/agent/tasks", json={"user_goal": "y"})
    resp = client.get("/api/agent/tasks")
    assert resp.status_code == 200
    data = resp.json()
    assert len(data) >= 2


def test_get_agent_task(client):
    """GET /api/agent/tasks/{id} 获取任务。"""
    create = client.post("/api/agent/tasks", json={"user_goal": "x"}).json()
    resp = client.get(f"/api/agent/tasks/{create['id']}")
    assert resp.status_code == 200
    data = resp.json()
    assert data["id"] == create["id"]


def test_get_agent_task_404(client):
    """不存在的任务返回 404。"""
    resp = client.get("/api/agent/tasks/nonexistent")
    assert resp.status_code == 404


def test_update_agent_task_status(client):
    """PATCH /api/agent/tasks/{id} 更新状态。"""
    create = client.post("/api/agent/tasks", json={"user_goal": "x"}).json()
    resp = client.patch(f"/api/agent/tasks/{create['id']}", json={
        "status": "running",
        "plan": [{"step": 1, "tool": "generate_script"}],
    })
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "running"


def test_sse_stream_endpoint_registered(client):
    """GET /api/agent/tasks/{id}/stream 路由存在。"""
    create = client.post("/api/agent/tasks", json={"user_goal": "x"}).json()
    task_id = create["id"]
    # 验证路由存在 — agent router 内部应包含 stream 端点
    from app.routers.agent import router
    stream_paths = [r.path for r in router.routes if hasattr(r, "path")]
    assert any("stream" in p for p in stream_paths), f"stream route not found in {stream_paths}"

    # The route must be backed by stream_events and construct an actual SSE
    # response. If the decorator is accidentally attached to a helper that
    # returns a string, EventSource receives application/json and retries
    # forever. Inspect the response object directly so this test does not
    # wait for the intentionally long-lived stream.
    import asyncio
    from app.routers.agent import stream_events

    response = asyncio.run(stream_events(task_id))
    assert response.media_type == "text/event-stream"
    asyncio.run(response.body_iterator.aclose())


def test_post_user_response(client):
    """POST /api/agent/tasks/{id}/respond 注入用户响应。"""
    create = client.post("/api/agent/tasks", json={"user_goal": "x"}).json()
    resp = client.post(f"/api/agent/tasks/{create['id']}/respond", json={
        "response": "我选 1",
    })
    assert resp.status_code == 200
    data = resp.json()
    assert data["ok"] is True


def test_stop_running_task(client, db_session, monkeypatch):
    class _RunningJob:
        def __init__(self):
            self.cancelled = False

        def done(self):
            return self.cancelled

        def cancel(self):
            self.cancelled = True

    task = AgentTask(
        id="t-stop", project_id="p1", user_goal="stop me", status="running",
        plan=[], artifacts={}, total_cost_usd=0.0, total_tokens=0,
        max_steps=30, skip_confirm=False,
    )
    db_session.add(task)
    db_session.commit()
    from app.routers import agent as agent_router
    job = _RunningJob()
    monkeypatch.setitem(agent_router._RUNNING_TASKS, "t-stop", job)

    response = client.post("/api/agent/tasks/t-stop/stop")
    assert response.status_code == 200
    assert response.json()["status"] == "cancelled"
    db_session.refresh(task)
    assert task.status == "cancelled"
    assert job.cancelled is True


def test_retry_failed_task_resets_state_and_restarts(client, db_session, monkeypatch):
    task = AgentTask(
        id="t-retry", project_id="p1", user_goal="retry me", status="failed",
        plan=[{"title": "old"}], artifacts={"image": [{"id": "old"}]},
        total_cost_usd=1.2, total_tokens=42, max_steps=30, skip_confirm=False,
    )
    db_session.add(task)
    db_session.commit()

    async def noop_spawn(_task_dict):
        return None

    monkeypatch.setattr("app.routers.agent._spawn_runtime", noop_spawn)
    response = client.post("/api/agent/tasks/t-retry/retry")
    assert response.status_code == 200
    assert response.json()["status"] == "pending"
    db_session.refresh(task)
    assert task.status == "pending"
    assert task.plan == []
    assert task.artifacts == {}
    assert task.total_cost_usd == 0
    assert task.total_tokens == 0


def test_retry_failed_task_discards_stale_finished_runtime_handle(client, db_session, monkeypatch):
    """失败状态不应被一个已结束的旧句柄永久阻塞重试。"""
    task = AgentTask(
        id="t-retry-stale", project_id="p1", user_goal="retry stale", status="failed",
        plan=[], artifacts={}, total_cost_usd=0.0, total_tokens=0, max_steps=30, skip_confirm=False,
    )
    db_session.add(task)
    db_session.commit()

    class FinishedJob:
        def done(self):
            return True

    from app.routers import agent as agent_router
    monkeypatch.setitem(agent_router._RUNNING_TASKS, "t-retry-stale", FinishedJob())

    async def noop_spawn(_task_dict):
        return None

    monkeypatch.setattr("app.routers.agent._spawn_runtime", noop_spawn)
    response = client.post("/api/agent/tasks/t-retry-stale/retry")

    assert response.status_code == 200, response.text
    assert response.json()["status"] == "pending"


def test_resume_running_task_is_idempotent(client, db_session, monkeypatch):
    """回答提交与恢复请求并发时，已运行中的任务应返回成功而不是 400。"""
    task = AgentTask(
        id="t-resume-running", project_id="p1", user_goal="resume running", status="running",
        plan=[], artifacts={}, total_cost_usd=0.0, total_tokens=0, max_steps=30, skip_confirm=False,
    )
    db_session.add(task)
    db_session.commit()

    from app.routers import agent as agent_router
    monkeypatch.setitem(agent_router._RUNNING_TASKS, "t-resume-running", object())
    response = client.post("/api/agent/tasks/t-resume-running/resume")

    assert response.status_code == 200, response.text
    assert response.json()["status"] == "already_running"


class TestUserRespondRecovery:
    """Spec B: user_respond 支持 recovery_action / new_model_id。"""

    def test_respond_with_recovery_action_retry(self, client, db_session):
        """POST /respond 带 recovery_action=retry → pending_response 含 recovery_action。"""
        task = AgentTask(
            id="t-rec-1",
            project_id="p1",
            user_goal="x",
            status="paused",
            plan=[],
            artifacts={},
            total_cost_usd=0.0,
            total_tokens=0,
            max_steps=30,
            skip_confirm=False,
        )
        db_session.add(task)
        db_session.commit()

        resp = client.post(f"/api/agent/tasks/t-rec-1/respond", json={
            "response": "retry",
            "approved": True,
            "recovery_action": "retry",
        })
        assert resp.status_code == 200
        db_session.refresh(task)
        assert task.pending_response["recovery_action"] == "retry"

    def test_respond_with_recovery_action_change_model(self, client, db_session):
        """POST /respond 带 recovery_action=change_model + new_model_id。"""
        task = AgentTask(
            id="t-rec-2",
            project_id="p1",
            user_goal="x",
            status="paused",
            plan=[],
            artifacts={},
            total_cost_usd=0.0,
            total_tokens=0,
            max_steps=30,
            skip_confirm=False,
        )
        db_session.add(task)
        db_session.commit()

        resp = client.post(f"/api/agent/tasks/t-rec-2/respond", json={
            "response": "change_model",
            "approved": True,
            "recovery_action": "change_model",
            "new_model_id": "dall-e-2",
        })
        assert resp.status_code == 200
        db_session.refresh(task)
        assert task.pending_response["recovery_action"] == "change_model"
        assert task.pending_response["new_model_id"] == "dall-e-2"

    def test_respond_without_recovery_action_still_works(self, client, db_session):
        """不传 recovery_action 时原有逻辑不变（向后兼容）。"""
        task = AgentTask(
            id="t-rec-3",
            project_id="p1",
            user_goal="x",
            status="paused",
            plan=[],
            artifacts={},
            total_cost_usd=0.0,
            total_tokens=0,
            max_steps=30,
            skip_confirm=False,
        )
        db_session.add(task)
        db_session.commit()

        resp = client.post(f"/api/agent/tasks/t-rec-3/respond", json={
            "response": "ok",
            "approved": True,
        })
        assert resp.status_code == 200
        db_session.refresh(task)
        assert "recovery_action" not in task.pending_response
        assert task.pending_response["response"] == "ok"

    def test_respond_preserves_multiple_response_and_custom_text(self, client, db_session):
        task_id = f"t-rec-structured-{uuid.uuid4().hex}"
        task = AgentTask(
            id=task_id, project_id="p1", user_goal="x", status="paused", plan=[], artifacts={},
            total_cost_usd=0.0, total_tokens=0, max_steps=30, skip_confirm=False,
        )
        db_session.add(task)
        db_session.commit()
        resp = client.post(f"/api/agent/tasks/{task_id}/respond", json={
            "response": ["古风", "悬疑"], "custom_text": "节奏偏快", "approved": True,
        })
        assert resp.status_code == 200
        db_session.refresh(task)
        assert task.pending_response["response"] == ["古风", "悬疑"]
        assert task.pending_response["custom_text"] == "节奏偏快"


def test_continue_runtime_failure_rolls_back_to_paused(client, db_session, monkeypatch):
    """resume 后 step 失败时，task 状态应回滚为 paused，pending_response 保留。

    场景：用户回复提问 → resumeAgent 成功 → runtime.step() 抛错（LLM 网络错误等）。
    旧实现把 task 状态置为 failed，pending_request/pending_response 已被 consume，
    用户输入丢失，前端回复卡消失，无法重试。

    新实现：把 task.status 回滚为 paused，如果 pending_response 已被清空，
    从最近 ask_user step 的 observation.user_response 重建。
    """
    from unittest.mock import AsyncMock, patch
    from app.models import AgentStep

    task_id = "t-rollback-1"
    task = AgentTask(
        id=task_id, project_id="p1", user_goal="失败回滚测试",
        status="paused",  # 真实场景：用户已 respond，task 仍是 paused
        plan=[], artifacts={}, total_cost_usd=0.0, total_tokens=0,
        max_steps=30, skip_confirm=False,
    )
    db_session.add(task)
    db_session.commit()
    # 模拟 runtime 已 consume pending_response 并把 ask_user step 标为 success
    db_session.add(AgentStep(
        id=f"{task_id}-s1", task_id=task_id, step_number=1,
        thought="问用户", action={"tool": "ask_user", "params": {"question": "题材？"}},
        observation={"success": True, "user_response": "古风"},
        status="success",
    ))
    db_session.commit()
    # 模拟 runtime.resume 后 pending_response 已被清空
    task.pending_response = None
    db_session.commit()

    # 让 _run_runtime_loop 抛错
    async def boom(*args, **kwargs):
        raise RuntimeError("simulated LLM failure")

    from app.routers import agent as agent_router
    monkeypatch.setattr(agent_router, "_run_runtime_loop", boom)
    # 清空 in-memory handles，强制走 _continue_runtime
    agent_router._RUNNING_RUNTIMES.pop(task_id, None)
    agent_router._RUNNING_TASKS.pop(task_id, None)

    # 触发：调 /resume
    resp = client.post(f"/api/agent/tasks/{task_id}/resume")
    # 200 是因为路由立即 return {"ok": True, "status": "resuming"}，
    # 真正的 _continue_runtime 在后台 task 跑
    assert resp.status_code == 200, resp.text

    # 等后台 task 跑完
    import time
    for _ in range(20):
        db_session.refresh(task)
        if task.status != "paused":
            break
        time.sleep(0.1)

    db_session.refresh(task)
    assert task.status == "paused", f"expected paused, got {task.status}"
    # pending_response 已被清空 → 从 memory 重建回去
    assert task.pending_response is not None
    assert task.pending_response["response"] == "古风"


def test_continue_runtime_failure_preserves_pending_response(client, db_session, monkeypatch):
    """失败发生在 resume 之前 → pending_response 仍存在，task 应回滚为 paused 且保留。"""
    from unittest.mock import AsyncMock
    from app.models import AgentStep

    task_id = "t-rollback-2"
    task = AgentTask(
        id=task_id, project_id="p1", user_goal="pending_response 保留测试",
        status="paused", plan=[], artifacts={}, total_cost_usd=0.0, total_tokens=0,
        max_steps=30, skip_confirm=False,
    )
    db_session.add(task)
    db_session.commit()
    # pending_response 仍存在（resume 前的失败）
    task.pending_response = {"response": "悬疑"}
    db_session.commit()

    async def boom(*args, **kwargs):
        raise RuntimeError("simulated LLM failure")

    from app.routers import agent as agent_router
    monkeypatch.setattr(agent_router, "_run_runtime_loop", boom)
    agent_router._RUNNING_RUNTIMES.pop(task_id, None)
    agent_router._RUNNING_TASKS.pop(task_id, None)

    resp = client.post(f"/api/agent/tasks/{task_id}/resume")
    assert resp.status_code == 200, resp.text

    import time
    for _ in range(20):
        db_session.refresh(task)
        if task.status != "paused":
            break
        time.sleep(0.1)

    db_session.refresh(task)
    assert task.status == "paused", f"expected paused, got {task.status}"
    assert task.pending_response == {"response": "悬疑"}


def test_continue_conversation_endpoint_rejects_non_done_task(client, db_session):
    """/continue 只允许 status=done 的任务调用。"""
    task = AgentTask(id="t-continue-bad", user_goal="x", status="running")
    db_session.add(task)
    db_session.commit()

    resp = client.post(f"/api/agent/tasks/t-continue-bad/continue", json={"message": "追加需求"})
    assert resp.status_code == 400
    assert "only 'done' tasks can be continued" in resp.text


def test_continue_conversation_endpoint_rejects_empty_message(client, db_session):
    """/continue 拒绝空消息。"""
    task = AgentTask(id="t-continue-1", user_goal="x", status="done")
    db_session.add(task)
    db_session.commit()

    resp = client.post(f"/api/agent/tasks/t-continue-1/continue", json={"message": "   "})
    assert resp.status_code == 400
    assert "empty" in resp.text


def test_continue_conversation_endpoint_sets_pending_and_schedules(client, db_session, monkeypatch):
    """/continue 把 continue_message 写入 pending_response 并调度 _continue_runtime。"""
    task = AgentTask(id="t-continue-1", user_goal="原始目标", status="done")
    db_session.add(task)
    db_session.commit()

    scheduled = {}
    async def fake_continue(task_id):
        scheduled["task_id"] = task_id
        scheduled["called"] = True
    from app.routers import agent as agent_router
    monkeypatch.setattr(agent_router, "_continue_runtime", fake_continue)
    agent_router._RUNNING_RUNTIMES.pop("t-continue-1", None)
    agent_router._RUNNING_TASKS.pop("t-continue-1", None)

    resp = client.post(f"/api/agent/tasks/t-continue-1/continue", json={"message": "再生成一个反派角色"})
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["status"] == "continuing"

    db_session.refresh(task)
    assert task.status == "paused"
    assert task.pending_response["continue_message"] == "再生成一个反派角色"


def test_startup_zombie_tasks_are_paused_for_explicit_resume(db_session, monkeypatch):
    """A process restart must not silently rerun an old running task."""
    from app.routers import agent as agent_router

    task_id = f"t-zombie-startup-{uuid.uuid4().hex[:8]}"
    task = AgentTask(id=task_id, user_goal="生成资产", status="running")
    db_session.add(task)
    db_session.commit()
    scheduled = []
    monkeypatch.setattr(
        agent_router,
        "_schedule_runtime",
        lambda task_id, coroutine: scheduled.append(task_id),
    )

    recovered = asyncio.run(agent_router.recover_zombie_agent_tasks())

    db_session.expire(task)
    db_session.refresh(task)
    assert task_id in recovered
    assert scheduled == []
    assert task.status == "paused"
    assert task.pending_response["type"] == "service_interrupted"


def test_delete_project_removes_agent_tasks_and_steps(client, db_session):
    project_id = f"project-task-delete-{uuid.uuid4().hex[:8]}"
    task_id = f"task-delete-{uuid.uuid4().hex[:8]}"
    db_session.add(Project(id=project_id, name="delete task test"))
    db_session.add(AgentTask(id=task_id, project_id=project_id, user_goal="test", status="paused"))
    db_session.add(AgentStep(id=f"step-{uuid.uuid4().hex[:8]}", task_id=task_id, step_number=1))
    db_session.commit()

    response = client.delete(f"/api/projects/{project_id}")

    assert response.status_code == 200
    assert db_session.query(Project).filter_by(id=project_id).first() is None
    assert db_session.query(AgentTask).filter_by(id=task_id).first() is None
    assert db_session.query(AgentStep).filter_by(task_id=task_id).count() == 0
