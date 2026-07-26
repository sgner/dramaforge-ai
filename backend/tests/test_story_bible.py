"""Story Bible 最小实现测试：镜头-角色卡关联、影响分析、身份更新、一键重生成。"""
import json

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.agent import studio
from app.agent.character_cards import card_impact, update_card_identity
from app.agent.studio import regenerate_shot
from app.database import Base
from app.models import Asset, ProviderConfig


@pytest.fixture
def db_session():
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine)
    session = Session()
    session.add(ProviderConfig(
        provider_id="img-p", base_url="https://api.test/v1", api_key="sk-img",
        image_models_json='["img-model"]', enabled=True,
    ))
    session.add(Asset(
        id="card1", project_id="p1", kind="image", asset_kind="character",
        name="林岚", url="https://cdn.test/ref.png", status="ready",
        visual_identity={"face_anchor": "oval face", "clothing": "navy jacket"},
        extra={"character_card": True, "reference_asset_ids": []},
    ))
    session.commit()
    yield session
    session.close()
    engine.dispose()


def _shot(db, aid, card_ids, brief="雨夜天台对峙"):
    db.add(Asset(
        id=aid, project_id="p1", kind="image", asset_kind="shot",
        title=brief[:40], name=brief[:40], url=f"https://cdn.test/{aid}.png",
        status="ready",
        extra={"brief": brief, "character_card_ids": card_ids},
    ))
    db.commit()


def test_impact_lists_only_referencing_shots(db_session):
    _shot(db_session, "s1", ["card1"])
    _shot(db_session, "s2", [])
    _shot(db_session, "s3", ["card1", "other-card"])
    impact = card_impact(db_session, "p1", "card1")
    assert [i["asset_id"] for i in impact] == ["s1", "s3"]
    assert impact[0]["brief"] == "雨夜天台对峙"
    # 其它项目看不到
    assert card_impact(db_session, "other", "card1") == []


def test_update_identity_merges_and_rejects_unknown_fields(db_session):
    card = update_card_identity(db_session, "card1", {
        "clothing": "red coat",
        "hacker_field": "should be ignored",
    })
    assert card.visual_identity["clothing"] == "red coat"
    assert card.visual_identity["face_anchor"] == "oval face"  # 未提供的字段保留
    assert "hacker_field" not in card.visual_identity


def test_update_identity_validates_card(db_session):
    with pytest.raises(ValueError, match="not found"):
        update_card_identity(db_session, "ghost", {"clothing": "x"})
    _shot(db_session, "notcard", [])
    with pytest.raises(ValueError, match="不是角色卡"):
        update_card_identity(db_session, "notcard", {"clothing": "x"})
    with pytest.raises(ValueError, match="empty"):
        update_card_identity(db_session, "card1", {})


@pytest.mark.asyncio
async def test_regenerate_shot_reuses_stored_brief_and_cards(db_session, monkeypatch):
    _shot(db_session, "s1", ["card1"], brief="女主回头")
    captured = {}

    class _Result:
        status = "approved"
        asset_id = "s1-new"
        url = "u"
        prompt = "p"
        rounds = 1
        inspection = {}
        trace = []

    async def fake_run(db, **kwargs):
        captured.update(kwargs)
        return _Result()

    monkeypatch.setattr(studio, "run_studio_shot", fake_run)
    result = await regenerate_shot(
        db_session, project_id="p1", asset_id="s1",
        image_provider_id="img-p", image_model="m",
    )
    assert result.status == "approved"
    assert captured["brief"] == "女主回头"
    assert captured["character_card_ids"] == ["card1"]


@pytest.mark.asyncio
async def test_regenerate_shot_validates_asset(db_session):
    with pytest.raises(ValueError, match="not found"):
        await regenerate_shot(db_session, project_id="p1", asset_id="ghost",
                              image_provider_id="img-p", image_model="m")
    with pytest.raises(ValueError, match="does not belong"):
        _shot(db_session, "s9", ["card1"])
        await regenerate_shot(db_session, project_id="other", asset_id="s9",
                              image_provider_id="img-p", image_model="m")


# ========================
# Story Bible 合并（步骤 1-3）
# ========================

@pytest.mark.asyncio
async def test_create_character_card_binds_story_entity(db_session):
    """步骤 1：建卡即实体——角色卡落库即带 story_entity，同名卡共享实体。"""
    from app.agent.character_cards import create_character_card

    db_session.add(Asset(
        id="ref-1", project_id="p1", kind="image", asset_kind="character",
        name="林岚", url="https://cdn.test/ref2.png", status="ready",
    ))
    db_session.commit()

    class VisionLLM:
        async def generate_structured(self, messages, **kwargs):
            class R:
                content = '{"face_anchor": "oval face", "clothing": "navy jacket"}'
            return R()

    card = await create_character_card(
        db_session, project_id="p1", name="林岚",
        reference_asset_ids=["ref-1"], llm=VisionLLM(),
    )
    assert card.story_entity_id
    assert card.story_entity_name == "林岚"

    card2 = await create_character_card(
        db_session, project_id="p1", name="林岚",
        reference_asset_ids=["ref-1"], llm=VisionLLM(),
    )
    assert card2.story_entity_id == card.story_entity_id


def test_persist_shot_asset_records_story_entity_ids(db_session):
    """步骤 2：镜头 extra.story_entity_ids 从角色卡复制。"""
    from app.models import _ensure_story_entity

    card = db_session.query(Asset).filter_by(id="card1").one()
    _ensure_story_entity(card)
    db_session.commit()

    shot = studio._persist_shot_asset(
        db_session,
        project_id="p1",
        brief="雨夜天台对峙",
        shot_prompt="prompt",
        shot_notes="",
        url="https://cdn.test/shot.png",
        provider_id="img-p",
        model="img-model",
        round_no=1,
        character_card_ids=["card1"],
    )
    assert shot.extra["story_entity_ids"] == [card.story_entity_id]
    assert shot.extra["character_card_ids"] == ["card1"]


def test_entity_impact_matches_extra_and_column(db_session):
    """步骤 3：实体级影响分析命中 extra.story_entity_ids 与 story_entity_id 列。"""
    from app.agent.character_cards import entity_impact
    from app.models import _ensure_story_entity

    card = db_session.query(Asset).filter_by(id="card1").one()
    _ensure_story_entity(card)
    entity_id = card.story_entity_id
    # 路径 1：工作室镜头（extra.story_entity_ids）
    db_session.add(Asset(
        id="s-entity-1", project_id="p1", kind="image", asset_kind="shot",
        name="镜头1", url="https://cdn.test/se1.png", status="ready",
        extra={"brief": "雨夜", "story_entity_ids": [entity_id]},
    ))
    # 路径 2：镜头自身 story_entity_id 列（实体 id 直接落在镜头行上，
    # 例如后续流程把实体关联传播到列时）
    shot2 = Asset(
        id="s-entity-2", project_id="p1", kind="image", asset_kind="shot",
        name="天台风", url="https://cdn.test/se2.png", status="ready",
        extra={"brief": "天台风"},
        story_entity_id=entity_id,
    )
    db_session.add(shot2)
    # 不相关的镜头
    db_session.add(Asset(
        id="s-entity-3", project_id="p1", kind="image", asset_kind="shot",
        name="镜头3", url="https://cdn.test/se3.png", status="ready",
        extra={"brief": "其他", "story_entity_ids": ["other-entity"]},
    ))
    db_session.commit()

    impact = entity_impact(db_session, "p1", entity_id)
    assert [i["asset_id"] for i in impact] == ["s-entity-1", "s-entity-2"]
    assert entity_impact(db_session, "other", entity_id) == []


def test_card_impact_dedupes_card_and_entity_paths(db_session):
    """步骤 3：card_id 与 story_entity 两条路径命中同一镜头时去重。"""
    from app.models import _ensure_story_entity

    card = db_session.query(Asset).filter_by(id="card1").one()
    _ensure_story_entity(card)
    db_session.commit()
    db_session.add(Asset(
        id="s-both", project_id="p1", kind="image", asset_kind="shot",
        name="镜头1", url="https://cdn.test/sb.png", status="ready",
        extra={
            "brief": "雨夜",
            "character_card_ids": ["card1"],
            "story_entity_ids": [card.story_entity_id],
        },
    ))
    db_session.commit()

    impact = card_impact(db_session, "p1", "card1")
    assert [i["asset_id"] for i in impact] == ["s-both"]


# ========================
# Story Bible 合并（步骤 4）
# ========================

class TestIdentifyExtractIdentity:
    def test_identify_character_with_extract_identity(self, monkeypatch):
        """identify + extract_identity：复用角色卡提取链路写 visual_identity。"""
        import uuid as _uuid
        from fastapi.testclient import TestClient
        from app import app
        from app.database import SessionLocal
        from app.agent import llm_factory

        class VisionLLM:
            async def generate_structured(self, messages, **kwargs):
                class R:
                    content = '{"face_anchor": "oval face", "clothing": "navy jacket"}'
                return R()

        monkeypatch.setattr(llm_factory, "load_llm_configs", lambda db: {"x": {}})
        monkeypatch.setattr(llm_factory, "select_llm_for_task", lambda pid, configs, mid: VisionLLM())

        asset_id = f"identify-extract-{_uuid.uuid4().hex[:8]}"
        db = SessionLocal()
        try:
            db.add(Asset(
                id=asset_id, project_id="p-extract", kind="image",
                name="侧脸照", url="https://cdn.test/face.png",
            ))
            db.commit()
            client = TestClient(app)
            resp = client.post(f"/api/assets/{asset_id}/identify", json={
                "asset_kind": "character",
                "name": "林岚",
                "extract_identity": True,
            })
            assert resp.status_code == 200, resp.text
            payload = resp.json()
            assert payload["visual_identity"]["face_anchor"] == "oval face"
            assert payload["visual_identity"]["clothing"] == "navy jacket"
            assert payload["story_entity_id"]
            db.expire_all()
            asset = db.query(Asset).filter_by(id=asset_id).one()
            assert asset.visual_identity["face_anchor"] == "oval face"
        finally:
            db.query(Asset).filter(Asset.id == asset_id).delete()
            db.commit()
            db.close()

    def test_identify_without_extract_keeps_visual_identity_empty(self):
        import uuid as _uuid
        from fastapi.testclient import TestClient
        from app import app
        from app.database import SessionLocal

        asset_id = f"identify-no-extract-{_uuid.uuid4().hex[:8]}"
        db = SessionLocal()
        try:
            db.add(Asset(
                id=asset_id, project_id="p-extract", kind="image",
                name="侧脸照", url="https://cdn.test/face.png",
            ))
            db.commit()
            client = TestClient(app)
            resp = client.post(f"/api/assets/{asset_id}/identify", json={
                "asset_kind": "character",
                "name": "林岚",
            })
            assert resp.status_code == 200, resp.text
            assert resp.json()["visual_identity"] == {}
        finally:
            db.query(Asset).filter(Asset.id == asset_id).delete()
            db.commit()
            db.close()


# ========================
# 工作室镜头回画布
# ========================

def test_persist_shot_asset_creates_canvas_node(db_session):
    """shot 资产落库时同步创建画布节点，data 字段与 rebuild 约定对齐。"""
    from app.models import Node

    shot = studio._persist_shot_asset(
        db_session,
        project_id="p1",
        brief="雨夜天台对峙",
        shot_prompt="rooftop confrontation, rain, cinematic",
        shot_notes="",
        url="https://cdn.test/shot-node.png",
        provider_id="img-p",
        model="img-model",
        round_no=1,
        character_card_ids=["card1"],
    )
    node = db_session.query(Node).filter_by(id=f"studio-shot-{shot.id}").one()
    assert node.project_id == "p1"
    assert node.type == "image"
    assert node.data["url"] == "https://cdn.test/shot-node.png"
    assert node.data["_assetKind"] == "shot"
    assert node.data["_assetPrompt"] == "rooftop confrontation, rain, cinematic"
    assert node.data["_origin"] == "studio"


def test_studio_shot_node_not_duplicated_by_rebuild(db_session):
    """rebuild-from-nodes 不会把工作室镜头节点再复制成重复资产。"""
    from app.routers.assets import rebuild_assets_from_nodes

    studio._persist_shot_asset(
        db_session,
        project_id="p1",
        brief="雨夜天台对峙",
        shot_prompt="rooftop confrontation, rain, cinematic",
        shot_notes="",
        url="https://cdn.test/shot-node2.png",
        provider_id="img-p",
        model="img-model",
        round_no=1,
    )
    assets_before = db_session.query(Asset).filter_by(project_id="p1", asset_kind="shot").count()

    result = rebuild_assets_from_nodes("p1", db_session)

    assert result["created"] == 0
    assert db_session.query(Asset).filter_by(project_id="p1", asset_kind="shot").count() == assets_before


def test_multiple_versions_each_get_own_node(db_session):
    """多版本重生成：每个版本资产有自己的节点。"""
    from app.models import Node

    ids = []
    for round_no in (1, 2):
        shot = studio._persist_shot_asset(
            db_session,
            project_id="p1",
            brief="雨夜天台对峙",
            shot_prompt=f"round {round_no} prompt",
            shot_notes="",
            url=f"https://cdn.test/shot-v{round_no}.png",
            provider_id="img-p",
            model="img-model",
            round_no=round_no,
        )
        ids.append(shot.id)
    nodes = db_session.query(Node).filter(Node.id.in_([f"studio-shot-{i}" for i in ids])).all()
    assert len(nodes) == 2
    assert {n.data["url"] for n in nodes} == {
        "https://cdn.test/shot-v1.png", "https://cdn.test/shot-v2.png",
    }
