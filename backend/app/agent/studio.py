"""多 agent 协同骨架（Track B）：Orchestrator + 编剧/美术/质检三角最小闭环。

一个镜头从文本到过审的流转：

  编剧 agent（screenwriter）— 把用户 brief（+ 上一轮质检反馈）写成镜头生成 prompt
  美术 agent（artist）       — 调媒体供应商生成镜头图，落 Asset（asset_kind=shot）
  质检 agent（critic）       — inspect_asset 视觉检查：meets_standard → 过审；
                              否则把 missing_fields/notes 反馈给编剧进入下一轮

设计约束：
- 复用现有模块，不引入新协议：llm_factory 选 LLM、routers.media._openai_image
  走媒体代理（api_key 只在后端）、asset_intelligence.inspect_asset 承载质检标准。
- 每个 RoleAgent = 独立 system prompt + 受限职责，agent 之间不共享对话上下文，
  通过 Orchestrator 的黑板（trace + 结构化产物 + 显式 feedback）传递信息。
  后续导演/剪辑 agent 按同一模式扩展。
"""
from __future__ import annotations

import json
import logging
import re
import uuid
from dataclasses import dataclass, field
from typing import Any, Optional

from sqlalchemy.orm import Session

from .asset_intelligence import inspect_asset
from .character_cards import (
    check_consistency,
    identity_block,
    load_character_cards,
    reference_urls,
)
from .llm_factory import load_llm_configs, select_llm_for_task
from ..routers.media import ImageGenerateIn, _load_provider, _openai_image

logger = logging.getLogger("dramaforge.studio")


# ============ 角色定义（独立 system prompt，职责互斥） ============

SCREENWRITER_SYSTEM = """You are the screenwriter agent for a short-drama studio.
Your ONLY job: turn the user's story brief into ONE shot's image-generation prompt.
Rules:
- Output JSON only: {"shot_prompt": "<detailed visual prompt for the shot>", "shot_notes": "<why this framing serves the story>"}
- The shot_prompt must be self-contained and visual: subject, action, scene, lighting, camera framing, style.
- Do NOT include grid/storyboard-sheet layouts — one shot, one frame.
- If the user message contains [CRITIC FEEDBACK], treat it as mandatory revision notes from the quality agent and address every point.
- Write shot_prompt in English (generation models respond best); shot_notes may follow the brief's language."""


@dataclass
class StudioStep:
    """黑板上的一条流转记录（哪个 agent 在哪一轮做了什么）。"""
    round: int
    role: str       # screenwriter / artist / critic
    action: str
    summary: str
    detail: dict = field(default_factory=dict)


@dataclass
class StudioShotResult:
    status: str               # approved / max_rounds_exceeded
    asset_id: str
    url: str
    prompt: str
    rounds: int
    inspection: dict
    trace: list[StudioStep]

    def to_dict(self) -> dict:
        return {
            "status": self.status,
            "asset_id": self.asset_id,
            "url": self.url,
            "prompt": self.prompt,
            "rounds": self.rounds,
            "inspection": self.inspection,
            "trace": [vars(s) for s in self.trace],
        }


# ============ 编剧 agent ============

def _parse_shot_json(text: str, brief: str) -> tuple[str, str]:
    """从编剧输出提取 shot_prompt / shot_notes；解析失败时退化为原文做 prompt。"""
    raw = (text or "").strip()
    m = re.search(r"\{[\s\S]*\}", raw)
    if m:
        try:
            data = json.loads(m.group(0))
            prompt = str(data.get("shot_prompt") or "").strip()
            notes = str(data.get("shot_notes") or "").strip()
            if prompt:
                return prompt, notes
        except (json.JSONDecodeError, AttributeError):
            pass
    return raw or brief, ""


async def _screenwriter_write(llm, brief: str, feedback: str, identity_context: str = "") -> tuple[str, str]:
    user = f"[STORY BRIEF]\n{brief}"
    if identity_context:
        user += f"\n\n{identity_context}"
    if feedback:
        user += f"\n\n[CRITIC FEEDBACK — 必须逐条修正]\n{feedback}"
    resp = await llm.generate_structured(
        [
            {"role": "system", "content": SCREENWRITER_SYSTEM},
            {"role": "user", "content": user},
        ],
        json_schema={"type": "object"},
        temperature=0.7,
        max_tokens=2048,
    )
    return _parse_shot_json(resp.content or "", brief)


# ============ 美术 agent ============

def _persist_shot_asset(
    db: Session,
    *,
    project_id: str,
    brief: str,
    shot_prompt: str,
    shot_notes: str,
    url: str,
    provider_id: str,
    model: str,
    round_no: int,
    character_card_ids: Optional[list[str]] = None,
):
    from ..models import Asset

    asset = Asset(
        id=uuid.uuid4().hex[:12],
        project_id=project_id,
        kind="image",
        asset_kind="shot",
        title=brief[:40],
        name=brief[:40],
        url=url,
        prompt=shot_prompt,
        provider_id=provider_id,
        model_id=model,
        failed=False,
        generating=False,
        status="ready",
        origin="studio",
        # Story Bible 依赖图：镜头 → 角色卡 的关联 + 原始 brief，
        # 供影响分析（改角色身份时列出受影响镜头）和一键重生成使用。
        extra={
            "shot_notes": shot_notes,
            "studio_round": round_no,
            "brief": brief,
            "character_card_ids": list(character_card_ids or []),
        },
    )
    db.add(asset)
    db.commit()
    return asset


# ============ 质检 agent ============

def _critic_feedback(inspection: dict) -> str:
    parts: list[str] = []
    missing = inspection.get("missing_fields") or []
    if missing:
        parts.append("missing: " + ", ".join(str(m) for m in missing))
    notes = inspection.get("notes")
    if notes:
        parts.append(f"notes: {notes}")
    action = inspection.get("recommended_action")
    if action:
        parts.append(f"recommended_action: {action}")
    return "\n".join(parts) or "quality below standard, improve fidelity to the brief"


# ============ Orchestrator ============

async def run_studio_shot(
    db: Session,
    *,
    project_id: str,
    brief: str,
    image_provider_id: str,
    image_model: str,
    llm_provider_id: Optional[str] = None,
    llm_model_id: Optional[str] = None,
    max_rounds: int = 3,
    character_card_ids: Optional[list[str]] = None,
) -> StudioShotResult:
    """编剧 → 美术 → 质检 三角闭环；质检不过则带反馈回到编剧，最多 max_rounds 轮。

    character_card_ids 非空时启用 Track C 一致性锁定：
    编剧注入身份描述块、美术带参考图、质检逐卡做一致性比对。
    """
    if not brief.strip():
        raise ValueError("brief is empty")
    max_rounds = max(1, min(int(max_rounds), 5))

    configs = load_llm_configs(db)
    llm = select_llm_for_task(llm_provider_id, configs, llm_model_id)
    image_provider = _load_provider(db, image_provider_id)
    cards = load_character_cards(db, project_id, character_card_ids or [])
    identity_context = "\n\n".join(identity_block(c) for c in cards)
    ref_urls: list[str] = []
    for c in cards:
        for u in reference_urls(db, c):
            if u not in ref_urls:
                ref_urls.append(u)

    trace: list[StudioStep] = []
    feedback = ""
    last_inspection: dict = {}
    asset = None
    shot_prompt = brief

    for round_no in range(1, max_rounds + 1):
        # ---- 编剧 agent ----
        shot_prompt, shot_notes = await _screenwriter_write(llm, brief, feedback, identity_context)
        trace.append(StudioStep(
            round=round_no, role="screenwriter", action="write_shot_prompt",
            summary=f"镜头 prompt 就绪（{len(shot_prompt)} 字符）",
            detail={"shot_prompt": shot_prompt, "shot_notes": shot_notes, "critic_feedback": feedback},
        ))

        # ---- 美术 agent ----
        out = await _openai_image(
            image_provider,
            ImageGenerateIn(
                provider_id=image_provider_id, model=image_model,
                prompt=shot_prompt, ref_urls=ref_urls, aspect_ratio="16:9",
            ),
        )
        asset = _persist_shot_asset(
            db, project_id=project_id, brief=brief, shot_prompt=shot_prompt,
            shot_notes=shot_notes, url=out.url,
            provider_id=image_provider_id, model=image_model, round_no=round_no,
            character_card_ids=[c.id for c in cards],
        )
        trace.append(StudioStep(
            round=round_no, role="artist", action="generate_shot_image",
            summary=f"镜头图已生成（asset {asset.id}）",
            detail={"asset_id": asset.id, "url": out.url, "provider_id": image_provider_id,
                    "model": image_model, "ref_count": len(ref_urls)},
        ))

        # ---- 质检 agent（基础检查 + 逐卡一致性） ----
        base_inspection = await inspect_asset(db, project_id, asset.id, llm)
        consistency = [await check_consistency(db, c, asset, llm) for c in cards]
        approved = bool(base_inspection.get("meets_standard")) and all(c["consistent"] for c in consistency)
        last_inspection = {**base_inspection, "consistency": consistency}
        issues = [i for c in consistency for i in c["issues"] if not c["consistent"]]
        trace.append(StudioStep(
            round=round_no, role="critic", action="inspect_shot",
            summary="过审" if approved else "打回：" + _critic_feedback(last_inspection)[:120],
            detail=last_inspection,
        ))
        if approved:
            return StudioShotResult(
                status="approved", asset_id=asset.id, url=out.url,
                prompt=shot_prompt, rounds=round_no,
                inspection=last_inspection, trace=trace,
            )
        feedback = _critic_feedback(last_inspection)
        if issues:
            feedback += "\ncharacter consistency: " + "; ".join(issues)

    return StudioShotResult(
        status="max_rounds_exceeded", asset_id=asset.id if asset else "",
        url=asset.url if asset else "", prompt=shot_prompt,
        rounds=max_rounds, inspection=last_inspection, trace=trace,
    )


async def regenerate_shot(
    db: Session,
    *,
    project_id: str,
    asset_id: str,
    image_provider_id: str,
    image_model: str,
    llm_provider_id: Optional[str] = None,
    llm_model_id: Optional[str] = None,
    max_rounds: int = 3,
) -> StudioShotResult:
    """一键重生成某个已有镜头：用资产里存的 brief + 角色卡关联重跑闭环。

    配合 Story Bible 影响分析使用：用户改了角色身份后，对受影响镜头逐个
    调本函数重生成（决策在人，系统自动传播只到这里为止）。
    """
    from ..models import Asset

    row = db.query(Asset).filter(Asset.id == asset_id).first()
    if row is None:
        raise ValueError(f"shot asset '{asset_id}' not found")
    if row.project_id != project_id:
        raise ValueError(f"shot asset '{asset_id}' does not belong to project '{project_id}'")
    if row.asset_kind != "shot":
        raise ValueError(f"asset '{asset_id}' 不是镜头资产（asset_kind={row.asset_kind}）")
    brief = (row.extra or {}).get("brief") or row.prompt or row.name or ""
    if not brief.strip():
        raise ValueError(f"shot asset '{asset_id}' 没有可复用的 brief")
    card_ids = (row.extra or {}).get("character_card_ids") or []
    return await run_studio_shot(
        db,
        project_id=project_id,
        brief=brief,
        image_provider_id=image_provider_id,
        image_model=image_model,
        llm_provider_id=llm_provider_id,
        llm_model_id=llm_model_id,
        max_rounds=max_rounds,
        character_card_ids=card_ids,
    )
