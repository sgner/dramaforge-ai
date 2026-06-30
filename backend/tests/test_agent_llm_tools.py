"""TDD: LLM 类工具（generate_script / extract_* / optimize_prompt）。"""
import json
import pytest

from app.agent.tools.base import ToolContext, ToolValidationError
from app.agent.tools.llm_tools import (
    GenerateScriptTool,
    ExtractCharactersTool,
    ExtractPropsTool,
    ExtractScenesTool,
    ExtractShotsTool,
    OptimizePromptTool,
)


# ========================
# GenerateScriptTool
# ========================

def test_generate_script_metadata():
    t = GenerateScriptTool()
    assert t.name == "generate_script"
    assert t.category == "llm"
    assert t.requires_approval is False
    assert {"novel_text", "goal"} <= {p.name for p in t.parameters}


@pytest.mark.asyncio
async def test_generate_script_returns_list_of_scenes():
    payload = {
        "scenes": [
            {"index": 1, "title": "开场", "location": "咖啡店", "dialogue": "你好", "duration_sec": 30},
        ]
    }

    class _StubLLM:
        async def generate(self, messages, tools=None, **kwargs):
            from app.agent.llm import LLMResponse
            return LLMResponse(content=json.dumps(payload))

    ctx = ToolContext(task_id="t1", llm_client=_StubLLM())
    result = await GenerateScriptTool().call(ctx, {"novel_text": "林尘走进咖啡店..."})
    assert "scenes" in result
    assert result["scenes"][0]["title"] == "开场"


@pytest.mark.asyncio
async def test_generate_script_validation_requires_novel_text():
    ctx = ToolContext(task_id="t1")
    with pytest.raises(ToolValidationError):
        await GenerateScriptTool().call(ctx, {"goal": {"title": "x"}})


# ========================
# ExtractCharactersTool
# ========================

def test_extract_characters_metadata():
    t = ExtractCharactersTool()
    assert t.name == "extract_characters"
    assert t.category == "llm"
    assert "script" in {p.name for p in t.parameters}


@pytest.mark.asyncio
async def test_extract_characters_returns_list():
    payload = {"characters": [{"name": "林尘", "role": "主角", "appearance": "25岁男生"}]}

    class _StubLLM:
        async def generate(self, messages, tools=None, **kwargs):
            from app.agent.llm import LLMResponse
            return LLMResponse(content=json.dumps(payload))

    ctx = ToolContext(task_id="t1", llm_client=_StubLLM())
    result = await ExtractCharactersTool().call(ctx, {"script": {"scenes": []}})
    assert "characters" in result
    assert result["characters"][0]["name"] == "林尘"


# ========================
# ExtractPropsTool
# ========================

def test_extract_props_metadata():
    t = ExtractPropsTool()
    assert t.name == "extract_props"


@pytest.mark.asyncio
async def test_extract_props_returns_list():
    payload = {"props": [{"name": "黑色笔记本", "description": "林尘的道具"}]}

    class _StubLLM:
        async def generate(self, messages, tools=None, **kwargs):
            from app.agent.llm import LLMResponse
            return LLMResponse(content=json.dumps(payload))

    ctx = ToolContext(task_id="t1", llm_client=_StubLLM())
    result = await ExtractPropsTool().call(ctx, {"script": {}, "characters": []})
    assert "props" in result
    assert result["props"][0]["name"] == "黑色笔记本"


# ========================
# ExtractScenesTool
# ========================

def test_extract_scenes_metadata():
    t = ExtractScenesTool()
    assert t.name == "extract_scenes"


@pytest.mark.asyncio
async def test_extract_scenes_returns_list():
    payload = {"scenes": [{"name": "咖啡店", "description": "温暖的咖啡店", "time": "白天"}]}

    class _StubLLM:
        async def generate(self, messages, tools=None, **kwargs):
            from app.agent.llm import LLMResponse
            return LLMResponse(content=json.dumps(payload))

    ctx = ToolContext(task_id="t1", llm_client=_StubLLM())
    result = await ExtractScenesTool().call(ctx, {"script": {}})
    assert "scenes" in result
    assert result["scenes"][0]["name"] == "咖啡店"


# ========================
# ExtractShotsTool
# ========================

def test_extract_shots_metadata():
    t = ExtractShotsTool()
    assert t.name == "extract_shots"


@pytest.mark.asyncio
async def test_extract_shots_returns_list():
    payload = {
        "shots": [
            {
                "scene": "咖啡店",
                "index": 1,
                "duration_sec": 5,
                "camera": "中景",
                "action": "林尘坐下",
                "dialogue": "",
            }
        ]
    }

    class _StubLLM:
        async def generate(self, messages, tools=None, **kwargs):
            from app.agent.llm import LLMResponse
            return LLMResponse(content=json.dumps(payload))

    ctx = ToolContext(task_id="t1", llm_client=_StubLLM())
    result = await ExtractShotsTool().call(ctx, {
        "script": {},
        "scenes": [{"name": "咖啡店"}],
    })
    assert "shots" in result
    assert result["shots"][0]["camera"] == "中景"


# ========================
# OptimizePromptTool
# ========================

def test_optimize_prompt_metadata():
    t = OptimizePromptTool()
    assert t.name == "optimize_prompt"
    assert "prompt" in {p.name for p in t.parameters}


@pytest.mark.asyncio
async def test_optimize_prompt_returns_optimized():
    class _StubLLM:
        async def generate(self, messages, tools=None, **kwargs):
            from app.agent.llm import LLMResponse
            return LLMResponse(content="林尘坐在咖啡店角落，温暖的阳光透过窗户洒在脸上，特写镜头")

    ctx = ToolContext(task_id="t1", llm_client=_StubLLM())
    result = await OptimizePromptTool().call(ctx, {"prompt": "男生在咖啡店", "target": "image"})
    assert "optimized" in result
    assert "林尘" in result["optimized"]


# ========================
# Unique names
# ========================

def test_llm_tools_have_unique_names():
    tools = [
        GenerateScriptTool(),
        ExtractCharactersTool(),
        ExtractPropsTool(),
        ExtractScenesTool(),
        ExtractShotsTool(),
        OptimizePromptTool(),
    ]
    names = [t.name for t in tools]
    assert len(set(names)) == 6
