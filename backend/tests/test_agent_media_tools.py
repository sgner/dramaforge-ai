"""TDD: 媒体工具（image / video / audio）。"""
import json
import pytest

from app.agent.tools.base import ToolContext, ToolValidationError
from app.agent.media_service import MediaRequest, MediaResult, StubMediaService
from app.agent.tools.image_tools import (
    GenerateCharacterPortraitTool,
    GeneratePropImageTool,
    GenerateSceneImageTool,
    GenerateStoryboardImageTool,
)
from app.agent.tools.video_tools import GenerateVideoTool
from app.agent.tools.audio_tools import GenerateVoiceoverTool, GenerateBgmTool


def _stub_ctx():
    return ToolContext(task_id="t1", media_service=StubMediaService())


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
