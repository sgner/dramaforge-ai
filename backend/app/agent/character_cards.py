"""角色卡（Track C）：跨镜头角色一致性锁定。

角色卡 = 一个 asset_kind="character" 的 Asset，extra 里携带：
  identity:              视觉身份指纹（face_anchor / hair / clothing / distinctive_features / style）
  reference_asset_ids:   参考图资产 id 列表

创建时用 vision LLM 从参考图提取身份指纹；生成镜头时三个角色各司其职：
  - 编剧：prompt 注入身份描述块（MUST PRESERVE）
  - 美术：参考图作为 ref_urls 传给供应商（i2i 锁定形象）
  - 质检：check_consistency 逐卡比对镜头与参考身份，不一致计入打回反馈
"""
from __future__ import annotations

import json
import logging
import re
import uuid
from typing import Any

from sqlalchemy.orm import Session

from .asset_intelligence import _vision_url

logger = logging.getLogger("dramaforge.studio.character_cards")

IDENTITY_FIELDS = ["face_anchor", "hair", "clothing", "distinctive_features", "style"]

_CARD_EXTRACT_SYSTEM = """You are the art director agent building a character identity card from reference images.
Return JSON only:
{"face_anchor": "<face shape, eyes, eyebrows, nose, lips, skin, distinguishing marks>",
 "hair": "<length, style, color, accessories>",
 "clothing": "<signature outfit, layers, colors>",
 "distinctive_features": "<anything that must never change between shots>",
 "style": "<art style / rendering medium>"}
Be concrete and visual. These fields will be injected into generation prompts verbatim."""

_CONSISTENCY_SYSTEM = """You are the quality agent checking character consistency.
You are given reference image(s) of a character and ONE newly generated shot.
Compare the character in the shot against the reference identity.
Return JSON only:
{"consistent": true|false, "score": <0.0-1.0>, "issues": ["<specific mismatch, e.g. hair color changed>"]}
Score >= 0.6 counts as consistent. Only flag real identity mismatches
(face, hair, clothing signature), not pose/camera/lighting differences."""


def _parse_json_dict(text: str) -> dict:
    m = re.search(r"\{[\s\S]*\}", text or "")
    if not m:
        return {}
    try:
        data = json.loads(m.group(0))
        return data if isinstance(data, dict) else {}
    except json.JSONDecodeError:
        return {}


def _load_refs(db: Session, project_id: str, reference_asset_ids: list[str]):
    from ..models import Asset

    refs = []
    for aid in reference_asset_ids:
        row = db.query(Asset).filter(Asset.id == aid).first()
        if row is None:
            raise ValueError(f"reference asset '{aid}' not found")
        if row.project_id != project_id:
            raise ValueError(f"reference asset '{aid}' does not belong to project '{project_id}'")
        if not row.url:
            raise ValueError(f"reference asset '{aid}' has no url")
        refs.append(row)
    if not refs:
        raise ValueError("reference_asset_ids is empty")
    return refs


async def extract_character_identity(
    db: Session,
    *,
    project_id: str,
    name: str,
    reference_asset_ids: list[str],
    llm,
) -> dict:
    """从参考图提取角色身份指纹（visual_identity）。

    create_character_card 与 identify 端点共用同一条提取链路。
    """
    refs = _load_refs(db, project_id, reference_asset_ids)

    content: list[dict] = [
        {"type": "text", "text": f"Build the identity card for character '{name}' from these reference image(s)."},
    ]
    for r in refs:
        content.append({"type": "image_url", "image_url": {"url": _vision_url(r)}})
    resp = await llm.generate_structured(
        [
            {"role": "system", "content": _CARD_EXTRACT_SYSTEM},
            {"role": "user", "content": content},
        ],
        json_schema={"type": "object"},
        temperature=0.2,
        max_tokens=2048,
    )
    identity_raw = _parse_json_dict(resp.content or "")
    return {k: str(identity_raw.get(k) or "") for k in IDENTITY_FIELDS}


async def create_character_card(
    db: Session,
    *,
    project_id: str,
    name: str,
    reference_asset_ids: list[str],
    llm,
):
    """从参考图提取身份指纹并落一张角色卡（Asset）。"""
    from ..models import Asset

    if not name.strip():
        raise ValueError("character name is empty")
    refs = _load_refs(db, project_id, reference_asset_ids)
    identity = await extract_character_identity(
        db,
        project_id=project_id,
        name=name,
        reference_asset_ids=reference_asset_ids,
        llm=llm,
    )

    card = Asset(
        id=uuid.uuid4().hex[:12],
        project_id=project_id,
        kind="image",
        asset_kind="character",
        title=name,
        name=name,
        url=refs[0].url,
        failed=False,
        generating=False,
        status="ready",
        origin="studio_card",
        visual_identity=identity,
        extra={
            "character_card": True,
            "reference_asset_ids": [r.id for r in refs],
        },
    )
    # 建卡即实体：角色卡绑定 story_entity（Story Bible 统一外键），
    # 与 identify / search_assets 的轻量实体系统汇合。
    from ..models import _ensure_story_entity
    _ensure_story_entity(card)
    db.add(card)
    db.commit()
    return card


def is_character_card(asset) -> bool:
    return bool(asset and asset.asset_kind == "character" and (asset.extra or {}).get("character_card"))


def load_character_cards(db: Session, project_id: str, card_ids: list[str]):
    from ..models import Asset

    cards = []
    for cid in card_ids:
        row = db.query(Asset).filter(Asset.id == cid).first()
        if row is None:
            raise ValueError(f"character card '{cid}' not found")
        if row.project_id != project_id:
            raise ValueError(f"character card '{cid}' does not belong to project '{project_id}'")
        if not is_character_card(row):
            raise ValueError(f"asset '{cid}' 不是角色卡（缺少 character_card 标记）")
        cards.append(row)
    return cards


def identity_block(card) -> str:
    """注入编剧 prompt 的身份描述块。"""
    identity = card.visual_identity or {}
    lines = [f"[CHARACTER IDENTITY — MUST PRESERVE ACROSS ALL SHOTS] {card.name}"]
    for field_name in IDENTITY_FIELDS:
        value = str(identity.get(field_name) or "").strip()
        if value:
            lines.append(f"{field_name}: {value}")
    return "\n".join(lines)


def reference_urls(db: Session, card) -> list[str]:
    """角色卡的参考图 URL 列表（给美术做 i2i 参考）。"""
    from ..models import Asset

    urls: list[str] = []
    for aid in (card.extra or {}).get("reference_asset_ids") or []:
        row = db.query(Asset).filter(Asset.id == aid).first()
        if row and row.url and row.url not in urls:
            urls.append(row.url)
    if card.url and card.url not in urls:
        urls.append(card.url)
    return urls


async def check_consistency(db: Session, card, shot_asset, llm) -> dict:
    """质检：镜头 vs 角色卡参考身份。返回 {consistent, score, issues}。

    解析失败时不阻塞流程：按 consistent=True + score=0.5 放行并在 issues 里记录，
    避免上游模型偶发输出格式问题把整个闭环卡死。
    """
    content: list[dict] = [
        {"type": "text", "text": (
            f"Character '{card.name}' identity:\n{identity_block(card)}\n\n"
            "Reference image(s) first, then the generated shot."
        )},
    ]
    for url in reference_urls(db, card):
        fake_ref = type("Ref", (), {"url": url, "extra": {}})()
        content.append({"type": "image_url", "image_url": {"url": _vision_url(fake_ref)}})
    content.append({"type": "image_url", "image_url": {"url": _vision_url(shot_asset)}})

    resp = await llm.generate_structured(
        [
            {"role": "system", "content": _CONSISTENCY_SYSTEM},
            {"role": "user", "content": content},
        ],
        json_schema={"type": "object"},
        temperature=0.1,
        max_tokens=1024,
    )
    data = _parse_json_dict(resp.content or "")
    if not data:
        return {"consistent": True, "score": 0.5, "issues": ["consistency check unparsable, passed through"], "character": card.name}
    score = float(data.get("score") or 0.0)
    issues = [str(i) for i in (data.get("issues") or [])]
    consistent = bool(data.get("consistent", score >= 0.6)) and score >= 0.6
    return {"consistent": consistent, "score": score, "issues": issues, "character": card.name}


# ============ Story Bible：影响分析（只读） ============

def update_card_identity(db: Session, card_id: str, identity_updates: dict):
    """更新角色卡身份指纹（仅 IDENTITY_FIELDS 字段生效）。

    返回更新后的角色卡。调用方（路由层）应随后用 card_impact 算出受影响镜头，
    把"是否同步重生成"的决策交给用户——本函数只改卡，不触发任何重生成。
    """
    from ..models import Asset

    card = db.query(Asset).filter(Asset.id == card_id).first()
    if card is None:
        raise ValueError(f"character card '{card_id}' not found")
    if not is_character_card(card):
        raise ValueError(f"asset '{card_id}' 不是角色卡（缺少 character_card 标记）")
    if not isinstance(identity_updates, dict) or not identity_updates:
        raise ValueError("identity_updates is empty")
    identity = dict(card.visual_identity or {})
    for key in IDENTITY_FIELDS:
        if key in identity_updates:
            identity[key] = str(identity_updates[key] or "")
    # SQLAlchemy JSON 字段需要整体赋值才会标脏
    card.visual_identity = identity
    db.commit()
    return card


def card_impact(db: Session, project_id: str, card_id: str) -> list[dict]:
    """只读影响分析：列出项目里引用了该角色卡的所有镜头资产。

    依赖图来自镜头资产 extra.character_card_ids（生成时写入）。
    角色卡绑定了 story_entity 后，同时按 extra.story_entity_ids 匹配
    （实体层关联），两条路径命中同一镜头时去重。
    """
    from ..models import Asset

    card = db.query(Asset).filter(Asset.id == card_id).first()
    entity_id = card.story_entity_id if card is not None else None

    rows = (
        db.query(Asset)
        .filter(Asset.project_id == project_id, Asset.asset_kind == "shot", Asset.failed.is_(False))
        .order_by(Asset.created_at.asc())
        .all()
    )
    impacted = []
    for row in rows:
        extra = row.extra or {}
        card_ids = extra.get("character_card_ids") or []
        entity_ids = extra.get("story_entity_ids") or []
        if card_id in card_ids or (entity_id and entity_id in entity_ids):
            impacted.append({
                "asset_id": row.id,
                "title": row.title or row.name or "",
                "brief": extra.get("brief") or "",
                "url": row.url,
                "status": row.status,
                "created_at": row.created_at.isoformat() if row.created_at else None,
            })
    return impacted


def entity_impact(db: Session, project_id: str, story_entity_id: str) -> list[dict]:
    """实体级只读影响分析：列出引用该 story_entity 的所有镜头资产。

    匹配两条路径：镜头 extra.story_entity_ids（工作室生成时写入）和
    镜头自身的 story_entity_id 列（identify/搜索懒生成）。
    道具、场景等非角色卡实体同样可用。
    """
    from ..models import Asset

    rows = (
        db.query(Asset)
        .filter(Asset.project_id == project_id, Asset.asset_kind == "shot", Asset.failed.is_(False))
        .order_by(Asset.created_at.asc())
        .all()
    )
    impacted = []
    for row in rows:
        entity_ids = (row.extra or {}).get("story_entity_ids") or []
        if story_entity_id in entity_ids or row.story_entity_id == story_entity_id:
            impacted.append({
                "asset_id": row.id,
                "title": row.title or row.name or "",
                "brief": (row.extra or {}).get("brief") or "",
                "url": row.url,
                "status": row.status,
                "created_at": row.created_at.isoformat() if row.created_at else None,
            })
    return impacted
