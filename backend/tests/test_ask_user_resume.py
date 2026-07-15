"""TDD: 任务从 PAUSED 恢复的端到端流程

覆盖：
- 创建 task → runtime 调用 ask_user → task 进入 paused + 发 REQUEST_USER_INPUT 事件
- 用户调 /respond + /resume → runtime 恢复 → 继续跑完
- 没有 pending_response 就调 /resume → 400
"""
import time
import pytest
from fastapi.testclient import TestClient

from app import app
from app.agent.events import event_bus, EventType
from app.agent.llm import LLMResponse


@pytest.fixture
def client():
    return TestClient(app)


class _FirstAskUserLLM:
    """跑 1 步：调 ask_user；resume 后再跑 1 步：finish_task。"""
    model = "test-askuser"
    _asked = False

    async def generate(self, messages, tools=None, temperature=0.7, max_tokens=4000):
        # 第 1 次：LLM 决定 ask_user
        if not self._asked:
            self._asked = True
            return LLMResponse(
                tool_name="ask_user",
                tool_args={"question": "想做什么方向？", "options": ["A", "B"]},
                cost_usd=0.0, prompt_tokens=0, completion_tokens=0,
            )
        # resume 后：finish_task
        return LLMResponse(
            tool_name="finish_task",
            tool_args={"summary": "ask user then finish"},
            cost_usd=0.0, prompt_tokens=0, completion_tokens=0,
        )

    async def generate_structured(self, messages, json_schema=None,
                                  temperature=0.7, max_tokens=4000):
        return await self.generate(messages)


@pytest.fixture
def askuser_llm(monkeypatch):
    """注入 _FirstAskUserLLM 替换 OpenAICompatibleLLMClient + autostart-test provider"""
    from app.agent import openai_llm_client as ollc
    from app.agent import llm_factory as lf
    from app.database import SessionLocal
    from app.models import ProviderConfig

    inst = _FirstAskUserLLM()
    monkeypatch.setattr(ollc, "OpenAICompatibleLLMClient", lambda **kw: inst)
    monkeypatch.setattr(lf, "OpenAICompatibleLLMClient", lambda **kw: inst)

    with SessionLocal() as db:
        row = db.query(ProviderConfig).filter_by(provider_id="autostart-test").first()
        if not row:
            row = ProviderConfig(
                provider_id="autostart-test", name="Test",
                base_url="https://test/v1", api_key="sk", protocol="openai",
                enabled=True, default_model="gpt-4",
                chat_models_json='["gpt-4"]', image_models_json="[]",
                video_models_json="[]", extra_config_json="{}",
            )
            db.add(row)
            db.commit()
    yield
    with SessionLocal() as db:
        row = db.query(ProviderConfig).filter_by(provider_id="autostart-test").first()
        if row:
            db.delete(row)
            db.commit()


def _wait_for_status(client, task_id, target, timeout=5.0):
    deadline = time.time() + timeout
    while time.time() < deadline:
        r = client.get(f"/api/agent/tasks/{task_id}")
        if r.status_code == 200 and r.json().get("status") == target:
            return r.json()
        time.sleep(0.05)
    return None


def test_task_pauses_on_ask_user_and_resumes_via_respond(client, askuser_llm):
    """ask_user → paused → respond + resume → 继续跑到 done。"""
    # 1. 创建 task
    r = client.post("/api/agent/tasks", json={
        "user_goal": "test ask_user", "max_steps": 12,
    })
    assert r.status_code == 200
    task_id = r.json()["id"]

    # 2. 等 task 进入 paused
    paused = _wait_for_status(client, task_id, "paused", timeout=5.0)
    assert paused is not None, f"task should pause; current={client.get(f'/api/agent/tasks/{task_id}').json()}"

    # 3. 验证：REQUEST_USER_INPUT 事件已被推送
    events = event_bus.get_replay(task_id)
    ask_event = next((e for e in events if e.type == EventType.REQUEST_USER_INPUT), None)
    assert ask_event is not None, "no REQUEST_USER_INPUT event"
    assert ask_event.payload.get("question") == "想做什么方向？"

    # 4. 用户调 respond
    r = client.post(f"/api/agent/tasks/{task_id}/respond", json={
        "response": ["A"], "custom_text": "节奏偏快",
    })
    assert r.status_code == 200
    received = [e for e in event_bus.get_replay(task_id) if e.type == EventType.USER_INPUT_RECEIVED]
    assert received[-1].payload["response"] == ["A"]
    assert received[-1].payload["custom_text"] == "节奏偏快"
    # 任务在 respond 后仍应是 paused（直到 /resume 重新拉起 runtime）
    r = client.get(f"/api/agent/tasks/{task_id}")
    assert r.json()["status"] == "paused"

    # 5. 没有 resume 就还是 paused
    r = client.post(f"/api/agent/tasks/{task_id}/resume")
    assert r.status_code == 200, r.text

    # 6. 等任务跑完（LLM resume 后调 finish_task）
    done = _wait_for_status(client, task_id, "done", timeout=5.0)
    assert done is not None, f"task should reach done; current={client.get(f'/api/agent/tasks/{task_id}').json()}"


def test_resume_without_pending_response_returns_400(client, askuser_llm):
    """未先调 respond 就调 resume → 400（避免 runtime 起来后无响应可注入）。"""
    r = client.post("/api/agent/tasks", json={"user_goal": "test no response"})
    task_id = r.json()["id"]
    # 强制标 paused
    from app.database import SessionLocal
    from app.models import AgentTask
    with SessionLocal() as db:
        t = db.query(AgentTask).filter_by(id=task_id).first()
        t.status = "paused"
        t.pending_response = None
        db.commit()

    r = client.post(f"/api/agent/tasks/{task_id}/resume")
    assert r.status_code == 400
    assert "pending_response" in r.json()["detail"].lower()
