# Agent 提示词规范注入 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 agent 模式（6 个 LLM 工具 + 4 个图像 prompt builder + ReAct 主提示词）通过 specs.py 从 `docs/` 规范文件按工具分区注入章节，使 agent 生成的资产质量与手动流水线一致。

**Architecture:** 新建 `backend/app/agent/specs.py` 作为规范加载/分区/缓存层，对外暴露 `get_spec_for_tool(tool_name)`；6 个 LLM 工具的 `execute()` 在 system prompt 末尾追加规范段；4 个 `_build_*_prompt` 函数在 parts 末尾追加对应规范；`REACT_SYSTEM_PROMPT` 末尾追加项目规范铁律总览。规范文件懒加载 + 模块级缓存，docs/ 缺失时全部 fallback 为空字符串，agent 仍可运行。

**Tech Stack:** Python 3.11+ / FastAPI / pytest（asyncio） / pathlib / re（标准库）。无新增依赖。

## Global Constraints

- **不改工具接口**：所有工具的 `name` / `parameters` / `validate` / 返回值结构保持不变，只改 system prompt 内容。
- **不改前端**：本次只动后端（`backend/app/agent/` 与 `backend/tests/`）。
- **不改 ReAct 主循环**：`build_react_prompt` 的拼装逻辑不动，只改 `REACT_SYSTEM_PROMPT` 常量文本。
- **fallback 必须静默**：docs/ 文件缺失或章节正则不匹配时返回空字符串，不抛异常、不打印 stack trace。
- **缓存模块级**：`_file_cache` / `_spec_cache` 是模块级 dict，进程生命周期内有效；测试需手动清理。
- **测试命令**：`cd backend && python -m pytest tests/test_specs.py -v` 和 `cd backend && python -m pytest tests/test_agent_prompt_injection.py -v`。
- **commit message 用英文**，前缀 `feat:` / `test:` / `refactor:`。
- **不读 constants.ts**：规范仅来自 `docs/【资产库】全资产大师V3.0_场景+角色+道具_万能版.txt`、`docs/视频提示词模板.md`、`docs/分镜解析.md` 三个文件。

---

## File Structure

| 文件 | 操作 | 责任 |
|------|------|------|
| `backend/app/agent/specs.py` | Create | 规范加载 + 章节提取 + 10 个 builder + `get_spec_for_tool` 公开 API |
| `backend/tests/test_specs.py` | Create | specs.py 的单元测试（含缓存清理 fixture、mock docs dir、真实 docs 端到端） |
| `backend/app/agent/tools/llm_tools.py` | Modify | 6 个工具的 `execute()` 在 system prompt 后追加规范段 |
| `backend/tests/test_agent_prompt_injection.py` | Create | 集成测试：捕获 LLM 收到的 system prompt，断言包含规范关键字段 |
| `backend/app/agent/tools/image_tools.py` | Modify | 4 个 `_build_*_prompt` 函数在 parts 末尾追加对应规范 |
| `backend/app/agent/llm.py` | Modify | `REACT_SYSTEM_PROMPT` 末尾追加【项目规范】铁律段 |

---

## Task 1: 创建 specs.py 核心 + 10 个 builder 函数 + 单元测试

**Files:**
- Create: `backend/app/agent/specs.py`
- Test: `backend/tests/test_specs.py`

**Interfaces:**
- Consumes: 无（独立模块，仅依赖 `pathlib` + `re` 标准库 + `docs/` 文件）
- Produces:
  - `get_spec_for_tool(tool_name: str) -> str` —— 公开 API，返回该工具对应的规范摘要字符串；未知工具或文件缺失时返回 `""`。
  - 内部常量 `_DOCS_DIR` / `_SPEC_FILES` / `_file_cache` / `_spec_cache`。
  - 内部函数 `_load_file(key)` / `_extract_between(content, start_regex, end_regex=None)` / `_TOOL_SPEC_BUILDERS` dict。
  - 10 个 builder：`_build_generate_script_spec` / `_build_extract_characters_spec` / `_build_extract_props_spec` / `_build_extract_scenes_spec` / `_build_extract_shots_spec` / `_build_optimize_prompt_spec` / `_build_image_character_spec` / `_build_image_scene_spec` / `_build_image_prop_spec` / `_build_image_storyboard_spec`。

- [ ] **Step 1: 写 specs.py 单元测试（完整失败态测试集）**

Create `backend/tests/test_specs.py`:

```python
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
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd backend && python -m pytest tests/test_specs.py -v`
Expected: FAIL —— `ModuleNotFoundError: No module named 'app.agent.specs'` 或 `ImportError`。

- [ ] **Step 3: 实现 specs.py 完整代码**

Create `backend/app/agent/specs.py`:

```python
"""Agent 提示词规范注入：从 docs/ 加载规范文件，按工具分区提取章节，注入到系统提示词。

公开 API：
- get_spec_for_tool(tool_name) -> str  返回该工具对应的规范摘要；未知工具或文件缺失返回 ""。

设计要点：
- 懒加载 + 模块级缓存（_file_cache / _spec_cache）
- docs/ 文件缺失或编码错误时静默返回空字符串，agent 仍可运行
- 章节用正则匹配，不依赖行号
"""
from __future__ import annotations

import re
from pathlib import Path

# ========================
# 配置
# ========================

# docs/ 目录：specs.py 位于 backend/app/agent/specs.py
# 向上 4 层：specs.py -> agent -> app -> backend -> project_root
_DOCS_DIR = Path(__file__).parent.parent.parent.parent.parent / "docs"

_SPEC_FILES = {
    "asset_master": "【资产库】全资产大师V3.0_场景+角色+道具_万能版.txt",
    "video_prompt": "视频提示词模板.md",
    "shotlist": "分镜解析.md",
}

# 缓存：file_key -> 文件全文
_file_cache: dict[str, str] = {}

# 缓存：tool_name -> 规范摘要
_spec_cache: dict[str, str] = {}

# 章节结束正则：下一个同级或更高级标题
_ASSET_END = r'^[A-Z]\.\d'  # 匹配 A.1 / B.2 / C.3 等
_VIDEO_END = r'^#{1,2}\s'  # 匹配 # 或 ## 开头
_SHOTLIST_END = r'^#{1,2}\s'


# ========================
# 文件加载
# ========================

def _load_file(key: str) -> str:
    """加载规范文件，带缓存。文件不存在/编码错误/未注册 key 都返回空字符串。"""
    if key in _file_cache:
        return _file_cache[key]
    filename = _SPEC_FILES.get(key)
    if not filename:
        return ""
    path = _DOCS_DIR / filename
    if not path.exists():
        return ""
    try:
        content = path.read_text(encoding="utf-8")
    except UnicodeDecodeError:
        return ""
    _file_cache[key] = content
    return content


# ========================
# 章节提取
# ========================

def _extract_between(content: str, start_regex: str, end_regex: str | None = None) -> str:
    """从 content 中提取 start_regex 匹配处到 end_regex 匹配处之间的文本。

    - start_regex 必须匹配，否则返回空字符串
    - end_regex 为 None 时提取到文件末尾
    - end_regex 在 start 之后搜索；若未找到，提取到文件末尾
    - 返回的文本已 strip()
    """
    start_match = re.search(start_regex, content, re.MULTILINE)
    if not start_match:
        return ""
    start_pos = start_match.start()
    if end_regex:
        rest = content[start_match.end():]
        end_match = re.search(end_regex, rest, re.MULTILINE)
        if end_match:
            end_pos = start_match.end() + end_match.start()
            return content[start_pos:end_pos].strip()
    return content[start_pos:].strip()


# ========================
# 公开 API
# ========================

def get_spec_for_tool(tool_name: str) -> str:
    """返回该工具对应的规范摘要字符串。

    - 命中 _spec_cache 直接返回
    - 否则调用对应 builder，缓存后返回
    - 未知工具返回空字符串
    """
    if tool_name in _spec_cache:
        return _spec_cache[tool_name]
    builder = _TOOL_SPEC_BUILDERS.get(tool_name)
    spec = builder() if builder else ""
    _spec_cache[tool_name] = spec
    return spec


# ========================
# 10 个 builder
# ========================

def _build_generate_script_spec() -> str:
    """分镜解析.md：§1 视听签名（简版）+ §3 场景重排格式。"""
    content = _load_file("shotlist")
    if not content:
        return ""
    parts = [
        _extract_between(content, r'^##\s§1\s', _SHOTLIST_END),
        _extract_between(content, r'^##\s§3\s', _SHOTLIST_END),
    ]
    return "\n\n".join(p for p in parts if p)


def _build_extract_characters_spec() -> str:
    """全资产大师：B.1 发型 + B.2 服装 + B.3 必填字段 + B.6 禁止事项。"""
    content = _load_file("asset_master")
    if not content:
        return ""
    parts = [
        _extract_between(content, r'^B\.1\s', _ASSET_END),
        _extract_between(content, r'^B\.2\s', _ASSET_END),
        _extract_between(content, r'^B\.3\s', _ASSET_END),
        _extract_between(content, r'^B\.6\s', _ASSET_END),
    ]
    return "\n\n".join(p for p in parts if p)


def _build_extract_props_spec() -> str:
    """全资产大师：C.1 分类 + C.2 必填字段 + C.5 禁止事项。"""
    content = _load_file("asset_master")
    if not content:
        return ""
    parts = [
        _extract_between(content, r'^C\.1\s', _ASSET_END),
        _extract_between(content, r'^C\.2\s', _ASSET_END),
        _extract_between(content, r'^C\.5\s', _ASSET_END),
    ]
    return "\n\n".join(p for p in parts if p)


def _build_extract_scenes_spec() -> str:
    """全资产大师：A.1.1 场景人物硬约束 + A.2 七层递进 + A.4 色彩管理。"""
    content = _load_file("asset_master")
    if not content:
        return ""
    parts = [
        _extract_between(content, r'^A\.1\.1\s', r'^A\.1\.2\s'),
        _extract_between(content, r'^A\.2\s', _ASSET_END),
        _extract_between(content, r'^A\.4\s', _ASSET_END),
    ]
    return "\n\n".join(p for p in parts if p)


def _build_extract_shots_spec() -> str:
    """分镜解析.md §3 场景重排（含镜头卡格式） + 视频提示词模板 §3.3/§3.4/§3.5。"""
    shotlist = _load_file("shotlist")
    video = _load_file("video_prompt")
    parts: list[str] = []
    if shotlist:
        parts.append(_extract_between(shotlist, r'^##\s§3\s', _SHOTLIST_END))
    if video:
        parts.append(_extract_between(video, r'^##\s3\.3\s', _VIDEO_END))
        parts.append(_extract_between(video, r'^##\s3\.4\s', _VIDEO_END))
        parts.append(_extract_between(video, r'^##\s3\.5\s', _VIDEO_END))
    return "\n\n".join(p for p in parts if p)


def _build_optimize_prompt_spec() -> str:
    """全资产大师 A.1.2/B.4/B.5/C.3/C.4 + 视频提示词模板 §0.4/§1.2/§3/§4/§5。"""
    asset = _load_file("asset_master")
    video = _load_file("video_prompt")
    parts: list[str] = []
    if asset:
        parts.append(_extract_between(asset, r'^A\.1\.2\s', _ASSET_END))
        parts.append(_extract_between(asset, r'^B\.4\s', _ASSET_END))
        parts.append(_extract_between(asset, r'^B\.5\s', _ASSET_END))
        parts.append(_extract_between(asset, r'^C\.3\s', _ASSET_END))
        parts.append(_extract_between(asset, r'^C\.4\s', _ASSET_END))
    if video:
        parts.append(_extract_between(video, r'^##\s0\.4\s', _VIDEO_END))
        parts.append(_extract_between(video, r'^##\s1\.2\s', _VIDEO_END))
        parts.append(_extract_between(video, r'^#\s§3\s', r'^#\s§'))
        parts.append(_extract_between(video, r'^#\s§4\s', r'^#\s§'))
        parts.append(_extract_between(video, r'^#\s§5\s', r'^#\s§'))
    return "\n\n".join(p for p in parts if p)


def _build_image_character_spec() -> str:
    """全资产大师：B.4 概念表布局 + B.5 组织顺序 + A.1.2 画质尾缀。"""
    content = _load_file("asset_master")
    if not content:
        return ""
    parts = [
        _extract_between(content, r'^B\.4\s', _ASSET_END),
        _extract_between(content, r'^B\.5\s', _ASSET_END),
        _extract_between(content, r'^A\.1\.2\s', _ASSET_END),
    ]
    return "\n\n".join(p for p in parts if p)


def _build_image_scene_spec() -> str:
    """全资产大师：A.1.2 画质尾缀 + A.2 七层递进字段清单 + A.3 材质标准。"""
    content = _load_file("asset_master")
    if not content:
        return ""
    parts = [
        _extract_between(content, r'^A\.1\.2\s', _ASSET_END),
        _extract_between(content, r'^A\.2\s', _ASSET_END),
        _extract_between(content, r'^A\.3\s', _ASSET_END),
    ]
    return "\n\n".join(p for p in parts if p)


def _build_image_prop_spec() -> str:
    """全资产大师：C.3 构图 + C.4 组织顺序 + A.1.2 画质尾缀。"""
    content = _load_file("asset_master")
    if not content:
        return ""
    parts = [
        _extract_between(content, r'^C\.3\s', _ASSET_END),
        _extract_between(content, r'^C\.4\s', _ASSET_END),
        _extract_between(content, r'^A\.1\.2\s', _ASSET_END),
    ]
    return "\n\n".join(p for p in parts if p)


def _build_image_storyboard_spec() -> str:
    """视频提示词模板 §4 故事板 prompt 规范。"""
    content = _load_file("video_prompt")
    if not content:
        return ""
    return _extract_between(content, r'^#\s§4\s', r'^#\s§')


# ========================
# Builder 注册表
# ========================

_TOOL_SPEC_BUILDERS = {
    "generate_script": _build_generate_script_spec,
    "extract_characters": _build_extract_characters_spec,
    "extract_props": _build_extract_props_spec,
    "extract_scenes": _build_extract_scenes_spec,
    "extract_shots": _build_extract_shots_spec,
    "optimize_prompt": _build_optimize_prompt_spec,
    "image_character": _build_image_character_spec,
    "image_scene": _build_image_scene_spec,
    "image_prop": _build_image_prop_spec,
    "image_storyboard": _build_image_storyboard_spec,
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd backend && python -m pytest tests/test_specs.py -v`
Expected: PASS —— 全部测试通过（约 25 项）。若 `test_*_spec_contains_*` 因 docs 文件实际内容差异失败，确认 docs 文件存在并 grep 验证关键字，再调整断言关键字（保持至少 3 个候选词之一）。

- [ ] **Step 5: 提交**

```bash
git add backend/app/agent/specs.py backend/tests/test_specs.py
git commit -m "feat(agent): add specs.py with 10 tool-specific spec builders and tests"
```

---

## Task 2: 修改 llm_tools.py 注入规范到 6 个 LLM 工具 + 集成测试

**Files:**
- Modify: `backend/app/agent/tools/llm_tools.py`（6 个 `execute()` 方法 + 顶部 import）
- Test: `backend/tests/test_agent_prompt_injection.py`（新建）

**Interfaces:**
- Consumes: `app.agent.specs.get_spec_for_tool(tool_name: str) -> str`（Task 1 产出）
- Produces: 6 个工具的 `execute()` 在 system prompt 末尾追加 `"\n\n【项目规范】\n" + spec`（spec 为空时不追加）。工具的 `name` / `parameters` / `validate` / 返回值结构不变。

**注入点对照表（tool name → spec key → SYSTEM_PROMPT 常量）：**

| 工具类 | spec key | 常量名 |
|--------|----------|--------|
| `GenerateScriptTool` | `generate_script` | `GENERATE_SCRIPT_SYSTEM_PROMPT` |
| `ExtractCharactersTool` | `extract_characters` | `EXTRACT_CHARACTERS_SYSTEM_PROMPT` |
| `ExtractPropsTool` | `extract_props` | `EXTRACT_PROPS_SYSTEM_PROMPT` |
| `ExtractScenesTool` | `extract_scenes` | `EXTRACT_SCENES_SYSTEM_PROMPT` |
| `ExtractShotsTool` | `extract_shots` | `EXTRACT_SHOTS_SYSTEM_PROMPT` |
| `OptimizePromptTool` | `optimize_prompt` | `OPTIMIZE_PROMPT_SYSTEM_PROMPT` |

- [ ] **Step 1: 写集成测试 test_agent_prompt_injection.py**

Create `backend/tests/test_agent_prompt_injection.py`:

```python
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
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd backend && python -m pytest tests/test_agent_prompt_injection.py -v`
Expected: FAIL —— `AssertionError: assert '【项目规范】' in sp`（因为 llm_tools.py 尚未注入规范）。

- [ ] **Step 3: 修改 llm_tools.py 顶部 import**

Edit `backend/app/agent/tools/llm_tools.py`，在现有 import 之后追加：

```python
from ..specs import get_spec_for_tool
```

最终顶部 import 段为：

```python
"""LLM 类工具：generate_script / extract_characters / extract_props / extract_scenes / extract_shots / optimize_prompt。

所有工具都通过 ctx.llm_client 调用 LLM，把小说/脚本拆成结构化资产。
"""
from __future__ import annotations

import json
from typing import Any

from .base import BaseTool, ToolContext, ToolParameter
from .planning import _coerce_json
from ..specs import get_spec_for_tool
```

- [ ] **Step 4: 修改 GenerateScriptTool.execute**

Edit `backend/app/agent/tools/llm_tools.py`，将 `GenerateScriptTool.execute` 整段替换为：

```python
    async def execute(self, ctx: ToolContext, params: dict) -> dict:
        if not ctx.llm_client:
            raise RuntimeError("generate_script 需要 ctx.llm_client")
        system_prompt = GENERATE_SCRIPT_SYSTEM_PROMPT
        spec = get_spec_for_tool("generate_script")
        if spec:
            system_prompt = system_prompt + "\n\n【项目规范】\n" + spec
        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": _format_goal(params) + "\n\n【小说】\n" + str(params["novel_text"])},
        ]
        resp = await ctx.generate_llm(messages, temperature=0.6, max_tokens=4000)
        data = _coerce_json(resp.content) or {}
        if "scenes" not in data:
            data = {"scenes": []}
        return data
```

- [ ] **Step 5: 修改 ExtractCharactersTool.execute**

Edit `backend/app/agent/tools/llm_tools.py`，将 `ExtractCharactersTool.execute` 整段替换为：

```python
    async def execute(self, ctx: ToolContext, params: dict) -> dict:
        if not ctx.llm_client:
            raise RuntimeError("extract_characters 需要 ctx.llm_client")
        system_prompt = EXTRACT_CHARACTERS_SYSTEM_PROMPT
        spec = get_spec_for_tool("extract_characters")
        if spec:
            system_prompt = system_prompt + "\n\n【项目规范】\n" + spec
        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": "【脚本】\n" + json.dumps(params["script"], ensure_ascii=False)},
        ]
        resp = await ctx.generate_llm(messages, temperature=0.4, max_tokens=2000)
        data = _coerce_json(resp.content) or {}
        return {"characters": data.get("characters", [])}
```

- [ ] **Step 6: 修改 ExtractPropsTool.execute**

Edit `backend/app/agent/tools/llm_tools.py`，将 `ExtractPropsTool.execute` 整段替换为：

```python
    async def execute(self, ctx: ToolContext, params: dict) -> dict:
        if not ctx.llm_client:
            raise RuntimeError("extract_props 需要 ctx.llm_client")
        system_prompt = EXTRACT_PROPS_SYSTEM_PROMPT
        spec = get_spec_for_tool("extract_props")
        if spec:
            system_prompt = system_prompt + "\n\n【项目规范】\n" + spec
        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": "【脚本】\n" + json.dumps(params["script"], ensure_ascii=False)},
        ]
        resp = await ctx.generate_llm(messages, temperature=0.4, max_tokens=1500)
        data = _coerce_json(resp.content) or {}
        return {"props": data.get("props", [])}
```

- [ ] **Step 7: 修改 ExtractScenesTool.execute**

Edit `backend/app/agent/tools/llm_tools.py`，将 `ExtractScenesTool.execute` 整段替换为：

```python
    async def execute(self, ctx: ToolContext, params: dict) -> dict:
        if not ctx.llm_client:
            raise RuntimeError("extract_scenes 需要 ctx.llm_client")
        system_prompt = EXTRACT_SCENES_SYSTEM_PROMPT
        spec = get_spec_for_tool("extract_scenes")
        if spec:
            system_prompt = system_prompt + "\n\n【项目规范】\n" + spec
        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": "【脚本】\n" + json.dumps(params["script"], ensure_ascii=False)},
        ]
        resp = await ctx.generate_llm(messages, temperature=0.4, max_tokens=2000)
        data = _coerce_json(resp.content) or {}
        return {"scenes": data.get("scenes", [])}
```

- [ ] **Step 8: 修改 ExtractShotsTool.execute**

Edit `backend/app/agent/tools/llm_tools.py`，将 `ExtractShotsTool.execute` 整段替换为：

```python
    async def execute(self, ctx: ToolContext, params: dict) -> dict:
        if not ctx.llm_client:
            raise RuntimeError("extract_shots 需要 ctx.llm_client")
        system_prompt = EXTRACT_SHOTS_SYSTEM_PROMPT
        spec = get_spec_for_tool("extract_shots")
        if spec:
            system_prompt = system_prompt + "\n\n【项目规范】\n" + spec
        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": (
                "【脚本】\n" + json.dumps(params["script"], ensure_ascii=False)
                + "\n\n【场景】\n" + json.dumps(params["scenes"], ensure_ascii=False)
            )},
        ]
        resp = await ctx.generate_llm(messages, temperature=0.5, max_tokens=4000)
        data = _coerce_json(resp.content) or {}
        return {"shots": data.get("shots", [])}
```

- [ ] **Step 9: 修改 OptimizePromptTool.execute**

Edit `backend/app/agent/tools/llm_tools.py`，将 `OptimizePromptTool.execute` 整段替换为：

```python
    async def execute(self, ctx: ToolContext, params: dict) -> dict:
        if not ctx.llm_client:
            raise RuntimeError("optimize_prompt 需要 ctx.llm_client")
        target = params.get("target") or "image"
        system_prompt = OPTIMIZE_PROMPT_SYSTEM_PROMPT.format(target=target)
        spec = get_spec_for_tool("optimize_prompt")
        if spec:
            system_prompt = system_prompt + "\n\n【项目规范】\n" + spec
        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": (
                "【原始 prompt】\n" + str(params["prompt"])
                + ("\n\n【上下文】\n" + json.dumps(params["context"], ensure_ascii=False) if params.get("context") else "")
            )},
        ]
        resp = await ctx.generate_llm(messages, temperature=0.7, max_tokens=800)
        optimized = (resp.content or "").strip()
        # 去掉可能的引号
        if optimized.startswith('"') and optimized.endswith('"'):
            optimized = optimized[1:-1]
        return {"optimized": optimized, "target": target}
```

- [ ] **Step 10: 运行集成测试确认通过**

Run: `cd backend && python -m pytest tests/test_agent_prompt_injection.py -v`
Expected: PASS —— 全部 9 项测试通过。

- [ ] **Step 11: 回归测试原有 LLM 工具测试**

Run: `cd backend && python -m pytest tests/test_agent_llm_tools.py -v`
Expected: PASS —— 原有 12 项测试全部通过（验证未破坏既有行为）。

- [ ] **Step 12: 提交**

```bash
git add backend/app/agent/tools/llm_tools.py backend/tests/test_agent_prompt_injection.py
git commit -m "feat(agent): inject project specs into 6 LLM tool system prompts"
```

---

## Task 3: 修改 image_tools.py 注入规范到 4 个 _build_*_prompt 函数

**Files:**
- Modify: `backend/app/agent/tools/image_tools.py`（4 个 `_build_*_prompt` 函数 + 顶部 import）
- Test: 复用 `backend/tests/test_specs.py`（已覆盖 4 个 `image_*` builder 的端到端断言），无需新增测试文件

**Interfaces:**
- Consumes: `app.agent.specs.get_spec_for_tool(tool_name: str) -> str`（Task 1 产出）
- Produces: 4 个 `_build_*_prompt` 函数在原 `parts` 列表末尾追加 spec 字符串（spec 为空时跳过）。函数签名与返回值类型不变。

**注入点对照表：**

| 函数 | spec key |
|------|----------|
| `_build_character_prompt(character, style="cinematic")` | `image_character` |
| `_build_scene_prompt(scene)` | `image_scene` |
| `_build_prop_prompt(prop)` | `image_prop` |
| `_build_storyboard_prompt(shot, characters=None)` | `image_storyboard` |

**测试策略**：因为 Task 1 的 `test_specs.py` 已验证 4 个 `image_*` builder 返回的 spec 字符串包含期望关键字（`test_image_character_spec_contains_concept_layout` / `test_image_scene_spec_contains_material_standard` / `test_image_prop_spec_contains_composition` / `test_image_storyboard_spec_contains_storyboard_rules`），本任务只需验证 `_build_*_prompt` 在 docs 存在时返回值包含规范关键字、docs 缺失时仍返回非空基础 prompt。

- [ ] **Step 1: 写 image_tools 注入测试**

Append to `backend/tests/test_agent_prompt_injection.py`（在文件末尾追加，复用同文件已有的 `_clear_spec_cache` fixture）：

```python
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
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd backend && python -m pytest tests/test_agent_prompt_injection.py::test_build_character_prompt_contains_concept_layout tests/test_agent_prompt_injection.py::test_build_scene_prompt_contains_material_standard tests/test_agent_prompt_injection.py::test_build_prop_prompt_contains_composition tests/test_agent_prompt_injection.py::test_build_storyboard_prompt_contains_storyboard_rules -v`
Expected: FAIL —— `AssertionError`（因为 `_build_*_prompt` 尚未注入规范）。

- [ ] **Step 3: 修改 image_tools.py 顶部 import**

Edit `backend/app/agent/tools/image_tools.py`，在现有 import 段末尾追加：

```python
from ..specs import get_spec_for_tool
```

最终顶部 import 段为：

```python
"""图像生成工具：4 个 — 角色三视图 / 道具 / 场景 / 分镜图。

所有工具都通过 ctx.media_service 调底层 provider，requires_approval=True。
"""
from __future__ import annotations

from typing import Any

from ..media_service import MediaRequest, MediaService, get_default_media_service
from ..asset_references import resolve_asset_references
from ..prompt_engineering import optimize_generation_prompt, collect_storyboard_reference_asset_ids
from .base import BaseTool, ToolContext, ToolParameter
from ..specs import get_spec_for_tool
```

- [ ] **Step 4: 修改 _build_character_prompt**

Edit `backend/app/agent/tools/image_tools.py`，将 `_build_character_prompt` 整段替换为：

```python
def _build_character_prompt(character: dict, style: str = "cinematic") -> str:
    parts = [
        f"Character portrait of {character.get('name', 'character')}",
        f"age {character.get('age', 25)}, {character.get('gender', '')}".strip(),
        character.get("appearance", ""),
        character.get("personality", ""),
        "four-view character sheet, front / side / back / 3/4 view",
        "white background, high detail, consistent across views",
        style + " style, professional lighting",
    ]
    spec = get_spec_for_tool("image_character")
    if spec:
        parts.append(spec)
    return ", ".join(p for p in parts if p)
```

- [ ] **Step 5: 修改 _build_prop_prompt**

Edit `backend/app/agent/tools/image_tools.py`，将 `_build_prop_prompt` 整段替换为：

```python
def _build_prop_prompt(prop: dict) -> str:
    parts = [
        f"Object: {prop.get('name', 'prop')}",
        prop.get("description", ""),
        "product photo, white background, high detail, sharp focus, soft shadows",
    ]
    spec = get_spec_for_tool("image_prop")
    if spec:
        parts.append(spec)
    return ", ".join(p for p in parts if p)
```

- [ ] **Step 6: 修改 _build_scene_prompt**

Edit `backend/app/agent/tools/image_tools.py`，将 `_build_scene_prompt` 整段替换为：

```python
def _build_scene_prompt(scene: dict) -> str:
    parts = [
        f"Scene: {scene.get('name', 'scene')}",
        scene.get("time", "day") + " time",
        scene.get("weather", ""),
        scene.get("mood", ""),
        scene.get("description", ""),
        "cinematic composition, wide shot, atmospheric lighting, 8k, high detail",
    ]
    spec = get_spec_for_tool("image_scene")
    if spec:
        parts.append(spec)
    return ", ".join(p for p in parts if p)
```

- [ ] **Step 7: 修改 _build_storyboard_prompt**

Edit `backend/app/agent/tools/image_tools.py`，将 `_build_storyboard_prompt` 整段替换为：

```python
def _build_storyboard_prompt(shot: dict, characters: list | None = None) -> str:
    char_names = ", ".join(c.get("name", "") for c in (characters or []) if c.get("name"))
    parts = [
        f"{shot.get('camera', 'medium shot')}",
        shot.get("movement", "static"),
        shot.get("action", ""),
        f"scene: {shot.get('scene', '')}",
    ]
    if char_names:
        parts.append(f"featuring {char_names}")
    parts.append("storyboard frame, sketch style, cinematic framing")
    spec = get_spec_for_tool("image_storyboard")
    if spec:
        parts.append(spec)
    return ", ".join(p for p in parts if p)
```

- [ ] **Step 8: 运行测试确认通过**

Run: `cd backend && python -m pytest tests/test_agent_prompt_injection.py -v`
Expected: PASS —— 全部 14 项测试通过（Task 2 的 9 项 + Task 3 新增 5 项）。

- [ ] **Step 9: 回归测试 image_tools 现有测试**

Run: `cd backend && python -m pytest tests/ -k "image" -v`
Expected: PASS —— 现有 image_tools 相关测试全部通过。

- [ ] **Step 10: 提交**

```bash
git add backend/app/agent/tools/image_tools.py backend/tests/test_agent_prompt_injection.py
git commit -m "feat(agent): inject project specs into 4 image prompt builders"
```

---

## Task 4: 修改 llm.py 的 REACT_SYSTEM_PROMPT + 运行全部后端测试

**Files:**
- Modify: `backend/app/agent/llm.py`（仅修改 `REACT_SYSTEM_PROMPT` 常量文本，不动 `build_react_prompt` 逻辑）
- Test: 无需新增测试文件，复用既有测试 + 全量回归

**Interfaces:**
- Consumes: 无（REACT_SYSTEM_PROMPT 是静态字符串常量）
- Produces: `REACT_SYSTEM_PROMPT` 末尾追加【项目规范】铁律段（5 条硬约束）。`build_system_prompt()` 与 `build_react_prompt()` 行为不变（因为它们引用该常量）。

**注入内容设计**：5 条铁律覆盖角色/场景/道具隔离、材质可触摸、世界观服从、中文输出、字数硬范围。这是规范总览，具体规则仍由各工具的 system prompt 注入。

- [ ] **Step 1: 写 REACT_SYSTEM_PROMPT 铁律段测试**

Append to `backend/tests/test_agent_prompt_injection.py`（在文件末尾追加）：

```python
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


def test_build_system_prompt_still_returns_react_prompt():
    """build_system_prompt() 仍返回 REACT_SYSTEM_PROMPT（向后兼容）。"""
    from app.agent.llm import REACT_SYSTEM_PROMPT, build_system_prompt
    assert build_system_prompt() == REACT_SYSTEM_PROMPT
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd backend && python -m pytest tests/test_agent_prompt_injection.py::test_react_system_prompt_contains_project_spec_section tests/test_agent_prompt_injection.py::test_react_system_prompt_contains_isolation_rule tests/test_agent_prompt_injection.py::test_react_system_prompt_contains_material_rule tests/test_agent_prompt_injection.py::test_react_system_prompt_contains_word_count_rule -v`
Expected: FAIL —— `AssertionError`（REACT_SYSTEM_PROMPT 当前未包含铁律段）。

- [ ] **Step 3: 修改 llm.py 的 REACT_SYSTEM_PROMPT**

Edit `backend/app/agent/llm.py`，将 `REACT_SYSTEM_PROMPT` 整段替换为：

```python
REACT_SYSTEM_PROMPT = """你是 DramaForge Director Agent —— 一个拥有 20 年经验的短剧导演。

【你的工作方法】
1. 仔细阅读【当前状态】、【已生成资产】、【最近步骤】
2. 在 thought 中写出你接下来的思路（30-200 字，说人话，不要太学术）
3. 在 action 中调用一个工具，参数必须严格符合该工具的 schema
4. 如果用户必须参与决策（澄清目标 / 选择方向 / 确认高成本操作），调 ask_user 工具
5. 如果所有任务完成，调 finish_task 工具
6. 不要重复调同一个工具在相同输入上（避免死循环）

【输出格式（严格 JSON）】
{
  "thought": "我决定先...因为...",
  "action": {
    "tool": "工具名",
    "params": { ... }
  }
}

只输出 JSON，不要任何额外文字。

【项目规范】
生成资产时必须遵循项目规范。具体规范由各工具的系统提示词注入，以下是跨工具铁律：
- 角色卡只写主体角色，场景卡写场景+适配氛围人物，道具卡只写静物，三者严格隔离，禁止混用
- 所有材质必须可触摸：指定具体材质名+颜色+工艺+年代痕迹，禁止抽象描述
- 所有发型/服装/材质必须服从所在世界观，禁止穿越违和
- 所有提示词使用纯中文自然语言（生成模型 prompt 除外，用英文）
- 字数硬性范围：场景 400-600 / 角色 500-800 / 道具 200-400
"""
```

- [ ] **Step 4: 运行新测试确认通过**

Run: `cd backend && python -m pytest tests/test_agent_prompt_injection.py -v`
Expected: PASS —— 全部 19 项测试通过（Task 2 + Task 3 + Task 4 共 19 项）。

- [ ] **Step 5: 回归测试 agent 模块全部测试**

Run: `cd backend && python -m pytest tests/test_specs.py tests/test_agent_llm_tools.py tests/test_agent_prompt_injection.py -v`
Expected: PASS —— 全部测试通过。

- [ ] **Step 6: 运行后端全部测试做最终回归**

Run: `cd backend && python -m pytest tests/ -v --tb=short`
Expected: PASS —— 后端全部测试通过（若个别既有测试因 REACT_SYSTEM_PROMPT 文本变化失败，确认是断言精确文本导致的脆性测试，调整断言为子串匹配；不修改业务逻辑）。

- [ ] **Step 7: 提交**

```bash
git add backend/app/agent/llm.py backend/tests/test_agent_prompt_injection.py
git commit -m "feat(agent): add project spec hard rules to REACT_SYSTEM_PROMPT"
```

---

## Self-Review 自检清单

**1. Spec 覆盖**：
- 设计文档 §4.4 的 10 个工具映射 → Task 1 实现 10 个 builder，覆盖完整。
- 设计文档 §4.5 llm_tools.py 注入 → Task 2 修改 6 个 execute()，覆盖完整。
- 设计文档 §4.5 image_tools.py 注入 → Task 3 修改 4 个 _build_*_prompt，覆盖完整。
- 设计文档 §4.5 llm.py REACT_SYSTEM_PROMPT → Task 4 修改常量，覆盖完整。
- 设计文档 §6 错误处理（文件缺失/编码错误/正则不匹配）→ specs.py 的 `_load_file` 与 `_extract_between` 已实现 fallback；测试 `test_load_file_returns_empty_on_unicode_error` / `test_extract_between_no_start_match_returns_empty` / `test_all_builders_return_empty_when_docs_missing` / `test_tool_runs_without_spec_when_docs_missing` 覆盖完整。
- 设计文档 §7.1 单元测试 8 项 → Task 1 的 test_specs.py 覆盖（文件加载、缓存、章节提取、未知工具、fallback 等）。
- 设计文档 §7.2 集成测试 2 项 → Task 2 的 `test_extract_characters_system_prompt_contains_face_anchors` + `test_optimize_prompt_contains_cineforge_constraints` 覆盖，并额外补充了 5 个工具 + 4 个 image builder + 5 个 REACT 铁律测试。

**2. Placeholder 扫描**：
- 无 TODO / TBD / "implement later" / "similar to Task N" / "add appropriate error handling"。
- 所有代码块均包含完整可运行代码。
- 所有测试断言均有具体期望值或候选关键字列表。

**3. 类型一致性**：
- `get_spec_for_tool(tool_name: str) -> str` —— Task 1 定义，Task 2/3 调用，签名一致。
- `_load_file(key: str) -> str` —— Task 1 定义并在测试中 monkeypatch `_DOCS_DIR`，签名一致。
- `_extract_between(content, start_regex, end_regex=None) -> str` —— Task 1 定义并测试，签名一致。
- 6 个工具类名 + `execute()` 签名（`(self, ctx, params) -> dict`）—— Task 2 修改时保持一致。
- 4 个 `_build_*_prompt` 函数签名 —— Task 3 修改时保持一致（`_build_character_prompt(character, style="cinematic")` / `_build_prop_prompt(prop)` / `_build_scene_prompt(scene)` / `_build_storyboard_prompt(shot, characters=None)`）。
- `REACT_SYSTEM_PROMPT` 常量名 —— Task 4 修改时保持一致，`build_system_prompt()` 仍返回该常量。

**4. 任务独立性**：
- Task 1 完全独立（新建文件 + 测试），可单独交付。
- Task 2 依赖 Task 1 的 `get_spec_for_tool`，但 Task 1 完成后可独立进行。
- Task 3 依赖 Task 1 的 `get_spec_for_tool`，与 Task 2 互相独立（可并行）。
- Task 4 完全独立（只改常量文本），但放最后做最终回归。

**5. 已知风险（不在本计划修复范围）**：
- 若 `docs/` 规范文件的章节标题格式未来变更（如 `B.1` 改为 `B1`），specs.py 的正则会失效，spec 静默为空字符串。需手动同步正则。
- token 消耗增加：每个工具 system prompt 增加约 500-2000 字规范，LLM 调用成本上升（设计文档 §8 已记录）。
- `prompt_engineering.py` 的 `optimize_generation_prompt` 不在本计划修改范围（用户任务列表未要求）；如需进一步注入规范到该函数，应另开计划。
