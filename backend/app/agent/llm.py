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
"""


def build_system_prompt() -> str:
    return REACT_SYSTEM_PROMPT


def build_react_prompt(
    user_goal: str,
    plan: list[dict],
    artifacts: dict,
    recent_steps: list[dict],
    tool_summaries: list[dict],
) -> str:
    """构造单步 ReAct prompt。"""
    parts = [REACT_SYSTEM_PROMPT]

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
