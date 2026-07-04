"""全局 pytest fixtures。"""
import pytest

from app.database import init_db, engine, Base
from app import models  # noqa: F401 - 触发模型注册


@pytest.fixture(autouse=True)
def setup_database():
    """每个测试前重新建表。

    注意：只在前置 setup 时 drop+init；tearDown 不再 drop_all，
    否则最后一个测试结束时会清空开发环境的 SQLite 表，
    导致正在跑的后端报 500。
    """
    Base.metadata.drop_all(bind=engine)
    init_db()
    yield
