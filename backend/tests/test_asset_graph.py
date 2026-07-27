import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import Base
from app.models import Asset
from app.agent.asset_intelligence import inspect_asset, prepare_asset, resolve_reference_assets
from app.agent.llm import LLMResponse


@pytest.fixture
def db_session():
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    session = sessionmaker(bind=engine)()
    yield session
    session.close()
    engine.dispose()


@pytest.mark.asyncio
async def test_inspect_asset_persists_lifecycle_and_reference_role(db_session):
    asset = Asset(
        id="uploaded-character",
        project_id="project-a",
        kind="image",
        asset_kind="character",
        name="Hero",
        url="/files/hero.png",
        origin="uploaded",
        inspection_status="pending",
    )
    db_session.add(asset)
    db_session.commit()

    class VisionLLM:
        async def generate_structured(self, messages, **kwargs):
            return LLMResponse(content='{"asset_type":"character","confidence":0.98,"subjects":["single_person"],"meets_standard":false,"missing_fields":["front_view"],"recommended_action":"prepare_character_asset","reference_role":"character","prompt_source":"raw","prompt_optimized":"optimized"}')

    result = await inspect_asset(db_session, "project-a", "uploaded-character", VisionLLM())

    row = db_session.query(Asset).filter_by(id="uploaded-character").one()
    assert result["asset_type"] == "character"
    assert row.reference_role == "character"
    assert row.status == "uploaded"
    assert row.inspection_status == "needs_review"


def test_prepare_asset_creates_linked_derivative_and_reuses_failed_logical_asset(db_session):
    source = Asset(
        id="source-character",
        project_id="project-a",
        kind="image",
        asset_kind="character",
        name="Hero source",
        url="/files/source.png",
        origin="uploaded",
        inspection_status="ready",
        status="uploaded",
        reference_role="character",
    )
    db_session.add(source)
    db_session.commit()

    first = prepare_asset(db_session, "project-a", "source-character", "character")
    first_id = first.id
    first.status = "failed"
    first.failed = True
    db_session.commit()

    second = prepare_asset(db_session, "project-a", "source-character", "character")

    assert first_id == second.id
    assert db_session.query(Asset).filter_by(project_id="project-a", source_asset_id="source-character", asset_kind="character").count() == 1
    assert second.source_asset_id == "source-character"
    assert second.derived_from == ["source-character"]
    assert second.reference_role == "character"


def test_resolve_reference_assets_is_deduplicated_and_role_aware(db_session):
    db_session.add_all([
        Asset(
            id="source-character",
            project_id="project-a",
            kind="image",
            asset_kind="character",
            url="/files/source.png",
            origin="uploaded",
            inspection_status="ready",
            status="uploaded",
            reference_role="character",
        ),
        Asset(
            id="normalized-character",
            project_id="project-a",
            kind="image",
            asset_kind="character",
            url="/files/normalized.png",
            origin="normalized",
            inspection_status="ready",
            status="ready",
            source_asset_id="source-character",
            derived_from=["source-character"],
            reference_role="character",
        ),
        Asset(
            id="prop-1",
            project_id="project-a",
            kind="image",
            asset_kind="prop",
            url="/files/prop.png",
            origin="uploaded",
            inspection_status="ready",
            status="uploaded",
            reference_role="prop",
        ),
    ])
    db_session.commit()

    refs = resolve_reference_assets(db_session, "project-a", ["source-character", "source-character"], role="character")

    assert [ref["asset_id"] for ref in refs] == ["normalized-character"]
    assert refs[0]["source_asset_id"] == "source-character"

    with pytest.raises(ValueError):
        resolve_reference_assets(db_session, "project-a", ["prop-1"], role="character")


@pytest.mark.asyncio
async def test_inspect_shot_asset_uses_shot_standard(db_session):
    """镜头资产用镜头级质检标准（构图/运镜/连续性/保真度），不再复用角色标准。"""
    db_session.add(Asset(
        id="shot-1", project_id="project-a", kind="image", asset_kind="shot",
        name="雨夜天台", url="/files/shot.png", status="ready",
    ))
    db_session.commit()

    captured = {}

    class VisionLLM:
        async def generate_structured(self, messages, **kwargs):
            captured["system"] = messages[0]["content"]
            return LLMResponse(content=(
                '{"asset_type":"shot","confidence":0.9,"subjects":["rooftop"],'
                '"meets_standard":true,"missing_fields":[],'
                '"recommended_action":"reuse","reference_role":"shot"}'
            ))

    await inspect_asset(db_session, "project-a", "shot-1", VisionLLM())

    assert "Shot standard" in captured["system"]
    assert "composition" in captured["system"]
    assert "continuity" in captured["system"]
    assert "Character standard" not in captured["system"]


@pytest.mark.asyncio
async def test_inspect_character_asset_keeps_character_standard(db_session):
    """角色资产仍用角色标准（四视图/单主体/纯色背景）。"""
    db_session.add(Asset(
        id="char-1", project_id="project-a", kind="image", asset_kind="character",
        name="林尘", url="/files/char.png", status="ready",
    ))
    db_session.commit()

    captured = {}

    class VisionLLM:
        async def generate_structured(self, messages, **kwargs):
            captured["system"] = messages[0]["content"]
            return LLMResponse(content=(
                '{"asset_type":"character","confidence":0.9,"subjects":["single_person"],'
                '"meets_standard":true,"missing_fields":[],'
                '"recommended_action":"reuse","reference_role":"character"}'
            ))

    await inspect_asset(db_session, "project-a", "char-1", VisionLLM())

    assert "Character standard" in captured["system"]
    assert "Shot standard" not in captured["system"]
