"""视频生成工具：generate_video。

视频 prompt 严格遵循【视频提示词模板】CineForge v1.22 硬约束：
- 动作驱动（action-driven），每镜必须含"谁在做什么"，禁止静态位置
- 方向标 [brackets] 必标 4 类（入画+运动方向 / 镜头自身运动 / Z-Y 轴 / 多元素区分）
- 严禁描述镜尾（no static ending positions like "停在/位于/悬于"）
- 入画动作优先（"从画面X侧入画" not "位于画面X"）
- 一镜一焦点（do not stack protagonist + secondary + lighting + background）
- 群像多样化（group shots need "长相不同, 穿着不同"）
- 多角色空间锚定（[角色] 在距离 [中心角色] X 米外的 [画面方向]）
- 方向词必须加 "画面" 前缀
- 音效层 3-4 层（环境低频 + 细节高频 + 角色声 + 特殊）
"""
from __future__ import annotations

from ..media_service import MediaRequest, MediaService, get_default_media_service
from ..asset_references import resolve_asset_references
from ..prompt_engineering import optimize_generation_prompt, resolve_reference_ids_by_text, sanitize_structured_field
from .base import BaseTool, ToolContext, ToolParameter


def _resolve_service(ctx: ToolContext) -> MediaService:
    return ctx.media_service or get_default_media_service()


def _shot_reference_text(shot: dict) -> str:
    """把 shot 的场景/角色/道具/动作拼成文本，供按名解析参考资产。"""
    parts: list[str] = []
    for key in ("scene", "action", "content"):
        value = shot.get(key)
        if isinstance(value, str):
            parts.append(value)
    for key in ("characters", "charactersInvolved", "props", "propsInvolved"):
        for item in shot.get(key) or []:
            parts.append(str(item.get("name") if isinstance(item, dict) else item))
    return "\n".join(p for p in parts if p)


def _resolve_reference_urls(ctx: ToolContext, params: dict) -> list[str]:
    asset_ids = list(params.get("reference_asset_ids") or [])
    explicit_urls = list(params.get("reference_urls") or [])
    if not asset_ids:
        return explicit_urls
    if not ctx.db or not ctx.project_id:
        raise ValueError("reference_asset_ids require a project-scoped database context")
    resolved = [item["url"] for item in resolve_asset_references(ctx.db, ctx.project_id, asset_ids, media_kind="video")]
    # 画布连线自动注入 reference_asset_ids 后，显式 reference_urls 不能被丢弃
    return resolved + [u for u in explicit_urls if u not in resolved]


def _build_video_prompt(shot: dict, references: list[dict] | None = None) -> str:
    """构建单镜视频 prompt，遵循 CineForge v1.22 硬约束。"""
    ref_names = ", ".join(
        str(item.get("name") or item.get("title") or item.get("asset_kind") or "").strip()
        for item in (references or [])
        if isinstance(item, dict) and (item.get("name") or item.get("title") or item.get("asset_kind"))
    )
    # 关键：清洗 LLM 提供的 camera / movement / action 等自由文本字段。
    # 视频生成同样存在 LLM 把规划文本（"最终输出应该..."）塞进 shot.action
    # 的风险，需要在源头拒绝，否则会被提示词优化回写进 asset.prompt。
    #
    # V1.6 7 列工业镜头卡：shotNumber / timecode / shotSize / cameraMovement /
    #                       action / content / dialogue / voice_tone / sound /
    #                       tags / vfxLevel / directionMarkers
    legacy_camera = sanitize_structured_field(shot.get("camera", "")) or "medium shot"
    legacy_movement = sanitize_structured_field(shot.get("movement", "")) or "static"

    # V1.6 字段优先，旧字段兜底
    shot_size = sanitize_structured_field(shot.get("shotSize", "")) or legacy_camera
    camera_movement = sanitize_structured_field(shot.get("cameraMovement", "")) or legacy_movement
    action = sanitize_structured_field(shot.get("action", ""))
    content = sanitize_structured_field(shot.get("content", ""))
    if not action and content:
        action = content
    dialogue = sanitize_structured_field(shot.get("dialogue", "") if isinstance(shot.get("dialogue"), str) else "")
    voice_tone = sanitize_structured_field(shot.get("voice_tone", ""))
    sound = sanitize_structured_field(shot.get("sound", ""))
    direction_markers = sanitize_structured_field(shot.get("directionMarkers", ""))
    vfx_level = sanitize_structured_field(shot.get("vfxLevel", ""))
    shot_number = shot.get("shotNumber") or shot.get("index")
    timecode = sanitize_structured_field(shot.get("timecode", ""))

    # CineForge v1.22: 单镜必须遵循"动作驱动 + 入画动作 + 方向标 + 音效层"
    # 用 ENBU-ish 结构化骨架（动作/镜头/主体/场景/光/音/对白）。
    # 镜头描述 = {景别+角度+运动} + {画面描述含 [运动方向]}
    # 音效结构 = 环境低频 + 细节高频 + 角色声 + 特殊
    parts: list[str] = []
    # 头部：shot #N @ timecode
    header_bits: list[str] = []
    if shot_number is not None:
        header_bits.append(f"shot #{shot_number}")
    if timecode:
        header_bits.append(f"@ {timecode}")
    if header_bits:
        parts.append("[" + " | ".join(header_bits) + "]")
    # 动作驱动（必须含 [from screen X] / [toward camera] 这类方向标）
    if action:
        action_body = action
        # 如果 action 里没有方向标但 shot.directionMarkers 单独存了，补上
        if direction_markers and "【" not in action_body and "[" not in action_body:
            action_body = f"{action_body} {direction_markers}"
        parts.append(f"[#1] ACTION-DRIVEN SHOT: {action_body}")
    # 镜头（景别 + 运动）
    cam_text = ", ".join(b for b in [shot_size, camera_movement] if b)
    if cam_text:
        parts.append(f"CAMERA: {cam_text}")
    if shot.get("scene"):
        parts.append(f"SCENE: {shot.get('scene')}")

    # 视觉风格（来自 Visual Signature 继承 — 通过 reference asset 注入，
    # 此处给一个通用兜底）
    parts.append("LIGHTING: cinematic key light + soft fill, naturalistic")
    parts.append("TONE: film color grade, depth and atmosphere")
    parts.append("TECH: cinematic 24fps, high detail")

    # 音效层（3-4 层：环境低频 + 细节高频 + 角色声 + 特殊）
    sound_bits: list[str] = []
    if shot.get("ambient") or shot.get("ambientSound"):
        sound_bits.append(f"ambient: {shot.get('ambient') or shot.get('ambientSound')}")
    if shot.get("sfx"):
        sound_bits.append(f"sfx: {shot.get('sfx')}")
    if sound and not (shot.get("ambient") or shot.get("ambientSound") or shot.get("sfx")):
        # V1.6 整体 sound 字段兜底
        sound_bits.append(sound)
    if voice_tone:
        sound_bits.append(f"voice tone: {voice_tone}")
    elif dialogue:
        sound_bits.append(f"voice: {dialogue}")
    if sound_bits:
        parts.append(f"AUDIO: {' + '.join(sound_bits)}")

    # VFX 等级
    if vfx_level:
        parts.append(f"VFX LEVEL: {vfx_level}")

    # 强制声明（CineForge 固定文案）
    parts.append(
        "HARD CONSTRAINTS: action-driven shot (NOT static position); "
        "use entry actions ([from screen left/right/top/bottom entering], [toward camera]) not static positions; "
        "do NOT describe shot ending (no 'stops at' / 'positioned at' / 'rests on'); "
        "one shot one focus; direction words MUST have 'on screen' / 'in frame' prefix for clarity"
    )
    # 显式补一行 direction markers（如果 action 里没塞下）
    if direction_markers and action and "【" not in action and "[" not in action:
        parts.append(f"DIRECTION MARKERS: {direction_markers}")

    continuity = shot.get("continuity") or {}
    if isinstance(continuity, dict):
        continuity_bits = [
            sanitize_structured_field(continuity.get("scene")) if isinstance(continuity.get("scene"), str) else continuity.get("scene"),
            continuity.get("characters"),
            continuity.get("props"),
            sanitize_structured_field(continuity.get("camera")) if isinstance(continuity.get("camera"), str) else continuity.get("camera"),
        ]
        continuity_text = ", ".join(str(bit).strip() for bit in continuity_bits if bit)
        if continuity_text:
            parts.append(f"CONTINUITY: {continuity_text}")
    if ref_names:
        parts.append(f"REFERENCES: {ref_names}")
    return "; ".join(p for p in parts if p)


class GenerateVideoTool(BaseTool):
    """基于分镜生成视频片段。"""

    name = "generate_video"
    description = "基于分镜 dict 生成视频片段。首帧可用 reference_urls 提供（角色/场景参考图）。"
    category = "video"
    requires_approval = True
    estimated_cost_usd = 0.5
    estimated_time_sec = 60.0
    idempotent = False
    parameters = [
        ToolParameter(name="reference_asset_ids", type="array", description="project-scoped reference asset IDs", required=False),
        ToolParameter(name="shot", type="object", description="分镜 dict（含 scene/action/duration_sec/dialogue 等）", required=True),
        ToolParameter(name="reference_urls", type="array", description="可选：参考图 URL 列表（角色/场景首帧）", required=False),
        ToolParameter(name="model_id", type="string", description="可选：指定视频模型 id", required=False),
    ]

    async def validate(self, ctx: ToolContext, params: dict) -> str | None:
        if not isinstance(params.get("shot"), dict):
            return "shot 必须是 dict"
        return None

    async def execute(self, ctx: ToolContext, params: dict) -> dict:
        # 从画布连线收集 asset_ref（与 image 工具一致：用户在画布上连到
        # 生成节点的资产即视为参考资产）
        if ctx.db and ctx.project_id:
            from .asset_registry_helpers import collect_canvas_references
            canvas_refs = collect_canvas_references(ctx.db, ctx.project_id)
            if canvas_refs:
                params.setdefault("reference_asset_ids", []).extend(canvas_refs)
        # 继承分镜引用：按 shot 文本（场景/角色/道具/动作）解析项目已生成的
        # 场景/角色/道具资产，使视频与对应分镜共用同一批参考资产。
        if ctx.artifacts:
            inherited = resolve_reference_ids_by_text(
                ctx.artifacts, _shot_reference_text(params.get("shot") or {}),
            )
            if inherited:
                params.setdefault("reference_asset_ids", []).extend(inherited)
        svc = _resolve_service(ctx)
        shot = params["shot"]
        ref_ids = list(params.get("reference_asset_ids") or [])
        ref_payloads = [{"name": shot.get("scene") or "", "asset_kind": "scene"}]
        source_prompt = _build_video_prompt(shot, ref_payloads)
        prompt, source_prompt = await optimize_generation_prompt(ctx, source_prompt, "video", {
            "asset_kind": "shot_video",
            "shot": shot,
            "reference_asset_ids": ref_ids,
            "continuity": {
                "scene": shot.get("scene"),
                "characters": shot.get("characters") or shot.get("charactersInvolved") or [],
                "props": shot.get("props") or [],
                "camera": shot.get("camera"),
                "movement": shot.get("movement"),
            },
        })
        req = MediaRequest(
            kind="video",
            prompt=prompt,
            model_id=params.get("model_id"),
            duration_sec=float(shot.get("duration_sec", 5)),
            reference_urls=_resolve_reference_urls(ctx, params),
            extra={
                "asset_kind": "shot_video",
                "shot_index": shot.get("index"),
                "continuity": {
                    "scene": shot.get("scene"),
                    "characters": shot.get("characters") or shot.get("charactersInvolved") or [],
                    "props": shot.get("props") or [],
                    "camera": shot.get("camera"),
                    "movement": shot.get("movement"),
                },
            },
        )
        result = await svc.generate(req)
        return {
            "url": result.url,
            "shot_index": shot.get("index"),
            "duration_sec": req.duration_sec,
            "kind": "shot_video",
            "reference_asset_ids": ref_ids,
            "cost_usd": result.cost_usd,
            "elapsed_sec": result.elapsed_sec,
            "prompt": prompt,
            "source_prompt": source_prompt,
            "continuity": req.extra.get("continuity"),
            # 上游无视频端点的 dev fallback 占位结果必须显式透出，
            # runtime 会据此把资产标为 warning/failed 而不是 ready。
            "dev_fallback": bool((result.raw or {}).get("dev_fallback")),
        }
