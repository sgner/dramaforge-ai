"""图片上传 — 保存到后端文件系统，返回 URL"""
from fastapi import APIRouter, UploadFile, File, Form, HTTPException, Depends
from sqlalchemy.orm import Session
from pathlib import Path
import uuid
import shutil

from ..database import get_db  # noqa
from .. import models  # noqa
from .. import schemas  # noqa

router = APIRouter()

UPLOAD_DIR = Path(__file__).resolve().parent.parent / "uploads"
UPLOAD_DIR.mkdir(exist_ok=True)


@router.post("/image")
async def upload_image(file: UploadFile = File(...)):
    """上传图片，返回可在前端直接使用的 URL 路径"""
    # 校验类型
    if not file.content_type or not file.content_type.startswith("image/"):
        raise HTTPException(400, "Only image files are supported")
    # 生成文件名
    ext = Path(file.filename or "image.png").suffix or ".png"
    fname = f"{uuid.uuid4().hex[:16]}{ext}"
    fpath = UPLOAD_DIR / fname
    # 写入
    with fpath.open("wb") as f:
        shutil.copyfileobj(file.file, f)
    return {"url": f"/files/{fname}", "filename": fname, "size": fpath.stat().st_size}


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
    if not file.content_type or not (
        file.content_type.startswith("image/") or file.content_type.startswith("video/")
    ):
        raise HTTPException(400, "Only image and video files are supported")

    ext = Path(file.filename or "asset.bin").suffix or ".bin"
    fname = f"{uuid.uuid4().hex[:16]}{ext}"
    fpath = UPLOAD_DIR / fname
    with fpath.open("wb") as target:
        shutil.copyfileobj(file.file, target)

    kind = "video" if file.content_type.startswith("video/") else "image"
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
