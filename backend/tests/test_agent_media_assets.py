import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import Base
from app.models import Asset
from app.agent.media_assets import begin_media_asset, finish_media_asset
from app.agent.memory import AgentMemory
from app.agent.runtime import AgentRuntime


@pytest.fixture
def db_session():
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    session = sessionmaker(bind=engine)()
    yield session
    session.close()
    engine.dispose()


def test_media_asset_is_visible_before_generation_and_updated_after_success(db_session):
    pending = begin_media_asset(
        db_session,
        project_id="p1",
        kind="image",
        asset_kind="character",
        name="林夜",
        prompt="portrait",
        provider_id="p1",
        model_id="image-1",
    )

    row = db_session.query(Asset).filter_by(id=pending["id"]).one()
    assert row.generating is True
    assert row.url is None

    updated = finish_media_asset(db_session, pending["id"], url="https://cdn.test/portrait.png")

    assert updated["id"] == pending["id"]
    assert updated["generating"] is False
    assert db_session.query(Asset).filter_by(id=pending["id"]).one().url.endswith("portrait.png")


def test_media_asset_failure_keeps_node_with_error(db_session):
    pending = begin_media_asset(db_session, project_id="p1", kind="video", asset_kind="shot_video", name="shot 1", prompt="video")

    updated = finish_media_asset(db_session, pending["id"], error="HTTP 404: endpoint not found")

    assert updated["failed"] is True
    assert updated["error"] == "HTTP 404: endpoint not found"


def test_batch_creates_all_generating_assets_before_provider_runs(db_session):
    runtime = AgentRuntime("t1", object(), AgentMemory(user_goal="media"), project_id="p1", db=db_session)

    assets = runtime._begin_media_batch_assets({
        "jobs": [
            {"kind": "image", "asset_kind": "character", "name": "A", "prompt": "portrait A"},
            {"kind": "video", "asset_kind": "shot_video", "name": "shot 1", "prompt": "video 1"},
        ],
    })

    assert len(assets) == 2
    assert all(item["generating"] is True for item in assets)
    assert db_session.query(Asset).filter_by(project_id="p1", generating=True).count() == 2


def test_retry_reuses_failed_asset_identity_and_updates_prompt(db_session):
    first = begin_media_asset(
        db_session,
        project_id="p1",
        kind="image",
        asset_kind="character",
        name="阿瑞斯",
        prompt="old prompt",
    )
    finish_media_asset(db_session, first["id"], error="provider unavailable")

    retried = begin_media_asset(
        db_session,
        project_id="p1",
        kind="image",
        asset_kind="character",
        name="阿瑞斯",
        prompt="old prompt",
    )

    assert retried["id"] == first["id"]
    assert retried["generating"] is True
    assert retried["failed"] is False
    assert db_session.query(Asset).filter_by(project_id="p1", name="阿瑞斯").count() == 1
