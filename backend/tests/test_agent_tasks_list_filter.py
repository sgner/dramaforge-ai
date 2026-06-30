"""GET /api/agent/tasks 应当支持 ?project_id=... 过滤。"""
import uuid

import pytest
from fastapi.testclient import TestClient

from app import app


@pytest.fixture
def client():
    return TestClient(app)


def _create_task(client, project_id="p1", goal="test"):
    return client.post("/api/agent/tasks", json={
        "project_id": project_id,
        "user_goal": goal,
    })


def test_list_tasks_filtered_by_project_id(client):
    pid = f"p-{uuid.uuid4().hex[:8]}"
    _create_task(client, project_id=pid, goal="a")
    _create_task(client, project_id=pid, goal="b")
    _create_task(client, project_id="other-project", goal="c")
    res = client.get(f"/api/agent/tasks?project_id={pid}")
    assert res.status_code == 200
    data = res.json()
    assert all(t.get("project_id") == pid for t in data)
    assert len(data) >= 2


def test_list_tasks_no_filter_returns_all(client):
    res = client.get("/api/agent/tasks")
    assert res.status_code == 200
    assert isinstance(res.json(), list)


def test_list_tasks_empty_project_returns_empty_array(client):
    res = client.get("/api/agent/tasks?project_id=non-existent-xyz-12345")
    assert res.status_code == 200
    assert res.json() == []
