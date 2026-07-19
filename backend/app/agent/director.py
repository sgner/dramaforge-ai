"""导演 agent（Track B 扩展）：把一段小说/大纲拆成镜头序列，整集编排。

流程：
  导演 agent — 把 story_text 拆成 N 个镜头 brief（结构化 JSON，含叙事递进与视觉连续性要求）
  逐镜头     — 交给 run_studio_shot 跑"编剧→美术→质检"闭环（可带角色卡一致性锁定）
  剪辑       — 过审镜头交给 export_sequence 合成整集 mp4

设计约束与 studio.py 一致：角色间不共享上下文，通过结构化产物传递；
不过审的镜头（max_rounds_exceeded）不进成片，但在结果里标记原因。
"""
from __future__ import annotations

import json
import logging
import re
from typing import Any, Optional

from sqlalchemy.orm import Session

from .character_cards import identity_block, load_character_cards
from .llm_factory import load_llm_configs, select_llm_for_task
from .studio import run_studio_shot
from .studio_export import export_sequence

logger = logging.getLogger("dramaforge.studio.director")

DIRECTOR_SYSTEM = """You are the director agent for a short-drama studio.
Your ONLY job: break the story into a shot list for ONE episode.
Rules:
- Output JSON only: {"shots": [{"title": "<short shot name>", "brief": "<what happens in this shot, 1-2 sentences>"}]}
- 3 to 8 shots. Each brief is a single, filmable moment (one camera setup).
- Shots must progress the story (setup → conflict → payoff), not repeat the same beat.
- Keep characters, locations, and era consistent across shots.
- Do NOT write image-generation prompts — the screenwriter agent will expand each brief."""


def _parse_shot_list(text: str, max_shots: int) -> list[dict]:
    m = re.search(r"\{[\s\S]*\}", text or "")
    shots: list[dict] = []
    if m:
        try:
            data = json.loads(m.group(0))
            raw = data.get("shots") if isinstance(data, dict) else None
            if isinstance(raw, list):
                for item in raw:
                    if isinstance(item, dict) and str(item.get("brief") or "").strip():
                        shots.append({
                            "title": str(item.get("title") or f"shot-{len(shots) + 1}"),
                            "brief": str(item["brief"]).strip(),
                        })
        except json.JSONDecodeError:
            pass
    return shots[:max_shots]


async def plan_episode_shots(
    llm,
    story_text: str,
    *,
    max_shots: int,
    character_context: str = "",
) -> list[dict]:
    user = f"[STORY]\n{story_text}"
    if character_context:
        user += f"\n\n{character_context}"
    resp = await llm.generate_structured(
        [
            {"role": "system", "content": DIRECTOR_SYSTEM},
            {"role": "user", "content": user},
        ],
        json_schema={"type": "object"},
        temperature=0.7,
        max_tokens=4096,
    )
    return _parse_shot_list(resp.content or "", max_shots)


async def run_studio_episode(
    db: Session,
    *,
    project_id: str,
    story_text: str,
    image_provider_id: str,
    image_model: str,
    llm_provider_id: Optional[str] = None,
    llm_model_id: Optional[str] = None,
    max_shots: int = 5,
    sec_per_image: float = 3.0,
    character_card_ids: Optional[list[str]] = None,
    title: str = "",
) -> dict:
    """一段故事 → 镜头列表 → 逐镜头过审 → 整集 mp4。

    Returns: {
      status: "done" | "partial" | "failed",
      episode_asset_id, url, shots: [{title, brief, status, asset_id, url, rounds}],
      export: {...} | None,
    }
    """
    if not story_text.strip():
        raise ValueError("story_text is empty")
    max_shots = max(1, min(int(max_shots), 8))

    configs = load_llm_configs(db)
    llm = select_llm_for_task(llm_provider_id, configs, llm_model_id)
    cards = load_character_cards(db, project_id, character_card_ids or [])
    character_context = "\n\n".join(identity_block(c) for c in cards)

    # ---- 导演 agent：拆镜头 ----
    planned = await plan_episode_shots(
        llm, story_text, max_shots=max_shots, character_context=character_context,
    )
    if not planned:
        raise ValueError("director agent 未能从故事拆出有效镜头")

    # ---- 逐镜头跑三角闭环（串行：控制供应商速率/额度） ----
    shot_results: list[dict] = []
    approved_ids: list[str] = []
    for i, shot in enumerate(planned, 1):
        logger.info("[episode] shot %d/%d: %s", i, len(planned), shot["title"])
        result = await run_studio_shot(
            db,
            project_id=project_id,
            brief=shot["brief"],
            image_provider_id=image_provider_id,
            image_model=image_model,
            llm_provider_id=llm_provider_id,
            llm_model_id=llm_model_id,
            character_card_ids=character_card_ids,
        )
        shot_results.append({
            "title": shot["title"],
            "brief": shot["brief"],
            "status": result.status,
            "asset_id": result.asset_id,
            "url": result.url,
            "rounds": result.rounds,
        })
        if result.status == "approved" and result.asset_id:
            approved_ids.append(result.asset_id)

    # ---- 剪辑：过审镜头合成整集 ----
    export: dict | None = None
    if approved_ids:
        export = await export_sequence(
            db,
            project_id=project_id,
            asset_ids=approved_ids,
            sec_per_image=sec_per_image,
            title=title or "第 1 集",
        )

    if not approved_ids:
        status = "failed"
    elif len(approved_ids) < len(planned):
        status = "partial"
    else:
        status = "done"

    return {
        "status": status,
        "episode_asset_id": (export or {}).get("asset_id", ""),
        "url": (export or {}).get("url", ""),
        "planned_shots": len(planned),
        "approved_shots": len(approved_ids),
        "shots": shot_results,
        "export": export,
    }
