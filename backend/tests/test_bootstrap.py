"""TDD: GET /api/bootstrap 合并首屏 3 个请求为 1 个。

回归性能问题：进入首页时 3-10s。根因：首屏发起 3 个串行/并行请求
（listDramaTasks + listProviders + getUserPreference('model_bindings')），
每个请求在 --reload 模式下都有模块加载开销，RTT 累加导致延迟。

合并为单个 /api/bootstrap 端点：3 RTT → 1 RTT。
"""
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import Base, get_db
from app import app
from app.models import DramaTask, ProviderConfig, UserPreference


@pytest.fixture
def client():
    """In-memory SQLite test client."""
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    Base.metadata.create_all(bind=engine)

    def override_get_db():
        db = TestingSessionLocal()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = override_get_db
    yield TestClient(app)
    app.dependency_overrides.clear()


def test_bootstrap_returns_three_sections(client):
    """GET /api/bootstrap 返回 tasks / providers / modelBindings 三个字段。"""
    resp = client.get("/api/bootstrap")
    assert resp.status_code == 200
    data = resp.json()
    assert "tasks" in data
    assert "providers" in data
    assert "modelBindings" in data
    assert isinstance(data["tasks"], list)
    assert isinstance(data["providers"], list)
    # modelBindings 可以是 list 或 None
    assert data["modelBindings"] is None or isinstance(data["modelBindings"], list)


def test_bootstrap_returns_seeded_tasks(client):
    """bootstrap 返回的 tasks 与 GET /api/drama-tasks 一致（不含 deleted）。"""
    db = next(app.dependency_overrides[get_db]())
    db.add(DramaTask(id="t1", name="Task 1", data_json="{}"))
    db.add(DramaTask(id="t2", name="Task 2 (deleted)", data_json="{}", deleted=True))
    db.commit()
    db.close()

    resp = client.get("/api/bootstrap")
    tasks = resp.json()["tasks"]
    task_ids = [t["id"] for t in tasks]
    assert "t1" in task_ids
    assert "t2" not in task_ids  # deleted 不返回


def test_bootstrap_returns_providers_with_masked_keys(client):
    """bootstrap 返回的 providers 与 GET /api/providers 一致（key 脱敏）。"""
    db = next(app.dependency_overrides[get_db]())
    db.add(ProviderConfig(
        provider_id="p1", name="Test", base_url="http://x",
        api_key="sk-secret-key", enabled=True,
    ))
    db.commit()
    db.close()

    resp = client.get("/api/bootstrap")
    providers = resp.json()["providers"]
    assert len(providers) == 1
    assert providers[0]["provider_id"] == "p1"
    assert providers[0]["has_key"] is True
    # api_key 不应返回明文
    assert "sk-secret-key" not in resp.text


def test_bootstrap_returns_model_bindings_preference(client):
    """bootstrap 返回的 modelBindings 来自 user_preferences['model_bindings']。"""
    db = next(app.dependency_overrides[get_db]())
    import json
    db.add(UserPreference(key="model_bindings", value_json=json.dumps([{"provider": "p1", "model": "m1"}])))
    db.commit()
    db.close()

    resp = client.get("/api/bootstrap")
    mb = resp.json()["modelBindings"]
    assert mb is not None
    assert len(mb) == 1
    assert mb[0]["provider"] == "p1"


def test_bootstrap_model_bindings_null_when_not_set(client):
    """model_bindings 未设置时返回 null。"""
    resp = client.get("/api/bootstrap")
    assert resp.json()["modelBindings"] is None
