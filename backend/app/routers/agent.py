"""Agent API 路由：任务管理 + SSE 事件流 + 用户响应。"""
from __future__ import annotations

import asyncio
import json
import logging
import uuid
from datetime import datetime
from typing import Any, Optional

from ..models import _now

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from .. import schemas
from ..database import SessionLocal, get_db
from ..models import AgentTask, AgentStep, Asset
from ..agent.events import event_bus, AgentEvent, EventType
from ..agent.memory import AgentMemory, StepRecord
from ..agent.runtime import AgentRuntime, AgentState
from ..agent.tools import build_default_registry
from ..agent.llm_factory import load_llm_configs, select_llm_for_task, NoLLMConfigured
from ..agent.tools import list_tool_metadata
from ..agent.media_service import DatabaseMediaService
from ..agent.capabilities import CapabilityConfigurationError, resolve_capability_bindings
from ..agent.task_profiles import TaskProfile, classify_task

logger = logging.getLogger(__name__)
router = APIRouter()


def _gen_id() -> str:
    return uuid.uuid4().hex[:12]


def _profile_for_goal(db: Session, user_goal: str, project_id: str | None) -> TaskProfile:
    assets = []
    if project_id:
        assets = [
            {"kind": asset.kind, "asset_kind": asset.asset_kind, "title": asset.title, "name": asset.name}
            for asset in db.query(Asset).filter(Asset.project_id == project_id).all()
        ]
    return classify_task(user_goal, None, assets)


# ========================
# Runtime 注册表：task_id → 正在运行的 asyncio.Task
# ========================
# 用 in-memory dict 记录所有正在跑的 runtime 后台 task。
# key: task_id, value: (AgentRuntime, asyncio.Task)
# pause / resume / user_respond 都通过这里找到 runtime。
_RUNNING_RUNTIMES: dict[str, AgentRuntime] = {}
_RUNNING_TASKS: dict[str, asyncio.Task] = {}
_RUNNING_LOCK = asyncio.Lock()


def _schedule_runtime(task_id: str, coroutine) -> asyncio.Task:
    """Register a runtime task so the stop endpoint can cancel it."""
    job = asyncio.create_task(coroutine)
    _RUNNING_TASKS[task_id] = job

    def _forget(done: asyncio.Task) -> None:
        if _RUNNING_TASKS.get(task_id) is done:
            _RUNNING_TASKS.pop(task_id, None)

    job.add_done_callback(_forget)
    return job


# ========================
# 任务管理
# ========================

@router.get("/tools", response_model=list[schemas.ToolMetadataOut])
def get_agent_tools():
    """返回 18 个工具的元数据列表（供前端 ToolPalette 渲染）。"""
    return list_tool_metadata()


@router.post("/tasks", response_model=schemas.AgentTaskOut)
async def create_task(body: schemas.AgentTaskCreate, db: Session = Depends(get_db)):
    """创建 agent 任务并在 FastAPI 主 event loop 中启动 AgentRuntime。

    必须是 `async def`：之前 `def` + `threading.Thread(daemon=True).start()` 回退
    会让每个 task 占一个 starlette 线程池线程跑完整 agent，SQLite 多线程写有锁竞争，
    累积下来把 40 线程的 default pool 耗尽，导致任何 HTTP 请求都挂死。
    改为 async 后用 `asyncio.create_task` 把 runtime 调度到同一个 event loop，
    与 HTTP 请求交错执行，不消耗 threadpool。
    """
    try:
        capabilities = resolve_capability_bindings(db)
    except CapabilityConfigurationError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    llm_binding = capabilities["llm"]
    profile = _profile_for_goal(db, body.user_goal, body.project_id)
    task = AgentTask(
        id=_gen_id(),
        project_id=body.project_id,
        user_goal=body.user_goal,
        status="pending",
        plan=[],
        artifacts={},
        total_cost_usd=0.0,
        total_tokens=0,
        max_steps=body.max_steps,
        skip_confirm=body.skip_confirm,
        llm_provider_id=llm_binding["provider_id"],
        llm_model_id=llm_binding["model_id"],
        task_profile=profile.model_dump(mode="json"),
        rule_pack_version=profile.rule_pack_id.rsplit(".", 1)[-1],
    )
    db.add(task)
    db.commit()
    db.refresh(task)
    task_dict = task.to_dict()

    # 已在 FastAPI 主 event loop 中：直接调度 runtime 协程
    # 必须在 task_dict 取得后再调度——后台 task 立即读 task_dict
    _schedule_runtime(task_dict["id"], _spawn_runtime(task_dict))

    return task_dict


@router.get("/tasks", response_model=list[schemas.AgentTaskOut])
def list_tasks(
    project_id: Optional[str] = Query(None),
    db: Session = Depends(get_db),
):
    """列出任务；可用 ?project_id=XXX 过滤。"""
    q = db.query(AgentTask)
    if project_id is not None:
        q = q.filter(AgentTask.project_id == project_id)
    tasks = q.order_by(AgentTask.created_at.desc()).all()
    return [t.to_dict() for t in tasks]


@router.get("/tasks/{task_id}", response_model=schemas.AgentTaskOut)
def get_task(task_id: str, db: Session = Depends(get_db)):
    """获取任务详情。"""
    task = db.query(AgentTask).filter_by(id=task_id).first()
    if not task:
        raise HTTPException(404, f"Task {task_id} not found")
    return task.to_dict()


@router.patch("/tasks/{task_id}", response_model=schemas.AgentTaskOut)
def update_task(task_id: str, body: schemas.AgentTaskUpdate, db: Session = Depends(get_db)):
    """更新任务状态/计划/资产。"""
    task = db.query(AgentTask).filter_by(id=task_id).first()
    if not task:
        raise HTTPException(404, f"Task {task_id} not found")
    if body.status is not None:
        task.status = body.status
    if body.plan is not None:
        task.plan = body.plan
    if body.artifacts is not None:
        task.artifacts = body.artifacts
    if body.pending_response is not None:
        task.pending_response = body.pending_response
    if body.total_cost_usd is not None:
        task.total_cost_usd = body.total_cost_usd
    if body.total_tokens is not None:
        task.total_tokens = body.total_tokens
    if body.skip_confirm is not None:
        task.skip_confirm = body.skip_confirm
    db.commit()
    db.refresh(task)
    return task.to_dict()


@router.delete("/tasks/{task_id}")
def delete_task(task_id: str, db: Session = Depends(get_db)):
    """删除任务。"""
    task = db.query(AgentTask).filter_by(id=task_id).first()
    if not task:
        raise HTTPException(404, f"Task {task_id} not found")
    db.delete(task)
    db.commit()
    return {"ok": True}


# ========================
# 步骤查询
# ========================

@router.get("/tasks/{task_id}/steps", response_model=list[schemas.AgentStepOut])
def list_steps(task_id: str, db: Session = Depends(get_db)):
    """列出任务的所有步骤。"""
    steps = db.query(AgentStep).filter_by(task_id=task_id).order_by(AgentStep.step_number).all()
    return [s.to_dict() for s in steps]


# ========================
# SSE 事件流
# ========================

# 后端 heartbeat 间隔。必须远小于前端 agent-stream-manager.ts 的 HEARTBEAT_TIMEOUT（45s），
# 否则 agent PAUSED（等待用户回答 ask_user）时无真实事件，完全依赖 heartbeat 保活，
# 前后端 timeout 相等会导致竞态条件误判断线（"heartbeat timeout, reconnecting"）。
HEARTBEAT_INTERVAL_S = 15.0


def _sse_heartbeat() -> str:
    """Return a named SSE heartbeat that EventSource can observe."""
    return "event: heartbeat\ndata: {}\n\n"


@router.get("/tasks/{task_id}/stream")
async def stream_events(task_id: str):
    """SSE 推送 agent 事件。

    关键行为：
    1. 订阅时立即 yield `event_bus.get_replay(task_id)` 的全部历史事件
       ——修复"runtime 启动 vs SSE subscribe"的竞态丢失（用户重连也能看到进度）。
    2. 之后 await queue.get() 接收 live 事件。
    3. 收到 task_done / task_failed 时 break，断开 SSE。
    4. 每 HEARTBEAT_INTERVAL_S 无事件 yield heartbeat 防代理超时。
    """
    queue = event_bus.subscribe(task_id)
    pending_response_holder: dict[str, Any] = {"value": None, "event": None}

    async def event_generator():
        try:
            # 1. 重放历史事件：把 runtime 已经 emit 过的所有事件补发给新 SSE 客户端。
            #    这是修复"前端显示 0 想法 0 动作"的关键——runtime 在 create_task
            #    返回后立即启动并开始 emit，而 EventSource 在前端 setTask 之后才
            #    打开，中间的所有事件都进不了 SSE；重放保证不丢。
            replay_events = event_bus.get_replay(task_id)
            for idx, past in enumerate(replay_events):
                yield past.to_sse(event_id=int(past.timestamp * 1000))
                # 只有当 TASK_DONE/TASK_FAILED 是最后一个事件时才关闭 stream。
                # 如果不是最后一个（说明 task 之前失败过但后来 retry/resume 了），
                # 继续重放后续事件，避免前端误判 task 已结束。
                if past.type in (EventType.TASK_DONE, EventType.TASK_FAILED) and idx == len(replay_events) - 1:
                    # task 已结束，没有 live 事件了；直接关闭 stream
                    return

            # 2. 进入 live 事件循环
            while True:
                try:
                    event: AgentEvent = await asyncio.wait_for(queue.get(), timeout=HEARTBEAT_INTERVAL_S)
                    yield event.to_sse(event_id=int(event.timestamp * 1000))
                    if event.type in (EventType.TASK_DONE, EventType.TASK_FAILED):
                        break
                except asyncio.TimeoutError:
                    # 心跳
                    yield _sse_heartbeat()
        finally:
            event_bus.unsubscribe(task_id, queue)

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        },
    )


# ========================
# 用户响应
# ========================

@router.post("/tasks/{task_id}/respond")
async def user_respond(task_id: str, body: schemas.AgentUserResponse, db: Session = Depends(get_db)):
    """接收用户对 ask_user / plan 审核 / 工具失败恢复的响应。

    Spec B: 支持 recovery_action / new_model_id 字段。
    """
    task = db.query(AgentTask).filter_by(id=task_id).first()
    if not task:
        raise HTTPException(404, f"Task {task_id} not found")
    task.pending_response = {
        "response": body.response,
        "custom_text": body.custom_text,
        "approved": body.approved,
    }
    if body.recovery_action:
        task.pending_response["recovery_action"] = body.recovery_action
    if body.new_model_id:
        task.pending_response["new_model_id"] = body.new_model_id
    if body.approved is False and task.status == "paused":
        task.status = "failed"  # 用户拒绝
    db.commit()
    # 推送 USER_INPUT_RECEIVED 事件
    await event_bus.publish(AgentEvent(
        task_id=task_id, type=EventType.USER_INPUT_RECEIVED,
        payload={
            "response": body.response,
            "custom_text": body.custom_text,
            "approved": body.approved,
            "recovery_action": body.recovery_action,
            "new_model_id": body.new_model_id,
        },
    ))
    return {"ok": True}


# ========================
# Runtime 主循环
# ========================

async def _spawn_runtime(task_dict: dict) -> None:
    """异步启动 AgentRuntime 主循环（首次创建任务时调用）。

    流程：
    1. 构造 memory / registry / llm / runtime
    2. 构造真实媒体工具上下文
    3. 注册到 _RUNNING_RUNTIMES
    4. 跑主循环（见 _run_runtime_loop）
    5. 完成后清理注册表
    """
    task_id = task_dict["id"]
    runtime_db = None
    try:
        # 1. 选 LLM：必须从 DB 选真实 LLM，无 provider 配置时直接抛错
        # 任务在新的 DB 会话里跑，避免 asyncio.create_task 里持有 request-scoped session
        from ..database import SessionLocal
        with SessionLocal() as db:
            configs = load_llm_configs(db)
            try:
                capabilities = resolve_capability_bindings(db)
            except CapabilityConfigurationError as e:
                logger.error("[continue_runtime] task %s invalid capability bindings: %s", task_id, e)
                await event_bus.publish(AgentEvent(
                    task_id=task_id, type=EventType.TASK_FAILED,
                    payload={"error": str(e), "reason_code": "capability_binding_invalid"},
                ))
                _update_task_status(task_id, "failed")
                return
        try:
            llm = select_llm_for_task(
                task_provider_id=task_dict.get("llm_provider_id"),
                configs=configs,
                task_model_id=task_dict.get("llm_model_id"),
            )
        except NoLLMConfigured as e:
            reason = str(e)
            reason_code = e.reason_code
            logger.error("[spawn_runtime] task %s aborted: %s", task_id, reason)
            # 推送 task_failed 事件，前端 UI 能看到
            await event_bus.publish(AgentEvent(
                task_id=task_id,
                type=EventType.TASK_FAILED,
                payload={
                    "task_id": task_id,
                    "error": reason,
                    "reason_code": reason_code,
                    "stage": "spawn",
                },
            ))
            _update_task_status(task_id, "failed")
            return

        # 2. 构造 memory
        memory = AgentMemory(user_goal=task_dict.get("user_goal") or "")

        # 3. 构造工具注册表
        registry = build_default_registry()

        # 4. 构造 runtime
        # 5. 构造 runtime
        # ToolContext 需要真实 DB session 才能让 save_asset/get_artifacts 生效。
        # 不能只依赖每轮持久化函数的独立 session，否则资产工具会走 no-db 占位分支。
        runtime_db = SessionLocal()
        runtime = AgentRuntime(
            task_id=task_id,
            llm=llm,
            memory=memory,
            registry=registry,
            project_id=task_dict.get("project_id"),
            db=runtime_db,
            max_steps=task_dict.get("max_steps", 30) or 30,
            skip_confirm=bool(task_dict.get("skip_confirm", False)),
            profile=TaskProfile.model_validate(task_dict["task_profile"]) if task_dict.get("task_profile") else None,
            media_service=DatabaseMediaService(
                runtime_db,
                task_dict.get("llm_provider_id"),
                capabilities,
            ),
        )

        # 6. 注册 runtime
        async with _RUNNING_LOCK:
            if task_id in _RUNNING_RUNTIMES:
                logger.warning("runtime for task %s already exists; skip", task_id)
                return
            _RUNNING_RUNTIMES[task_id] = runtime

        # 7. 发 TASK_STARTED 事件
        #    llm_mode / llm_fallback_reason 必须带 — 前端 store 的 task_started
        #    handler 据此切 llmMode 状态、隐藏"等待 runtime..."占位横幅。
        #    当前 LLMFactory.select_llm_for_task 要么返回真实 LLM，要么抛错，
        #    所以跑到这里一定是 'real'（'stub' 路径已不存在）。
        llm_mode = "real"
        llm_fallback_reason: str | None = None
        if task_dict.get("llm_provider_id"):
            llm_mode = "real"
        await event_bus.publish(AgentEvent(
            task_id=task_id, type=EventType.TASK_STARTED,
            payload={
                "task_id": task_id,
                "user_goal": task_dict.get("user_goal"),
                "llm_mode": llm_mode,
                "llm_fallback_reason": llm_fallback_reason,
            },
        ))

        # 8. 更新 task 状态到 running
        _update_task_status(task_id, "running")

        # 9. 跑主循环
        await _run_runtime_loop(task_id, runtime, memory)

    except Exception as e:  # noqa: BLE001
        logger.exception("runtime for task %s failed", task_id)
        _update_task_status(task_id, "failed")
        try:
            await event_bus.publish(AgentEvent(
                task_id=task_id, type=EventType.TASK_FAILED,
                payload={"error": str(e)},
            ))
        except Exception:
            pass
    finally:
        if runtime_db is not None:
            runtime_db.close()
        async with _RUNNING_LOCK:
            _RUNNING_RUNTIMES.pop(task_id, None)
            _RUNNING_TASKS.pop(task_id, None)


async def _continue_runtime(task_id: str) -> None:
    """从 PAUSED 恢复 runtime（用 DB 里的 step 重建 memory）。

    流程：
    1. 从 DB 重新构造 memory（plan / short_term / artifacts）
    2. 重新选 LLM
    3. 用 task.pending_response 调用 runtime.resume() 注入用户响应
    4. 跑主循环直到完成 / 下次暂停
    """
    from ..database import SessionLocal
    from ..models import AgentStep

    runtime_db = None
    try:
        # 1. 读 task + steps 重建 memory
        with SessionLocal() as db:
            task_row = db.query(AgentTask).filter_by(id=task_id).first()
            if not task_row:
                logger.error("[continue_runtime] task %s not found", task_id)
                return
            if task_row.task_profile is None:
                legacy_profile = _profile_for_goal(db, task_row.user_goal or "", task_row.project_id)
                task_row.task_profile = legacy_profile.model_dump(mode="json")
                task_row.rule_pack_version = legacy_profile.rule_pack_id.rsplit(".", 1)[-1]
                db.commit()
            task_dict = {
                "id": task_row.id,
                "user_goal": task_row.user_goal,
                "llm_provider_id": task_row.llm_provider_id,
                "llm_model_id": task_row.llm_model_id,
                "max_steps": task_row.max_steps or 30,
                "skip_confirm": task_row.skip_confirm,
                "project_id": task_row.project_id,
                "pending_response": task_row.pending_response or {},
                "plan": list(task_row.plan or []),
                "artifacts": dict(task_row.artifacts or {}),
                "task_profile": task_row.task_profile,
                "rule_pack_version": task_row.rule_pack_version,
                "conversation_turns": list(task_row.conversation_turns or []),
                "memory_summary": task_row.memory_summary or "",
            }
            steps = db.query(AgentStep).filter_by(task_id=task_id).order_by(AgentStep.step_number).all()
            memory = AgentMemory(user_goal=task_dict["user_goal"], plan=task_dict["plan"])
            memory.artifacts = task_dict["artifacts"]
            memory.conversation_turns = task_dict["conversation_turns"]
            memory.compressed_summary = task_dict["memory_summary"]
            for s in steps:
                memory.short_term.append(StepRecord(
                    step_number=s.step_number,
                    thought=s.thought or "",
                    action=s.action or {},
                    observation=s.observation or {},
                    status=s.status or "success",
                    cost_usd=s.cost_usd or 0.0,
                    tokens=s.tokens or 0,
                ))

        # 2. 重新选 LLM
        with SessionLocal() as db:
            configs = load_llm_configs(db)
        try:
            llm = select_llm_for_task(
                task_provider_id=task_dict.get("llm_provider_id"),
                configs=configs,
                task_model_id=task_dict.get("llm_model_id"),
            )
        except NoLLMConfigured as e:
            logger.error("[continue_runtime] task %s no LLM: %s", task_id, e)
            await event_bus.publish(AgentEvent(
                task_id=task_id, type=EventType.TASK_FAILED,
                payload={"error": str(e), "reason_code": e.reason_code},
            ))
            _update_task_status(task_id, "failed")
            return

        # 3. 构造 registry + 注入 media service
        registry = build_default_registry()
        # 4. 构造 runtime，从 PAUSED 状态启动以匹配 pending_request
        # 恢复路径同样必须注入 DB，否则恢复后的 save_asset 仍会静默不落库。
        with SessionLocal() as db:
            capabilities = resolve_capability_bindings(db)
        runtime_db = SessionLocal()
        runtime = AgentRuntime(
            task_id=task_id,
            llm=llm,
            memory=memory,
            registry=registry,
            project_id=task_dict.get("project_id"),
            db=runtime_db,
            max_steps=task_dict["max_steps"],
            skip_confirm=task_dict["skip_confirm"],
            profile=TaskProfile.model_validate(task_dict["task_profile"]) if task_dict.get("task_profile") else None,
            media_service=DatabaseMediaService(
                runtime_db,
                task_dict.get("llm_provider_id"),
                capabilities,
            ),
        )
        # 恢复 step_count 与 state：基于 memory 现有 step 数量
        runtime._step_count = len(memory.short_term)
        # 找出最近一个 ask_user 步（status=pending），重建 pending_request
        last_pending = next(
            (s for s in reversed(memory.short_term) if s.status == "pending"),
            None,
        )
        if last_pending is not None and last_pending.action.get("tool") == "ask_user":
            params = last_pending.action.get("params", {}) or {}
            runtime.pending_request = {
                "type": "ask_user",
                "step_id": params.get("step_id", "clarify_source"),
                "question": params.get("question", ""),
                "options": params.get("options", []),
                "missing_inputs": params.get("missing_inputs", []),
                "selection_mode": params.get("selection_mode", "text"),
                "allow_custom": params.get("allow_custom", True),
            }
            runtime.state = AgentState.PAUSED
        elif task_dict.get("pending_response", {}).get("recovery_action"):
            # Spec B: 工具失败恢复路径
            runtime.pending_request = {
                "type": "tool_error",
                "recovery_action": task_dict["pending_response"].get("recovery_action"),
                "new_model_id": task_dict["pending_response"].get("new_model_id"),
            }
            runtime.state = AgentState.PAUSED

        # 5. 注册
        async with _RUNNING_LOCK:
            if task_id in _RUNNING_RUNTIMES:
                logger.warning("runtime for task %s already running", task_id)
                return
            _RUNNING_RUNTIMES[task_id] = runtime

        # 6. 注入用户响应
        pending_response = task_dict.get("pending_response") or {}
        continue_message = pending_response.get("continue_message")
        if continue_message:
            # 继续对话路径：任务已完成，用户追加需求。
            # continue_conversation 要求 state == DONE，先设好再调用。
            runtime.state = AgentState.DONE
            await runtime.continue_conversation(continue_message)
            _persist_steps(task_id, memory, runtime)
            _sync_task_artifacts(task_id, memory, runtime)
            _sync_conversation_memory(task_id, memory)
        else:
            user_response = pending_response
            if runtime.state == AgentState.PAUSED and user_response is not None:
                # resume() 会把 user_response 注入 memory 并跑一步；后续主循环会接管
                await runtime.resume(user_response)
                # 把刚 step 出来的 step 落库
                _persist_steps(task_id, memory, runtime)
                _sync_task_artifacts(task_id, memory, runtime)

        # 7. 跑主循环
        _update_task_status(task_id, "running")
        await _run_runtime_loop(task_id, runtime, memory)

    except Exception as e:  # noqa: BLE001
        logger.exception("continue_runtime for task %s failed", task_id)
        # 失败回滚策略：
        # 区分 resume 前失败（pending_response 还没被 consume）vs resume 后失败
        # （pending_request 已被清空但 step 已注入）。两种情况都把 task 状态
        # 回滚为 paused，并尽量保留 pending_response 字段，让用户重新调
        # /resume 重试（重复 resume 的副作用是 memory 多一个 observation，
        # 但不会卡死；好过丢失用户输入）。
        with SessionLocal() as db:
            task_row = db.query(AgentTask).filter_by(id=task_id).first()
            if task_row is not None and task_row.status == "running":
                # pending_response 仍存在 → 未被 consume，保留
                # pending_response 已被清空 → 找最近 ask_user step 的
                # observation.user_response 重建回去（用户输入不丢）
                if not task_row.pending_response:
                    from ..models import AgentStep as _Step
                    last_ask = (
                        db.query(_Step)
                        .filter_by(task_id=task_id, status="success")
                        .order_by(_Step.step_number.desc())
                        .first()
                    )
                    if last_ask and (last_ask.action or {}).get("tool") == "ask_user":
                        ur = (last_ask.observation or {}).get("user_response")
                        if ur is not None:
                            task_row.pending_response = {"response": ur}
                            db.commit()
                task_row.status = "paused"
                task_row.updated_at = _now()
                db.commit()
        try:
            await event_bus.publish(AgentEvent(
                task_id=task_id, type=EventType.TASK_FAILED,
                payload={"error": str(e), "recoverable": True, "hint": "task rolled back to paused; pending_response preserved; call /resume to retry"},
            ))
        except Exception:
            pass
    finally:
        if runtime_db is not None:
            runtime_db.close()
        async with _RUNNING_LOCK:
            _RUNNING_RUNTIMES.pop(task_id, None)
            _RUNNING_TASKS.pop(task_id, None)


async def _run_runtime_loop(task_id: str, runtime: AgentRuntime, memory: AgentMemory) -> None:
    """共享的主循环：每轮检查 PAUSED 状态避免空转，跑完所有步或遇 PAUSED 退出。"""
    from ..agent.runtime import AgentState

    for _ in range(int(runtime.max_steps) + 5):
        # 如果 runtime 进入 PAUSED（ask_user / plan 审核 / 工具失败恢复等），
        # 不要继续空跑；让出循环等用户响应。
        if runtime.state == AgentState.PAUSED:
            logger.info("[runtime loop] task %s paused; waiting for user input", task_id)
            _update_task_status(task_id, "paused")
            return
        done = await runtime.step()
        # 把每步的 memory 写入数据库
        _persist_steps(task_id, memory, runtime)
        # 同步 plan / artifacts / cost
        _sync_task_artifacts(task_id, memory, runtime)
        if done:
            break

    # 任务完成
    if runtime.state == AgentState.PAUSED:
        # step() 把状态切到 PAUSED，跳出循环后单独走 paused 路径
        _update_task_status(task_id, "paused")
        return
    if runtime.state == AgentState.FAILED:
        # step() 内部已发 TASK_FAILED 事件（如超 max_steps），
        # 这里只更新 DB 状态，不再重复发事件。
        _update_task_status(task_id, "failed")
        return
    if runtime.state == AgentState.CANCELLED:
        _update_task_status(task_id, "cancelled")
        return
    if runtime.state == AgentState.DONE:
        # finish_task 分支已发 TASK_DONE（含 assets_summary / missing_deliverables
        # 等详情），这里只更新 DB 状态，不重复发事件，避免覆盖详细 payload。
        _update_task_status(task_id, "done")
        return
    # 兜底：理论上不会走到这里（loop 退出时 state 必为 PAUSED/FAILED/CANCELLED/DONE）
    final_status = "done" if runtime.state.value == "done" else "failed"
    _update_task_status(task_id, final_status)
    await event_bus.publish(AgentEvent(
        task_id=task_id,
        type=EventType.TASK_DONE if final_status == "done" else EventType.TASK_FAILED,
        payload={"summary": f"agent finished with {len(memory.short_term)} steps"},
    ))


def _update_task_status(task_id: str, status: str) -> None:
    """在新的 DB session 中更新 task 状态。"""
    try:
        with SessionLocal() as db:
            t = db.query(AgentTask).filter_by(id=task_id).first()
            if t:
                t.status = status
                t.updated_at = _now()
                db.commit()
    except Exception as e:
        logger.warning("failed to update task %s status: %s", task_id, e)


def _persist_steps(task_id: str, memory: AgentMemory, runtime: AgentRuntime) -> None:
    """把 memory.short_term 中所有 step 持久化到数据库（只追加新的）。"""
    try:
        with SessionLocal() as db:
            existing_steps = db.query(AgentStep).filter_by(task_id=task_id).order_by(AgentStep.step_number).all()
            existing = len(existing_steps)
            for i, s in enumerate(memory.short_term):
                if i < existing:
                    row = existing_steps[i]
                    row.thought = s.thought or ""
                    row.action = s.action or {}
                    row.observation = s.observation or {}
                    row.status = s.status
                    row.cost_usd = s.cost_usd
                    row.tokens = s.tokens
                    row.finished_at = _now()
                    continue
                step = AgentStep(
                    id=_gen_id(),
                    task_id=task_id,
                    step_number=s.step_number,
                    thought=s.thought or "",
                    action=s.action or {},
                    observation=s.observation or {},
                    status=s.status,
                    cost_usd=s.cost_usd,
                    tokens=s.tokens,
                    started_at=_now(),
                    finished_at=_now(),
                )
                db.add(step)
            db.commit()
    except Exception as e:
        logger.warning("failed to persist steps for %s: %s", task_id, e)


def _sync_task_artifacts(task_id: str, memory: AgentMemory, runtime: AgentRuntime | None = None) -> None:
    """同步 memory 的 plan / artifacts / cost 到 task 记录。"""
    try:
        with SessionLocal() as db:
            t = db.query(AgentTask).filter_by(id=task_id).first()
            if not t:
                return
            if memory.plan:
                t.plan = list(memory.plan)
            if memory.artifacts:
                t.artifacts = dict(memory.artifacts)
            t.total_cost_usd = memory.total_cost_usd
            t.total_tokens = memory.total_tokens
            # 多轮对话记忆持久化
            t.conversation_turns = list(memory.conversation_turns)
            t.memory_summary = memory.compressed_summary or None
            if runtime is not None and runtime.profile is not None:
                t.task_profile = runtime.profile.model_dump(mode="json")
                t.rule_pack_version = runtime.profile.rule_pack_id.rsplit(".", 1)[-1]
            t.updated_at = _now()
            db.commit()
    except Exception as e:
        logger.warning("failed to sync artifacts for %s: %s", task_id, e)


def _sync_conversation_memory(task_id: str, memory: AgentMemory) -> None:
    """单独同步多轮对话记忆字段（压缩后立即调用）。"""
    try:
        with SessionLocal() as db:
            t = db.query(AgentTask).filter_by(id=task_id).first()
            if not t:
                return
            t.conversation_turns = list(memory.conversation_turns)
            t.memory_summary = memory.compressed_summary or None
            t.user_goal = memory.user_goal
            t.updated_at = _now()
            db.commit()
    except Exception as e:
        logger.warning("failed to sync conversation memory for %s: %s", task_id, e)


# ========================
# 控制
# ========================

@router.post("/tasks/{task_id}/pause")
async def pause_task(task_id: str, db: Session = Depends(get_db)):
    """暂停任务。"""
    task = db.query(AgentTask).filter_by(id=task_id).first()
    if not task:
        raise HTTPException(404, f"Task {task_id} not found")
    if task.status != "running":
        raise HTTPException(400, f"Cannot pause task in status {task.status}")
    task.status = "paused"
    db.commit()
    # 设置 runtime 状态为 PAUSED
    runtime = _RUNNING_RUNTIMES.get(task_id)
    if runtime is not None:
        from ..agent.runtime import AgentState
        runtime.state = AgentState.PAUSED
    await event_bus.publish(AgentEvent(task_id=task_id, type=EventType.TASK_PAUSED, payload={}))
    return {"ok": True}


@router.post("/tasks/{task_id}/stop")
async def stop_task(task_id: str, db: Session = Depends(get_db)):
    """停止正在运行或排队中的任务。"""
    task = db.query(AgentTask).filter_by(id=task_id).first()
    if not task:
        raise HTTPException(404, f"Task {task_id} not found")
    if task.status not in ("pending", "running"):
        raise HTTPException(400, f"Cannot stop task in status {task.status}")
    task.status = "cancelled"
    task.updated_at = _now()
    db.commit()
    runtime = _RUNNING_RUNTIMES.get(task_id)
    job = _RUNNING_TASKS.get(task_id)
    if runtime is not None:
        runtime.state = AgentState.CANCELLED
    if job is not None and not job.done():
        job.cancel()
    await event_bus.publish(AgentEvent(
        task_id=task_id, type=EventType.TASK_FAILED,
        payload={"error": "task stopped by user", "cancelled": True},
    ))
    return {"ok": True, "task_id": task_id, "status": "cancelled"}


@router.post("/tasks/{task_id}/retry")
async def retry_task(
    task_id: str,
    body: schemas.AgentTaskRetry | None = None,
    db: Session = Depends(get_db),
):
    """从头重试失败或已停止的任务。"""
    from ..models import AgentStep

    task = db.query(AgentTask).filter_by(id=task_id).first()
    if not task:
        raise HTTPException(404, f"Task {task_id} not found")
    if task.status not in ("failed", "cancelled"):
        raise HTTPException(400, f"Cannot retry task in status {task.status}")
    # A terminal event can reach the client just before the runtime task's
    # finally block removes its in-memory handles. A finished handle must not
    # permanently block retry; an active one is cancelled and drained first.
    stale_runtime = _RUNNING_RUNTIMES.pop(task_id, None)
    if stale_runtime is not None:
        stale_runtime.state = AgentState.CANCELLED
    stale_job = _RUNNING_TASKS.pop(task_id, None)
    if stale_job is not None:
        is_done = stale_job.done() if hasattr(stale_job, "done") else False
        if not is_done:
            if not hasattr(stale_job, "cancel"):
                raise HTTPException(409, "Task is still running")
            stale_job.cancel()
            try:
                await asyncio.wait_for(asyncio.shield(stale_job), timeout=2.0)
            except asyncio.CancelledError:
                pass
            except asyncio.TimeoutError as exc:
                raise HTTPException(409, "Task is still running") from exc
    db.query(AgentStep).filter_by(task_id=task_id).delete()
    # 清空 SSE 事件日志：retry 是全新生命周期，旧的 TASK_FAILED 等终态事件
    # 如果留在 _event_log 中，SSE 重连重放时会立即关闭连接（stream 遇到
    # TASK_DONE/TASK_FAILED 就 return），导致前端误判 task 已结束。
    event_bus.clear_log(task_id)
    task.status = "pending"
    task.plan = []
    task.artifacts = {}
    task.pending_response = None
    task.total_cost_usd = 0.0
    task.total_tokens = 0
    # Agent 模式与普通画布共用步骤绑定。历史任务可能没有保存模型，
    # 重试时用当前画布绑定覆盖，避免后端按 provider 的首个模型盲选。
    if body is not None:
        if body.llm_provider_id is not None:
            task.llm_provider_id = body.llm_provider_id
        if body.llm_model_id is not None:
            task.llm_model_id = body.llm_model_id
    task.updated_at = _now()
    db.commit()
    db.refresh(task)
    _schedule_runtime(task_id, _spawn_runtime(task.to_dict()))
    return {"ok": True, "task_id": task_id, "status": "pending"}


@router.post("/tasks/{task_id}/resume")
async def resume_task(task_id: str, db: Session = Depends(get_db)):
    """恢复已暂停的任务。

    必须先调用 /tasks/{id}/respond 把用户输入写入 task.pending_response，
    本接口读出 pending_response → 重新构造 runtime → 从 PAUSED 继续执行。
    """
    task = db.query(AgentTask).filter_by(id=task_id).first()
    if not task:
        raise HTTPException(404, f"Task {task_id} not found")
    from ..models import AgentStep
    runtime = _RUNNING_RUNTIMES.get(task_id)
    if task.status == "running" and (runtime is not None or task_id in _RUNNING_TASKS):
        # respond and resume can race with the runtime's own transition to
        # running. Treat a duplicate resume as success instead of surfacing a
        # misleading 400 to the user.
        return {"ok": True, "task_id": task_id, "status": "already_running"}
    last_step = db.query(AgentStep).filter_by(task_id=task_id).order_by(AgentStep.step_number.desc()).first()
    can_resume_answered_question = bool(
        task.status == "failed"
        and task.pending_response
        and last_step
        and last_step.status == "pending"
        and (last_step.action or {}).get("tool") == "ask_user"
    )
    if task.status != "paused" and not can_resume_answered_question:
        raise HTTPException(400, f"Cannot resume task in status {task.status}")
    if not task.pending_response:
        is_waiting_for_user = bool(
            last_step and last_step.status == "pending" and
            (last_step.action or {}).get("tool") == "ask_user"
        )
        if is_waiting_for_user or (runtime is None and last_step is None):
            raise HTTPException(400, "task has no pending_response; call /respond first")
        task.status = "running"
        task.updated_at = _now()
        db.commit()
        await event_bus.publish(AgentEvent(task_id=task_id, type=EventType.TASK_RESUMED, payload={}))
        async def _spawn_manual_resume() -> None:
            await _continue_runtime(task_id)
        _schedule_runtime(task_id, _spawn_manual_resume())
        return {"ok": True, "task_id": task_id, "status": "resuming"}
    await event_bus.publish(AgentEvent(task_id=task_id, type=EventType.TASK_RESUMED, payload={}))
    # 用独立 asyncio task 跑 continue（不能 await 在请求 handler 里，否则会阻塞响应）
    async def _spawn() -> None:
        await _continue_runtime(task_id)
    _schedule_runtime(task_id, _spawn())
    return {"ok": True, "task_id": task_id, "status": "resuming"}


@router.post("/tasks/{task_id}/continue")
async def continue_conversation(task_id: str, body: schemas.ContinueConversationRequest, db: Session = Depends(get_db)):
    """任务完成后继续对话。

    用户对已完成任务追加需求时调用。后端把 message 写入
    pending_response.continue_message，状态改为 paused，然后
    调度 _continue_runtime 走 continue_conversation 路径。
    """
    task = db.query(AgentTask).filter_by(id=task_id).first()
    if not task:
        raise HTTPException(404, f"Task {task_id} not found")
    if task.status != "done":
        raise HTTPException(400, f"Cannot continue task in status {task.status}; only 'done' tasks can be continued")
    message = (body.message or "").strip()
    if not message:
        raise HTTPException(400, "message must not be empty")

    task.pending_response = {"continue_message": message}
    task.status = "paused"
    task.updated_at = _now()
    db.commit()

    await event_bus.publish(AgentEvent(
        task_id=task_id, type=EventType.TASK_RESUMED,
        payload={"continue_message": message},
    ))
    async def _spawn_continue() -> None:
        await _continue_runtime(task_id)
    _schedule_runtime(task_id, _spawn_continue())
    return {"ok": True, "task_id": task_id, "status": "continuing"}
