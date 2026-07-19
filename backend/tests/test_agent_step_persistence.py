"""step 持久化与记忆压缩冲突修复的回归测试。

Bug 背景：_persist_steps 曾按数组下标把 memory.short_term[i] 覆写到
existing_steps[i]；多轮对话记忆压缩会把 short_term 裁到最近 10 条，
压缩后再持久化时，下标对齐会把后段 step 的内容写进前段旧行，
step_number 与内容永久错位。恢复任务时 _step_count = len(short_term)
又把计数器重置回 ~10，产生重复 step_number，污染被读回 memory 后继续放大。

修复：_persist_steps 按 step_number 对齐（UPDATE 同号行 / INSERT 新号），
且只做增量写入；恢复路径按 step_number 排序去重重建 memory，
_step_count 取最大 step_number。
"""
import uuid

import pytest
from sqlalchemy import event

from app.agent.memory import AgentMemory, StepRecord
from app.agent.runtime import AgentRuntime
from app.database import SessionLocal
from app.models import AgentStep, AgentTask
from app.routers.agent import (
    _persist_steps,
    _rebuild_short_term,
    _restored_step_count,
)


@pytest.fixture
def task_id():
    tid = f"step-persist-{uuid.uuid4().hex[:8]}"
    with SessionLocal() as db:
        db.add(AgentTask(id=tid, user_goal="step persistence test", status="running"))
        db.commit()
    yield tid
    with SessionLocal() as db:
        db.query(AgentStep).filter_by(task_id=tid).delete()
        db.query(AgentTask).filter_by(id=tid).delete()
        db.commit()


def _add_step(memory: AgentMemory, n: int) -> None:
    """追加一个编号为 n 的 step，内容字段都带编号指纹，便于校验错位。"""
    memory.add_step(
        step_number=n,
        thought=f"thought-{n}",
        action={"tool": "dummy", "params": {"n": n}},
        observation={"success": True, "n": n},
        status="success",
        cost_usd=float(n),
        tokens=10 * n,
    )


def _make_runtime(task_id: str, count: int, start: int = 1):
    """构造含 count 个连续编号 step 的 memory + runtime。"""
    memory = AgentMemory(user_goal="step persistence test")
    for n in range(start, start + count):
        _add_step(memory, n)
    runtime = AgentRuntime(task_id=task_id, llm=object(), memory=memory)
    runtime._step_count = start + count - 1
    return memory, runtime


def _db_steps(task_id: str) -> list[dict]:
    with SessionLocal() as db:
        rows = (
            db.query(AgentStep)
            .filter_by(task_id=task_id)
            .order_by(AgentStep.step_number)
            .all()
        )
        return [
            {
                "step_number": r.step_number,
                "thought": r.thought,
                "action": r.action,
                "observation": r.observation,
                "status": r.status,
                "tokens": r.tokens,
            }
            for r in rows
        ]


# ----------------------------------------------------------------
# 1. 先跑 15 步 → 压缩到 10 条 → 再跑 5 步：编号无重复、内容不错位
# ----------------------------------------------------------------

def test_persist_steps_after_compression_no_duplicate_or_misalignment(task_id):
    memory, runtime = _make_runtime(task_id, 15)
    _persist_steps(task_id, memory, runtime)

    # 模拟记忆压缩：short_term 裁到最近 10 条（保留原 step_number 6..15）
    memory.short_term = memory.short_term[-10:]

    # 压缩后再跑 5 步：编号必须继续递增（16..20），不回退
    for _ in range(5):
        runtime._step_count += 1
        _add_step(memory, runtime._step_count)
    _persist_steps(task_id, memory, runtime)

    rows = _db_steps(task_id)
    numbers = [r["step_number"] for r in rows]
    assert numbers == list(range(1, 21)), "step_number 必须 1..20 无重复无缺失"
    for r in rows:
        n = r["step_number"]
        assert r["thought"] == f"thought-{n}", "内容不得与编号错位"
        assert r["observation"]["n"] == n
        assert r["action"]["params"]["n"] == n
        assert r["tokens"] == 10 * n


# ----------------------------------------------------------------
# 2. 压缩后 _step_count 不回退
# ----------------------------------------------------------------

def test_restored_step_count_uses_max_step_number_not_length():
    # 压缩后的 short_term：只剩 10 条，编号 6..15
    short_term = [
        StepRecord(step_number=n, thought="", action={}, observation={}, status="success")
        for n in range(6, 16)
    ]
    assert len(short_term) == 10  # 旧实现 len() 会错误地返回 10
    assert _restored_step_count(short_term) == 15
    assert _restored_step_count([]) == 0


def test_restore_after_compression_continues_monotonic(task_id):
    """完整恢复链路：persist 15 步 → DB 重建压缩态 memory → 继续跑 3 步。"""
    memory, runtime = _make_runtime(task_id, 15)
    _persist_steps(task_id, memory, runtime)

    # 进程重启后从 DB 重建 memory（_continue_runtime 的重建路径），
    # 且恢复后 memory 仍是压缩态（只保留最近 10 条）
    with SessionLocal() as db:
        rows = (
            db.query(AgentStep)
            .filter_by(task_id=task_id)
            .order_by(AgentStep.step_number)
            .all()
        )
    restored_memory = AgentMemory(user_goal="step persistence test")
    restored_memory.short_term = _rebuild_short_term(task_id, rows)[-10:]
    restored_runtime = AgentRuntime(task_id=task_id, llm=object(), memory=restored_memory)
    restored_runtime._step_count = _restored_step_count(restored_memory.short_term)

    # 关键断言：压缩到 10 条后计数器不得回退到 10
    assert restored_runtime._step_count == 15

    for _ in range(3):
        restored_runtime._step_count += 1
        _add_step(restored_memory, restored_runtime._step_count)
    _persist_steps(task_id, restored_memory, restored_runtime)

    rows2 = _db_steps(task_id)
    assert [r["step_number"] for r in rows2] == list(range(1, 19))
    assert all(r["thought"] == f"thought-{r['step_number']}" for r in rows2)


# ----------------------------------------------------------------
# 3. 恢复路径：从污染风险场景（乱序 + 重复编号）重建 memory
# ----------------------------------------------------------------

def test_rebuild_short_term_sorts_and_dedupes(task_id):
    with SessionLocal() as db:
        for i, (num, thought) in enumerate([
            (3, "t3"),
            (1, "t1"),
            (2, "t2-first"),
            (2, "t2-dup"),  # 历史污染产生的重复编号
            (5, "t5"),
        ]):
            db.add(AgentStep(
                id=f"{task_id}-s{i}",
                task_id=task_id,
                step_number=num,
                thought=thought,
                action={},
                observation={},
                status="success",
            ))
        db.commit()

    with SessionLocal() as db:
        rows = (
            db.query(AgentStep)
            .filter_by(task_id=task_id)
            .order_by(AgentStep.step_number)
            .all()
        )
    records = _rebuild_short_term(task_id, rows)

    assert [r.step_number for r in records] == [1, 2, 3, 5], "必须按编号升序且去重"
    assert records[1].thought == "t2-first", "重复编号保留首行"


# ----------------------------------------------------------------
# 4. 增量持久化：第二次 _persist_steps 不再触碰未变化的旧行
# ----------------------------------------------------------------

def test_persist_steps_is_incremental(task_id):
    memory, runtime = _make_runtime(task_id, 5)

    inserted: list[int] = []
    updated: list[int] = []

    def on_insert(mapper, connection, target):
        inserted.append(target.step_number)

    def on_update(mapper, connection, target):
        updated.append(target.step_number)

    event.listen(AgentStep, "before_insert", on_insert)
    event.listen(AgentStep, "before_update", on_update)
    try:
        # 首次：5 条全部 INSERT，无 UPDATE
        _persist_steps(task_id, memory, runtime)
        assert len(inserted) == 5
        assert len(updated) == 0

        # 第二次：内容完全没变化 → 零 INSERT 零 UPDATE（旧实现会 UPDATE 全部 5 行）
        inserted.clear()
        updated.clear()
        _persist_steps(task_id, memory, runtime)
        assert len(inserted) == 0
        assert len(updated) == 0

        # 只有 step 3 的内容变化（如 ask_user 步被用户响应更新）→ 恰好 1 次 UPDATE
        memory.short_term[2].observation = {"success": True, "n": 3, "user_response": "go"}
        inserted.clear()
        updated.clear()
        _persist_steps(task_id, memory, runtime)
        assert len(inserted) == 0
        assert len(updated) == 1
        assert updated[0] == 3
    finally:
        event.remove(AgentStep, "before_insert", on_insert)
        event.remove(AgentStep, "before_update", on_update)

    # 变化确实落库
    row3 = next(r for r in _db_steps(task_id) if r["step_number"] == 3)
    assert row3["observation"]["user_response"] == "go"


def test_persist_steps_updates_existing_row_by_step_number_not_index(task_id):
    """同号行按 step_number 更新：即使 memory 里只剩这一条（压缩态），
    也必须更新编号对应的行，而不是按下标覆写到第 1 行。"""
    memory, runtime = _make_runtime(task_id, 15)
    _persist_steps(task_id, memory, runtime)

    # 压缩态 memory：只保留 step 12（位于数组下标 0）
    memory.short_term = [s for s in memory.short_term if s.step_number == 12]
    memory.short_term[0].status = "failed"
    memory.short_term[0].observation = {"success": False, "error": "boom"}
    _persist_steps(task_id, memory, runtime)

    rows = _db_steps(task_id)
    assert len(rows) == 15
    by_number = {r["step_number"]: r for r in rows}
    assert by_number[12]["status"] == "failed"
    assert by_number[12]["observation"]["error"] == "boom"
    # 其它行（尤其第 1 行）不得被覆写
    assert by_number[1]["status"] == "success"
    assert by_number[1]["thought"] == "thought-1"
