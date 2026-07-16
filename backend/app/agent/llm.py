"""LLM 客户端抽象 + ReAct Prompt 构造。

支持 OpenAI 兼容协议（OpenAI / DeepSeek / 火山引擎 Ark / ModelScope 等都兼容）。
"""
from __future__ import annotations

import json
import time
from dataclasses import dataclass, field
from typing import Any, Protocol


class LLMError(Exception):
    """LLM 调用错误。"""
    pass


@dataclass
class LLMResponse:
    """统一的 LLM 响应。"""
    content: str | None = None
    tool_name: str | None = None
    tool_args: dict | None = None
    model: str = ""
    prompt_tokens: int = 0
    completion_tokens: int = 0
    cost_usd: float = 0.0
    raw: Any = None

    @property
    def total_tokens(self) -> int:
        return self.prompt_tokens + self.completion_tokens


def _parse_function_call(raw: dict) -> tuple[str | None, dict | None, str | None]:
    """从 OpenAI 格式响应中解析 tool_call 或文本。

    Returns: (tool_name, tool_args, content)
    """
    try:
        msg = raw["choices"][0]["message"]
    except (KeyError, IndexError) as e:
        raise LLMError(f"Invalid LLM response shape: {e}")

    tool_calls = msg.get("tool_calls")
    if tool_calls:
        first = tool_calls[0]
        fn = first.get("function", {})
        name = fn.get("name")
        args_str = fn.get("arguments", "{}")
        if isinstance(args_str, dict):
            args = args_str
        else:
            try:
                args = json.loads(args_str)
            except json.JSONDecodeError as e:
                raise LLMError(f"Invalid function arguments JSON: {e}")
        return name, args, msg.get("content")

    return None, None, msg.get("content")


# ========================
# Prompt 构造
# ========================

REACT_SYSTEM_PROMPT = """你是 DramaForge Director Agent —— 一个拥有 20 年经验的短剧导演。

【你的工作方法】
1. 仔细阅读【当前状态】、【已生成资产】、【最近步骤】
2. 在 thought 中写出你接下来的思路（30-200 字，说人话，不要太学术）
3. 在 action 中调用一个工具，参数必须严格符合该工具的 schema
4. 如果用户必须参与决策（澄清目标 / 选择方向 / 确认高成本操作），调 ask_user 工具
5. 如果所有任务完成，调 finish_task 工具
6. 不要重复调同一个工具在相同输入上（避免死循环）

【输出格式（严格 JSON）】
{
  "thought": "我决定先...因为...",
  "action": {
    "tool": "工具名",
    "params": { ... }
  }
}

只输出 JSON，不要任何额外文字。

【项目规范】
生成资产时必须遵循项目规范。具体规范由各工具的系统提示词注入，以下是跨工具铁律：
- 角色卡只写主体角色，场景卡写场景+适配氛围人物，道具卡只写静物，三者严格隔离，禁止混用
- 所有材质必须可触摸：指定具体材质名+颜色+工艺+年代痕迹，禁止抽象描述
- 所有发型/服装/材质必须服从所在世界观，禁止穿越违和
- 所有提示词使用纯中文自然语言（生成模型 prompt 除外，用英文）
- 字数硬性范围：场景 400-600 / 角色 500-800 / 道具 200-400
"""


MEDIA_PARALLEL_POLICY = """
媒体调度硬规则：
- 如果当前目标需要生成两个或以上相互独立的图片/视频，必须优先调用 generate_media_batch，一次提交全部 jobs。
- 不要先调用单个 generate_* 工具再等失败后改用批量工具；这会造成串行等待和重复资产。
- 批量 jobs 必须为每项提供真实 prompt、kind(image/video)、name 和 asset_kind，主流程会立即创建生成中节点。
- 批量结果中某项失败时，不要停止其他项；继续主流程，并让 media-recovery worker 处理失败项。
"""

ASSET_INTELLIGENCE_POLICY = """
Asset intelligence policy:
- Before generating media, inspect every uploaded asset in the current project with inspect_asset.
- If an uploaded character, prop, or scene does not meet project standards, call prepare_character_asset before downstream generation.
- Reuse existing usable assets instead of regenerating them. Pass logical reference_asset_ids to media tools; never invent provider URLs.
- Prefer normalized derivatives over raw uploads while preserving the original source_asset_id relationship.
- If inspection or references need an unavailable capability, explain the blocker and ask the user; never silently use a legacy fallback.
"""


def build_system_prompt() -> str:
    return REACT_SYSTEM_PROMPT


def build_react_prompt(
    user_goal: str,
    plan: list[dict],
    artifacts: dict,
    recent_steps: list[dict],
    tool_summaries: list[dict],
    project_assets: list[dict] | None = None,
) -> str:
    """构造单步 ReAct prompt。"""
    parts = [REACT_SYSTEM_PROMPT, MEDIA_PARALLEL_POLICY, ASSET_INTELLIGENCE_POLICY]

    # 用户目标
    parts.append(f"【用户目标】\n{user_goal}")

    # 计划
    if plan:
        lines = []
        for i, p in enumerate(plan, 1):
            status = p.get("status", "pending")
            mark = {"pending": "[ ]", "in_progress": "[~]", "done": "[x]", "skipped": "[-]"}.get(status, "[ ]")
            lines.append(f"{mark} {i}. {p.get('description', p.get('tool', '?'))}")
        parts.append("【当前计划】\n" + "\n".join(lines))

    # 已生成资产
    if artifacts:
        artifacts_lines = []
        for kind, items in artifacts.items():
            if items:
                names = [str(x.get("name") or x.get("id") or x) for x in items[:5]]
                artifacts_lines.append(f"- {kind}: {len(items)} 个 ({', '.join(names)})")
        if artifacts_lines:
            parts.append("【已生成资产】\n" + "\n".join(artifacts_lines))

    # 最近步骤
    if project_assets:
        asset_lines = []
        for asset in project_assets[:30]:
            asset_lines.append(
                "- {id}: name={name}; origin={origin}; kind={kind}; inspection={inspection}".format(
                    id=asset.get("id", "?"),
                    name=asset.get("name") or asset.get("title") or "(unnamed)",
                    origin=asset.get("origin", "generated"),
                    kind=asset.get("asset_kind") or asset.get("kind") or "unknown",
                    inspection=asset.get("inspection_status", "pending"),
                )
            )
        parts.append("[CURRENT PROJECT ASSETS]\n" + "\n".join(asset_lines))

    if recent_steps:
        step_lines = []
        for s in recent_steps[-10:]:
            n = s.get("step_number", "?")
            thought = s.get("thought", "")
            action = s.get("action", {})
            tool = action.get("tool") if isinstance(action, dict) else None
            status = s.get("status", "?")
            observation = s.get("observation")
            observation_text = ""
            if observation:
                try:
                    observation_text = " | observation: " + json.dumps(
                        observation,
                        ensure_ascii=False,
                        default=str,
                    )[:4000]
                except (TypeError, ValueError):
                    observation_text = f" | observation: {str(observation)[:4000]}"
            step_lines.append(f"#{n} [{status}] {thought} → {tool}{observation_text}")
        parts.append("【最近步骤（最近 10 步）】\n" + "\n".join(step_lines))

    # 工具列表
    # 把每个工具的 name / description / parameters（参数名 + 类型 + 必填 + 说明）都列出来。
    # 否则 LLM 只能看到 name + description，会瞎猜参数名（如把 user_input 写成 user_text），
    # 工具 validate 失败 → 死循环。
    if tool_summaries:
        tool_lines: list[str] = []
        for t in tool_summaries:
            tool_lines.append(f"- {t['name']}: {t['description']}")
            params = t.get("parameters") or []
            for p in params:
                req = "必填" if p.get("required", True) else "可选"
                ptype = p.get("type", "string")
                pdesc = p.get("description", "")
                tool_lines.append(f"    · {p['name']} ({ptype}, {req}): {pdesc}")
        parts.append("【可用工具】\n" + "\n".join(tool_lines))

    return "\n\n".join(parts)


# ========================
# LLMClient Protocol
# ========================

class LLMClient(Protocol):
    """LLM 客户端协议。后端实现可以是 OpenAI / DeepSeek / 火山引擎 等。"""

    model: str

    async def generate(
        self,
        messages: list[dict],
        tools: list[dict] | None = None,
        temperature: float = 0.7,
        max_tokens: int = 4000,
    ) -> LLMResponse: ...

    async def generate_structured(
        self,
        messages: list[dict],
        json_schema: dict | None = None,
        temperature: float = 0.7,
        max_tokens: int = 4000,
    ) -> LLMResponse: ...
