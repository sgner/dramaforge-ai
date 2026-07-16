"""Multimodal inspection and asset-standardization primitives."""

from __future__ import annotations

import json
import uuid
import base64
import mimetypes
from pathlib import Path
from typing import Any

from sqlalchemy.orm import Session

from ..models import Asset


CHARACTER_STANDARD = {
    "single_subject": True,
    "views": ["front", "side", "back", "three_quarter"],
    "background": "plain",
    "consistency": "same character across views",
}


def character_normalization_prompt(asset: Asset) -> str:
    identity = json.dumps(asset.visual_identity or {}, ensure_ascii=False)
    return (
        "Create a production-ready Character reference sheet, left-right split layout: left one-third is a chest-up close-up front portrait; "
        "right two-thirds contains front, side-profile, and back full-body views in a horizontal row. "
        "Use soft diffused front-top-side lighting, light warm gray background F0EDE8, no hard edges, no halo, and identical face, hair, "
        "clothing, accessories, colors and proportions across all views. Show clean edges, accurate proportions and visible material texture. "
        "Absolutely no numbers, text, labels, frame counters, corner marks or annotations. "
        f"Preserve these observed identity traits: {identity}."
    )


def create_character_normalization_asset(db: Session, project_id: str, source_asset_id: str) -> Asset:
    """Create (or reuse) the pending standard character derivative."""
    source = db.query(Asset).filter(Asset.id == source_asset_id).first()
    if source is None:
        raise ValueError(f"asset '{source_asset_id}' not found")
    if source.project_id != project_id:
        raise ValueError(f"asset '{source_asset_id}' does not belong to project '{project_id}'")
    existing = (
        db.query(Asset)
        .filter(Asset.project_id == project_id, Asset.source_asset_id == source_asset_id, Asset.origin == "normalized")
        .order_by(Asset.created_at.desc())
        .first()
    )
    if existing:
        return existing
    derivative = Asset(
        id=uuid.uuid4().hex[:16],
        project_id=project_id,
        kind="image",
        asset_kind="character",
        title=f"{source.name or source.title or '角色'}·标准角色设计图",
        name=f"{source.name or source.title or '角色'}·标准角色设计图",
        prompt=character_normalization_prompt(source),
        origin="normalized",
        source_asset_id=source.id,
        inspection_status="pending",
        generating=True,
        extra={"normalization_standard": CHARACTER_STANDARD},
    )
    db.add(derivative)
    db.commit()
    db.refresh(derivative)
    return derivative


def _parse_json(content: str | None) -> dict[str, Any]:
    text = (content or "").strip()
    if text.startswith("```"):
        text = text.strip("`")
        if text.startswith("json"):
            text = text[4:].lstrip()
    try:
        value = json.loads(text)
    except json.JSONDecodeError as exc:
        raise ValueError("vision model returned invalid JSON") from exc
    if not isinstance(value, dict):
        raise ValueError("vision model returned a non-object result")
    return value


def _vision_url(asset: Asset) -> str:
    """Return a provider-readable URL for a local or remote asset."""
    if not asset.url or not asset.url.startswith("/files/"):
        return asset.url or ""
    filename = asset.url.removeprefix("/files/")
    path = Path(__file__).resolve().parents[1] / "uploads" / filename
    if not path.is_file():
        return asset.url
    mime = (asset.extra or {}).get("content_type") or mimetypes.guess_type(path.name)[0] or "application/octet-stream"
    encoded = base64.b64encode(path.read_bytes()).decode("ascii")
    return f"data:{mime};base64,{encoded}"


async def inspect_asset(db: Session, project_id: str, asset_id: str, llm_client) -> dict[str, Any]:
    """Classify one project asset with a vision-capable LLM and persist facts."""
    asset = db.query(Asset).filter(Asset.id == asset_id).first()
    if asset is None:
        raise ValueError(f"asset '{asset_id}' not found")
    if asset.project_id != project_id:
        raise ValueError(f"asset '{asset_id}' does not belong to project '{project_id}'")
    if not asset.url:
        raise ValueError(f"asset '{asset_id}' has no visual URL")

    messages = [
        {
            "role": "system",
            "content": (
                "You inspect uploaded creative assets for a short-video project. "
                "Return JSON only with asset_kind, confidence, subject_count, "
                "is_character_standard, needs_normalization, notes, "
                "visual_identity, and reference_capabilities. "
                f"Character standard: {json.dumps(CHARACTER_STANDARD, ensure_ascii=False)}"
            ),
        },
        {
            "role": "user",
            "content": [
                {"type": "text", "text": "Classify this asset and assess whether it is production-ready."},
                {"type": "image_url", "image_url": {"url": _vision_url(asset)}},
            ],
        },
    ]
    response = await llm_client.generate_structured(
        messages,
        json_schema={"type": "object"},
        temperature=0.1,
        max_tokens=1200,
    )
    result = _parse_json(response.content)

    asset.asset_kind = result.get("asset_kind") or asset.asset_kind
    asset.inspection = result
    asset.visual_identity = result.get("visual_identity") or {}
    asset.reference_capabilities = result.get("reference_capabilities") or {}
    asset.inspection_status = "ready"
    db.commit()
    db.refresh(asset)
    return result
