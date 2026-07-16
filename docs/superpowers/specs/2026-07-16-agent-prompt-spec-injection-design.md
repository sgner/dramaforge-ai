# Agent 提示词规范注入设计

> 日期：2026-07-16
> 状态：设计阶段

## 1. 背景与问题

当前 agent 模式的 LLM 工具（`backend/app/agent/tools/llm_tools.py`）和图像工具（`image_tools.py`）使用的是**简化版系统提示词**，与项目 `docs/` 目录下的 4 个规范文件完全脱节：

| 工具 | 当前提示词 | docs 规范要求 |
|------|-----------|------------|
| extract_characters | 6 字段（name/role/gender/age/appearance/personality） | 6+2 面容锚点、6 层服装、发型时代规则、禁止事项 |
| extract_scenes | 6 字段（name/location/time/weather/mood/description） | 7 层递进结构、场景人物适配、色彩管理 |
| extract_props | 3 字段（name/description/owner） | 8 大分类、4 视图布局、材质可触摸标准 |
| extract_shots | 7 字段简单分镜 | 视听签名 8 字段、镜头卡格式、ASL 节奏、VFX 分级 |
| optimize_prompt | "add cinematic keywords" | CineForge v1.26 规范、敏感词 4 区过滤、6 条硬约束 |
| generate_script | 简单分场格式 | 场景重排格式、视听签名、节奏二轴映射 |

**核心矛盾**：手动流水线（前端 constants.ts）使用详细规则，agent 模式使用简化规则，导致 agent 生成的资产质量远低于手动流水线。

## 2. 目标

让 agent 模式遵循与手动流水线相同的规范，具体：

1. **启动时加载** docs/ 下的 3 个规范文件（全资产大师 V3.0、视频提示词模板、分镜解析.md）
2. **按工具分区注入**：每个工具只注入与其相关的章节，控制 token 消耗
3. **保持 fallback**：如果 docs/ 文件缺失，使用硬编码精简规则，agent 仍可运行
4. **不改工具接口**：只改系统提示词内容，不改工具的参数/返回值/调用方式

## 3. 不做（YAGNI）

- 不解析 constants.ts（TypeScript 文件，其规则已在 docs/ 文件中覆盖；如有关键规则缺失，手动补充到 specs.py 常量）
- 不动态热重载规范（启动时加载一次并缓存即可）
- 不改 agent 的 ReAct 主循环逻辑（只改提示词内容）
- 不改前端代码（只改后端 agent 提示词）

## 4. 架构

### 4.1 新增文件

```
backend/app/agent/specs.py    # Spec loader：加载、分区、缓存规范
```

### 4.2 修改文件

```
backend/app/agent/llm.py                    # REACT_SYSTEM_PROMPT 添加规范总览引用
backend/app/agent/tools/llm_tools.py       # 6 个 LLM 工具的系统提示词注入规范
backend/app/agent/tools/image_tools.py     # _build_*_prompt 函数注入规范
backend/app/agent/prompt_engineering.py    # optimize_generation_prompt 注入规范
```

### 4.3 Spec Loader 设计

```python
# backend/app/agent/specs.py

from pathlib import Path
import re

# docs/ 目录路径（相对于 specs.py 的位置）
_DOCS_DIR = Path(__file__).parent.parent.parent.parent.parent / "docs"

# 规范文件名映射
_SPEC_FILES = {
    "asset_master": "【资产库】全资产大师V3.0_场景+角色+道具_万能版.txt",
    "video_prompt": "视频提示词模板.md",
    "shotlist": "分镜解析.md",
}

# 缓存：file_key -> 文件全文
_file_cache: dict[str, str] = {}

# 缓存：tool_name -> 规范摘要
_spec_cache: dict[str, str] = {}


def _load_file(key: str) -> str:
    """加载规范文件，带缓存。文件不存在返回空字符串。"""
    if key in _file_cache:
        return _file_cache[key]
    filename = _SPEC_FILES.get(key)
    if not filename:
        return ""
    path = _DOCS_DIR / filename
    if not path.exists():
        return ""
    content = path.read_text(encoding="utf-8")
    _file_cache[key] = content
    return content


def _extract_section(content: str, start_pattern: str, end_pattern: str | None = None) -> str:
    """从规范文件中提取章节。start_pattern/end_pattern 是正则。"""
    # ... 用正则匹配章节范围
    pass


def get_spec_for_tool(tool_name: str) -> str:
    """返回该工具相关的规范摘要。带缓存。"""
    if tool_name in _spec_cache:
        return _spec_cache[tool_name]
    spec = _build_spec_for_tool(tool_name)
    _spec_cache[tool_name] = spec
    return spec


def _build_spec_for_tool(tool_name: str) -> str:
    """按工具名组合规范摘要。"""
    builder = _TOOL_SPEC_BUILDERS.get(tool_name)
    if builder is None:
        return ""
    return builder()
```

### 4.4 工具到规范的映射

每个工具的规范摘要由对应的 builder 函数组装：

| 工具 | 规范来源 | 提取的章节 |
|------|---------|-----------|
| `generate_script` | 分镜解析.md | §1 视听签名简版、§3 场景重排格式（场景标题行格式、节奏二轴） |
| `extract_characters` | 全资产大师V3.0 | B.1 发型规则、B.2 服装六层结构、B.3 必填字段（面容锚点 6+2）、B.6 禁止事项 |
| `extract_props` | 全资产大师V3.0 | C.1 分类表、C.2 必填字段、C.5 禁止事项 |
| `extract_scenes` | 全资产大师V3.0 | A.1.1 场景人物适配映射表、A.2 七层递进模板（简化为字段清单）、A.4 色彩管理 |
| `extract_shots` | 分镜解析.md + 视频提示词模板 | 镜头卡格式；§3.3 镜头描述一句话紧凑动态、§3.4 方向标【】4 类、§3.5 运动方向 6 大类 |
| `optimize_prompt` | 全资产大师V3.0 + 视频提示词模板 | A.1.2 画质尾缀、A.3 材质标准、B.4 概念表布局、B.5 组织顺序、C.3 构图、C.4 组织顺序；§0.4 跨模型 6 条硬约束、§1.2 四不准则、§3 视频 prompt 规范、§4 故事板 prompt 规范、§5 敏感词 4 区 |
| `image_character` | 全资产大师V3.0 | B.4 概念表布局段（4 区域固定文本）、B.5 组织顺序、A.1.2 画质尾缀 |
| `image_scene` | 全资产大师V3.0 | A.1.2 画质技术尾缀、A.2 七层递进字段清单、A.3 材质可触摸标准 |
| `image_prop` | 全资产大师V3.0 | C.3 构图规范（四视图/单图）、C.4 组织顺序、A.1.2 画质尾缀 |
| `image_storyboard` | 视频提示词模板 | §4 故事板 prompt 规范（8 条硬约束、frozen frame 原则、固定文案） |

### 4.5 注入策略

**llm_tools.py** — 每个工具的 execute() 方法：

```python
from ..specs import get_spec_for_tool

async def execute(self, ctx: ToolContext, params: dict) -> dict:
    spec = get_spec_for_tool("extract_characters")
    system_prompt = EXTRACT_CHARACTERS_SYSTEM_PROMPT
    if spec:
        system_prompt = system_prompt + "\n\n【项目规范】\n" + spec
    messages = [
        {"role": "system", "content": system_prompt},
        ...
    ]
```

**image_tools.py** — `_build_*_prompt` 函数，按资产种类附加对应规范：

```python
from ..specs import get_spec_for_tool

def _build_character_prompt(character: dict, style: str = "cinematic") -> str:
    # 角色图像：附加 B.4 概念表布局 + B.5 组织顺序 + 画质尾缀
    spec = get_spec_for_tool("image_character")
    parts = [...]
    if spec:
        parts.append(spec)
    return ", ".join(p for p in parts if p)

def _build_scene_prompt(scene: dict) -> str:
    # 场景图像：附加 A.1.2 画质尾缀 + A.2 七层递进字段清单
    spec = get_spec_for_tool("image_scene")
    ...

def _build_prop_prompt(prop: dict) -> str:
    # 道具图像：附加 C.3 构图规范 + C.4 组织顺序
    spec = get_spec_for_tool("image_prop")
    ...

def _build_storyboard_prompt(shot: dict, characters: list | None = None) -> str:
    # 分镜图：附加视频提示词模板 §4 故事板 prompt 规范
    spec = get_spec_for_tool("image_storyboard")
    ...
```

新增 4 个 image_* 工具的 spec builder（映射到对应规范章节）。

**llm.py** — REACT_SYSTEM_PROMPT 添加规范总览：

```python
REACT_SYSTEM_PROMPT = """你是 DramaForge Director Agent ...

【项目规范】
生成资产时必须遵循项目规范。具体规范由各工具的系统提示词注入。
关键铁律：
- 角色卡只写主体角色，场景卡写场景+适配氛围人物，道具卡只写静物，三者严格隔离
- 所有材质必须可触摸（指定具体材质名+颜色+工艺+年代痕迹）
- 所有发型/服装/材质必须服从所在世界观，禁止穿越违和
- 所有提示词使用纯中文自然语言（生成模型 prompt 除外，用英文）
- 字数硬性范围：场景 400-600 / 角色 500-800 / 道具 200-400
"""
```

## 5. 数据流

```
应用启动
  ↓
specs.py 模块加载（不立即读文件，懒加载）
  ↓
agent 首次调用工具
  ↓
get_spec_for_tool("extract_characters")
  ↓
_file_cache 没有 → 读 docs/全资产大师V3.0.txt
  ↓
_extract_section 提取 B.1-B.3, B.6 章节
  ↓
_spec_cache["extract_characters"] = 摘要
  ↓
返回摘要，拼接到系统提示词
  ↓
后续调用直接读 _spec_cache（O(1)）
```

## 6. 错误处理

- **docs/ 文件不存在**：`_load_file` 返回空字符串，`get_spec_for_tool` 返回空字符串，工具使用原有简化提示词，agent 仍可运行
- **章节正则不匹配**：`_extract_section` 返回空字符串，跳过该章节
- **文件编码错误**：捕获 UnicodeDecodeError，返回空字符串并打印警告

## 7. 测试计划

### 7.1 单元测试（`backend/tests/test_specs.py`）

1. `test_load_file_returns_content_when_exists` — 文件存在时返回内容
2. `test_load_file_returns_empty_when_missing` — 文件不存在时返回空字符串
3. `test_get_spec_for_extract_characters` — extract_characters 规范包含面容锚点、服装六层、发型规则
4. `test_get_spec_for_extract_props` — extract_props 规范包含分类表、必填字段、禁止事项
5. `test_get_spec_for_optimize_prompt` — optimize_prompt 规范包含 CineForge 硬约束、敏感词 4 区
6. `test_get_spec_for_unknown_tool_returns_empty` — 未知工具返回空字符串
7. `test_spec_cache_hits` — 第二次调用不重新读文件
8. `test_fallback_when_docs_missing` — docs/ 缺失时 agent 工具仍可执行

### 7.2 集成测试（`backend/tests/test_agent_prompt_injection.py`）

1. `test_extract_characters_system_prompt_contains_face_anchors` — extract_characters 的系统提示词包含"脸型""眉形""骨相"等锚点字段
2. `test_optimize_prompt_contains_cineforge_constraints` — optimize_prompt 的系统提示词包含"跨模型兼容"硬约束

## 8. 已知限制

1. **手动同步**：如果 docs/ 规范文件更新章节标题或行号，specs.py 的章节提取正则需要同步更新
2. **constants.ts 不同步**：constants.ts 的规则变更不会自动反映到 agent（因为不读 constants.ts）；如有关键规则变更，需手动同步到 specs.py
3. **token 消耗增加**：每个工具的系统提示词增加约 500-2000 字的规范摘要，LLM 调用成本会上升
4. **章节提取依赖正则**：如果规范文件的章节标题格式变化，提取可能失败（有 fallback 为空字符串）

## 9. 未来改进

1. 把规范文件转换为结构化格式（YAML/JSON），避免正则提取
2. 添加规范版本号，支持热重载
3. 把 constants.ts 的规则也迁移到 docs/ 下的纯文本规范文件
4. 添加规范覆盖度报告（哪些工具注入了哪些章节）
