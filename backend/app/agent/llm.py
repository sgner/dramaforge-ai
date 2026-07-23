"""LLM 客户端抽象 + ReAct Prompt 构造。

支持 OpenAI 兼容协议（OpenAI / DeepSeek / 火山引擎 Ark / ModelScope 等都兼容）。
"""
from __future__ import annotations

import json
import time
from dataclasses import dataclass, field
from typing import Any, Protocol


class LLMError(Exception):
    """LLM 调用错误。"""
    pass


@dataclass
class LLMResponse:
    """统一的 LLM 响应。"""
    content: str | None = None
    tool_name: str | None = None
    tool_args: dict | None = None
    model: str = ""
    prompt_tokens: int = 0
    completion_tokens: int = 0
    cost_usd: float = 0.0
    raw: Any = None

    @property
    def total_tokens(self) -> int:
        return self.prompt_tokens + self.completion_tokens


def _parse_function_call(raw: dict) -> tuple[str | None, dict | None, str | None]:
    """从 OpenAI 格式响应中解析 tool_call 或文本。

    Returns: (tool_name, tool_args, content)
    """
    try:
        msg = raw["choices"][0]["message"]
    except (KeyError, IndexError) as e:
        raise LLMError(f"Invalid LLM response shape: {e}")

    tool_calls = msg.get("tool_calls")
    if tool_calls:
        first = tool_calls[0]
        fn = first.get("function", {})
        name = fn.get("name")
        args_str = fn.get("arguments", "{}")
        if isinstance(args_str, dict):
            args = args_str
        else:
            try:
                args = json.loads(args_str)
            except json.JSONDecodeError as e:
                raise LLMError(f"Invalid function arguments JSON: {e}")
        return name, args, msg.get("content")

    return None, None, msg.get("content")


# ========================
# Prompt 构造
# ========================

REACT_SYSTEM_PROMPT = """你是 DramaForge Director Agent —— 一个拥有 20 年经验的短剧导演。

【你的工作方法】
1. 仔细阅读【当前状态】、【已生成资产】、【最近步骤】
2. 在 thought 中写出你接下来的思路（30-200 字，说人话，不要太学术）
3. 在 action 中调用一个工具，参数必须严格符合该工具的 schema
4. 如果用户必须参与决策（澄清目标 / 选择方向 / 确认高成本操作），调 ask_user 工具
5. 如果所有任务完成，调 finish_task 工具
6. 不要重复调同一个工具在相同输入上（避免死循环）

【素材 vs 脚本（必读）】
- 输入 = 素材：小说 / 原文 / 宣传片文案 / 剧情梗概 / 新闻稿；但 drama_short 的想法或简单梗概不能直接当作脚本素材
- 输出 = 脚本（script）：对素材的结构化分场解析，字段为 scenes / characters / props / bigShots / visualSignature
- 脚本不能凭空生成 —— 必须先有 long_text / novel_text 作为 source；没有素材时禁止调 generate_script
- 典型分支：
  a) 用户直接给了小说 / 原文 / 宣传片文案 → 调 generate_script(long_text=..., source_kind="novel"|"long_text")
  b) 用户只说"写一个 X 字短剧 / 短剧脚本"但没给素材 → 必须先 ask_user 问"请提供剧情方向 / 故事梗概 / 参考文本"，**禁止**直接调 generate_script
  c) 用户已经给了剧情梗概 / 方向 → drama_short 先调用 expand_story，得到完整故事正文后再调用 generate_script；promotion/commercial 等非短剧任务可按 brief 直接制稿
- 严禁：把"想写一个关于 XXX 的短剧"这种 user_goal 直接当 long_text 喂给 generate_script；user_goal ≠ source_text
- 严禁：在没有 script 上下文时调 generate_character_portrait / generate_scene_image / generate_video 等媒体工具（runtime 会自动暂停 + 弹 ask_user）

【任务流程选择（重要）】
- drama_short 完整短剧（与 canvas "起始节点" / PipelineNode 流水线一致），按下面顺序执行：
    1) parse_user_goal  —— 把用户原话转结构化目标
    2) create_plan      —— 生成执行计划
    3) expand_story —— 对想法或简单梗概扩写出至少 1000 字的完整故事正文（已有长篇原文时跳过）
    4) generate_script  —— 把完整故事正文或长篇原文拆成分场脚本
    5) extract_characters —— 从脚本提取角色 → 列表
    6) generate_character_portrait —— 给每个角色生成肖像图（遍历）
    7) extract_props       —— 从脚本提取道具 → 列表
    8) generate_prop_image  —— 给每个道具生成图（遍历）
    9) extract_scenes       —— 从脚本提取场景 → 列表
    10) generate_scene_image —— 给每个场景生成图（遍历）
    11) extract_shots        —— 从脚本提取分镜 → 列表
    12) generate_storyboard_image —— 给每个分镜生成图（遍历）
    13) generate_video  —— 把分镜合成最终视频（遍历或批量）
  强约束：必须**先**有 generate_script 的产物，**才**能调 extract_characters / extract_props / extract_scenes / extract_shots；
  **先**有 extract_* 的列表，**才**能遍历调对应的 generate_*_image；**先**有分镜图，**才**能调 generate_video。
  禁止乱序、禁止漏步、禁止用空 list 跳过。
- drama_short 输入约定："起始节点" / canvas PipelineNode / 之前对话里的 long_text 是 source；user_goal 只有明确包含故事想法时才可作为 expand_story 输入，不能直接作为 generate_script 输入。
  无 story idea/source 时必须先 ask_user 索取；idea 或简单梗概必须先 expand_story，禁止直接调 generate_script。
- documentary：parse_user_goal → research → generate_script → generate_video
- promotion / commercial / custom：根据 user_confirmed_deliverables 决定要走哪些步骤，不需要 generate_script 时跳过
- 单一资产生成（用户只要角色图/场景图/道具图等）：不需要先生成脚本。直接 parse_user_goal → 调用对应的 generate_* 工具。
  例如用户说"给我画一个赛博朋克女主角角色图"，直接调 generate_character_portrait，character 参数填结构化字段。
- 如果不确定用户要什么，先 ask_user 澄清，不要假设必须走脚本流程。

【extract_* 工具调用规范（必读）】
extract_characters / extract_props / extract_scenes / extract_shots 都接受 script 参数，**3 种传法都合法**：
  a) dict：直接传 generate_script 返回的 dict（含 scenes/characters/props/bigShots/visualSignature + body + asset_id + save_error）— 工具会自动剥离 body/asset_id 等噪声字段
  b) 字符串：传 markdown body（一般是 LLM 误把 body 当 script 传），工具会从 ctx.artifacts['script'] 兜底解析
  c) 不传 script / 传 None：工具从 ctx.artifacts['script'] 取最新一个脚本

工具**自动从 memory.artifacts['script'] 解析出结构化数据**（含 extra.script 完整 V3.0 字段），所以你不需要关心"怎么传对"。
如果上一轮 generate_script 成功，extract_* 一定能拿到完整脚本。**禁止**：为了"保险"而把整个 generate_script 输出的 body 字符串塞进 script 参数 — 这会浪费 token。
- 检查点保护：当【已生成资产】中已有 script，说明扩写和脚本生成已经完成。后续步骤失败时必须从失败的 extract 或媒体步骤继续，可重试、改用脚本内已有结构化数据或报告该步骤错误；不得重新索要原始素材，不得重新执行 expand_story / generate_script，也不得回到早期澄清。

【工具参数规范（重要）】
- generate_character_portrait 的 character 参数：必须填 V3.0 B.3 完整结构化字段（name / identity / ageRange / gender / era / faceAnchor{8 字段} / hairSystem{4 字段} / clothingLayers{6 字段} / specialState / voice）
  字段名严格用 faceAnchor / hairSystem / clothingLayers，不要用 appearance / looks / outfit 等
  faceAnchor 8 字段：faceShape / eyebrow / eyeType / noseType / lipType / boneStructure / skinTone / landmarks
  hairSystem 4 字段：lengthAndStyle / color / headwear / bangsDirection
  clothingLayers 6 字段：inner / outer / overlay / waist / lower / feet
- 禁止把 thought（思考内容）塞进 character.description / character.prompt 等字段
- generate_prop_image 的 prop 参数：必须填 V3.0 C.2 完整字段（name / category / plotFunction / era / size / structure / material / craftAndWear / decoration / functionalDetail / specialState / compositionType）
  compositionType 取值 fourView | single — 关键道具 fourView，次要道具 single
- generate_scene_image 的 scene 参数：必须填 V3.0 A.2 七层 + A.1.1 场景人物 + A.1.2 画质尾缀
  七层字段：worldPositioning / geography / mainStructure / extendedSpace / naturalAndDistant / lightAndColor / techSpec
  ambientCharacters（A.1.1 必填） + qualitySuffix（A.1.2 必填）
- generate_storyboard_image 的 shot 参数：必须填 V1.6 7 列工业镜头卡
  shotSize / cameraMovement / action / content / directionMarkers / sound 等
  directionMarkers 必填 CineForge 【】 方向标
- generate_video 的 shot 参数：与 generate_storyboard_image 一致 + duration_sec
- expand_story 的 idea_text 参数：填用户明确提出的故事想法或梗概；输出必须是完整故事正文。
- generate_script 的 long_text 参数：drama_short 必须填长篇故事正文/小说原文，**禁止**把 user_goal 或短梗概直接传入；已有完整宣传片文案时按任务类型处理

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


MEDIA_PARALLEL_POLICY = """
媒体调度硬规则：
- 如果当前目标需要生成两个或以上相互独立的图片/视频，必须优先调用 generate_media_batch，一次提交全部 jobs。
- 不要先调用单个 generate_* 工具再等失败后改用批量工具；这会造成串行等待和重复资产。
- 批量 jobs 必须为每项提供真实 prompt、kind(image/video)、name 和 asset_kind，主流程会立即创建生成中节点。
- 批量结果中某项失败时，不要停止其他项；继续主流程，并让 media-recovery worker 处理失败项。
"""

ASSET_INTELLIGENCE_POLICY = """
Asset intelligence policy:
- Before generating media, inspect uploaded visual image/video assets with inspect_asset.
- Never call inspect_asset for novel or script text assets. Use read_text_asset to read their body and structured content.
- Generated text assets do not require visual inspection. Do not inspect every item merely because it appears in the asset list.
- If an uploaded character, prop, or scene does not meet project standards, call prepare_character_asset before downstream generation.
- Reuse existing usable assets instead of regenerating them. Pass logical reference_asset_ids to media tools; never invent provider URLs.
- Prefer normalized derivatives over raw uploads while preserving the original source_asset_id relationship.
- If inspection or references need an unavailable capability, explain the blocker and ask the user; never silently use a legacy fallback.

【资产复用规则（硬约束）】
1. 生成任何新资产（角色/道具/场景/分镜）前，必须先调 search_project_assets 查项目资产库。
2. 找到匹配资产时，默认复用，不重新生成。发 ASSET_REUSE_PREVIEW 事件让用户预览。
3. 用户取消预览后才重新生成。
4. 未标识的上传资产：调 inspect_asset 自动识别。识别失败时调 ask_user 发表单提问
   "这个资产是什么？请选择类型（角色/道具/场景）并填写名称"。
5. 复用资产时，将其 ID 放入 reference_asset_ids 传给生成工具，保证一致性。
"""


def build_system_prompt() -> str:
    return REACT_SYSTEM_PROMPT


def build_react_prompt(
    user_goal: str,
    plan: list[dict],
    artifacts: dict,
    recent_steps: list[dict],
    tool_summaries: list[dict],
    project_assets: list[dict] | None = None,
    compressed_summary: str = "",
    conversation_turns: list[dict] | None = None,
) -> str:
    """构造单步 ReAct prompt。"""
    parts = [REACT_SYSTEM_PROMPT, MEDIA_PARALLEL_POLICY, ASSET_INTELLIGENCE_POLICY]

    # 用户目标
    parts.append(f"【用户目标】\n{user_goal}")

    # 压缩的早期记忆摘要（多轮对话时避免早期决策丢失）
    if compressed_summary:
        parts.append(f"【早期执行摘要】\n{compressed_summary}")

    # 历史对话轮次（每轮用户消息 + agent 完成摘要）
    if conversation_turns:
        turn_lines = []
        for t in conversation_turns:
            turn = t.get("turn", "?")
            user_msg = t.get("user_message", "")
            summary = t.get("agent_summary", "")
            step_range = t.get("step_range", [])
            range_str = f"步骤 {step_range[0]}-{step_range[1]}" if len(step_range) == 2 else ""
            turn_lines.append(f"第 {turn} 轮 {range_str}：用户「{user_msg}」→ {summary}")
        if turn_lines:
            parts.append("【历史对话轮次】\n" + "\n".join(turn_lines))

    # 计划
    if plan:
        lines = []
        for i, p in enumerate(plan, 1):
            status = p.get("status", "pending")
            mark = {"pending": "[ ]", "in_progress": "[~]", "done": "[x]", "skipped": "[-]"}.get(status, "[ ]")
            lines.append(f"{mark} {i}. {p.get('description', p.get('tool', '?'))}")
        parts.append("【当前计划】\n" + "\n".join(lines))

    # 已生成资产
    if artifacts:
        artifacts_lines = []
        for kind, items in artifacts.items():
            if items:
                names = [str(x.get("name") or x.get("id") or x) for x in items[:5]]
                artifacts_lines.append(f"- {kind}: {len(items)} 个 ({', '.join(names)})")
        if artifacts_lines:
            parts.append("【已生成资产】\n" + "\n".join(artifacts_lines))

    # 最近步骤
    asset_lines = []
    for asset in (project_assets or [])[:30]:
        asset_lines.append(
            "- {id}: name={name}; origin={origin}; kind={kind}; inspection={inspection}".format(
                id=asset.get("id", "?"),
                name=asset.get("name") or asset.get("title") or "(unnamed)",
                origin=asset.get("origin", "generated"),
                kind=asset.get("asset_kind") or asset.get("kind") or "unknown",
                inspection=asset.get("inspection_status", "pending"),
            )
        )
    if asset_lines:
        parts.append("[CURRENT PROJECT ASSETS]\n" + "\n".join(asset_lines))
    else:
        parts.append(
            "[CURRENT PROJECT ASSETS]\n"
            "- This project has no assets. Do not infer or reuse assets from another project."
        )

    if recent_steps:
        step_lines = []
        for s in recent_steps[-10:]:
            n = s.get("step_number", "?")
            thought = s.get("thought", "")
            action = s.get("action", {})
            tool = action.get("tool") if isinstance(action, dict) else None
            status = s.get("status", "?")
            observation = s.get("observation")
            observation_text = ""
            if observation:
                try:
                    observation_text = " | observation: " + json.dumps(
                        observation,
                        ensure_ascii=False,
                        default=str,
                    )[:4000]
                except (TypeError, ValueError):
                    observation_text = f" | observation: {str(observation)[:4000]}"
            step_lines.append(f"#{n} [{status}] {thought} → {tool}{observation_text}")
        parts.append("【最近步骤（最近 10 步）】\n" + "\n".join(step_lines))

    # 工具列表
    # 把每个工具的 name / description / parameters（参数名 + 类型 + 必填 + 说明）都列出来。
    # 否则 LLM 只能看到 name + description，会瞎猜参数名（如把 user_input 写成 user_text），
    # 工具 validate 失败 → 死循环。
    if tool_summaries:
        tool_lines: list[str] = []
        for t in tool_summaries:
            tool_lines.append(f"- {t['name']}: {t['description']}")
            params = t.get("parameters") or []
            for p in params:
                req = "必填" if p.get("required", True) else "可选"
                ptype = p.get("type", "string")
                pdesc = p.get("description", "")
                tool_lines.append(f"    · {p['name']} ({ptype}, {req}): {pdesc}")
        parts.append("【可用工具】\n" + "\n".join(tool_lines))

    return "\n\n".join(parts)


def build_compression_prompt(
    user_goal: str,
    steps_to_compress: list[dict],
    artifacts: dict,
) -> list[dict]:
    """构造压缩早期步骤的 LLM prompt。

    把已经被压缩范围之外的早期步骤喂给 LLM，生成一段结构化摘要，
    用于替换原始 steps 控制 prompt token 预算。摘要需保留：
    - 已完成的关键里程碑
    - 关键决策（parse_user_goal 结果、用户确认的选项）
    - 已生成资产清单（与 artifacts 交叉校验）
    - 失败/重试的关键教训
    """
    step_lines = []
    for s in steps_to_compress:
        n = s.get("step_number", "?")
        thought = s.get("thought", "")
        action = s.get("action", {})
        tool = action.get("tool") if isinstance(action, dict) else None
        status = s.get("status", "?")
        observation = s.get("observation")
        observation_text = ""
        if observation:
            try:
                observation_text = json.dumps(observation, ensure_ascii=False, default=str)[:2000]
            except (TypeError, ValueError):
                observation_text = str(observation)[:2000]
        step_lines.append(f"#{n} [{status}] {thought} → {tool} | {observation_text}")

    system = (
        "你是 Agent 记忆压缩器。把以下早期执行步骤压缩成一段简洁的中文摘要，"
        "保留：(1) 已完成的关键里程碑 (2) 关键决策与用户确认 "
        "(3) 已生成资产清单 (4) 失败/重试的教训。\n"
        "输出格式：纯文本段落，不超过 800 字，不要 JSON。"
    )
    user = (
        f"【用户目标】\n{user_goal}\n\n"
        f"【已生成资产】\n{json.dumps(artifacts, ensure_ascii=False, default=str)[:2000]}\n\n"
        f"【待压缩步骤】\n" + "\n".join(step_lines)
    )
    return [
        {"role": "system", "content": system},
        {"role": "user", "content": user},
    ]


# ========================
# LLMClient Protocol
# ========================

class LLMClient(Protocol):
    """LLM 客户端协议。后端实现可以是 OpenAI / DeepSeek / 火山引擎 等。"""

    model: str

    async def generate(
        self,
        messages: list[dict],
        tools: list[dict] | None = None,
        temperature: float = 0.7,
        max_tokens: int = 4000,
    ) -> LLMResponse: ...

    async def generate_structured(
        self,
        messages: list[dict],
        json_schema: dict | None = None,
        temperature: float = 0.7,
        max_tokens: int = 4000,
    ) -> LLMResponse: ...
