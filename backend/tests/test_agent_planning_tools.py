"""TDD: planning 工具（parse_user_goal / create_plan / ask_user）"""
import json
import pytest

from app.agent.tools.base import BaseTool, ToolContext
from app.agent.tools.planning import (
    ParseUserGoalTool,
    CreatePlanTool,
    AskUserTool,
)


# ========================
# ParseUserGoalTool
# ========================

def test_parse_user_goal_has_metadata():
    """parse_user_goal 应暴露 name/description/parameters。"""
    t = ParseUserGoalTool()
    assert t.name == "parse_user_goal"
    assert t.description
    assert t.category == "planning"
    param_names = {p.name for p in t.parameters}
    assert "user_text" in param_names


@pytest.mark.asyncio
async def test_parse_user_goal_calls_llm_and_returns_structured():
    """parse_user_goal 通过 ctx.llm_client 调用 LLM 并解析 JSON。"""

    class _StubLLM:
        async def generate(self, messages, tools=None, **kwargs):
            from app.agent.llm import LLMResponse
            return LLMResponse(
                content=json.dumps({
                    "title": "短剧1",
                    "genre": "现代都市",
                    "duration_sec": 60,
                    "num_characters": 3,
                    "summary": "一句话总结",
                }),
                prompt_tokens=10,
                completion_tokens=20,
            )

    ctx = ToolContext(task_id="t1", llm_client=_StubLLM())
    tool = ParseUserGoalTool()
    result = await tool.call(ctx, {"user_text": "我想做一个一分钟的现代都市短剧"})
    assert result["title"] == "短剧1"
    assert result["genre"] == "现代都市"
    assert result["duration_sec"] == 60


@pytest.mark.asyncio
async def test_parse_user_goal_validation_requires_user_text():
    """缺少 user_text 应抛 ToolValidationError。"""
    from app.agent.tools.base import ToolValidationError

    ctx = ToolContext(task_id="t1")
    tool = ParseUserGoalTool()
    with pytest.raises(ToolValidationError):
        await tool.call(ctx, {})


@pytest.mark.asyncio
async def test_parse_user_goal_accepts_legacy_user_input():
    """兼容历史 LLM 缓存：仍接受 user_input 字段。"""
    from app.agent.tools.base import ToolValidationError

    captured = {}

    class _StubLLM:
        async def generate(self, messages, tools=None, **kwargs):
            from app.agent.llm import LLMResponse
            captured["content"] = messages[-1]["content"]
            return LLMResponse(content='{"title": "ok"}')

    ctx = ToolContext(task_id="t1", llm_client=_StubLLM())
    tool = ParseUserGoalTool()
    result = await tool.call(ctx, {"user_input": "长相思"})
    assert result["title"] == "ok"
    assert captured["content"] == "长相思"


# ========================
# CreatePlanTool
# ========================

def test_create_plan_has_metadata():
    """create_plan 应暴露 name/description/parameters 且 requires_approval。"""
    t = CreatePlanTool()
    assert t.name == "create_plan"
    assert t.requires_approval is True
    assert t.category == "planning"


@pytest.mark.asyncio
async def test_create_plan_returns_list_of_steps():
    """create_plan 应返回 plan 列表。"""
    plan_json = json.dumps({
        "steps": [
            {"description": "生成脚本", "tool": "generate_script"},
            {"description": "提取角色", "tool": "extract_characters"},
        ]
    })

    class _StubLLM:
        async def generate(self, messages, tools=None, **kwargs):
            from app.agent.llm import LLMResponse
            return LLMResponse(content=plan_json)

    ctx = ToolContext(task_id="t1", llm_client=_StubLLM())
    tool = CreatePlanTool()
    result = await tool.call(ctx, {"goal": {"title": "短剧1"}})
    assert isinstance(result, list)
    assert len(result) == 2
    assert result[0]["tool"] == "generate_script"


@pytest.mark.asyncio
async def test_create_plan_handles_markdown_fences():
    """create_plan 应能处理 markdown 代码块。"""
    plan_md = '```json\n{"steps": [{"description": "x", "tool": "y"}]}\n```'

    class _StubLLM:
        async def generate(self, messages, tools=None, **kwargs):
            from app.agent.llm import LLMResponse
            return LLMResponse(content=plan_md)

    ctx = ToolContext(task_id="t1", llm_client=_StubLLM())
    tool = CreatePlanTool()
    result = await tool.call(ctx, {"goal": {"title": "短剧1"}})
    assert len(result) == 1


# ========================
# AskUserTool
# ========================

def test_ask_user_has_metadata():
    """ask_user 应暴露 name/description/parameters。"""
    t = AskUserTool()
    assert t.name == "ask_user"
    assert t.category == "planning"
    param_names = {p.name for p in t.parameters}
    assert "question" in param_names
    assert "options" in param_names


@pytest.mark.asyncio
async def test_ask_user_returns_question_payload():
    """ask_user.execute 返回包含 question/options 的 dict。"""
    ctx = ToolContext(task_id="t1")
    tool = AskUserTool()
    result = await tool.execute(ctx, {
        "question": "你更喜欢什么风格？",
        "options": ["现代都市", "古风仙侠"],
    })
    assert result["question"] == "你更喜欢什么风格？"
    assert "现代都市" in result["options"]


@pytest.mark.asyncio
async def test_ask_user_validation_requires_question():
    """ask_user 缺少 question 应抛 ToolValidationError。"""
    from app.agent.tools.base import ToolValidationError
    ctx = ToolContext(task_id="t1")
    tool = AskUserTool()
    with pytest.raises(ToolValidationError):
        await tool.call(ctx, {"options": []})


# ========================
# 工具元数据一致性
# ========================

def test_planning_tools_have_unique_names():
    """三个 planning 工具 name 不重复。"""
    names = [ParseUserGoalTool().name, CreatePlanTool().name, AskUserTool().name]
    assert len(set(names)) == 3
