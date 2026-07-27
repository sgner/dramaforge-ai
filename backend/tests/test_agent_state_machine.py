"""阶段 2.1：创建幂等 / 状态转换守卫 / 回答绑定测试。"""
import uuid

import pytest
from fastapi.testclient import TestClient

from app import app
from app.database import SessionLocal
from app.models import AgentStep, AgentTask


@pytest.fixture
def client():
    return TestClient(app)


@pytest.fixture
def db_session():
    session = SessionLocal()
    try:
        yield session
    finally:
        try:
            with SessionLocal() as cleanup_db:
                for tid in _CREATED_TASK_IDS:
                    cleanup_db.query(AgentStep).filter_by(task_id=tid).delete()
                    cleanup_db.query(AgentTask).filter_by(id=tid).delete()
                cleanup_db.commit()
        except Exception:
            pass
        session.close()


_CREATED_TASK_IDS: list[str] = []


def _create_task(client, db_session, **overrides):
    rid = uuid.uuid4().hex[:8]
    body = {"user_goal": f"goal-{rid}", "project_id": f"p-{rid}"}
    body.update(overrides)
    resp = client.post("/api/agent/tasks", json=body)
    assert resp.status_code == 200, resp.text
    task_id = resp.json()["id"]
    _CREATED_TASK_IDS.append(task_id)
    return task_id, body["project_id"]


def _seed_pending_question(db_session, task_id, step_id="q1"):
    # step_number 用大值，保证它是"最近一步"（创建任务调度的 runtime 可能写步骤）
    db_session.add(AgentStep(
        id=f"step-{uuid.uuid4().hex[:8]}", task_id=task_id, step_number=999,
        thought="t", action={"tool": "ask_user", "params": {"step_id": step_id, "question": "确认？"}},
        observation={}, status="pending",
    ))
    db_session.commit()


def _clear_runtime_handles(task_id):
    """清掉创建任务时调度的 runtime 句柄，避免 resume 走 already_running 短路。"""
    from app.routers import agent as agent_router
    agent_router._RUNNING_TASKS.pop(task_id, None)
    agent_router._RUNNING_RUNTIMES.pop(task_id, None)


class TestCreateIdempotency:
    def test_duplicate_client_request_id_returns_existing_task(self, client, db_session):
        key = uuid.uuid4().hex
        id1, project_id = _create_task(client, db_session, client_request_id=key)
        resp = client.post("/api/agent/tasks", json={
            "user_goal": "另一个目标", "project_id": project_id, "client_request_id": key,
        })
        assert resp.status_code == 200
        assert resp.json()["id"] == id1
        # 没有创建第二条任务
        count = db_session.query(AgentTask).filter_by(client_request_id=key).count()
        assert count == 1

    def test_different_key_creates_new_task(self, client, db_session):
        key = uuid.uuid4().hex
        id1, project_id = _create_task(client, db_session, client_request_id=key)
        id2, _ = _create_task(client, db_session, project_id=project_id, client_request_id=uuid.uuid4().hex)
        assert id1 != id2

    def test_no_key_always_creates(self, client, db_session):
        id1, project_id = _create_task(client, db_session)
        id2, _ = _create_task(client, db_session, project_id=project_id)
        assert id1 != id2


class TestStatusTransitionGuard:
    def test_terminal_done_cannot_transition(self, client, db_session):
        task_id, _ = _create_task(client, db_session)
        db_session.query(AgentTask).filter_by(id=task_id).update({"status": "done"})
        db_session.commit()
        resp = client.patch(f"/api/agent/tasks/{task_id}", json={"status": "running"})
        assert resp.status_code == 409
        assert "done -> running" in resp.json()["detail"]

    def test_failed_to_pending_allowed(self, client, db_session):
        task_id, _ = _create_task(client, db_session)
        db_session.query(AgentTask).filter_by(id=task_id).update({"status": "failed"})
        db_session.commit()
        resp = client.patch(f"/api/agent/tasks/{task_id}", json={"status": "pending"})
        assert resp.status_code == 200
        assert resp.json()["status"] == "pending"

    def test_same_status_is_noop(self, client, db_session):
        task_id, _ = _create_task(client, db_session)
        # runtime 可能已把任务推进到 running；以当前真实状态为准
        db_session.expire_all()
        current = db_session.query(AgentTask).filter_by(id=task_id).one().status
        resp = client.patch(f"/api/agent/tasks/{task_id}", json={"status": current})
        assert resp.status_code == 200


class TestAnswerBinding:
    def test_respond_with_matching_question_id(self, client, db_session):
        task_id, _ = _create_task(client, db_session)
        _seed_pending_question(db_session, task_id, step_id="q1")
        resp = client.post(f"/api/agent/tasks/{task_id}/respond", json={
            "response": "确认", "question_id": "q1",
        })
        assert resp.status_code == 200
        db_session.expire_all()
        task = db_session.query(AgentTask).filter_by(id=task_id).one()
        assert task.pending_response["question_id"] == "q1"

    def test_respond_with_stale_question_id_rejected(self, client, db_session):
        task_id, _ = _create_task(client, db_session)
        _seed_pending_question(db_session, task_id, step_id="q2")
        resp = client.post(f"/api/agent/tasks/{task_id}/respond", json={
            "response": "旧回答", "question_id": "q1",
        })
        assert resp.status_code == 409

    def test_respond_with_question_id_but_no_pending_question_rejected(self, client, db_session):
        task_id, _ = _create_task(client, db_session)
        resp = client.post(f"/api/agent/tasks/{task_id}/respond", json={
            "response": "迟到回答", "question_id": "q1",
        })
        assert resp.status_code == 409

    def test_resume_rejects_mismatched_bound_answer(self, client, db_session):
        task_id, _ = _create_task(client, db_session)
        _clear_runtime_handles(task_id)
        # 回答绑定 q1，但当前待答问题是 q2
        _seed_pending_question(db_session, task_id, step_id="q2")
        db_session.query(AgentTask).filter_by(id=task_id).update({
            "status": "paused",
            "pending_response": {"response": "旧回答", "question_id": "q1", "approved": True},
        })
        db_session.commit()
        resp = client.post(f"/api/agent/tasks/{task_id}/resume")
        assert resp.status_code == 409
