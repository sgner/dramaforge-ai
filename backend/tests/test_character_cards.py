"""Track C 角色卡一致性测试。

- create_character_card：vision LLM 提取身份指纹、落卡、引用校验
- studio 闭环接入：编剧收身份块、美术带参考图、一致性打回进反馈
"""
import json

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.agent import studio
from app.agent.character_cards import (
    check_consistency,
    create_character_card,
    identity_block,
    load_character_cards,
    reference_urls,
)
from app.agent.studio import run_studio_shot
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
    session.add(Asset(id="ref1", project_id="p1", kind="image", url="https://cdn.test/ref1.png", status="ready"))
    session.add(Asset(id="ref2", project_id="p1", kind="image", url="https://cdn.test/ref2.png", status="ready"))
    session.commit()
    yield session
    session.close()
    engine.dispose()


class _Resp:
    def __init__(self, content):
        self.content = content


IDENTITY = {
    "face_anchor": "oval face, sharp jaw, gray eyes",
    "hair": "short black hair",
    "clothing": "navy jacket over white tee",
    "distinctive_features": "scar on left eyebrow",
    "style": "cinematic realism",
}


class FakeLLM:
    def __init__(self, scripted=None):
        self.calls = []
        self.scripted = scripted or {}

    async def generate_structured(self, messages, json_schema=None, temperature=0.7, max_tokens=4096):
        self.calls.append(messages)
        user = messages[-1]["content"]
        text = user if isinstance(user, str) else json.dumps(user, ensure_ascii=False)
        for key, value in self.scripted.items():
            if key in text:
                return _Resp(value if isinstance(value, str) else json.dumps(value))
        return _Resp(json.dumps(IDENTITY))


@pytest.mark.asyncio
async def test_create_card_extracts_identity(db_session):
    llm = FakeLLM()
    card = await create_character_card(
        db_session, project_id="p1", name="林岚",
        reference_asset_ids=["ref1", "ref2"], llm=llm,
    )
    assert card.asset_kind == "character"
    assert card.status == "ready"
    assert card.visual_identity["face_anchor"] == IDENTITY["face_anchor"]
    assert card.extra["character_card"] is True
    assert card.extra["reference_asset_ids"] == ["ref1", "ref2"]
    # 建卡请求带了参考图（image_url parts）
    user_content = llm.calls[0][-1]["content"]
    image_parts = [p for p in user_content if p.get("type") == "image_url"]
    assert len(image_parts) == 2


@pytest.mark.asyncio
async def test_create_card_validates_refs(db_session):
    with pytest.raises(ValueError, match="not found"):
        await create_character_card(
            db_session, project_id="p1", name="x",
            reference_asset_ids=["ghost"], llm=FakeLLM(),
        )
    with pytest.raises(ValueError, match="does not belong"):
        await create_character_card(
            db_session, project_id="other-project", name="x",
            reference_asset_ids=["ref1"], llm=FakeLLM(),
        )


def test_identity_block_and_reference_urls(db_session):
    card = db_session.query(Asset).filter_by(id="ref1").first()
    card.asset_kind = "character"
    card.name = "林岚"
    card.visual_identity = IDENTITY
    card.extra = {"character_card": True, "reference_asset_ids": ["ref1", "ref2"]}
    block = identity_block(card)
    assert "MUST PRESERVE" in block
    assert "gray eyes" in block and "scar on left eyebrow" in block
    assert reference_urls(db_session, card) == ["https://cdn.test/ref1.png", "https://cdn.test/ref2.png"]
    cards = load_character_cards(db_session, "p1", ["ref1"])
    assert len(cards) == 1


@pytest.mark.asyncio
async def test_consistency_check_parsing(db_session):
    card = db_session.query(Asset).filter_by(id="ref1").first()
    card.asset_kind = "character"
    card.name = "林岚"
    card.visual_identity = IDENTITY
    card.extra = {"character_card": True, "reference_asset_ids": []}
    shot = Asset(id="shot1", project_id="p1", kind="image", url="https://cdn.test/shot.png")

    good = await check_consistency(db_session, card, shot, FakeLLM({"identity": {"consistent": True, "score": 0.9, "issues": []}}))
    assert good["consistent"] is True and good["score"] == 0.9

    bad = await check_consistency(db_session, card, shot, FakeLLM({"identity": {"consistent": False, "score": 0.3, "issues": ["hair color changed"]}}))
    assert bad["consistent"] is False and "hair color changed" in bad["issues"]

    # 解析失败放行不阻塞
    passthrough = await check_consistency(db_session, card, shot, FakeLLM({"identity": "not json at all"}))
    assert passthrough["consistent"] is True and passthrough["score"] == 0.5


# ---------- studio 闭环接入角色卡 ----------

@pytest.fixture
def studio_mocks(db_session, monkeypatch):
    llm = FakeLLM()
    monkeypatch.setattr(studio, "select_llm_for_task", lambda *a, **k: llm)

    class Out:
        url = "https://cdn.test/shot.png"

    captured = {}

    async def fake_openai_image(provider, body):
        captured["ref_urls"] = list(body.ref_urls)
        return Out()

    monkeypatch.setattr(studio, "_openai_image", fake_openai_image)

    async def fake_inspect(db, project_id, asset_id, llm_):
        return {"meets_standard": True, "missing_fields": [], "notes": "", "recommended_action": "approve_asset"}

    monkeypatch.setattr(studio, "inspect_asset", fake_inspect)
    return llm, captured


def _make_card(db_session):
    card = Asset(
        id="card1", project_id="p1", kind="image", asset_kind="character",
        name="林岚", url="https://cdn.test/ref1.png", status="ready",
        visual_identity=IDENTITY,
        extra={"character_card": True, "reference_asset_ids": ["ref1", "ref2"]},
    )
    db_session.add(card)
    db_session.commit()
    return card


@pytest.mark.asyncio
async def test_shot_with_card_injects_identity_and_refs(db_session, studio_mocks, monkeypatch):
    llm, captured = studio_mocks
    _make_card(db_session)

    async def fake_consistency(db, card, shot, llm_):
        return {"consistent": True, "score": 0.9, "issues": [], "character": card.name}

    monkeypatch.setattr(studio, "check_consistency", fake_consistency)
    result = await run_studio_shot(
        db_session, project_id="p1", brief="雨夜天台对峙",
        image_provider_id="img-p", image_model="img-model",
        character_card_ids=["card1"],
    )
    assert result.status == "approved"
    # 编剧收到身份块
    writer_msg = llm.calls[0][-1]["content"]
    assert "MUST PRESERVE" in writer_msg and "scar on left eyebrow" in writer_msg
    # 美术收到参考图
    assert captured["ref_urls"] == ["https://cdn.test/ref1.png", "https://cdn.test/ref2.png"]
    # 质检 trace 带一致性结果
    critic_step = [s for s in result.trace if s.role == "critic"][0]
    assert critic_step.detail["consistency"][0]["score"] == 0.9


@pytest.mark.asyncio
async def test_consistency_failure_loops_back_with_issues(db_session, studio_mocks, monkeypatch):
    llm, _ = studio_mocks
    _make_card(db_session)
    calls = {"n": 0}

    async def fake_consistency(db, card, shot, llm_):
        calls["n"] += 1
        ok = calls["n"] >= 2
        return {"consistent": ok, "score": 0.9 if ok else 0.2,
                "issues": [] if ok else ["hair color changed"], "character": card.name}

    monkeypatch.setattr(studio, "check_consistency", fake_consistency)
    result = await run_studio_shot(
        db_session, project_id="p1", brief="雨夜天台对峙",
        image_provider_id="img-p", image_model="img-model",
        character_card_ids=["card1"],
    )
    assert result.status == "approved"
    assert result.rounds == 2
    # 第二轮编剧收到一致性问题反馈
    second_writer_msg = llm.calls[1][-1]["content"]
    assert "hair color changed" in second_writer_msg
