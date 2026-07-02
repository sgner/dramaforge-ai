"""Agent API 路由：任务管理 + SSE 事件流 + 用户响应。"""
from __future__ import annotations

import asyncio
import json
import logging
import uuid
from datetime import datetime
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from .. import schemas
from ..database import SessionLocal, get_db
from ..models import AgentTask, AgentStep
from ..agent.events import event_bus, AgentEvent, EventType
from ..agent.memory import AgentMemory
from ..agent.runtime import AgentRuntime
from ..agent.tools import build_default_registry
from ..agent.media_service import StubMediaService
from ..agent.llm_factory import load_llm_configs_from_env, select_llm_for_task
from ..agent.dev_scripted_llm import DevScriptedLLM
from ..agent.tools import list_tool_metadata

logger = logging.getLogger(__name__)
router = APIRouter()


def _gen_id() -> str:
    return uuid.uuid4().hex[:12]


# ========================
# Runtime 注册表：task_id → 正在运行的 asyncio.Task
# ========================
# 用 in-memory dict 记录所有正在跑的 runtime 后台 task。
# key: task_id, value: (AgentRuntime, asyncio.Task)
# pause / resume / user_respond 都通过这里找到 runtime。
_RUNNING_RUNTIMES: dict[str, AgentRuntime] = {}
_RUNNING_TASKS: dict[str, asyncio.Task] = {}
_RUNNING_LOCK = asyncio.Lock()


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
        llm_provider_id=body.llm_provider_id,
        llm_model_id=body.llm_model_id,
    )
    db.add(task)
    db.commit()
    db.refresh(task)
    task_dict = task.to_dict()

    # 已在 FastAPI 主 event loop 中：直接调度 runtime 协程
    # 必须在 task_dict 取得后再调度——后台 task 立即读 task_dict
    asyncio.create_task(_spawn_runtime(task_dict))

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

@router.get("/tasks/{task_id}/stream")
async def stream_events(task_id: str):
    """SSE 推送 agent 事件。

    关键行为：
    1. 订阅时立即 yield `event_bus.get_replay(task_id)` 的全部历史事件
       ——修复"runtime 启动 vs SSE subscribe"的竞态丢失（用户重连也能看到进度）。
    2. 之后 await queue.get() 接收 live 事件。
    3. 收到 task_done / task_failed 时 break，断开 SSE。
    4. 每 30s 无事件 yield `: heartbeat` 防代理超时。
    """
    queue = event_bus.subscribe(task_id)
    pending_response_holder: dict[str, Any] = {"value": None, "event": None}

    async def event_generator():
        try:
            # 1. 重放历史事件：把 runtime 已经 emit 过的所有事件补发给新 SSE 客户端。
            #    这是修复"前端显示 0 想法 0 动作"的关键——runtime 在 create_task
            #    返回后立即启动并开始 emit，而 EventSource 在前端 setTask 之后才
            #    打开，中间的所有事件都进不了 SSE；重放保证不丢。
            for past in event_bus.get_replay(task_id):
                yield past.to_sse(event_id=int(past.timestamp * 1000))
                if past.type in (EventType.TASK_DONE, EventType.TASK_FAILED):
                    # task 已结束，没有 live 事件了；直接关闭 stream
                    return

            # 2. 进入 live 事件循环
            while True:
                try:
                    event: AgentEvent = await asyncio.wait_for(queue.get(), timeout=30.0)
                    yield event.to_sse(event_id=int(event.timestamp * 1000))
                    if event.type in (EventType.TASK_DONE, EventType.TASK_FAILED):
                        break
                except asyncio.TimeoutError:
                    # 心跳
                    yield ": heartbeat\n\n"
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
    task.pending_response = {"response": body.response, "approved": body.approved}
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
    """异步启动 AgentRuntime 主循环。

    1. 构造 memory / registry / llm / runtime
    2. 注入 StubMediaService 到所有媒体工具
    3. 注册到 _RUNNING_RUNTIMES
    4. 跑 step() 循环
    5. 持久化每步到数据库
    6. 完成后清理注册表
    """
    task_id = task_dict["id"]
    try:
        # 1. 选 LLM：按 env + task.llm_provider_id 选真实 or stub
        configs = load_llm_configs_from_env()
        llm, llm_mode, llm_fallback_reason = select_llm_for_task(
            task_provider_id=task_dict.get("llm_provider_id"),
            configs=configs,
            task_model_id=task_dict.get("llm_model_id"),
        )

        # 2. 构造 memory
        memory = AgentMemory(user_goal=task_dict.get("user_goal") or "")

        # 3. 构造工具注册表
        registry = build_default_registry()

        # 4. 注入 StubMediaService 到所有 image/video/audio 工具
        media = StubMediaService()
        for tool in registry.list():
            if tool.category in ("image", "video", "audio"):
                try:
                    tool._media_service = media  # type: ignore[attr-defined]
                except Exception:
                    pass

        # 5. 构造 runtime
        runtime = AgentRuntime(
            task_id=task_id,
            llm=llm,
            memory=memory,
            registry=registry,
            project_id=task_dict.get("project_id"),
            max_steps=task_dict.get("max_steps", 30) or 30,
            skip_confirm=bool(task_dict.get("skip_confirm", False)),
        )

        # 6. 注册 runtime
        async with _RUNNING_LOCK:
            if task_id in _RUNNING_RUNTIMES:
                logger.warning("runtime for task %s already exists; skip", task_id)
                return
            _RUNNING_RUNTIMES[task_id] = runtime

        # 7. 发 TASK_STARTED 事件（上报 llm_mode / reason）
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

        # 9. 主循环
        for _ in range(int(runtime.max_steps) + 5):
            done = await runtime.step()
            # 把每步的 memory 写入数据库
            _persist_steps(task_id, memory, runtime)
            # 同步 plan / artifacts / cost
            _sync_task_artifacts(task_id, memory)
            if done:
                break

        # 10. 任务完成
        final_status = "done" if runtime.state.value == "done" else "failed"
        _update_task_status(task_id, final_status)
        await event_bus.publish(AgentEvent(
            task_id=task_id, type=EventType.TASK_DONE if final_status == "done" else EventType.TASK_FAILED,
            payload={"summary": f"agent finished with {len(memory.short_term)} steps"},
        ))

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
        async with _RUNNING_LOCK:
            _RUNNING_RUNTIMES.pop(task_id, None)
            _RUNNING_TASKS.pop(task_id, None)


def _update_task_status(task_id: str, status: str) -> None:
    """在新的 DB session 中更新 task 状态。"""
    try:
        with SessionLocal() as db:
            t = db.query(AgentTask).filter_by(id=task_id).first()
            if t:
                t.status = status
                t.updated_at = datetime.utcnow()
                db.commit()
    except Exception as e:
        logger.warning("failed to update task %s status: %s", task_id, e)


def _persist_steps(task_id: str, memory: AgentMemory, runtime: AgentRuntime) -> None:
    """把 memory.short_term 中所有 step 持久化到数据库（只追加新的）。"""
    try:
        with SessionLocal() as db:
            existing = db.query(AgentStep).filter_by(task_id=task_id).count()
            for i, s in enumerate(memory.short_term):
                if i < existing:
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
                    started_at=datetime.utcnow(),
                    finished_at=datetime.utcnow(),
                )
                db.add(step)
            db.commit()
    except Exception as e:
        logger.warning("failed to persist steps for %s: %s", task_id, e)


def _sync_task_artifacts(task_id: str, memory: AgentMemory) -> None:
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
            t.updated_at = datetime.utcnow()
            db.commit()
    except Exception as e:
        logger.warning("failed to sync artifacts for %s: %s", task_id, e)


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


@router.post("/tasks/{task_id}/resume")
async def resume_task(task_id: str, db: Session = Depends(get_db)):
    """恢复任务。"""
    task = db.query(AgentTask).filter_by(id=task_id).first()
    if not task:
        raise HTTPException(404, f"Task {task_id} not found")
    if task.status != "paused":
        raise HTTPException(400, f"Cannot resume task in status {task.status}")
    task.status = "running"
    db.commit()
    runtime = _RUNNING_RUNTIMES.get(task_id)
    if runtime is not None:
        from ..agent.runtime import AgentState
        runtime.state = AgentState.RUNNING
    await event_bus.publish(AgentEvent(task_id=task_id, type=EventType.TASK_RESUMED, payload={}))
    return {"ok": True}
