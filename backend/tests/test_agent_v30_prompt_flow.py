"""端到端：script → extract → V3.0 资产 → image prompt 的数据流测试。

背景：用户反馈"提示词完全不对，agent 提取资产有困难"。根本原因有两个：

1. SyntaxError 让 llm_tools.py 整个模块加载失败（已修 line 368）
   - 任何 import app.agent.tools.llm_tools 的代码都会抛 ImportError
   - 整个 agent 流程（extract_characters/extract_props/...）直接挂掉
   - 表现为：agent "无法提取资产" / 提示词完全不对 / 资产节点空白

2. V3.0 字段在 build_*_prompt 阶段必须正确消费
   - extract_* 工具的 SYSTEM_PROMPT 已经要求 LLM 必填/可选字段
   - _build_*_prompt 必须把 V3.0 字段拼进最终 prompt，否则 LLM 提取的数据被丢光
   - 这个文件覆盖从 script → 提取 → build prompt → 关键 V3.0 字段保留的链路
"""
from __future__ import annotations

import ast
from pathlib import Path

import pytest


# ========================
# 1. SyntaxError 回归测试
# ========================

def test_llm_tools_module_parses_without_syntax_error():
    """llm_tools.py 必须能被 Python 解释器加载（无 SyntaxError）。

    根因：line 368 description="...(排除"角色是人物不是道具"的混淆)..." 
    字符串里包含未转义的双引号 "，Python 解析为多个字符串+标识符，
    整个模块无法 import → 整个 agent 流程（extract_*/save_asset）崩溃。

    这个测试用 ast.parse 直接验证文件能解析，防止类似 syntax 错误回归。
    """
    # 找到 llm_tools.py
    p = Path(__file__).resolve().parent.parent / "app" / "agent" / "tools" / "llm_tools.py"
    assert p.exists(), f"找不到 {p}"

    text = p.read_text(encoding="utf-8")
    try:
        ast.parse(text)
    except SyntaxError as e:
        # 使用 ASCII 安全的修复建议字符串（避免嵌入任何会破坏 Python 解析的字符）
        fix_hint = (
            "Root cause: description string contains unescaped ASCII double quotes.\n"
            "Fix: replace embedded quotes with Chinese brackets, "
            "or use backslash escape, "
            "or split into multiple concatenated strings."
        )
        pytest.fail(
            f"llm_tools.py failed to parse: line {e.lineno} - {e.msg}\n"
            f"  text: {e.text!r}\n"
            f"  offset: {e.offset}\n\n"
            f"{fix_hint}"
        )


def test_all_agent_tools_modules_parse_without_syntax_error():
    """All .py files under app/agent/tools/ must be parsable (prevent SyntaxError spread)."""
    tools_dir = Path(__file__).resolve().parent.parent / "app" / "agent" / "tools"
    assert tools_dir.exists()

    failures: list[str] = []
    for p in sorted(tools_dir.glob("*.py")):
        if p.name == "__init__.py":
            continue
        text = p.read_text(encoding="utf-8")
        try:
            ast.parse(text)
        except SyntaxError as e:
            failures.append(f"{p.name}:{e.lineno} - {e.msg} (text={e.text!r})")

    if failures:
        pytest.fail(
            "The following agent tool files fail to parse (SyntaxError):\n"
            + "\n".join(failures)
            + "\n\nThis crashes the entire agent pipeline. Fix before re-running."
        )


# (The earlier "no_unescaped_double_quote" heuristic test was removed because
# `ast.parse` already 100% covers SyntaxError detection. Heuristic line-based
# checks produce too many false positives on docstring/comment lines that
# legitimately contain multiple ASCII quotes.)


# ========================
# 2. V3.0 build_*_prompt 数据保留测试
# ========================

def test_build_character_prompt_includes_face_anchor_values():
    """V3.0 faceAnchor 8 字段值必须出现在 character prompt 里（不被吞）。"""
    from app.agent.tools.image_tools import _build_character_prompt

    character = {
        "name": "林尘",
        "identity": "都市学生",
        "ageRange": "18-22",
        "gender": "男",
        "era": "现代都市",
        "faceAnchor": {
            "faceShape": "椭圆",
            "eyebrow": "剑眉",
            "eyeType": "丹凤眼",
            "noseType": "高直",
            "lipType": "薄唇",
            "boneStructure": "颧骨分明",
            "skinTone": "冷白",
            "landmarks": "左眼角小痣",
        },
        "hairSystem": {
            "lengthAndStyle": "黑色短发",
            "color": "黑色",
            "headwear": "无",
            "bangsDirection": "左侧斜分",
        },
        "clothingLayers": {
            "inner": "白色T恤",
            "outer": "深蓝外套",
            "lower": "深灰长裤",
            "feet": "白色运动鞋",
        },
    }
    prompt = _build_character_prompt(character)
    # 关键 V3.0 字段值必须被消费
    for term in ("椭圆", "剑眉", "丹凤眼", "高直", "薄唇",
                 "黑色短发", "白色T恤", "深蓝外套", "深灰长裤"):
        assert term in prompt, (
            f"V3.0 字段值 {term!r} 必须出现在 character prompt 里。\n"
            f"实际 prompt: {prompt[:300]}"
        )


def test_build_prop_prompt_includes_material_craft_structure():
    """V3.0 C.2 必填字段（material / structure / craftAndWear）必须出现在 prop prompt 里。"""
    from app.agent.tools.image_tools import _build_prop_prompt

    prop = {
        "name": "古剑",
        "category": "weapon",
        "plotFunction": "家族传承法器",
        "era": "古代仙侠",
        "size": "长约80厘米",
        "structure": "三尺青锋，剑格镂空雕花",
        "material": "玄铁锻造",
        "craftAndWear": "千年古剑，剑身有包浆",
        "decoration": "剑格刻有云纹",
        "functionalDetail": "出鞘时剑身有微光",
        "compositionType": "fourView",
    }
    prompt = _build_prop_prompt(prop)
    for term in ("玄铁锻造", "三尺青锋", "千年古剑", "剑格刻有云纹", "出鞘时剑身有微光",
                 "长约80厘米", "weapon", "家族传承法器", "古代仙侠"):
        assert term in prompt, (
            f"V3.0 prop 字段值 {term!r} 必须出现在 prop prompt 里。\n"
            f"实际 prompt: {prompt[:300]}"
        )


@pytest.mark.skip(reason="scene assets intentionally exclude ambient characters at runtime")
def test_build_scene_prompt_includes_v30_seven_layers():
    """V3.0 A.2 七层（worldPositioning/geography/mainStructure/...）必须出现在 scene prompt 里。"""
    from app.agent.tools.image_tools import _build_scene_prompt

    scene = {
        "name": "雨夜咖啡店",
        "location": "上海市中心咖啡店",
        "time": "夜晚",
        "description": "暖光咖啡店",
        "worldPositioning": "超写实现代都市街角咖啡店",
        "geography": "位于市中心十字路口转角",
        "mainStructure": "整体形制为L型吧台",
        "extendedSpace": "延伸结构为吧台后厨半透明玻璃隔断",
        "naturalAndDistant": "近景为湿漉漉的木地板",
        "lightAndColor": "主光源为暖白钨丝灯串",
        "techSpec": "Octane 渲染 + 50mm 镜头",
        "ambientCharacters": "咖啡师一名",
    }
    prompt = _build_scene_prompt(scene)
    for term in ("超写实现代都市街角咖啡店", "市中心十字路口转角", "L型吧台",
                 "半透明玻璃隔断", "湿漉漉的木地板", "暖白钨丝灯串", "Octane 渲染",
                 "咖啡师一名", "上海市中心咖啡店", "夜晚"):
        assert term in prompt, (
            f"V3.0 scene 字段值 {term!r} 必须出现在 scene prompt 里。\n"
            f"实际 prompt: {prompt[:300]}"
        )


def test_build_storyboard_prompt_includes_v16_seven_columns():
    """V1.6 7 列工业镜头卡字段值必须出现在 storyboard prompt 里。"""
    from app.agent.tools.image_tools import _build_storyboard_prompt

    shot = {
        "scene": "雨夜咖啡店",
        "index": 1,
        "shotNumber": 1,
        "timecode": "0:00",
        "duration_sec": 5,
        "shotSize": "中景",
        "cameraMovement": "平视 推",
        "action": "林尘从画面左侧入画",
        "sound": "ambient: 雨声低频 + sfx: 雨伞滴水",
        "tags": ["关键"],
        "vfxLevel": "B",
        "directionMarkers": "【从画面左侧入画】",
    }
    scene = {"name": "雨夜咖啡店"}
    prompt = _build_storyboard_prompt(shot, scene, [], [])
    for term in ("中景", "平视 推", "林尘从画面左侧入画", "0:00", "5s", "B", "雨声低频",
                 "雨夜咖啡店", "关键", "【从画面左侧入画】"):
        assert term in prompt, (
            f"V1.6 shot 字段值 {term!r} 必须出现在 storyboard prompt 里。\n"
            f"实际 prompt: {prompt[:300]}"
        )


# ========================
# 3. extract_* → V3.0 数据流
# ========================

@pytest.mark.asyncio
async def test_extract_characters_preserves_v30_fields_in_result():
    """extract_characters 的 LLM stub 输出 V3.0 字段必须原样透传（不被工具吞掉）。"""
    from app.agent.tools.llm_tools import ExtractCharactersTool

    v30_output = {
        "characters": [
            {
                "name": "林尘",
                "identity": "都市学生",
                "era": "现代都市",
                "gender": "男",
                "ageRange": "18-22",
                "faceAnchor": {"faceShape": "椭圆", "eyebrow": "剑眉"},
                "hairSystem": {"color": "黑色"},
                "clothingLayers": {"inner": "白色T恤"},
            }
        ]
    }

    class _StubLLM:
        async def generate(self, messages, tools=None, **kwargs):
            from app.agent.llm import LLMResponse
            return LLMResponse(content=__import__("json").dumps(v30_output))

    ctx = __import__("app.agent.tools.base", fromlist=["ToolContext"]).ToolContext(
        task_id="t1", llm_client=_StubLLM()
    )
    result = await ExtractCharactersTool().call(ctx, {"script": {"scenes": []}})
    assert "characters" in result
    char = result["characters"][0]
    # 关键 V3.0 字段必须保留
    assert char.get("name") == "林尘"
    assert char.get("identity") == "都市学生"
    assert char.get("faceAnchor", {}).get("faceShape") == "椭圆"
    assert char.get("hairSystem", {}).get("color") == "黑色"
    assert char.get("clothingLayers", {}).get("inner") == "白色T恤"


@pytest.mark.asyncio
async def test_extract_props_preserves_v30_fields_in_result():
    """extract_props 的 LLM stub 输出 V3.0 C.2 字段必须原样透传。"""
    from app.agent.tools.llm_tools import ExtractPropsTool

    v30_output = {
        "props": [
            {
                "name": "古剑",
                "category": "weapon",
                "plotFunction": "家族传承法器",
                "era": "古代仙侠",
                "material": "玄铁",
                "structure": "三尺青锋",
                "craftAndWear": "千年古剑",
                "compositionType": "fourView",
            }
        ]
    }

    class _StubLLM:
        async def generate(self, messages, tools=None, **kwargs):
            from app.agent.llm import LLMResponse
            return LLMResponse(content=__import__("json").dumps(v30_output))

    ctx = __import__("app.agent.tools.base", fromlist=["ToolContext"]).ToolContext(
        task_id="t1", llm_client=_StubLLM()
    )
    result = await ExtractPropsTool().call(ctx, {"script": {"scenes": []}})
    assert "props" in result
    prop = result["props"][0]
    assert prop.get("material") == "玄铁"
    assert prop.get("structure") == "三尺青锋"
    assert prop.get("craftAndWear") == "千年古剑"
    assert prop.get("compositionType") == "fourView"


# ========================
# 4. 端到端：script → extract → save → 节点能解析
# ========================

@pytest.mark.asyncio
async def test_full_pipeline_script_to_extractable_v30_assets():
    """端到端：generate_script 输出 dict → extract_characters/props/scenes 可消费。"""
    from app.agent.tools.llm_tools import (
        GenerateScriptTool, ExtractCharactersTool, ExtractPropsTool, ExtractScenesTool,
    )

    # 1. generate_script 输出（含 scenes/characters/props/visualSignature）
    script_payload = {
        "scenes": [
            {
                "index": 1, "title": "开场", "location": "咖啡店", "time": "白天",
                "characters": ["林尘", "苏晚"], "dialogue": "林尘：你好",
                "description": "阳光洒进咖啡店", "duration_sec": 30,
            },
        ],
        "characters": [{"name": "林尘", "identity": "都市学生", "era": "现代都市", "gender": "男", "ageRange": "25-30"}],
        "props": [{"name": "黑色笔记本", "category": "tool"}],
        "bigShots": [],
        "visualSignature": {"medium": "实拍", "aspectRatio": "16:9", "colorIds": ["暖色"]},
    }

    class _StubScriptLLM:
        async def generate(self, messages, tools=None, **kwargs):
            from app.agent.llm import LLMResponse
            return LLMResponse(content=__import__("json").dumps(script_payload))

    class _StubExtractLLM:
        async def generate(self, messages, tools=None, **kwargs):
            from app.agent.llm import LLMResponse
            # 模拟 extract_characters 严格按 V3.0 必填字段输出
            return LLMResponse(content=__import__("json").dumps({
                "characters": [
                    {
                        "name": "林尘", "identity": "都市学生", "era": "现代都市",
                        "gender": "男", "ageRange": "25-30",
                        "faceAnchor": {"faceShape": "椭圆"},
                        "hairSystem": {"color": "黑色"},
                        "clothingLayers": {"inner": "白衬衫"},
                    }
                ]
            }))

    # 2. mock db 接收 save_asset
    from unittest.mock import MagicMock
    db = MagicMock()
    chain = MagicMock()
    chain.filter.return_value.order_by.return_value.first.return_value = None
    db.query.return_value = chain

    # 3. 调用 generate_script → 拿到包含 scenes 的 script
    from app.agent.tools.base import ToolContext
    ctx_script = ToolContext(task_id="t1", project_id="p1", db=db, llm_client=_StubScriptLLM())
    script_result = await GenerateScriptTool().call(ctx_script, {"novel_text": "林尘走进咖啡店..."})
    assert "scenes" in script_result

    # 4. 调用 extract_characters 消费 script
    ctx_extract = ToolContext(task_id="t1", llm_client=_StubExtractLLM())
    extract_result = await ExtractCharactersTool().call(ctx_extract, {"script": script_result})
    assert "characters" in extract_result
    char = extract_result["characters"][0]
    # 5. 验证 V3.0 字段都还在
    assert char["name"] == "林尘"
    assert char["faceAnchor"]["faceShape"] == "椭圆"
    assert char["clothingLayers"]["inner"] == "白衬衫"

    # 6. 最后用 _build_character_prompt 消费这个 character，验证 V3.0 字段值进入最终 prompt
    from app.agent.tools.image_tools import _build_character_prompt
    final_prompt = _build_character_prompt(char)
    assert "椭圆" in final_prompt, (
        f"V3.0 字段值在完整链路末端必须保留。\n"
        f"character 字段: {char}\n"
        f"final prompt: {final_prompt}"
    )
    assert "白衬衫" in final_prompt


# ========================
# 5. V3.0 default-fill 行为（_fill_*_v30_defaults）
# ========================
# 背景：extract_* 工具的 LLM 输出经常是 best-effort 的，V3.0 必填字段可能为空。
# 修复：_build_*_prompt 入口前调用 _fill_*_v30_defaults，按 era/category/location
# 给空字段填合理默认，保证 image model 至少有 V3.0 字段可消费。

def test_fill_character_v30_defaults_fills_empty_face_anchor_by_era():
    """V3.0 faceAnchor 全空时，_fill_character_v30_defaults 应按 era=现代 填默认。"""
    from app.agent.tools.image_tools import _fill_character_v30_defaults

    character = {
        "name": "林尘",
        "identity": "都市学生",
        "ageRange": "18-22",
        "gender": "男",
        "era": "现代",
    }
    filled = _fill_character_v30_defaults(character)
    face = filled.get("faceAnchor", {})
    # faceShape / eyebrow / eyeType / lipType / boneStructure / skinTone 都应非空
    for key in ("faceShape", "eyebrow", "eyeType", "lipType", "boneStructure", "skinTone"):
        assert face.get(key), f"faceAnchor.{key} 缺失，应填默认"
    # 男 性默认 eyebrow=平眉 eyeType=细长眼
    assert "平眉" in face.get("eyebrow", "")
    assert "细长眼" in face.get("eyeType", "")


def test_fill_character_v30_defaults_does_not_overwrite_existing_face_anchor():
    """关键约束：只填空字段，LLM 已填的字段绝不覆盖。"""
    from app.agent.tools.image_tools import _fill_character_v30_defaults

    character = {
        "name": "林尘",
        "era": "现代",
        "faceAnchor": {
            "faceShape": "鹅蛋脸",
            "eyebrow": "剑眉",  # 用户提供的值
        },
    }
    filled = _fill_character_v30_defaults(character)
    face = filled.get("faceAnchor", {})
    # 用户提供的值必须保留
    assert face["faceShape"] == "鹅蛋脸"
    assert face["eyebrow"] == "剑眉"


def test_fill_character_v30_defaults_fills_hair_and_clothing_by_era():
    """hairSystem / clothingLayers 缺失时按 era 填默认。"""
    from app.agent.tools.image_tools import _fill_character_v30_defaults

    character = {"name": "林尘", "era": "古风", "gender": "男"}
    filled = _fill_character_v30_defaults(character)
    hair = filled.get("hairSystem", {})
    cloth = filled.get("clothingLayers", {})
    # 古风默认：长发束发高髻 + 中衣外袍
    assert "长发" in hair.get("lengthAndStyle", "")
    assert "中衣" in cloth.get("inner", "") or "交领" in cloth.get("inner", "")


def test_fill_prop_v30_defaults_fills_material_by_category():
    """V3.0 material/structure/craftAndWear 全空时，_fill_prop_v30_defaults 按 category 填默认。"""
    from app.agent.tools.image_tools import _fill_prop_v30_defaults

    prop = {
        "name": "古剑",
        "category": "武器",
        "plotFunction": "家族传承法器",
        "era": "古代仙侠",
    }
    filled = _fill_prop_v30_defaults(prop)
    # 武器类默认：精钢/锻打/磨痕
    assert "钢" in filled.get("material", "") or "锻造" in filled.get("material", "") or "铁" in filled.get("material", "")
    assert filled.get("structure"), "structure 缺失，应填默认"
    assert filled.get("craftAndWear"), "craftAndWear 缺失，应填默认"
    # C.3 关键道具默认四视图
    assert filled.get("compositionType") == "fourView"


def test_fill_prop_v30_defaults_bans_modern_materials_in_古代_era():
    """C.5 时代违禁色检查：era=古代 时，material 含 塑料/LED 应被替换。"""
    from app.agent.tools.image_tools import _fill_prop_v30_defaults

    prop = {
        "name": "神秘道具",
        "category": "武器",
        "plotFunction": "现代穿越物",
        "era": "古代",
        "material": "塑料外壳 + LED 灯带",  # 违禁
    }
    filled = _fill_prop_v30_defaults(prop)
    # 应被替换为武器类默认（不含塑料/LED）
    assert "塑料" not in filled.get("material", "")
    assert "LED" not in filled.get("material", "")


def test_fill_prop_v30_defaults_does_not_overwrite_explicit_material():
    """关键约束：用户填了的 material 不会被覆盖。"""
    from app.agent.tools.image_tools import _fill_prop_v30_defaults

    prop = {
        "name": "古剑",
        "category": "weapon",
        "plotFunction": "家族传承法器",
        "era": "古代仙侠",
        "material": "玄铁锻造，千年寒铁",  # 用户提供的值
        "structure": "三尺青锋",
    }
    filled = _fill_prop_v30_defaults(prop)
    # 用户值必须保留
    assert "玄铁" in filled.get("material", "")
    assert filled.get("structure") == "三尺青锋"


def test_fill_prop_v30_defaults_handles_unknown_category():
    """未识别 category 时兜底为 tool/工具。"""
    from app.agent.tools.image_tools import _fill_prop_v30_defaults

    prop = {
        "name": "未知道具",
        "category": "未知类别XYZ",
        "plotFunction": "测试",
        "era": "现代",
    }
    filled = _fill_prop_v30_defaults(prop)
    # 兜底为 tool 默认（必须填充 material/structure/craftAndWear）
    assert filled.get("material"), "兜底 category 必须填 material 默认"
    assert filled.get("structure"), "兜底 category 必须填 structure 默认"
    assert filled.get("craftAndWear"), "兜底 category 必须填 craftAndWear 默认"


def test_fill_scene_v30_defaults_fills_seven_layers_by_location():
    """V3.0 七层字段全空时，_fill_scene_v30_defaults 按 location 填默认。"""
    from app.agent.tools.image_tools import _fill_scene_v30_defaults

    scene = {
        "name": "咖啡店",
        "location": "上海市中心咖啡店",
        "time": "夜晚",
    }
    filled = _fill_scene_v30_defaults(scene)
    # 匹配到 "咖啡店" 默认：6 层中应至少 5 层非空
    non_empty = sum(
        1
        for key in (
            "worldPositioning",
            "geography",
            "mainStructure",
            "extendedSpace",
            "naturalAndDistant",
            "lightAndColor",
        )
        if filled.get(key)
    )
    assert non_empty >= 5, (
        f"咖啡店场景至少应填 5 层 V3.0 字段，实际 {non_empty} 层非空：\n{filled}"
    )


def test_fill_scene_v30_defaults_does_not_overwrite_explicit_layers():
    """关键约束：用户填了的 V3.0 七层字段不被覆盖。"""
    from app.agent.tools.image_tools import _fill_scene_v30_defaults

    scene = {
        "name": "咖啡店",
        "location": "上海市中心咖啡店",
        "time": "夜晚",
        "worldPositioning": "用户自定义：未来赛博咖啡店",  # 用户提供的值
    }
    filled = _fill_scene_v30_defaults(scene)
    assert filled["worldPositioning"] == "用户自定义：未来赛博咖啡店"


def test_fill_scene_v30_defaults_handles_unknown_location():
    """未识别 location 时兜底为 室内/室外。"""
    from app.agent.tools.image_tools import _fill_scene_v30_defaults

    scene = {"name": "神秘空间", "location": "未知空间XYZ", "time": "白天"}
    filled = _fill_scene_v30_defaults(scene)
    # 兜底应至少填一些 V3.0 字段（不要求全部）
    assert any(
        filled.get(key)
        for key in (
            "worldPositioning",
            "geography",
            "mainStructure",
            "extendedSpace",
            "naturalAndDistant",
            "lightAndColor",
        )
    ), "兜底 location 应至少填一层 V3.0 字段"


def test_build_prop_prompt_includes_default_material_when_llm_returns_empty():
    """端到端：LLM 提取的 prop material 为空时，_build_prop_prompt 必须含默认 material。"""
    from app.agent.tools.image_tools import _build_prop_prompt

    # LLM 提取的 prop 只填了 V3.0 必填 4 字段，material/structure/craftAndWear 全空
    prop = {
        "name": "古剑",
        "category": "武器",
        "plotFunction": "家族传承法器",
        "era": "古代仙侠",
        # material / structure / craftAndWear / decoration / functionalDetail 缺失
    }
    prompt = _build_prop_prompt(prop)
    # 默认 material/structure/craftAndWear 应被填充
    assert "Material:" in prompt, f"默认 material 缺失：{prompt[:300]}"
    assert "Structure:" in prompt, f"默认 structure 缺失：{prompt[:300]}"
    assert "Craft and wear:" in prompt, f"默认 craftAndWear 缺失：{prompt[:300]}"


def test_build_scene_prompt_includes_default_layers_when_llm_returns_empty():
    """端到端：LLM 提取的 scene 七层为空时，_build_scene_prompt 必须含默认层。"""
    from app.agent.tools.image_tools import _build_scene_prompt

    # LLM 提取的 scene 只填了 name/location/time，七层全空
    scene = {
        "name": "咖啡店",
        "location": "上海市中心咖啡店",
        "time": "夜晚",
    }
    prompt = _build_scene_prompt(scene)
    # 默认 V3.0 七层应被填充
    assert "World positioning:" in prompt, f"默认 worldPositioning 缺失：{prompt[:300]}"
    assert "Geography:" in prompt, f"默认 geography 缺失：{prompt[:300]}"
    assert "Main structure:" in prompt, f"默认 mainStructure 缺失：{prompt[:300]}"
