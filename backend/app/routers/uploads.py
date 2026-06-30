"""图片上传 — 保存到后端文件系统，返回 URL"""
from fastapi import APIRouter, UploadFile, File, HTTPException
from pathlib import Path
import uuid
import shutil

from ..database import get_db  # noqa
from .. import models  # noqa
from .. import schemas  # noqa

router = APIRouter()

UPLOAD_DIR = Path(__file__).resolve().parent.parent.parent / "uploads"
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
