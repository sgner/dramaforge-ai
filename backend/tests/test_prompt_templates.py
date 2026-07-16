"""Prompt template CRUD tests."""
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.database import Base, get_db
from app import app
from app.models import PromptTemplate


@pytest.fixture
def client():
    """In-memory SQLite test client."""
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False})
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

    engine = create_engine("sqlite://", connect_args={"check_same_thread": False})
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
