"""TDD: default registry 装卸 18 个工具。"""
import pytest

from app.agent.tools import ALL_TOOLS, build_default_registry
from app.agent.tools.base import BaseTool, ToolRegistry


def test_all_tools_count_is_18():
    """工作室工具合入后，ALL_TOOLS 必须正好 27 个。"""
    assert len(ALL_TOOLS) == 27


def test_all_tools_have_unique_names():
    """所有工具 name 唯一。"""
    names = [cls().name for cls in ALL_TOOLS]
    assert len(set(names)) == 27, f"重复 name: {[n for n in names if names.count(n) > 1]}"


def test_all_tools_have_required_fields():
    """所有工具必须暴露 name/description/category/parameters。"""
    for cls in ALL_TOOLS:
        t = cls()
        assert t.name, f"{cls.__name__}.name 不能为空"
        assert t.description, f"{cls.__name__}.description 不能为空"
        assert t.category, f"{cls.__name__}.category 不能为空"
        assert isinstance(t.parameters, list), f"{cls.__name__}.parameters 必须是 list"
        for p in t.parameters:
            assert p.name, f"{cls.__name__} 有空 name 的 parameter"
            assert p.type, f"{cls.__name__}.{p.name} type 不能为空"


def test_tools_have_valid_categories():
    """工具 category 必须在白名单中。"""
    allowed = {"planning", "llm", "image", "video", "audio", "asset", "studio"}
    for cls in ALL_TOOLS:
        t = cls()
        assert t.category in allowed, f"{t.name} 用了未注册的 category: {t.category}"


def test_build_default_registry_registers_18():
    """build_default_registry 返回的 registry 应有 27 个工具。"""
    registry = build_default_registry()
    assert isinstance(registry, ToolRegistry)
    assert len(registry.list()) == 27


def test_build_default_registry_categories():
    """registry.categories() 应包含所有 6 个分类。"""
    registry = build_default_registry()
    cats = set(registry.categories())
    assert cats == {"planning", "llm", "image", "video", "audio", "asset", "studio"}


def test_build_default_registry_only_filter():
    """only 参数应只注册过滤后的工具。"""
    registry = build_default_registry(only=["parse_user_goal", "ask_user"])
    assert len(registry.list()) == 2
    assert registry.get("parse_user_goal") is not None
    assert registry.get("ask_user") is not None
    assert registry.get("generate_script") is None


def test_registry_to_openai_schema_lists_all_18():
    """to_openai_schema 应能为 27 个工具生成 function calling schema。"""
    registry = build_default_registry()
    schemas = registry.to_openai_schema()
    assert len(schemas) == 27
    for s in schemas:
        assert s["type"] == "function"
        assert "name" in s["function"]
        assert "description" in s["function"]
        assert "parameters" in s["function"]
        assert s["function"]["parameters"]["type"] == "object"


def test_planning_tools_count():
    """3 个 planning 工具。"""
    registry = build_default_registry()
    assert len(registry.list(category="planning")) == 3


def test_llm_tools_count():
    """7 个 llm 工具。"""
    registry = build_default_registry()
    assert len(registry.list(category="llm")) == 7


def test_image_tools_count():
    """4 个 image 工具。"""
    registry = build_default_registry()
    assert len(registry.list(category="image")) == 5


def test_video_tools_count():
    """1 个 video 工具。"""
    registry = build_default_registry()
    assert len(registry.list(category="video")) == 1


def test_audio_tools_count():
    """2 个 audio 工具。"""
    registry = build_default_registry()
    assert len(registry.list(category="audio")) == 2


def test_asset_tools_count():
    """7 个 asset 工具（SaveAsset + GetArtifacts + ReadTextAsset + UpdateTextAsset + InspectAsset + PrepareCharacterAsset + SearchProjectAssets）。"""
    registry = build_default_registry()
    assert len(registry.list(category="asset")) == 7


def test_all_categories_sum_to_18():
    """所有分类工具数加起来等于 27。"""
    registry = build_default_registry()
    total = sum(len(registry.list(category=c)) for c in registry.categories())
    assert total == 27
