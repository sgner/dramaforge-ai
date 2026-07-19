"""Track A 成片导出测试（studio_export）。

hermetic：不依赖真实 ffmpeg / 真实下载——
- _run / _download 全部 monkeypatch，验证流程编排、命令参数与资产登记。
"""
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app import app
from app.database import get_db, Base
from app.models import Asset
from app.agent import studio_export
from app.agent.studio_export import export_sequence, _local_path_for_url, _segment_cmd


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
    yield session
    session.close()
    engine.dispose()


def _add_asset(db, aid, kind="image", url="https://cdn.test/x.png", project_id="p1"):
    db.add(Asset(id=aid, project_id=project_id, kind=kind, url=url, status="ready"))
    db.commit()


@pytest.fixture
def fake_ffmpeg(monkeypatch, tmp_path):
    """假装 ffmpeg 存在且成功：_run 记录命令并真的写出输出文件。"""
    monkeypatch.setattr(studio_export, "_ffmpeg_path", lambda: "ffmpeg")
    calls = []

    async def fake_run(cmd, timeout):
        calls.append(cmd)
        out = Path(cmd[-1])
        if out.suffix == ".mp4":
            out.write_bytes(b"MP4DATA")

    monkeypatch.setattr(studio_export, "_run", fake_run)

    async def fake_download(url, dest_dir):
        dest = dest_dir / "dl.bin"
        dest.write_bytes(b"IMG")
        return dest

    monkeypatch.setattr(studio_export, "_download", fake_download)
    # uploads 输出目录重定向到临时目录，不碰真实 uploads
    monkeypatch.setattr(studio_export, "_UPLOAD_DIR", tmp_path)
    return calls


@pytest.mark.asyncio
async def test_export_builds_segments_and_concat(db_session, fake_ffmpeg):
    """2 图 1 视频 → 3 个片段命令 + 1 条 concat；图片片段带 -loop 1 -t。"""
    _add_asset(db_session, "a1", "image", "https://cdn.test/1.png")
    _add_asset(db_session, "a2", "image", "https://cdn.test/2.png")
    _add_asset(db_session, "a3", "video", "https://cdn.test/3.mp4")

    result = await export_sequence(
        db_session, project_id="p1", asset_ids=["a1", "a2", "a3"], sec_per_image=2.5,
    )
    assert result["segments"] == 3
    assert result["url"].startswith("/files/export_")

    seg_cmds = [c for c in fake_ffmpeg if "concat" not in c]
    concat_cmds = [c for c in fake_ffmpeg if "concat" in c]
    assert len(seg_cmds) == 3 and len(concat_cmds) == 1
    # 图片片段：-loop 1 -t 2.50；视频片段：无 -loop
    assert "-loop" in seg_cmds[0] and "2.50" in seg_cmds[0]
    assert "-loop" not in seg_cmds[2]
    # 统一规整参数
    assert any("1280:720" in str(c) for c in seg_cmds[0])
    # concat 用 -c copy
    assert "-c" in concat_cmds[0] and "copy" in concat_cmds[0]
    # 资产登记
    asset = db_session.query(Asset).filter_by(id=result["asset_id"]).first()
    assert asset.kind == "video" and asset.asset_kind == "sequence"
    assert asset.extra["segment_asset_ids"] == ["a1", "a2", "a3"]


@pytest.mark.asyncio
async def test_export_empty_ids_rejected(db_session):
    with pytest.raises(ValueError):
        await export_sequence(db_session, project_id="p1", asset_ids=[])


@pytest.mark.asyncio
async def test_export_unknown_asset_rejected(db_session, fake_ffmpeg):
    with pytest.raises(ValueError, match="not found"):
        await export_sequence(db_session, project_id="p1", asset_ids=["ghost"])


def test_local_path_resolution(tmp_path, monkeypatch):
    """/files/<name> 解析到 uploads；越界/不存在返回 None。"""
    monkeypatch.setattr(studio_export, "_UPLOAD_DIR", tmp_path)
    (tmp_path / "ok.png").write_bytes(b"x")
    assert _local_path_for_url("/files/ok.png") == (tmp_path / "ok.png").resolve()
    assert _local_path_for_url("/files/missing.png") is None
    assert _local_path_for_url("/files/../evil.png") is None
    assert _local_path_for_url("https://cdn.test/x.png") is None
    assert _local_path_for_url("") is None


def test_segment_cmd_image_vs_video(tmp_path):
    src, dest = tmp_path / "a.png", tmp_path / "seg.mp4"
    img_cmd = _segment_cmd("ffmpeg", src, True, 3.0, dest)
    vid_cmd = _segment_cmd("ffmpeg", src, False, 3.0, dest)
    assert img_cmd[img_cmd.index("-t") + 1] == "3.00"
    assert "-loop" in img_cmd and "-loop" not in vid_cmd
    assert "-an" in img_cmd and "-an" in vid_cmd


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


def test_export_endpoint(client, db_session, fake_ffmpeg):
    _add_asset(db_session, "a1", "image", "https://cdn.test/1.png")
    r = client.post("/api/studio/export", json={
        "project_id": "p1", "asset_ids": ["a1"], "sec_per_image": 2,
    })
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["segments"] == 1
    assert data["url"].startswith("/files/export_")


def test_export_endpoint_400_on_empty(client):
    r = client.post("/api/studio/export", json={"project_id": "p1", "asset_ids": []})
    assert r.status_code == 422  # pydantic min_length=1
