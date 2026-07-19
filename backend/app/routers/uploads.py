"""图片/资产上传 — 保存到后端文件系统，返回 URL

安全策略：
- 扩展名白名单（客户端自报的 content_type 可伪造，不能作为唯一依据）。
- .svg 默认拒绝：svg 可内嵌脚本，经 /files 静态服务按 image/svg+xml 返回
  会构成后端源上的存储型 XSS。
- 大小上限 50MB，分块读写，超限返回 413，类型不符返回 415。
"""
from fastapi import APIRouter, UploadFile, File, Form, HTTPException, Depends
from sqlalchemy.orm import Session
from pathlib import Path
import uuid

from ..database import get_db  # noqa
from .. import models  # noqa
from .. import schemas  # noqa

router = APIRouter()

UPLOAD_DIR = Path(__file__).resolve().parent.parent / "uploads"
UPLOAD_DIR.mkdir(exist_ok=True)

# 单文件大小上限（图片/视频/音频/文本通用）
MAX_UPLOAD_BYTES = 50 * 1024 * 1024  # 50MB
_READ_CHUNK = 1024 * 1024  # 1MB

# 扩展名白名单（不含 .svg —— 存储型 XSS 面；不含 .html/.exe 等危险类型）
_IMAGE_EXTS = {".png", ".jpg", ".jpeg", ".webp", ".gif"}
_VIDEO_EXTS = {".mp4", ".webm", ".mov"}
_AUDIO_EXTS = {".mp3", ".wav", ".m4a", ".ogg"}
_TEXT_EXTS = {".txt", ".md"}
_ALLOWED_EXTS = _IMAGE_EXTS | _VIDEO_EXTS | _AUDIO_EXTS | _TEXT_EXTS


def _check_extension(filename: str | None, allowed: set[str]) -> str:
    """按白名单校验扩展名，返回小写扩展名；不合规抛 415。"""
    ext = Path(filename or "").suffix.lower()
    if not ext:
        raise HTTPException(415, "Missing file extension; cannot determine file type")
    if ext not in allowed:
        raise HTTPException(
            415,
            f"File type '{ext}' is not allowed. Allowed types: {', '.join(sorted(allowed))}",
        )
    return ext


async def _save_with_limit(file: UploadFile, fpath: Path) -> int:
    """分块写入并强制执行大小上限；超限抛 413 并清理半成品文件。"""
    total = 0
    try:
        with fpath.open("wb") as out:
            while True:
                chunk = await file.read(_READ_CHUNK)
                if not chunk:
                    break
                total += len(chunk)
                if total > MAX_UPLOAD_BYTES:
                    raise HTTPException(
                        413,
                        f"File too large: limit is {MAX_UPLOAD_BYTES // (1024 * 1024)}MB",
                    )
                out.write(chunk)
    except Exception:
        fpath.unlink(missing_ok=True)
        raise
    return total


@router.post("/image")
async def upload_image(file: UploadFile = File(...)):
    """上传图片，返回可在前端直接使用的 URL 路径"""
    # content_type 仅作前置参考（可伪造），真实闸门是下面的扩展名白名单
    if not file.content_type or not file.content_type.startswith("image/"):
        raise HTTPException(415, "Only image files are supported")
    ext = _check_extension(file.filename, _IMAGE_EXTS)
    fname = f"{uuid.uuid4().hex[:16]}{ext}"
    fpath = UPLOAD_DIR / fname
    size = await _save_with_limit(file, fpath)
    return {"url": f"/files/{fname}", "filename": fname, "size": size}


@router.post("/asset", response_model=schemas.AssetOut)
async def upload_asset(
    project_id: str = Form(...),
    file: UploadFile = File(...),
    asset_kind: str | None = Form(None),
    name: str | None = Form(None),
    db: Session = Depends(get_db),
):
    """Upload a project asset and persist its logical identity in one step."""
    project = db.query(models.Project).filter(models.Project.id == project_id).first()
    if not project:
        raise HTTPException(404, "Project not found")
    # 扩展名白名单（图片 + 视频）；kind 依据扩展名判定而非可伪造的 content_type
    ext = _check_extension(file.filename, _IMAGE_EXTS | _VIDEO_EXTS)
    kind = "video" if ext in _VIDEO_EXTS else "image"

    fname = f"{uuid.uuid4().hex[:16]}{ext}"
    fpath = UPLOAD_DIR / fname
    await _save_with_limit(file, fpath)

    asset = models.Asset(
        id=uuid.uuid4().hex[:16],
        project_id=project_id,
        kind=kind,
        asset_kind=asset_kind,
        title=name or Path(file.filename or "asset").stem,
        name=name or Path(file.filename or "asset").stem,
        url=f"/files/{fname}",
        origin="uploaded",
        inspection_status="pending",
        extra={"filename": file.filename, "content_type": file.content_type},
    )
    db.add(asset)
    db.commit()
    db.refresh(asset)
    return asset
