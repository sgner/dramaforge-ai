"""Studio 路由 — 多 agent 协同（Track B）的 HTTP 入口。

POST /api/studio/shots  跑一个"编剧→美术→质检"最小闭环，返回过审镜头与完整 trace。
"""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from ..database import get_db
from ..agent.llm_factory import NoLLMConfigured
from ..agent.studio import run_studio_shot

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
