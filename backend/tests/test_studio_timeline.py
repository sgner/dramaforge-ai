"""剪辑台时间线持久化 + 导出旁白登记测试。"""
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import Base
from app.models import Asset


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


def _seed(db):
    db.add_all([
        Asset(id="a1", project_id="p1", kind="image", asset_kind="shot", name="镜头1", url="https://cdn.test/a1.png", status="ready"),
        Asset(id="a2", project_id="p1", kind="image", asset_kind="shot", name="镜头2", url="https://cdn.test/a2.png", status="ready"),
        Asset(id="ax", project_id="p2", kind="image", asset_kind="shot", name="别项目", url="https://cdn.test/ax.png", status="ready"),
    ])
    db.commit()


def test_timeline_put_get_roundtrip(db_session):
    from app.routers.studio import get_studio_timeline, save_studio_timeline, StudioTimelineIn, TimelineItemIn
    _seed(db_session)

    result = save_studio_timeline(StudioTimelineIn(
        project_id="p1",
        items=[
            TimelineItemIn(asset_id="a1", sec=3.0, caption="雨夜开场"),
            TimelineItemIn(asset_id="a2", sec=2.5, caption=""),
        ],
    ), db=db_session)
    assert result["dropped"] == 0
    assert len(result["items"]) == 2

    loaded = get_studio_timeline(project_id="p1", db=db_session)
    assert loaded["items"][0]["asset_id"] == "a1"
    assert loaded["items"][0]["caption"] == "雨夜开场"
    assert loaded["items"][1]["sec"] == 2.5


def test_timeline_empty_when_never_saved(db_session):
    from app.routers.studio import get_studio_timeline
    loaded = get_studio_timeline(project_id="p-empty", db=db_session)
    assert loaded["items"] == []
    assert loaded["updated_at"] is None


def test_timeline_drops_unknown_and_cross_project_assets(db_session):
    from app.routers.studio import save_studio_timeline, StudioTimelineIn, TimelineItemIn
    _seed(db_session)

    result = save_studio_timeline(StudioTimelineIn(
        project_id="p1",
        items=[
            TimelineItemIn(asset_id="a1", sec=3.0),
            TimelineItemIn(asset_id="ghost", sec=3.0),
            TimelineItemIn(asset_id="ax", sec=3.0),
        ],
    ), db=db_session)
    assert [i["asset_id"] for i in result["items"]] == ["a1"]
    assert result["dropped"] == 2


def test_timeline_save_overwrites_previous(db_session):
    from app.routers.studio import get_studio_timeline, save_studio_timeline, StudioTimelineIn, TimelineItemIn
    from app.models import StudioTimeline
    _seed(db_session)

    save_studio_timeline(StudioTimelineIn(
        project_id="p1",
        items=[TimelineItemIn(asset_id="a1", sec=3.0), TimelineItemIn(asset_id="a2", sec=3.0)],
    ), db=db_session)
    save_studio_timeline(StudioTimelineIn(
        project_id="p1",
        items=[TimelineItemIn(asset_id="a2", sec=4.0, caption="只留镜头2")],
    ), db=db_session)

    assert db_session.query(StudioTimeline).filter_by(project_id="p1").count() == 1
    loaded = get_studio_timeline(project_id="p1", db=db_session)
    assert len(loaded["items"]) == 1
    assert loaded["items"][0]["asset_id"] == "a2"
    assert loaded["items"][0]["caption"] == "只留镜头2"

