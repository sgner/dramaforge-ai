"""Track A 成片最小版：把一组镜头资产（图片/视频）按顺序合成一个 mp4。

流程：解析资产 URL（/files 本地 / http 远程下载）→ 每个镜头规整为统一参数的
片段（1280x720 pad、30fps、libx264、无音轨）→ concat 拼接 → 落 uploads 并登记 Asset。

设计约束：
- 最小可用：无转场、无音轨（配音/BGM 后续迭代）；旁白可通过 drawtext 烧录。
- ffmpeg 不存在时抛 RuntimeError（路由层转 500，带安装提示）。
- 本地路径解析复用与 media 路由相同的 uploads 目录约定 + 目录穿越防护。
"""
from __future__ import annotations

import asyncio
import logging
import mimetypes
import os
import shutil
import tempfile
import uuid
from pathlib import Path
from typing import Any

import httpx
from sqlalchemy.orm import Session

logger = logging.getLogger("dramaforge.studio.export")

_UPLOAD_DIR = Path(__file__).resolve().parent.parent / "uploads"

WIDTH, HEIGHT, FPS = 1280, 720, 30
SEG_TIMEOUT_SEC = 180
EXPORT_TIMEOUT_SEC = 300

# 字幕烧录字体候选（env 覆盖优先；Windows/macOS/Linux 常见中文字体）。
_CAPTION_FONT_CANDIDATES = [
    "C:/Windows/Fonts/msyh.ttc",
    "C:/Windows/Fonts/simhei.ttf",
    "C:/Windows/Fonts/arial.ttf",
    "/System/Library/Fonts/PingFang.ttc",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
]


def _caption_font() -> str | None:
    """解析可用的字幕字体路径；找不到返回 None（跳过烧录，caption 仍登记在 extra）。"""
    override = os.environ.get("DRAMAFORGE_CAPTION_FONT")
    candidates = [override] if override else []
    candidates += _CAPTION_FONT_CANDIDATES
    for candidate in candidates:
        if candidate and Path(candidate).is_file():
            return candidate
    return None


def _escape_drawtext(text: str) -> str:
    """转义 ffmpeg drawtext 的 text 参数（\\ : ' % , 都是特殊字符）。"""
    return (
        text.replace("\\", "\\\\")
        .replace(":", "\\:")
        .replace("'", "\\'")
        .replace("%", "\\%")
        .replace(",", "\\,")
    )


def _caption_filter(caption: str, font: str) -> str:
    """底部居中白字黑边字幕的 drawtext 滤镜段。"""
    font_path = font.replace("\\", "/").replace(":", "\\:")
    return (
        f"drawtext=fontfile='{font_path}':text='{_escape_drawtext(caption)}':"
        f"fontsize=36:fontcolor=white:borderw=2:bordercolor=black:"
        f"x=(w-text_w)/2:y=h-72"
    )


def _ffmpeg_path() -> str:
    exe = shutil.which("ffmpeg")
    if not exe:
        raise RuntimeError(
            "ffmpeg not found in PATH. 安装 ffmpeg 后重试（Windows: choco install ffmpeg）。"
        )
    return exe


def _local_path_for_url(url: str) -> Path | None:
    """把 /files/<name> 解析到 uploads 目录；解析不了返回 None（调用方走下载或报错）。"""
    if not url or not url.startswith("/files/"):
        return None
    name = url.split("?")[0][len("/files/"):]
    if not name or "/" in name or "\\" in name:
        return None
    path = (_UPLOAD_DIR / name).resolve()
    if not path.is_relative_to(_UPLOAD_DIR.resolve()) or not path.is_file():
        return None
    return path


async def _download(url: str, dest_dir: Path) -> Path:
    """下载远程镜头素材到临时目录。"""
    suffix = Path(url.split("?")[0]).suffix or ".bin"
    dest = dest_dir / f"dl_{uuid.uuid4().hex[:8]}{suffix}"
    async with httpx.AsyncClient(timeout=httpx.Timeout(60.0), follow_redirects=True) as cx:
        r = await cx.get(url)
        if r.status_code >= 400:
            raise RuntimeError(f"下载镜头素材失败 HTTP {r.status_code}: {url[:120]}")
        dest.write_bytes(r.content)
    return dest


async def _run(cmd: list[str], timeout: int) -> None:
    """跑一条 ffmpeg 命令；非零退出带 stderr 抛错。"""
    proc = await asyncio.create_subprocess_exec(
        *cmd,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    try:
        _, stderr = await asyncio.wait_for(proc.communicate(), timeout=timeout)
    except asyncio.TimeoutError:
        proc.kill()
        await proc.wait()
        raise RuntimeError(f"ffmpeg 超时（{timeout}s）: {' '.join(cmd[:6])}...")
    if proc.returncode != 0:
        tail = (stderr or b"").decode("utf-8", "replace")[-400:]
        raise RuntimeError(f"ffmpeg 失败（exit {proc.returncode}）: {tail}")


def _segment_cmd(ffmpeg: str, src: Path, is_image: bool, sec: float, dest: Path, caption: str = "", font: str | None = None) -> list[str]:
    """生成单个规整片段的命令：统一 1280x720(pad)、30fps、libx264、yuv420p、无音轨。

    caption 非空且 font 可用时在片段上烧录底部字幕。
    """
    vf = (
        f"scale={WIDTH}:{HEIGHT}:force_original_aspect_ratio=decrease,"
        f"pad={WIDTH}:{HEIGHT}:(ow-iw)/2:(oh-ih)/2,fps={FPS}"
    )
    if caption and font:
        vf = f"{vf},{_caption_filter(caption, font)}"
    cmd = [ffmpeg, "-y"]
    if is_image:
        cmd += ["-loop", "1", "-t", f"{sec:.2f}", "-i", str(src)]
    else:
        cmd += ["-i", str(src)]
    cmd += [
        "-vf", vf,
        "-c:v", "libx264", "-pix_fmt", "yuv420p", "-an",
        "-movflags", "+faststart",
        str(dest),
    ]
    return cmd


def _is_image_asset(asset: Any) -> bool:
    if (asset.kind or "").lower() == "image":
        return True
    mime = mimetypes.guess_type((asset.url or "").split("?")[0])[0] or ""
    return mime.startswith("image/")


async def export_sequence(
    db: Session,
    *,
    project_id: str,
    asset_ids: list[str],
    sec_per_image: float = 3.0,
    title: str = "",
    durations: list[float] | None = None,
    captions: list[str] | None = None,
) -> dict:
    """把 asset_ids 指定的镜头按顺序合成一个 mp4，落 uploads 并登记 Asset。

    durations：可选逐镜头秒数，非 None 时长度必须等于 asset_ids，
    每个镜头用 durations[i] 替代 sec_per_image；为 None 时行为不变。

    captions：可选逐镜头旁白，非 None 时长度必须等于 asset_ids；
    登记进导出资产的 extra.captions（字幕烧录未做，先保证不丢失）。

    Returns: {"asset_id", "url", "segments", "width", "height", "fps"}
    """
    from ..models import Asset

    if not asset_ids:
        raise ValueError("asset_ids is empty")
    if durations is not None and len(durations) != len(asset_ids):
        raise ValueError(
            f"durations length ({len(durations)}) must match asset_ids length ({len(asset_ids)})"
        )
    if captions is not None and len(captions) != len(asset_ids):
        raise ValueError(
            f"captions length ({len(captions)}) must match asset_ids length ({len(asset_ids)})"
        )
    ffmpeg = _ffmpeg_path()

    rows = []
    for aid in asset_ids:
        row = db.query(Asset).filter(Asset.id == aid).first()
        if row is None:
            raise ValueError(f"asset '{aid}' not found")
        if not row.url:
            raise ValueError(f"asset '{aid}' has no media url")
        rows.append(row)

    work = Path(tempfile.mkdtemp(prefix="studio_export_"))
    font = _caption_font() if captions else None
    if captions and not font:
        logger.warning("[studio.export] 未找到可用字幕字体，跳过烧录（captions 仍登记在 extra）")
    segments: list[Path] = []
    try:
        for i, row in enumerate(rows):
            url = row.url or ""
            local = _local_path_for_url(url)
            src = local if local else await _download(url, work)
            is_image = _is_image_asset(row)
            seg = work / f"seg_{i:03d}.mp4"
            sec = durations[i] if durations is not None else sec_per_image
            caption = (captions[i] or "") if captions is not None else ""
            await _run(_segment_cmd(ffmpeg, src, is_image, sec, seg, caption=caption, font=font), SEG_TIMEOUT_SEC)
            segments.append(seg)

        concat_list = work / "concat.txt"
        concat_list.write_text(
            "".join(f"file '{s.as_posix()}'\n" for s in segments), encoding="utf-8"
        )
        out_name = f"export_{uuid.uuid4().hex[:12]}.mp4"
        out_path = _UPLOAD_DIR / out_name
        await _run(
            [ffmpeg, "-y", "-f", "concat", "-safe", "0", "-i", str(concat_list),
             "-c", "copy", str(out_path)],
            EXPORT_TIMEOUT_SEC,
        )

        asset = Asset(
            id=uuid.uuid4().hex[:12],
            project_id=project_id,
            kind="video",
            asset_kind="sequence",
            title=title or "成片",
            name=title or "成片",
            url=f"/files/{out_name}",
            failed=False,
            generating=False,
            status="ready",
            origin="studio_export",
            extra={
                "segment_asset_ids": asset_ids,
                "sec_per_image": sec_per_image,
                "durations": durations,
                "captions": captions,
                "width": WIDTH, "height": HEIGHT, "fps": FPS,
            },
        )
        db.add(asset)
        db.commit()
        return {
            "asset_id": asset.id,
            "url": asset.url,
            "segments": len(segments),
            "width": WIDTH, "height": HEIGHT, "fps": FPS,
        }
    finally:
        shutil.rmtree(work, ignore_errors=True)
