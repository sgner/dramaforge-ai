"""Dev/Demo 模式下的 ScriptedLLM。

按预设剧本顺序返回 ReAct 决策和工具内 LLM 调用的内容，无需真实 LLM API key。

调用模式（call_count 顺序）：
- 偶数次：runtime.step 决策调用 → 返回 tool_call
- 奇数次：工具内 LLM.generate 调用 → 返回 content（JSON 字符串）

用于：
- 本地开发演示（无 API key 也能跑通 agent loop）
- e2e 集成测试（确定性）
- 端到端联调（验证前后端事件流）

v1.1 接入真实 provider 后，本类可作为 fallback。
"""
from __future__ import annotations

import json
from typing import Any

from .llm import LLMResponse


# 5 阶段剧本
_PLAN_STEPS = [
    {"step": 1, "tool": "generate_script", "description": "基于用户目标生成短剧剧本", "status": "in_progress"},
    {"step": 2, "tool": "extract_characters", "description": "提取角色（主角/配角/路人）", "status": "pending"},
    {"step": 3, "tool": "extract_scenes", "description": "拆解剧本为场景", "status": "pending"},
    {"step": 4, "tool": "extract_shots", "description": "把每个场景拆为分镜", "status": "pending"},
    {"step": 5, "tool": "finish_task", "description": "汇总并结束", "status": "pending"},
]

_FAKE_SCRIPT = {
    "title": "短片 demo",
    "synopsis": "Demo 演示剧本，验证 agent 全流程。",
    "scenes": [
        {"index": 1, "title": "开场", "location": "城市街道", "dialogue": "主角登场。", "duration_sec": 5},
        {"index": 2, "title": "冲突", "location": "咖啡店", "dialogue": "陌生人相遇。", "duration_sec": 8},
    ],
}

_FAKE_CHARACTERS = [
    {"name": "林尘", "age": 22, "personality": "沉默寡言", "appearance": "黑发，眼神锐利", "role": "主角"},
    {"name": "陌生女孩", "age": 20, "personality": "活泼好奇", "appearance": "短发，笑容温暖", "role": "配角"},
]

_FAKE_SCENES = [
    {"index": 1, "name": "雨夜街道", "description": "霓虹灯反光的湿漉漉街道", "atmosphere": "潮湿冷清"},
]

_FAKE_SHOTS = [
    {
        "index": 1,
        "scene": "雨夜街道",
        "action": "林尘独自走在街上",
        "camera": "中景",
        "duration_sec": 5,
    },
]


def _goal_payload(user_goal: str) -> dict:
    """构造 parse_user_goal / create_plan 的 goal 输入。"""
    return {
        "title": user_goal or "未命名短片",
        "genre": "drama",
        "duration_sec": 30,
        "num_characters": 2,
        "summary": user_goal or "Demo 演示",
    }


class DevScriptedLLM:
    """决策调用返回 tool_call；工具内 LLM 调用返回对应 JSON content。"""

    def __init__(self, user_goal: str = ""):
        self.user_goal = user_goal
        self.call_count = 0
        self.model = "dev-scripted-stub"

    # ---------------- 决策序列 ----------------
    def _stage_decision(self, idx: int) -> tuple[str, dict]:
        """按调用次序返回对应阶段的 (tool_name, params)。"""
        if idx == 0:
            # 第 1 步：create_plan（需要 goal 字段）
            return "create_plan", {"goal": _goal_payload(self.user_goal)}
        if idx == 1:
            # 第 2 步：generate_script（需要 novel_text 字段）
            return "generate_script", {
                "novel_text": self.user_goal or "无文本，基于目标直接生成。",
                "goal": _goal_payload(self.user_goal),
            }
        if idx == 2:
            # 第 3 步：extract_characters（需要 script 字段为 dict）
            return "extract_characters", {"script": _FAKE_SCRIPT}
        if idx == 3:
            # 第 4 步：extract_scenes
            return "extract_scenes", {"script": _FAKE_SCRIPT}
        if idx == 4:
            # 第 5 步：extract_shots（需要 script + scenes）
            return "extract_shots", {
                "script": _FAKE_SCRIPT,
                "scenes": _FAKE_SCENES,
            }
        # 5+ 之后：让 agent 主动结束
        return "finish_task", {"summary": "已生成剧本 / 角色 / 场景 / 分镜"}

    # ---------------- 工具内 LLM 内容 ----------------
    def _tool_content(self, tool_name: str) -> str:
        """按当前 tool_name 返回对应工具需要的 JSON content。"""
        if tool_name == "create_plan":
            return json.dumps({"steps": _PLAN_STEPS}, ensure_ascii=False)
        if tool_name == "generate_script":
            return json.dumps(_FAKE_SCRIPT, ensure_ascii=False)
        if tool_name == "extract_characters":
            return json.dumps({"characters": _FAKE_CHARACTERS}, ensure_ascii=False)
        if tool_name == "extract_scenes":
            return json.dumps({"scenes": _FAKE_SCENES}, ensure_ascii=False)
        if tool_name == "extract_shots":
            return json.dumps({"shots": _FAKE_SHOTS}, ensure_ascii=False)
        return json.dumps({}, ensure_ascii=False)

    async def generate(
        self,
        messages: list[dict],
        tools: list[dict] | None = None,
        temperature: float = 0.7,
        max_tokens: int = 4000,
    ) -> LLMResponse:
        idx = self.call_count
        self.call_count += 1
        # 偶数次 = 决策（runtime.step）
        # 奇数次 = 工具内 LLM 内容
        if idx % 2 == 0:
            tool_name, tool_args = self._stage_decision(idx // 2)
            return LLMResponse(
                tool_name=tool_name,
                tool_args=tool_args,
                cost_usd=0.001,
                prompt_tokens=120,
                completion_tokens=40,
            )
        # 工具内调用：根据上一次决策的 tool_name 返回 content
        last_decision_idx = (idx - 1) // 2
        last_tool_name, _ = self._stage_decision(last_decision_idx)
        return LLMResponse(
            content=self._tool_content(last_tool_name),
            tool_name=None,
            tool_args=None,
            cost_usd=0.002,
            prompt_tokens=200,
            completion_tokens=120,
        )

    async def generate_structured(self, *args, **kwargs) -> LLMResponse:
        return await self.generate(*args, **kwargs)


__all__ = ["DevScriptedLLM"]
