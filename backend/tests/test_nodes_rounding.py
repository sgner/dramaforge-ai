"""回归：画布节点 w/h 为小数时 PUT /projects/{id}/nodes 不得 422。

前端拖拽缩放/自动布局会产生小数尺寸（如 297.068），DB 列是 Integer，
Pydantic v2 的 int 类型对带小数的 float 直接报 int_from_float → 422，
导致画布保存失败。NodeOut 现在在边界层把小数四舍五入成 int。
"""
import pytest
from fastapi.testclient import TestClient

from app import app
from app.database import SessionLocal
from app.models import Node, Project


@pytest.fixture
def client():
    return TestClient(app)


@pytest.fixture
def project_id():
    pid = "proj-node-rounding"
    with SessionLocal() as db:
        db.query(Node).filter_by(project_id=pid).delete()
        db.query(Project).filter_by(id=pid).delete()
        db.add(Project(id=pid, name="rounding test", nodes=[], connections=[]))
        db.commit()
    yield pid
    with SessionLocal() as db:
        db.query(Node).filter_by(project_id=pid).delete()
        db.query(Project).filter_by(id=pid).delete()
        db.commit()


def test_save_nodes_accepts_fractional_dimensions(client, project_id):
    """小数 w/h → 200 OK，落库为四舍五入后的整数。"""
    r = client.put(
        f"/api/projects/{project_id}/nodes",
        json={
            "nodes": [
                {"id": "n1", "type": "image", "x": 0.0, "y": 0.0,
                 "w": 297.06854285608216, "h": 381.876985708452, "data": {}},
                {"id": "n2", "type": "image", "x": 10.5, "y": 20.5,
                 "w": 380.4727642822671, "h": 200.0, "data": {}},
            ]
        },
    )
    assert r.status_code == 200, r.text

    with SessionLocal() as db:
        n1 = db.query(Node).filter_by(id="n1").first()
        n2 = db.query(Node).filter_by(id="n2").first()
        assert n1.w == 297 and isinstance(n1.w, int)
        assert n1.h == 382 and isinstance(n1.h, int)
        assert n2.w == 380 and isinstance(n2.w, int)
        assert n2.h == 200 and isinstance(n2.h, int)


def test_save_nodes_rejects_non_numeric_dimensions(client, project_id):
    """非数字 w/h 仍然 422（取整逻辑不吞掉真正的非法输入）。"""
    r = client.put(
        f"/api/projects/{project_id}/nodes",
        json={"nodes": [{"id": "n-bad", "type": "image", "w": "abc", "h": 100}]},
    )
    assert r.status_code == 422
