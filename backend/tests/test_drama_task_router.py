"""DramaTask + UserPreference 路由测试（替代 localStorage 持久化）。"""
import json
import pytest
from fastapi.testclient import TestClient

from app import app


@pytest.fixture
def client():
    with TestClient(app) as c:
        yield c


def test_drama_task_crud_roundtrip(client: TestClient):
    # 1) 初始列表为空
    r = client.get("/api/drama-tasks")
    assert r.status_code == 200
    assert r.json() == []

    # 2) PUT 创建一个 task
    payload = {
        "name": "Hero Story",
        "data": {
            "name": "Hero Story",
            "style": "Cinematic Realistic",
            "language": "zh",
            "mode": "auto",
            "sourceType": "idea",
            "createdAt": 1700000000000,
            "status": "IDLE",
            "stepStatus": "idle",
            "progress": 0,
            "rawNovelText": "Once upon a time",
            "characters": [{"name": "Alice"}],
            "bigShots": [],
        },
    }
    r = client.put("/api/drama-tasks/task-1", json=payload)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["id"] == "task-1"
    assert body["name"] == "Hero Story"
    assert body["data"]["rawNovelText"] == "Once upon a time"
    assert body["data"]["characters"][0]["name"] == "Alice"

    # 3) GET 单个
    r = client.get("/api/drama-tasks/task-1")
    assert r.status_code == 200
    assert r.json()["name"] == "Hero Story"

    # 4) PATCH 局部更新 — name 直接覆盖，data 走 deep-merge
    r = client.patch(
        "/api/drama-tasks/task-1",
        json={"name": "Renamed", "data": {"rawNovelText": "Once upon a time\n\nChapter 2"}},
    )
    assert r.status_code == 200
    body = r.json()
    assert body["name"] == "Renamed"
    assert body["data"]["rawNovelText"] == "Once upon a time\n\nChapter 2"
    # 关键：characters 字段没在 PATCH 里，不应被清空
    assert body["data"]["characters"][0]["name"] == "Alice"

    # 5) LIST 应该看到 1 个
    r = client.get("/api/drama-tasks")
    assert r.status_code == 200
    rows = r.json()
    assert len(rows) == 1
    assert rows[0]["id"] == "task-1"

    # 6) DELETE 永久删除
    r = client.delete("/api/drama-tasks/task-1")
    assert r.status_code == 200
    r = client.get("/api/drama-tasks")
    assert r.json() == []


def test_drama_task_soft_delete_via_patch(client: TestClient):
    """软删除：PATCH deleted=True → list 默认不返。"""
    client.put("/api/drama-tasks/task-2", json={"name": "X", "data": {}})
    r = client.patch("/api/drama-tasks/task-2", json={"deleted": True})
    assert r.status_code == 200
    # 默认 list 不返
    r = client.get("/api/drama-tasks")
    assert all(row["id"] != "task-2" for row in r.json())
    # include_deleted=true 时返
    r = client.get("/api/drama-tasks?include_deleted=true")
    assert any(row["id"] == "task-2" for row in r.json())


def test_user_preference_crud(client: TestClient):
    # 1) GET 不存在的 key 返 200 + value=null（前端友好）
    r = client.get("/api/user-preferences/no-such")
    assert r.status_code == 200
    assert r.json()["value"] is None

    # 2) PUT 写入
    r = client.put("/api/user-preferences/language", json={"value": "zh"})
    assert r.status_code == 200
    assert r.json()["value"] == "zh"

    # 3) GET 读出
    r = client.get("/api/user-preferences/language")
    assert r.status_code == 200
    assert r.json()["value"] == "zh"

    # 4) 复杂 value（list）
    r = client.put(
        "/api/user-preferences/step_bindings",
        json={"value": [{"step": "preprocessing", "providerId": "openai", "modelId": "gpt-4o-mini"}]},
    )
    assert r.status_code == 200
    r = client.get("/api/user-preferences/step_bindings")
    assert r.json()["value"][0]["modelId"] == "gpt-4o-mini"

    # 5) 批量写入
    r = client.post(
        "/api/user-preferences/_batch",
        json={
            "items": {
                "language": "en",
                "current_canvas_id": "canvas-1",
                "deleted_canvas_ids": ["old-1", "old-2"],
            }
        },
    )
    assert r.status_code == 200
    assert client.get("/api/user-preferences/language").json()["value"] == "en"
    assert client.get("/api/user-preferences/current_canvas_id").json()["value"] == "canvas-1"
    assert client.get("/api/user-preferences/deleted_canvas_ids").json()["value"] == ["old-1", "old-2"]

    # 6) DELETE
    r = client.delete("/api/user-preferences/step_bindings")
    assert r.status_code == 200
    r = client.get("/api/user-preferences/step_bindings")
    assert r.json()["value"] is None
