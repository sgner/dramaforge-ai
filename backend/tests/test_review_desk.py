"""审片台（人审层）测试：镜头列表版本分组、人审状态流转、闭环自动落待审。"""
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app import app
from app.agent import studio
from app.agent.studio import list_shots, review_shot, run_studio_shot
from app.database import get_db, Base
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
    session.commit()
    yield session
    session.close()
    engine.dispose()


def _shot(db, aid, brief, review_status=None, critic_status=None):
    extra = {"brief": brief, "character_card_ids": []}
    if review_status:
        extra["review_status"] = review_status
    if critic_status:
        extra["critic_status"] = critic_status
    db.add(Asset(
        id=aid, project_id="p1", kind="image", asset_kind="shot",
        title=brief[:40], name=brief[:40], url=f"https://cdn.test/{aid}.png",
        status="ready", extra=extra,
    ))
    db.commit()


def test_list_shots_groups_versions_by_brief(db_session):
    _shot(db_session, "s1", "开场")
    _shot(db_session, "s2", "开场")   # 同 brief → 版本 2
    _shot(db_session, "s3", "对峙")
    shots = list_shots(db_session, "p1")
    by_id = {s["asset_id"]: s for s in shots}
    assert by_id["s1"]["version"] == 1 and by_id["s1"]["versions"] == 2
    assert by_id["s2"]["version"] == 2 and by_id["s2"]["versions"] == 2
    assert by_id["s3"]["version"] == 1 and by_id["s3"]["versions"] == 1
    # 默认待审
    assert by_id["s1"]["review_status"] == "pending_review"


def test_review_shot_transitions(db_session):
    _shot(db_session, "s1", "开场")
    assert review_shot(db_session, "s1", "approve")["review_status"] == "approved"
    assert review_shot(db_session, "s1", "reject", note="脸不像")["review_note"] == "脸不像"
    assert review_shot(db_session, "s1", "lock")["review_status"] == "locked"
    assert review_shot(db_session, "s1", "unlock")["review_status"] == "pending_review"


def test_review_shot_validates(db_session):
    with pytest.raises(ValueError, match="unknown review action"):
        review_shot(db_session, "s1", "explode")
    with pytest.raises(ValueError, match="not found"):
        review_shot(db_session, "ghost", "approve")


class _Resp:
    def __init__(self, content):
        self.content = content


@pytest.mark.asyncio
async def test_run_loop_marks_shot_pending_review(db_session, monkeypatch):
    """闭环结束后镜头自动带上 critic_status + pending_review。"""
    class FakeLLM:
        async def generate_structured(self, messages, json_schema=None, temperature=0.7, max_tokens=4096):
            return _Resp('{"shot_prompt": "p", "shot_notes": "n"}')

    monkeypatch.setattr(studio, "select_llm_for_task", lambda *a, **k: FakeLLM())

    class Out:
        url = "https://cdn.test/shot.png"

    async def fake_media(provider, body):
        return Out()

    async def fake_inspect(db, project_id, asset_id, llm):
        return {"meets_standard": True, "missing_fields": [], "notes": "", "recommended_action": "approve_asset"}

    monkeypatch.setattr(studio, "_openai_image", fake_media)
    monkeypatch.setattr(studio, "inspect_asset", fake_inspect)

    result = await run_studio_shot(
        db_session, project_id="p1", brief="雨夜",
        image_provider_id="img-p", image_model="m",
    )
    asset = db_session.query(Asset).filter_by(id=result.asset_id).first()
    assert asset.extra["critic_status"] == "approved"
    assert asset.extra["review_status"] == "pending_review"


# ---------- HTTP 端点 ----------

@pytest.fixture
def client(db_session):
    def _override():
        try:
            yield db_session
        finally:
            pass
    app.dependency_overrides[get_db] = _override
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.clear()


def test_review_endpoints(client, db_session):
    _shot(db_session, "s1", "开场")
    r = client.get("/api/studio/shots", params={"project_id": "p1"})
    assert r.status_code == 200
    assert r.json()[0]["review_status"] == "pending_review"

    r = client.post("/api/studio/shots/s1/review", json={"action": "approve"})
    assert r.status_code == 200
    assert r.json()["review_status"] == "approved"

    r = client.post("/api/studio/shots/s1/review", json={"action": "explode"})
    assert r.status_code == 400
