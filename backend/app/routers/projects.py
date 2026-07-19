"""项目管理 + 节点/连接 全量快照"""
import asyncio

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List

from ..database import get_db
from .. import models, schemas
import uuid

router = APIRouter()


def _gen_id() -> str:
    return uuid.uuid4().hex[:16]


# ============ Project CRUD ============
@router.get("", response_model=List[schemas.ProjectOut])
def list_projects(db: Session = Depends(get_db)):
    projects = db.query(models.Project).order_by(models.Project.updated_at.desc()).all()
    return [schemas.ProjectOut.from_orm_project(p) for p in projects]


@router.post("", response_model=schemas.ProjectOut)
def create_project(payload: schemas.ProjectCreate, db: Session = Depends(get_db)):
    project_id = payload.id or _gen_id()
    project = models.Project(id=project_id, name=payload.name)
    db.add(project)
    db.commit()
    db.refresh(project)
    return schemas.ProjectOut.from_orm_project(project)


@router.get("/{project_id}", response_model=schemas.ProjectSnapshot)
def get_project_snapshot(project_id: str, db: Session = Depends(get_db)):
    """返回项目完整快照（项目 + 节点 + 连接 + 资产）

    关键修复：assets 必须经过 AssetOut.from_asset_model 转换，把
    extra.body / extra.text_stats 提升到顶层 body / text_stats 字段，
    否则前端 toTaskAssetRef 读到 a.body=None → TextReader 打开资产时
    body 为空（显示"暂无内容"），节点也读不到正文。
    之前直接传 project.assets（裸 ORM），Pydantic 的 from_attributes
    只能映射同名属性，不会去 ORM.extra 里取 body，导致文本资产全部"丢正文"。
    """
    project = db.query(models.Project).filter(models.Project.id == project_id).first()
    if not project:
        raise HTTPException(404, "Project not found")
    return schemas.ProjectSnapshot(
        project=schemas.ProjectOut.from_orm_project(project),
        nodes=project.nodes,
        connections=project.connections,
        assets=[schemas.AssetOut.from_asset_model(a) for a in project.assets],
    )


@router.patch("/{project_id}", response_model=schemas.ProjectOut)
def update_project(project_id: str, payload: schemas.ProjectUpdate, db: Session = Depends(get_db)):
    project = db.query(models.Project).filter(models.Project.id == project_id).first()
    if not project:
        raise HTTPException(404, "Project not found")
    if payload.name is not None:
        project.name = payload.name
    if payload.viewport is not None:
        project.viewport_x = payload.viewport.x
        project.viewport_y = payload.viewport.y
        project.viewport_scale = payload.viewport.scale
    db.commit()
    db.refresh(project)
    return schemas.ProjectOut.from_orm_project(project)


@router.delete("/{project_id}")
async def delete_project(project_id: str, db: Session = Depends(get_db)):
    project = db.query(models.Project).filter(models.Project.id == project_id).first()
    if not project:
        raise HTTPException(404, "Project not found")

    # 删除项目之前先终止关联 runtime，防止后台任务在项目删除后继续写入
    # AgentStep/Asset，重新制造孤儿记录。
    from . import agent as agent_router
    from ..agent.runtime import AgentState

    task_ids = [
        row.id for row in
        db.query(models.AgentTask).filter(models.AgentTask.project_id == project_id).all()
    ]
    jobs = []
    for task_id in task_ids:
        runtime = agent_router._RUNNING_RUNTIMES.pop(task_id, None)
        if runtime is not None:
            runtime.state = AgentState.CANCELLED
        job = agent_router._RUNNING_TASKS.pop(task_id, None)
        if job is not None and not job.done():
            job.cancel()
            jobs.append(job)
        auto_job = agent_router._AUTO_RECOVERY_TASKS.pop(task_id, None)
        if auto_job is not None and not auto_job.done():
            auto_job.cancel()
            jobs.append(auto_job)
    if jobs:
        await asyncio.gather(*jobs, return_exceptions=True)

    db.delete(project)
    db.commit()
    for task_id in task_ids:
        agent_router.event_bus.clear_log(task_id)
    return {"ok": True}


# ============ Nodes — 批量覆盖（前端用） ============
@router.put("/{project_id}/nodes")
def save_nodes(project_id: str, payload: schemas.NodeBatchUpsert, db: Session = Depends(get_db)):
    project = db.query(models.Project).filter(models.Project.id == project_id).first()
    if not project:
        raise HTTPException(404, "Project not found")
    # 先清空
    db.query(models.Node).filter(models.Node.project_id == project_id).delete()
    # 重新插入
    for n in payload.nodes:
        db.add(models.Node(
            id=n.id or _gen_id(),
            project_id=project_id,
            type=n.type,
            x=n.x, y=n.y, w=n.w, h=n.h,
            data=n.data,
        ))
    db.commit()
    return {"ok": True, "count": len(payload.nodes)}


# ============ Connections — 批量覆盖 ============
@router.put("/{project_id}/connections")
def save_connections(project_id: str, payload: schemas.ConnectionBatchUpsert, db: Session = Depends(get_db)):
    project = db.query(models.Project).filter(models.Project.id == project_id).first()
    if not project:
        raise HTTPException(404, "Project not found")
    db.query(models.Connection).filter(models.Connection.project_id == project_id).delete()
    for c in payload.connections:
        db.add(models.Connection(
            id=c.id or _gen_id(),
            project_id=project_id,
            from_node=c.from_node,
            to_node=c.to_node,
            from_port=c.from_port,
            to_port=c.to_port,
        ))
    db.commit()
    return {"ok": True, "count": len(payload.connections)}
