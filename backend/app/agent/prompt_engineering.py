"""Single prompt-engineering boundary for all media generation."""
from __future__ import annotations

from typing import Any

from .tools.llm_tools import OptimizePromptTool
from .tools.base import ToolContext
from .rule_packs import RulePack, build_prompt_rule_context as _build_prompt_rule_context, get_rule_pack


def build_prompt_rule_context(rule_pack: RulePack, target: str) -> dict[str, Any]:
    """Expose rule-pack context at the prompt-engineering boundary."""
    return _build_prompt_rule_context(rule_pack, target)


async def optimize_generation_prompt(
    ctx: ToolContext,
    source_prompt: str,
    target: str,
    context: dict[str, Any] | None = None,
) -> tuple[str, str]:
    """Return the provider prompt and retain the descriptive source prompt."""
    source = str(source_prompt or "").strip()
    if not source:
        raise ValueError("media generation requires a source description")
    if not ctx.llm_client:
        raise RuntimeError("prompt optimization requires an LLM capability binding")
    merged_context: dict[str, Any] = dict(context or {})
    profile = getattr(ctx, "task_profile", None)
    rule_pack_id = None
    if isinstance(profile, dict):
        rule_pack_id = profile.get("rule_pack_id")
        if profile and "task_profile" not in merged_context:
            merged_context["task_profile"] = profile
    else:
        rule_pack_id = getattr(profile, "rule_pack_id", None)
        if profile is not None and "task_profile" not in merged_context:
            try:
                merged_context["task_profile"] = profile.model_dump(mode="json")
            except Exception:
                merged_context["task_profile"] = {
                    key: getattr(profile, key)
                    for key in ("task_type", "input_mode", "source_kind", "rule_pack_id")
                    if getattr(profile, key, None) is not None
                }
    if rule_pack_id and "rule_pack_context" not in merged_context:
        merged_context["rule_pack_context"] = _build_prompt_rule_context(get_rule_pack(rule_pack_id), target)
    ctx.emit_event("prompt_optimization_started", {"target": target, "source_prompt": source})
    result = await OptimizePromptTool().execute(ctx, {
        "prompt": source,
        "target": target,
        "context": merged_context,
    })
    optimized = str(result.get("optimized") or "").strip()
    if not optimized:
        raise RuntimeError("prompt optimization returned an empty prompt")
    ctx.emit_event("prompt_optimization_finished", {
        "target": target,
        "source_prompt": source,
        "optimized_prompt": optimized,
    })
    return optimized, source


def collect_storyboard_reference_asset_ids(params: dict, artifacts: dict | None = None) -> list[str]:
    """Collect scene, character, prop and explicit asset IDs in stable order."""
    candidates: list[Any] = list(params.get("reference_asset_ids") or [])
    scene = params.get("scene")
    candidates.extend([params.get("scene_asset_id"), scene.get("asset_id") if isinstance(scene, dict) else None])
    for key in ("characters", "props"):
        for item in params.get(key) or []:
            if isinstance(item, dict):
                candidates.append(item.get("asset_id") or item.get("reference_asset_id"))
    # The planner often knows an asset by name before it knows its id. Resolve
    # those names against the current task's artifact memory so storyboard
    # generation remains consistent even when the model omits explicit IDs.
    if artifacts:
        wanted = {
            str(item.get("name") or "").strip()
            for key in ("characters", "props")
            for item in (params.get(key) or [])
            if isinstance(item, dict) and item.get("name")
        }
        shot = params.get("shot") or {}
        if isinstance(shot, dict) and shot.get("scene"):
            wanted.add(str(shot["scene"]).strip())
        for bucket in artifacts.values():
            for asset in bucket if isinstance(bucket, list) else []:
                if isinstance(asset, dict) and str(asset.get("name") or asset.get("title") or "").strip() in wanted:
                    candidates.append(asset.get("id"))
    seen: set[str] = set()
    result: list[str] = []
    for value in candidates:
        value = str(value).strip() if value else ""
        if value and value not in seen:
            seen.add(value)
            result.append(value)
    return result
