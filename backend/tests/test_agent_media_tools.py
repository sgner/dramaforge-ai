"""TDD: 媒体工具（image / video / audio）。"""
import json
import pytest

from app.agent.tools.base import ToolContext, ToolValidationError
from app.agent.media_service import MediaRequest, MediaResult, StubMediaService, MediaServiceError, get_default_media_service
from app.agent.tools.image_tools import (
    GenerateCharacterPortraitTool,
    GeneratePropImageTool,
    GenerateSceneImageTool,
    GenerateStoryboardImageTool,
    _build_character_prompt,
    _build_prop_prompt,
    _build_scene_prompt,
    _build_storyboard_prompt,
    _sanitize_structured_field,
    CHARACTER_DESIGN_SHEET_PROMPT,
)
from app.agent.tools.video_tools import GenerateVideoTool, _build_video_prompt
from app.agent.tools.audio_tools import GenerateVoiceoverTool, GenerateBgmTool
from app.agent.llm import LLMResponse
from app.agent.prompt_engineering import collect_storyboard_reference_asset_ids, optimize_generation_prompt


def _stub_ctx():
    class PromptLLM:
        model = "test-prompt-model"

        async def generate(self, messages, **kwargs):
            return LLMResponse(content="optimized: " + messages[-1]["content"])

    return ToolContext(task_id="t1", llm_client=PromptLLM(), media_service=StubMediaService())


@pytest.mark.asyncio
async def test_default_media_service_does_not_return_test_data():
    with pytest.raises(MediaServiceError, match="media provider"):
        await get_default_media_service().generate(MediaRequest(kind="image", prompt="x"))


# ========================
# Image tools
# ========================

def test_generate_character_portrait_metadata():
    t = GenerateCharacterPortraitTool()
    assert t.name == "generate_character_portrait"
    assert t.category == "image"
    assert t.requires_approval is True
    assert "character" in {p.name for p in t.parameters}


@pytest.mark.asyncio
async def test_generate_character_portrait_returns_url():
    ctx = _stub_ctx()
    result = await GenerateCharacterPortraitTool().call(ctx, {
        "character": {"name": "林尘", "appearance": "25岁男生"},
    })
    assert "url" in result
    assert result["character"] == "林尘"


@pytest.mark.asyncio
async def test_character_provider_prompt_keeps_complete_v30_layout_after_short_optimization():
    class _ShortOptimizer:
        async def generate(self, messages, **kwargs):
            return LLMResponse(content="A Chinese female professional, cinematic realistic style.")

    ctx = ToolContext(
        task_id="t-character-layout",
        llm_client=_ShortOptimizer(),
        media_service=StubMediaService(),
    )
    result = await GenerateCharacterPortraitTool().call(ctx, {
        "character": {"name": "Lead", "gender": "female", "ageRange": "25-30"},
    })

    assert CHARACTER_DESIGN_SHEET_PROMPT in result["prompt"]
    assert "left-right split layout" in result["prompt"]
    assert "left one-third" in result["prompt"]
    assert "right two-thirds" in result["prompt"]
    assert "full-body front standing pose" in result["prompt"]
    assert "side profile view" in result["prompt"]
    assert "back view" in result["prompt"]


@pytest.mark.asyncio
async def test_generate_character_portrait_validation_requires_character():
    ctx = _stub_ctx()
    with pytest.raises(ToolValidationError):
        await GenerateCharacterPortraitTool().call(ctx, {})


def test_generate_prop_image_metadata():
    t = GeneratePropImageTool()
    assert t.name == "generate_prop_image"
    assert t.requires_approval is True


@pytest.mark.asyncio
async def test_generate_prop_image_returns_url():
    ctx = _stub_ctx()
    result = await GeneratePropImageTool().call(ctx, {
        "prop": {"name": "黑色笔记本", "description": "磨损的笔记本"},
    })
    assert "url" in result


def test_generate_scene_image_metadata():
    t = GenerateSceneImageTool()
    assert t.name == "generate_scene_image"
    assert t.requires_approval is True


@pytest.mark.asyncio
async def test_generate_scene_image_returns_url():
    ctx = _stub_ctx()
    result = await GenerateSceneImageTool().call(ctx, {
        "scene": {"name": "咖啡店", "description": "温暖的咖啡店"},
    })
    assert "url" in result


def test_generate_storyboard_image_metadata():
    t = GenerateStoryboardImageTool()
    assert t.name == "generate_storyboard_image"
    assert t.requires_approval is True


@pytest.mark.asyncio
async def test_generate_storyboard_image_returns_url():
    ctx = _stub_ctx()
    result = await GenerateStoryboardImageTool().call(ctx, {
        "shot": {"index": 1, "camera": "中景", "action": "林尘坐下"},
        "characters": [{"name": "林尘"}],
    })
    assert "url" in result


@pytest.mark.asyncio
async def test_generate_storyboard_image_passes_reference_urls_to_media_service():
    class CaptureMediaService:
        def __init__(self):
            self.request = None

        async def generate(self, request):
            self.request = request
            return MediaResult(url="https://cdn.test/storyboard.png", kind="image")

    media = CaptureMediaService()
    ctx = _stub_ctx()
    ctx.media_service = media
    result = await GenerateStoryboardImageTool().call(ctx, {
        "shot": {"index": 1, "camera": "中景", "action": "林尘走入古堡"},
        "characters": [{"name": "林尘"}],
        "scene": {"name": "古堡大厅"},
        "reference_urls": [
            "https://cdn.test/character.png",
            "https://cdn.test/scene.png",
        ],
    })

    assert result["reference_urls"] == [
        "https://cdn.test/character.png",
        "https://cdn.test/scene.png",
    ]
    assert media.request.reference_urls == result["reference_urls"]


def test_storyboard_references_are_resolved_by_role_when_ids_are_omitted():
    """分镜应按场景、角色、道具顺序从当前任务资产中自动找参考图。"""
    params = {
        "shot": {"index": 1, "scene": "古堡大厅", "action": "英雄举剑"},
        "characters": [{"name": "英雄"}],
        "props": [{"name": "长剑"}],
    }
    artifacts = {
        "prop": [{"id": "prop-1", "name": "长剑", "url": "/prop.png"}],
        "character": [{"id": "character-1", "name": "英雄", "url": "/character.png"}],
        "scene": [{"id": "scene-1", "name": "古堡大厅", "url": "/scene.png"}],
    }
    assert collect_storyboard_reference_asset_ids(params, artifacts) == [
        "scene-1", "character-1", "prop-1",
    ]


def test_storyboard_uses_character_prop_scene_mapping_from_shot():
    """脚本解析写进 shot 的归属关系应直接驱动分镜参考图。"""
    params = {
        "shot": {
            "index": 1,
            "scene": "古堡大厅",
            "characters": ["英雄"],
            "props": [{"name": "长剑"}],
        },
    }
    artifacts = {
        "scene": [{"id": "scene-1", "name": "古堡大厅", "url": "/scene.png"}],
        "character": [{"id": "character-1", "name": "英雄", "url": "/hero.png"}],
        "prop": [{"id": "prop-1", "name": "长剑", "url": "/sword.png"}],
    }
    assert collect_storyboard_reference_asset_ids(params, artifacts) == [
        "scene-1", "character-1", "prop-1",
    ]


def test_storyboard_prompt_uses_membership_from_parsed_shot_by_default():
    prompt = _build_storyboard_prompt({
        "index": 1,
        "scene": "castle hall",
        "characters": ["hero", {"name": "guide"}],
        "props": ["longsword"],
        "action": "the hero raises the sword",
    })

    assert "SCENE: castle hall" in prompt
    assert "FEATURING: hero, guide" in prompt
    assert "PROPS: longsword" in prompt


def test_storyboard_explicit_agent_mapping_overrides_shot_mapping():
    """agent 显式调整分镜角色时，应覆盖脚本解析的默认角色映射。"""
    params = {
        "shot": {"scene": "古堡大厅", "characters": ["英雄"], "props": ["长剑"]},
        "characters": [{"name": "反派"}],
    }
    artifacts = {
        "scene": [{"id": "scene-1", "name": "古堡大厅", "url": "/scene.png"}],
        "character": [
            {"id": "hero-1", "name": "英雄", "url": "/hero.png"},
            {"id": "villain-1", "name": "反派", "url": "/villain.png"},
        ],
        "prop": [{"id": "prop-1", "name": "长剑", "url": "/sword.png"}],
    }
    assert collect_storyboard_reference_asset_ids(params, artifacts) == [
        "scene-1", "villain-1", "prop-1",
    ]


@pytest.mark.asyncio
async def test_prompt_optimization_adds_stable_visual_signature_id():
    """所有媒体提示词优化都应收到同一个脚本视觉签名标识。"""
    seen = []

    class _LLM:
        async def generate(self, messages, **kwargs):
            seen.append(messages[1]["content"])
            return LLMResponse(content="optimized")

    signature = {
        "medium": "真人写实",
        "aspectRatio": "16:9",
        "colorIds": ["冷青", "暗红"],
        "coreTheme": "雨夜悬疑",
    }
    ctx = ToolContext(
        task_id="t1",
        llm_client=_LLM(),
        artifacts={"script": [{"extra": {"script": {"visualSignature": signature}}}]},
    )
    await optimize_generation_prompt(ctx, "character prompt", "image", {"asset_kind": "character"})
    await optimize_generation_prompt(ctx, "scene prompt", "image", {"asset_kind": "scene"})

    assert len(seen) == 2
    assert '"visual_signature_id"' in seen[0]
    assert '"visual_signature_id"' in seen[1]
    assert seen[0].split('"visual_signature_id": "', 1)[1].split('"', 1)[0] == seen[1].split('"visual_signature_id": "', 1)[1].split('"', 1)[0]
    assert signature["medium"] in seen[0] and signature["colorIds"][0] in seen[1]


@pytest.mark.asyncio
async def test_prompt_optimization_restores_hard_layout_and_style_to_provider_prompt():
    """A short optimized response must retain layout and visual continuity."""
    class _ShortOptimizer:
        async def generate(self, messages, **kwargs):
            return LLMResponse(content="A contemporary Chinese woman, cinematic realistic style.")

    signature = {"medium": "cinematic realistic", "colorIds": ["warm white", "charcoal gray"]}
    layout = "Character concept sheet, 4-region layout on pure white background"
    ctx = ToolContext(
        task_id="t-layout-contract",
        llm_client=_ShortOptimizer(),
        artifacts={"script": [{"extra": {"script": {"visualSignature": signature}}}]},
    )
    optimized, source = await optimize_generation_prompt(
        ctx,
        "complete character turnaround and four-region concept sheet",
        "image",
        {"asset_kind": "character", "canonical_layout": layout},
    )

    assert source == "complete character turnaround and four-region concept sheet"
    assert layout in optimized
    assert "Visual continuity anchor vs_" in optimized
    assert "cinematic realistic" in optimized


# ========================
# 防御 LLM 思考文本泄漏
# ========================
#
# 历史 bug：LLM 在 think 阶段会规划"最终输出应该是一个英文的细prompt..."
# 之类的话术，并把它塞进 prop.description / scene.description 等结构化字段。
# 这些规划文本随后被 _build_*_prompt 函数原样塞进 source_prompt，最终通过
# 提示词优化写入 asset.prompt，导致画布节点显示"正在规划..."而不是真实提示词。
#
# 修复：_sanitize_structured_field 检测规划文本模式并直接清空该字段，
# 仅保留 LLM 提供的"实体数据"（name/age/gender/appearance 等）。

def test_sanitize_structured_field_rejects_chinese_planning_text():
    planning = "最终输出应该是一个英文的细prompt，包含：时代/世界观、道具类别、整体形制、构图、画质"
    assert _sanitize_structured_field(planning) == ""


def test_sanitize_structured_field_rejects_english_planning_text():
    planning = "The final output should be a detailed English prompt, including: era, prop type, composition, quality"
    assert _sanitize_structured_field(planning) == ""


def test_sanitize_structured_field_keeps_legitimate_description():
    legitimate = "A worn black leather notebook with brass corners and dog-eared pages"
    assert _sanitize_structured_field(legitimate) == legitimate


def test_sanitize_structured_field_handles_empty_input():
    assert _sanitize_structured_field("") == ""
    assert _sanitize_structured_field(None) == ""


def test_build_prop_prompt_drops_planning_text_in_description():
    """LLM 漏 thinking 到 prop.description 时，prop prompt 不应包含规划文本。"""
    prop = {
        "name": "Crystal Ball",
        "description": "最终输出应该是一个英文的细prompt，包含：时代/世界观（矮人）, 道具类别（crystal ball）, 整体形制（fist-sized sphere）",
    }
    prompt = _build_prop_prompt(prop)
    assert "最终输出应该" not in prompt
    assert "Crystal Ball" in prompt


def test_build_scene_prompt_drops_planning_text_in_description():
    scene = {
        "name": "Ancient Library",
        "description": "The final output should be a detailed English prompt, including: era, weather, composition",
    }
    prompt = _build_scene_prompt(scene)
    assert "The final output should" not in prompt
    assert "Ancient Library" in prompt


def test_build_character_prompt_drops_planning_text_in_appearance():
    character = {
        "name": "Lin Chen",
        "appearance": "最终输出应该是一个英文的细prompt，包含：人物、年龄、性别、外观",
        "personality": "calm and determined",
    }
    prompt = _build_character_prompt(character, style="cinematic")
    # planning text must be filtered out
    assert "最终输出应该" not in prompt
    # V3.0 default-fill activates when V3.0 fields are empty → personality
    # is no longer the fallback path (filled defaults count as V3.0 content)
    assert "Lin Chen" in prompt
    # V3.0 header preserved
    assert "Character concept art" in prompt
    # V3.0 face anchor defaults are filled
    assert "Face anchor" in prompt


def test_build_storyboard_prompt_drops_planning_text_in_action():
    shot = {
        "index": 1,
        "camera": "medium shot",
        "movement": "static",
        "action": "The final output should be a detailed English prompt, including: camera, action, scene",
    }
    prompt = _build_storyboard_prompt(shot)
    assert "The final output should" not in prompt


def test_build_video_prompt_drops_planning_text_in_action():
    shot = {
        "index": 1,
        "camera": "medium shot",
        "movement": "static",
        "action": "最终输出应该是一个英文的细prompt，包含：人物、动作、构图、画质",
    }
    prompt = _build_video_prompt(shot)
    assert "最终输出应该" not in prompt
    assert "medium shot" in prompt  # 合法字段保留


# ========================
# Video tool
# ========================

def test_generate_video_metadata():
    t = GenerateVideoTool()
    assert t.name == "generate_video"
    assert t.category == "video"
    assert t.requires_approval is True
    assert "shot" in {p.name for p in t.parameters}


@pytest.mark.asyncio
async def test_generate_video_returns_url():
    ctx = _stub_ctx()
    result = await GenerateVideoTool().call(ctx, {
        "shot": {"scene": "咖啡店", "action": "林尘坐下", "duration_sec": 5},
    })
    assert "url" in result


# ========================
# Audio tools
# ========================

def test_generate_voiceover_metadata():
    t = GenerateVoiceoverTool()
    assert t.name == "generate_voiceover"
    assert t.category == "audio"
    assert t.requires_approval is True


@pytest.mark.asyncio
async def test_generate_voiceover_returns_url():
    ctx = _stub_ctx()
    result = await GenerateVoiceoverTool().call(ctx, {
        "text": "你好，欢迎来到我的咖啡店",
        "voice": "male_calm",
    })
    assert "url" in result


def test_generate_bgm_metadata():
    t = GenerateBgmTool()
    assert t.name == "generate_bgm"
    assert t.category == "audio"
    assert t.requires_approval is True


@pytest.mark.asyncio
async def test_generate_bgm_returns_url():
    ctx = _stub_ctx()
    result = await GenerateBgmTool().call(ctx, {
        "mood": "温暖",
        "duration_sec": 60,
    })
    assert "url" in result


# ========================
# Unique names
# ========================

def test_media_tools_have_unique_names():
    tools = [
        GenerateCharacterPortraitTool(),
        GeneratePropImageTool(),
        GenerateSceneImageTool(),
        GenerateStoryboardImageTool(),
        GenerateVideoTool(),
        GenerateVoiceoverTool(),
        GenerateBgmTool(),
    ]
    names = [t.name for t in tools]
    assert len(set(names)) == 7


def test_all_media_tools_require_approval():
    """image/video/audio 工具都需要用户审核（成本高 / 不可逆）。"""
    tools = [
        GenerateCharacterPortraitTool(),
        GeneratePropImageTool(),
        GenerateSceneImageTool(),
        GenerateStoryboardImageTool(),
        GenerateVideoTool(),
        GenerateVoiceoverTool(),
        GenerateBgmTool(),
    ]
    for t in tools:
        assert t.requires_approval is True, f"{t.name} should require approval"
