"""TDD: agent 工具的 system prompt 必须包含项目规范关键字段。"""
from __future__ import annotations

import json
import pytest

from app.agent import specs
from app.agent.llm import LLMResponse
from app.agent.tools.base import ToolContext
from app.agent.tools.llm_tools import (
    GenerateScriptTool,
    ExtractCharactersTool,
    ExtractPropsTool,
    ExtractScenesTool,
    ExtractShotsTool,
    OptimizePromptTool,
)


@pytest.fixture(autouse=True)
def _clear_spec_cache():
    specs._file_cache.clear()
    specs._spec_cache.clear()
    yield
    specs._file_cache.clear()
    specs._spec_cache.clear()


class _CapturingLLM:
    """记录每次调用收到的 messages，便于断言 system prompt 内容。"""

    def __init__(self, response_content: str = "{}"):
        self.response_content = response_content
        self.captured_system_prompts: list[str] = []

    async def generate(self, messages, tools=None, **kwargs):
        for m in messages:
            if m.get("role") == "system":
                self.captured_system_prompts.append(m["content"])
        return LLMResponse(content=self.response_content)


# ========================
# GenerateScriptTool
# ========================

@pytest.mark.asyncio
async def test_generate_script_system_prompt_contains_audiovisual_signature():
    llm = _CapturingLLM(json.dumps({"scenes": []}))
    ctx = ToolContext(task_id="t1", llm_client=llm)
    await GenerateScriptTool().call(ctx, {"novel_text": "林尘走进咖啡店"})
    assert llm.captured_system_prompts
    sp = llm.captured_system_prompts[-1]
    assert "【项目规范】" in sp
    assert any(k in sp for k in ["视听", "签名", "节奏"])


# ========================
# ExtractCharactersTool
# ========================

@pytest.mark.asyncio
async def test_extract_characters_system_prompt_contains_face_anchors():
    llm = _CapturingLLM(json.dumps({"characters": []}))
    ctx = ToolContext(task_id="t1", llm_client=llm)
    await ExtractCharactersTool().call(ctx, {"script": {"scenes": []}})
    assert llm.captured_system_prompts
    sp = llm.captured_system_prompts[-1]
    assert "【项目规范】" in sp
    # 面容锚点至少命中一个
    assert any(k in sp for k in ["脸型", "眉形", "骨相", "瞳", "唇"]), sp[-500:]


@pytest.mark.asyncio
async def test_extract_characters_system_prompt_contains_prohibitions():
    llm = _CapturingLLM(json.dumps({"characters": []}))
    ctx = ToolContext(task_id="t1", llm_client=llm)
    await ExtractCharactersTool().call(ctx, {"script": {}})
    sp = llm.captured_system_prompts[-1]
    assert any(k in sp for k in ["禁止", "不准", "不得"])


# ========================
# ExtractPropsTool
# ========================

@pytest.mark.asyncio
async def test_extract_props_system_prompt_contains_classification():
    llm = _CapturingLLM(json.dumps({"props": []}))
    ctx = ToolContext(task_id="t1", llm_client=llm)
    await ExtractPropsTool().call(ctx, {"script": {}})
    sp = llm.captured_system_prompts[-1]
    assert "【项目规范】" in sp
    assert any(k in sp for k in ["分类", "类目", "类别"])


# ========================
# ExtractScenesTool
# ========================

@pytest.mark.asyncio
async def test_extract_scenes_system_prompt_contains_seven_layers():
    llm = _CapturingLLM(json.dumps({"scenes": []}))
    ctx = ToolContext(task_id="t1", llm_client=llm)
    await ExtractScenesTool().call(ctx, {"script": {}})
    sp = llm.captured_system_prompts[-1]
    assert "【项目规范】" in sp
    assert any(k in sp for k in ["七层", "递进", "层"])


# ========================
# ExtractShotsTool
# ========================

@pytest.mark.asyncio
async def test_extract_shots_system_prompt_contains_directions():
    llm = _CapturingLLM(json.dumps({"shots": []}))
    ctx = ToolContext(task_id="t1", llm_client=llm)
    await ExtractShotsTool().call(ctx, {"script": {}, "scenes": [{"name": "x"}]})
    sp = llm.captured_system_prompts[-1]
    assert "【项目规范】" in sp
    assert any(k in sp for k in ["方向", "运动", "镜头"])


# ========================
# OptimizePromptTool
# ========================

@pytest.mark.asyncio
async def test_optimize_prompt_contains_cineforge_constraints():
    llm = _CapturingLLM("optimized prompt")
    ctx = ToolContext(task_id="t1", llm_client=llm)
    await OptimizePromptTool().call(ctx, {"prompt": "男生", "target": "image"})
    sp = llm.captured_system_prompts[-1]
    assert "【项目规范】" in sp
    assert any(k in sp for k in ["跨模型", "兼容", "硬约束"])


@pytest.mark.asyncio
async def test_optimize_prompt_contains_sensitive_words():
    llm = _CapturingLLM("optimized prompt")
    ctx = ToolContext(task_id="t1", llm_client=llm)
    await OptimizePromptTool().call(ctx, {"prompt": "x", "target": "video"})
    sp = llm.captured_system_prompts[-1]
    assert any(k in sp for k in ["敏感", "违禁", "过滤"])


# ========================
# Fallback：docs 缺失时工具仍可执行（spec 段不出现）
# ========================

@pytest.mark.asyncio
async def test_tool_runs_without_spec_when_docs_missing(tmp_path, monkeypatch):
    monkeypatch.setattr(specs, "_DOCS_DIR", tmp_path)
    llm = _CapturingLLM(json.dumps({"characters": [{"name": "x"}]}))
    ctx = ToolContext(task_id="t1", llm_client=llm)
    result = await ExtractCharactersTool().call(ctx, {"script": {}})
    sp = llm.captured_system_prompts[-1]
    assert "【项目规范】" not in sp  # spec 为空时不应追加
    assert "characters" in result  # 工具仍正常返回


# ========================
# image_tools._build_*_prompt 注入规范
# ========================

from app.agent.tools import image_tools


@pytest.mark.asyncio
async def test_build_character_prompt_contains_concept_layout():
    """_build_character_prompt 返回值包含 B.4 概念表布局关键字。"""
    prompt = image_tools._build_character_prompt({"name": "林尘", "age": 25, "gender": "男"})
    assert "林尘" in prompt  # 基础信息保留
    assert any(k in prompt for k in ["概念", "布局", "视图"]), prompt[-500:]


@pytest.mark.asyncio
async def test_build_scene_prompt_contains_material_standard():
    """_build_scene_prompt 返回值包含 A.3 材质标准。"""
    prompt = image_tools._build_scene_prompt({"name": "咖啡店", "time": "白天"})
    assert "咖啡店" in prompt
    assert any(k in prompt for k in ["材质", "可触摸", "触摸"])


@pytest.mark.asyncio
async def test_build_prop_prompt_contains_composition():
    """_build_prop_prompt 返回值包含 C.3 构图规范。"""
    prompt = image_tools._build_prop_prompt({"name": "黑色笔记本"})
    assert "黑色笔记本" in prompt
    assert any(k in prompt for k in ["构图", "视图", "布局"])


@pytest.mark.asyncio
async def test_build_storyboard_prompt_contains_storyboard_rules():
    """_build_storyboard_prompt 返回值包含 §4 故事板规范。"""
    prompt = image_tools._build_storyboard_prompt({"camera": "中景", "scene": "咖啡店"})
    assert any(k in prompt for k in ["故事板", "frozen", "帧"])


@pytest.mark.asyncio
async def test_build_prompts_run_without_spec_when_docs_missing(tmp_path, monkeypatch):
    """docs 缺失时 _build_*_prompt 仍返回非空基础 prompt（不抛异常）。"""
    monkeypatch.setattr(specs, "_DOCS_DIR", tmp_path)
    char_p = image_tools._build_character_prompt({"name": "x"})
    scene_p = image_tools._build_scene_prompt({"name": "x"})
    prop_p = image_tools._build_prop_prompt({"name": "x"})
    sb_p = image_tools._build_storyboard_prompt({"camera": "中景"})
    assert char_p and scene_p and prop_p and sb_p
    # 缺失 docs 时不追加规范，但基础结构词仍在
    assert "Character portrait" in char_p
    assert "Scene:" in scene_p
    assert "Object:" in prop_p
