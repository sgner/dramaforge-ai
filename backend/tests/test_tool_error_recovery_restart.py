"""回归测试：tool_error 暂停 → 模拟进程重启 → _continue_runtime 重建 → resume。

Bug 背景：_continue_runtime 重建 tool_error 类型的 pending_request 时只放了
recovery_action / new_model_id，没有 step_id / tool / params / error。
随后 resume() → _resume_from_tool_error 第一行 self.pending_request["step_id"]
直接 KeyError（"工具失败 → 任务暂停 → 后端重启 → 用户点重试"必崩）。

修复后：从 DB 里最近一个 tool_error 暂停步（status=paused/failed）回填
step_id / tool / params / error，恢复路径不再 KeyError，任务能继续。

这里通过在 DB 直接构造"已暂停 + pending_response"的任务行、且不注册任何
内存 runtime，等价模拟"进程重启后用户点重试"的场景。
"""
import asyncio
import uuid

import pytest

from app.agent.events import EventType, event_bus
from app.agent.llm import LLMResponse
from app.database import SessionLocal
from app.models import AgentStep, AgentTask


class _FinishTaskLLM:
    """resume 后主循环只跑一步：直接 finish_task。"""

    model = "test-tool-error-recovery"

    async def generate(self, messages, tools=None, temperature=0.7, max_tokens=4000):
        return LLMResponse(
            tool_name="finish_task",
            tool_args={"summary": "recovered and finished"},
            cost_usd=0.0, prompt_tokens=0, completion_tokens=0,
        )

    async def generate_structured(self, messages, json_schema=None,
                                  temperature=0.7, max_tokens=4000):
        return await self.generate(messages)


@pytest.fixture
def stub_llm(monkeypatch):
    """把 LLM client 换成 stub（conftest 已 seed autostart-test provider + binding）。"""
    from app.agent import llm_factory as lf
    from app.agent import openai_llm_client as ollc

    inst = _FinishTaskLLM()
    monkeypatch.setattr(ollc, "OpenAICompatibleLLMClient", lambda **kw: inst)
    monkeypatch.setattr(lf, "OpenAICompatibleLLMClient", lambda **kw: inst)
    return inst


def _seed_paused_tool_error_task(recovery_action: str, new_model_id=None,
                                 with_failed_step: bool = True) -> str:
    """构造一个"tool_error 暂停后进程重启"的任务现场。

    现场内容（与真实暂停路径落库一致）：
    - agent_tasks: status=paused, pending_response={recovery_action, new_model_id}
    - agent_steps: step_number=1, status=paused,
      action={tool, params}, observation={error, pending: awaiting_user_recovery}
    """
    task_id = uuid.uuid4().hex[:16]
    with SessionLocal() as db:
        db.add(AgentTask(
            id=task_id,
            user_goal="test tool_error recovery after restart",
            status="paused",
            max_steps=10,
            pending_response={
                "recovery_action": recovery_action,
                "new_model_id": new_model_id,
            },
        ))
        if with_failed_step:
            db.add(AgentStep(
                id=uuid.uuid4().hex[:16],
                task_id=task_id,
                step_number=1,
                thought="try to list artifacts",
                action={"tool": "get_artifacts", "params": {"kind": "image"}},
                observation={"error": "rate limit exceeded", "pending": "awaiting_user_recovery"},
                status="paused",
            ))
        db.commit()
    return task_id


def _cleanup_task(task_id: str) -> None:
    with SessionLocal() as db:
        db.query(AgentStep).filter_by(task_id=task_id).delete()
        db.query(AgentTask).filter_by(id=task_id).delete()
        db.commit()


def _run_continue(task_id: str) -> None:
    """模拟重启后直接走 _continue_runtime（内存中无任何 runtime）。"""
    from app.routers.agent import _continue_runtime

    asyncio.run(_continue_runtime(task_id))


def _get_task(task_id: str) -> AgentTask:
    with SessionLocal() as db:
        task = db.query(AgentTask).filter_by(id=task_id).first()
        db.expunge(task)
        return task


def _get_steps(task_id: str) -> list[AgentStep]:
    with SessionLocal() as db:
        steps = (
            db.query(AgentStep)
            .filter_by(task_id=task_id)
            .order_by(AgentStep.step_number)
            .all()
        )
        for s in steps:
            db.expunge(s)
        return steps


def test_tool_error_resume_after_restart_retry(stub_llm):
    """retry：重建 pending_request 后重跑失败工具，不再 KeyError，任务跑到 done。"""
    task_id = _seed_paused_tool_error_task("retry")
    try:
        _run_continue(task_id)

        task = _get_task(task_id)
        # 修复前：KeyError → 外层 broad except 把任务回滚成 paused。
        # 修复后：恢复路径走通，retry 成功 + LLM finish_task → done。
        assert task.status == "done", f"expected done, got {task.status}"

        steps = _get_steps(task_id)
        step1 = next(s for s in steps if s.step_number == 1)
        # 原失败步被 retry 结果覆写：同一 step_number，状态变 success
        assert step1.status == "success"
        assert (step1.action or {}).get("tool") == "get_artifacts"
        assert (step1.action or {}).get("params") == {"kind": "image"}

        # 恢复事件已发出（证明走的是 _resume_from_tool_error 路径）
        events = event_bus.get_replay(task_id)
        resumed = [e for e in events if e.type == EventType.TOOL_RESUMED]
        assert resumed, "no TOOL_RESUMED event emitted"
        assert resumed[-1].payload.get("step_id") == "1"
        assert resumed[-1].payload.get("action") == "retry"
    finally:
        _cleanup_task(task_id)


def test_tool_error_resume_after_restart_skip(stub_llm):
    """skip：回填的 tool/params/error 被写进 skipped step，agent 继续跑到 done。"""
    task_id = _seed_paused_tool_error_task("skip")
    try:
        _run_continue(task_id)

        task = _get_task(task_id)
        assert task.status == "done", f"expected done, got {task.status}"

        steps = _get_steps(task_id)
        step1 = next(s for s in steps if s.step_number == 1)
        assert step1.status == "skipped"
        assert (step1.action or {}).get("tool") == "get_artifacts"
        assert (step1.action or {}).get("params") == {"kind": "image"}
        observation = step1.observation or {}
        assert observation.get("user_skip") is True
        # error 文本从 DB step 的 observation 回填
        assert observation.get("error") == "rate limit exceeded"
    finally:
        _cleanup_task(task_id)


def test_tool_error_resume_without_failed_step_degrades_gracefully(stub_llm):
    """极端情况：DB 里没有可回填的失败步 → 降级填充必填字段，仍不 KeyError。"""
    task_id = _seed_paused_tool_error_task("retry", with_failed_step=False)
    try:
        # 修复前这里必 KeyError（pending_request 只有 recovery_action/new_model_id）
        _run_continue(task_id)

        task = _get_task(task_id)
        # tool 回填为 None → registry 查不到 → "Unknown tool" 失败步，
        # 主循环继续 → LLM finish_task → done。关键是不崩溃、不回滚 paused。
        assert task.status == "done", f"expected done, got {task.status}"
    finally:
        _cleanup_task(task_id)
