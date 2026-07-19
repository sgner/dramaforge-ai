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
_DOCS_DIR = Path(__file__).parent.parent.parent.parent / "docs"

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
    """角色设计表规范，并覆盖历史文档中的旧版布局描述。"""
    content = _load_file("asset_master")
    if not content:
        return ""
    parts = [
        _extract_between(content, r'^B\.4\s', _ASSET_END),
        _extract_between(content, r'^B\.5\s', _ASSET_END),
        _extract_between(content, r'^A\.1\.2\s', _ASSET_END),
    ]
    parts.append(
        "运行时硬约束：角色资产必须是无场景背景的角色设计表，不得生成普通肖像。"
        "固定为左侧三分之一胸像正面特写，右侧三分之二同一角色横向排列的正面、侧面、背面三个全身视图；"
        "服装、发型、配饰和人物身份保持一致，浅暖灰 F0EDE8 背景，不得出现文字、编号、标签或注释。"
    )
    return "\n\n".join(p for p in parts if p)


def _build_image_scene_spec() -> str:
    """场景环境锚点规范，并覆盖历史文档中的人物场景示例。"""
    content = _load_file("asset_master")
    if not content:
        return ""
    parts = [
        _extract_between(content, r'^A\.1\.2\s', _ASSET_END),
        _extract_between(content, r'^A\.2\s', _ASSET_END),
        _extract_between(content, r'^A\.3\s', _ASSET_END),
    ]
    parts.append(
        "运行时硬约束：场景资产必须是可复用的环境参考图，只表现空间、建筑、陈设、光线和材质；"
        "不得出现已有角色、人物主体或前景人物。角色只能作为后续分镜或视频生成的独立参考资产输入，"
        "除非用户明确要求带人物的氛围场景。"
    )
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
    """六宫格故事板 prompt 规范，并覆盖历史单帧示例。"""
    content = _load_file("video_prompt")
    if not content:
        return ""
    return (
        _extract_between(content, r'^#\s§4\s', r'^#\s§')
        + "\n\n运行时硬约束：分镜图片必须是一张 2×3 六宫格故事板，第一格为纯黑缓冲格，"
        "第二至第六格为同一镜头的连续静帧；必须继承视觉签名，并引用对应的纯场景、角色设计表和道具资产；"
        "不得退化为单图，不得增加额外格子，不得出现 UI、可读文字、编号或注释。"
    )


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
