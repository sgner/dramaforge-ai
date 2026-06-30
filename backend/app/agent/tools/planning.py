"""规划类工具：parse_user_goal / create_plan / ask_user。

职责：把用户原话变成结构化目标、把目标拆成可执行计划、必要时主动反问用户。
所有 LLM 调用都通过 ctx.llm_client 走，遵循 BaseTool 契约。
"""
from __future__ import annotations

import json
import re
from typing import Any

from .base import BaseTool, ToolContext, ToolParameter


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
        ToolParameter(
            name="user_input",
            type="string",
            description="用户原话，可能含主题 / 时长 / 风格 / 角色数量等线索。",
            required=True,
        ),
    ]

    async def validate(self, ctx: ToolContext, params: dict) -> str | None:
        if not params.get("user_input") or not str(params["user_input"]).strip():
            return "user_input 不能为空"
        return None

    async def execute(self, ctx: ToolContext, params: dict) -> dict:
        if not ctx.llm_client:
            raise RuntimeError("parse_user_goal 需要 ctx.llm_client")
        messages = [
            {"role": "system", "content": PARSE_GOAL_SYSTEM_PROMPT},
            {"role": "user", "content": str(params["user_input"])},
        ]
        resp = await ctx.llm_client.generate(messages, temperature=0.4, max_tokens=600)
        return _coerce_json(resp.content) or {}


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
            else "- generate_script\n- extract_characters\n- extract_props\n- extract_scenes\n- extract_shots\n- optimize_prompt\n- generate_character_portrait\n- generate_prop_image\n- generate_scene_image\n- generate_storyboard_image\n- generate_video\n- generate_voiceover\n- generate_bgm"
        )
        prompt = CREATE_PLAN_USER_PROMPT.format(
            goal=json.dumps(params["goal"], ensure_ascii=False),
            available=available_text,
        )
        messages = [
            {"role": "system", "content": CREATE_PLAN_SYSTEM_PROMPT},
            {"role": "user", "content": prompt},
        ]
        resp = await ctx.llm_client.generate(messages, temperature=0.4, max_tokens=2000)
        data = _coerce_json(resp.content) or {}
        return list(data.get("steps", []))


class AskUserTool(BaseTool):
    """Agent 主动向用户提问（暂停 ReAct 循环）。"""

    name = "ask_user"
    description = (
        "当必须让用户决策时（澄清目标 / 选择方向 / 确认高成本操作），"
        "调用此工具。runtime 会暂停并推送 request_user_input 事件。"
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
    ]

    async def validate(self, ctx: ToolContext, params: dict) -> str | None:
        if not params.get("question") or not str(params["question"]).strip():
            return "question 不能为空"
        return None

    async def execute(self, ctx: ToolContext, params: dict) -> dict:
        return {
            "type": "ask_user",
            "question": params["question"],
            "options": params.get("options") or [],
            "context": params.get("context") or {},
        }


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
- 第一步通常是 generate_script
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

def _coerce_json(text: str | None) -> dict | None:
    """宽松解析 LLM 输出。处理 markdown 代码块 + 顶层对象。"""
    if not text:
        return None
    s = text.strip()
    fence = re.search(r"```(?:json)?\s*(\{.*?\}|\[.*?\])\s*```", s, re.DOTALL)
    if fence:
        s = fence.group(1)
    try:
        return json.loads(s)
    except json.JSONDecodeError:
        # 尝试找第一个 { ... } 块
        m = re.search(r"\{.*\}", s, re.DOTALL)
        if m:
            try:
                return json.loads(m.group(0))
            except json.JSONDecodeError:
                pass
        return None
