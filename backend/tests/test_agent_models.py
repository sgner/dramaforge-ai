"""Agent 数据库模型测试。"""
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.models import Base, AgentTask, AgentStep


@pytest.fixture
def db_session():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine)
    session = Session()
    yield session
    session.close()


def test_agent_task_create(db_session):
    """创建 AgentTask 记录。"""
    task = AgentTask(
        id="task_1",
        project_id="proj_1",
        user_goal="把小说变脚本",
        status="pending",
        plan=[],
        artifacts={},
        total_cost_usd=0.0,
        total_tokens=0,
    )
    db_session.add(task)
    db_session.commit()
    assert task.id == "task_1"
    assert task.created_at is not None


def test_agent_step_create(db_session):
    """创建 AgentStep 记录。"""
    task = AgentTask(
        id="task_1", project_id="proj_1",
        user_goal="x", status="running",
    )
    db_session.add(task)
    db_session.commit()

    step = AgentStep(
        id="step_1",
        task_id="task_1",
        step_number=1,
        thought="我先做X",
        action={"tool": "a", "params": {}},
        observation={"success": True, "result": {}},
        status="success",
        cost_usd=0.001,
        tokens=100,
    )
    db_session.add(step)
    db_session.commit()

    fetched = db_session.query(AgentStep).filter_by(id="step_1").first()
    assert fetched.thought == "我先做X"
    assert fetched.status == "success"


def test_agent_task_to_dict(db_session):
    """AgentTask.to_dict 输出可序列化。"""
    task = AgentTask(
        id="t1", project_id="p1", user_goal="x", status="running",
        plan=[{"step": 1}], artifacts={"characters": [{"name": "林尘"}]},
        total_cost_usd=0.05, total_tokens=500,
    )
    db_session.add(task)
    db_session.commit()

    d = task.to_dict()
    assert d["id"] == "t1"
    assert d["user_goal"] == "x"
    assert d["total_cost_usd"] == 0.05
    assert d["artifacts"]["characters"][0]["name"] == "林尘"


def test_agent_task_from_dict(db_session):
    """从 dict 恢复 AgentTask。"""
    d = {
        "id": "t1", "project_id": "p1", "user_goal": "x",
        "status": "pending", "plan": [], "artifacts": {},
        "total_cost_usd": 0.0, "total_tokens": 0,
        "pending_response": None,
    }
    task = AgentTask.from_dict(d)
    assert task.id == "t1"
    assert task.status == "pending"
