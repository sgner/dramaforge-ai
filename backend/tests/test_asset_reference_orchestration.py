"""资产引用编排测试。"""
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import Base
from app.schemas import ConnectionOut
from app.models import Connection
from app.agent.tools.asset_registry_helpers import collect_canvas_references


@pytest.fixture
def db_session():
    """In-memory sqlite — 不污染真实 DB（与 test_asset_registry 一致的做法）。"""
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine)
    session = Session()
    yield session
    session.close()
    engine.dispose()


class TestConnectionData:
    def test_connection_out_accepts_data_field(self):
        conn = ConnectionOut(
            id="c1", from_node="n1", to_node="n2",
            data={"asset_ref": "asset-1", "role": "reference"},
        )
        assert conn.data["asset_ref"] == "asset-1"
        assert conn.data["role"] == "reference"

    def test_connection_out_data_defaults_to_empty_dict(self):
        conn = ConnectionOut(id="c1", from_node="n1", to_node="n2")
        assert conn.data == {}

    def test_old_connections_without_data_still_work(self):
        conn = ConnectionOut(id="c1", from_node="n1", to_node="n2",
                              from_port="out", to_port="in")
        assert conn.data == {}


class TestCollectCanvasReferences:
    def test_collects_asset_ref_from_connections(self, db_session):
        db_session.add(Connection(
            id="c1", project_id="p1", from_node="n1", to_node="n2",
            data={"asset_ref": "asset-1", "role": "reference"},
        ))
        db_session.commit()
        result = collect_canvas_references(db_session, "p1")
        assert "asset-1" in result

    def test_filters_by_target_node(self, db_session):
        db_session.add(Connection(
            id="c1", project_id="p1", from_node="n1", to_node="n2",
            data={"asset_ref": "asset-1"},
        ))
        db_session.add(Connection(
            id="c2", project_id="p1", from_node="n3", to_node="n4",
            data={"asset_ref": "asset-2"},
        ))
        db_session.commit()
        result = collect_canvas_references(db_session, "p1", target_node_id="n2")
        assert "asset-1" in result
        assert "asset-2" not in result

    def test_skips_connections_without_asset_ref(self, db_session):
        db_session.add(Connection(
            id="c1", project_id="p1", from_node="n1", to_node="n2",
            data={},
        ))
        db_session.commit()
        result = collect_canvas_references(db_session, "p1")
        assert result == []

    def test_deduplicates_asset_ids(self, db_session):
        db_session.add(Connection(
            id="c1", project_id="p1", from_node="n1", to_node="n2",
            data={"asset_ref": "asset-1"},
        ))
        db_session.add(Connection(
            id="c2", project_id="p1", from_node="n3", to_node="n4",
            data={"asset_ref": "asset-1"},
        ))
        db_session.commit()
        result = collect_canvas_references(db_session, "p1")
        assert result.count("asset-1") == 1

    def test_returns_empty_when_no_connections(self, db_session):
        result = collect_canvas_references(db_session, "p1")
        assert result == []
