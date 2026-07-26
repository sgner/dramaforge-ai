"""Persist media generation lifecycle records used by the existing canvas asset nodes."""
from __future__ import annotations

import uuid
from typing import Any


def _asset_dict(row: Any) -> dict:
    return {
        "id": row.id,
        "kind": row.kind,
        "asset_kind": row.asset_kind,
        "name": row.name or "",
        "title": row.title or "",
        "url": row.url,
        "prompt": row.prompt,
        "provider_id": row.provider_id,
        "provider_name": row.provider_name,
        "model_id": row.model_id,
        "failed": bool(row.failed),
        "error": row.error,
        "generating": bool(row.generating),
        "extra": row.extra or {},
        "status": getattr(row, "status", None),
        "version": getattr(row, "version", None),
        "source_asset_id": getattr(row, "source_asset_id", None),
        "derived_from": getattr(row, "derived_from", None) or [],
        "reference_role": getattr(row, "reference_role", None),
        "prompt_source": getattr(row, "prompt_source", None),
        "prompt_optimized": getattr(row, "prompt_optimized", None),
    }


def begin_media_asset(db: Any, *, project_id: str | None, kind: str, asset_kind: str | None, name: str, prompt: str, provider_id: str | None = None, provider_name: str | None = None, model_id: str | None = None, extra: dict | None = None) -> dict:
    from ..models import Asset

    # 关键：去重条件必须同时考虑 FAILED 和已成功的资产。
    # 历史 bug：之前只对 failed.is_(True) 的资产做去重，导致 agent 在 plan 重跑、
    # retry、error recovery 等场景下重复调用同一 generate_* 工具时，第一次成功的
    # 资产不会被复用，而是被创建一个新的、不同 id 的资产 → 画布/资产库出现重复条目。
    # 修复：去重时同时匹配 status='ready'/'processing' 的资产，返回已有记录（idempotent）。
    # 用户若想强制创建新版本，应通过传不同的 name / source_asset_id / 不同的 prompt 区分。
    query = db.query(Asset).filter(
        Asset.project_id == project_id,
        Asset.kind == kind,
        Asset.asset_kind == asset_kind,
        Asset.name == (name or ""),
        Asset.prompt == prompt,
        Asset.source_asset_id == (extra or {}).get("source_asset_id"),
        Asset.failed.is_(False),
        Asset.status.in_(["ready", "processing", "uploaded"]),
    )
    existing_successful = query.order_by(Asset.created_at.desc()).first()
    if existing_successful is not None:
        # 已存在同名/同 prompt 的成功资产 → 直接复用，不创建新记录。
        # 注意：这里不更新已有资产的 url/状态，调用方在生成完成后会通过
        # finish_media_asset 写入 url。如果用户希望"重新生成"，finish_media_asset
        # 会覆盖 url，相当于"regenerate"语义。
        if provider_id is not None and not existing_successful.provider_id:
            existing_successful.provider_id = provider_id
        if provider_name is not None and not existing_successful.provider_name:
            existing_successful.provider_name = provider_name
        if model_id is not None and not existing_successful.model_id:
            existing_successful.model_id = model_id
        db.commit()
        db.refresh(existing_successful)
        return _asset_dict(existing_successful)

    # 第二步：尝试恢复 FAILED 的同名同 prompt 资产（retry 语义）。
    retry_query = db.query(Asset).filter(
        Asset.project_id == project_id,
        Asset.kind == kind,
        Asset.asset_kind == asset_kind,
        Asset.name == (name or ""),
        Asset.prompt == prompt,
        Asset.source_asset_id == (extra or {}).get("source_asset_id"),
        Asset.failed.is_(True),
    )
    if not (extra or {}).get("batch"):
        # 非 batch 场景：把 FAILED 资产重置为 processing（保持同一 id 便于 UI 关联）
        existing = retry_query.order_by(Asset.created_at.desc()).first()
        if existing:
            existing.generating = True
            existing.failed = False
            existing.error = None
            existing.url = None
            existing.status = "processing"
            if provider_id is not None:
                existing.provider_id = provider_id
            if provider_name is not None:
                existing.provider_name = provider_name
            if model_id is not None:
                existing.model_id = model_id
            if extra:
                existing.extra = extra
            db.commit()
            db.refresh(existing)
            return _asset_dict(existing)
    else:
        # batch 场景：FAILED 资产也走"更新已有记录"分支
        existing = retry_query.order_by(Asset.created_at.desc()).first()
        if existing:
            return _asset_dict(existing)

    # 第三步：创建新资产（无可复用记录时）
    row = Asset(
        id=f"agent-{uuid.uuid4().hex[:16]}",
        project_id=project_id,
        kind=kind,
        asset_kind=asset_kind,
        name=name or "",
        title=name or "",
        prompt=prompt,
        provider_id=provider_id,
        provider_name=provider_name,
        model_id=model_id,
        generating=True,
        failed=False,
        extra=extra or {},
        status="processing",
        version=1,
        derived_from=[(extra or {}).get("source_asset_id")] if (extra or {}).get("source_asset_id") else [],
        reference_role=(extra or {}).get("reference_role"),
        prompt_source=(extra or {}).get("prompt_source") or prompt,
        prompt_optimized=(extra or {}).get("prompt_optimized") or prompt,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return _asset_dict(row)


def record_asset_usage(
    db: Any,
    *,
    project_id: str | None,
    asset_ids: list[str],
    consumer_type: str,
    consumer_id: str,
    role: str | None = None,
) -> list[dict]:
    """生成被 provider 接受后记录资产使用。

    每个被引用资产写一行 AssetUsage 并递增 usage_count。
    幂等：同一 (asset_id, consumer_type, consumer_id) 只记一行，
    重试 / 重复 finish 不会重复计数。
    """
    from ..models import Asset, AssetUsage

    if not project_id:
        return []
    recorded: list[dict] = []
    for asset_id in dict.fromkeys(asset_ids or []):
        asset = db.query(Asset).filter(
            Asset.id == asset_id,
            Asset.project_id == project_id,
        ).first()
        if asset is None:
            continue
        existing = db.query(AssetUsage).filter(
            AssetUsage.asset_id == asset_id,
            AssetUsage.consumer_type == consumer_type,
            AssetUsage.consumer_id == consumer_id,
        ).first()
        if existing is not None:
            continue
        row = AssetUsage(
            id=f"usage-{uuid.uuid4().hex[:16]}",
            project_id=project_id,
            asset_id=asset_id,
            consumer_type=consumer_type,
            consumer_id=consumer_id,
            role=role,
        )
        db.add(row)
        asset.usage_count = (asset.usage_count or 0) + 1
        recorded.append({
            "id": row.id,
            "asset_id": asset_id,
            "consumer_type": consumer_type,
            "consumer_id": consumer_id,
            "role": role,
        })
    if recorded:
        db.commit()
    return recorded


def finish_media_asset(
    db: Any,
    asset_id: str,
    *,
    url: str | None = None,
    error: str | None = None,
    prompt: str | None = None,
    prompt_source: str | None = None,
    prompt_optimized: str | None = None,
    extra: dict | None = None,
    dev_fallback: bool = False,
) -> dict:
    from ..models import Asset

    row = db.query(Asset).filter(Asset.id == asset_id).one()
    row.generating = False
    if dev_fallback:
        # dev fallback（上游无视频端点时返回的占位 URL）不是真实交付物：
        # 标记 failed + status="warning"，使 compute_assets_summary / finish_task
        # 完成度校验不把它计入"已交付"，同时保留 URL 供本地开发调试。
        error = error or (
            "dev fallback: upstream provider has no video endpoint; "
            "returned placeholder URL (not a real deliverable)"
        )
        extra = {**(extra or {}), "dev_fallback": True}
    row.failed = bool(error)
    row.error = error
    if url is not None:
        row.url = url
    if prompt is not None:
        row.prompt = prompt
    if prompt_source is not None:
        row.prompt_source = prompt_source
    if prompt_optimized is not None:
        row.prompt_optimized = prompt_optimized
    if extra:
        row.extra = {**(row.extra or {}), **extra}
    row.status = "warning" if dev_fallback else ("failed" if error else "ready")
    db.commit()
    db.refresh(row)
    # 生成被接受（成功且非 dev fallback）后记录引用资产的使用：
    # 每个 reference_asset_id 写一行 AssetUsage 并递增其 usage_count。
    if not error and not dev_fallback:
        reference_ids = (extra or {}).get("reference_asset_ids") or (row.extra or {}).get("reference_asset_ids")
        if reference_ids:
            record_asset_usage(
                db,
                project_id=row.project_id,
                asset_ids=list(reference_ids),
                consumer_type="media_asset",
                consumer_id=row.id,
                role=row.kind,
            )
    return _asset_dict(row)
