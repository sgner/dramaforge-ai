"""Agent 短期/长期记忆。

短期：当前任务的 step 历史 + 已生成资产
长期：用户偏好（v1.1 实现）
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


@dataclass
class StepRecord:
    step_number: int
    thought: str
    action: dict
    observation: dict
    status: str  # pending | running | success | failed | retrying | skipped
    cost_usd: float = 0.0
    tokens: int = 0
    started_at: float = 0.0
    finished_at: float = 0.0

    def to_dict(self) -> dict:
        return {
            "step_number": self.step_number,
            "thought": self.thought,
            "action": self.action,
            "observation": self.observation,
            "status": self.status,
            "cost_usd": self.cost_usd,
            "tokens": self.tokens,
            "started_at": self.started_at,
            "finished_at": self.finished_at,
        }

    @classmethod
    def from_dict(cls, d: dict) -> "StepRecord":
        return cls(
            step_number=d.get("step_number", 0),
            thought=d.get("thought", ""),
            action=d.get("action", {}),
            observation=d.get("observation", {}),
            status=d.get("status", "pending"),
            cost_usd=d.get("cost_usd", 0.0),
            tokens=d.get("tokens", 0),
            started_at=d.get("started_at", 0.0),
            finished_at=d.get("finished_at", 0.0),
        )


class AgentMemory:
    def __init__(self, user_goal: str, plan: list[dict] | None = None):
        self.user_goal = user_goal
        self.plan: list[dict] = list(plan or [])
        self.short_term: list[StepRecord] = []
        self.artifacts: dict[str, list[dict]] = {}
        # 多轮对话记忆：每轮用户消息 + agent 完成摘要
        # 结构: [{"turn": 1, "user_message": "...", "agent_summary": "...", "step_range": [1, 15]}]
        self.conversation_turns: list[dict] = []
        # 被压缩的早期步骤摘要（控制 prompt token 预算）
        self.compressed_summary: str = ""

    # ---------------- 写操作 ----------------

    def add_step(
        self,
        step_number: int,
        thought: str,
        action: dict,
        observation: dict,
        status: str,
        cost_usd: float = 0.0,
        tokens: int = 0,
    ) -> StepRecord:
        rec = StepRecord(
            step_number=step_number,
            thought=thought,
            action=action,
            observation=observation,
            status=status,
            cost_usd=cost_usd,
            tokens=tokens,
        )
        self.short_term.append(rec)
        return rec

    def set_artifact(self, kind: str, artifact: dict) -> None:
        """追加一条资产（kind = characters / props / scenes / shots ...）。"""
        if kind not in self.artifacts:
            self.artifacts[kind] = []
        self.artifacts[kind].append(artifact)

    def update_plan(self, plan: list[dict]) -> None:
        self.plan = list(plan)

    def add_conversation_turn(
        self,
        turn: int,
        user_message: str,
        agent_summary: str,
        step_range: list[int],
    ) -> None:
        """追加一轮对话摘要（在 continue_conversation 压缩后调用）。"""
        self.conversation_turns.append({
            "turn": turn,
            "user_message": user_message,
            "agent_summary": agent_summary,
            "step_range": step_range,
        })

    def should_compress(self, threshold: int = 15) -> bool:
        """判断是否需要压缩早期步骤（步数超过阈值且未被压缩过）。"""
        return len(self.short_term) > threshold

    # ---------------- 读操作 ----------------

    @property
    def total_cost_usd(self) -> float:
        return sum(s.cost_usd for s in self.short_term)

    @property
    def total_tokens(self) -> int:
        return sum(s.tokens for s in self.short_term)

    def recent_steps(self, n: int = 10) -> list[StepRecord]:
        return self.short_term[-n:]

    # ---------------- 持久化 ----------------

    def to_dict(self) -> dict:
        return {
            "user_goal": self.user_goal,
            "plan": self.plan,
            "short_term": [s.to_dict() for s in self.short_term],
            "artifacts": self.artifacts,
            "conversation_turns": self.conversation_turns,
            "compressed_summary": self.compressed_summary,
            "total_cost_usd": self.total_cost_usd,
            "total_tokens": self.total_tokens,
        }

    @classmethod
    def from_dict(cls, d: dict) -> "AgentMemory":
        m = cls(user_goal=d.get("user_goal", ""), plan=d.get("plan", []))
        m.short_term = [StepRecord.from_dict(s) for s in d.get("short_term", [])]
        m.artifacts = d.get("artifacts", {})
        m.conversation_turns = d.get("conversation_turns", [])
        m.compressed_summary = d.get("compressed_summary", "")
        return m
