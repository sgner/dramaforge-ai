"""整集生成任务的持久化注册表。

POST /api/studio/episodes 立即返回 task_id，后台用 asyncio.create_task 跑
director.run_studio_episode；前端轮询 GET /api/studio/episodes/{task_id}
拿 status / progress / result / error。

与早期内存版注册表的区别：状态落 studio_episode_tasks 表，进程重启后
仍可查询历史任务；启动时残留 running 行由 init_db 标记为 interrupted。
asyncio.Task 句柄仍只在内存（_tasks），仅用于执行控制，重启即失效。

注意：后台任务用独立的 SessionLocal session，不复用请求级 session；
结束（成功/异常）都会关闭 session 并把终态写回注册表。
"""
from __future__ import annotations

import asyncio
import logging
import uuid
from typing import Any, Optional

from ..database import SessionLocal
from ..models import StudioEpisodeTask
from . import director

logger = logging.getLogger("dramaforge.studio.tasks")

# task_id -> asyncio.Task（仅执行句柄；状态以 DB 为准）
_tasks: dict[str, asyncio.Task] = {}


def _initial_progress() -> dict:
    return {"phase": "planning", "current_shot": 0, "total_shots": 0, "shots": []}


def get_episode_task(task_id: str) -> Optional[dict]:
    """返回对外视图；不存在返回 None。"""
    db = SessionLocal()
    try:
        row = db.query(StudioEpisodeTask).filter(StudioEpisodeTask.id == task_id).first()
        if row is None:
            return None
        return {
            "task_id": row.id,
            "status": row.status,
            "progress": row.progress or {},
            "result": row.result,
            "error": row.error,
        }
    finally:
        db.close()


def start_episode_task(**params) -> str:
    """登记任务并在当前 event loop 上调度执行，立即返回 task_id。"""
    task_id = uuid.uuid4().hex[:12]
    db = SessionLocal()
    try:
        db.add(StudioEpisodeTask(
            id=task_id,
            project_id=str(params.get("project_id") or ""),
            status="running",
            progress=_initial_progress(),
        ))
        db.commit()
    finally:
        db.close()

    _tasks[task_id] = asyncio.create_task(_run_episode(task_id, params))
    return task_id


def _update_row(db, task_id: str, **fields) -> None:
    row = db.query(StudioEpisodeTask).filter(StudioEpisodeTask.id == task_id).first()
    if row is None:
        return
    for key, value in fields.items():
        setattr(row, key, value)
    db.commit()


async def _run_episode(task_id: str, params: dict) -> None:
    db = SessionLocal()
    try:
        def on_progress(progress: dict) -> None:
            try:
                _update_row(db, task_id, progress=progress)
            except Exception:  # noqa: BLE001 — 进度写库失败不拖垮主任务
                logger.exception("[studio] episode task %s progress persist failed", task_id)

        result = await director.run_studio_episode(db, on_progress=on_progress, **params)
        _update_row(
            db, task_id,
            result=result,
            status=str((result or {}).get("status") or "done"),
        )
    except Exception as e:  # noqa: BLE001 — 后台任务任何异常都要落注册表，不能静默丢
        logger.exception("[studio] episode task %s failed", task_id)
        try:
            _update_row(db, task_id, status="error", error=str(e) or repr(e))
        except Exception:  # noqa: BLE001
            logger.exception("[studio] episode task %s error persist failed", task_id)
    finally:
        db.close()
        _tasks.pop(task_id, None)
