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
    # 缺失 docs 时不追加规范，但 V3.0 基础结构词仍在
    assert "Character concept art" in char_p
    assert "Scene:" in scene_p
    assert "Object:" in prop_p


# ========================
# llm.py REACT_SYSTEM_PROMPT 铁律段
# ========================

def test_react_system_prompt_contains_project_spec_section():
    """REACT_SYSTEM_PROMPT 必须包含【项目规范】总览段。"""
    from app.agent.llm import REACT_SYSTEM_PROMPT
    assert "【项目规范】" in REACT_SYSTEM_PROMPT


def test_react_system_prompt_contains_isolation_rule():
    """铁律：角色/场景/道具三者严格隔离。"""
    from app.agent.llm import REACT_SYSTEM_PROMPT
    assert "隔离" in REACT_SYSTEM_PROMPT
    assert "角色" in REACT_SYSTEM_PROMPT
    assert "场景" in REACT_SYSTEM_PROMPT
    assert "道具" in REACT_SYSTEM_PROMPT


def test_react_system_prompt_contains_material_rule():
    """铁律：材质必须可触摸。"""
    from app.agent.llm import REACT_SYSTEM_PROMPT
    assert "可触摸" in REACT_SYSTEM_PROMPT


def test_react_system_prompt_contains_word_count_rule():
    """铁律：字数硬性范围。"""
    from app.agent.llm import REACT_SYSTEM_PROMPT
    assert "400-600" in REACT_SYSTEM_PROMPT or "400" in REACT_SYSTEM_PROMPT
    assert "500-800" in REACT_SYSTEM_PROMPT or "500" in REACT_SYSTEM_PROMPT


def test_react_system_prompt_distinguishes_source_from_script():
    """铁律：小说/长文本（输入） vs 脚本（输出）的概念边界。

    背景：用户反馈 agent 弄不清"什么是小说/长文本、什么是脚本"。
    脚本 = 对长文本/小说的结构化分场解析产物，不能凭空生成。
    REACT_SYSTEM_PROMPT 必须显式声明这个层级关系，否则 LLM 会把 user_goal
    当成 long_text 直接喂给 generate_script。
    """
    from app.agent.llm import REACT_SYSTEM_PROMPT
    # 必须有一段"素材 vs 脚本"的明确章节
    assert "素材" in REACT_SYSTEM_PROMPT
    assert "脚本" in REACT_SYSTEM_PROMPT
    # 必须同时提到输入（小说/长文本/long_text/novel）和输出（脚本/script）
    # 用 "输入" 和 "输出" 标签更稳
    assert "输入" in REACT_SYSTEM_PROMPT and "输出" in REACT_SYSTEM_PROMPT
    # 必须明确"脚本是依据 long_text 生成的"
    assert "long_text" in REACT_SYSTEM_PROMPT or "长文本" in REACT_SYSTEM_PROMPT
    # 必须禁止把 user_goal 当 long_text 喂给 generate_script
    assert "凭空" in REACT_SYSTEM_PROMPT or "不能" in REACT_SYSTEM_PROMPT


def test_react_system_prompt_mandates_ask_user_when_source_missing():
    """铁律：用户没给素材却要求生成脚本时，必须先 ask_user 索要。"""
    from app.agent.llm import REACT_SYSTEM_PROMPT
    # 必须有"先 ask_user / 必须先 / 索要"这类先决条件表达
    assert "ask_user" in REACT_SYSTEM_PROMPT
    # 不能再像旧版那样说"完整短剧：走完整流程"而隐含允许无源生成
    snippet = "脚本不能凭空" in REACT_SYSTEM_PROMPT or "必须先" in REACT_SYSTEM_PROMPT or "先 ask_user" in REACT_SYSTEM_PROMPT
    assert snippet, "REACT_SYSTEM_PROMPT 必须明确：没素材时先 ask_user"


def test_build_system_prompt_still_returns_react_prompt():
    """build_system_prompt() 仍返回 REACT_SYSTEM_PROMPT（向后兼容）。"""
    from app.agent.llm import REACT_SYSTEM_PROMPT, build_system_prompt
    assert build_system_prompt() == REACT_SYSTEM_PROMPT


def test_react_prompt_preserves_completed_script_checkpoint():
    """下游提取失败后，不得忽略已生成脚本并重新索要原始素材。"""
    from app.agent.llm import REACT_SYSTEM_PROMPT

    assert "已有 script" in REACT_SYSTEM_PROMPT
    assert "不得重新索要原始素材" in REACT_SYSTEM_PROMPT
    assert "失败的 extract" in REACT_SYSTEM_PROMPT


def test_asset_intelligence_policy_separates_visual_and_text_assets():
    from app.agent.llm import ASSET_INTELLIGENCE_POLICY

    assert "image/video" in ASSET_INTELLIGENCE_POLICY
    assert "read_text_asset" in ASSET_INTELLIGENCE_POLICY
    assert "Never call inspect_asset for novel or script" in ASSET_INTELLIGENCE_POLICY


# ========================
# GenerateScriptTool 描述：输入/输出边界
# ========================

def test_generate_script_description_marks_long_text_as_input():
    """generate_script 工具描述必须把 long_text 标为输入、script 标为输出。"""
    desc = GenerateScriptTool().description
    assert "long_text" in desc or "长文本" in desc
    # 必须有"输入"和"输出"语义（避免 LLM 把它当成对等概念）
    assert "输入" in desc
    assert "输出" in desc
    # 必须明确脚本是长文本的解析产物
    assert "解析" in desc or "拆解" in desc or "拆分" in desc


def test_generate_script_description_marks_source_kind_meaning():
    """source_kind 必须在描述中说明 novel vs long_text 的语义差异。"""
    desc = GenerateScriptTool().description
    # novel 与 long_text 两个取值都要出现
    assert "novel" in desc
    assert "long_text" in desc
    # 必须说明 novel=小说原文、long_text=其它长文本
    assert "小说" in desc
    # 至少一个 long_text 类型的例子
    assert any(k in desc for k in ["宣传片", "广告", "新闻稿", "文案", "梗概", "原文"])


def test_generate_script_description_warns_against_no_source():
    """描述必须明确：本工具不能凭空生成脚本（无 long_text 时禁止调用）。"""
    desc = GenerateScriptTool().description
    # 任意一个强约束词
    assert any(k in desc for k in ["不能", "必须", "禁止", "不要", "先有", "需要"])


# ========================
# DramaShort 完整流水线：把"起始节点"的隐式流程写进 agent 显式知识
# ========================
#
# 背景：原来"起始节点"（canvas 上的 PipelineNode）有清晰的 7 步流程：
#   preprocessing → script → characters → props → scenes → storyboard → video
# 但 agent 的 REACT_SYSTEM_PROMPT "【任务流程选择】" 段只写
# "parse_user_goal → create_plan → generate_script → extract_* → generate_*_image → generate_video"
# 把中间的 extract_* / generate_*_image 写成占位符，agent 容易漏步或乱序。
#
# 修复：把完整 9 步流程显式写进 system prompt 和 create_plan 提示词，
# 确保 drama_short 类任务一定按相同顺序走完（与起始节点一致）。


def test_react_system_prompt_documents_full_drama_short_pipeline():
    """REACT_SYSTEM_PROMPT 必须把 drama_short 的完整流水线显式列出来。"""
    from app.agent.llm import REACT_SYSTEM_PROMPT
    # 关键工具名都必须出现（按顺序）
    required_tools = [
        "generate_script",     # 1. 脚本
        "extract_characters",  # 2. 提取角色
        "generate_character_portrait",  # 3. 角色图
        "extract_props",       # 4. 提取道具
        "generate_prop_image", # 5. 道具图
        "extract_scenes",      # 6. 提取场景
        "generate_scene_image",# 7. 场景图
        "extract_shots",       # 8. 提取分镜
        "generate_storyboard_image",  # 9. 分镜图
        "generate_video",      # 10. 视频
    ]
    for tool in required_tools:
        assert tool in REACT_SYSTEM_PROMPT, (
            f"REACT_SYSTEM_PROMPT 必须显式提到 {tool}（drama_short 流水线必备步骤）"
        )


def test_react_system_prompt_documents_script_to_extract_pipeline():
    """REACT_SYSTEM_PROMPT 必须明确：script → 提取 → 生成图 的依赖关系。

    防止 agent 在 generate_script 还没产出 characters/props/scenes/bigShots 之前
    提前调 extract_*；或在 extract_* 还没拿到结构化数据前调 generate_*_image。
    """
    from app.agent.llm import REACT_SYSTEM_PROMPT
    # 关键短语 "script → extract" 形式（任意表达）
    assert "script" in REACT_SYSTEM_PROMPT
    # 任意一个表达"基于"或"先有"的连接词，把 extract 跟 script 绑住
    binding_patterns = [
        "script →",
        "script->",
        "基于 script",
        "基于脚本",
        "脚本→",
        "先有脚本",
        "script 之后",
        "脚本之后",
    ]
    assert any(p in REACT_SYSTEM_PROMPT for p in binding_patterns), (
        "REACT_SYSTEM_PROMPT 必须把 extract 步骤明确绑在 script 之后（防乱序）"
    )


def test_react_system_prompt_mentions_starting_node_as_pipeline_source():
    """REACT_SYSTEM_PROMPT 必须把"起始节点"作为 drama_short 流水线的入口声明。

    "起始节点" = canvas 上的 PipelineNode，含 novel/idea 输入文本。
    agent 在 drama_short 任务里应当把它视为 long_text 的来源之一。
    """
    from app.agent.llm import REACT_SYSTEM_PROMPT
    # 必须出现 "起始节点" 这个词（或等价物）
    has_entry = any(
        token in REACT_SYSTEM_PROMPT
        for token in ("起始节点", "PipelineNode", "pipeline", "起始", "起点", "入口")
    )
    assert has_entry, (
        "REACT_SYSTEM_PROMPT 必须提到起始节点（或等价物）作为 drama_short 流水线的入口"
    )


def test_create_plan_system_prompt_documents_drama_short_pipeline():
    """CREATE_PLAN_SYSTEM_PROMPT 也必须列出 drama_short 的完整工具序列。

    防止 create_plan 生成的计划漏掉中间步骤（只列 extract_* 占位符）。
    """
    from app.agent.tools.planning import CREATE_PLAN_SYSTEM_PROMPT
    required_tools = [
        "generate_script",
        "extract_characters",
        "extract_props",
        "extract_scenes",
        "extract_shots",
        "generate_character_portrait",
        "generate_prop_image",
        "generate_scene_image",
        "generate_storyboard_image",
        "generate_video",
    ]
    for tool in required_tools:
        assert tool in CREATE_PLAN_SYSTEM_PROMPT, (
            f"CREATE_PLAN_SYSTEM_PROMPT 必须显式提到 {tool}（drama_short 流水线必备步骤）"
        )


def test_create_plan_system_prompt_binds_script_before_extract():
    """create_plan 必须明确：extract_* 依赖 generate_script 的产物。

    之前提示词里只写"完整短剧走 generate_script → extract_* → generate_*"，
    占位符 extract_* 容易让 LLM 漏掉对脚本产物的依赖。
    """
    from app.agent.tools.planning import CREATE_PLAN_SYSTEM_PROMPT
    # 任意"先 script 再 extract"的依赖表达
    binding_patterns = [
        "script →",
        "script->",
        "基于 script",
        "基于脚本",
        "脚本→",
        "先有脚本",
        "script 之后",
        "脚本之后",
    ]
    assert any(p in CREATE_PLAN_SYSTEM_PROMPT for p in binding_patterns), (
        "CREATE_PLAN_SYSTEM_PROMPT 必须把 extract 步骤明确绑在 script 之后"
    )
