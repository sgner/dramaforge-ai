import pytest
from fastapi.testclient import TestClient
from uuid import uuid4
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import Base
from app.models import Asset
from app.schemas import AssetCreate, AssetOut
from app import app
from app.agent.asset_references import resolve_asset_references
from app.agent.asset_intelligence import inspect_asset, create_character_normalization_asset
from app.agent.llm import LLMResponse
from app.agent.media_service import MediaResult
from app.agent.tools.base import ToolContext
from app.agent.tools.image_tools import GenerateCharacterPortraitTool, GenerateStoryboardImageTool, collect_storyboard_reference_asset_ids
from app.agent.tools.video_tools import GenerateVideoTool
from app.agent.memory import AgentMemory
from app.agent.runtime import AgentRuntime


@pytest.fixture
def db_session():
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    session = sessionmaker(bind=engine)()
    yield session
    session.close()
    engine.dispose()


def test_uploaded_asset_has_inspection_and_reuse_contract(db_session):
    payload = AssetCreate(
        id="uploaded-1",
        project_id="project-a",
        kind="image",
        asset_kind="character",
        name="用户角色",
        url="/files/character.png",
        origin="uploaded",
    )
    asset = Asset(**payload.model_dump())
    db_session.add(asset)
    db_session.commit()
    db_session.refresh(asset)

    assert asset.origin == "uploaded"
    assert asset.inspection_status == "pending"
    assert asset.source_asset_id is None
    assert asset.reference_capabilities == {}


def test_asset_snapshot_exposes_normalized_source_and_visual_identity(db_session):
    source = Asset(
        id="source-1",
        project_id="project-a",
        kind="image",
        asset_kind="character",
        name="用户角色原图",
        origin="uploaded",
        inspection_status="ready",
        visual_identity={"subject_count": 1, "asset_kind": "character"},
    )
    derivative = Asset(
        id="normalized-1",
        project_id="project-a",
        kind="image",
        asset_kind="character",
        name="用户角色三视图",
        origin="normalized",
        source_asset_id="source-1",
        inspection_status="ready",
        reference_capabilities={"image": True, "video": True},
    )
    db_session.add_all([source, derivative])
    db_session.commit()

    snapshot = AssetOut.model_validate(derivative)

    assert snapshot.source_asset_id == "source-1"
    assert snapshot.origin == "normalized"
    assert snapshot.reference_capabilities["video"] is True


def test_project_upload_creates_persisted_asset_record():
    project_id = f"upload-test-{uuid4().hex[:8]}"
    with TestClient(app) as client:
        project = client.post("/api/projects", json={"id": project_id, "name": "上传测试"})
        assert project.status_code == 200

        response = client.post(
            "/api/uploads/asset",
            data={"project_id": project_id, "asset_kind": "character"},
            files={"file": ("character.png", b"fake-image", "image/png")},
        )

        assert response.status_code == 200
        body = response.json()
        assert body["project_id"] == project_id
        assert body["origin"] == "uploaded"
        assert body["inspection_status"] == "pending"
        assert body["asset_kind"] == "character"
        assert body["url"].startswith("/files/")
        assert client.get(body["url"]).status_code == 200
        client.delete(f"/api/projects/{project_id}")


def test_asset_reference_resolution_prefers_normalized_derivative_and_is_project_scoped(db_session):
    db_session.add_all([
        Asset(
            id="source-character",
            project_id="project-a",
            kind="image",
            asset_kind="character",
            url="/files/source.png",
            origin="uploaded",
            inspection_status="ready",
        ),
        Asset(
            id="normalized-character",
            project_id="project-a",
            kind="image",
            asset_kind="character",
            url="/files/turnaround.png",
            origin="normalized",
            source_asset_id="source-character",
            inspection_status="ready",
            reference_capabilities={"image": True, "video": True},
        ),
        Asset(
            id="other-project-asset",
            project_id="project-b",
            kind="image",
            asset_kind="character",
            url="/files/other.png",
            origin="uploaded",
            inspection_status="ready",
        ),
    ])
    db_session.commit()

    refs = resolve_asset_references(db_session, "project-a", ["source-character"], media_kind="video")

    assert refs == [{
        "asset_id": "normalized-character",
        "source_asset_id": "source-character",
        "asset_kind": "character",
        "url": "/files/turnaround.png",
    }]
    assert db_session.query(Asset).filter_by(id="normalized-character").one().usage_count == 1

    with pytest.raises(ValueError, match="does not belong to project"):
        resolve_asset_references(db_session, "project-a", ["other-project-asset"], media_kind="image")


@pytest.mark.asyncio
async def test_multimodal_inspection_persists_character_classification(db_session):
    asset = Asset(
        id="uploaded-character",
        project_id="project-a",
        kind="image",
        asset_kind=None,
        url="/files/character.png",
        origin="uploaded",
        inspection_status="pending",
    )
    db_session.add(asset)
    db_session.commit()

    class VisionLLM:
        model = "vision-model"

        async def generate_structured(self, messages, **kwargs):
            assert messages[1]["content"][1]["type"] == "image_url"
            return LLMResponse(content='{"asset_kind":"character","confidence":0.96,"subject_count":1,"is_character_standard":false,"needs_normalization":true,"visual_identity":{"hair":"black"},"reference_capabilities":{"image":true}}')

    result = await inspect_asset(db_session, "project-a", "uploaded-character", VisionLLM())

    assert result["asset_kind"] == "character"
    assert result["needs_normalization"] is True
    assert db_session.query(Asset).filter_by(id="uploaded-character").one().inspection_status == "ready"
    assert db_session.query(Asset).filter_by(id="uploaded-character").one().visual_identity["hair"] == "black"


def test_character_normalization_creates_linked_pending_derivative(db_session):
    source = Asset(
        id="single-character",
        project_id="project-a",
        kind="image",
        asset_kind="character",
        name="用户上传角色",
        url="/files/single.png",
        origin="uploaded",
        inspection_status="ready",
        visual_identity={"hair": "black"},
    )
    db_session.add(source)
    db_session.commit()

    derivative = create_character_normalization_asset(db_session, "project-a", "single-character")

    assert derivative.source_asset_id == "single-character"
    assert derivative.origin == "normalized"
    assert derivative.generating is True
    assert "front" in derivative.prompt and "side" in derivative.prompt


@pytest.mark.asyncio
async def test_character_generation_resolves_logical_reference_asset_id(db_session):
    db_session.add(Asset(
        id="reference-character",
        project_id="project-a",
        kind="image",
        asset_kind="character",
        url="/files/reference-character.png",
        origin="uploaded",
        inspection_status="ready",
    ))
    db_session.commit()

    class CaptureMediaService:
        def __init__(self):
            self.request = None

        async def generate(self, request):
            self.request = request
            return MediaResult(url="/files/generated.png", kind="image")

    service = CaptureMediaService()
    class PromptLLM:
        model = "prompt-model"

        async def generate(self, messages, **kwargs):
            return LLMResponse(content="optimized prompt")

    result = await GenerateCharacterPortraitTool().execute(
        ToolContext(task_id="task-1", project_id="project-a", db=db_session, llm_client=PromptLLM(), media_service=service),
        {
            "character": {"name": "hero", "appearance": "red coat"},
            "reference_asset_ids": ["reference-character"],
        },
    )

    assert result["url"] == "/files/generated.png"
    assert service.request.reference_urls == ["/files/reference-character.png"]
    assert "left-right split layout" in result["source_prompt"]
    assert "F0EDE8" in result["source_prompt"]
    assert "no visible numbers" in result["source_prompt"]
    assert db_session.query(Asset).filter_by(id="reference-character").one().usage_count == 1


@pytest.mark.asyncio
async def test_all_media_generation_uses_optimized_prompt_and_storyboard_merges_references(db_session):
    db_session.add_all([
        Asset(id="scene-asset", project_id="project-a", kind="image", asset_kind="scene", url="/scene.png", origin="uploaded", inspection_status="ready"),
        Asset(id="character-asset", project_id="project-a", kind="image", asset_kind="character", url="/character.png", origin="uploaded", inspection_status="ready"),
        Asset(id="prop-asset", project_id="project-a", kind="image", asset_kind="prop", url="/prop.png", origin="uploaded", inspection_status="ready"),
    ])
    db_session.commit()

    class PromptLLM:
        model = "prompt-model"

        async def generate(self, messages, **kwargs):
            return LLMResponse(content="OPTIMIZED PROMPT")

    class CaptureMediaService:
        def __init__(self):
            self.requests = []

        async def generate(self, request):
            self.requests.append(request)
            return MediaResult(url=f"/{request.kind}.png", kind=request.kind)

    service = CaptureMediaService()
    ctx = ToolContext(task_id="task-1", project_id="project-a", db=db_session, llm_client=PromptLLM(), media_service=service)
    storyboard_params = {
        "shot": {"index": 1, "scene": "castle", "action": "hero raises sword"},
        "scene_asset_id": "scene-asset",
        "characters": [{"name": "hero", "asset_id": "character-asset"}],
        "props": [{"name": "sword", "asset_id": "prop-asset"}],
    }

    assert collect_storyboard_reference_asset_ids(storyboard_params) == ["scene-asset", "character-asset", "prop-asset"]
    result = await GenerateStoryboardImageTool().execute(ctx, storyboard_params)

    assert result["prompt"] == "OPTIMIZED PROMPT"
    assert result["source_prompt"]
    assert service.requests[0].reference_urls == ["/scene.png", "/character.png", "/prop.png"]


def test_agent_prompt_contains_only_current_project_asset_context(db_session):
    db_session.add_all([
        Asset(id="asset-a", project_id="project-a", kind="image", name="A", origin="uploaded"),
        Asset(id="asset-b", project_id="project-b", kind="image", name="B", origin="uploaded"),
    ])
    db_session.commit()

    runtime = AgentRuntime(
        task_id="task-asset-context",
        llm=object(),
        memory=AgentMemory(user_goal="use project assets"),
        project_id="project-a",
        db=db_session,
    )
    prompt = runtime._build_messages()[0]["content"]

    assert "asset-a" in prompt
    assert "asset-b" not in prompt
