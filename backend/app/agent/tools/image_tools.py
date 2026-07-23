"""图像生成工具：4 个 — 角色概念表 / 道具 / 场景 / 分镜图。

所有工具都通过 ctx.media_service 调底层 provider，requires_approval=True。

角色概念表布局严格遵循【资产库】全资产大师 V3.0 B.4 — 4 区域布局
（主视觉区 + 补充信息区 + 局部细节区 + 半身照比例照），不允许退化为
"三视图"或"四宫格"等旧表达。
"""
from __future__ import annotations

import re
from typing import Any

from ..media_service import MediaRequest, MediaService, get_default_media_service
from ..asset_references import resolve_asset_references
from ..prompt_engineering import (
    optimize_generation_prompt,
    collect_storyboard_reference_asset_ids,
    sanitize_structured_field,
)
from .base import BaseTool, ToolContext, ToolParameter
from ..specs import get_spec_for_tool


# 兼容旧 import 路径：image_tools 内部仍可能引用 _sanitize_structured_field。
# 实际实现已上移到 prompt_engineering（单一来源，方便 video_tools 等复用）。
_sanitize_structured_field = sanitize_structured_field


# 角色概念表布局（V3.0 B.4 严格 4 区域，固定文本，必须原样嵌入角色 prompt 末尾）
# Region 1 主视觉区：正面 + 侧面 + 背面 三个核心全身视角
# Region 2 补充信息区：面部特写 + 配色板（明确毛发/服饰/配件色值）
# Region 3 局部细节区：关键部件拆解（配饰/点缀/身份识别元素）
# Region 4 半身照比例照：上半身图像
CHARACTER_DESIGN_SHEET_PROMPT = (
    "Character concept sheet, 4-region layout on pure white background, "
    "compliant with Asset Library V3.0 B.4 character concept sheet specification. "
    "Region 1 — Main Visual Area (top, spans full width): three core full-body views of the same character "
    "arranged in a horizontal row from left to right — "
    "front standing view (arms hanging naturally, feet together, complete front costume and body proportions), "
    "side profile view (weight slightly shifted, waist-hip curve and silhouette visible, complete side costume and footwear), "
    "back view (complete back neckline, hairstyle from behind, back costume details). "
    "Region 2 — Supplementary Information Area (left lower section): face close-up portrait "
    "(head upright, neck vertical, jawline horizontal, top of head to chin aligned on the vertical center axis of the frame, "
    "no tilt, no looking up, no looking down) plus a color palette swatch panel explicitly listing the exact color values "
    "for hair, skin, primary costume, secondary costume, and accessories. "
    "Region 3 — Local Detail Area (bottom, spans full width): small isolated modules each rendering a key component design "
    "(accessories, ornaments, critical identity markers such as faction badge, insignia, scar, tattoo, prosthetic) "
    "as precision production references. "
    "Region 4 — Half-Body Proportion Photo (right lower section): upper-body image of the character from waist up, "
    "head upright, neck vertical, jawline horizontal, top of head to chin aligned on the vertical center axis of the frame, "
    "no tilt, no looking up, no looking down. "
    "Consistent front-top-side lighting across all 4 regions, soft diffused light quality, pure white or light warm gray background (F0EDE8), "
    "subjects softly blending with background with natural edge transition, no hard edges no white halo no light bleed, "
    "identical character design, costume, hairstyle and accessories across all regions, professional character concept sheet style, "
    "clean edges, accurate proportions, material texture visible from all angles, "
    "absolutely no visible numbers, text, labels, frame counters, corner marks or annotations anywhere on the image"
)


CHARACTER_DESIGN_SHEET_PROMPT = (
    "Character reference sheet, left-right split layout: left one-third area is chest-up close-up front view portrait "
    "(shoulder-up framing, extreme facial detail clarity, gentle natural expression, bright eyes looking straight at camera, "
    "realistic skin texture with visible pores and subtle imperfections, refined classical makeup); right two-thirds area is "
    "three full-body views in horizontal row, from left to right: full-body front standing pose (arms hanging naturally, "
    "feet together, complete front costume and body proportions), full-body side profile view (weight slightly shifted, "
    "waist-hip curve and silhouette visible, complete side costume and footwear), full-body back view (complete back neckline, "
    "hairstyle from behind, back costume details). Consistent front-top-side lighting across all panels, soft diffused light quality, "
    "light warm gray background color F0EDE8, subjects softly blending with background with natural edge transition, no hard edges "
    "no white halo no light bleed, identical character design, costume, hairstyle and accessories across all panels, professional "
    "character design sheet style, clean edges, accurate proportions, material texture visible from all angles, absolutely no visible "
    "numbers, text, labels, frame counters, corner marks or annotations anywhere on the image"
)

STORYBOARD_SIX_GRID_PROMPT = (
    "Six-panel storyboard sheet, 2 rows by 3 columns, one single image containing exactly six clearly separated panels. "
    "Panel 1 is a pure black buffer frame with no content. Panels 2 through 6 are sequential frozen story frames for the same shot, "
    "each showing one readable action beat with the referenced environment and characters. Use clean thin panel dividers, consistent "
    "character identity, costume, environment, lighting, color palette and medium across all panels, "
    "full color, cinematic storyboard style faithfully inheriting the project's visual signature "
    "(medium, color palette, lighting, and texture), "
    "no extra panels, no single full-frame composition, no UI, no watermark, no readable text, no numbers, no labels, no annotations."
)

# 道具四视图构图（V3.0 C.3 默认）：_build_prop_prompt / 批量生成 / canonical_layout 共用同一文本
PROP_FOUR_VIEW_LAYOUT = (
    "prop reference sheet, four-view composition: "
    "top-left full front view, top-right full back view, "
    "bottom-left side view (showing thickness and layering), "
    "bottom-right detail close-up (showing engravings, inscriptions, mechanisms, wear marks), "
    "pure white or light gray background, soft top lighting, high detail, sharp focus"
)


def _resolve_service(ctx: ToolContext) -> MediaService:
    return ctx.media_service or get_default_media_service()


def _resolve_reference_urls(ctx: ToolContext, params: dict, media_kind: str = "image") -> list[str]:
    """Resolve project-scoped logical asset IDs before calling a provider."""
    asset_ids = list(params.get("reference_asset_ids") or [])
    if not asset_ids:
        return list(params.get("reference_urls") or [])
    if not ctx.db or not ctx.project_id:
        raise ValueError("reference_asset_ids require a project-scoped database context")
    return [item["url"] for item in resolve_asset_references(ctx.db, ctx.project_id, asset_ids, media_kind=media_kind)]


async def _check_existing_assets(
    ctx: ToolContext,
    *,
    name: str | None = None,
    asset_kind: str | None = None,
) -> list[dict] | None:
    """生成前检查项目资产库是否已有可复用资产。

    有匹配时发 asset_reuse_preview 事件并返回资产列表。
    无匹配时返回 None。
    """
    if not ctx.db or not ctx.project_id or not name:
        return None
    from .asset_registry_helpers import search_assets
    results = search_assets(ctx.db, ctx.project_id, name, asset_kind=asset_kind)
    if not results:
        return None
    if ctx.emit:
        ctx.emit("asset_reuse_preview", {
            "tool": "asset_check",
            "matched_assets": results,
            "action": "will_reuse",
        })
    return results


async def _collect_canvas_refs_for_ctx(ctx: ToolContext) -> list[str]:
    """从画布连线收集 asset_ref，供生成工具使用。"""
    if not ctx.db or not ctx.project_id:
        return []
    from .asset_registry_helpers import collect_canvas_references
    return collect_canvas_references(ctx.db, ctx.project_id)


def _format_face_anchor(face: dict | None) -> str:
    """把 V3.0 B.3 faceAnchor（8 字段）拼成自然语言描述段。

    输入示例：{"faceShape": "椭圆", "eyebrow": "剑眉", "eyeType": "丹凤眼", ...}
    返回示例：'脸型椭圆；眉形剑眉；眼型丹凤眼；鼻型高直；唇形薄唇；骨相颧骨分明，下颌线锋利；
              肤色冷白；局部识别点：左眼角小痣。'
    """
    if not isinstance(face, dict) or not face:
        return ""
    bits: list[str] = []
    mapping = (
        ("faceShape", "脸型"),
        ("eyebrow", "眉形"),
        ("eyeType", "眼型"),
        ("noseType", "鼻型"),
        ("lipType", "唇形"),
        ("boneStructure", "骨相"),
        ("skinTone", "肤色"),
        ("landmarks", "局部识别点"),
    )
    for key, label in mapping:
        value = _sanitize_structured_field(face.get(key, ""))
        if value:
            sep = "：" if key == "landmarks" else ""
            bits.append(f"{label}{sep}{value}" if sep else f"{label}{value}")
    return "；".join(bits)


def _format_hair_system(hair: dict | None) -> str:
    """把 V3.0 B.3 hairSystem（4 字段）拼成自然语言描述段。"""
    if not isinstance(hair, dict) or not hair:
        return ""
    bits: list[str] = []
    if (v := _sanitize_structured_field(hair.get("lengthAndStyle", ""))):
        bits.append(f"长度与束法：{v}")
    if (v := _sanitize_structured_field(hair.get("color", ""))):
        bits.append(f"发色：{v}")
    if (v := _sanitize_structured_field(hair.get("headwear", ""))):
        bits.append(f"头饰/帽子：{v}")
    if (v := _sanitize_structured_field(hair.get("bangsDirection", ""))):
        bits.append(f"鬓角与刘海：{v}")
    return "；".join(bits)


def _format_clothing_layers(cloth: dict | None) -> str:
    """把 V3.0 B.3 clothingLayers（6 层：inner/outer/overlay/waist/lower/feet）拼成自然语言描述段。

    顺序按 B.2 "从内到外 + 腰部 + 下肢 + 足部" 固定，不允许改动。
    """
    if not isinstance(cloth, dict) or not cloth:
        return ""
    layer_order = (
        ("inner", "内层"),
        ("outer", "外层"),
        ("overlay", "套层"),
        ("waist", "腰部"),
        ("lower", "下装"),
        ("feet", "足部"),
    )
    bits: list[str] = []
    for key, label in layer_order:
        value = _sanitize_structured_field(cloth.get(key, ""))
        if value:
            bits.append(f"{label}：{value}")
    return "；".join(bits)


# ========================
# V3.0 默认值填充（当 LLM 未填字段时使用）
# ========================
# 背景：extract_characters 的 LLM 输出经常是 best-effort 的（V3.0 详细字段可能为空）。
# 这些字段在 _build_character_prompt 时被读到，缺失会导致 prompt 只剩"Character concept
# art of 林尘"这种骨架信息，image model 渲染出来"长得都一样"。
#
# 修复：在 _build_character_prompt 入口前，对空字段填合理默认：
# - 根据 era 字段（古风/现代/民国/赛博/未来等）给发型/服装/五官建议
# - 根据 gender 字段给合理性别化默认
# - 根据 ageRange 字段给年龄段默认
#
# 关键：只填空字段，已填字段不覆盖。LLM 给了"黑色短发"就用黑色短发，不要无脑覆盖。

# 时代 → 默认发型/服装调色板（V3.0 B.1+B.2 兜底）
_ERA_DEFAULTS: dict[str, dict[str, str]] = {
    "古风": {
        "hair_style": "长发束发高髻，黑色发丝，鬓角服帖",
        "hair_color": "墨黑",
        "hair_bangs": "无刘海，发髻端庄",
        "skin": "暖白，瓷质",
        "face": "鹅蛋脸，柳叶眉，凤眼",
        "bone": "颧骨柔和，下颌线圆润",
        "lip": "薄唇，唇色自然偏红",
        "inner": "白色交领中衣",
        "outer": "青灰色对襟长袍",
        "lower": "墨色百褶长裙",
        "feet": "绣花布鞋",
        "waist": "同色绸缎腰带",
    },
    "古代": {
        "hair_style": "长发束发高髻，黑色发丝",
        "hair_color": "墨黑",
        "hair_bangs": "无刘海",
        "skin": "暖白",
        "face": "鹅蛋脸，柳叶眉",
        "bone": "颧骨柔和",
        "lip": "薄唇",
        "inner": "白色中衣",
        "outer": "素色长袍",
        "lower": "百褶长裙",
        "feet": "布鞋",
        "waist": "绸缎腰带",
    },
    "民国": {
        "hair_style": "民国学生头/麻花辫，黑色发丝",
        "hair_color": "黑色",
        "hair_bangs": "齐刘海或偏分",
        "skin": "暖白",
        "face": "鹅蛋脸，弯眉",
        "bone": "下颌线柔和",
        "lip": "薄唇",
        "inner": "白色棉布衬衫",
        "outer": "藏蓝色学生装/旗袍",
        "lower": "黑色长裙/西装裤",
        "feet": "黑色皮鞋/小皮鞋",
        "waist": "细腰带",
    },
    "现代": {
        "hair_style": "现代短发或中长发，黑色或深棕",
        "hair_color": "黑色/深棕",
        "hair_bangs": "侧分或碎刘海",
        "skin": "暖白",
        "face": "椭圆脸，平眉",
        "bone": "下颌线干净",
        "lip": "薄唇",
        "inner": "白色T恤或衬衫",
        "outer": "深色西装外套或休闲夹克",
        "lower": "深色长裤或半裙",
        "feet": "现代皮鞋或运动鞋",
        "waist": "皮带或松紧腰",
    },
    "现代都市": {
        "hair_style": "现代短发或中长发，黑色或深棕",
        "hair_color": "黑色/深棕",
        "hair_bangs": "侧分或碎刘海",
        "skin": "暖白",
        "face": "椭圆脸",
        "bone": "下颌线干净",
        "lip": "薄唇",
        "inner": "白色T恤",
        "outer": "深色西装外套",
        "lower": "深色长裤",
        "feet": "现代皮鞋",
        "waist": "皮带",
    },
    "赛博": {
        "hair_style": "染色短发或脏辫，金属感发丝",
        "hair_color": "银白/霓虹紫/电光蓝",
        "hair_bangs": "不对称碎刘海或全剃",
        "skin": "苍白带金属质感",
        "face": "棱角分明，高颧骨",
        "bone": "眉骨突出，下颌线锋利",
        "lip": "薄唇，唇色金属灰",
        "inner": "碳纤维内衬",
        "outer": "机能风战术外套",
        "lower": "工装裤配战术绑带",
        "feet": "碳纤维战靴",
        "waist": "战术腰带带挂载点",
    },
    "赛博朋克": {
        "hair_style": "染色短发，金属感",
        "hair_color": "银白/霓虹紫",
        "hair_bangs": "不对称碎刘海",
        "skin": "苍白",
        "face": "棱角分明",
        "bone": "高颧骨，下颌线锋利",
        "lip": "薄唇",
        "inner": "碳纤维内衬",
        "outer": "机能风外套",
        "lower": "工装裤",
        "feet": "战靴",
        "waist": "战术腰带",
    },
    "未来": {
        "hair_style": "染色短发，金属感",
        "hair_color": "银白",
        "hair_bangs": "干净利落",
        "skin": "苍白",
        "face": "棱角分明",
        "bone": "高颧骨",
        "lip": "薄唇",
        "inner": "碳纤维内衬",
        "outer": "机能风外套",
        "lower": "工装裤",
        "feet": "战靴",
        "waist": "战术腰带",
    },
}


def _fill_character_v30_defaults(character: dict) -> dict:
    """为 character 的 V3.0 空字段填合理默认（基于 era/gender/ageRange）。

    关键约束：
    1. 只填空字段 — LLM 已填的字段绝不覆盖（"黑色短发"不会被改成"现代短发"）
    2. era 匹配不到默认表时 → 用"现代"兜底
    3. hairSystem/clothingLayers/faceAnchor 三个 nested dict 单独处理：
       - 若整个 nested dict 为空 → 填 era 默认
       - 若 nested dict 部分字段空 → 只填空字段

    返回：填充后的 character dict（in-place 修改并返回）
    """
    if not isinstance(character, dict):
        return character

    era = _sanitize_structured_field(character.get("era", ""))
    # 尝试匹配 era key（中文短串最匹配）
    era_key = ""
    for key in _ERA_DEFAULTS:
        if key in era:
            era_key = key
            break
    if not era_key:
        era_key = "现代"  # 兜底

    defaults = _ERA_DEFAULTS[era_key]
    gender = _sanitize_structured_field(character.get("gender", ""))
    age_range = _sanitize_structured_field(character.get("ageRange", ""))

    # 1. faceAnchor（8 字段）— 缺失则填 era 默认
    face = character.get("faceAnchor")
    if not isinstance(face, dict):
        face = {}
    face_filled = dict(face)
    field_to_default = {
        "faceShape": defaults.get("face"),
        "eyebrow": defaults.get("face", "").split("，")[1] if "，" in defaults.get("face", "") else "",
        "eyeType": defaults.get("face", ""),
        "noseType": "高直",
        "lipType": defaults.get("lip", "薄唇"),
        "boneStructure": defaults.get("bone", ""),
        "skinTone": defaults.get("skin", "暖白"),
        "landmarks": "",
    }
    # 简化：face anchor 每个字段各自填空
    if not face_filled.get("faceShape"):
        face_filled["faceShape"] = defaults.get("face", "椭圆脸").split("，")[0] if defaults.get("face") else "椭圆脸"
    if not face_filled.get("eyebrow"):
        face_filled["eyebrow"] = "平眉" if gender != "女" else "柳叶眉"
    if not face_filled.get("eyeType"):
        face_filled["eyeType"] = "细长眼" if gender == "男" else "杏眼"
    if not face_filled.get("noseType"):
        face_filled["noseType"] = "高直"
    if not face_filled.get("lipType"):
        face_filled["lipType"] = defaults.get("lip", "薄唇")
    if not face_filled.get("boneStructure"):
        face_filled["boneStructure"] = defaults.get("bone", "下颌线干净")
    if not face_filled.get("skinTone"):
        face_filled["skinTone"] = defaults.get("skin", "暖白")
    if not face_filled.get("landmarks"):
        face_filled["landmarks"] = ""
    character["faceAnchor"] = face_filled

    # 2. hairSystem（4 字段）— 缺失则填 era 默认
    hair = character.get("hairSystem")
    if not isinstance(hair, dict):
        hair = {}
    hair_filled = dict(hair)
    if not hair_filled.get("lengthAndStyle"):
        hair_filled["lengthAndStyle"] = defaults.get("hair_style", "中长发")
    if not hair_filled.get("color"):
        hair_filled["color"] = defaults.get("hair_color", "黑色")
    if not hair_filled.get("headwear"):
        hair_filled["headwear"] = "无" if era_key not in {"古风", "古代", "民国"} else defaults.get("hair_style", "")
    if not hair_filled.get("bangsDirection"):
        hair_filled["bangsDirection"] = defaults.get("hair_bangs", "侧分")
    character["hairSystem"] = hair_filled

    # 3. clothingLayers（6 层）— 缺失则填 era 默认
    cloth = character.get("clothingLayers")
    if not isinstance(cloth, dict):
        cloth = {}
    cloth_filled = dict(cloth)
    for key, default_key in (
        ("inner", "inner"),
        ("outer", "outer"),
        ("overlay", "overlay"),
        ("waist", "waist"),
        ("lower", "lower"),
        ("feet", "feet"),
    ):
        if not cloth_filled.get(key):
            cloth_filled[key] = defaults.get(default_key, "")
    # overlay 默认空（披风/斗篷不是人人有）
    cloth_filled.setdefault("overlay", "")
    character["clothingLayers"] = cloth_filled

    # 4. specialState / voice（best-effort，空就空，不要瞎填）
    #    这些是 LLM 真有上下文才能填的字段，缺失就缺失，_format_face_anchor/_format_hair_system
    #    已经处理空字符串，prompt builder 会自然跳过。

    return character


# ========================
# V3.0 道具默认值填充（当 LLM 未填字段时使用）
# ========================
# 背景：与 _fill_character_v30_defaults 同理 — extract_props 的 LLM 输出经常是
# best-effort 的（V3.0 必填字段 material/structure/craftAndWear 可能为空）。这些
# 字段在 _build_prop_prompt 时被读到，缺失会导致 prompt 只剩 "Object: 古剑, ...
# category: weapon" 这种骨架信息，image model 渲染出"白底一根棍子"。
#
# 修复：在 _build_prop_prompt 入口前，按 category（C.1 八大类）和 era 给空字段填
# 合理默认（材质、结构、工艺与年代痕迹、装饰、功能细节）。
#
# 关键：只填空字段，已填字段不覆盖。LLM 给了"玄铁锻造"就用玄铁锻造，不要无脑覆盖。

# 道具分类（C.1 八大类） → 默认材质/结构/工艺（C.2 必填字段）
_PROP_CATEGORY_DEFAULTS: dict[str, dict[str, str]] = {
    "weapon": {
        "material": "精钢锻造，金属光泽",
        "structure": "流线型刃体，握柄与刃身分段",
        "craftAndWear": "锻打成型，刃口有使用磨痕",
        "decoration": "握柄缠绳或刻纹",
        "functionalDetail": "锋利刃口，可单手握持",
    },
    "武器": {
        "material": "精钢锻造，金属光泽",
        "structure": "流线型刃体，握柄与刃身分段",
        "craftAndWear": "锻打成型，刃口有使用磨痕",
        "decoration": "握柄缠绳或刻纹",
        "functionalDetail": "锋利刃口，可单手握持",
    },
    "法宝": {
        "material": "温润玉石或灵石，半透明质感",
        "structure": "圆盘或吊坠形制，符文环绕",
        "craftAndWear": "灵力蕴养，表面泛微光",
        "decoration": "刻有古朴符文或云纹",
        "functionalDetail": "注入灵力后散发柔光",
    },
    "超凡": {
        "material": "温润玉石或灵石，半透明质感",
        "structure": "圆盘或吊坠形制，符文环绕",
        "craftAndWear": "灵力蕴养，表面泛微光",
        "decoration": "刻有古朴符文或云纹",
        "functionalDetail": "注入灵力后散发柔光",
    },
    "tool": {
        "material": "金属与木质或塑料组合，触感真实",
        "structure": "人体工学设计，把手与工作端分明",
        "craftAndWear": "现代工艺制造，边缘有磨损",
        "decoration": "无装饰，注重功能性",
        "functionalDetail": "可单手操作，结构合理",
    },
    "工具": {
        "material": "金属与木质或塑料组合，触感真实",
        "structure": "人体工学设计，把手与工作端分明",
        "craftAndWear": "现代工艺制造，边缘有磨损",
        "decoration": "无装饰，注重功能性",
        "functionalDetail": "可单手操作，结构合理",
    },
    "信物": {
        "material": "玉/金/木/纸，材质温润",
        "structure": "小巧精致，便于佩戴或携带",
        "craftAndWear": "岁月包浆，年代痕迹明显",
        "decoration": "刻有铭记文字或家族纹样",
        "functionalDetail": "随身佩戴或藏于衣物内侧",
    },
    "证物": {
        "material": "玉/金/木/纸，材质温润",
        "structure": "小巧精致，便于佩戴或携带",
        "craftAndWear": "岁月包浆，年代痕迹明显",
        "decoration": "刻有铭记文字或家族纹样",
        "functionalDetail": "随身佩戴或藏于衣物内侧",
    },
    "载具": {
        "material": "金属/复合材料，结构坚固",
        "structure": "流线型或机械感造型，体积大",
        "craftAndWear": "精密机械加工，接缝严丝合缝",
        "decoration": "工业设计，注重功能",
        "functionalDetail": "可乘坐或运载，操作机构完整",
    },
    "vehicle": {
        "material": "金属/复合材料，结构坚固",
        "structure": "流线型或机械感造型，体积大",
        "craftAndWear": "精密机械加工，接缝严丝合缝",
        "decoration": "工业设计，注重功能",
        "functionalDetail": "可乘坐或运载，操作机构完整",
    },
    "科技装备": {
        "material": "金属与碳纤维，金属光泽",
        "structure": "集成化设计，模块化拼接",
        "craftAndWear": "现代科技制造，LED 指示灯",
        "decoration": "科技纹路或品牌 LOGO",
        "functionalDetail": "电子屏幕或按钮可操作",
    },
    "科技": {
        "material": "金属与碳纤维，金属光泽",
        "structure": "集成化设计，模块化拼接",
        "craftAndWear": "现代科技制造，LED 指示灯",
        "decoration": "科技纹路或品牌 LOGO",
        "functionalDetail": "电子屏幕或按钮可操作",
    },
    "生活器物": {
        "material": "陶/瓷/木/金属，传统材料",
        "structure": "传统器形，比例协调",
        "craftAndWear": "传统工艺烧制或打磨，釉色温润",
        "decoration": "青花或素色釉面",
        "functionalDetail": "盛放液体或食物，实用为主",
    },
    "生活": {
        "material": "陶/瓷/木/金属，传统材料",
        "structure": "传统器形，比例协调",
        "craftAndWear": "传统工艺烧制或打磨，釉色温润",
        "decoration": "青花或素色釉面",
        "functionalDetail": "盛放液体或食物，实用为主",
    },
    "剧情物件": {
        "material": "纸/布/金属/皮革，材质多样",
        "structure": "折叠或卷曲状，便于隐藏",
        "craftAndWear": "岁月痕迹明显，泛黄或破损",
        "decoration": "手写文字或血渍",
        "functionalDetail": "可展开阅读或藏匿",
    },
    "剧情": {
        "material": "纸/布/金属/皮革，材质多样",
        "structure": "折叠或卷曲状，便于隐藏",
        "craftAndWear": "岁月痕迹明显，泛黄或破损",
        "decoration": "手写文字或血渍",
        "functionalDetail": "可展开阅读或藏匿",
    },
}

# 时代 → 道具时代修正（C.5 禁止与世界观脱节：古代不得出现塑料/LED）
_ERA_PROP_DEFAULTS: dict[str, dict[str, str]] = {
    "古风": {
        "material_floor": "古代材料：青铜/铁/木/玉/丝绢",
        "decoration_floor": "云纹/回字纹/饕餮纹/篆字",
    },
    "古代": {
        "material_floor": "古代材料：青铜/铁/木/玉/丝绢",
        "decoration_floor": "云纹/回字纹/饕餮纹/篆字",
    },
    "民国": {
        "material_floor": "民国材料：黄铜/老木/皮革/粗棉",
        "decoration_floor": "民国商标/手写毛笔字/旧式花纹",
    },
    "现代": {
        "material_floor": "现代材料：不锈钢/塑料/玻璃/合成纤维",
        "decoration_floor": "现代 LOGO/印刷文字/极简线条",
    },
    "现代都市": {
        "material_floor": "现代材料：不锈钢/塑料/玻璃/合成纤维",
        "decoration_floor": "现代 LOGO/印刷文字/极简线条",
    },
    "赛博": {
        "material_floor": "赛博材料：金属/碳纤维/全息膜/电致发光材料",
        "decoration_floor": "霓虹电路纹/赛博 LOGO/全息投影",
    },
    "赛博朋克": {
        "material_floor": "赛博材料：金属/碳纤维/全息膜/电致发光材料",
        "decoration_floor": "霓虹电路纹/赛博 LOGO/全息投影",
    },
    "未来": {
        "material_floor": "未来材料：钛合金/碳纤维/智能材料",
        "decoration_floor": "极简科技纹/光带",
    },
}


def _match_category_key(category: str) -> str:
    """根据 category 字符串匹配 _PROP_CATEGORY_DEFAULTS key（中英文子串匹配）。

    category 可能为 "weapon"、"武器"、"武器类"、"法宝/超凡类" 等。优先取最长
    key 匹配以避免 "武器" 匹配 "武器类" 后被截断。
    """
    if not category:
        return ""
    keys = sorted(_PROP_CATEGORY_DEFAULTS.keys(), key=len, reverse=True)
    for key in keys:
        if key in category:
            return key
    return ""


def _match_era_key(era: str) -> str:
    """根据 era 字符串匹配 _ERA_PROP_DEFAULTS key。"""
    if not era:
        return ""
    for key in _ERA_PROP_DEFAULTS:
        if key in era:
            return key
    return ""


def _fill_prop_v30_defaults(prop: dict) -> dict:
    """为 prop 的 V3.0 空字段填合理默认（基于 category/era）。

    关键约束（与 _fill_character_v30_defaults 一致）：
    1. 只填空字段 — LLM 已填的字段绝不覆盖（"玄铁锻造" 不会被改成 "精钢锻造"）
    2. category 匹配不到默认表时 → 用 "tool/工具" 兜底
    3. era 时代材料底线校验：LLM 填了"塑料"但 era 是"古代"会被替换（C.5 反违禁）
    4. C.2 必填字段（name/category/plotFunction/era）必须由 extract_props 必填，
       这里只对 material/structure/craftAndWear/decoration/functionalDetail
       做 best-effort 填充。

    返回：填充后的 prop dict（in-place 修改并返回）
    """
    if not isinstance(prop, dict):
        return prop

    category = _sanitize_structured_field(prop.get("category", ""))
    era = _sanitize_structured_field(prop.get("era", ""))

    category_key = _match_category_key(category)
    if not category_key:
        category_key = "tool"  # 兜底
    cat_defaults = _PROP_CATEGORY_DEFAULTS[category_key]

    era_key = _match_era_key(era)
    era_floor = _ERA_PROP_DEFAULTS.get(era_key, {})

    # 1. material — 缺失或不符合 era 底线 → 填 category 默认
    material = _sanitize_structured_field(prop.get("material", ""))
    if not material or (
        era_key in {"古风", "古代"}
        and any(banned in material for banned in ("塑料", "LED", "电路", "电子", "芯片"))
    ):
        # C.5 违禁色检查：古代不得有塑料/LED
        material = cat_defaults.get("material", "")
    if material and era_floor.get("material_floor"):
        # era 时代有底线时，给 material 加"古代材料"前缀供 LLM 优先参考
        # 仅在 material 是空泛词（短于 6 字）时追加，避免污染长描述
        if len(material) < 6:
            material = f"{era_floor['material_floor']}（{material}）"
    prop["material"] = material

    # 2. structure — 缺失填 category 默认
    if not _sanitize_structured_field(prop.get("structure", "")):
        prop["structure"] = cat_defaults.get("structure", "")

    # 3. craftAndWear — 缺失填 category 默认
    if not _sanitize_structured_field(prop.get("craftAndWear", "")):
        prop["craftAndWear"] = cat_defaults.get("craftAndWear", "")

    # 4. decoration — 缺失填 category 默认或 era 默认
    if not _sanitize_structured_field(prop.get("decoration", "")):
        prop["decoration"] = cat_defaults.get("decoration", "") or era_floor.get("decoration_floor", "")

    # 5. functionalDetail — 缺失填 category 默认
    if not _sanitize_structured_field(prop.get("functionalDetail", "")):
        prop["functionalDetail"] = cat_defaults.get("functionalDetail", "")

    # 6. compositionType — 默认 fourView（C.3 关键道具强制）
    if not _sanitize_structured_field(prop.get("compositionType", "")):
        prop["compositionType"] = "fourView"

    return prop


# ========================
# V3.0 场景默认值填充（当 LLM 未填字段时使用）
# ========================
# 背景：与 _fill_character_v30_defaults / _fill_prop_v30_defaults 同理 —
# extract_scenes 的 LLM 输出经常是 best-effort 的（V3.0 七层字段可能全空）。
# 这些字段在 _build_scene_prompt 时被读到，缺失会导致 prompt 退化到旧字段
# 兜底（description/mood），image model 渲染出"空泛场景图"。
#
# 修复：在 _build_scene_prompt 入口前，对空字段填合理默认（基于 location/time）。
#
# 关键：只填空字段，已填字段不覆盖。

# 室内/室外 + 时代 → 场景七层默认值
_SCENE_LOCATION_TYPE_DEFAULTS: dict[str, dict[str, str]] = {
    # 室内
    "室内": {
        "worldPositioning": "室内空间，光线受控",
        "geography": "位于建筑内部，由墙体围合",
        "mainStructure": "主体形制分明，功能分区清晰",
        "extendedSpace": "延伸为相邻房间或走廊",
        "naturalAndDistant": "室内近景为主，远景为窗外",
        "lightAndColor": "主光源为顶灯或窗户自然光",
    },
    "咖啡店": {
        "worldPositioning": "都市室内咖啡店，温馨小资氛围",
        "geography": "位于街角或商场内，由玻璃幕墙围合",
        "mainStructure": "吧台为主体，配卡座与散座",
        "extendedSpace": "延伸为半透明厨房隔断与户外露台",
        "naturalAndDistant": "近景为木质桌面与杯具，远景为玻璃外街景",
        "lightAndColor": "主光源为暖色吊灯串配落地窗日光",
    },
    "办公室": {
        "worldPositioning": "现代办公空间，理性专业氛围",
        "geography": "位于写字楼内，玻璃隔断分区",
        "mainStructure": "办公桌与会议桌为主体，配储物柜",
        "extendedSpace": "延伸为走廊与茶水间",
        "naturalAndDistant": "近景为办公用品，远景为窗外城市天际线",
        "lightAndColor": "主光源为顶部日光灯配落地窗日光",
    },
    "古风室内": {
        "worldPositioning": "中国古代室内空间，榫卯木质结构",
        "geography": "位于庭院深处，由雕花木门出入",
        "mainStructure": "主体为八仙桌配太师椅，屏风隔断",
        "extendedSpace": "延伸为回廊与天井",
        "naturalAndDistant": "近景为木质地板与瓷器，远景为窗外竹影",
        "lightAndColor": "主光源为红纱灯笼配天井自然光",
    },
    # 室外
    "室外": {
        "worldPositioning": "室外开放空间，自然光为主",
        "geography": "位于城市或自然环境",
        "mainStructure": "主体建筑或地形结构",
        "extendedSpace": "延伸为道路或相邻建筑",
        "naturalAndDistant": "自然与人工环境并存",
        "lightAndColor": "主光源为自然日光",
    },
    "街道": {
        "worldPositioning": "城市街道，人车流交织",
        "geography": "位于城市道路两侧，由建筑围合",
        "mainStructure": "主体为道路与人行道，配沿街商铺",
        "extendedSpace": "延伸为十字路口与公交站",
        "naturalAndDistant": "近景为路面与行人，远景为街景纵深",
        "lightAndColor": "主光源为日光配商铺霓虹",
    },
    "山林": {
        "worldPositioning": "自然山林，远离人烟",
        "geography": "位于山脉或森林深处",
        "mainStructure": "主体为山体、林木与溪流",
        "extendedSpace": "延伸为古道或山洞",
        "naturalAndDistant": "近景为枝叶苔藓，远景为层叠山峦",
        "lightAndColor": "主光源为林间斑驳日光",
    },
    "战场": {
        "worldPositioning": "古战场或军事冲突地",
        "geography": "位于开阔地形或关隘",
        "mainStructure": "主体为战壕、城墙或阵地",
        "extendedSpace": "延伸为营帐与粮道",
        "naturalAndDistant": "近景为兵器与尘土，远景为旌旗与硝烟",
        "lightAndColor": "主光源为烽火配阴天日光",
    },
    "通用": {
        "worldPositioning": "场景空间，氛围鲜明",
        "geography": "位于特定地点，由周边环境定义",
        "mainStructure": "主体结构明确，细节丰富",
        "extendedSpace": "延伸空间与主体相连",
        "naturalAndDistant": "近景与远景层次分明",
        "lightAndColor": "主光源明确，与场景氛围匹配",
    },
}


def _match_scene_location_key(location: str, name: str) -> str:
    """根据 location/name 匹配 _SCENE_LOCATION_TYPE_DEFAULTS key。"""
    candidates = [location or "", name or ""]
    keys = sorted(_SCENE_LOCATION_TYPE_DEFAULTS.keys(), key=len, reverse=True)
    for cand in candidates:
        for key in keys:
            if key in cand:
                return key
    # 兜底：根据 "室内"/"室外" 关键字
    for cand in candidates:
        if "室内" in cand or "屋里" in cand or "房间" in cand:
            return "室内"
        if "室外" in cand or "街道" in cand or "户外" in cand:
            return "室外"
    return ""


def _fill_scene_v30_defaults(scene: dict) -> dict:
    """为 scene 的 V3.0 空字段填合理默认（基于 location/name/time）。

    关键约束：
    1. 只填空字段 — LLM 已填的字段绝不覆盖
    2. location/name 匹配不到默认表时 → 用 "室内"/"室外" 兜底
    3. 七层字段：worldPositioning / geography / mainStructure / extendedSpace /
       naturalAndDistant / lightAndColor — 全部为 best-effort
    4. techSpec / qualitySuffix / ambientCharacters — 缺失就缺失（LLM 真有上下文才填）
    """
    if not isinstance(scene, dict):
        return scene

    location = _sanitize_structured_field(scene.get("location", ""))
    name = _sanitize_structured_field(scene.get("name", "")) or _sanitize_structured_field(scene.get("title", ""))

    loc_key = _match_scene_location_key(location, name)
    if not loc_key:
        loc_key = "通用"  # 兜底：通用场景默认值
    defaults = _SCENE_LOCATION_TYPE_DEFAULTS.get(loc_key, {})

    # 七层字段填空
    layer_fields = (
        "worldPositioning",
        "geography",
        "mainStructure",
        "extendedSpace",
        "naturalAndDistant",
        "lightAndColor",
    )
    for key in layer_fields:
        if not _sanitize_structured_field(scene.get(key, "")):
            scene[key] = defaults.get(key, "")

    # techSpec / qualitySuffix / ambientCharacters — 不强填（需要 LLM 真有上下文）

    return scene


def _build_character_prompt(character: dict, style: str = "cinematic") -> str:
    # V3.0 B.5 角色提示词组织顺序（500-800字）：
    # [时代/世界观] + [身份] + [性别年龄] + [全局参考风格] + [基础面容锚点]
    # + [发式与头饰] + [服装从内到外六层] + [特殊状态]
    # + [姿态：双手自然下垂，站姿自然，面容平静]
    # + [B.4 角色概念表布局段原样嵌入]
    # + [画质技术规范：8K超精细，材质纹理清晰可触，纯白底背景]
    #
    # 关键：必须读 V3.0 结构化字段（ageRange / faceAnchor / hairSystem /
    # clothingLayers / voice / specialState），不能退回到旧的 age / appearance
    # 字段。否则 extract_characters LLM 已严格按 V3.0 输出的数据会全被丢光，
    # source_prompt 只剩 "Character portrait of <name>, age 25, 男" → optimize
    # 后的 prompt 没有五官描述 → 图与角色名对不上。
    #
    # 关键修复（best-effort 默认值填充）：
    # extract_characters 的提示词已经改写为"只输出能从脚本推导的字段"，
    # V3.0 详细字段（faceAnchor/hairSystem/clothingLayers）脚本没提就空串。
    # 这里的 _fill_character_v30_defaults 会按 era/identity 给空字段填合理默认，
    # 保证 image model 至少有 faceAnchor 8 字段可消费，不至于渲染出"长得都一样"的图。
    character = _fill_character_v30_defaults(character)
    name = _sanitize_structured_field(character.get("name", "")) or "character"
    identity = _sanitize_structured_field(character.get("identity", ""))
    age_range = _sanitize_structured_field(character.get("ageRange", ""))
    gender = _sanitize_structured_field(character.get("gender", ""))
    era = _sanitize_structured_field(character.get("era", ""))
    voice = _sanitize_structured_field(character.get("voice", ""))
    special_state = _sanitize_structured_field(character.get("specialState", ""))

    # 兼容旧字段（age/appearance/personality），新格式缺失时兜底
    legacy_age = character.get("age")
    legacy_appearance = _sanitize_structured_field(character.get("appearance", ""))
    legacy_personality = _sanitize_structured_field(character.get("personality", ""))

    face_text = _format_face_anchor(character.get("faceAnchor"))
    hair_text = _format_hair_system(character.get("hairSystem"))
    cloth_text = _format_clothing_layers(character.get("clothingLayers"))

    parts: list[str] = []
    # 头部标签：角色名 + 时代/世界观 + 身份
    if era:
        parts.append(f"Character concept art of {name}, set in {era}.")
    else:
        parts.append(f"Character concept art of {name}.")
    if identity:
        parts.append(f"Identity: {identity}.")
    # 性别年龄（V3.0 用 ageRange；旧格式 age 数字）
    age_phrase = age_range or (str(legacy_age) if legacy_age is not None else "")
    gender_age_bits = [b for b in [gender, age_phrase] if b]
    if gender_age_bits:
        parts.append("Gender/Age: " + ", ".join(gender_age_bits) + ".")

    # 基础面容锚点（V3.0 8 字段全展开）
    if face_text:
        parts.append(f"Face anchor: {face_text}.")
    # 兜底旧 appearance — V3.0 字段缺失时使用
    if not face_text and legacy_appearance:
        parts.append(f"Appearance: {legacy_appearance}.")
    # 发式系统
    if hair_text:
        parts.append(f"Hair: {hair_text}.")
    # 服装六层
    if cloth_text:
        parts.append(f"Clothing (6 layers): {cloth_text}.")
    # 特殊状态
    if special_state:
        parts.append(f"Special state: {special_state}.")
    # 声音（人设参考，画面生成通常不直接渲染，但用于风格连贯）
    if voice:
        parts.append(f"Voice: {voice}.")
    # 兜底旧 personality — V3.0 字段全空时使用
    if not face_text and not hair_text and not cloth_text and legacy_personality:
        parts.append(f"Personality: {legacy_personality}.")
    # 兼容旧 appearance — V3.0 默认已填时也保留 legacy 描述作为补充上下文
    # （防止旧字段里的"黑色短发"等具体信息在 V3.0 兜底默认后被丢光）
    if face_text and hair_text and cloth_text and legacy_appearance:
        parts.append(f"Appearance (legacy): {legacy_appearance}.")

    # 姿态（V3.0 B.5 固定）：双手自然下垂、站姿自然、面容平静
    parts.append("Pose: arms hanging naturally at sides, standing relaxed, calm expression.")

    # 角色概念表固定走 V3.0 B.4 4 区域布局
    parts.append("character identity and costume reference data only; do not add weapons, props, vehicles, or scene background")
    parts.append(style + " style, professional lighting")
    spec = get_spec_for_tool("image_character")
    if spec:
        parts.append(spec)
    return ", ".join(p for p in parts if p)


def _build_prop_prompt(prop: dict) -> str:
    # V3.0 C.4 道具提示词组织顺序（200-400字）：
    # [时代/世界观] + [道具类别] + [整体形制] + [主体材质与颜色]
    # + [工艺与年代痕迹] + [装饰纹样与文字] + [功能细节] + [特殊状态]
    # + [构图：四视图或单图] + [画质：白色/浅灰背景，柔和顶光，材质纹理清晰可触]
    #
    # 关键：必须读 V3.0 C.2 必填字段（material / structure / craftAndWear /
    # decoration / functionalDetail / size / category / compositionType）。
    # 旧字段 description 只在 LLM 漏填新字段时兜底。
    #
    # 关键修复（best-effort 默认值填充）：
    # extract_props 的提示词已经改写为"只输出能从脚本推导的字段"，
    # V3.0 必填字段（material/structure/craftAndWear）脚本没提就空串。
    # 这里的 _fill_prop_v30_defaults 会按 category（C.1 八大类）+ era 给空字段
    # 填合理默认，并做 C.5 时代违禁色检查（古代不得出现塑料/LED），
    # 保证 image model 至少有 material/structure/craftAndWear 可消费，
    # 不至于渲染出"白底一根棍子"或"古剑配 LED 灯带"的违和图。
    prop = _fill_prop_v30_defaults(prop)
    name = _sanitize_structured_field(prop.get("name", "")) or "prop"
    category = _sanitize_structured_field(prop.get("category", ""))
    era = _sanitize_structured_field(prop.get("era", ""))
    plot_function = _sanitize_structured_field(prop.get("plotFunction", ""))
    size = _sanitize_structured_field(prop.get("size", ""))
    structure = _sanitize_structured_field(prop.get("structure", ""))
    material = _sanitize_structured_field(prop.get("material", ""))
    craft_and_wear = _sanitize_structured_field(prop.get("craftAndWear", ""))
    decoration = _sanitize_structured_field(prop.get("decoration", ""))
    functional_detail = _sanitize_structured_field(prop.get("functionalDetail", ""))
    special_state = _sanitize_structured_field(prop.get("specialState", ""))
    composition_type = _sanitize_structured_field(prop.get("compositionType", ""))
    legacy_description = _sanitize_structured_field(prop.get("description", ""))

    parts: list[str] = []
    # 头部：Object + 时代 + 类别
    head_bits = [f"Object: {name}"]
    if era:
        head_bits.append(f"set in {era}")
    if category:
        head_bits.append(f"category: {category}")
    parts.append(", ".join(head_bits) + ".")
    # 剧情功能
    if plot_function:
        parts.append(f"Plot function: {plot_function}.")
    # 尺寸
    if size:
        parts.append(f"Size: {size}.")
    # 整体形制
    if structure:
        parts.append(f"Structure: {structure}.")
    # 主体材质（必须达 A.3 "可触摸" 标准）
    if material:
        parts.append(f"Material: {material}.")
    # 工艺与年代痕迹
    if craft_and_wear:
        parts.append(f"Craft and wear: {craft_and_wear}.")
    # 装饰纹样与文字
    if decoration:
        parts.append(f"Decoration: {decoration}.")
    # 功能细节
    if functional_detail:
        parts.append(f"Functional detail: {functional_detail}.")
    # 特殊状态
    if special_state:
        parts.append(f"Special state: {special_state}.")
    # 兜底旧 description
    if not (material or structure or craft_and_wear) and legacy_description:
        parts.append(f"Description: {legacy_description}.")

    # 构图（V3.0 C.3）：四视图 vs 单图，按 compositionType 决定
    if composition_type == "single" or (composition_type and "single" in composition_type.lower()):
        # 走单图模式
        parts.append(
            "prop reference single image, 45-degree elevated view or centered front, "
            "pure white or light gray background, soft top lighting, high detail, sharp focus"
        )
    else:
        # 默认四视图（C.3 关键道具强制）
        parts.append(PROP_FOUR_VIEW_LAYOUT)
    spec = get_spec_for_tool("image_prop")
    if spec:
        parts.append(spec)
    return ", ".join(p for p in parts if p)


def _build_scene_prompt(scene: dict) -> str:
    # V3.0 A.2 七层递进模板（强制遵循，每层不得跳过）：
    # 第一层 世界观定位（30-50字）
    # 第二层 地理位置（20-30字）
    # 第三层 主体建筑/场景实体细节（100-150字，6 子项）
    # 第四层 延伸空间与周边设施（80-100字，4 子项）
    # 第五层 自然与远景层次（60-80字，3 子项）
    # 第六层 光影与色彩系统（60-80字，4 子项）
    # 第七层 技术规格与风格参考（50-70字）
    # + 全局尾缀 A.1.2 画质技术尾缀
    # + A.1.1 场景适配人物（ambientCharacters）
    #
    # 关键：必须读 V3.0 七层字段（worldPositioning / geography / mainStructure /
    # extendedSpace / naturalAndDistant / lightAndColor / techSpec / qualitySuffix
    # / ambientCharacters）。旧字段 description 只在 LLM 漏填时兜底。
    #
    # 关键修复（best-effort 默认值填充）：
    # extract_scenes 的提示词已经改写为"只输出能从脚本推导的字段"，
    # V3.0 七层字段脚本没提就空串。
    # 这里的 _fill_scene_v30_defaults 会按 location/name（室内/咖啡店/办公室/
    # 古风室内/室外/街道/山林/战场）给空字段填合理默认，
    # 保证 image model 至少有七层中 6 层可消费，不至于渲染出"空泛场景图"。
    scene = _fill_scene_v30_defaults(scene)
    name = _sanitize_structured_field(scene.get("name", "")) or scene.get("title", "") or "scene"
    name = name if isinstance(name, str) else "scene"
    location = _sanitize_structured_field(scene.get("location", ""))
    time = _sanitize_structured_field(scene.get("time", "day")) or "day"
    weather = _sanitize_structured_field(scene.get("weather", ""))
    mood = _sanitize_structured_field(scene.get("mood", ""))
    description = _sanitize_structured_field(scene.get("description", ""))

    world_positioning = _sanitize_structured_field(scene.get("worldPositioning", ""))
    geography = _sanitize_structured_field(scene.get("geography", ""))
    main_structure = _sanitize_structured_field(scene.get("mainStructure", ""))
    extended_space = _sanitize_structured_field(scene.get("extendedSpace", ""))
    natural_distant = _sanitize_structured_field(scene.get("naturalAndDistant", ""))
    light_color = _sanitize_structured_field(scene.get("lightAndColor", ""))
    tech_spec = _sanitize_structured_field(scene.get("techSpec", ""))
    quality_suffix = _sanitize_structured_field(scene.get("qualitySuffix", ""))
    ambient_characters = _sanitize_structured_field(scene.get("ambientCharacters", ""))

    has_seven_layer = bool(
        world_positioning or geography or main_structure or extended_space
        or natural_distant or light_color or tech_spec
    )

    parts: list[str] = []
    # Scene header
    head_bits = [f"Scene: {name}", f"{time} time"]
    if location:
        head_bits.append(location)
    parts.append(", ".join(head_bits) + ".")

    if has_seven_layer:
        # 七层递进模板：每层都单独成句，便于 optimize_prompt 不会被压成一行乱码
        if world_positioning:
            parts.append(f"World positioning: {world_positioning}.")
        if geography:
            parts.append(f"Geography: {geography}.")
        if main_structure:
            parts.append(f"Main structure: {main_structure}.")
        if extended_space:
            parts.append(f"Extended space: {extended_space}.")
        if natural_distant:
            parts.append(f"Natural and distant layers: {natural_distant}.")
        if light_color:
            parts.append(f"Light and color: {light_color}.")
        if tech_spec:
            parts.append(f"Tech spec: {tech_spec}.")
        # A.1.1 场景人物硬约束
        # Reusable scene assets are environment anchors. Existing character
        # assets are attached later to storyboard/video generation as refs.
        # A.1.2 画质技术尾缀（V3.0 七层末尾必加）
        if quality_suffix:
            parts.append(quality_suffix)
        else:
            # 兜底
            parts.append(
                "environment-only scene reference image, no people, no characters, no foreground subjects, "
                "realistic style, cinematic quality, film-grade authentic materials, 8K ultra detail, "
                "naturalistic lighting, physically accurate shadows, tactile material textures"
            )
    else:
        # 旧字段兜底路径（场景没按 V3.0 七层输出）
        if weather:
            parts.append(f"Weather: {weather}.")
        if mood:
            parts.append(f"Mood: {mood}.")
        if description:
            parts.append(f"Description: {description}.")
        parts.append(
            "environment-only scene reference image, no people, no characters, no foreground subjects, "
            "cinematic composition, wide shot, atmospheric lighting, 8k, high detail"
        )
    spec = get_spec_for_tool("image_scene")
    if spec:
        parts.append(spec)
    return ", ".join(p for p in parts if p)


def _build_storyboard_prompt(
    shot: dict,
    scene: dict | list | None = None,
    characters: list | None = None,
    props: list | None = None,
) -> str:
    if isinstance(scene, list) and characters is None:
        characters = scene
        scene = None
    if scene is None:
        scene = shot.get("scene")
    if characters is None:
        characters = shot.get("characters") or shot.get("charactersInvolved") or []
    if props is None:
        props = shot.get("props") or shot.get("propsInvolved") or []
    scene_data = scene if isinstance(scene, dict) else {}
    char_names = ", ".join(
        str(c.get("name") if isinstance(c, dict) else c).strip()
        for c in (characters or [])
        if (c.get("name") if isinstance(c, dict) else c)
    )
    prop_names = ", ".join(
        str(p.get("name") if isinstance(p, dict) else p).strip()
        for p in (props or [])
        if (p.get("name") if isinstance(p, dict) else p)
    )
    # 关键：清洗 LLM 提供的 camera / movement / action / scene
    # 等自由文本字段。shot.action 是规划文本最常泄漏的位置。
    #
    # V1.6 7 列工业镜头卡：shotNumber / timecode / shotSize / cameraMovement /
    #                       action / content / dialogue / voice_tone / sound /
    #                       tags / vfxLevel / directionMarkers
    # CineForge 硬约束：动作驱动 + 方向标【】 + 严禁描述镜尾 + 一镜一焦点
    legacy_camera = _sanitize_structured_field(shot.get("camera", "medium shot")) or "medium shot"
    legacy_movement = _sanitize_structured_field(shot.get("movement", "static")) or "static"
    legacy_action = _sanitize_structured_field(shot.get("action", ""))

    # V1.6 字段优先，旧字段兜底
    shot_size = _sanitize_structured_field(shot.get("shotSize", "")) or legacy_camera
    camera_movement = _sanitize_structured_field(shot.get("cameraMovement", "")) or legacy_movement
    content = _sanitize_structured_field(shot.get("content", ""))
    action_text = _sanitize_structured_field(shot.get("action", "")) or legacy_action
    dialogue = _sanitize_structured_field(shot.get("dialogue", "") if isinstance(shot.get("dialogue"), str) else "")
    voice_tone = _sanitize_structured_field(shot.get("voice_tone", ""))
    sound = _sanitize_structured_field(shot.get("sound", ""))
    direction_markers = _sanitize_structured_field(shot.get("directionMarkers", ""))
    # tags 是 list[str]，需要单独处理
    tags_raw = shot.get("tags")
    if isinstance(tags_raw, list):
        tags_text = ", ".join(str(t).strip() for t in tags_raw if str(t).strip())
    else:
        tags_text = _sanitize_structured_field(tags_raw) if tags_raw else ""
    vfx_level = _sanitize_structured_field(shot.get("vfxLevel", ""))
    shot_number = shot.get("shotNumber") or shot.get("index")
    timecode = _sanitize_structured_field(shot.get("timecode", ""))

    parts: list[str] = []
    # 头部：分镜号 + timecode + duration
    header_bits: list[str] = []
    if shot_number is not None:
        header_bits.append(f"shot #{shot_number}")
    if timecode:
        header_bits.append(f"@ {timecode}")
    duration = shot.get("duration_sec")
    if duration is not None:
        header_bits.append(f"{duration}s")
    if header_bits:
        parts.append("[" + " | ".join(header_bits) + "]")
    # 动作驱动：每镜必须含"谁在做什么"
    if action_text or content:
        action_body = content or action_text
        if direction_markers and "【" not in action_body and "[" not in action_body:
            action_body = f"{action_body} {direction_markers}"
        parts.append(f"ACTION-DRIVEN: {action_body}")
    # 镜头：景别 + 运动
    cam_bits = [b for b in [shot_size, camera_movement] if b]
    if cam_bits:
        parts.append(f"CAMERA: {' / '.join(cam_bits)}")
    # 场景引用
    if shot.get("scene"):
        parts.append(f"SCENE: {shot.get('scene')}")
    elif scene_data:
        # 兼容旧路径
        scene_parts = ", ".join(
            part
            for part in [
                scene_data.get("name") or scene_data.get("title"),
                _sanitize_structured_field(scene_data.get("description", "")),
                scene_data.get("mainStructure"),
                scene_data.get("lightAndColor"),
            ]
            if part
        )
        if scene_parts:
            parts.append(f"SCENE REF: {scene_parts}")
    # 角色 + 道具
    if char_names:
        parts.append(f"FEATURING: {char_names}")
    if prop_names:
        parts.append(f"PROPS: {prop_names}")
    # 对白
    if dialogue:
        parts.append(f"DIALOGUE: {dialogue}")
    if voice_tone:
        parts.append(f"VOICE TONE: {voice_tone}")
    # 音效（V1.6 必填，环境低频 + 细节高频 + 角色声 + 特殊）
    if sound:
        parts.append(f"SOUND: {sound}")
    # CineForge 方向标【】
    if direction_markers and (content or action_text):
        # 已经在 ACTION-DRIVEN 注入过则跳过
        if "【" not in (content or action_text) and "[" not in (content or action_text):
            parts.append(f"DIRECTION MARKERS: {direction_markers}")
    # 标签（关键 / 音锚 / 海报帧 / 等）
    if tags_text:
        parts.append(f"TAGS: {tags_text}")
    # 特效等级
    if vfx_level:
        parts.append(f"VFX LEVEL: {vfx_level}")
    # 兜底：分镜草图风格声明
    parts.append(STORYBOARD_SIX_GRID_PROMPT)
    spec = get_spec_for_tool("image_storyboard")
    if spec:
        parts.append(spec)
    return ", ".join(p for p in parts if p)


# ========================
# generate_character_portrait
# ========================

class GenerateCharacterPortraitTool(BaseTool):
    """生成角色概念表（V3.0 B.4 4 区域布局：主视觉区+补充信息区+局部细节区+半身照）。"""

    name = "generate_character_portrait"
    description = (
        "生成角色概念表（4-region concept sheet）：主视觉区（正/侧/背 3 视角）+ "
        "补充信息区（面部特写+配色板）+ 局部细节区（关键部件）+ 半身照比例照。"
        "便于后续分镜一致性。"
        "【输入】character：必须填 V3.0 B.3 完整字段 — "
        "name / identity / ageRange / gender / era / faceAnchor{8 字段} / "
        "hairSystem{4 字段} / clothingLayers{6 字段} / specialState / voice"
    )
    category = "image"
    requires_approval = True
    estimated_cost_usd = 0.05
    estimated_time_sec = 25.0
    idempotent = False
    parameters = [
        ToolParameter(name="reference_asset_ids", type="array", description="project-scoped reference asset IDs", required=False),
        ToolParameter(
            name="character",
            type="object",
            description=(
                "角色 dict（V3.0 B.3 完整字段）。必填："
                "name / identity / ageRange / gender / era / "
                "faceAnchor{faceShape,eyebrow,eyeType,noseType,lipType,boneStructure,skinTone,landmarks} / "
                "hairSystem{lengthAndStyle,color,headwear,bangsDirection} / "
                "clothingLayers{inner,outer,overlay,waist,lower,feet} / "
                "specialState / voice"
            ),
            required=True,
        ),
        ToolParameter(name="style", type="string", description="风格：cinematic | anime | realistic | illustration", required=False, default="cinematic"),
        ToolParameter(name="model_id", type="string", description="可选：指定模型 id", required=False),
    ]

    async def validate(self, ctx: ToolContext, params: dict) -> str | None:
        if not isinstance(params.get("character"), dict):
            return "character 必须是 dict"
        return None

    async def execute(self, ctx: ToolContext, params: dict) -> dict:
        # 前置检查：是否已有可复用资产
        character = params.get("character") or {}
        char_name = character.get("name") if isinstance(character, dict) else None
        if char_name:
            existing = await _check_existing_assets(ctx, name=char_name, asset_kind="character")
            if existing:
                ref_ids = [a["id"] for a in existing]
                params.setdefault("reference_asset_ids", []).extend(ref_ids)
        # 从画布连线收集 asset_ref
        canvas_refs = await _collect_canvas_refs_for_ctx(ctx)
        if canvas_refs:
            params.setdefault("reference_asset_ids", []).extend(canvas_refs)
        svc = _resolve_service(ctx)
        char = params["character"]
        source_prompt = f"{_build_character_prompt(char, style=params.get('style') or 'cinematic')}. {CHARACTER_DESIGN_SHEET_PROMPT}"
        prompt, source_prompt = await optimize_generation_prompt(ctx, source_prompt, "image", {
            "asset_kind": "character",
            "character": char,
            "canonical_layout": CHARACTER_DESIGN_SHEET_PROMPT,
        })
        req = MediaRequest(
            kind="image",
            prompt=prompt,
            model_id=params.get("model_id"),
            width=1024, height=1024,
            reference_urls=_resolve_reference_urls(ctx, params),
            extra={"asset_kind": "character", "character": char.get("name")},
        )
        result = await svc.generate(req)
        return {
            "url": result.url,
            "character": char.get("name"),
            "kind": "character_portrait",
            "cost_usd": result.cost_usd,
            "elapsed_sec": result.elapsed_sec,
            "prompt": prompt,
            "source_prompt": source_prompt,
        }


# ========================
# generate_prop_image
# ========================

class GeneratePropImageTool(BaseTool):
    """生成道具图。"""

    name = "generate_prop_image"
    description = (
        "为关键道具生成产品图（白底+细节）。"
        "【输入】prop：必须填 V3.0 C.2 完整字段 — "
        "name / category / ownerCharacter / ownerScene / plotFunction / era / size / structure / "
        "material / craftAndWear / decoration / functionalDetail / specialState / compositionType"
    )
    category = "image"
    requires_approval = True
    estimated_cost_usd = 0.03
    estimated_time_sec = 15.0
    idempotent = False
    parameters = [
        ToolParameter(name="reference_asset_ids", type="array", description="project-scoped reference asset IDs", required=False),
        ToolParameter(
            name="prop",
            type="object",
            description=(
                "道具 dict（V3.0 C.2 完整字段）。必填："
                "name / category / ownerCharacter / ownerScene / plotFunction / era / size / structure / "
                "material / craftAndWear / decoration / functionalDetail / specialState / compositionType "
                "（compositionType 取值 fourView | single）"
            ),
            required=True,
        ),
        ToolParameter(name="model_id", type="string", description="可选：指定模型 id", required=False),
    ]

    async def validate(self, ctx: ToolContext, params: dict) -> str | None:
        if not isinstance(params.get("prop"), dict):
            return "prop 必须是 dict"
        return None

    async def execute(self, ctx: ToolContext, params: dict) -> dict:
        # 前置检查：是否已有可复用资产
        prop = params.get("prop") or {}
        prop_name = prop.get("name") if isinstance(prop, dict) else None
        if prop_name:
            existing = await _check_existing_assets(ctx, name=prop_name, asset_kind="prop")
            if existing:
                ref_ids = [a["id"] for a in existing]
                params.setdefault("reference_asset_ids", []).extend(ref_ids)
        # 从画布连线收集 asset_ref
        canvas_refs = await _collect_canvas_refs_for_ctx(ctx)
        if canvas_refs:
            params.setdefault("reference_asset_ids", []).extend(canvas_refs)
        svc = _resolve_service(ctx)
        prop = params["prop"]
        source_prompt = _build_prop_prompt(prop)
        prompt, source_prompt = await optimize_generation_prompt(ctx, source_prompt, "image", {
            "asset_kind": "prop",
            "prop": prop,
            # 道具四视图/单图构图已在 _build_prop_prompt 内嵌，触发 bypass 防止 LLM 改写破坏
            "canonical_layout": PROP_FOUR_VIEW_LAYOUT,
        })
        req = MediaRequest(
            kind="image",
            prompt=prompt,
            model_id=params.get("model_id"),
            width=1024, height=1024,
            reference_urls=_resolve_reference_urls(ctx, params),
            extra={"asset_kind": "prop", "prop": prop.get("name")},
        )
        result = await svc.generate(req)
        return {
            "url": result.url,
            "prop": prop.get("name"),
            "kind": "prop_image",
            "cost_usd": result.cost_usd,
            "elapsed_sec": result.elapsed_sec,
            "prompt": prompt,
            "source_prompt": source_prompt,
        }


# ========================
# generate_scene_image
# ========================

class GenerateSceneImageTool(BaseTool):
    """生成场景概念图。"""

    name = "generate_scene_image"
    description = (
        "为拍摄场景生成环境概念图（wide shot）。"
        "【输入】scene：必须填 V3.0 A.2 七层 + A.1.1 场景人物硬约束 + A.1.2 画质尾缀 — "
        "name / location / time / weather / mood / description / "
        "worldPositioning / geography / mainStructure / extendedSpace / naturalAndDistant / "
        "lightAndColor / techSpec / qualitySuffix / ambientCharacters"
    )
    category = "image"
    requires_approval = True
    estimated_cost_usd = 0.05
    estimated_time_sec = 25.0
    idempotent = False
    parameters = [
        ToolParameter(name="reference_asset_ids", type="array", description="project-scoped reference asset IDs", required=False),
        ToolParameter(
            name="scene",
            type="object",
            description=(
                "场景 dict（V3.0 A.2 七层 + A.1.1 + A.1.2）。必填："
                "name / location / time / weather / mood / description / "
                "worldPositioning / geography / mainStructure / extendedSpace / naturalAndDistant / "
                "lightAndColor / techSpec / qualitySuffix / ambientCharacters"
            ),
            required=True,
        ),
        ToolParameter(name="model_id", type="string", description="可选：指定模型 id", required=False),
    ]

    async def validate(self, ctx: ToolContext, params: dict) -> str | None:
        if not isinstance(params.get("scene"), dict):
            return "scene 必须是 dict"
        return None

    async def execute(self, ctx: ToolContext, params: dict) -> dict:
        # 前置检查：是否已有可复用资产
        scene = params.get("scene") or {}
        scene_name = scene.get("name") if isinstance(scene, dict) else None
        if scene_name:
            existing = await _check_existing_assets(ctx, name=scene_name, asset_kind="scene")
            if existing:
                ref_ids = [a["id"] for a in existing]
                params.setdefault("reference_asset_ids", []).extend(ref_ids)
        # 从画布连线收集 asset_ref
        canvas_refs = await _collect_canvas_refs_for_ctx(ctx)
        if canvas_refs:
            params.setdefault("reference_asset_ids", []).extend(canvas_refs)
        svc = _resolve_service(ctx)
        scene = params["scene"]
        source_prompt = _build_scene_prompt(scene)
        prompt, source_prompt = await optimize_generation_prompt(ctx, source_prompt, "image", {
            "asset_kind": "scene",
            "scene": scene,
            "canonical_layout": "environment-only scene reference image, no people, no characters, no foreground subjects",
        })
        req = MediaRequest(
            kind="image",
            prompt=prompt,
            model_id=params.get("model_id"),
            width=1280, height=720,  # 16:9 视频比例
            reference_urls=_resolve_reference_urls(ctx, params),
            extra={"asset_kind": "scene", "scene": scene.get("name")},
        )
        result = await svc.generate(req)
        return {
            "url": result.url,
            "scene": scene.get("name"),
            "kind": "scene_image",
            "cost_usd": result.cost_usd,
            "elapsed_sec": result.elapsed_sec,
            "prompt": prompt,
            "source_prompt": source_prompt,
        }


# ========================
# generate_storyboard_image
# ========================

class GenerateStoryboardImageTool(BaseTool):
    """生成分镜草图。"""

    name = "generate_storyboard_image"
    description = "为分镜生成六宫格故事板（2x3，继承视听签名的彩色电影感风格），用于预览构图与连续性。"
    category = "image"
    requires_approval = True
    estimated_cost_usd = 0.02
    estimated_time_sec = 12.0
    idempotent = False
    parameters = [
        ToolParameter(name="reference_asset_ids", type="array", description="project-scoped reference asset IDs", required=False),
        ToolParameter(name="shot", type="object", description="分镜 dict", required=True),
        ToolParameter(name="scene", type="object", description="可选：显式场景覆盖", required=False),
        ToolParameter(name="characters", type="array", description="可选：角色列表", required=False),
        ToolParameter(name="scene_asset_id", type="string", description="场景参考资产 ID", required=False),
        ToolParameter(name="props", type="array", description="可选：道具列表", required=False),
        ToolParameter(name="model_id", type="string", description="可选：指定模型 id", required=False),
    ]

    async def validate(self, ctx: ToolContext, params: dict) -> str | None:
        if not isinstance(params.get("shot"), dict):
            return "shot 必须是 dict"
        return None

    async def execute(self, ctx: ToolContext, params: dict) -> dict:
        # 前置检查：是否已有可复用场景资产（分镜继承场景视觉签名）
        shot = params.get("shot") or {}
        scene = params.get("scene") if "scene" in params else shot.get("scene")
        if isinstance(scene, dict):
            scene_name = scene.get("name") or scene.get("title")
        elif isinstance(scene, str):
            scene_name = scene
        else:
            scene_name = None
        if scene_name:
            existing = await _check_existing_assets(ctx, name=scene_name, asset_kind="scene")
            if existing:
                ref_ids = [a["id"] for a in existing]
                params.setdefault("reference_asset_ids", []).extend(ref_ids)
        # 从画布连线收集 asset_ref
        canvas_refs = await _collect_canvas_refs_for_ctx(ctx)
        if canvas_refs:
            params.setdefault("reference_asset_ids", []).extend(canvas_refs)
        svc = _resolve_service(ctx)
        shot = params["shot"]
        scene = params.get("scene") if "scene" in params else shot.get("scene")
        characters = params.get("characters") if "characters" in params else (
            shot.get("characters") or shot.get("charactersInvolved") or []
        )
        props = params.get("props") if "props" in params else (
            shot.get("props") or shot.get("propsInvolved") or []
        )
        source_prompt = _build_storyboard_prompt(shot, scene, characters, props)
        ref_ids = collect_storyboard_reference_asset_ids(params, ctx.artifacts)
        prompt, source_prompt = await optimize_generation_prompt(ctx, source_prompt, "image", {
            "asset_kind": "storyboard",
            "shot": shot,
            "scene": scene or {},
            "characters": characters,
            "props": props,
            "reference_asset_ids": ref_ids,
            "canonical_layout": STORYBOARD_SIX_GRID_PROMPT,
        })
        ref_urls = _resolve_reference_urls(ctx, {**params, "reference_asset_ids": ref_ids})
        req = MediaRequest(
            kind="image",
            prompt=prompt,
            model_id=params.get("model_id"),
            width=1280, height=720,
            reference_urls=ref_urls,
            extra={"asset_kind": "shot", "shot_index": shot.get("index")},
        )
        result = await svc.generate(req)
        return {
            "url": result.url,
            "shot_index": shot.get("index"),
            "kind": "storyboard_image",
            "reference_asset_ids": ref_ids,
            "reference_urls": ref_urls,
            "cost_usd": result.cost_usd,
            "elapsed_sec": result.elapsed_sec,
            "prompt": prompt,
            "source_prompt": source_prompt,
        }
