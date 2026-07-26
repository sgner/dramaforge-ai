"""工具元数据导出 + GET /api/agent/tools 端点测试。"""
import pytest
from fastapi.testclient import TestClient

from app import app
from app.agent.tools import list_tool_metadata


def test_list_tool_metadata_returns_18():
    meta = list_tool_metadata()
    assert len(meta) == 25


def test_list_tool_metadata_has_required_fields():
    meta = list_tool_metadata()
    for m in meta:
        assert "name" in m
        assert "description" in m
        assert "category" in m
        assert "requires_approval" in m


def test_list_tool_metadata_categories_match_all_tools():
    meta = {m["name"]: m["category"] for m in list_tool_metadata()}
    assert meta["parse_user_goal"] == "planning"
    assert meta["generate_script"] == "llm"
    assert meta["generate_video"] == "video"
    assert meta["save_asset"] == "asset"


@pytest.fixture
def client():
    return TestClient(app)


def test_get_agent_tools_route_returns_18(client):
    res = client.get("/api/agent/tools")
    assert res.status_code == 200
    data = res.json()
    assert isinstance(data, list)
    assert len(data) == 25
    assert all("name" in item and "category" in item for item in data)
