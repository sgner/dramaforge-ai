"""工具模块：18 个原子能力。

分类：
- planning (3): parse_user_goal, create_plan, ask_user
- llm (6): generate_script, extract_characters, extract_props, extract_scenes, extract_shots, optimize_prompt
- image (4): generate_character_portrait, generate_prop_image, generate_scene_image, generate_storyboard_image
- video (1): generate_video
- audio (2): generate_voiceover, generate_bgm
- asset (2): save_asset, get_artifacts

总计 18 个。
"""
from .base import (
    BaseTool,
    NonRetryableError,
    RetryableError,
    ToolContext,
    ToolError,
    ToolParameter,
    ToolRegistry,
    ToolValidationError,
)
from .planning import (
    AskUserTool,
    CreatePlanTool,
    ParseUserGoalTool,
)
from .llm_tools import (
    ExtractCharactersTool,
    ExtractPropsTool,
    ExtractScenesTool,
    ExtractShotsTool,
    GenerateScriptTool,
    OptimizePromptTool,
)
from .image_tools import (
    GenerateCharacterPortraitTool,
    GeneratePropImageTool,
    GenerateSceneImageTool,
    GenerateStoryboardImageTool,
)
from .video_tools import GenerateVideoTool
from .audio_tools import GenerateBgmTool, GenerateVoiceoverTool
from .asset_tools import GetArtifactsTool, SaveAssetTool


# 18 个工具的元组，便于注册
ALL_TOOLS: tuple[type[BaseTool], ...] = (
    # planning
    ParseUserGoalTool,
    CreatePlanTool,
    AskUserTool,
    # llm
    GenerateScriptTool,
    ExtractCharactersTool,
    ExtractPropsTool,
    ExtractScenesTool,
    ExtractShotsTool,
    OptimizePromptTool,
    # image
    GenerateCharacterPortraitTool,
    GeneratePropImageTool,
    GenerateSceneImageTool,
    GenerateStoryboardImageTool,
    # video
    GenerateVideoTool,
    # audio
    GenerateVoiceoverTool,
    GenerateBgmTool,
    # asset
    SaveAssetTool,
    GetArtifactsTool,
)


def build_default_registry(only: list[str] | None = None) -> ToolRegistry:
    """构建默认工具注册表。

    only: 可选，按 name 过滤（用于测试 / 精细控制）。
    """
    registry = ToolRegistry()
    for cls in ALL_TOOLS:
        if only and cls().name not in only:
            continue
        registry.register(cls())
    return registry


def list_tool_metadata() -> list[dict]:
    """导出 18 个工具的元数据给前端 ToolPalette。"""
    from .base import BaseTool
    out: list[dict] = []
    for cls in ALL_TOOLS:
        inst = cls()
        if not isinstance(inst, BaseTool):
            continue
        out.append({
            "name": inst.name,
            "description": inst.description,
            "category": inst.category,
            "requires_approval": bool(getattr(inst, "requires_approval", False)),
        })
    return out


__all__ = [
    "BaseTool",
    "ToolContext",
    "ToolParameter",
    "ToolRegistry",
    "ToolError",
    "ToolValidationError",
    "RetryableError",
    "NonRetryableError",
    # planning
    "ParseUserGoalTool",
    "CreatePlanTool",
    "AskUserTool",
    # llm
    "GenerateScriptTool",
    "ExtractCharactersTool",
    "ExtractPropsTool",
    "ExtractScenesTool",
    "ExtractShotsTool",
    "OptimizePromptTool",
    # image
    "GenerateCharacterPortraitTool",
    "GeneratePropImageTool",
    "GenerateSceneImageTool",
    "GenerateStoryboardImageTool",
    # video
    "GenerateVideoTool",
    # audio
    "GenerateVoiceoverTool",
    "GenerateBgmTool",
    # asset
    "SaveAssetTool",
    "GetArtifactsTool",
    "ALL_TOOLS",
    "build_default_registry",
    "list_tool_metadata",
]
