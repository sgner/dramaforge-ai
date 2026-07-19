"""规划类工具：parse_user_goal / create_plan / ask_user。

职责：把用户原话变成结构化目标、把目标拆成可执行计划、必要时主动反问用户。
所有 LLM 调用都通过 ctx.llm_client 走，遵循 BaseTool 契约。
"""
from __future__ import annotations

import json
import re
from typing import Any

from .base import BaseTool, ToolContext, ToolParameter
from ..task_profiles import classify_task
from ..token_limits import DEEPSEEK_V4_PRO_MAX_OUTPUT_TOKENS


def _looks_like_source_text(text: str) -> bool:
    """识别用户是否提交了可供脚本解析的原始素材，而非一句主题。"""
    value = str(text or "").strip()
    if len(value) >= 80:
        return True
    if value.count("\n") >= 1:
        return True
    return sum(value.count(mark) for mark in ("。", "！", "？", ".", "!", "?")) >= 2 and len(value) >= 40


LONG_FORM_SOURCE_MIN_CHARS = 1000


def classify_source_maturity(text: str) -> str:
    """区分想法、梗概和可直接制稿的长篇故事素材。"""
    value = re.sub(r"\s+", "", str(text or ""))
    if len(value) < 80:
        return "idea"
    if len(value) < LONG_FORM_SOURCE_MIN_CHARS:
        return "synopsis"
    return "long_form_source"


# ========================
# 工具实现
# ========================

class ParseUserGoalTool(BaseTool):
    """把用户原话解析为结构化目标。"""

    name = "parse_user_goal"
    description = (
        "把用户原话（例如：我想做一个一分钟的现代都市短剧）解析为结构化目标："
        "title / genre / duration_sec / num_characters / summary。"
    )
    category = "planning"
    requires_approval = False
    estimated_cost_usd = 0.01
    estimated_time_sec = 3.0
    idempotent = True
    parameters = [
        # 命名用 user_text 而不是 user_input：
        # build_react_prompt 不会把 schema 全列给 LLM，LLM 会自然用 user_text
        # （与 ask_user 的 question 是同一类语义的"用户原话"）。
        # 这里同时兼容历史调用里的 user_input，避免破坏已有 LLM prompt 缓存。
        ToolParameter(
            name="user_text",
            type="string",
            description="用户原话，可能含主题 / 时长 / 风格 / 角色数量等线索。",
            required=True,
        ),
    ]

    async def validate(self, ctx: ToolContext, params: dict) -> str | None:
        # 兼容两种命名
        text = params.get("user_text") or params.get("user_input")
        if not text or not str(text).strip():
            return "user_text 不能为空"
        return None

    async def execute(self, ctx: ToolContext, params: dict) -> dict:
        if not ctx.llm_client:
            raise RuntimeError("parse_user_goal 需要 ctx.llm_client")
        # 兼容旧字段名
        text = params.get("user_text") or params.get("user_input")
        messages = [
            {"role": "system", "content": PARSE_GOAL_SYSTEM_PROMPT},
            {"role": "user", "content": str(text)},
        ]
        resp = await ctx.llm_client.generate(messages, temperature=0.4, max_tokens=DEEPSEEK_V4_PRO_MAX_OUTPUT_TOKENS)
        result = _coerce_json(resp.content) or {}
        # summary 只是规划信息，不能成为后续 generate_script 的素材来源。
        # 保留原文供 runtime 在工具边界处强制回填，避免模型把摘要当小说。
        if _looks_like_source_text(str(text)):
            result.setdefault("source_text", str(text).strip())
            result.setdefault("source_maturity", classify_source_maturity(str(text)))
        else:
            result.setdefault("source_maturity", "idea")
        profile = classify_task(str(text), result, [])
        result.setdefault("task_profile", profile.model_dump(mode="json"))
        result.setdefault("rule_pack_id", profile.rule_pack_id)
        return result


class CreatePlanTool(BaseTool):
    """基于目标生成 5-10 步可执行计划。"""

    name = "create_plan"
    description = (
        "基于结构化的用户目标，生成 5-10 步执行计划（每步含 description / tool / depends_on）。"
        "返回 list[dict]，必须等用户审核通过才能继续。"
    )
    category = "planning"
    requires_approval = True
    estimated_cost_usd = 0.02
    estimated_time_sec = 5.0
    idempotent = True
    parameters = [
        ToolParameter(
            name="goal",
            type="object",
            description="parse_user_goal 输出的结构化目标 dict。",
            required=True,
        ),
        ToolParameter(
            name="available_tools",
            type="array",
            description="可选：限制可选工具列表（默认使用全部）。",
            required=False,
        ),
    ]

    async def validate(self, ctx: ToolContext, params: dict) -> str | None:
        if not params.get("goal") or not isinstance(params["goal"], dict):
            return "goal 必须是 dict"
        return None

    async def execute(self, ctx: ToolContext, params: dict) -> list[dict]:
        if not ctx.llm_client:
            raise RuntimeError("create_plan 需要 ctx.llm_client")
        available = params.get("available_tools")
        available_text = (
            "\n".join(f"- {name}" for name in available)
            if available
            else "- expand_story\n- generate_script\n- extract_characters\n- extract_props\n- extract_scenes\n- extract_shots\n- optimize_prompt\n- generate_character_portrait\n- generate_prop_image\n- generate_scene_image\n- generate_storyboard_image\n- generate_video\n- generate_voiceover\n- generate_bgm"
        )
        prompt = CREATE_PLAN_USER_PROMPT.format(
            goal=json.dumps(params["goal"], ensure_ascii=False),
            available=available_text,
        )
        messages = [
            {"role": "system", "content": CREATE_PLAN_SYSTEM_PROMPT},
            {"role": "user", "content": prompt},
        ]
        resp = await ctx.llm_client.generate(messages, temperature=0.4, max_tokens=DEEPSEEK_V4_PRO_MAX_OUTPUT_TOKENS)
        data = _coerce_json(resp.content) or {}
        return list(data.get("steps", []))


class AskUserTool(BaseTool):
    """Agent 主动向用户提问（暂停 ReAct 循环）。"""

    name = "ask_user"
    description = (
        "当必须让用户决策时（澄清目标 / 选择方向 / 确认高成本操作），"
        "调用此工具。runtime 会暂停并推送 request_user_input 事件。\n"
        "**重要**：\n"
        "- `question` 字段只写问题本身，不要包含候选答案列表\n"
        "- 候选答案（如果有）必须放在 `options` 数组里（每项是 string）\n"
        "- 如果用户只能自由回答，`options` 留空数组 []"
    )
    category = "planning"
    requires_approval = False
    estimated_cost_usd = 0.0
    estimated_time_sec = 0.0
    idempotent = True
    parameters = [
        ToolParameter(
            name="question",
            type="string",
            description="要问用户的问题，必须明确无歧义。",
            required=True,
        ),
        ToolParameter(
            name="options",
            type="array",
            description="可选：候选答案列表（空 = 自由回答）。",
            required=False,
            default=list,
        ),
        ToolParameter(
            name="context",
            type="object",
            description="可选：上下文摘要，前端展示用。",
            required=False,
        ),
        ToolParameter(name="selection_mode", type="string", description="single/multiple/confirm/text", required=False),
        ToolParameter(name="allow_custom", type="boolean", description="是否允许补充文本", required=False),
        ToolParameter(name="min_selections", type="number", description="最少选择数量", required=False),
        ToolParameter(name="max_selections", type="number", description="最多选择数量", required=False),
    ]

    async def validate(self, ctx: ToolContext, params: dict) -> str | None:
        if not params.get("question") or not str(params["question"]).strip():
            return "question 不能为空"
        return None

    async def execute(self, ctx: ToolContext, params: dict) -> dict:
        question = params["question"]
        options = params.get("options") or []
        selection_mode = params.get("selection_mode") or infer_selection_mode(question, bool(options))
        min_selections = params.get("min_selections")
        if min_selections is None and selection_mode == "multiple":
            min_selections = infer_min_selections(question)
        return {
            "type": "ask_user",
            "question": question,
            "options": options,
            "context": params.get("context") or {},
            "selection_mode": selection_mode,
            "allow_custom": bool(params.get("allow_custom", False)),
            "min_selections": min_selections,
            "max_selections": params.get("max_selections"),
        }


def infer_selection_mode(question: str, has_options: bool) -> str:
    if not has_options:
        return "text"
    return "multiple" if any(marker in question for marker in ("至少选择", "最少选择", "可多选", "多选")) else "single"


def infer_min_selections(question: str) -> int:
    import re

    match = re.search(r"(?:至少|最少)选择[^。！？\n]{0,30}?([一二两三四五六七八九十\d]+)\s*项", question)
    if not match:
        return 1
    return {
        "一": 1, "二": 2, "两": 2, "三": 3, "四": 4, "五": 5,
        "六": 6, "七": 7, "八": 8, "九": 9, "十": 10,
    }.get(match.group(1), int(match.group(1)) if match.group(1).isdigit() else 1)


# ========================
# Prompt 模板
# ========================

PARSE_GOAL_SYSTEM_PROMPT = """你是 DramaForge 需求分析师，把用户原话转成结构化 JSON。

输出格式（严格 JSON，禁止任何额外文字）：
{
  "title": "短剧标题",
  "genre": "现代都市|古风仙侠|悬疑|科幻|校园|家庭|其他",
  "duration_sec": 60,
  "num_characters": 3,
  "summary": "一句话剧情",
  "tone": "温馨|紧张|搞笑|悲伤|史诗",
  "target_audience": "受众画像"
}

未提供字段使用合理默认值。仅输出 JSON。"""


CREATE_PLAN_SYSTEM_PROMPT = """你是 DramaForge 制作经理，把目标拆成 5-10 步可执行计划。

每步必须是单个工具调用，工具列表见用户消息。

输出格式（严格 JSON）：
{
  "steps": [
    {"description": "用一句话说明此步要做什么", "tool": "工具名", "depends_on": []}
  ]
}

约束：
- drama_short 完整短剧（与 canvas "起始节点" / PipelineNode 流水线一致），按下面顺序：
    1) parse_user_goal
    2) expand_story —— 想法或简单梗概先扩写为至少 1000 字的完整故事正文
    3) generate_script —— 用完整故事正文或用户提供的长篇原文拆成分场脚本
    4) extract_characters —— 从脚本产物提取角色
    5) generate_character_portrait —— 给每个角色生成肖像（depends_on=extract_characters）
    6) extract_props —— 从脚本产物提取道具
    7) generate_prop_image —— 给每个道具生成图（depends_on=extract_props）
    8) extract_scenes —— 从脚本产物提取场景
    9) generate_scene_image —— 给每个场景生成图（depends_on=extract_scenes）
    10) extract_shots —— 从脚本产物提取分镜
    11) generate_storyboard_image —— 给每个分镜生成图（depends_on=extract_shots）
    12) generate_video —— 把分镜合成为视频
  强约束：脚本 → 提取 → 生成图（generate_script 之后才能 extract_characters / extract_props / extract_scenes / extract_shots；每个 generate_*_image 必须 depends_on 对应的 extract_*）；禁止跳过中间步骤，禁止乱序。
- drama_short 输入来源：起始节点 / PipelineNode 输入文本 / 之前对话里的 long_text 都算 source；user_goal 只有在明确包含故事想法时才可作为 expand_story 的 idea。
  idea 或简单梗概必须先 expand_story；只有达到长篇正文标准的素材才能 generate_script。禁止把 summary 直接当脚本素材。
  单一资产（如只要角色图）直接调 generate_*_image，不走脚本。
- 资产生成（image/video/audio）放最后
- 不需要 finish_task（runtime 会在所有步骤完成后自动结束）
- 仅输出 JSON"""


CREATE_PLAN_USER_PROMPT = """【目标】
{goal}

【可用工具】
{available}

请生成计划。"""


# ========================
# 工具内辅助
# ========================

def _extract_json_value(text: str | None) -> Any | None:
    """从 LLM 输出中提取第一个完整 JSON 对象/数组。

    模型有时会在 JSON 前后追加解释或 markdown。不能用非贪婪正则匹配
    大括号，因为 action.params 等嵌套对象会在内部提前闭合。
    """
    if not text:
        return None
    s = text.strip()
    try:
        return json.loads(s)
    except json.JSONDecodeError:
        pass

    for start, char in enumerate(s):
        if char not in "[{":
            continue
        pairs = {"{": "}", "[": "]"}
        stack: list[str] = []
        in_string = False
        escaped = False
        for index in range(start, len(s)):
            current = s[index]
            if in_string:
                if escaped:
                    escaped = False
                elif current == "\\":
                    escaped = True
                elif current == '"':
                    in_string = False
                continue
            if current == '"':
                in_string = True
            elif current in "[{":
                stack.append(pairs[current])
            elif current in "]}":
                if not stack or current != stack[-1]:
                    break
                stack.pop()
                if not stack:
                    try:
                        return json.loads(s[start:index + 1])
                    except json.JSONDecodeError:
                        break
    return None


def _coerce_json(text: str | None) -> dict | None:
    """宽松解析 LLM 输出，返回顶层 JSON 对象。"""
    value = _extract_json_value(text)
    if isinstance(value, dict):
        return value
    return None
