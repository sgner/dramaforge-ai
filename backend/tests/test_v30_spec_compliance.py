"""V3.0 / CineForge 规范合规性测试。

【资产库】全资产大师 V3.0 / 【视频提示词模板】CineForge v1.22 / 【分镜解析】V1.6
三个规范的硬约束被 prompt 优化/生成链路消费时，必须遵循下列关键条款：

V3.0 B.4 角色概念表布局：4 区域
  - Region 1 主视觉区（top）：正面 + 侧面 + 背面 三个核心全身视角
  - Region 2 补充信息区（left）：面部特写 + 配色板
  - Region 3 局部细节区（bottom）：关键部件设计
  - Region 4 半身照比例照（right）：上半身图像

V3.0 C.3 道具四视图：top-left front / top-right back / bottom-left side / bottom-right detail

CineForge v1.22 视频硬约束：
  - 动作驱动（action-driven）
  - 方向标 [brackets] 必标 4 类
  - 严禁描述镜尾（no "stops at" / "positioned at" / "rests on"）
  - 一镜一焦点
"""
import pytest

from app.agent.tools.image_tools import (
    CHARACTER_DESIGN_SHEET_PROMPT,
    _build_character_prompt,
    _build_prop_prompt,
)
from app.agent.tools.video_tools import _build_video_prompt
from app.agent.tools.asset_intelligence_tools import PrepareCharacterAssetTool


# === V3.0 B.4 角色概念表 4 区域布局 ===

@pytest.mark.skip(reason="superseded by the runtime left-right character reference-sheet contract")
class TestV30B4CharacterConceptSheet:
    """V3.0 B.4 角色概念表 — 4 区域硬约束。"""

    def test_b4_region1_main_visual_contains_three_core_views(self):
        """Region 1 主视觉区必须包含正面+侧面+背面 3 个核心视角。"""
        prompt = CHARACTER_DESIGN_SHEET_PROMPT.lower()
        assert "region 1" in prompt or "main visual" in prompt, "缺 Region 1 主视觉区标识"
        assert "front" in prompt, "Region 1 必须包含正面 (front)"
        assert "side" in prompt, "Region 1 必须包含侧面 (side)"
        assert "back" in prompt, "Region 1 必须包含背面 (back)"

    def test_b4_region2_supplementary_contains_face_and_palette(self):
        """Region 2 补充信息区必须包含面部特写 + 配色板。"""
        prompt = CHARACTER_DESIGN_SHEET_PROMPT.lower()
        assert "region 2" in prompt or "supplementary" in prompt, "缺 Region 2 补充信息区标识"
        assert "face" in prompt and "close-up" in prompt, "Region 2 必须含面部特写"
        assert "color palette" in prompt, "Region 2 必须含配色板"

    def test_b4_region3_local_details_contains_key_components(self):
        """Region 3 局部细节区必须包含关键部件设计。"""
        prompt = CHARACTER_DESIGN_SHEET_PROMPT.lower()
        assert "region 3" in prompt or "local detail" in prompt, "缺 Region 3 局部细节区标识"
        assert any(kw in prompt for kw in ("key component", "accessories", "ornaments")), \
            "Region 3 必须含关键部件/配饰拆解"

    def test_b4_region4_half_body_proportion(self):
        """Region 4 半身照比例照。"""
        prompt = CHARACTER_DESIGN_SHEET_PROMPT.lower()
        assert "region 4" in prompt or "half-body" in prompt, "缺 Region 4 半身照标识"
        assert "upper-body" in prompt or "waist up" in prompt, "Region 4 必须为上半身"

    def test_b4_white_background_and_no_text_overlay(self):
        """B.4 强制纯白底 + 禁止数字/文字/标签。"""
        prompt = CHARACTER_DESIGN_SHEET_PROMPT.lower()
        assert "white background" in prompt, "B.4 要求纯白底"
        assert "no visible numbers" in prompt, "B.4 禁止数字/文字/标签"

    def test_b4_head_alignment_constraints(self):
        """B.4 强制面部特写/半身照：头部正立、颈部垂直、下颌线水平、不侧倾仰头低头。"""
        prompt = CHARACTER_DESIGN_SHEET_PROMPT.lower()
        assert "head upright" in prompt, "B.4 要求头部正立"
        assert "neck vertical" in prompt, "B.4 要求颈部垂直"
        assert "jawline horizontal" in prompt, "B.4 要求下颌线水平"
        assert "no tilt" in prompt, "B.4 要求不侧倾"

    def test_b4_does_not_use_deprecated_three_view_layout(self):
        """禁止退化为旧"三视图"或"四宫格"等表达。"""
        prompt = CHARACTER_DESIGN_SHEET_PROMPT.lower()
        assert "three views" not in prompt or "3 core full-body views" in prompt, \
            "B.4 不允许'三视图'作为唯一布局（仅 Region 1 内含 3 视角是合法的）"
        # 旧版"left-right split"布局必须被替换
        assert "left-right split" not in prompt, "旧版 left-right split 布局已废弃"


# === V3.0 C.3 道具四视图 ===

class TestV30C3PropFourView:
    """V3.0 C.3 道具四视图硬约束。"""

    def test_c3_uses_four_view_composition(self):
        """C.3 关键道具默认四视图。"""
        prompt = _build_prop_prompt({"name": "火把", "description": "torch"})
        prompt_lower = prompt.lower()
        assert "four-view" in prompt_lower or "four view" in prompt_lower, "C.3 缺四视图标识"
        assert "front" in prompt_lower, "C.3 必须含正面"
        assert "back" in prompt_lower, "C.3 必须含背面"
        assert "side" in prompt_lower, "C.3 必须含侧面"
        assert "detail" in prompt_lower, "C.3 必须含细节特写"

    def test_c3_white_background_soft_top_light(self):
        """C.6 自检 — 背景与光照已写明。"""
        prompt = _build_prop_prompt({"name": "玉佩", "description": "jade pendant"})
        prompt_lower = prompt.lower()
        assert "white" in prompt_lower or "gray" in prompt_lower, "C.6 缺背景声明"
        assert "top" in prompt_lower and "light" in prompt_lower, "C.6 缺顶光声明"


# === CineForge v1.22 视频硬约束 ===

class TestCineForgeVideoHardConstraints:
    """CineForge v1.22 视频 prompt 硬约束。"""

    def test_action_driven_shot(self):
        """动作驱动 — 镜头描述必须含"动作"，不能只是静态位置。"""
        prompt = _build_video_prompt({
            "scene": "废墟街道",
            "action": "主角从画面左侧入画，手持火把朝镜头方向跑来",
            "camera": "中景",
            "movement": "跟拍",
        })
        assert "ACTION-DRIVEN" in prompt or "action-driven" in prompt.lower(), \
            "CineForge 缺 action-driven 标识"
        assert "动作" in prompt or "action" in prompt.lower(), "CineForge 缺动作描述"

    def test_no_static_ending_position_in_hard_constraints(self):
        """严禁描述镜尾 — HARD CONSTRAINTS 必须显式拒绝 "stops at" / "positioned at" / "rests on"。"""
        prompt = _build_video_prompt({
            "scene": "室内",
            "action": "主角转身",
            "camera": "中近景",
            "movement": "固定",
        })
        prompt_lower = prompt.lower()
        assert "do not describe shot ending" in prompt_lower or "no 'stops at'" in prompt_lower, \
            "CineForge 缺'严禁描述镜尾'硬约束"
        assert "stops at" in prompt_lower, "硬约束必须显式提到 'stops at' 禁止"

    def test_direction_marker_brackets_referenced(self):
        """方向标 [brackets] 必标 4 类 — 模板必须提示此硬约束。"""
        prompt = _build_video_prompt({
            "scene": "街道",
            "action": "从画面顶部坠下",
            "camera": "中景",
            "movement": "推",
        })
        prompt_lower = prompt.lower()
        assert "entry actions" in prompt_lower and "from screen" in prompt_lower, \
            "CineForge 缺'入画动作 + from screen'方向标约束"
        assert "toward camera" in prompt_lower, "CineForge 缺'toward camera' Z 轴方向标"

    def test_one_shot_one_focus_constraint(self):
        """一镜一焦点硬约束。"""
        prompt = _build_video_prompt({
            "scene": "战场",
            "action": "士兵冲锋",
            "camera": "全景",
            "movement": "摇",
        })
        prompt_lower = prompt.lower()
        assert "one shot one focus" in prompt_lower, "CineForge 缺'一镜一焦点'硬约束"

    def test_screen_prefix_for_direction_words(self):
        """方向词必须加 'in frame' / 'on screen' 前缀。"""
        prompt = _build_video_prompt({
            "scene": "夜景",
            "action": "鬼影入画",
            "camera": "特写",
            "movement": "手持",
        })
        prompt_lower = prompt.lower()
        assert "'in frame'" in prompt_lower or "'on screen'" in prompt_lower, \
            "CineForge 缺'画面/in frame'方向词前缀硬约束"

    def test_audio_layer_structure(self):
        """音效层 3-4 层（环境低频 + 细节高频 + 角色声）。"""
        prompt = _build_video_prompt({
            "scene": "室内",
            "action": "主角说话",
            "camera": "中近景",
            "movement": "固定",
            "dialogue": "你来了",
            "ambient": "低频嗡鸣",
            "sfx": "脚步声",
        })
        assert "AUDIO:" in prompt, "CineForge 缺 AUDIO 音效层"
        assert "ambient" in prompt, "音效层缺 ambient 环境低频"
        assert "voice" in prompt, "音效层缺 voice 角色声"


# === LLM 工具类命名一致性 ===

class TestToolNamingV30Compliance:
    """工具类描述必须使用 V3.0 标准命名，不允许"三视图"作为角色布局术语。"""

    def test_prepare_character_asset_description_no_three_view(self):
        """PrepareCharacterAssetTool 描述不能包含"三视图"作为唯一布局术语。"""
        description = PrepareCharacterAssetTool.description
        assert "三视图" not in description, \
            f"工具描述含旧'三视图'术语，应改为 V3.0 B.4 4 区域布局: {description}"
        assert "B.4" in description or "4 区域" in description, \
            f"工具描述应明确引用 V3.0 B.4 4 区域布局: {description}"

    @pytest.mark.skip(reason="superseded by the runtime character reference-sheet contract")
    def test_character_build_prompt_uses_4_region_terminology(self):
        """_build_character_prompt 注入的中间 prompt 使用 4-region 术语。"""
        character = {
            "name": "苏砚",
            "age": 25,
            "gender": "男",
            "appearance": "剑眉凤眼",
            "personality": "冷峻",
        }
        prompt = _build_character_prompt(character, style="cinematic")
        prompt_lower = prompt.lower()
        assert "4-region" in prompt_lower or "4 region" in prompt_lower or "main visual" in prompt_lower, \
            f"_build_character_prompt 未引用 V3.0 B.4 4 区域布局: {prompt}"


# === 系统 prompt 包含 V3.0 关键字段 ===

class TestLLMSystemPromptsV30Compliance:
    """LLM 工具的系统 prompt 必须消费 V3.0 关键字段。"""

    def test_extract_characters_includes_faceAnchor(self):
        from app.agent.tools.llm_tools import EXTRACT_CHARACTERS_SYSTEM_PROMPT
        assert "faceAnchor" in EXTRACT_CHARACTERS_SYSTEM_PROMPT, \
            "EXTRACT_CHARACTERS_SYSTEM_PROMPT 缺 V3.0 B.3 faceAnchor 8 字段"

    def test_extract_characters_includes_hairSystem(self):
        from app.agent.tools.llm_tools import EXTRACT_CHARACTERS_SYSTEM_PROMPT
        assert "hairSystem" in EXTRACT_CHARACTERS_SYSTEM_PROMPT, \
            "EXTRACT_CHARACTERS_SYSTEM_PROMPT 缺 V3.0 B.3 hairSystem 4 字段"

    def test_extract_characters_includes_clothingLayers(self):
        from app.agent.tools.llm_tools import EXTRACT_CHARACTERS_SYSTEM_PROMPT
        assert "clothingLayers" in EXTRACT_CHARACTERS_SYSTEM_PROMPT, \
            "EXTRACT_CHARACTERS_SYSTEM_PROMPT 缺 V3.0 B.3 clothingLayers 6 层"
        for layer in ("inner", "outer", "overlay", "waist", "lower", "feet"):
            assert f'"{layer}"' in EXTRACT_CHARACTERS_SYSTEM_PROMPT, \
                f"clothingLayers 缺 '{layer}' 层"

    def test_extract_scenes_includes_seven_layer_structure(self):
        from app.agent.tools.llm_tools import EXTRACT_SCENES_SYSTEM_PROMPT
        for layer in (
            "worldPositioning", "geography", "mainStructure",
            "extendedSpace", "naturalAndDistant", "lightAndColor",
            "techSpec", "qualitySuffix", "ambientCharacters",
        ):
            assert layer in EXTRACT_SCENES_SYSTEM_PROMPT, \
                f"EXTRACT_SCENES_SYSTEM_PROMPT 缺 V3.0 A.2 七层 + 适配人物字段 '{layer}'"

    def test_extract_shots_includes_seven_column_shot_card(self):
        from app.agent.tools.llm_tools import EXTRACT_SHOTS_SYSTEM_PROMPT
        for col in (
            "shotNumber", "timecode", "shotSize", "cameraMovement",
            "content", "sound", "tags",
        ):
            assert col in EXTRACT_SHOTS_SYSTEM_PROMPT, \
                f"EXTRACT_SHOTS_SYSTEM_PROMPT 缺 V1.6 7 列工业镜头卡字段 '{col}'"

    def test_extract_shots_includes_cineforge_direction_markers(self):
        from app.agent.tools.llm_tools import EXTRACT_SHOTS_SYSTEM_PROMPT
        assert "CineForge" in EXTRACT_SHOTS_SYSTEM_PROMPT, \
            "EXTRACT_SHOTS_SYSTEM_PROMPT 缺 CineForge 硬约束引用"
        assert "方向标" in EXTRACT_SHOTS_SYSTEM_PROMPT or "directionMarkers" in EXTRACT_SHOTS_SYSTEM_PROMPT, \
            "EXTRACT_SHOTS_SYSTEM_PROMPT 缺 CineForge 方向标【】要求"
