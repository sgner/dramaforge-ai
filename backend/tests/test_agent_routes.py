import pytest
from fastapi.testclient import TestClient

from app import app
from app.agent.events import event_bus, AgentEvent, EventType
from app.models import AgentTask


@pytest.fixture
def client():
    return TestClient(app)


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
