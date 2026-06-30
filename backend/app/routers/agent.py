"""Agent API 路由：任务管理 + SSE 事件流 + 用户响应。"""
from __future__ import annotations

import asyncio
import json
import uuid
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from .. import schemas
from ..database import get_db
from ..models import AgentTask, AgentStep
from ..agent.events import event_bus, AgentEvent, EventType
from ..agent.tools import list_tool_metadata

router = APIRouter()


def _gen_id() -> str:
    return uuid.uuid4().hex[:12]


# ========================
# 任务管理
# ========================

@router.get("/tools", response_model=list[schemas.ToolMetadataOut])
def get_agent_tools():
    """返回 18 个工具的元数据列表（供前端 ToolPalette 渲染）。"""
    return list_tool_metadata()


@router.post("/tasks", response_model=schemas.AgentTaskOut)
def create_task(body: schemas.AgentTaskCreate, db: Session = Depends(get_db)):
    """创建 agent 任务。"""
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
    )
    db.add(task)
    db.commit()
    db.refresh(task)
    return task.to_dict()


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
    """SSE 推送 agent 事件。"""
    queue = event_bus.subscribe(task_id)
    pending_response_holder: dict[str, Any] = {"value": None, "event": None}

    async def event_generator():
        try:
            # 发送一条 hello 事件
            yield AgentEvent(
                task_id=task_id, type=EventType.TASK_STARTED, payload={"task_id": task_id}
            ).to_sse(event_id=0)

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
    await event_bus.publish(AgentEvent(task_id=task_id, type=EventType.TASK_RESUMED, payload={}))
    return {"ok": True}
