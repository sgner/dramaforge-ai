"""Task 4.4：取消终止所有工作。

覆盖：
- 批量生成中途取消：所有 job 协程被终止，迟到的 provider 响应不落结果；
- stop 端点同时取消 runtime job 与 auto-recovery job；
- 取消后重试：排空活跃旧句柄、清空步骤与事件日志、状态复位。
"""
import asyncio

import pytest
from fastapi.testclient import TestClient

from app import app
from app.agent.events import event_bus, EventType
from app.agent.llm import LLMResponse
from app.agent.media_service import MediaResult
from app.agent.tools.base import ToolContext
from app.database import SessionLocal
from app.models import AgentTask, AgentStep


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
                for tid in ("t-cancel-stop", "t-cancel-retry"):
                    cleanup_db.query(AgentStep).filter_by(task_id=tid).delete()
                    cleanup_db.query(AgentTask).filter_by(id=tid).delete()
                cleanup_db.commit()
        except Exception:
            pass
        session.close()


class _PromptLLM:
    model = "test-prompt-model"

    async def generate(self, messages, **kwargs):
        return LLMResponse(content="optimized: " + messages[-1]["content"])


@pytest.mark.asyncio
async def test_cancel_during_batch_terminates_all_jobs():
    """批量生成中途取消：gather 内所有 job 协程被终止，迟到响应不产生结果。"""
    from app.agent.tools.media_batch import GenerateMediaBatchTool

    started = asyncio.Event()
    release = asyncio.Event()

    class BlockingSvc:
        def __init__(self):
            self.completed = 0

        async def generate(self, request):
            started.set()
            await release.wait()
            self.completed += 1
            return MediaResult(url="https://x/late.png", kind=request.kind)

    svc = BlockingSvc()
    ctx = ToolContext(task_id="t-cancel-batch", llm_client=_PromptLLM(), media_service=svc)
    run = asyncio.create_task(GenerateMediaBatchTool().call(ctx, {
        "jobs": [
            {"kind": "image", "prompt": "job a"},
            {"kind": "image", "prompt": "job b"},
        ],
    }))
    await started.wait()
    run.cancel()
    with pytest.raises(asyncio.CancelledError):
        await run
    # 迟到的 provider 响应不会写成任何结果
    release.set()
    await asyncio.sleep(0)
    assert run.cancelled()
    assert svc.completed == 0


def test_stop_cancels_runtime_and_auto_recovery_jobs(client, db_session, monkeypatch):
    """stop 端点同时取消 runtime job 和 auto-recovery job。"""
    from app.routers import agent as agent_router

    class _Job:
        def __init__(self):
            self.cancelled = False

        def done(self):
            return self.cancelled

        def cancel(self):
            self.cancelled = True

    task = AgentTask(
        id="t-cancel-stop", project_id="p1", user_goal="stop batch", status="running",
        plan=[], artifacts={}, total_cost_usd=0.0, total_tokens=0,
        max_steps=30, skip_confirm=False,
    )
    db_session.add(task)
    db_session.commit()
    runtime_job = _Job()
    recovery_job = _Job()
    monkeypatch.setitem(agent_router._RUNNING_TASKS, "t-cancel-stop", runtime_job)
    monkeypatch.setitem(agent_router._AUTO_RECOVERY_TASKS, "t-cancel-stop", recovery_job)

    response = client.post("/api/agent/tasks/t-cancel-stop/stop")

    assert response.status_code == 200
    assert response.json()["status"] == "cancelled"
    db_session.refresh(task)
    assert task.status == "cancelled"
    assert runtime_job.cancelled is True
    assert recovery_job.cancelled is True
    # 终态事件带 cancelled 标记，前端据此停止重连
    events = event_bus.get_replay("t-cancel-stop")
    failed = [e for e in events if e.type == EventType.TASK_FAILED]
    assert failed and failed[-1].payload.get("cancelled") is True


def test_retry_after_cancel_drains_active_handle_and_resets(client, db_session, monkeypatch):
    """取消后重试：活跃旧句柄先取消并排干，步骤与事件日志清空，状态复位 pending。"""
    from app.routers import agent as agent_router

    class ActiveJob:
        def __init__(self):
            self.cancelled = False

        def done(self):
            return False

        def cancel(self):
            self.cancelled = True

        def __await__(self):
            # 模拟被 cancel 的 asyncio task：shield 等待时立即抛 CancelledError
            raise asyncio.CancelledError()
            yield

    task = AgentTask(
        id="t-cancel-retry", project_id="p1", user_goal="retry after cancel", status="cancelled",
        plan=[{"title": "old"}], artifacts={"image": [{"id": "old"}]},
        total_cost_usd=0.5, total_tokens=10, max_steps=30, skip_confirm=False,
    )
    db_session.add(task)
    db_session.add(AgentStep(
        id="step-cancel-retry-1", task_id="t-cancel-retry", step_number=1,
        thought="old", action={}, observation={}, status="success",
    ))
    db_session.commit()
    event_bus.clear_log("t-cancel-retry")
    job = ActiveJob()
    monkeypatch.setitem(agent_router._RUNNING_TASKS, "t-cancel-retry", job)

    async def noop_spawn(_task_dict):
        return None

    monkeypatch.setattr("app.routers.agent._spawn_runtime", noop_spawn)
    response = client.post("/api/agent/tasks/t-cancel-retry/retry")

    assert response.status_code == 200, response.text
    assert response.json()["status"] == "pending"
    assert job.cancelled is True
    db_session.refresh(task)
    assert task.status == "pending"
    assert task.plan == []
    assert task.artifacts == {}
    assert task.total_cost_usd == 0
    assert db_session.query(AgentStep).filter_by(task_id="t-cancel-retry").count() == 0
    # SSE 事件日志已清空：重连重放不会立即遇到旧终态事件而关闭
    terminal = [
        e for e in event_bus.get_replay("t-cancel-retry")
        if e.type in (EventType.TASK_DONE, EventType.TASK_FAILED)
    ]
    assert terminal == []
