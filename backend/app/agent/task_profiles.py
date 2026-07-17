"""Deterministic task profiling for the Agent orchestration boundary."""
from __future__ import annotations

import re
from typing import Literal

from pydantic import BaseModel, Field


TaskType = Literal["drama_short", "documentary", "promotion", "commercial", "custom"]


class TaskProfile(BaseModel):
    task_type: TaskType
    input_mode: str
    source_kind: str
    script_required: bool
    needs_clarification: bool
    deliverables: list[str] = Field(default_factory=list)
    asset_strategy: str
    confidence: float = 0.0
    missing_inputs: list[str] = Field(default_factory=list)
    rule_pack_id: str


def _text(user_goal: str, parsed_goal: dict | None) -> str:
    values = [user_goal or ""]
    if parsed_goal:
        values.extend(str(value) for value in parsed_goal.values())
    return " ".join(values).lower()


def _has_source(parsed_goal: dict | None, keys: tuple[str, ...]) -> bool:
    if not parsed_goal:
        return False
    return any(parsed_goal.get(key) for key in keys)


def _has_asset_kind(project_assets: list[dict], kinds: set[str]) -> bool:
    return any(
        isinstance(asset, dict) and str(asset.get("asset_kind") or asset.get("kind") or "").lower() in kinds
        for asset in project_assets or []
    )


def _is_upload_only_request(text: str) -> bool:
    normalized = re.sub(r"\s+", " ", text.strip().lower())
    return any(
        phrase in normalized
        for phrase in (
            "use the uploaded files only",
            "use uploaded files only",
            "use these files only",
            "use the files only",
            "only use these files",
            "only use the uploaded files",
            "仅使用这些文件",
            "只使用这些文件",
            "只用这些文件",
            "仅使用上传的文件",
            "只使用上传的文件",
            "只用上传的文件",
            "仅根据这些文件",
        )
    )


# 单一资产生成意图的关键词映射。
# 当用户目标只要求生成某类资产（如"给我画一个赛博朋克女主角角色图"），
# 不需要走 drama_short 的 script → storyboard → video 全流程，
# 直接允许 agent 调用对应的 generate_* 工具。
# key: deliverable 名称（与 TaskProfile.deliverables 对齐）
# keywords: 触发该 deliverable 的中英文关键词
_SINGLE_ASSET_KEYWORDS: dict[str, tuple[str, ...]] = {
    "character": (
        "角色图", "角色设计", "角色卡", "人物图", "人物设计", "角色立绘", "角色 portrait",
        "character portrait", "character design", "character sheet", "character image",
        "角色形象", "角色画", "画个角色", "画一个角色", "生成角色", "生成一个角色",
    ),
    "scene": (
        "场景图", "场景设计", "场景概念图", "场景画", "scene image", "scene concept",
        "scene design", "环境图", "背景图", "生成场景", "画一个场景",
    ),
    "prop": (
        "道具图", "道具设计", "物品图", "prop image", "prop design", "生成道具",
    ),
    "storyboard": (
        "分镜图", "分镜画", "storyboard image", "storyboard frame", "生成分镜",
    ),
}


def _detect_single_asset_intent(text: str) -> list[str]:
    """检测用户目标是否只要求生成单一类型的资产。

    返回匹配到的 deliverable 列表（通常为 1 项）。空列表表示不是单一资产意图。
    用于绕过 drama_short 全流程的 script gate，让 agent 直接生成所需资产。
    """
    normalized = text.lower()
    matched: list[str] = []
    for deliverable, keywords in _SINGLE_ASSET_KEYWORDS.items():
        if any(kw.lower() in normalized for kw in keywords):
            matched.append(deliverable)
    return matched


def classify_task(user_goal: str, parsed_goal: dict | None, project_assets: list[dict]) -> TaskProfile:
    """Classify a goal without network/provider calls or mutable state."""
    text = _text(user_goal, parsed_goal)
    asset_count = len(project_assets or [])

    # 单一资产生成意图检测：用户只要求生成角色图/场景图/道具图等，
    # 不需要走 drama_short 的 script → storyboard → video 全流程。
    # 这种任务直接允许 agent 调用对应的 generate_* 工具，不要求 script source。
    single_asset_deliverables = _detect_single_asset_intent(text)
    if single_asset_deliverables and not any(
        word in text for word in ("drama", "短剧", "剧情", "script", "脚本", "剧本", "视频", "video")
    ):
        return TaskProfile(
            task_type="custom",
            input_mode="single_asset",
            source_kind="topic",
            script_required=False,
            needs_clarification=False,
            deliverables=single_asset_deliverables,
            asset_strategy="request or create required assets",
            confidence=0.85,
            missing_inputs=[],
            rule_pack_id="custom.v1",
        )

    has_script = _has_source(parsed_goal, ("script", "screenplay", "script_text")) or any(
        isinstance(asset, dict) and asset.get("asset_kind") == "script" for asset in project_assets or []
    )
    has_outline = _has_source(parsed_goal, ("outline", "facts", "research", "interviews"))
    has_brief = _has_source(parsed_goal, ("brief", "campaign", "audience", "call_to_action")) or _has_asset_kind(
        project_assets, {"promotion_brief", "brief"}
    )
    has_product = _has_source(parsed_goal, ("product", "product_info", "features", "offer")) or _has_asset_kind(
        project_assets, {"product", "product_info", "commercial_brief"}
    )

    if any(word in text for word in ("documentary", "documentary", "纪录片", "采访", "research")):
        task_type: TaskType = "documentary"
    elif any(word in text for word in ("promotion", "promote", "campaign", "宣传", "推广")):
        task_type = "promotion"
    elif any(word in text for word in ("commercial", "advert", " ad ", "广告", "product")):
        task_type = "commercial"
    elif any(word in text for word in ("drama", "short film", "short drama", "\u77ed\u5267", "\u5267\u60c5", "\u529f\u592b", "鍔熷か")):
        task_type = "drama_short"
    else:
        task_type = "custom"

    if asset_count and _is_upload_only_request(text) and not parsed_goal:
        input_mode = "upload_only"
    elif has_script and asset_count:
        input_mode = "mixed"
    elif has_script:
        input_mode = "complete_script"
    elif task_type == "documentary" and has_outline:
        input_mode = "documentary_outline"
    elif task_type == "promotion" and has_brief:
        input_mode = "promotion_brief"
    elif task_type == "commercial" and has_product:
        input_mode = "product_info"
    elif task_type == "custom" and (parsed_goal or asset_count):
        input_mode = "custom"
    else:
        input_mode = "topic_only"

    script_required = task_type in {"drama_short", "documentary"}
    missing: list[str] = []
    if script_required and not has_script:
        missing.append("script")
    if task_type == "documentary" and not (has_outline or has_script):
        missing.append("facts_or_outline")
    if task_type == "promotion" and not has_brief:
        missing.append("promotion_brief")
    if task_type == "commercial" and not has_product:
        missing.append("product_information")
    if task_type == "custom" and input_mode == "topic_only":
        missing.append("structured_source")

    deliverables = {
        "drama_short": ["script", "storyboard", "video"],
        "documentary": ["research_summary", "script", "storyboard", "video"],
        "promotion": ["campaign_brief", "storyboard", "promotional_video"],
        "commercial": ["commercial_script", "storyboard", "commercial_video"],
        "custom": ["agreed_deliverables"],
    }[task_type]
    source_kind = {
        "complete_script": "script",
        "documentary_outline": "outline_and_facts",
        "promotion_brief": "promotion_brief",
        "product_info": "product_information",
        "upload_only": "uploaded_assets",
        "mixed": "script_and_uploaded_assets",
        "topic_only": "topic",
        "custom": "structured_custom_source",
    }.get(input_mode, "topic")
    confidence = 0.95 if task_type != "custom" else 0.55
    if input_mode == "topic_only":
        confidence -= 0.2
    return TaskProfile(
        task_type=task_type,
        input_mode=input_mode,
        source_kind=source_kind,
        script_required=script_required,
        needs_clarification=bool(missing),
        deliverables=deliverables,
        asset_strategy="reuse_inspected_assets; normalize before generation" if asset_count else "request or create required assets",
        confidence=max(0.0, confidence),
        missing_inputs=missing,
        rule_pack_id=f"{task_type}.v1",
    )
