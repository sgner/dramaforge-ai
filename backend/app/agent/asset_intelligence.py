"""Multimodal inspection, normalization, and reference-resolution primitives."""

from __future__ import annotations

import base64
import json
import mimetypes
import uuid
from pathlib import Path
from typing import Any

from sqlalchemy.orm import Session

from ..models import Asset
from .token_limits import DEEPSEEK_V4_PRO_MAX_OUTPUT_TOKENS


CHARACTER_STANDARD = {
    "single_subject": True,
    "views": ["front", "side", "back", "three_quarter"],
    "background": "plain",
    "consistency": "same character across views",
}


# 镜头级质检标准：studio 三角闭环的 critic 用（构图/运镜/连续性/保真度），
# 不再复用角色资产标准（质检标准错配修复）。
SHOT_STANDARD = {
    "composition": "clear focal subject, cinematic framing, no awkward crops",
    "camera": "shot size and camera angle match the brief",
    "continuity": "characters, props and scene match their reference assets",
    "fidelity": "follows the brief; no text overlays, watermarks or rendering artifacts",
}


def _inspection_standard(asset: Asset) -> tuple[str, dict]:
    """按资产类型选质检标准：镜头用镜头级标准，其余沿用角色/通用标准。"""
    if _normalize_role(getattr(asset, "asset_kind", None)) in {"shot", "storyboard"}:
        return "Shot standard", SHOT_STANDARD
    return "Character standard", CHARACTER_STANDARD


NORMALIZATION_TEMPLATES: dict[str, str] = {
    "prop": (
        "Create a production-ready prop reference image. Keep the object isolated, centered, and unobstructed. "
        "Preserve silhouette, materials, markings, proportions, and wear details. Use a clean neutral background, "
        "high material fidelity, and absolutely no hands, characters, labels, captions, or measurement marks."
    ),
    "scene": (
        "Create a production-ready scene reference plate. Preserve layout, geography, lighting logic, focal structures, "
        "entry and exit paths, and environmental storytelling details. Use a stable wide composition with no characters "
        "unless they are structural to the environment."
    ),
    "product": (
        "Create a production-ready product reference image. Preserve brand marks, structure, materials, proportions, "
        "surface finish, packaging details, and distinctive hardware. Use a clean neutral presentation without extra props "
        "or decorative rewrites."
    ),
}


MEDIA_KINDS = {"image", "video"}
ROLE_KINDS = {"character", "prop", "scene", "storyboard", "video", "product", "documentary_source", "script", "source"}


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


def _normalize_role(value: str | None) -> str:
    return str(value or "").strip().lower()


def _asset_role(asset: Asset) -> str:
    role = _normalize_role(getattr(asset, "reference_role", None))
    if role:
        return role
    return _normalize_role(getattr(asset, "asset_kind", None)) or "unknown"


def _default_status(asset: Asset) -> str:
    current = _normalize_role(getattr(asset, "status", None))
    if current:
        return current
    if getattr(asset, "failed", False):
        return "failed"
    if getattr(asset, "generating", False):
        return "processing"
    if getattr(asset, "url", None):
        return "ready"
    return "pending"


def _capabilities_for_kind(target_kind: str, source: Asset) -> dict[str, bool]:
    capabilities = dict(source.reference_capabilities or {})
    if target_kind in {"character", "prop", "scene", "product"}:
        capabilities.setdefault("image", True)
        capabilities.setdefault("video", True)
    elif target_kind == "storyboard":
        capabilities.setdefault("image", True)
        capabilities.setdefault("video", False)
    return capabilities


def _as_list(value: Any) -> list[str]:
    if isinstance(value, list):
        return [str(item) for item in value if str(item).strip()]
    return []


def _unique_ids(*values: Any) -> list[str]:
    seen: set[str] = set()
    ordered: list[str] = []
    for value in values:
        for item in _as_list(value) if isinstance(value, list) else [value]:
            text = str(item or "").strip()
            if not text or text in seen:
                continue
            seen.add(text)
            ordered.append(text)
    return ordered


def _build_normalization_prompt(target_kind: str, source: Asset) -> str:
    if target_kind == "character":
        return character_normalization_prompt(source)
    identity = json.dumps(source.visual_identity or source.inspection or {}, ensure_ascii=False)
    template = NORMALIZATION_TEMPLATES.get(target_kind, NORMALIZATION_TEMPLATES["prop"])
    return f"{template} Preserve these observed source details: {identity}."


def _reference_payload(selected: Asset, source: Asset) -> dict[str, Any]:
    # 选中标准化衍生图时，把原始上传图保留为兜底参考（fallback_url），
    # 供媒体工具在主参考之后追加，provider 可按需取用。
    fallback_url = None
    if (
        selected.id != source.id
        and source.url
        and not source.failed
        and source.status not in {"failed", "superseded"}
    ):
        fallback_url = source.url
    return {
        "asset_id": selected.id,
        "source_asset_id": source.id if selected.id != source.id else None,
        "asset_kind": selected.asset_kind,
        "reference_role": selected.reference_role,
        "status": selected.status,
        "version": selected.version,
        "url": selected.url,
        "fallback_url": fallback_url,
        "prompt_source": selected.prompt_source,
        "prompt_optimized": selected.prompt_optimized,
    }


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
    # 防路径遍历：asset.url 用户可控（create_asset 接受任意 url）。
    # 任何目录分量（/、\、.、..）一律拒绝；再取 basename 拼接 resolve
    # 并校验必须落在 uploads 目录内，避免 base64 泄露本地任意文件。
    if not filename or "/" in filename or "\\" in filename or filename in (".", ".."):
        return asset.url
    safe_name = Path(filename).name
    if not safe_name or safe_name != filename:
        return asset.url
    upload_dir = Path(__file__).resolve().parents[1] / "uploads"
    path = (upload_dir / safe_name).resolve()
    if not path.is_relative_to(upload_dir.resolve()):
        return asset.url
    if not path.is_file():
        return asset.url
    mime = (asset.extra or {}).get("content_type") or mimetypes.guess_type(path.name)[0] or "application/octet-stream"
    encoded = base64.b64encode(path.read_bytes()).decode("ascii")
    return f"data:{mime};base64,{encoded}"


def _parse_inspect_call(args: tuple[Any, ...], kwargs: dict[str, Any]) -> tuple[Session, str, str, Any]:
    if args and isinstance(args[0], Session):
        if len(args) < 4:
            raise TypeError("inspect_asset(db, project_id, asset_id, llm_client) requires four positional arguments")
        return args[0], str(args[1]), str(args[2]), args[3]
    asset_id = kwargs.get("asset_id") or (args[0] if args else None)
    db = kwargs.get("db")
    project_id = kwargs.get("project_id")
    llm_client = kwargs.get("llm_client")
    if not isinstance(db, Session) or not asset_id or not project_id:
        raise TypeError("inspect_asset(asset_id, *, db=..., project_id=..., llm_client=...) requires db, project_id, and asset_id")
    return db, str(project_id), str(asset_id), llm_client


def _parse_prepare_call(args: tuple[Any, ...], kwargs: dict[str, Any], *, default_target_kind: str | None = None) -> tuple[Session, str, str, str]:
    if args and isinstance(args[0], Session):
        if len(args) < 4 and default_target_kind is None:
            raise TypeError("prepare_asset(db, project_id, asset_id, target_kind) requires four positional arguments")
        db = args[0]
        project_id = str(args[1])
        asset_id = str(args[2])
        target_kind = str(args[3]) if len(args) >= 4 else str(default_target_kind)
        return db, project_id, asset_id, target_kind
    asset_id = kwargs.get("asset_id") or (args[0] if args else None)
    target_kind = kwargs.get("target_kind") or (args[1] if len(args) > 1 else default_target_kind)
    db = kwargs.get("db")
    project_id = kwargs.get("project_id")
    if not isinstance(db, Session) or not asset_id or not project_id or not target_kind:
        raise TypeError("prepare_asset(asset_id, target_kind, *, db=..., project_id=...) requires db, project_id, asset_id, and target_kind")
    return db, str(project_id), str(asset_id), str(target_kind)


def _parse_reference_call(args: tuple[Any, ...], kwargs: dict[str, Any]) -> tuple[Session, str, list[str], str]:
    if args and isinstance(args[0], Session):
        if len(args) < 3 and "asset_ids" not in kwargs:
            raise TypeError("resolve_reference_assets(db, project_id, asset_ids, role) requires asset_ids")
        asset_ids = args[2] if len(args) >= 3 else kwargs.get("asset_ids")
        role = args[3] if len(args) >= 4 else kwargs.get("role")
        if not role:
            raise TypeError("resolve_reference_assets requires role")
        return args[0], str(args[1]), [str(item) for item in asset_ids or []], str(role)
    db = kwargs.get("db")
    project_id = kwargs.get("project_id")
    asset_ids = kwargs.get("asset_ids") or (args[0] if args else None)
    role = kwargs.get("role") or (args[1] if len(args) > 1 else None)
    if not isinstance(db, Session) or not project_id or asset_ids is None or not role:
        raise TypeError("resolve_reference_assets(asset_ids, role, *, db=..., project_id=...) requires db, project_id, asset_ids, and role")
    return db, str(project_id), [str(item) for item in asset_ids or []], str(role)


def _normalize_inspection(raw: dict[str, Any], asset: Asset) -> dict[str, Any]:
    asset_type = _normalize_role(raw.get("asset_type") or raw.get("asset_kind")) or _asset_role(asset)
    confidence = float(raw.get("confidence") or 0.0)
    subjects = raw.get("subjects")
    if not isinstance(subjects, list):
        subject_count = raw.get("subject_count")
        if subject_count == 1:
            subjects = ["single_person"]
        elif subject_count:
            subjects = [f"{int(subject_count)}_subjects"]
        else:
            subjects = []
    meets_standard = bool(raw.get("meets_standard", raw.get("is_character_standard", False)))
    missing_fields = raw.get("missing_fields")
    if not isinstance(missing_fields, list):
        missing_fields = []
    reference_role = _normalize_role(raw.get("reference_role")) or asset_type
    recommended_action = raw.get("recommended_action")
    if not recommended_action:
        if asset_type in {"character", "prop", "scene", "product"} and not meets_standard:
            recommended_action = f"prepare_{asset_type}_asset"
        else:
            recommended_action = "approve_asset"
    subject_count = len(subjects)
    return {
        "asset_type": asset_type,
        "asset_kind": raw.get("asset_kind") or asset_type,
        "confidence": confidence,
        "subjects": [str(item) for item in subjects],
        "subject_count": subject_count,
        "meets_standard": meets_standard,
        "is_character_standard": meets_standard,
        "needs_normalization": bool(raw.get("needs_normalization", not meets_standard)),
        "missing_fields": [str(item) for item in missing_fields],
        "recommended_action": str(recommended_action),
        "reference_role": reference_role,
        "visual_identity": raw.get("visual_identity") or {},
        "reference_capabilities": raw.get("reference_capabilities") or {},
        "prompt_source": raw.get("prompt_source"),
        "prompt_optimized": raw.get("prompt_optimized"),
        "notes": raw.get("notes"),
    }


async def inspect_asset(*args, **kwargs) -> dict[str, Any]:
    """Classify one project asset with a vision-capable LLM and persist graph facts."""
    db, project_id, asset_id, llm_client = _parse_inspect_call(args, kwargs)
    asset = db.query(Asset).filter(Asset.id == asset_id).first()
    if asset is None:
        raise ValueError(f"asset '{asset_id}' not found")
    if asset.project_id != project_id:
        raise ValueError(f"asset '{asset_id}' does not belong to project '{project_id}'")
    # 入口守卫：文本资产（脚本/小说，kind=text）没有可视觉检查的图片，
    # asset.url 里存的是 markdown 正文。若继续走视觉检查，会把整段 markdown
    # 当 image_url 发给 vision LLM，得到垃圾分类结果并污染资产（线上真实事故）。
    if _normalize_role(getattr(asset, "kind", None)) not in MEDIA_KINDS:
        raise ValueError(
            f"asset '{asset_id}' 是 {asset.kind} 类型资产，不是图片/视频，"
            "inspect_asset 只支持视觉资产检查"
        )
    if not asset.url:
        raise ValueError(f"asset '{asset_id}' has no visual URL")
    if llm_client is None:
        raise ValueError("vision-capable LLM is required to inspect assets")
    original_asset_kind = asset.asset_kind
    standard_label, standard = _inspection_standard(asset)

    messages = [
        {
            "role": "system",
            "content": (
                "You inspect uploaded creative assets for a short-video project. "
                "Return JSON only with asset_type, confidence, subjects, meets_standard, missing_fields, "
                "recommended_action, reference_role, prompt_source, prompt_optimized, visual_identity, "
                "reference_capabilities, and notes. "
                f"{standard_label}: {json.dumps(standard, ensure_ascii=False)}"
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
        max_tokens=DEEPSEEK_V4_PRO_MAX_OUTPUT_TOKENS,
    )
    normalized = _normalize_inspection(_parse_json(response.content), asset)

    asset_type = normalized["asset_type"]
    # asset_kind 回写守卫：只有检测到的类型是有效的已知角色才回写。
    # vision LLM 经常返回 "missing"/"unknown"/空串 等无效值（_normalize_inspection
    # 里 asset_type 直接取自 LLM 原始输出），旧实现无条件回写会把资产原有的
    # asset_kind（如 "script"）覆盖成 "missing"，导致 read_text_asset 拒绝读取、
    # 资产就此损坏（线上真实事故）。无效值一律保留原 asset_kind。
    detected_kind = _normalize_role(asset_type)
    if detected_kind and detected_kind not in {"missing", "unknown"}:
        asset.asset_kind = detected_kind
    asset.reference_role = normalized["reference_role"] or asset.reference_role
    asset.inspection = normalized
    asset.visual_identity = normalized["visual_identity"] or {}
    asset.reference_capabilities = normalized["reference_capabilities"] or {}
    asset.prompt_source = normalized["prompt_source"] or asset.prompt_source
    asset.prompt_optimized = normalized["prompt_optimized"] or asset.prompt_optimized
    asset.status = _default_status(asset)
    asset.inspection_status = "ready" if normalized["meets_standard"] or not original_asset_kind else "needs_review"
    db.commit()
    db.refresh(asset)
    return normalized


def prepare_asset(*args, **kwargs) -> Asset:
    """Create or reuse a normalized derivative asset without mutating the source upload."""
    db, project_id, source_asset_id, target_kind = _parse_prepare_call(args, kwargs)
    target_kind = _normalize_role(target_kind)
    source = db.query(Asset).filter(Asset.id == source_asset_id).first()
    if source is None:
        raise ValueError(f"asset '{source_asset_id}' not found")
    if source.project_id != project_id:
        raise ValueError(f"asset '{source_asset_id}' does not belong to project '{project_id}'")
    if target_kind not in {"character", "prop", "scene", "product"}:
        raise ValueError(f"unsupported target_kind '{target_kind}'")

    existing = (
        db.query(Asset)
        .filter(
            Asset.project_id == project_id,
            Asset.source_asset_id == source.id,
            Asset.origin == "normalized",
            Asset.reference_role == target_kind,
        )
        .order_by(Asset.created_at.desc())
        .first()
    )

    prompt = _build_normalization_prompt(target_kind, source)
    derived_from = _unique_ids(source.id, existing.derived_from if existing else [], source.derived_from or [])
    capabilities = _capabilities_for_kind(target_kind, source)

    if existing:
        existing.asset_kind = target_kind
        existing.reference_role = target_kind
        existing.prompt = prompt
        existing.prompt_source = prompt
        existing.prompt_optimized = existing.prompt_optimized or prompt
        existing.status = "ready" if existing.url else "processing"
        existing.failed = False
        existing.error = None
        existing.generating = existing.status == "processing"
        existing.derived_from = derived_from
        existing.version = max(int(existing.version or 1), int(source.version or 1) + 1)
        existing.reference_capabilities = capabilities
        existing.inspection_status = "ready" if existing.url else "needs_review"
        db.commit()
        db.refresh(existing)
        return existing

    derivative = Asset(
        id=uuid.uuid4().hex[:16],
        project_id=project_id,
        kind="image",
        asset_kind=target_kind,
        title=f"{source.name or source.title or target_kind} · standardized",
        name=f"{source.name or source.title or target_kind} · standardized",
        prompt=prompt,
        prompt_source=prompt,
        prompt_optimized=prompt,
        origin="normalized",
        source_asset_id=source.id,
        status="processing",
        version=max(int(source.version or 1) + 1, 2),
        derived_from=derived_from,
        reference_role=target_kind,
        inspection_status="needs_review",
        generating=True,
        extra={"normalization_standard": CHARACTER_STANDARD if target_kind == "character" else NORMALIZATION_TEMPLATES.get(target_kind)},
        reference_capabilities=capabilities,
    )
    db.add(derivative)
    db.commit()
    db.refresh(derivative)
    return derivative


def create_character_normalization_asset(*args, **kwargs) -> Asset:
    if args and isinstance(args[0], Session):
        if len(args) < 3:
            raise TypeError("create_character_normalization_asset(db, project_id, source_asset_id) requires three positional arguments")
        return prepare_asset(args[0], args[1], args[2], "character")

    db = kwargs.get("db")
    project_id = kwargs.get("project_id")
    source_asset_id = kwargs.get("source_asset_id")
    if isinstance(db, Session) and project_id and source_asset_id:
        return prepare_asset(db, project_id, source_asset_id, "character")

    call_kwargs = dict(kwargs)
    call_kwargs["target_kind"] = "character"
    return prepare_asset(*args, **call_kwargs)


def resolve_reference_assets(*args, **kwargs) -> list[dict[str, Any]]:
    """Resolve logical asset IDs into deterministic, role-aware references."""
    db, project_id, asset_ids, role = _parse_reference_call(args, kwargs)
    role = _normalize_role(role)
    seen: set[str] = set()
    resolved: list[dict[str, Any]] = []

    for asset_id in asset_ids:
        if asset_id in seen:
            continue
        seen.add(asset_id)

        source = db.query(Asset).filter(Asset.id == asset_id).first()
        if source is None:
            raise ValueError(f"asset '{asset_id}' not found")
        if source.project_id != project_id:
            raise ValueError(f"asset '{asset_id}' does not belong to project '{project_id}'")

        candidates = (
            db.query(Asset)
            .filter(
                Asset.project_id == project_id,
                (Asset.id == source.id) | (Asset.source_asset_id == source.id),
            )
            .order_by(Asset.created_at.asc(), Asset.id.asc())
            .all()
        )

        if role in MEDIA_KINDS:
            filtered = [
                candidate
                for candidate in candidates
                if not candidate.failed
                and candidate.status not in {"failed", "superseded"}
                and candidate.url
            ]
        else:
            filtered = [
                candidate
                for candidate in candidates
                if not candidate.failed
                and candidate.status not in {"failed", "superseded"}
                and candidate.url
                and _asset_role(candidate) == role
            ]

        if role in MEDIA_KINDS:
            filtered.sort(
                key=lambda candidate: (
                    0 if bool((candidate.reference_capabilities or {}).get(role)) else 1,
                    candidate.id == source.id,
                    -(int(candidate.version or 1)),
                    candidate.id,
                )
            )
        else:
            filtered.sort(key=lambda candidate: (candidate.id == source.id, -(int(candidate.version or 1)), candidate.id))

        if not filtered:
            if role in ROLE_KINDS and _asset_role(source) != role:
                raise ValueError(f"asset '{asset_id}' is a {_asset_role(source)} reference, not a {role} reference")
            raise ValueError(f"asset '{asset_id}' is not ready for role '{role}'")

        selected = filtered[0]
        # usage_count 只在 provider 请求被接受后递增（finish_media_asset →
        # record_asset_usage），解析阶段不计数，避免失败/取消的生成虚增使用次数。
        resolved.append(_reference_payload(selected, source))

    return resolved
