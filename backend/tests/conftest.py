"""全局 pytest fixtures。"""
import pytest

from app.database import init_db, engine, Base
from app import models  # noqa: F401 - 触发模型注册


@pytest.fixture(autouse=True)
def setup_database():
    """每个测试前重新建表。"""
    Base.metadata.drop_all(bind=engine)
    init_db()
    yield
    Base.metadata.drop_all(bind=engine)
