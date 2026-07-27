"""单镜头成本预估测试。"""
from fastapi.testclient import TestClient

from app import app
from app.agent.studio import estimate_shot_cost


def test_estimate_shot_cost_defaults():
    result = estimate_shot_cost()
    assert result["max_rounds"] == 3
    assert result["max_image_generations"] == 3
    assert "3" in result["note"]


def test_estimate_shot_cost_clamps_to_limit():
    assert estimate_shot_cost(99)["max_rounds"] == 5
    assert estimate_shot_cost(0)["max_rounds"] == 1


def test_estimate_endpoint():
    client = TestClient(app)
    resp = client.get("/api/studio/estimate")
    assert resp.status_code == 200
    payload = resp.json()
    assert payload["max_rounds"] == 3
    assert payload["max_image_generations"] == 3

    resp = client.get("/api/studio/estimate?max_rounds=5")
    assert resp.json()["max_image_generations"] == 5

    resp = client.get("/api/studio/estimate?max_rounds=99")
    assert resp.status_code == 422  # ge/le 校验
