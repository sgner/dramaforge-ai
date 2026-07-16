"""Prompt template CRUD tests."""
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import Base, get_db
from app import app
from app.models import PromptTemplate


@pytest.fixture
def client():
    """In-memory SQLite test client."""
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
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


def test_prompt_template_model_exists():
    """PromptTemplate ORM model can be instantiated."""
    tmpl = PromptTemplate(
        id="test_1",
        name="Test Template",
        category="character",
        scene="Test scene",
        positive="A test prompt",
        negative="bad quality",
        params={"Midjourney": "--ar 1:1"},
        is_builtin=False,
    )
    assert tmpl.id == "test_1"
    assert tmpl.name == "Test Template"
    assert tmpl.is_builtin is False


def test_schema_imports():
    """All prompt template schemas can be imported."""
    from app.schemas import (
        PromptTemplateOut,
        PromptTemplateCreate,
        PromptTemplateUpdate,
        PromptTemplateBatchDelete,
    )
    assert PromptTemplateOut is not None
    assert PromptTemplateCreate is not None
    assert PromptTemplateUpdate is not None
    assert PromptTemplateBatchDelete is not None


def test_seed_builtin_prompt_templates():
    """seed_builtin_prompt_templates inserts 10 builtin templates, idempotent."""
    from sqlalchemy import create_engine
    from sqlalchemy.orm import sessionmaker
    from app.database import Base
    from app.agent.prompt_template_seed import seed_builtin_prompt_templates, BUILTIN_PROMPT_TEMPLATES
    from app.models import PromptTemplate

    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(bind=engine)
    SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

    # First call: seed 10 builtins
    with SessionLocal() as db:
        seed_builtin_prompt_templates(db)
        count = db.query(PromptTemplate).filter(PromptTemplate.is_builtin == True).count()
        assert count == 10

    # Second call: no duplicates
    with SessionLocal() as db:
        seed_builtin_prompt_templates(db)
        count = db.query(PromptTemplate).filter(PromptTemplate.is_builtin == True).count()
        assert count == 10

    # Check first template has expected fields
    with SessionLocal() as db:
        first = db.query(PromptTemplate).filter_by(id="builtin_md_1").first()
        assert first is not None
        assert first.name == "多机位九宫格"
        assert first.category == "character"
        assert len(first.positive) > 100
        assert first.is_builtin is True

    # Check all 10 have non-empty positive
    with SessionLocal() as db:
        builtins = db.query(PromptTemplate).filter(PromptTemplate.is_builtin == True).all()
        for b in builtins:
            assert len(b.positive) > 50, f"Template {b.id} has empty positive"
            assert len(b.negative) > 20, f"Template {b.id} has empty negative"


def test_list_templates_empty():
    """GET /api/prompt-templates returns empty list when no data."""
    # Use a fresh client (no seeding)
    from sqlalchemy import create_engine
    from sqlalchemy.orm import sessionmaker
    from app.database import Base, get_db
    from app import app

    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(bind=engine)
    SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

    def override_get_db():
        db = SessionLocal()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = override_get_db
    client = TestClient(app)
    resp = client.get("/api/prompt-templates")
    assert resp.status_code == 200
    assert resp.json() == []
    app.dependency_overrides.clear()


def test_create_and_get_template():
    """POST then GET a user template."""
    client = _seeded_client()
    resp = client.post("/api/prompt-templates", json={
        "name": "My Template",
        "category": "character",
        "scene": "custom scene",
        "positive": "a positive prompt",
        "negative": "bad quality",
        "params": {"Flux": "CFG 4.0"},
    })
    assert resp.status_code == 200
    data = resp.json()
    assert data["name"] == "My Template"
    assert data["is_builtin"] is False
    assert data["id"].startswith("tpl_")

    # GET by id
    resp2 = client.get(f"/api/prompt-templates/{data['id']}")
    assert resp2.status_code == 200
    assert resp2.json()["name"] == "My Template"


def test_list_with_category_filter():
    """GET /api/prompt-templates?category=character returns only character templates."""
    client = _seeded_client()
    resp = client.get("/api/prompt-templates?category=character")
    assert resp.status_code == 200
    items = resp.json()
    assert len(items) >= 3  # builtin_md_1, builtin_md_4, builtin_md_8, builtin_md_9
    for item in items:
        assert item["category"] == "character"


def test_update_template():
    """PUT updates a template."""
    client = _seeded_client()
    resp = client.post("/api/prompt-templates", json={
        "name": "Original", "category": "custom", "positive": "old",
    })
    tid = resp.json()["id"]
    resp2 = client.put(f"/api/prompt-templates/{tid}", json={"name": "Updated", "positive": "new"})
    assert resp2.status_code == 200
    assert resp2.json()["name"] == "Updated"
    assert resp2.json()["positive"] == "new"


def test_delete_user_template():
    """DELETE removes a user template."""
    client = _seeded_client()
    resp = client.post("/api/prompt-templates", json={"name": "To Delete", "positive": "x"})
    tid = resp.json()["id"]
    resp2 = client.delete(f"/api/prompt-templates/{tid}")
    assert resp2.status_code == 200
    # Confirm gone
    resp3 = client.get(f"/api/prompt-templates/{tid}")
    assert resp3.status_code == 404


def test_delete_builtin_rejected():
    """DELETE on builtin template returns 403."""
    client = _seeded_client()
    resp = client.delete("/api/prompt-templates/builtin_md_1")
    assert resp.status_code == 403


def test_batch_delete():
    """POST /batch-delete removes multiple user templates."""
    client = _seeded_client()
    ids = []
    for i in range(3):
        resp = client.post("/api/prompt-templates", json={"name": f"Batch {i}", "positive": "x"})
        ids.append(resp.json()["id"])
    resp2 = client.post("/api/prompt-templates/batch-delete", json={"ids": ids})
    assert resp2.status_code == 200
    assert resp2.json()["removed"] == 3


def _seeded_client():
    """Test client with 10 builtin templates pre-seeded."""
    from sqlalchemy import create_engine
    from sqlalchemy.orm import sessionmaker
    from app.database import Base, get_db
    from app import app
    from app.agent.prompt_template_seed import seed_builtin_prompt_templates

    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(bind=engine)
    SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

    with SessionLocal() as db:
        seed_builtin_prompt_templates(db)

    def override_get_db():
        db = SessionLocal()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = override_get_db
    return TestClient(app)
