"""Bug 3 回归：上传安全 —— 扩展名白名单 + 大小上限。

修复前：仅校验客户端自报的 content_type（可伪造），无扩展名白名单、无大小
限制 —— 可上传 .html/.svg 经 /files 静态服务按 text/html 返回（存储型 XSS），
或写满磁盘。
修复后：白名单外扩展名 415；超 50MB 413；危险类型（.html/.svg/.exe）默认拒绝。
"""
import os
import sys

import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from app import app  # noqa: E402
from app.routers import uploads  # noqa: E402


@pytest.fixture
def client():
    with TestClient(app) as c:
        yield c


def _upload(client, filename: str, content: bytes, content_type: str):
    return client.post(
        "/api/uploads/image",
        files={"file": (filename, content, content_type)},
    )


# ============ 危险扩展名：415 ============

@pytest.mark.parametrize("filename,content_type", [
    ("evil.html", "text/html"),
    ("evil.svg", "image/svg+xml"),   # svg 可内嵌脚本 → 存储型 XSS，默认拒绝
    ("evil.exe", "application/octet-stream"),
    ("evil.htm", "text/html"),
])
def test_dangerous_extensions_rejected(client, filename, content_type):
    r = _upload(client, filename, b"<script>alert(1)</script>", content_type)
    assert r.status_code == 415, f"{filename} should be rejected: {r.status_code} {r.text}"


def test_svg_rejected_even_with_image_content_type(client):
    """content_type 伪装成 image/svg+xml（image/ 前缀）也不能绕过扩展名白名单。"""
    r = _upload(client, "icon.svg", b"<svg onload=alert(1)></svg>", "image/svg+xml")
    assert r.status_code == 415


def test_extension_whitelist_beats_forged_content_type(client):
    """.html 文件即使伪装 content_type=image/png 也被拒。"""
    r = _upload(client, "fake.html", b"<html></html>", "image/png")
    assert r.status_code == 415


def test_no_extension_rejected(client):
    r = _upload(client, "noext", b"data", "image/png")
    assert r.status_code == 415


# ============ 大小上限：413 ============

def test_oversized_file_rejected(client, monkeypatch, tmp_path):
    """超过大小上限 → 413，且半成品文件被清理。"""
    # 把上限调小到 10 字节，避免在测试里真写 50MB
    monkeypatch.setattr(uploads, "MAX_UPLOAD_BYTES", 10)
    monkeypatch.setattr(uploads, "UPLOAD_DIR", tmp_path)

    big = b"x" * 1024  # 1KB > 10B 上限
    r = _upload(client, "big.png", big, "image/png")
    assert r.status_code == 413, f"expected 413, got {r.status_code}: {r.text}"
    # 半成品必须被清理
    assert list(tmp_path.iterdir()) == []


def test_file_at_limit_accepted(client, monkeypatch, tmp_path):
    monkeypatch.setattr(uploads, "MAX_UPLOAD_BYTES", 1024)
    monkeypatch.setattr(uploads, "UPLOAD_DIR", tmp_path)
    r = _upload(client, "ok.png", b"x" * 1024, "image/png")
    assert r.status_code == 200
    assert r.json()["size"] == 1024


# ============ 正常类型：通过 ============

@pytest.mark.parametrize("filename,content_type", [
    ("photo.png", "image/png"),
    ("photo.jpg", "image/jpeg"),
    ("photo.jpeg", "image/jpeg"),
    ("photo.webp", "image/webp"),
    ("anim.gif", "image/gif"),
])
def test_normal_images_accepted(client, filename, content_type):
    r = _upload(client, filename, b"\x89PNG\r\n\x1a\n fake", content_type)
    assert r.status_code == 200, f"{filename} should pass: {r.status_code} {r.text}"
    body = r.json()
    assert body["url"].startswith("/files/")
    assert body["size"] > 0


def test_video_upload_via_asset_endpoint(client, tmp_path, monkeypatch):
    """/uploads/asset 接受 mp4（扩展名判定 kind=video），拒绝危险类型。"""
    from app.database import Base, engine, SessionLocal
    from app.models import Project, Asset

    Base.metadata.create_all(bind=engine)
    with SessionLocal() as s:
        s.add(Project(id="proj-upload-test", name="t"))
        s.commit()

    monkeypatch.setattr(uploads, "UPLOAD_DIR", tmp_path)
    try:
        # 正常 mp4 → 200
        r = client.post(
            "/api/uploads/asset",
            data={"project_id": "proj-upload-test"},
            files={"file": ("clip.mp4", b"\x00\x00\x00\x18ftypmp42", "video/mp4")},
        )
        assert r.status_code == 200, r.text
        assert r.json()["kind"] == "video"

        # 危险扩展名 → 415
        r = client.post(
            "/api/uploads/asset",
            data={"project_id": "proj-upload-test"},
            files={"file": ("evil.html", b"<html></html>", "text/html")},
        )
        assert r.status_code == 415

        # svg 伪装视频 → 415
        r = client.post(
            "/api/uploads/asset",
            data={"project_id": "proj-upload-test"},
            files={"file": ("evil.svg", b"<svg></svg>", "video/mp4")},
        )
        assert r.status_code == 415
    finally:
        with SessionLocal() as s:
            s.query(Asset).filter_by(project_id="proj-upload-test").delete()
            s.query(Project).filter_by(id="proj-upload-test").delete()
            s.commit()
