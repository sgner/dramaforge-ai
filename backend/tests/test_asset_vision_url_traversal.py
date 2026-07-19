"""安全回归：asset_intelligence._vision_url 路径遍历防护。

Bug 背景：asset.url 用户可控（create_asset 接受任意 url），旧实现只要以
/files/ 开头就 Path(uploads) / filename 直接 read_bytes()，
/files/../../dramaforge.db 可读出本地任意文件并 base64 发给 LLM provider。

修复后：拒绝任何带目录分量（/、\\、.、..）的 filename，拼接 resolve 后
必须落在 uploads 目录内；不合法时返回原始 url（不读取本地文件）。
"""
import base64
import uuid
from pathlib import Path

import pytest

from app.agent.asset_intelligence import _vision_url
from app.models import Asset

UPLOAD_DIR = Path(__file__).resolve().parents[1] / "app" / "uploads"
# backend/dramaforge.db 一定存在（开发库），作为" uploads 外的敏感文件"靶子
SENSITIVE_FILE = Path(__file__).resolve().parents[1] / "dramaforge.db"


def _asset(url: str) -> Asset:
    return Asset(id="t", project_id="p", kind="image", url=url, extra={})


@pytest.mark.parametrize("evil_url", [
    "/files/../../dramaforge.db",
    "/files/..\\..\\dramaforge.db",       # Windows 反斜杠
    "/files/sub/../../etc",
    "/files/..",
    "/files/.",
    "/files/",                            # 空 filename
    "/files//etc/passwd",
    "/files/a/b.png",                     # 子目录也拒绝（不在白名单语义内）
])
def test_vision_url_rejects_path_traversal(evil_url):
    result = _vision_url(_asset(evil_url))
    # 拒绝 = 不读取本地文件，原样返回 url（绝不返回 data: base64）
    assert result == evil_url
    assert not result.startswith("data:")


def test_vision_url_traversal_does_not_leak_real_file():
    """靶子文件真实存在时也不能被读出（dramaforge.db 在 uploads 目录外）。"""
    assert SENSITIVE_FILE.is_file(), "test precondition: dramaforge.db should exist"
    result = _vision_url(_asset("/files/../../dramaforge.db"))
    assert result == "/files/../../dramaforge.db"
    assert not result.startswith("data:")


def test_vision_url_reads_normal_upload(tmp_path):
    """正常 /files/xxx.png 不受影响：读取 uploads 内文件并返回 data: URL。"""
    fname = f"test-vision-{uuid.uuid4().hex[:8]}.png"
    content = b"\x89PNG\r\n\x1a\n-fake-image-bytes"
    fpath = UPLOAD_DIR / fname
    fpath.write_bytes(content)
    try:
        result = _vision_url(_asset(f"/files/{fname}"))
        assert result.startswith("data:")
        encoded = result.split("base64,", 1)[1]
        assert base64.b64decode(encoded) == content
        # PNG 应被猜测为 image/png
        assert result.startswith("data:image/png")
    finally:
        fpath.unlink(missing_ok=True)


def test_vision_url_missing_file_returns_url():
    """uploads 内不存在该文件 → 原样返回 url（旧行为保留）。"""
    url = "/files/definitely-not-exists-12345.png"
    assert _vision_url(_asset(url)) == url


def test_vision_url_non_local_url_passthrough():
    """非 /files/ 开头的 url（远程 URL）原样透传。"""
    url = "https://example.com/image.png"
    assert _vision_url(_asset(url)) == url
