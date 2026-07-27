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
    bigshot_id: Optional[str] = None,
):
    from ..models import Asset

    # 实体关联（Story Bible 统一外键）：从角色卡复制 story_entity_id，
    # 使影响分析可以下沉到实体层（道具/场景/非卡资产同样可查）。
    story_entity_ids: list[str] = []
    if character_card_ids:
        cards = db.query(Asset).filter(Asset.id.in_(list(character_card_ids))).all()
        for card in cards:
            if card.story_entity_id and card.story_entity_id not in story_entity_ids:
                story_entity_ids.append(card.story_entity_id)

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
            "story_entity_ids": story_entity_ids,
            # 与 drama-task 脚本 bigShot 的显式关联（替代脆弱的 URL 匹配）
            **({"bigshot_id": bigshot_id} if bigshot_id else {}),
        },
    )
    db.add(asset)
    db.commit()
    _upsert_studio_shot_node(db, asset)
    return asset


def _upsert_studio_shot_node(db: Session, asset) -> None:
    """工作室镜头回画布：为 shot 资产创建/更新对应的画布节点。

    节点 id 由资产 id 确定性派生，重复生成（多版本）各自一个节点；
    data 字段与 rebuild-from-nodes 的读取约定对齐（_assetKind/_assetPrompt），
    保证反向同步不会把节点再复制成重复资产。
    """
    from ..models import Node

    node_id = f"studio-shot-{asset.id}"
    node = db.query(Node).filter(Node.id == node_id).first()
    if node is None:
        count = db.query(Node).filter(Node.project_id == asset.project_id).count()
        node = Node(
            id=node_id,
            project_id=asset.project_id,
            type="image",
            x=60 + (count % 4) * 340,
            y=60 + (count // 4) * 260,
            w=320,
            h=180,
            data={},
        )
        db.add(node)
    node.data = {
        **(node.data or {}),
        "url": asset.url,
        "title": asset.title or asset.name or "",
        "name": asset.name or "",
        "_assetKind": asset.asset_kind,
        "_assetPrompt": asset.prompt,
        "_assetProviderId": asset.provider_id,
        "_assetModelId": asset.model_id,
        "_assetFailed": bool(asset.failed),
        "_origin": "studio",
    }
    db.commit()


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
    bigshot_id: Optional[str] = None,
) -> StudioShotResult:
    """编剧 → 美术 → 质检 三角闭环；质检不过则带反馈回到编剧，最多 max_rounds 轮。

    character_card_ids 非空时启用 Track C 一致性锁定：
    编剧注入身份描述块、美术带参考图、质检逐卡做一致性比对。
    bigshot_id 非空时写入镜头 extra，与 drama-task 脚本 bigShot 建立显式关联。
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
            bigshot_id=bigshot_id,
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
        check_errors = [c for c in consistency if c.get("check_error")]
        approved = (
            bool(base_inspection.get("meets_standard"))
            and all(c["consistent"] for c in consistency)
            and not check_errors
        )
        last_inspection = {**base_inspection, "consistency": consistency}
        issues = [i for c in consistency for i in c["issues"] if not c["consistent"]]
        trace.append(StudioStep(
            round=round_no, role="critic", action="inspect_shot",
            summary="过审" if approved else "打回：" + _critic_feedback(last_inspection)[:120],
            detail=last_inspection,
        ))
        if approved:
            _mark_shot_review_pending(db, asset, "approved")
            return StudioShotResult(
                status="approved", asset_id=asset.id, url=out.url,
                prompt=shot_prompt, rounds=round_no,
                inspection=last_inspection, trace=trace,
            )
        if check_errors:
            # 质检自身故障（一致性结果解析失败），不是创作失败：
            # 不再烧一轮真实生成，直接把当前镜头交人审裁决。
            _mark_shot_review_pending(db, asset, "check_error")
            return StudioShotResult(
                status="check_error", asset_id=asset.id, url=out.url,
                prompt=shot_prompt, rounds=round_no,
                inspection=last_inspection, trace=trace,
            )
        feedback = _critic_feedback(last_inspection)
        if issues:
            feedback += "\ncharacter consistency: " + "; ".join(issues)

    if asset is not None:
        _mark_shot_review_pending(db, asset, "max_rounds_exceeded")
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
    bigshot_id: Optional[str] = None,
) -> StudioShotResult:
    """一键重生成某个已有镜头：用资产里存的 brief + 角色卡关联重跑闭环。

    配合 Story Bible 影响分析使用：用户改了角色身份后，对受影响镜头逐个
    调本函数重生成（决策在人，系统自动传播只到这里为止）。
    bigshot_id 未显式传时继承旧资产 extra 里的关联。
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
    effective_bigshot_id = bigshot_id or (row.extra or {}).get("bigshot_id")
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
        bigshot_id=effective_bigshot_id,
    )


# ============ 审片台（人审层） ============
# critic 只是初筛，人审才是终审：镜头生成后 review_status=pending_review，
# 由用户在审片台 approve/reject/lock。同 brief 的多个资产是同一镜头的版本。

REVIEW_ACTION_TO_STATUS = {
    "approve": "approved",
    "reject": "rejected",
    "lock": "locked",
    "unlock": "pending_review",
}


def _mark_shot_review_pending(db: Session, asset, critic_status: str) -> None:
    """闭环结束后给镜头资产写入初筛结论 + 待审标记（SQLAlchemy JSON 需整体赋值标脏）。"""
    extra = dict(asset.extra or {})
    extra["critic_status"] = critic_status
    extra["review_status"] = "pending_review"
    asset.extra = extra
    db.commit()


def list_shots(db: Session, project_id: str) -> list[dict]:
    """审片台镜头列表：按 brief 分版本（同 brief 多资产 = 同镜头多版本）。"""
    from ..models import Asset

    rows = (
        db.query(Asset)
        .filter(Asset.project_id == project_id, Asset.asset_kind == "shot", Asset.failed.is_(False))
        .order_by(Asset.created_at.asc())
        .all()
    )
    groups: dict[str, int] = {}
    totals: dict[str, int] = {}
    for row in rows:
        brief = (row.extra or {}).get("brief") or row.prompt or row.name or ""
        totals[brief] = totals.get(brief, 0) + 1
    out = []
    for row in rows:
        extra = row.extra or {}
        brief = extra.get("brief") or row.prompt or row.name or ""
        groups[brief] = groups.get(brief, 0) + 1
        out.append({
            "asset_id": row.id,
            "brief": brief,
            "title": row.title or row.name or "",
            "url": row.url,
            "prompt": row.prompt,
            "critic_status": extra.get("critic_status"),
            "review_status": extra.get("review_status") or "pending_review",
            "review_note": extra.get("review_note"),
            "version": groups[brief],
            "versions": totals[brief],
            "created_at": row.created_at.isoformat() if row.created_at else None,
        })
    return out


def review_shot(db: Session, asset_id: str, action: str, note: str = "") -> dict:
    """人审操作：approve/reject/lock/unlock（可选备注）。"""
    from ..models import Asset

    status = REVIEW_ACTION_TO_STATUS.get(action)
    if status is None:
        raise ValueError(f"unknown review action '{action}'（支持 approve/reject/lock/unlock）")
    row = db.query(Asset).filter(Asset.id == asset_id).first()
    if row is None:
        raise ValueError(f"shot asset '{asset_id}' not found")
    if row.asset_kind != "shot":
        raise ValueError(f"asset '{asset_id}' 不是镜头资产")
    extra = dict(row.extra or {})
    extra["review_status"] = status
    if note:
        extra["review_note"] = note
    row.extra = extra
    db.commit()
    return {"asset_id": row.id, "review_status": status, "review_note": extra.get("review_note")}
