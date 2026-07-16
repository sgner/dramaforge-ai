"""LLM 类工具：generate_script / extract_characters / extract_props / extract_scenes / extract_shots / optimize_prompt。

所有工具都通过 ctx.llm_client 调用 LLM，把小说/脚本拆成结构化资产。
"""
from __future__ import annotations

import json
from typing import Any

from .base import BaseTool, ToolContext, ToolParameter
from .planning import _coerce_json
from ..specs import get_spec_for_tool


# ========================
# generate_script
# ========================

class GenerateScriptTool(BaseTool):
    """把小说原文拆成分场脚本。"""

    name = "generate_script"
    description = (
        "把用户的小说/原文按场景拆解为分场脚本。"
        "输出 scenes 列表，每场含 index/title/location/dialogue/duration_sec。"
    )
    category = "llm"
    requires_approval = False
    estimated_cost_usd = 0.05
    estimated_time_sec = 8.0
    idempotent = True
    parameters = [
        ToolParameter(
            name="novel_text",
            type="string",
            description="小说/原文。",
            required=True,
        ),
        ToolParameter(
            name="goal",
            type="object",
            description="parse_user_goal 输出的结构化目标（含 duration_sec 等约束）。",
            required=False,
        ),
    ]

    async def validate(self, ctx: ToolContext, params: dict) -> str | None:
        if not params.get("novel_text") or not str(params["novel_text"]).strip():
            return "novel_text 不能为空"
        return None

    async def execute(self, ctx: ToolContext, params: dict) -> dict:
        if not ctx.llm_client:
            raise RuntimeError("generate_script 需要 ctx.llm_client")
        system_prompt = GENERATE_SCRIPT_SYSTEM_PROMPT
        spec = get_spec_for_tool("generate_script")
        if spec:
            system_prompt = system_prompt + "\n\n【项目规范】\n" + spec
        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": _format_goal(params) + "\n\n【小说】\n" + str(params["novel_text"])},
        ]
        resp = await ctx.generate_llm(messages, temperature=0.6, max_tokens=4000)
        data = _coerce_json(resp.content) or {}
        if "scenes" not in data:
            data = {"scenes": []}
        return data


# ========================
# extract_characters
# ========================

class ExtractCharactersTool(BaseTool):
    """从脚本中提取角色。"""

    name = "extract_characters"
    description = "从脚本中提取所有角色（主角/配角/路人）。"
    category = "llm"
    requires_approval = False
    estimated_cost_usd = 0.03
    estimated_time_sec = 5.0
    idempotent = True
    parameters = [
        ToolParameter(
            name="script",
            type="object",
            description="generate_script 输出的脚本。",
            required=True,
        ),
        ToolParameter(
            name="goal",
            type="object",
            description="可选：参考目标。",
            required=False,
        ),
    ]

    async def validate(self, ctx: ToolContext, params: dict) -> str | None:
        if not isinstance(params.get("script"), dict):
            return "script 必须是 dict"
        return None

    async def execute(self, ctx: ToolContext, params: dict) -> dict:
        if not ctx.llm_client:
            raise RuntimeError("extract_characters 需要 ctx.llm_client")
        system_prompt = EXTRACT_CHARACTERS_SYSTEM_PROMPT
        spec = get_spec_for_tool("extract_characters")
        if spec:
            system_prompt = system_prompt + "\n\n【项目规范】\n" + spec
        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": "【脚本】\n" + json.dumps(params["script"], ensure_ascii=False)},
        ]
        resp = await ctx.generate_llm(messages, temperature=0.4, max_tokens=2000)
        data = _coerce_json(resp.content) or {}
        return {"characters": data.get("characters", [])}


# ========================
# extract_props
# ========================

class ExtractPropsTool(BaseTool):
    """从脚本中提取关键道具。"""

    name = "extract_props"
    description = "从脚本中提取关键道具（物品）。"
    category = "llm"
    requires_approval = False
    estimated_cost_usd = 0.02
    estimated_time_sec = 4.0
    idempotent = True
    parameters = [
        ToolParameter(
            name="script",
            type="object",
            description="脚本。",
            required=True,
        ),
        ToolParameter(
            name="characters",
            type="array",
            description="可选：已知角色列表。",
            required=False,
        ),
    ]

    async def validate(self, ctx: ToolContext, params: dict) -> str | None:
        if not isinstance(params.get("script"), dict):
            return "script 必须是 dict"
        return None

    async def execute(self, ctx: ToolContext, params: dict) -> dict:
        if not ctx.llm_client:
            raise RuntimeError("extract_props 需要 ctx.llm_client")
        system_prompt = EXTRACT_PROPS_SYSTEM_PROMPT
        spec = get_spec_for_tool("extract_props")
        if spec:
            system_prompt = system_prompt + "\n\n【项目规范】\n" + spec
        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": "【脚本】\n" + json.dumps(params["script"], ensure_ascii=False)},
        ]
        resp = await ctx.generate_llm(messages, temperature=0.4, max_tokens=1500)
        data = _coerce_json(resp.content) or {}
        return {"props": data.get("props", [])}


# ========================
# extract_scenes
# ========================

class ExtractScenesTool(BaseTool):
    """从脚本中提取场景。"""

    name = "extract_scenes"
    description = "从脚本中提取所有拍摄场景（地点/时间/氛围）。"
    category = "llm"
    requires_approval = False
    estimated_cost_usd = 0.03
    estimated_time_sec = 5.0
    idempotent = True
    parameters = [
        ToolParameter(
            name="script",
            type="object",
            description="脚本。",
            required=True,
        ),
    ]

    async def validate(self, ctx: ToolContext, params: dict) -> str | None:
        if not isinstance(params.get("script"), dict):
            return "script 必须是 dict"
        return None

    async def execute(self, ctx: ToolContext, params: dict) -> dict:
        if not ctx.llm_client:
            raise RuntimeError("extract_scenes 需要 ctx.llm_client")
        system_prompt = EXTRACT_SCENES_SYSTEM_PROMPT
        spec = get_spec_for_tool("extract_scenes")
        if spec:
            system_prompt = system_prompt + "\n\n【项目规范】\n" + spec
        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": "【脚本】\n" + json.dumps(params["script"], ensure_ascii=False)},
        ]
        resp = await ctx.generate_llm(messages, temperature=0.4, max_tokens=2000)
        data = _coerce_json(resp.content) or {}
        return {"scenes": data.get("scenes", [])}


# ========================
# extract_shots
# ========================

class ExtractShotsTool(BaseTool):
    """基于场景+脚本拆出分镜。"""

    name = "extract_shots"
    description = "基于脚本+场景列表，拆出分镜（shot）：每个分镜含 scene/index/duration_sec/camera/action/dialogue。"
    category = "llm"
    requires_approval = False
    estimated_cost_usd = 0.05
    estimated_time_sec = 8.0
    idempotent = True
    parameters = [
        ToolParameter(
            name="script",
            type="object",
            description="脚本。",
            required=True,
        ),
        ToolParameter(
            name="scenes",
            type="array",
            description="extract_scenes 输出的场景列表。",
            required=True,
        ),
    ]

    async def validate(self, ctx: ToolContext, params: dict) -> str | None:
        if not isinstance(params.get("script"), dict):
            return "script 必须是 dict"
        if not isinstance(params.get("scenes"), list):
            return "scenes 必须是 list"
        return None

    async def execute(self, ctx: ToolContext, params: dict) -> dict:
        if not ctx.llm_client:
            raise RuntimeError("extract_shots 需要 ctx.llm_client")
        system_prompt = EXTRACT_SHOTS_SYSTEM_PROMPT
        spec = get_spec_for_tool("extract_shots")
        if spec:
            system_prompt = system_prompt + "\n\n【项目规范】\n" + spec
        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": (
                "【脚本】\n" + json.dumps(params["script"], ensure_ascii=False)
                + "\n\n【场景】\n" + json.dumps(params["scenes"], ensure_ascii=False)
            )},
        ]
        resp = await ctx.generate_llm(messages, temperature=0.5, max_tokens=4000)
        data = _coerce_json(resp.content) or {}
        return {"shots": data.get("shots", [])}


# ========================
# optimize_prompt
# ========================

class OptimizePromptTool(BaseTool):
    """把粗略 prompt 改写为适合图像/视频生成的细 prompt。"""

    name = "optimize_prompt"
    description = "把用户给的粗略 prompt 改写为适合图像/视频生成的细节 prompt（电影感 / 镜头语言 / 风格词）。"
    category = "llm"
    requires_approval = False
    estimated_cost_usd = 0.01
    estimated_time_sec = 2.0
    idempotent = True
    parameters = [
        ToolParameter(
            name="prompt",
            type="string",
            description="原始 prompt。",
            required=True,
        ),
        ToolParameter(
            name="target",
            type="string",
            description="目标媒介：image | video | audio。",
            required=False,
            default="image",
            enum=["image", "video", "audio"],
        ),
        ToolParameter(
            name="context",
            type="object",
            description="可选：上下文（如角色名/场景名/风格）。",
            required=False,
        ),
    ]

    async def validate(self, ctx: ToolContext, params: dict) -> str | None:
        if not params.get("prompt") or not str(params["prompt"]).strip():
            return "prompt 不能为空"
        return None

    async def execute(self, ctx: ToolContext, params: dict) -> dict:
        if not ctx.llm_client:
            raise RuntimeError("optimize_prompt 需要 ctx.llm_client")
        target = params.get("target") or "image"
        system_prompt = OPTIMIZE_PROMPT_SYSTEM_PROMPT.format(target=target)
        spec = get_spec_for_tool("optimize_prompt")
        if spec:
            system_prompt = system_prompt + "\n\n【项目规范】\n" + spec
        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": (
                "【原始 prompt】\n" + str(params["prompt"])
                + ("\n\n【上下文】\n" + json.dumps(params["context"], ensure_ascii=False) if params.get("context") else "")
            )},
        ]
        # Use a complete response here. Some OpenAI-compatible providers
        # acknowledge streaming requests but emit no usable data chunks,
        # which would turn every optimized prompt into an empty string.
        resp = await ctx.llm_client.generate(messages, temperature=0.7, max_tokens=800)
        optimized = (resp.content or "").strip()
        # 去掉可能的引号
        if optimized.startswith('"') and optimized.endswith('"'):
            optimized = optimized[1:-1]
        if not optimized:
            raise RuntimeError("prompt optimization returned an empty prompt")
        return {"optimized": optimized, "target": target}


# ========================
# Prompt 模板
# ========================

GENERATE_SCRIPT_SYSTEM_PROMPT = """你是 DramaForge 编剧，把小说原文拆为分场脚本。

输出格式（严格 JSON）：
{
  "scenes": [
    {
      "index": 1,
      "title": "场景标题",
      "location": "地点",
      "time": "白天|夜晚|黄昏|清晨",
      "characters": ["角色A", "角色B"],
      "dialogue": "对话内容（多行用 \\\\n）",
      "description": "动作/画面描述",
      "duration_sec": 30
    }
  ]
}

约束：
- 总时长尽量贴合用户的 duration_sec
- 每场 20-60 秒
- 仅输出 JSON"""


EXTRACT_CHARACTERS_SYSTEM_PROMPT = """你是 DramaForge 角色分析师，从脚本中提取所有出场角色。

输出格式（严格 JSON）：
{
  "characters": [
    {"name": "角色名", "role": "主角|配角|路人", "gender": "男|女|其他", "age": 25, "appearance": "外貌描述", "personality": "性格"}
  ]
}

仅输出 JSON。"""


EXTRACT_PROPS_SYSTEM_PROMPT = """你是 DramaForge 道具师，从脚本中提取所有关键道具。

输出格式（严格 JSON）：
{
  "props": [
    {"name": "道具名", "description": "外观/用途", "owner": "持有角色（可空）"}
  ]
}

约束：
- 只提取推动剧情的道具
- 普通背景物品不用列
- 仅输出 JSON"""


EXTRACT_SCENES_SYSTEM_PROMPT = """你是 DramaForge 美术指导，从脚本中提取所有拍摄场景。

输出格式（严格 JSON）：
{
  "scenes": [
    {"name": "场景名", "location": "地点", "time": "白天|夜晚|黄昏|清晨", "weather": "晴|雨|雪", "mood": "氛围词", "description": "环境细节"}
  ]
}

去重：同地点不同时间的算独立场景。仅输出 JSON。"""


EXTRACT_SHOTS_SYSTEM_PROMPT = """你是 DramaForge 摄影指导，把脚本按场景拆为分镜。

每个分镜 3-8 秒，总时长贴合场景。

输出格式（严格 JSON）：
{
  "shots": [
    {
      "scene": "场景名",
      "index": 1,
      "duration_sec": 5,
      "camera": "远景|全景|中景|近景|特写|航拍",
      "movement": "固定|推|拉|摇|移|跟",
      "action": "动作描述",
      "dialogue": "对白（可空）",
      "voice_tone": "语气（可空）"
    }
  ]
}

仅输出 JSON。"""


OPTIMIZE_PROMPT_SYSTEM_PROMPT = """你是 DramaForge 提示词工程师，擅长把粗略描述改写为适合 {target} 生成模型的细 prompt。

If the context contains `canonical_layout`, treat it as a hard constraint. Preserve its layout, views, identity consistency, background, and negative constraints verbatim; never replace or remove those requirements. Only add subject, action, camera, material, or lighting details around it.

要求：
- 用具体名词代替抽象词
- 加入镜头/光线/色调/风格关键词
- 用英文输出（生成模型普遍用英文 prompt）
- 直接输出 prompt 文本，不要 JSON 包裹"""


# ========================
# 工具内辅助
# ========================

def _format_goal(params: dict) -> str:
    goal = params.get("goal")
    if not goal:
        return ""
    return "【目标】\n" + json.dumps(goal, ensure_ascii=False)
