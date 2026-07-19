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
