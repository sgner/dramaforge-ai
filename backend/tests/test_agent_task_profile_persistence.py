import pytest
from fastapi.testclient import TestClient

from app import app
from app.agent.llm import LLMResponse
from app.agent.memory import AgentMemory, StepRecord
from app.agent.runtime import AgentRuntime
from app.agent.task_profiles import TaskProfile, classify_task
from app.database import SessionLocal
from app.models import AgentTask
from app.models import AgentStep
from app.routers.agent import _persist_steps


@pytest.fixture
def client(monkeypatch):
    async def noop_spawn(_task_dict):
        return None

    monkeypatch.setattr("app.routers.agent._spawn_runtime", noop_spawn)
    monkeypatch.setattr(
        "app.routers.agent.resolve_capability_bindings",
        lambda _db: {"llm": {"provider_id": "test", "model_id": "test-model"}},
    )
    return TestClient(app)


def test_agent_task_serializes_task_profile_and_rule_pack():
    profile = classify_task("鍔熷か", None, [])
    task = AgentTask(id="profile-1", user_goal="鍔熷か", task_profile=profile.model_dump(mode="json"))

    payload = task.to_dict()

    assert payload["task_profile"] == profile.model_dump(mode="json")
    assert payload["task_profile"]["rule_pack_id"] == "drama_short.v1"


def test_task_creation_persists_profile_before_runtime_is_spawned(client):
    response = client.post("/api/agent/tasks", json={"user_goal": "鍔熷か"})
    assert response.status_code == 200, response.text
    task_id = response.json()["id"]

    with SessionLocal() as db:
        task = db.query(AgentTask).filter_by(id=task_id).first()
        assert task.task_profile["task_type"] == "drama_short"
        assert task.task_profile["rule_pack_id"] == "drama_short.v1"


def test_legacy_task_without_profile_derives_profile_once():
    runtime = AgentRuntime(
        task_id="legacy-1",
        llm=object(),
        memory=AgentMemory(user_goal="鍔熷か"),
    )

    profile = runtime.profile

    assert profile is None
    derived = runtime.hydrate_profile()
    assert derived.task_type == "drama_short"
    assert runtime.profile == derived
    assert runtime.hydrate_profile() is derived


@pytest.mark.asyncio
async def test_missing_source_question_has_durable_metadata():
    runtime = AgentRuntime(
        task_id="question-1",
        llm=object(),
        memory=AgentMemory(user_goal="鍔熷か"),
        profile=classify_task("鍔熷か", None, []),
    )

    await runtime._pause_for_script_requirement(
        "need source",
        LLMResponse(tool_name="ask_user", tool_args={}, cost_usd=0, prompt_tokens=0, completion_tokens=0),
    )

    question = runtime.pending_request
    assert question["step_id"] == "clarify_source"
    assert question["missing_inputs"] == ["script"]
    assert question["selection_mode"] == "text"
    assert question["allow_custom"] is True


def test_legacy_task_payload_remains_readable():
    task = AgentTask.from_dict({"id": "legacy-2", "user_goal": "old", "status": "paused"})
    assert task.task_profile is None
    assert task.to_dict()["task_profile"] is None


def test_answer_recovery_updates_pending_step_instead_of_resurrecting_question():
    task_id = "profile-answer-recovery"
    with SessionLocal() as db:
        db.query(AgentStep).filter_by(task_id=task_id).delete()
        db.query(AgentTask).filter_by(id=task_id).delete()
        task = AgentTask(id=task_id, user_goal="\u529f\u592b", status="paused")
        task.steps.append(AgentStep(
            id="profile-answer-step",
            task_id=task_id,
            step_number=1,
            action={"tool": "ask_user", "params": {"question": "source?"}},
            observation={"pending": "awaiting_user_input"},
            status="pending",
        ))
        db.add(task)
        db.commit()

    memory = AgentMemory(user_goal="\u529f\u592b")
    memory.short_term.append(StepRecord(
        step_number=1,
        thought="need source",
        action={"tool": "ask_user", "params": {"question": "source?"}},
        observation={"success": True, "user_response": {"response": "write it"}},
        status="success",
    ))
    runtime = AgentRuntime(task_id=task_id, llm=object(), memory=memory)

    _persist_steps(task_id, memory, runtime)

    with SessionLocal() as db:
        task = db.query(AgentTask).filter_by(id=task_id).first()
        assert task.steps[0].status == "success"
        assert task.to_dict()["pending_question"] is None
        db.delete(task)
        db.commit()


def test_agent_task_out_keeps_pending_question_for_refresh(client):
    task_id = "profile-pending-api"
    with SessionLocal() as db:
        db.query(AgentStep).filter_by(task_id=task_id).delete()
        db.query(AgentTask).filter_by(id=task_id).delete()
        task = AgentTask(id=task_id, user_goal="promotion", status="paused")
        task.steps.append(AgentStep(
            id="profile-pending-api-step",
            task_id=task_id,
            step_number=1,
            action={"tool": "ask_user", "params": {
                "step_id": "clarify_source",
                "question": "Provide the promotion brief",
                "missing_inputs": ["promotion_brief"],
                "selection_mode": "text",
                "allow_custom": True,
            }},
            status="pending",
        ))
        db.add(task)
        db.commit()

    response = client.get(f"/api/agent/tasks/{task_id}")

    assert response.status_code == 200
    assert response.json()["pending_question"]["step_id"] == "clarify_source"
    with SessionLocal() as db:
        db.query(AgentStep).filter_by(task_id=task_id).delete()
        db.query(AgentTask).filter_by(id=task_id).delete()
        db.commit()


@pytest.mark.parametrize(
    ("goal", "source_key"),
    [
        ("promote our event", "promotion_brief"),
        ("create a commercial", "product_information"),
        ("make a custom video", "structured_source"),
    ],
)
def test_answered_source_reopens_profile_gate(goal, source_key):
    profile = classify_task(goal, None, [])
    assert source_key in profile.missing_inputs
    runtime = AgentRuntime("profile-gate", None, AgentMemory(goal), profile=profile)
    runtime.memory.add_step(
        step_number=1,
        thought="need source",
        action={"tool": "ask_user", "params": {"missing_inputs": [source_key]}},
        observation={"success": True, "user_response": {
            "response": "Use the supplied source details",
            "custom_text": "Approved current source",
        }},
        status="success",
    )

    refreshed = runtime._selected_task_profile()

    assert refreshed.needs_clarification is False
    assert runtime._has_source_for_profile(refreshed) is True
