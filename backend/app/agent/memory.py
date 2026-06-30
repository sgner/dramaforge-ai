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
            "total_cost_usd": self.total_cost_usd,
            "total_tokens": self.total_tokens,
        }

    @classmethod
    def from_dict(cls, d: dict) -> "AgentMemory":
        m = cls(user_goal=d.get("user_goal", ""), plan=d.get("plan", []))
        m.short_term = [StepRecord.from_dict(s) for s in d.get("short_term", [])]
        m.artifacts = d.get("artifacts", {})
        return m
