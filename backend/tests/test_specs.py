"""TDD: specs.py 规范加载与按工具分区提取。"""
from __future__ import annotations

import pytest

from app.agent import specs


# ========================
# 公共 fixture：每个测试清理模块级缓存
# ========================

@pytest.fixture(autouse=True)
def _clear_caches():
    specs._file_cache.clear()
    specs._spec_cache.clear()
    yield
    specs._file_cache.clear()
    specs._spec_cache.clear()


# ========================
# _load_file
# ========================

def test_load_file_returns_content_when_exists():
    """真实 docs/ 下 asset_master 文件存在时返回非空字符串。"""
    content = specs._load_file("asset_master")
    assert content
    assert "B.1" in content  # 全资产大师包含 B.1 发型章节


def test_load_file_returns_empty_when_missing_key():
    """未注册的 key 返回空字符串。"""
    assert specs._load_file("not_a_real_key") == ""


def test_load_file_caches_second_call(tmp_path, monkeypatch):
    """第二次调用从 _file_cache 读取，不再访问磁盘。"""
    fake_dir = tmp_path
    (fake_dir / "视频提示词模板.md").write_text("第一次内容", encoding="utf-8")
    monkeypatch.setattr(specs, "_DOCS_DIR", fake_dir)

    first = specs._load_file("video_prompt")
    assert first == "第一次内容"

    # 改磁盘内容，缓存应仍返回旧值
    (fake_dir / "视频提示词模板.md").write_text("第二次内容", encoding="utf-8")
    second = specs._load_file("video_prompt")
    assert second == "第一次内容"


def test_load_file_returns_empty_on_unicode_error(tmp_path, monkeypatch):
    """文件编码错误时返回空字符串，不抛异常。"""
    fake_dir = tmp_path
    (fake_dir / "视频提示词模板.md").write_bytes(b"\xff\xfe\x00\x01")  # 非 UTF-8
    monkeypatch.setattr(specs, "_DOCS_DIR", fake_dir)
    assert specs._load_file("video_prompt") == ""


# ========================
# _extract_between
# ========================

def test_extract_between_with_end_pattern():
    content = "A.1 标题\n内容1\nA.2 下一个\n内容2"
    result = specs._extract_between(content, r'^A\.1\s', r'^A\.2\s')
    assert "A.1 标题" in result
    assert "内容1" in result
    assert "A.2" not in result


def test_extract_between_without_end_pattern():
    content = "## §1 视听\n内容\n## §2 其他"
    result = specs._extract_between(content, r'^##\s§1\s', None)
    assert "§1 视听" in result
    assert "内容" in result
    assert "§2" in result  # 没结束正则，提取到末尾


def test_extract_between_no_start_match_returns_empty():
    content = "some random text"
    assert specs._extract_between(content, r'^Z\.9\s', r'^A\.\d') == ""


# ========================
# get_spec_for_tool — 缓存 + 未知工具
# ========================

def test_get_spec_for_unknown_tool_returns_empty():
    assert specs.get_spec_for_tool("not_a_tool") == ""


def test_get_spec_for_tool_caches_result():
    """第二次调用应命中 _spec_cache，不再触发 builder。"""
    result1 = specs.get_spec_for_tool("extract_characters")
    # 手动污染 cache 检测是否被使用
    specs._spec_cache["extract_characters"] = "CACHED_FAKE"
    result2 = specs.get_spec_for_tool("extract_characters")
    assert result2 == "CACHED_FAKE"
    assert result1 != "CACHED_FAKE"


# ========================
# 端到端：每个 builder 从真实 docs/ 提取
# ========================

def test_extract_characters_spec_contains_face_anchors():
    """B.3 必填字段包含面容锚点（脸型/眉形/骨相等）。"""
    spec = specs.get_spec_for_tool("extract_characters")
    assert spec, "extract_characters spec 不应为空（docs 文件应存在）"
    # 面容锚点至少命中一个
    assert any(k in spec for k in ["脸型", "眉形", "骨相", "瞳", "唇"]), (
        "spec 应包含面容锚点字段，实际：\n" + spec[:500]
    )


def test_extract_characters_spec_contains_clothing_layers():
    """B.2 服装六层结构。"""
    spec = specs.get_spec_for_tool("extract_characters")
    assert any(k in spec for k in ["服装", "六层", "层"]), "spec 应包含服装结构"


def test_extract_characters_spec_contains_hairstyle_rules():
    """B.1 发型规则。"""
    spec = specs.get_spec_for_tool("extract_characters")
    assert any(k in spec for k in ["发型", "造型"]), "spec 应包含发型规则"


def test_extract_characters_spec_contains_prohibitions():
    """B.6 角色禁止事项。"""
    spec = specs.get_spec_for_tool("extract_characters")
    assert any(k in spec for k in ["禁止", "不准", "不得"]), "spec 应包含禁止事项"


def test_extract_props_spec_contains_classification():
    """C.1 道具分类。"""
    spec = specs.get_spec_for_tool("extract_props")
    assert spec
    assert any(k in spec for k in ["分类", "类目", "类别"]), "spec 应包含分类"


def test_extract_props_spec_contains_required_fields():
    """C.2 必填字段。"""
    spec = specs.get_spec_for_tool("extract_props")
    assert any(k in spec for k in ["必填", "字段", "材质"]), "spec 应包含必填字段"


def test_extract_props_spec_contains_prohibitions():
    """C.5 道具禁止事项。"""
    spec = specs.get_spec_for_tool("extract_props")
    assert any(k in spec for k in ["禁止", "不准", "不得"]), "spec 应包含禁止事项"


def test_extract_scenes_spec_contains_character_adaptation():
    """A.1.1 场景人物硬约束。"""
    spec = specs.get_spec_for_tool("extract_scenes")
    assert spec
    assert any(k in spec for k in ["人物", "适配", "硬约束"]), "spec 应包含场景人物适配"


def test_extract_scenes_spec_contains_seven_layers():
    """A.2 七层递进模板。"""
    spec = specs.get_spec_for_tool("extract_scenes")
    assert any(k in spec for k in ["七层", "递进", "层"]), "spec 应包含七层结构"


def test_extract_scenes_spec_contains_color_management():
    """A.4 色彩管理。"""
    spec = specs.get_spec_for_tool("extract_scenes")
    assert any(k in spec for k in ["色彩", "颜色"]), "spec 应包含色彩管理"


def test_extract_shots_spec_contains_video_directions():
    """§3.4 方向标 + §3.5 运动方向。"""
    spec = specs.get_spec_for_tool("extract_shots")
    assert spec
    assert any(k in spec for k in ["方向", "运动", "镜头"]), "spec 应包含方向/运动规范"


def test_optimize_prompt_spec_contains_cineforge_constraints():
    """§0.4 跨模型兼容硬约束。"""
    spec = specs.get_spec_for_tool("optimize_prompt")
    assert spec
    assert any(k in spec for k in ["跨模型", "兼容", "硬约束"]), (
        "spec 应包含跨模型兼容，实际：\n" + spec[:500]
    )


def test_optimize_prompt_spec_contains_sensitive_words():
    """§5 敏感词。"""
    spec = specs.get_spec_for_tool("optimize_prompt")
    assert any(k in spec for k in ["敏感", "违禁", "过滤"]), "spec 应包含敏感词"


def test_optimize_prompt_spec_contains_quality_tail():
    """A.1.2 画质技术尾缀。"""
    spec = specs.get_spec_for_tool("optimize_prompt")
    assert any(k in spec for k in ["画质", "尾缀", "技术"]), "spec 应包含画质尾缀"


def test_generate_script_spec_contains_audiovisual_signature():
    """分镜解析 §1 视听签名。"""
    spec = specs.get_spec_for_tool("generate_script")
    assert spec
    assert any(k in spec for k in ["视听", "签名", "节奏"]), "spec 应包含视听签名"


def test_image_character_spec_contains_concept_layout():
    """B.4 概念表布局。"""
    spec = specs.get_spec_for_tool("image_character")
    assert spec
    assert any(k in spec for k in ["概念", "布局", "视图"]), "spec 应包含概念表布局"


def test_image_scene_spec_contains_material_standard():
    """A.3 材质可触摸标准。"""
    spec = specs.get_spec_for_tool("image_scene")
    assert any(k in spec for k in ["材质", "可触摸", "触摸"]), "spec 应包含材质标准"


def test_image_prop_spec_contains_composition():
    """C.3 道具构图规范。"""
    spec = specs.get_spec_for_tool("image_prop")
    assert any(k in spec for k in ["构图", "视图", "布局"]), "spec 应包含构图规范"


def test_image_storyboard_spec_contains_storyboard_rules():
    """§4 故事板规范。"""
    spec = specs.get_spec_for_tool("image_storyboard")
    assert spec
    assert any(k in spec for k in ["故事板", "frozen", "帧"]), "spec 应包含故事板规范"


# ========================
# Fallback：docs/ 缺失时所有 builder 返回空
# ========================

def test_all_builders_return_empty_when_docs_missing(tmp_path, monkeypatch):
    monkeypatch.setattr(specs, "_DOCS_DIR", tmp_path)  # 空目录
    for tool in [
        "generate_script", "extract_characters", "extract_props", "extract_scenes",
        "extract_shots", "optimize_prompt",
        "image_character", "image_scene", "image_prop", "image_storyboard",
    ]:
        assert specs.get_spec_for_tool(tool) == "", f"{tool} 应在 docs 缺失时返回空"
