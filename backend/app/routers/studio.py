"""Studio 路由 — 多 agent 协同（Track B）与成片导出（Track A）的 HTTP 入口。

POST /api/studio/shots   跑一个"编剧→美术→质检"最小闭环，返回过审镜头与完整 trace。
POST /api/studio/export  把一组镜头资产按顺序合成 mp4（ffmpeg 拼接，最小版无转场/字幕/音轨）。
"""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from ..database import get_db
from ..agent.llm_factory import NoLLMConfigured
from ..agent.studio import run_studio_shot
from ..agent.studio_export import export_sequence

router = APIRouter()


class StudioShotIn(BaseModel):
    project_id: str
    brief: str = Field(..., min_length=1)
    image_provider_id: str
    image_model: str
    llm_provider_id: str | None = None
    llm_model_id: str | None = None
    max_rounds: int = 3


@router.post("/shots")
async def create_studio_shot(body: StudioShotIn, db: Session = Depends(get_db)):
    try:
        result = await run_studio_shot(
            db,
            project_id=body.project_id,
            brief=body.brief,
            image_provider_id=body.image_provider_id,
            image_model=body.image_model,
            llm_provider_id=body.llm_provider_id,
            llm_model_id=body.llm_model_id,
            max_rounds=body.max_rounds,
        )
    except NoLLMConfigured as e:
        raise HTTPException(status_code=400, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return result.to_dict()


class StudioExportIn(BaseModel):
    project_id: str
    asset_ids: list[str] = Field(..., min_length=1)
    sec_per_image: float = Field(3.0, gt=0, le=30)
    title: str = ""


@router.post("/export")
async def create_studio_export(body: StudioExportIn, db: Session = Depends(get_db)):
    try:
        return await export_sequence(
            db,
            project_id=body.project_id,
            asset_ids=body.asset_ids,
            sec_per_image=body.sec_per_image,
            title=body.title,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except RuntimeError as e:
        # ffmpeg 缺失 / 下载失败 / 转码失败等运行期错误
        raise HTTPException(status_code=500, detail=str(e))
