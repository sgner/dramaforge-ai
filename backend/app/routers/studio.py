"""Studio 路由 — 多 agent 协同（Track B）、成片导出（Track A）与角色卡（Track C）的 HTTP 入口。

POST /api/studio/shots            跑"编剧→美术→质检"闭环，可带 character_card_ids 做一致性锁定。
POST /api/studio/character-cards  从参考图创建角色卡（vision LLM 提取身份指纹）。
POST /api/studio/export           把一组镜头资产按顺序合成 mp4（ffmpeg 拼接）。
"""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from ..database import get_db
from ..agent.character_cards import create_character_card
from ..agent.llm_factory import NoLLMConfigured, load_llm_configs, select_llm_for_task
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
    # Track C：角色卡 id 列表，非空时启用跨镜头一致性锁定
    character_card_ids: list[str] = Field(default_factory=list)


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
            character_card_ids=body.character_card_ids,
        )
    except NoLLMConfigured as e:
        raise HTTPException(status_code=400, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return result.to_dict()


class CharacterCardIn(BaseModel):
    project_id: str
    name: str = Field(..., min_length=1)
    reference_asset_ids: list[str] = Field(..., min_length=1)
    llm_provider_id: str | None = None
    llm_model_id: str | None = None


@router.post("/character-cards")
async def create_card(body: CharacterCardIn, db: Session = Depends(get_db)):
    """从参考图创建角色卡（Track C）：vision LLM 提取身份指纹。"""
    try:
        configs = load_llm_configs(db)
        llm = select_llm_for_task(body.llm_provider_id, configs, body.llm_model_id)
        card = await create_character_card(
            db,
            project_id=body.project_id,
            name=body.name,
            reference_asset_ids=body.reference_asset_ids,
            llm=llm,
        )
    except NoLLMConfigured as e:
        raise HTTPException(status_code=400, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return {
        "card_id": card.id,
        "name": card.name,
        "identity": card.visual_identity or {},
        "reference_asset_ids": (card.extra or {}).get("reference_asset_ids") or [],
    }


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
