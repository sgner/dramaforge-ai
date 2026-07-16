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
