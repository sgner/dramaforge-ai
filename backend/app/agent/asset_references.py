"""Project-scoped logical asset references used by media generation tools."""

from sqlalchemy.orm import Session

from .asset_intelligence import resolve_reference_assets


def resolve_asset_references(
    db: Session,
    project_id: str,
    asset_ids: list[str],
    *,
    media_kind: str,
) -> list[dict]:
    refs = resolve_reference_assets(db, project_id, asset_ids, role=media_kind)
    return [
        {
            "asset_id": item["asset_id"],
            "source_asset_id": item.get("source_asset_id"),
            "asset_kind": item.get("asset_kind"),
            "url": item.get("url"),
            # 原始上传图兜底参考（选中标准化衍生图时非 None）
            "fallback_url": item.get("fallback_url"),
        }
        for item in refs
    ]


def reference_urls_with_fallback(items: list[dict]) -> list[str]:
    """主参考 URL 在前，原始上传兜底 URL 在后，去重。"""
    urls: list[str] = []
    for item in items:
        url = item.get("url")
        if url and url not in urls:
            urls.append(url)
    for item in items:
        fallback = item.get("fallback_url")
        if fallback and fallback not in urls:
            urls.append(fallback)
    return urls


async def generate_with_reference_check(ctx, service, request):
    """调 service.generate；provider 不支持参考图时降级为无参考生成。

    降级时发 agent_notice 警告，并在 result.raw["unsupported_references"]
    标注结构化结果（provider/model/reason/reference_count），供 Agent
    在 ThoughtStream 中展示和后续重试决策。
    """
    unsupported = None
    checker = getattr(service, "check_reference_support", None)
    if callable(checker) and request.reference_urls:
        unsupported = checker(request)
    if unsupported:
        ctx.emit_event("agent_notice", {
            "level": "warning",
            "text": "当前模型不支持参考图，已降级为无参考生成",
            "unsupported_references": unsupported,
        })
        from dataclasses import replace
        request = replace(request, reference_urls=[])
    result = await service.generate(request)
    if unsupported:
        result.raw = {**(result.raw or {}), "unsupported_references": unsupported}
    return result
