"""Studio 路由 — 多 agent 协同（Track B）、成片导出（Track A）与角色卡（Track C）的 HTTP 入口。

POST /api/studio/shots                    跑"编剧→美术→质检"闭环，可带 character_card_ids 做一致性锁定。
POST /api/studio/shots/regenerate         用镜头资产里存的 brief + 角色卡关联重跑闭环。
POST /api/studio/episodes                 提交整集生成任务（202 + task_id，后台异步跑）。
GET  /api/studio/episodes/{id}            轮询任务状态 / 进度 / 结果。
POST /api/studio/character-cards          从参考图创建角色卡（vision LLM 提取身份指纹）。
GET  /api/studio/character-cards          列出项目的角色卡。
PUT  /api/studio/character-cards/{id}     更新身份指纹，返回受影响镜头（只读影响分析）。
GET  /api/studio/character-cards/{id}/impact  该角色卡出现在哪些镜头里。
POST /api/studio/export                   把一组镜头资产按顺序合成 mp4（ffmpeg 拼接）。
POST /api/studio/arrange                  资产智能编排：LLM 按短剧叙事排序并建议逐镜头时长/旁白。
"""
import json
import logging
import re

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import Asset
from ..agent.character_cards import (
    card_impact,
    create_character_card,
    is_character_card,
    update_card_identity,
)
from ..agent.llm_factory import NoLLMConfigured, load_llm_configs, select_llm_for_task
from ..agent.studio import list_shots, regenerate_shot, review_shot, run_studio_shot
from ..agent.studio_export import export_sequence
from ..agent.studio_tasks import get_episode_task, start_episode_task

router = APIRouter()

logger = logging.getLogger("dramaforge.studio.arrange")


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


@router.get("/shots")
async def get_shots(project_id: str = Query(...), db: Session = Depends(get_db)):
    """审片台镜头列表（含初筛结论、人审状态、版本分组）。"""
    return list_shots(db, project_id)


class ShotReviewIn(BaseModel):
    action: str = Field(..., min_length=1)  # approve / reject / lock / unlock
    note: str = ""


@router.post("/shots/{asset_id}/review")
async def review_shot_endpoint(asset_id: str, body: ShotReviewIn, db: Session = Depends(get_db)):
    """人审操作：critic 只是初筛，人审才是终审。"""
    try:
        return review_shot(db, asset_id, body.action, body.note)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


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


@router.get("/character-cards")
async def list_cards(project_id: str = Query(...), db: Session = Depends(get_db)):
    """列出项目的角色卡（asset_kind="character" 且 extra.character_card 为真）。"""
    rows = (
        db.query(Asset)
        .filter(Asset.project_id == project_id, Asset.asset_kind == "character")
        .all()
    )
    return [
        {
            "card_id": row.id,
            "name": row.name,
            "identity": row.visual_identity or {},
            "reference_asset_ids": (row.extra or {}).get("reference_asset_ids") or [],
            "url": row.url,
        }
        for row in rows
        if is_character_card(row)
    ]


class CharacterCardUpdateIn(BaseModel):
    project_id: str
    identity: dict = Field(..., min_length=1)


@router.put("/character-cards/{card_id}")
async def update_card(card_id: str, body: CharacterCardUpdateIn, db: Session = Depends(get_db)):
    """更新角色卡身份指纹，并返回受影响镜头（Story Bible 只读影响分析）。

    是否重生成受影响镜头由用户决定（POST /api/studio/shots/regenerate 逐个触发）。
    """
    try:
        card = update_card_identity(db, card_id, body.identity)
        impact = card_impact(db, body.project_id, card_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return {
        "card_id": card.id,
        "name": card.name,
        "identity": card.visual_identity or {},
        "impact": impact,
        "impacted_shots": len(impact),
    }


@router.get("/character-cards/{card_id}/impact")
async def get_card_impact(card_id: str, project_id: str = Query(...), db: Session = Depends(get_db)):
    """只读影响分析：该角色卡出现在哪些镜头里。"""
    impact = card_impact(db, project_id, card_id)
    return {"card_id": card_id, "impact": impact, "impacted_shots": len(impact)}


@router.get("/entities/{story_entity_id}/impact")
async def get_entity_impact(story_entity_id: str, project_id: str = Query(...), db: Session = Depends(get_db)):
    """实体级只读影响分析：该 story_entity 出现在哪些镜头里（道具/场景通用）。"""
    from ..agent.character_cards import entity_impact
    impact = entity_impact(db, project_id, story_entity_id)
    return {"story_entity_id": story_entity_id, "impact": impact, "impacted_shots": len(impact)}


class ShotRegenerateIn(BaseModel):
    project_id: str
    asset_id: str
    image_provider_id: str
    image_model: str
    llm_provider_id: str | None = None
    llm_model_id: str | None = None
    max_rounds: int = 3
    # 与 drama-task 脚本 bigShot 的显式关联（导演台断链修复）
    bigshot_id: str | None = None


@router.post("/shots/regenerate")
async def regenerate_shot_endpoint(body: ShotRegenerateIn, db: Session = Depends(get_db)):
    """用镜头资产里存的 brief + 角色卡关联重跑闭环（影响分析后的手动同步）。"""
    try:
        result = await regenerate_shot(
            db,
            project_id=body.project_id,
            asset_id=body.asset_id,
            image_provider_id=body.image_provider_id,
            image_model=body.image_model,
            llm_provider_id=body.llm_provider_id,
            llm_model_id=body.llm_model_id,
            max_rounds=body.max_rounds,
            bigshot_id=body.bigshot_id,
        )
    except NoLLMConfigured as e:
        raise HTTPException(status_code=400, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return result.to_dict()


class StudioEpisodeIn(BaseModel):
    project_id: str
    story_text: str = Field(..., min_length=1)
    image_provider_id: str
    image_model: str
    llm_provider_id: str | None = None
    llm_model_id: str | None = None
    max_shots: int = 5
    sec_per_image: float = Field(3.0, gt=0, le=30)
    character_card_ids: list[str] = Field(default_factory=list)
    title: str = ""


@router.post("/episodes", status_code=202)
async def create_studio_episode(body: StudioEpisodeIn):
    """一段故事 → 导演拆镜头 → 逐镜头过审 → 整集 mp4（后台异步执行）。

    立即返回 202 + task_id；前端轮询 GET /api/studio/episodes/{task_id}。
    生成过程中的错误（含 NoLLMConfigured / 导演拆不出镜头）通过任务状态
    status="error" + error 字符串暴露，不再同步返回 400。
    """
    task_id = start_episode_task(
        project_id=body.project_id,
        story_text=body.story_text,
        image_provider_id=body.image_provider_id,
        image_model=body.image_model,
        llm_provider_id=body.llm_provider_id,
        llm_model_id=body.llm_model_id,
        max_shots=body.max_shots,
        sec_per_image=body.sec_per_image,
        character_card_ids=body.character_card_ids,
        title=body.title,
    )
    return {"task_id": task_id}


@router.get("/episodes/{task_id}")
async def get_studio_episode(task_id: str):
    """轮询整集生成任务状态 / 进度 / 结果。"""
    entry = get_episode_task(task_id)
    if entry is None:
        raise HTTPException(status_code=404, detail="episode task not found")
    return entry


class StudioExportIn(BaseModel):
    project_id: str
    asset_ids: list[str] = Field(..., min_length=1)
    sec_per_image: float = Field(3.0, gt=0, le=30)
    title: str = ""
    # 可选逐镜头秒数；非 None 时长度必须等于 asset_ids（export_sequence 校验）
    durations: list[float] | None = None


@router.post("/export")
async def create_studio_export(body: StudioExportIn, db: Session = Depends(get_db)):
    try:
        return await export_sequence(
            db,
            project_id=body.project_id,
            asset_ids=body.asset_ids,
            sec_per_image=body.sec_per_image,
            title=body.title,
            durations=body.durations,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except RuntimeError as e:
        # ffmpeg 缺失 / 下载失败 / 转码失败等运行期错误
        raise HTTPException(status_code=500, detail=str(e))


# ---------- 资产智能编排 ----------

ARRANGE_SYSTEM = """You are the editor agent for a short-drama studio.
Your ONLY job: order the given shot assets into a short-drama narrative sequence
and suggest per-shot timing plus a one-line caption.
Rules:
- Output JSON only: {"items": [{"asset_id": "<one of the given ids>", "sec": <seconds>, "caption": "<one-sentence narration / shot note>"}]}
- Order the assets by short-drama narrative (setup → conflict → payoff).
- sec: 2–5 seconds for images; for videos use the asset's own length if known, else 3–8.
- caption: a single short sentence (voiceover or shot description).
- Only use asset_id values from the input; each at most once."""

DEFAULT_ARRANGE_SEC = 3.0


class StudioArrangeIn(BaseModel):
    project_id: str
    asset_ids: list[str] = Field(default_factory=list)  # ≥2，端点内校验（400）
    story_hint: str = ""
    llm_provider_id: str | None = None
    llm_model_id: str | None = None


def _parse_arrange_items(text: str) -> list[dict]:
    """与 director._parse_shot_list 同款容错：抠第一个 {...} 块解析，失败返回 []。"""
    m = re.search(r"\{[\s\S]*\}", text or "")
    items: list[dict] = []
    if m:
        try:
            data = json.loads(m.group(0))
            raw = data.get("items") if isinstance(data, dict) else None
            if isinstance(raw, list):
                items = [it for it in raw if isinstance(it, dict)]
        except json.JSONDecodeError:
            pass
    return items


def _merge_arrange_items(parsed: list[dict], input_ids: list[str]) -> list[dict]:
    """校验 + 兜底：asset_id 必须是输入子集并去重；LLM 漏掉的按原输入顺序补到末尾。"""
    valid = set(input_ids)
    seen: set[str] = set()
    items: list[dict] = []
    for it in parsed:
        aid = it.get("asset_id")
        if not isinstance(aid, str) or aid not in valid or aid in seen:
            continue
        seen.add(aid)
        try:
            sec = float(it.get("sec"))
            if sec <= 0:
                raise ValueError
        except (TypeError, ValueError):
            sec = DEFAULT_ARRANGE_SEC
        items.append({"asset_id": aid, "sec": sec, "caption": str(it.get("caption") or "")})
    for aid in input_ids:
        if aid not in seen:
            items.append({"asset_id": aid, "sec": DEFAULT_ARRANGE_SEC, "caption": ""})
    return items


@router.post("/arrange")
async def arrange_assets(body: StudioArrangeIn, db: Session = Depends(get_db)):
    """资产智能编排（建议性质）：LLM 按短剧叙事排序 + 建议逐镜头秒数与旁白。

    LLM 输出不可解析 / 调用失败时不报错，降级为原顺序 + 默认 sec + 空 caption。
    """
    try:
        asset_ids = list(dict.fromkeys(body.asset_ids))  # 去重且保持传入顺序
        if len(asset_ids) < 2:
            raise ValueError("asset_ids 至少需要 2 个资产")
        rows = []
        for aid in asset_ids:
            row = db.query(Asset).filter(Asset.id == aid).first()
            if row is None:
                raise ValueError(f"asset '{aid}' not found")
            rows.append(row)

        configs = load_llm_configs(db)
        llm = select_llm_for_task(body.llm_provider_id, configs, body.llm_model_id)
    except NoLLMConfigured as e:
        raise HTTPException(status_code=400, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    summaries = [
        {
            "asset_id": r.id,
            "name": r.name or r.title or "",
            "kind": r.kind or "",
            "prompt": (r.prompt or "")[:200],
        }
        for r in rows
    ]
    user = "[ASSETS]\n" + json.dumps(summaries, ensure_ascii=False)
    if body.story_hint.strip():
        user += f"\n\n[STORY HINT]\n{body.story_hint.strip()}"

    parsed: list[dict] = []
    try:
        resp = await llm.generate_structured(
            [
                {"role": "system", "content": ARRANGE_SYSTEM},
                {"role": "user", "content": user},
            ],
            json_schema={"type": "object"},
            temperature=0.7,
            max_tokens=4096,
        )
        parsed = _parse_arrange_items(resp.content or "")
    except Exception:  # noqa: BLE001 — 编排是建议性质，LLM 挂了降级为原顺序
        logger.warning("[arrange] LLM call failed, fallback to input order", exc_info=True)

    return {"items": _merge_arrange_items(parsed, asset_ids)}
