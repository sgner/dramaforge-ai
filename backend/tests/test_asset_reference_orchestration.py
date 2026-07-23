"""资产引用编排测试。"""
import pytest
from app.schemas import ConnectionOut


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
