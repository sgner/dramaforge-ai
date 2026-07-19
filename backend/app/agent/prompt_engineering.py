"""Single prompt-engineering boundary for all media generation."""
from __future__ import annotations

import re
import hashlib
import json
from typing import Any

from .tools.llm_tools import OptimizePromptTool
from .tools.base import ToolContext
from .rule_packs import RulePack, build_prompt_rule_context as _build_prompt_rule_context, get_rule_pack


# ========================
# 防御 LLM 思考文本泄漏
# ========================
#
# 历史 bug：LLM 在 think 阶段会规划"最终输出应该是一个英文的细prompt..."
# 之类的话术（出现在 thought 字段的草稿里），并把这段规划文本塞进
# prop.description / scene.description / character.appearance / shot.action
# 等结构化字段。这些规划文本随后被 _build_*_prompt 原样塞进 source_prompt，
# 又被提示词优化步骤回写到 asset.prompt，导致画布节点显示"正在规划..."
# 而不是真实可用的提示词。
#
# 修复策略：sanitize_structured_field 在源头拒绝这类规划文本，仅保留
# LLM 提供的"实体数据"（name/age/gender/appearance/personality 等真实属性）。
# 这是 LLM 系统的"零信任"边界——不假设 LLM 会按规矩放字段。

# 规划文本模式：通常出现在文本开头（前 200 字符内），代表 LLM 自己在 think
# 而非描述实体。覆盖中英文常见变体。
_PLANNING_TEXT_PATTERNS: tuple[re.Pattern[str], ...] = (
    re.compile(r"^\s*最终输出"),
    re.compile(r"^\s*最终\s*prompt", re.IGNORECASE),
    re.compile(r"^\s*the\s+final\s+(output|prompt)", re.IGNORECASE),
    re.compile(r"^\s*final\s+(output|prompt)\s+should", re.IGNORECASE),
    re.compile(r"^\s*the\s+output\s+should", re.IGNORECASE),
    re.compile(r"^\s*output\s+should", re.IGNORECASE),
    re.compile(r"^\s*prompt\s+should", re.IGNORECASE),
    # 中段出现也判定为规划：列表式罗列字段名
    re.compile(r"包含[：:]\s*[^。]*?时代|包含[：:]\s*[^。]*?世界观|包含[：:]\s*[^。]*?构图|包含[：:]\s*[^。]*?画质"),
    re.compile(r"should\s+include\s*[:：]?\s*[^.]*?\bera\b", re.IGNORECASE),
    re.compile(r"should\s+include\s*[:：]?\s*[^.]*?\bcomposition\b", re.IGNORECASE),
    re.compile(r"should\s+include\s*[:：]?\s*[^.]*?\bquality\b", re.IGNORECASE),
    re.compile(r"final\s+prompt\s+will\s+be", re.IGNORECASE),
    re.compile(r"prompt\s+must\s+include", re.IGNORECASE),
    re.compile(r"i\s+will\s+create\s+a\s+prompt", re.IGNORECASE),
    re.compile(r"i\s+need\s+to\s+(write|generate)\s+a\s+prompt", re.IGNORECASE),
    # LLM 自由发挥的元说明
    re.compile(r"^\s*注[：:]\s*此[^。]*?为"),
    re.compile(r"^\s*备注[：:]\s*"),
)


def _looks_like_planning_text(text: str) -> bool:
    """检测字符串是否像 LLM 的规划/思考文本，而非实体描述。"""
    if not text:
        return False
    # 截取前 200 字符（规划文本通常在开头），但 also 检查全文已知规划短语
    head = text[:200]
    for pattern in _PLANNING_TEXT_PATTERNS:
        if pattern.search(head):
            return True
        if pattern.search(text):
            return True
    return False


def sanitize_structured_field(value: Any) -> str:
    """清洗 LLM 提供的结构化字段，拒绝规划文本。

    输入：prop.description / scene.description / character.appearance 等
    返回：原文本（若像实体描述）或空串（若像规划文本）。
    """
    if value is None:
        return ""
    text = str(value).strip()
    if not text:
        return ""
    if _looks_like_planning_text(text):
        return ""
    return text


def build_prompt_rule_context(rule_pack: RulePack, target: str) -> dict[str, Any]:
    """Expose rule-pack context at the prompt-engineering boundary."""
    return _build_prompt_rule_context(rule_pack, target)


def _script_visual_signature(ctx: ToolContext) -> dict[str, Any]:
    """Read the latest structured script visual signature from task artifacts."""
    artifacts = getattr(ctx, "artifacts", {}) or {}
    for item in reversed(artifacts.get("script", []) if isinstance(artifacts.get("script"), list) else []):
        if not isinstance(item, dict):
            continue
        extra = item.get("extra") if isinstance(item.get("extra"), dict) else {}
        script = extra.get("script") if isinstance(extra, dict) else None
        signature = script.get("visualSignature") if isinstance(script, dict) else None
        if not isinstance(signature, dict) or not signature:
            signature = item.get("visualSignature")
        if isinstance(signature, dict) and signature:
            return signature
    return {}


def visual_signature_id(signature: dict[str, Any]) -> str:
    """Return a stable short ID for one canonical visual signature."""
    canonical = json.dumps(signature or {}, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return "vs_" + hashlib.sha256(canonical.encode("utf-8")).hexdigest()[:16]


def _append_generation_hard_constraints(
    optimized: str,
    context: dict[str, Any],
) -> str:
    """Keep deterministic constraints in the prompt sent to the media model.

    The optimizer is allowed to improve wording, but it is not allowed to
    decide that a layout or continuity contract is optional.  In particular,
    a short optimizer response must not turn a V3.0 character sheet into a
    generic portrait.
    """
    prompt = str(optimized or "").strip()
    required: list[str] = []
    canonical_layout = context.get("canonical_layout")
    if isinstance(canonical_layout, str) and canonical_layout.strip():
        layout = canonical_layout.strip()
        if layout not in prompt:
            required.append(layout)

    signature = context.get("visual_signature")
    signature_id = context.get("visual_signature_id")
    if isinstance(signature, dict) and signature and signature_id:
        signature_text = json.dumps(signature, ensure_ascii=False, sort_keys=True)
        continuity = (
            f"Visual continuity anchor {signature_id}: {signature_text}. "
            "Preserve this visual style consistently across all generated assets. "
            "Do not replace the requested medium, lighting, color palette, texture, or cinematic language with another art style."
        )
        if str(signature_id) not in prompt:
            required.append(continuity)

    return prompt if not required else prompt + "\n\n" + "\n\n".join(required)


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
    signature = merged_context.get("visual_signature")
    if not isinstance(signature, dict) or not signature:
        signature = _script_visual_signature(ctx)
    if signature:
        merged_context["visual_signature"] = signature
        merged_context.setdefault("visual_signature_id", visual_signature_id(signature))
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
    optimized = _append_generation_hard_constraints(optimized, merged_context)
    ctx.emit_event("prompt_optimization_finished", {
        "target": target,
        "source_prompt": source,
        "optimized_prompt": optimized,
    })
    return optimized, source


def collect_storyboard_reference_asset_ids(params: dict, artifacts: dict | None = None) -> list[str]:
    """Collect scene, character, prop and explicit asset IDs in stable order."""
    candidates: list[Any] = list(params.get("reference_asset_ids") or [])
    shot = params.get("shot") if isinstance(params.get("shot"), dict) else {}
    # 脚本解析写入 shot 的 scene/characters/props 是默认映射；agent 在工具
    # 顶层显式传同名参数时覆盖默认值（包括显式空数组，表示移除该类引用）。
    scene = params.get("scene") if "scene" in params else shot.get("scene")
    characters = params.get("characters") if "characters" in params else (
        shot.get("characters") or shot.get("charactersInvolved") or []
    )
    props = params.get("props") if "props" in params else (
        shot.get("props") or shot.get("propsInvolved") or []
    )
    candidates.extend([params.get("scene_asset_id"), scene.get("asset_id") if isinstance(scene, dict) else None])
    for items in (characters or [], props or []):
        for item in items:
            if isinstance(item, dict):
                candidates.append(item.get("asset_id") or item.get("reference_asset_id"))
    # The planner often knows an asset by name before it knows its id. Resolve
    # those names against the current task's artifact memory so storyboard
    # generation remains consistent even when the model omits explicit IDs.
    if artifacts:
        scene_names = {
            str(value).strip() for value in (
                scene if isinstance(scene, str) else None,
                scene.get("name") if isinstance(scene, dict) else None,
                scene.get("title") if isinstance(scene, dict) else None,
                scene.get("location") if isinstance(scene, dict) else None,
            ) if value
        }
        def _names(items: Any) -> set[str]:
            return {
                str(item.get("name") if isinstance(item, dict) else item).strip()
                for item in (items or [])
                if (item.get("name") if isinstance(item, dict) else item)
            }
        role_names = {
            "character": _names(characters),
            "prop": _names(props),
            "scene": scene_names,
        }
        for role in ("scene", "character", "prop"):
            for asset in artifacts.get(role, []) if isinstance(artifacts.get(role), list) else []:
                if not isinstance(asset, dict) or not asset.get("id") or not asset.get("url"):
                    continue
                if asset.get("failed") or asset.get("generating"):
                    continue
                extra = asset.get("extra") if isinstance(asset.get("extra"), dict) else {}
                labels = {
                    str(value).strip() for value in (
                        asset.get("name"), asset.get("title"),
                        extra.get(role), extra.get("name"),
                    ) if value
                }
                if labels & role_names[role]:
                    candidates.append(asset["id"])
    seen: set[str] = set()
    result: list[str] = []
    for value in candidates:
        value = str(value).strip() if value else ""
        if value and value not in seen:
            seen.add(value)
            result.append(value)
    return result
