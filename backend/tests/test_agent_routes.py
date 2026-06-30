import pytest
from fastapi.testclient import TestClient

from app import app
from app.agent.events import event_bus, AgentEvent, EventType
from app.database import SessionLocal
from app.models import AgentTask


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


def test_post_user_response(client):
    """POST /api/agent/tasks/{id}/respond 注入用户响应。"""
    create = client.post("/api/agent/tasks", json={"user_goal": "x"}).json()
    resp = client.post(f"/api/agent/tasks/{create['id']}/respond", json={
        "response": "我选 1",
    })
    assert resp.status_code == 200
    data = resp.json()
    assert data["ok"] is True


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
