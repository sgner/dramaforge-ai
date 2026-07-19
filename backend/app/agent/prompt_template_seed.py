"""10 个内置提示词模板 — 内容来自参考项目 prompt_libraries.json。

启动时由 seed_builtin_prompt_templates() 写入 DB（幂等）。
内置模板可编辑不可删除。
"""
from __future__ import annotations
import uuid
from typing import Any

BUILTIN_PROMPT_TEMPLATES: list[dict[str, Any]] = [
    {
        "id": "builtin_md_1",
        "name": "多机位九宫格",
        "category": "character",
        "scene": "同一主体/场景，9个不同机位/角度同时呈现，用于角色多角度参考、产品展示、空间勘测",
        "positive": "A multi-camera angle reference sheet in 3x3 grid layout, showing [主体] from 9 different perspectives simultaneously: top-left front view, top-center 3/4 front view, top-right side profile, middle-left low angle, middle-center eye-level straight-on, middle-right high angle, bottom-left back view, bottom-center 3/4 back view, bottom-right top-down overhead view. [主体详细描述]. Consistent lighting across all 9 frames, uniform light warm gray background color F0EDE8, subjects softly blending with background with natural edge transition, no hard edges no white halo no light bleed, professional studio photography, clean grid layout with thin white dividers between frames, character consistency maintained across all angles, absolutely no visible numbers text labels frame counters corner marks or annotations anywhere on the image",
        "negative": "numbers, text, letters, labels, frame numbers, corner marks, annotations, captions, watermarks, signatures, logos, readable text, font, typography, grid numbers, sequence markers, page numbers, index, hard edge, glowing edge, white halo, light bleed, overexposed edge, cutout look, pasted on background, floating subject, disconnected shadow, pure white background, stark white, cold gray, bad anatomy, distorted face, extra fingers, deformed hands, inconsistent character design, lighting mismatch between frames, blurry, low quality, cropped, out of frame",
        "params": {
            "Midjourney": "`--ar 1:1 --style raw --s 50`",
            "即梦/可灵": "直接粘贴，开启「参考图」锁一致性",
            "Flux": "配合 `add_detail` LoRA，CFG 3.5-5.0",
        },
    },
    {
        "id": "builtin_md_2",
        "name": "多机位九宫格4K",
        "category": "storyboard",
        "scene": "高分辨率版本的多机位九宫格，用于印刷级输出、大屏展示、精细材质参考",
        "positive": "Ultra high resolution multi-camera angle reference sheet in 3x3 grid layout, 4K quality, showing [主体] from 9 different perspectives simultaneously: top-left front view, top-center 3/4 front view, top-right side profile, middle-left low angle, middle-center eye-level straight-on, middle-right high angle, bottom-left back view, bottom-center 3/4 back view, bottom-right top-down overhead view. [主体详细描述]. Consistent cinematic lighting across all 9 frames, uniform light warm gray background color F0EDE8, subjects softly blending with background with natural edge transition, no hard edges no white halo no light bleed, professional studio photography with medium format film aesthetic, clean grid layout with thin white dividers between frames, character consistency maintained across all angles, fine organic film grain, zero digital sharpening, absolutely no visible numbers text labels frame counters corner marks or annotations anywhere on the image",
        "negative": "numbers, text, letters, labels, frame numbers, corner marks, annotations, captions, watermarks, signatures, logos, readable text, font, typography, grid numbers, sequence markers, page numbers, index, hard edge, glowing edge, white halo, light bleed, overexposed edge, cutout look, pasted on background, floating subject, disconnected shadow, pure white background, stark white, cold gray, bad anatomy, distorted face, extra fingers, deformed hands, inconsistent character design, lighting mismatch between frames, blurry, low quality, cropped, out of frame, digital sharpening, oversharpened, plastic skin, over-smoothing",
        "params": {
            "Midjourney": "`--ar 1:1 --style raw --s 50 --q 2`",
            "即梦/可灵": "选择「高清」或「4K」模式",
            "Flux": "开启 Tiled VAE 或 hires fix",
        },
    },
    {
        "id": "builtin_md_3",
        "name": "剧情推演六宫格",
        "category": "storyboard",
        "scene": "同一事件的5个连续阶段/情绪递进，用于六宫格故事板预览、情绪弧线设计、叙事节奏测试；第1格为纯黑缓冲格",
        "positive": "Six-panel storyboard sheet in a 2x3 grid for [事件/场景], exactly six clearly separated panels. Panel 1 is a pure black buffer panel. Panels 2-6 show the same shot as a continuous sequence of frozen story frames: [阶段1描述], [阶段2描述], [阶段3描述], [阶段4描述], [阶段5描述]. Consistent character design, environment, props, camera language, lighting, color palette, visual medium, and continuity across all panels. Preserve the project's visual continuity anchor. Clean storyboard composition, subtle grid dividers, absolutely no extra panels, no single full-frame image, no UI, watermark, readable text, numbers, labels, frame counters, corner marks or annotations anywhere on the image",
        "negative": "numbers, text, letters, labels, frame numbers, corner marks, annotations, captions, watermarks, signatures, logos, readable text, font, typography, grid numbers, sequence markers, page numbers, index, hard edge, glowing edge, white halo, light bleed, overexposed edge, cutout look, pasted on background, floating subject, disconnected shadow, pure white background, stark white, cold gray, bad anatomy, distorted face, extra fingers, deformed hands, inconsistent character design, lighting mismatch between frames, discontinuous action, jump cut feel, blurry, low quality, cropped, out of frame",
        "params": {
            "Midjourney": "`--ar 1:1 --style raw --s 75`",
            "即梦/可灵": "直接粘贴，建议分镜时先写情绪词再填场景",
            "Flux": "配合 `film grain` LoRA 增强故事板质感",
        },
    },
    {
        "id": "builtin_md_4",
        "name": "角色脸部三视图（V3.0 B.4 补充信息区抽出版本）",
        "category": "character",
        "scene": "角色面部正面/侧面/四分之三侧面的设定参考 — B.4 角色概念表「补充信息区」单独抽出版本，用于Actor ID锁定、表情一致性控制",
        "positive": "Character face reference sheet, three views side by side in single row: left panel front view straight-on, center panel 3/4 angle view, right panel side profile view. [角色面部详细描述]. Consistent lighting from 45-degree top-side across all three views, light warm gray background color F0EDE8, subjects softly blending with background with natural edge transition, no hard edges no white halo no light bleed, neutral clean backdrop, professional character design sheet, clean linework, subtle skin texture, identical facial features maintained across all angles, absolutely no visible numbers text labels frame counters corner marks or annotations anywhere on the image",
        "negative": "numbers, text, letters, labels, frame numbers, corner marks, annotations, captions, watermarks, signatures, logos, readable text, font, typography, grid numbers, sequence markers, page numbers, index, hard edge, glowing edge, white halo, light bleed, overexposed edge, cutout look, pasted on background, floating subject, disconnected shadow, pure white background, stark white, cold gray, bad anatomy, distorted face, asymmetrical eyes, crossed eyes, extra fingers, deformed hands, inconsistent facial features between panels, lighting mismatch, blurry, low quality, cropped, out of frame",
        "params": {
            "Midjourney": "`--ar 16:9 --style raw --s 50`",
            "即梦/可灵": "上传参考图锁定Actor ID后使用",
            "Flux": "开启面部修复 + 一致性采样器",
        },
    },
    {
        "id": "builtin_md_5",
        "name": "产品四视图（V3.0 C.3 标准）",
        "category": "product",
        "scene": "产品设计的正面/背面/侧面/细节四视图，严格遵循 V3.0 C.3 道具四视图布局（默认关键道具），用于工业设计、电商详情、技术文档",
        "positive": "Product design reference sheet, V3.0 C.3 four-view composition: top-left full front view, top-right full back view, bottom-left side view (showing thickness and layering), bottom-right detail close-up (showing engravings, inscriptions, mechanisms, wear marks). [产品详细描述]. Light warm gray background color F0EDE8, products softly blending with background with natural edge transition, no hard edges no white halo no light bleed, studio lighting with soft top light, technical drawing aesthetic, precise proportions, material texture visible, no perspective distortion, professional product photography, 8K ultra high detail, cinema-grade still life, absolutely no visible numbers text labels frame counters corner marks or annotations anywhere on the image",
        "negative": "numbers, text, letters, labels, frame numbers, corner marks, annotations, captions, watermarks, signatures, logos, readable text, font, typography, grid numbers, sequence markers, page numbers, index, hard edge, glowing edge, white halo, light bleed, overexposed edge, cutout look, pasted on background, floating subject, disconnected shadow, pure white background, stark white, cold gray, distorted proportions, perspective distortion, blurry, low quality, cropped, out of frame, cluttered background, random objects, inconsistent material texture between views",
        "params": {
            "Midjourney": "`--ar 16:9 --style raw --s 50`",
            "即梦/可灵": "浅暖灰背景建议加 `--no gradient background`",
            "Flux": "配合 `product photography` LoRA",
        },
    },
    {
        "id": "builtin_md_6",
        "name": "25宫格连贯分镜",
        "category": "storyboard",
        "scene": "完整场景/动作的25帧连续分镜，5×5网格承载9个叙事节拍，用于电影分镜预览、动作连贯性测试、Seedance分段参考",
        "positive": "A 5x5 cinematic storyboard grid, 25 sequential frames showing continuous narrative flow of [主体/场景/动作], naturally divided into 9 story beats progressing through beginning, development, escalation, twist, climax, and resolution. Scene transitions conveyed purely through visual continuity and character motion, absolutely no visible numbers, text, labels, frame counters, corner marks, or annotations anywhere on the image. Consistent character and environment across all 25 frames, smooth motion continuity between adjacent frames, uniform cinematic lighting and color palette, light warm gray background color F0EDE8, subjects softly blending with background with natural edge transition, no hard edges no white halo no light bleed, varied shot progression from wide to close-up, professional film storyboard aesthetic, subtle film grain, clean thin white grid dividers",
        "negative": "numbers, text, letters, labels, frame numbers, corner marks, annotations, captions, watermarks, signatures, logos, readable text, font, typography, grid numbers, sequence markers, page numbers, index, hard edge, glowing edge, white halo, light bleed, overexposed edge, cutout look, pasted on background, floating subject, disconnected shadow, pure white background, stark white, cold gray, bad anatomy, distorted face, extra fingers, deformed hands, inconsistent character design, lighting mismatch between frames, discontinuous action, jump cut feel, blurry, low quality, cropped, out of frame, different hairstyle between frames, different clothing between frames",
        "params": {
            "Midjourney": "`--ar 1:1 --style raw --s 75 --q 2`",
            "即梦/可灵": "建议先测试单格效果再生成25格，分段生成更可控",
            "Flux": "开启 `Batch count: 1`，CFG 4.0，配合 `storyboard` LoRA",
        },
    },
    {
        "id": "builtin_md_7",
        "name": "电影级光影校正",
        "category": "lighting",
        "scene": "同一场景在不同光影条件下的对比展示，用于灯光方案测试、色调选择、情绪对照",
        "positive": "Cinematic lighting comparison sheet, 6 panels showing the same [主体/场景] under different lighting conditions: top-left golden hour warm backlight, top-center overcast soft diffused light, top-right neon night city light, bottom-left harsh midday direct sun, bottom-center Rembrandt 45-degree side light with triangle shadow, bottom-right dramatic low-key chiaroscuro. Consistent composition and subject across all panels, only lighting changes, light warm gray background color F0EDE8, subjects softly blending with background with natural edge transition, no hard edges no white halo no light bleed, professional cinematography reference, absolutely no visible numbers text labels frame counters corner marks or annotations anywhere on the image",
        "negative": "numbers, text, letters, labels, frame numbers, corner marks, annotations, captions, watermarks, signatures, logos, readable text, font, typography, grid numbers, sequence markers, page numbers, index, hard edge, glowing edge, white halo, light bleed, overexposed edge, cutout look, pasted on background, floating subject, disconnected shadow, pure white background, stark white, cold gray, inconsistent subject between panels, different pose between panels, different costume between panels, cluttered background, blurry, low quality, cropped, out of frame",
        "params": {
            "Midjourney": "`--ar 3:2 --style raw --s 50`",
            "即梦/可灵": "适合作为「Talk to Edit」的光影参考基底图",
            "Flux": "配合 `cinematic lighting` LoRA",
        },
    },
    {
        "id": "builtin_md_8",
        "name": "角色概念表（V3.0 B.4 4 区域布局）",
        "category": "character",
        "scene": "角色一致性设定参考 — 严格遵循 V3.0 B.4 角色概念表 4 区域布局：主视觉区（正/侧/背 3 视角）+ 补充信息区（面部特写+配色板）+ 局部细节区（关键部件）+ 半身照比例照。用于Actor ID锁定、服装一致性控制、Seedance Canvas故事板",
        "positive": "Character reference sheet, left-right split layout: left one-third area is chest-up close-up front view portrait (shoulder-up framing, extreme facial detail clarity, gentle natural expression, bright eyes looking straight at camera, realistic skin texture with visible pores and subtle imperfections, refined classical makeup); right two-thirds area is three full-body views in horizontal row, from left to right: full-body front standing pose (arms hanging naturally, feet together, complete front costume and body proportions), full-body side profile view (weight slightly shifted, waist-hip curve and silhouette visible, complete side costume and footwear), full-body back view (complete back neckline, hairstyle from behind, back costume details). Consistent front-top-side lighting across all panels, soft diffused light quality, light warm gray background color F0EDE8, subjects softly blending with background with natural edge transition, no hard edges no white halo no light bleed, identical character design, costume, hairstyle and accessories across all panels, professional character design sheet style, clean edges, accurate proportions, material texture visible from all angles, absolutely no visible numbers, text, labels, frame counters, corner marks or annotations anywhere on the image",
        "negative": "numbers, text, letters, labels, frame numbers, corner marks, annotations, captions, watermarks, signatures, logos, readable text, font, typography, grid numbers, sequence markers, page numbers, index, hard edge, glowing edge, white halo, light bleed, overexposed edge, cutout look, pasted on background, floating subject, disconnected shadow, pure white background, stark white, cold gray, dividing line labels, panel markers, bad anatomy, distorted face, extra fingers, deformed hands, inconsistent character design, lighting mismatch between frames, different hairstyle between panels, different clothing between panels, blurry, low quality, cropped, out of frame, asymmetrical eyes, crossed eyes, plastic skin, over-smoothing, textureless skin, uniform skin tone, digital sharpening, filter look, CG look, retouched, airbrushed, multiple heads, mutated limbs, floating limbs, disconnected limbs, uneven panel sizes, broken layout",
        "params": {
            "Midjourney": "`--ar 16:9 --style raw --s 50 --q 2`",
            "即梦/可灵": "上传此图作为Actor ID参考，Canvas锁脸首选",
            "Flux": "开启面部一致性 + 服装一致性双重采样",
        },
    },
    {
        "id": "builtin_md_9",
        "name": "6种基础表情胸像（2×3六宫格）",
        "category": "character",
        "scene": "同一角色六种基础表情同时呈现，用于表情一致性控制、情绪基准设定、Seedance Talk to Edit表情参考",
        "positive": "Character expression reference sheet in 2x3 grid layout, six basic expressions of the same character: top row from left to right: calm neutral expression (relaxed face, eyes looking straight ahead, lips naturally closed), gentle smile (corners of mouth slightly raised, eyes with smile lines, warm and approachable), joyful laugh (eyebrows and eyes curved upward, mouth open showing teeth, exuberant happiness); bottom row from left to right: sad tearful expression (slight furrow between brows, downturned outer eye corners, tears welling in eyes about to fall), angry stern expression (brows tightly locked, sharp piercing eyes with pressure, jaw slightly set), surprised astonished expression (eyes wide open, eyebrows raised high, mouth slightly open in O shape). All six expressions are chest-up close-up portraits of the same character, shoulder-up framing, extreme facial detail clarity, realistic skin texture preserved, no additional light source, light warm gray background color F0EDE8, subjects softly blending with background with natural edge transition, no hard edges no white halo no light bleed, identical character styling, hairstyle, makeup and accessories across all six panels, only facial expression changes, professional character expression sheet style, clean edges, absolutely no visible numbers, text, labels, frame counters, corner marks or annotations anywhere on the image",
        "negative": "numbers, text, letters, labels, frame numbers, corner marks, annotations, captions, watermarks, signatures, logos, readable text, font, typography, grid numbers, sequence markers, page numbers, index, expression name labels, emotion text, hard edge, glowing edge, white halo, light bleed, overexposed edge, cutout look, pasted on background, floating subject, disconnected shadow, pure white background, stark white, cold gray, bad anatomy, distorted face, extra fingers, deformed hands, inconsistent character design, different hairstyle between panels, different clothing between panels, lighting mismatch between panels, blurry, low quality, cropped, out of frame, asymmetrical eyes, crossed eyes, plastic skin, over-smoothing, textureless skin, uniform skin tone, digital sharpening, filter look, CG look, retouched, airbrushed, multiple heads, mutated limbs, floating limbs, disconnected limbs, uneven panel sizes, broken layout, extra rows, extra columns, missing panel, shadows on face, directional light, dramatic lighting, colored light",
        "params": {
            "Midjourney": "`--ar 3:2 --style raw --s 50`",
            "即梦/可灵": "直接粘贴，建议开启「参考图」锁角色一致性",
            "Flux": "配合 `add_detail` + 面部一致性采样器",
        },
    },
    {
        "id": "builtin_md_10",
        "name": "360全景图",
        "category": "view",
        "scene": "用于生成360全景、VR全景、可左右循环拼接的空间视角图，适合室内空间、展厅、场景漫游、环境概念设计；封闭场景需要具备合理出入口。",
        "positive": "生成一个720度的全景VR图，左右边缘100%像素级无缝衔接，可无限循环拼接；上下极点(南北极)自然过渡，无明显断层或拉伸，场景一致性，以及场景的逻辑性，封闭场景需要有门",
        "negative": "seam, visible seam, hard seam, broken panorama, discontinuous edge, mismatched left and right edges, distorted poles, stretched ceiling, stretched floor, warped horizon, inconsistent scene logic, impossible space, no exit in closed room, text, letters, labels, watermark, logo, blurry, low quality",
        "params": {},
    },
]


def seed_builtin_prompt_templates(db) -> None:
    """Idempotent seeding: insert missing builtin templates, do not touch existing ones.

    Called on app startup. If all 10 builtins exist, does nothing.
    If some are missing (e.g. new version added templates), inserts only the missing ones.
    Does NOT overwrite user edits to builtin templates.
    """
    from ..models import PromptTemplate

    existing_ids = {
        row.id for row in db.query(PromptTemplate).filter(PromptTemplate.is_builtin == True).all()
    }
    missing = [t for t in BUILTIN_PROMPT_TEMPLATES if t["id"] not in existing_ids]
    for tmpl in missing:
        db.add(PromptTemplate(
            id=tmpl["id"],
            name=tmpl["name"],
            category=tmpl["category"],
            scene=tmpl["scene"],
            positive=tmpl["positive"],
            negative=tmpl["negative"],
            params=tmpl.get("params", {}),
            is_builtin=True,
        ))
    if missing:
        db.commit()
