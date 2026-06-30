"""AgentMemory 测试。"""
import pytest

from app.agent.memory import AgentMemory, StepRecord


# ========================
# StepRecord 测试
# ========================

def test_step_record_to_dict():
    """StepRecord 可序列化。"""
    s = StepRecord(
        step_number=1,
        thought="我先做X",
        action={"tool": "generate_script", "params": {}},
        observation={"success": True, "result": {}},
        status="success",
        cost_usd=0.01,
        tokens=100,
    )
    d = s.to_dict()
    assert d["step_number"] == 1
    assert d["status"] == "success"
    assert d["cost_usd"] == 0.01


# ========================
# AgentMemory 测试
# ========================

def test_memory_starts_empty():
    """新 memory 是空的。"""
    m = AgentMemory(user_goal="test", plan=[])
    assert m.user_goal == "test"
    assert m.plan == []
    assert m.short_term == []
    assert m.artifacts == {}


def test_memory_add_step():
    """添加步骤到 short_term。"""
    m = AgentMemory(user_goal="x", plan=[])
    m.add_step(
        step_number=1,
        thought="t",
        action={"tool": "a"},
        observation={"success": True},
        status="success",
    )
    assert len(m.short_term) == 1
    assert m.short_term[0].step_number == 1


def test_memory_total_cost():
    """累计成本。"""
    m = AgentMemory(user_goal="x", plan=[])
    m.add_step(1, "t", {}, {}, "success", cost_usd=0.05)
    m.add_step(2, "t", {}, {}, "success", cost_usd=0.10)
    assert m.total_cost_usd == pytest.approx(0.15)


def test_memory_total_tokens():
    """累计 tokens。"""
    m = AgentMemory(user_goal="x", plan=[])
    m.add_step(1, "t", {}, {}, "success", tokens=100)
    m.add_step(2, "t", {}, {}, "success", tokens=200)
    assert m.total_tokens == 300


def test_memory_set_artifact():
    """添加资产生成记录。"""
    m = AgentMemory(user_goal="x", plan=[])
    m.set_artifact("characters", {"name": "林尘", "url": "http://x"})
    assert "characters" in m.artifacts
    assert len(m.artifacts["characters"]) == 1


def test_memory_recent_n_steps():
    """取最近 N 步。"""
    m = AgentMemory(user_goal="x", plan=[])
    for i in range(15):
        m.add_step(i + 1, f"t{i}", {}, {}, "success")
    recent = m.recent_steps(5)
    assert len(recent) == 5
    assert recent[0].step_number == 11
    assert recent[-1].step_number == 15


def test_memory_serialize_for_persistence():
    """可序列化到 dict 存数据库。"""
    m = AgentMemory(user_goal="goal", plan=[{"step": 1}])
    m.add_step(1, "thought", {"tool": "a"}, {"success": True}, "success", cost_usd=0.01)
    m.set_artifact("characters", {"name": "x"})
    d = m.to_dict()
    assert d["user_goal"] == "goal"
    assert len(d["short_term"]) == 1
    assert d["total_cost_usd"] == pytest.approx(0.01)


def test_memory_deserialize():
    """可从 dict 恢复。"""
    src = {
        "user_goal": "goal",
        "plan": [{"step": 1}],
        "short_term": [
            {
                "step_number": 1, "thought": "t", "action": {}, "observation": {},
                "status": "success", "cost_usd": 0.0, "tokens": 0,
            }
        ],
        "artifacts": {"characters": [{"name": "x"}]},
    }
    m = AgentMemory.from_dict(src)
    assert m.user_goal == "goal"
    assert len(m.short_term) == 1
    assert m.artifacts["characters"][0]["name"] == "x"
