"""整集生成任务的内存注册表（探索分支：进程重启丢任务可接受）。

POST /api/studio/episodes 立即返回 task_id，后台用 asyncio.create_task 跑
director.run_studio_episode；前端轮询 GET /api/studio/episodes/{task_id}
拿 status / progress / result / error。

注意：后台任务用独立的 SessionLocal session，不复用请求级 session；
结束（成功/异常）都会关闭 session 并把终态写回注册表。
"""
from __future__ import annotations

import asyncio
import logging
import uuid
from typing import Any, Optional

from ..database import SessionLocal
from . import director

logger = logging.getLogger("dramaforge.studio.tasks")

# task_id -> entry:
# {task_id, status, progress, result, error, task(asyncio.Task)}
# status: "running" | run_studio_episode 的终态（done/partial/failed）| "error"
_tasks: dict[str, dict[str, Any]] = {}


def _initial_progress() -> dict:
    return {"phase": "planning", "current_shot": 0, "total_shots": 0, "shots": []}


def get_episode_task(task_id: str) -> Optional[dict]:
    """返回对外视图（不含 asyncio.Task 对象）；不存在返回 None。"""
    entry = _tasks.get(task_id)
    if entry is None:
        return None
    return {
        "task_id": entry["task_id"],
        "status": entry["status"],
        "progress": entry["progress"],
        "result": entry["result"],
        "error": entry["error"],
    }


def start_episode_task(**params) -> str:
    """登记任务并在当前 event loop 上调度执行，立即返回 task_id。"""
    task_id = uuid.uuid4().hex[:12]
    entry: dict[str, Any] = {
        "task_id": task_id,
        "status": "running",
        "progress": _initial_progress(),
        "result": None,
        "error": None,
        "task": None,
    }
    _tasks[task_id] = entry

    def on_progress(progress: dict) -> None:
        entry["progress"] = progress

    entry["task"] = asyncio.create_task(_run_episode(task_id, on_progress, params))
    return task_id


async def _run_episode(task_id: str, on_progress, params: dict) -> None:
    entry = _tasks[task_id]
    db = SessionLocal()
    try:
        result = await director.run_studio_episode(db, on_progress=on_progress, **params)
        entry["result"] = result
        entry["status"] = str((result or {}).get("status") or "done")
    except Exception as e:  # noqa: BLE001 — 后台任务任何异常都要落注册表，不能静默丢
        logger.exception("[studio] episode task %s failed", task_id)
        entry["status"] = "error"
        entry["error"] = str(e) or repr(e)
    finally:
        db.close()
