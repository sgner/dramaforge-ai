"""LLM 类工具：generate_script / extract_characters / extract_props / extract_scenes / extract_shots / optimize_prompt。

所有工具都通过 ctx.llm_client 调用 LLM，把小说/脚本拆成结构化资产。
"""
from __future__ import annotations

import json
from typing import Any

from .base import BaseTool, RetryableError, ToolContext, ToolParameter
from .planning import classify_source_maturity
from .planning import _coerce_json
from ..specs import get_spec_for_tool
from ..token_limits import DEEPSEEK_V4_PRO_MAX_OUTPUT_TOKENS


def _parse_llm_json_or_raise(content: str | None, list_field: str, tool_label: str) -> dict:
    """解析 LLM 返回的 JSON，并要求顶层包含目标 list 字段。

    背景（线上真实事故）：deepseek 这类模型经常返回空 content / 截断 JSON /
    纯文本，_coerce_json 返回 None。旧实现静默降级为 {"scenes": []} 之类的
    空结果并标 success，generate_script 甚至会把空脚本 save_asset 落库，
    agent 拿到空结果后一路走歪（inspect 空脚本、反问已答问题、任务卡死）。

    策略：
    - 解析失败（None）或目标字段缺失/不是 list → 抛 RetryableError，runtime
      会先自动重试，耗尽后 agent 仍能看到明确错误并调整输入。
    - JSON 合法且字段是 list（哪怕确实是空数组）→ 正常返回，不误伤合法空结果。
    """
    data = _coerce_json(content)
    if data is None or not isinstance(data.get(list_field), list):
        raise RetryableError(
            f"LLM 未返回有效的{tool_label} JSON（缺少 {list_field} 数组），请调整输入后重试"
        )
    return data


# ========================
# expand_story
# ========================

class ExpandStoryTool(BaseTool):
    """把短剧想法/梗概扩写成脚本生成前的完整故事正文。"""

    name = "expand_story"
    description = (
        "把用户的故事想法或简单剧情梗概扩写成至少 1000 字的完整故事正文，"
        "包含人物、背景、冲突、转折、结局和可改编的具体场景；不要输出提纲、列表或脚本格式。"
    )
    category = "llm"
    requires_approval = False
    estimated_cost_usd = 0.05
    estimated_time_sec = 10.0
    idempotent = True
    parameters = [
        ToolParameter(
            name="idea_text",
            type="string",
            description="用户提供的故事想法或简单剧情梗概。",
            required=True,
        ),
        ToolParameter(
            name="goal",
            type="object",
            description="可选的任务目标，包含时长、题材和风格。",
            required=False,
        ),
    ]

    async def validate(self, ctx: ToolContext, params: dict) -> str | None:
        if not str(params.get("idea_text") or "").strip():
            return "idea_text 不能为空"
        return None

    async def execute(self, ctx: ToolContext, params: dict) -> dict:
        if not ctx.llm_client:
            raise RuntimeError("expand_story 需要 ctx.llm_client")
        idea = str(params["idea_text"]).strip()
        goal = params.get("goal") or {}
        messages = [
            {
                "role": "system",
                "content": (
                    "你是 DramaForge 的专业故事作者。请把用户的想法扩写成完整故事正文。\n"
                    "要求：\n"
                    "1. 输出至少 1000 个中文字符（或等量目标语言篇幅）；\n"
                    "2. 必须写实际叙事、人物行动、对白、场景和因果，不要只写摘要；\n"
                    "3. 明确人物目标、核心冲突、至少一次转折、高潮和结局；\n"
                    "4. 只输出连续的故事正文，不要标题说明、项目符号、分析或脚本格式。"
                ),
            },
            {
                "role": "user",
                "content": f"【任务目标】{json.dumps(goal, ensure_ascii=False)}\n【故事想法】\n{idea}",
            },
        ]
        resp = await ctx.generate_llm(messages, temperature=0.85, max_tokens=DEEPSEEK_V4_PRO_MAX_OUTPUT_TOKENS)
        story = str(resp.content or "").strip()
        maturity = classify_source_maturity(story)
        if maturity != "long_form_source":
            raise RetryableError("扩写结果仍然过短，请生成完整故事正文")
        title = str(goal.get("title") or "扩写小说").strip()
        asset_payload = {
            "kind": "text",
            "asset_kind": "novel",
            "name": f"novel_expanded_{ctx.task_id}",
            "title": title,
            "url": story,
            "prompt": idea[:200],
            "origin": "generated",
            "extra": {
                "body": story,
                "text_stats": _compute_text_stats(story),
                "source_kind": "novel",
                "source_maturity": maturity,
                "original_idea": idea,
            },
        }
        from .asset_tools import SaveAssetTool
        novel_asset = await SaveAssetTool().call(ctx, asset_payload)
        self._sync_novel_to_artifacts(ctx, novel_asset, story, asset_payload["extra"])
        novel_asset_ref = {
            key: novel_asset.get(key)
            for key in ("id", "kind", "asset_kind", "name", "title", "status", "version")
            if key in novel_asset
        }
        return {
            "long_text": story,
            "source_text": story,
            "source_kind": "novel",
            "source_maturity": maturity,
            "original_idea": idea,
            "novel_asset": novel_asset_ref,
        }

    @staticmethod
    def _sync_novel_to_artifacts(
        ctx: ToolContext,
        save_result: dict,
        body: str,
        extra: dict,
    ) -> None:
        """Expose the saved novel to Agent memory and the canvas immediately."""
        asset_id = save_result.get("id")
        if not asset_id:
            return
        artifact = {
            "id": asset_id,
            "kind": "text",
            "asset_kind": "novel",
            "name": save_result.get("name") or "",
            "title": save_result.get("title") or "扩写小说",
            "url": save_result.get("url"),
            "prompt": save_result.get("prompt"),
            "status": save_result.get("status") or "ready",
            "version": save_result.get("version") or 1,
            "body": body,
            "text_stats": extra.get("text_stats"),
            "extra": extra,
        }
        if ctx.artifacts is not None:
            bucket = ctx.artifacts.setdefault("novel", [])
            if not any(item.get("id") == asset_id for item in bucket if isinstance(item, dict)):
                bucket.append(artifact)
        ctx.emit_event("artifact_created", artifact)


# ========================
# generate_script
# ========================

class GenerateScriptTool(BaseTool):
    """把长文本（小说 / 原文 / 宣传片文案）拆成分场脚本。

    关键行为：生成 scenes 后**自动调用 save_asset** 把脚本落库为
    asset_kind='script' 的文本资产（kind=text）。这样：

    1. LLM 下一轮 think 能在【已生成资产】中看到 script，下游
       extract_characters / extract_scenes 拿到稳定引用，避免反复重生成。
    2. 任务在 finish_task 校验 deliverables 时能拿到 script 计数，
       不会因"刚生成就丢"而误判 missing_deliverables。
    3. 前端资产库侧栏立即出现脚本节点，可点击打开 TextReader。

    输入 `novel_text` 与 `long_text` 等价（前者保留兼容旧调用）。
    `source_kind` 区分"小说（novel）"和"其他长文本（long_text，如宣传片文案）"，
    会写进 Asset.extra.source_kind，便于 UI 区分短剧 vs 宣传片。
    """

    name = "generate_script"
    description = (
        "把已成熟的长文本（小说 / 完整故事正文 / 宣传片文案）按场景拆解为分场脚本。\n"
        "【输入输出关系（必读）】\n"
        "- 输入（input）：long_text（或 novel_text，向后兼容）= 真实且成熟的素材文本（小说原文 / 完整故事正文 / 短剧原文 / 宣传片文案）。\n"
        "  drama_short 的想法或简单梗概必须先调用 expand_story，禁止直接传入本工具。\n"
        "  **禁止**：把 user_goal 这种'用户想写什么'的句子直接当 long_text 喂进来；user_goal ≠ source。\n"
        "  **禁止**：在没有 long_text 的情况下凭空调本工具 —— 必须先 ask_user 索要素材。\n"
        "- 输出（output）：结构化分场脚本 = { scenes, characters, props, bigShots, visualSignature }，"
        "并自动落库为 asset_kind='script' 的文本资产（前端 TextReader 可直接打开）。\n"
        "【source_kind 区分】\n"
        "- novel：用户给的是小说 / 短剧原文。\n"
        "- long_text：用户给的是宣传片文案 / 广告 / 新闻稿等其它成熟长文本。\n"
        "【典型用法】\n"
        "- 完整短剧：用户给小说 → generate_script(long_text=..., source_kind='novel') → extract_characters / extract_scenes / extract_shots → 生成媒体。\n"
        "- 宣传片：用户给宣传片文案 → generate_script(long_text=..., source_kind='long_text') → 直接生成媒体。\n"
        "- 用户只给想法或梗概：drama_short 先 expand_story，再把扩写正文作为 long_text 调本工具。"
    )
    category = "llm"
    requires_approval = False
    estimated_cost_usd = 0.05
    estimated_time_sec = 8.0
    idempotent = True
    parameters = [
        ToolParameter(
            name="long_text",
            type="string",
            description="长文本（小说 / 原文 / 宣传片文案）。与 novel_text 等价，推荐用此名。",
            required=False,
        ),
        ToolParameter(
            name="novel_text",
            type="string",
            description="【已弃用，请用 long_text】小说 / 原文。保留是为了兼容旧 prompt 缓存。",
            required=False,
        ),
        ToolParameter(
            name="source_text",
            type="string",
            description="解析阶段保留的原始长文本；优先级高于 summary/long_text，防止概要替代小说或脚本原文。",
            required=False,
        ),
        ToolParameter(
            name="source_kind",
            type="string",
            description="输入类型：novel（小说/短剧） | long_text（宣传片/广告/新闻稿等其它长文本）。默认 novel。",
            required=False,
            default="novel",
            enum=["novel", "long_text"],
        ),
        ToolParameter(
            name="goal",
            type="object",
            description="parse_user_goal 输出的结构化目标（含 duration_sec 等约束）。",
            required=False,
        ),
    ]

    async def validate(self, ctx: ToolContext, params: dict) -> str | None:
        text = params.get("long_text") or params.get("novel_text")
        if not text or not str(text).strip():
            return "long_text / novel_text 不能为空"
        profile = getattr(ctx, "task_profile", None)
        task_type = profile.get("task_type") if isinstance(profile, dict) else getattr(profile, "task_type", None)
        if task_type == "drama_short" and classify_source_maturity(str(text)) != "long_form_source":
            return "drama_short 的想法或简单梗概必须先调用 expand_story，不能直接生成脚本"
        return None

    async def execute(self, ctx: ToolContext, params: dict) -> dict:
        if not ctx.llm_client:
            raise RuntimeError("generate_script 需要 ctx.llm_client")
        # source_text 是 parse_user_goal 保留的原始素材。它必须优先于
        # agent 可能根据 summary 填入的 long_text，否则脚本解析会丢失小说正文。
        long_text = str(
            params.get("source_text")
            or params.get("long_text")
            or params.get("novel_text")
            or ""
        ).strip()
        source_kind = str(params.get("source_kind") or "novel")
        if source_kind not in {"novel", "long_text"}:
            source_kind = "novel"

        system_prompt = GENERATE_SCRIPT_SYSTEM_PROMPT
        spec = get_spec_for_tool("generate_script")
        if spec:
            system_prompt = system_prompt + "\n\n【项目规范】\n" + spec
        user_label = "【长文本】" if source_kind == "long_text" else "【小说】"
        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": _format_goal(params) + "\n\n" + user_label + "\n" + long_text},
        ]
        # max_tokens=8000：8 场完整结构化脚本（含 characters 的 faceAnchor 等
        # 嵌套字段）在 4000 下会被截断，截断 JSON 必解析失败。
        resp = await ctx.generate_llm(messages, temperature=0.6, max_tokens=DEEPSEEK_V4_PRO_MAX_OUTPUT_TOKENS)
        # 解析失败必须抛错让 step 记 failed（agent 下轮能看到错误并换输入重试），
        # 绝不能静默降级为空 scenes 还标 success 并把空脚本落库（线上真实事故）。
        data = _parse_llm_json_or_raise(resp.content, "scenes", "分场脚本")
        # 截断过长 scenes（防止 LLM 输出失控导致 Token 浪费）
        if len(data["scenes"]) > 30:
            data["scenes"] = data["scenes"][:30]

        # 关键：自动 save_asset，避免任务失败或死循环
        asset_payload = self._build_script_asset_payload(
            data, long_text=long_text, source_kind=source_kind,
        )
        save_result: dict = {}
        if ctx.db is not None:
            try:
                # 懒导入避免循环依赖
                from .asset_tools import SaveAssetTool
                save_result = await SaveAssetTool().call(ctx, asset_payload)
            except Exception as e:  # noqa: BLE001
                # save_asset 失败不应该让 generate_script 整体失败——
                # 工具已经把 scenes 返回给 agent 思考，资产落库失败可
                # 后续由 LLM 显式调 save_asset 补救。
                save_result = {"ok": False, "error": str(e)}

        out = dict(data)
        if save_result.get("id"):
            out["asset_id"] = save_result["id"]
        if save_result.get("ok") is False and save_result.get("error"):
            out["save_error"] = save_result["error"]
        # 序列化 markdown body 供前端 TextReader 渲染（与起始节点的脚本节点一致格式）
        out["body"] = _scenes_to_markdown(data["scenes"], long_text, source_kind)

        # 关键修复：把刚 save 的脚本资产同步到 ctx.artifacts 并 emit ARTIFACT_CREATED 事件。
        # 否则 runtime.py 只在 top-level tool_name=='save_asset' 时同步 memory.artifacts，
        # 顶层是 generate_script → memory.artifacts 看不到新脚本 → LLM 下轮 think 误以为
        # generate_script 没成功，反复重试 → max_steps 耗尽 → TASK_FAILED → SSE 关闭。
        if save_result.get("id") and save_result.get("ok") is not False:
            self._sync_script_to_artifacts(
                ctx, save_result, source_kind,
                body=out["body"], extra=asset_payload.get("extra") or {},
            )

        return out

    def _sync_script_to_artifacts(
        self,
        ctx: ToolContext,
        save_result: dict,
        source_kind: str,
        body: str = "",
        extra: dict | None = None,
    ) -> None:
        """把 SaveAssetTool 返回的脚本资产同步到 ctx.artifacts + 发 ARTIFACT_CREATED。

        为什么不能在 runtime.py 通用同步：runtime 只对 top-level tool_name=='save_asset'
        做同步；当 save_asset 是从 generate_script 内部调用时，runtime 不知道有资产产生。
        由 generate_script 自己负责同步是更内聚的做法（工具对自己的产物负责）。

        必须是实例方法（不是 @staticmethod）：execute() 内部用 self.xxx 调用，
        staticmethod 会因为 self 传入变成 4 个参数 TypeError，被 broad except 静默吞掉
        导致 memory.artifacts 还是空的——LLM 看不到新脚本，反复重试 → TASK_FAILED。
        """
        asset_id = save_result.get("id")
        if not asset_id:
            return
        # 构造一个与 SaveAssetTool 返回结构兼容的 dict（runtime 后续 emit ARTIFACT_CREATED
        # 用的也是这个结构）。
        # 关键：把 body 一起带上，否则前端 taskAssets.body 为空，TextReader 显示"暂无内容"
        # 而资产库卡片却用 item.prompt 兜底显示 200 字，造成"卡片有内容、阅读器空白"的体验断裂。
        artifact = {
            "id": asset_id,
            "kind": "text",
            "asset_kind": "script",
            "name": save_result.get("name") or "",
            "title": save_result.get("title") or "",
            "url": save_result.get("url"),
            "prompt": save_result.get("prompt"),
            "status": save_result.get("status") or "ready",
            "version": save_result.get("version") or 1,
            "source_kind": source_kind,
            "body": body,
            "text_stats": (extra or {}).get("text_stats"),
            # 关键：必须带上 extra（含 extra.script 结构化 JSON）。前端 ScriptNodeBody
            # 优先从 taskAssets.extra.script 读角色/道具/场景/分镜/视觉签名——缺了它，
            # 节点只能对 markdown body 做 JSON.parse（必失败），解析面板四项计数全 0。
            # （用户反馈：agent 生成脚本后画布脚本节点"脚本分析"全空）
            "extra": extra or {},
        }
        # 1. 写 ctx.artifacts（runtime memory 的直接引用）
        try:
            if ctx.artifacts is not None:
                # artifacts 的 key 用 asset_kind（与 runtime.save_asset bridge 行为一致），
                # 避免 "script" / "text" 两套 key 出现重复。
                bucket = ctx.artifacts.setdefault("script", [])
                if not any(
                    isinstance(item, dict) and item.get("id") == asset_id for item in bucket
                ):
                    bucket.append(artifact)
        except Exception:  # noqa: BLE001
            pass
        # 2. emit ARTIFACT_CREATED 事件（前端资产库侧栏立即出现脚本）
        try:
            ctx.emit_event("artifact_created", artifact)
        except Exception:  # noqa: BLE001
            pass

    @staticmethod
    def _build_script_asset_payload(data: dict, long_text: str, source_kind: str) -> dict:
        """构造 save_asset 调用参数：kind=text, asset_kind=script。

        双格式落库：
        - body = markdown 文本（TextReader 用，按 ScriptParagraph 解析）
        - extra.script = 结构化 JSON（ScriptNodeBody 用，渲染 角色/道具/场景/分镜/视觉签名 tabs）

        为什么是两份而不是一份：
        - agent 流程的 script 资产 = markdown 文本（自然可读、可编辑、可导出）
        - 画布 script 节点 = 结构化 JSON（解析面板：角色/道具/场景/分镜 tabs）
        - 两者数据模型不同：一个是"剧本原文"，一个是"剧本结构化分析"
        - 双格式落库，让两种用途各取所需，零运行时转换成本
        """
        scenes = data.get("scenes") or []
        body = _scenes_to_markdown(scenes, long_text, source_kind)
        # 用首场标题做 name，去重更稳（同 novel_text 重跑不会反复建资产）
        first_title = (scenes[0].get("title") if scenes else "").strip() or "分场脚本"
        title = f"分场脚本 · {first_title}" if first_title != "分场脚本" else first_title
        # 关键：组装 ScriptNodeBody 期望的 JSON 结构（与 ScriptNodeBody 字段一一对应）。
        # ScriptNodeBody 读取的字段：characters / props / sceneAssets / bigShots / visualSignature。
        # sceneAssets 取自 scenes[]（每个 scene 就是 sceneAsset）。
        structured_script = {
            "scenes": scenes,
            "characters": data.get("characters") or [],
            "props": data.get("props") or [],
            "bigShots": data.get("bigShots") or [],
            "sceneAssets": scenes,  # 兼容 ScriptNodeBody 的 sceneAssets 字段命名
            "visualSignature": data.get("visualSignature") or {},
        }
        return {
            "kind": "text",
            "asset_kind": "script",
            "name": f"script_{source_kind}_{len(scenes)}场",
            "title": title,
            "url": body,  # 兼容旧 reader 从 url 读 body
            "prompt": (long_text or "")[:200],
            "extra": {
                "body": body,
                "text_stats": _compute_text_stats(body),
                "source_kind": source_kind,
                "scene_count": len(scenes),
                "scenes": scenes,
                # 关键：结构化 JSON 存到 extra.script，画布 ScriptNodeBody 优先从这里读
                "script": structured_script,
            },
        }


# ========================
# extract_characters
# ========================

class ExtractCharactersTool(BaseTool):
    """从脚本中提取角色。"""

    name = "extract_characters"
    description = (
        "从分场脚本提取所有出场角色（主角/配角/路人），输出 V3.0 B.3 完整字段。"
        "【输入】script：可以是 dict（generate_script 输出的结构化 dict）、"
        "字符串（markdown body，会自动从 memory.artifacts 找脚本补全）、"
        "或 None（自动从 memory.artifacts 取最新一个脚本）。"
        "【输出】{characters: [{name, identity, ageRange, gender, era, faceAnchor{}, "
        "hairSystem{}, clothingLayers{}, specialState, voice}, ...]}"
    )
    category = "llm"
    requires_approval = False
    estimated_cost_usd = 0.03
    estimated_time_sec = 5.0
    idempotent = True
    parameters = [
        ToolParameter(
            name="script",
            type="object",
            description="脚本（dict / string / None，自动从 memory.artifacts['script'] 兜底）。",
            required=False,
        ),
        ToolParameter(
            name="goal",
            type="object",
            description="可选：参考目标。",
            required=False,
        ),
    ]

    async def validate(self, ctx: ToolContext, params: dict) -> str | None:
        # 关键修复：不再要求 script 必须是 dict。即使 LLM 传字符串（误把 markdown body 塞进 script），
        # 或传 None，或 dict 但缺 scenes 字段，extract_* 工具都会在 execute 阶段自动
        # 从 ctx.artifacts["script"] 兜底解析（_resolve_structured_script）。
        # 强制要求 dict 会让 LLM 一旦传错就被 validate 拒绝 → 进入死循环。
        return None

    async def execute(self, ctx: ToolContext, params: dict) -> dict:
        if not ctx.llm_client:
            raise RuntimeError("extract_characters 需要 ctx.llm_client")
        # 自动解析 script：兼容 dict / string / 包装过的 script 资产 / None 四种入参
        script = _resolve_structured_script(params.get("script"), ctx)
        system_prompt = EXTRACT_CHARACTERS_SYSTEM_PROMPT
        spec = get_spec_for_tool("extract_characters")
        if spec:
            system_prompt = system_prompt + "\n\n【项目规范】\n" + spec
        # 关键：不要直接 json.dumps 整段 script —— 那样 LLM 看到的是嵌套 JSON，
        # 容易被 body/asset_id 等噪声干扰。用 _format_script_for_llm 分块呈现
        # scenes，并明确告诉 LLM "这些是从哪里来的、提取目标是什么"。
        script_text = _format_script_for_llm(script)
        # 已生成的角色（从 generate_script 阶段或上轮 extract 已填），让 LLM 知道
        # 别重复提取
        known_characters = script.get("characters") or []
        known_text = ""
        if known_characters:
            known_names = [
                c.get("name") if isinstance(c, dict) else str(c)
                for c in known_characters
            ]
            known_names = [n for n in known_names if n]
            if known_names:
                known_text = (
                    "\n\n【generate_script 阶段已初步识别的角色（V3.0 字段可能不全，"
                    "本轮请基于分场脚本补全/扩展为完整 B.3 字段）】\n"
                    + "、".join(known_names)
                    + "\n要求：必须保留这些角色，并对每个角色补全 V3.0 B.3 必填字段"
                    "（faceAnchor / hairSystem / clothingLayers / voice / specialState）。"
                )
        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": script_text + known_text},
        ]
        # V3 角色结构字段较多，多个角色时 2000 tokens 很容易截断 JSON。
        resp = await ctx.generate_llm(messages, temperature=0.4, max_tokens=DEEPSEEK_V4_PRO_MAX_OUTPUT_TOKENS)
        try:
            data = _parse_llm_json_or_raise(resp.content, "characters", "角色提取")
        except RetryableError:
            # generate_script 已经产出了角色时，角色“补全”失败不能让整条流水线
            # 倒退到素材澄清。保留脚本中的检查点数据，后续仍可继续生成资产。
            if known_characters:
                return {
                    "characters": known_characters,
                    "fallback": True,
                    "fallback_reason": "invalid_llm_json",
                    "warning": "角色信息补全返回格式异常，已保留脚本中已有角色",
                }
            raise
        return {"characters": data["characters"]}


# ========================
# extract_props
# ========================

class ExtractPropsTool(BaseTool):
    """从脚本中提取关键道具。"""

    name = "extract_props"
    description = (
        "从分场脚本提取所有关键道具（物品），输出 V3.0 C.2 完整字段。"
        "【输入】script：可以是 dict / 字符串 / None，自动从 memory.artifacts 兜底解析。"
        "【输出】{props: [{name, category, ownerCharacter, ownerScene, plotFunction, "
        "era, size, structure, material, craftAndWear, decoration, functionalDetail, "
        "specialState, compositionType}, ...]}"
    )
    category = "llm"
    requires_approval = False
    estimated_cost_usd = 0.02
    estimated_time_sec = 4.0
    idempotent = True
    parameters = [
        ToolParameter(
            name="script",
            type="object",
            description="脚本（dict / string / None，自动从 memory.artifacts['script'] 兜底）。",
            required=False,
        ),
        ToolParameter(
            name="characters",
            type="array",
            description="可选：已知角色列表（用于排除「角色是人物不是道具」的混淆）。",
            required=False,
        ),
    ]

    async def validate(self, ctx: ToolContext, params: dict) -> str | None:
        # 关键修复：兼容 LLM 传字符串/包装过的 script 资产/_from_artifact_dict 自动解析
        return None

    async def execute(self, ctx: ToolContext, params: dict) -> dict:
        if not ctx.llm_client:
            raise RuntimeError("extract_props 需要 ctx.llm_client")
        script = _resolve_structured_script(params.get("script"), ctx)
        # 如果有 characters 参数，也和 script.characters 合并
        characters_param = params.get("characters")
        if isinstance(characters_param, list) and characters_param and not script.get("characters"):
            script["characters"] = list(characters_param)
        system_prompt = EXTRACT_PROPS_SYSTEM_PROMPT
        spec = get_spec_for_tool("extract_props")
        if spec:
            system_prompt = system_prompt + "\n\n【项目规范】\n" + spec
        script_text = _format_script_for_llm(script)
        # 已识别的角色名（用于排除"角色就是道具"的混淆 — 道具是物品，不是人）
        known_characters = script.get("characters") or []
        context_text = ""
        if known_characters:
            known_names = [
                c.get("name") if isinstance(c, dict) else str(c)
                for c in known_characters
            ]
            known_names = [n for n in known_names if n]
            if known_names:
                context_text = (
                    "\n\n【已识别角色 — 这些不是道具，是人物】\n"
                    + "、".join(known_names)
                    + "\n请勿将这些列入道具列表。"
                )
        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": script_text + context_text},
        ]
        resp = await ctx.generate_llm(messages, temperature=0.4, max_tokens=DEEPSEEK_V4_PRO_MAX_OUTPUT_TOKENS)
        data = _parse_llm_json_or_raise(resp.content, "props", "道具提取")
        return {"props": data["props"]}


# ========================
# extract_scenes
# ========================

class ExtractScenesTool(BaseTool):
    """从脚本中提取场景。"""

    name = "extract_scenes"
    description = (
        "从分场脚本提取所有拍摄场景（地点/时间/氛围），输出 V3.0 A.2 七层 + A.1.1 场景人物硬约束完整字段。"
        "【输入】script：可以是 dict / 字符串 / None，自动从 memory.artifacts 兜底解析。"
        "【输出】{scenes: [{name, location, time, weather, mood, description, "
        "worldPositioning, geography, mainStructure, extendedSpace, naturalAndDistant, "
        "lightAndColor, techSpec, qualitySuffix, ambientCharacters}, ...]}"
    )
    category = "llm"
    requires_approval = False
    estimated_cost_usd = 0.03
    estimated_time_sec = 5.0
    idempotent = True
    parameters = [
        ToolParameter(
            name="script",
            type="object",
            description="脚本（dict / string / None，自动从 memory.artifacts['script'] 兜底）。",
            required=False,
        ),
    ]

    async def validate(self, ctx: ToolContext, params: dict) -> str | None:
        # 关键修复：兼容 LLM 传字符串/包装过的 script 资产/_from_artifact_dict 自动解析
        return None

    async def execute(self, ctx: ToolContext, params: dict) -> dict:
        if not ctx.llm_client:
            raise RuntimeError("extract_scenes 需要 ctx.llm_client")
        script = _resolve_structured_script(params.get("script"), ctx)
        system_prompt = EXTRACT_SCENES_SYSTEM_PROMPT
        spec = get_spec_for_tool("extract_scenes")
        if spec:
            system_prompt = system_prompt + "\n\n【项目规范】\n" + spec
        script_text = _format_script_for_llm(script)
        # 已识别的场景（从 generate_script 阶段或上轮 extract 已填），让 LLM 知道别重复
        known_scenes = script.get("scenes") or []
        known_text = ""
        if known_scenes:
            known_names: list[str] = []
            for s in known_scenes:
                if isinstance(s, dict):
                    name = s.get("name") or s.get("title") or ""
                    if name:
                        known_names.append(str(name))
            if known_names:
                known_text = (
                    "\n\n【generate_script 阶段已识别的场景（每个 scene.title 已是合法 scene.name）】\n"
                    + "、".join(known_names[:20])
                    + "\n要求：保留这些场景名，并按 V3.0 A.2 七层 + A.1.1 场景人物"
                    "硬约束补全每个场景的结构化字段。"
                )
        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": script_text + known_text},
        ]
        resp = await ctx.generate_llm(messages, temperature=0.4, max_tokens=DEEPSEEK_V4_PRO_MAX_OUTPUT_TOKENS)
        data = _parse_llm_json_or_raise(resp.content, "scenes", "场景提取")
        return {"scenes": data["scenes"]}


# ========================
# extract_shots
# ========================

class ExtractShotsTool(BaseTool):
    """基于场景+脚本拆出分镜。"""

    name = "extract_shots"
    description = (
        "基于分场脚本 + 场景列表拆出分镜，输出 V1.6 7 列工业镜头卡 + CineForge v1.22 方向标。"
        "【输入】script：可以是 dict / 字符串 / None，自动从 memory.artifacts 兜底；"
        "scenes：可选的场景列表（也可不传，从 script.scenes 拿）。"
        "【输出】{shots: [{scene, index, shotNumber, timecode, duration_sec, shotSize, "
        "cameraMovement, action, content, dialogue, voice_tone, sound, tags[], vfxLevel, "
        "directionMarkers}, ...]}"
    )
    category = "llm"
    requires_approval = False
    estimated_cost_usd = 0.05
    estimated_time_sec = 8.0
    idempotent = True
    parameters = [
        ToolParameter(
            name="script",
            type="object",
            description="脚本（dict / string / None，自动从 memory.artifacts['script'] 兜底）。",
            required=False,
        ),
        ToolParameter(
            name="scenes",
            type="array",
            description="可选：场景列表（extract_scenes 的输出；缺省从 script.scenes 拿）。",
            required=False,
        ),
    ]

    async def validate(self, ctx: ToolContext, params: dict) -> str | None:
        # 关键修复：兼容 LLM 传字符串/包装过的 script 资产/_from_artifact_dict 自动解析
        return None

    async def execute(self, ctx: ToolContext, params: dict) -> dict:
        if not ctx.llm_client:
            raise RuntimeError("extract_shots 需要 ctx.llm_client")
        script = _resolve_structured_script(params.get("script"), ctx)
        # scenes 参数可以单独传（extract_scenes 的输出），也允许从 script 中补全
        scenes_param = params.get("scenes")
        if isinstance(scenes_param, list) and scenes_param:
            script_scenes = script.get("scenes") or []
            # 优先用 param 里的场景，但保留 script 中已识别的描述
            scenes_for_llm: list = []
            for idx, sc in enumerate(scenes_param):
                if isinstance(sc, dict):
                    sc_copy = dict(sc)
                    # 如果 script 里同 index 的 scene 有更详细的 description 字段，补进去
                    if idx < len(script_scenes) and isinstance(script_scenes[idx], dict):
                        for k in ("description", "dialogue", "characters"):
                            if not sc_copy.get(k) and script_scenes[idx].get(k):
                                sc_copy[k] = script_scenes[idx][k]
                    scenes_for_llm.append(sc_copy)
            script["scenes"] = scenes_for_llm
        system_prompt = EXTRACT_SHOTS_SYSTEM_PROMPT
        spec = get_spec_for_tool("extract_shots")
        if spec:
            system_prompt = system_prompt + "\n\n【项目规范】\n" + spec
        script_text = _format_script_for_llm(script)
        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": script_text},
        ]
        resp = await ctx.generate_llm(messages, temperature=0.5, max_tokens=DEEPSEEK_V4_PRO_MAX_OUTPUT_TOKENS)
        data = _parse_llm_json_or_raise(resp.content, "shots", "分镜提取")
        return {"shots": data["shots"]}


# ========================
# optimize_prompt
# ========================

class OptimizePromptTool(BaseTool):
    """把粗略 prompt 改写为适合图像/视频生成的细 prompt。"""

    name = "optimize_prompt"
    description = "把用户给的粗略 prompt 改写为适合图像/视频生成的细节 prompt（电影感 / 镜头语言 / 风格词）。"
    category = "llm"
    requires_approval = False
    estimated_cost_usd = 0.01
    estimated_time_sec = 2.0
    idempotent = True
    parameters = [
        ToolParameter(
            name="prompt",
            type="string",
            description="原始 prompt。",
            required=True,
        ),
        ToolParameter(
            name="target",
            type="string",
            description="目标媒介：image | video | audio。",
            required=False,
            default="image",
            enum=["image", "video", "audio"],
        ),
        ToolParameter(
            name="context",
            type="object",
            description="可选：上下文（如角色名/场景名/风格）。",
            required=False,
        ),
    ]

    async def validate(self, ctx: ToolContext, params: dict) -> str | None:
        if not params.get("prompt") or not str(params["prompt"]).strip():
            return "prompt 不能为空"
        return None

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
                + ("\n\n【上下文】\n" + json.dumps(params.get("context"), ensure_ascii=False) if params.get("context") else "")
            )},
        ]
        # Use a complete response here. Some OpenAI-compatible providers
        # acknowledge streaming requests but emit no usable data chunks,
        # which would turn every optimized prompt into an empty string.
        # max_tokens 给足 2000：部分模型会先输出大段中文推理再给英文 prompt，
        # 800 会在真 prompt 产出前截断，sanitize 只能拿到思考残段。
        resp = await ctx.llm_client.generate(messages, temperature=0.7, max_tokens=DEEPSEEK_V4_PRO_MAX_OUTPUT_TOKENS)
        optimized = _sanitize_optimized_prompt(resp.content or "")
        if not optimized:
            # 关键修复：sanitize 返回空（整段都被识别为 thinking/元描述）时，
            # 不要直接抛错让上层 task 失败，而是 fallback 到 source_prompt。
            # 原因：
            # 1. 用户输入的 prompt 可能是合法的（如"内层：白色贴身连体衣 / 中层..."），
            #    LLM 看到后会输出"考虑到" / "我认为" 这种思考词被识别为元描述。
            # 2. 直接抛错导致图片/视频生成卡死，前端出现"optimization returned an empty prompt"。
            # 3. 退回原始 prompt 让生成继续，agent 可以在后续步骤里换更明确的 prompt 重试。
            optimized = str(params["prompt"])
            return {
                "optimized": _cap_prompt_length(optimized),
                "target": target,
                "fallback": True,
                "fallback_reason": "sanitize_returned_empty",
            }
        return {"optimized": _cap_prompt_length(optimized), "target": target}


# ========================
# Prompt 优化后处理
# ========================
# LLM 在 optimize_prompt 时经常会"解释"它在做什么（输出"我们收到一个原始prompt..."、
# "要求是改写为..."等元描述），而不是直接输出 prompt 本身。
# 这些中文元描述如果直接传给 image model 会导致图片生成失败，
# 而且 UI 上会显示"思考内容"作为最终 prompt（用户最近反馈的 bug）。
#
# 处理策略（多层防御）：
# 1. 剥离 markdown 代码块包裹（```...```）
# 2. 剥离行首 "Prompt:" / "Output:" / "Result:" 等前缀
# 3. 剥离 <think>...</think> 形式的思考块
# 4. 检测 LLM 是否在"思考/规划"（元描述），如果是，从输出中提取真正 prompt
#    - 优先：从后向前找第一个不含元描述词的段落（>= 30 字符）
#    - 兜底：找最长且像 prompt 的段落（英文为主、含镜头/光线/风格关键词）
# 5. 如果整段都像元描述，输出空串让上层重试（不静默回退到 source prompt）
#
# 用户最近反馈：模型输出"最终输出应该是一个英文的细prompt..."这种 thinking，
# 当前 meta pattern 漏掉导致整段 planning 文本泄漏到 asset.prompt。
_OPTIMIZE_META_PATTERNS: tuple[str, ...] = (
    # 中文：任务说明类
    "我们收到", "我们 收到", "原始 prompt", "原始prompt",
    "要求是", "上下文中有", "我们需要遵循", "需要遵循", "上下文中",
    "注意", "我们要把", "我们把", "改写为", "我们输出", "下面输出",
    "下面是", "下面给", "我会给", "我将给", "以下是", "如下", "如下是",
    "输出格式", "prompt 文本", "prompt文本",
    # 中文：思考/规划类（用户最近反馈的"最终输出应该"）
    "最终输出应该", "最终输出", "最终 prompt", "最终的 prompt", "最终的输出",
    "最终的结果", "最终结果", "改写后的", "改写结果",
    "我需要", "我来", "让我", "我将", "我会", "我先", "我给你",
    "好的", "好的，", "好的。", "当然", "好的我来",
    "包含：", "包括：", "应当包含", "应包含", "应该包含",
    "应该输出", "应该写", "应输出", "应当输出",
    "我来写", "我先写", "我先想", "让我先", "让我来", "让我写",
    "现在来", "现在我", "下面是改写", "改写如下",
    # 中文：思考/推理类（用户最新反馈的"考虑到规则中有..."）
    # 这类词表示 LLM 在分析/权衡/推理，而不是直接输出 prompt。
    "考虑到", "综合", "对照", "然而", "但是", "因此", "所以",
    "判断", "认为", "觉得", "意味着", "说明", "可能意味着",
    "比较", "权衡", "对比", "审视", "解读", "梳理", "总结",
    "我的判断", "我决定", "我选择", "我倾向于", "我优先",
    "我同意", "我不认为", "我觉得", "我认为", "我判断",
    "这是因为", "这是因为", "因为", "由于",
    "根据", "根据规则", "根据上下文", "根据上面的",
    "综上", "综上所述", "从整体", "总体而言", "总体来说",
    "让我分析", "让我看看", "让我审视", "让我对比", "让我权衡",
    "规则包", "包是", "规则中", "规则要求", "规范要求", "规则说",
    # 系统提示词复述类（线上事故：模型把 OPTIMIZE_PROMPT_SYSTEM_PROMPT 里的
    # canonical_layout 硬约束条款连引号一起背出来当输出，asset.prompt 变成
    # '"If the context contains canonical_layout, treat it as a hard constraint..."
    # + 中文推理。这些词是元语言，绝不可能出现在合法 prompt 里）
    "canonical_layout", "hard constraint", "硬约束",
    # 中文：规划/措辞调整类（用户反馈：模型输出"中提到了...但我们需要调整为...
    # 我们可以用...最后，必须原样嵌入 B.4 的布局段"这种全文思考）
    "我们需要", "我们可以", "我们必须", "必须", "提到", "嵌入",
    "原样", "调整为", "布局段", "概念表",
    # 英文：任务说明类
    "we received", "the original prompt", "we need to",
    "here is", "here's the", "below is", "as follows",
    "the output should", "the prompt should", "the final output",
    "the final prompt", "final output", "final prompt",
    # 英文：思考/规划类
    "let me", "i will", "i'll", "i need to", "i'm going to",
    "first,", "first i", "okay,", "sure,", "of course",
    "should include", "should be", "must include", "must be",
    "this prompt", "the prompt is", "the result is", "the output is",
    "rewritten", "rewriting",
)


def _looks_like_thinking_prose(text: str) -> bool:
    """判断文本是否像长篇中文思考散文，而非合法的优化后 prompt。

    optimize_prompt 的系统提示词要求"用英文输出"，因此长段中文主体文本
    只可能是模型在"讨论" prompt（如"中提到了...我们需要调整为...必须原样
    嵌入 B.4 的布局段"），而不是 prompt 本身。

    短小的纯中文输出（如"林尘坐在咖啡店角落，温暖的阳光透过窗户洒在脸上"
    这类 30 字描述）仍然放行——部分中文友好的图像模型场景下那是合法 prompt。
    判定条件（同时满足）：
    - 总长度 >= 60 字符（短输出不误伤）
    - CJK 汉字 >= 20 个（零星中文词不触发）
    - 汉字占（汉字+英文字母）比例 >= 25%（英文 prompt 夹一句中文思考不触发）
    """
    stripped = (text or "").strip()
    if len(stripped) < 60:
        return False
    chinese = sum(1 for c in stripped if "\u4e00" <= c <= "\u9fff")
    if chinese < 20:
        return False
    english = sum(1 for c in stripped if c.isascii() and c.isalpha())
    total = chinese + english
    return total > 0 and chinese / total >= 0.25


def _looks_like_real_prompt(text: str) -> bool:
    """粗略判断一段文本是否像真正的 prompt（而非思考/元描述）。

    真正的 prompt 特征：
    - 主体是英文（少量中文 token 可忽略）
    - 含有镜头/光线/风格/构图等英文关键词
    - 长度 >= 30 字符
    - 不含明显的中文思考词

    思考/元描述特征：
    - 主体是中文（含"我们"/"我"/"应该"/"包含"等元描述）
    - 或者长度太短
    """
    stripped = (text or "").strip()
    if len(stripped) < 30:
        return False
    # 统计中英文字符占比
    chinese = sum(1 for c in stripped if "\u4e00" <= c <= "\u9fff")
    english = sum(1 for c in stripped if c.isascii() and c.isalpha())
    if english == 0:
        return False
    # 主体是中文 → 几乎肯定是思考
    if chinese > english:
        return False
    # 关键中英提示词关键词：只要命中 1 个就倾向于元描述
    meta_hit = any(token in stripped for token in _OPTIMIZE_META_PATTERNS)
    if meta_hit:
        return False
    # 真正 prompt 标志：包含常见镜头/画质关键词或较多逗号
    prompt_markers = (
        "shot", "camera", "lens", "light", "lighting", "color", "tone",
        "style", "render", "detail", "cinematic", "4k", "8k", "high detail",
        "view", "scene", "frame", "composition", "background", "depth",
        "shallow", "wide", "close", "ultra", "realistic", "anime",
        "portrait", "standing", "wearing", "holding",
    )
    lower = stripped.lower()
    has_marker = any(marker in lower for marker in prompt_markers)
    has_many_commas = stripped.count(",") >= 3
    return has_marker or has_many_commas


# 上游供应商的 prompt 长度上限（实测 seedance 网关：5~2000 字符，超限 HTTP 400
# "prompt length must be between 5 and 2000 characters"）。角色概念表布局段本身
# 就有 1300+ 字符，叠加结构化字段后很容易超限，这里统一兜底截断。
_PROMPT_MAX_LEN = 1900


def _cap_prompt_length(text: str, max_len: int = _PROMPT_MAX_LEN) -> str:
    """把最终 prompt 截断到供应商可接受的长度（尽量在句子/逗号边界）。"""
    text = (text or "").strip()
    if len(text) <= max_len:
        return text
    cut = text[:max_len]
    for sep in (". ", ", ", "，", "。"):
        idx = cut.rfind(sep)
        if idx > max_len * 0.8:
            return cut[:idx].rstrip(" ,，")
    return cut.rstrip(" ,，")


def _sanitize_optimized_prompt(raw: str) -> str:
    """清洗 optimize_prompt 工具的 LLM 输出，去掉元描述只保留真正的 prompt。

    之前 LLM 经常把"我们收到一个原始 prompt...要求是改写..."这种 ReAct 思考内容
    作为最终 prompt 返回，导致：
    1. UI 在"图片"tab 下显示的是 LLM 思考/解释而不是英文 prompt
    2. 把中文思考传给 image model，导致生成失败

    关键：发现 LLM 输出包含元描述时，尝试从输出末尾提取真正 prompt 段（最后一段
    看起来像 prompt 的内容）作为兜底。如果整段都像元描述，返回空串让上层处理。
    """
    import re as _re

    text = (raw or "").strip()
    if not text:
        return ""
    # 1. 剥离 <think>...</think> 形式（部分 reasoning 模型会输出这种块）
    text = _re.sub(r"<think>.*?</think>", "", text, flags=_re.DOTALL).strip()
    if not text:
        return ""
    # 2. 剥离 markdown 代码块包裹（```prompt\\n...\\n```）
    fenced = _re.search(r"```(?:[a-zA-Z]*\n)?(.*?)```", text, flags=_re.DOTALL)
    if fenced:
        text = fenced.group(1).strip()
    # 3. 去掉行首的 "Prompt:" / "Output:" / "Result:" 等前缀
    text = _re.sub(r"^\s*(prompt|output|result|answer|here'?s?\s+the\s+prompt)\s*[:：]\s*", "", text, flags=_re.IGNORECASE)
    if not text:
        return ""
    # 4. 检测元描述
    has_meta = any(token in text for token in _OPTIMIZE_META_PATTERNS)
    if not has_meta and _looks_like_thinking_prose(text):
        # 结构性防线：长段中文散文不可能是合规的英文 prompt——即使没命中元
        # 描述词表，也按 thinking 处理，进入下面的提取启发式；提取不到真
        # prompt 就返回空串，让上层 fallback 到 source_prompt。
        # （用户反馈：模型输出"中提到了...但我们需要调整为...必须原样嵌入 B.4
        # 的布局段"这种全文中文思考，词表覆盖不到，原样返回后泄漏到 asset.prompt）
        has_meta = True
    if not has_meta:
        # 没有元描述 → 整段就是 prompt，剥掉可能的首尾引号
        # 注意：这里不应用 _looks_like_real_prompt，避免误伤短小但合法的
        # LLM 响应（如单元测试 stub "optimized prompt"）。real_prompt
        # 评分仅在有元描述时使用。
        if text.startswith('"') and text.endswith('"') and len(text) > 2:
            text = text[1:-1].strip()
        return text
    # 5. 有元描述 → 尝试从输出中提取真正 prompt 段
    #    启发式 1：按段落切分（连续 2 个换行）
    paragraphs = [p.strip() for p in _re.split(r"\n{2,}", text) if p.strip()]
    #    启发式 2：按单换行切分（如果段落切分只有 1 段）
    if len(paragraphs) <= 1:
        paragraphs = [p.strip() for p in text.split("\n") if p.strip()]
    if not paragraphs:
        return ""
    # 优先用 _looks_like_real_prompt 评分挑选最佳段落
    real_candidates = [p for p in paragraphs if _looks_like_real_prompt(p)]
    if real_candidates:
        # 取最长（最完整）的真 prompt 候选
        best = max(real_candidates, key=len)
        if best.startswith('"') and best.endswith('"') and len(best) > 2:
            best = best[1:-1].strip()
        return best
    # 没有看起来像 prompt 的段落 → 启发式 3：尝试从行内冒号边界提取
    # LLM 经常这样输出："最终输出应该是一个英文的细prompt: 实际prompt"
    # 或 "Prompt: 实际prompt" / "提示词：实际prompt"。
    # 这种情况下整体字符串包含元描述 + prompt，但它们在同一行。
    last_colon = max(text.rfind(":"), text.rfind("："))
    if last_colon >= 0 and last_colon < len(text) - 30:
        tail = text[last_colon + 1:].strip()
        if _looks_like_real_prompt(tail):
            if tail.startswith('"') and tail.endswith('"') and len(tail) > 2:
                tail = tail[1:-1].strip()
            return tail
    # 启发式 4：处理"prompt 和 thinking 都在同一段"的污染模式（用户最新反馈）。
    # 必须放在启发式 5 之前——否则当 meta token 同时出现在 prompt 中间和后段时，
    # 启发式 5 只会取到 suffix 而丢失 prefix。
    # 策略：按元描述 token 出现的位置把整段文本切成多个非元描述片段，然后：
    #   1) 先看每个非元描述片段是否独立成 prompt
    #   2) 再尝试把多段"看起来像 prompt"的片段用 ", " 拼接还原（典型场景：
    #      LLM 在英文 prompt 中间塞一句中文思考，前后都是合法 prompt 片段）
    # 选最长且看起来像 prompt 的候选。
    # 门禁：整段是长篇中文思考散文时直接返回空串——那是"整段中文思考里引用
    # 了英文词"（如 中提到了“cinematic lighting...”），切片只会救出引号内
    # 的规则碎片，不是真 prompt；走空串 fallback 让上层回退到 source_prompt。
    if _looks_like_thinking_prose(text):
        return ""
    meta_ranges: list[tuple[int, int]] = []
    for token in _OPTIMIZE_META_PATTERNS:
        idx = 0
        while True:
            pos = text.find(token, idx)
            if pos < 0:
                break
            meta_ranges.append((pos, pos + len(token)))
            idx = pos + 1
    if meta_ranges:
        # 排序并合并重叠区间（同一区域被多个 token 命中）
        meta_ranges.sort()
        merged_ranges: list[tuple[int, int]] = []
        for start, end in meta_ranges:
            if merged_ranges and start <= merged_ranges[-1][1]:
                merged_ranges[-1] = (merged_ranges[-1][0], max(merged_ranges[-1][1], end))
            else:
                merged_ranges.append((start, end))
        # 抽取所有非元描述片段
        non_meta_segments: list[str] = []
        cursor = 0
        for start, end in merged_ranges:
            if start > cursor:
                non_meta_segments.append(text[cursor:start])
            cursor = end
        if cursor < len(text):
            non_meta_segments.append(text[cursor:])
        # 候选：每个看起来像 prompt 的非元描述片段
        prompt_segments = [seg.strip() for seg in non_meta_segments if _looks_like_real_prompt(seg.strip())]
        candidates: list[str] = list(prompt_segments)
        # 候选：拼接所有 prompt 片段（用 ", " 连接，更像 prompt 自然写法）
        if len(prompt_segments) > 1:
            joined = ", ".join(prompt_segments)
            if _looks_like_real_prompt(joined):
                candidates.append(joined)
        if candidates:
            best = max(candidates, key=len)
            if best.startswith('"') and best.endswith('"') and len(best) > 2:
                best = best[1:-1].strip()
            return best
    # 启发式 5：找最后一个元描述 token 之后的子串（启发式 4 失败时兜底）
    last_meta_pos = -1
    last_meta_token = ""
    for token in _OPTIMIZE_META_PATTERNS:
        pos = text.rfind(token)
        if pos > last_meta_pos:
            last_meta_pos = pos
            last_meta_token = token
    if last_meta_pos >= 0:
        after = text[last_meta_pos + len(last_meta_token):].strip()
        # 跳过冒号/句号等分隔符
        for sep in ("：", ":", "。", ".", "！", "!", "?", "？", "\n"):
            sep_idx = after.find(sep)
            if 0 <= sep_idx < len(after) - 1:
                after = after[sep_idx + 1:].strip()
                break
        if _looks_like_real_prompt(after):
            if after.startswith('"') and after.endswith('"') and len(after) > 2:
                after = after[1:-1].strip()
            return after
    # 优先找不含元描述词的段落（兜底）
    # 注意：仅"不含元描述词 + 够长"不够——截图 bug 中"中提到了...我们需要
    # 调整为...必须原样嵌入..."这种中文思考段恰好不含词表中的 token，会被
    # 原样返回。必须额外排除长篇中文思考散文段（合法 prompt 要求英文输出；
    # 短小的纯中文描述段仍放行，兼容中文友好的图像模型）。
    for p in reversed(paragraphs):
        if (
            not any(token in p for token in _OPTIMIZE_META_PATTERNS)
            and len(p) >= 20
            and not _looks_like_thinking_prose(p)
        ):
            if p.startswith('"') and p.endswith('"') and len(p) > 2:
                p = p[1:-1].strip()
            return p
    # 最后兜底：输出最长段落（可能仍是 thinking，但比静默回退到 source 好）
    longest = max(paragraphs, key=len) if paragraphs else ""
    if longest and _looks_like_real_prompt(longest):
        if longest.startswith('"') and longest.endswith('"') and len(longest) > 2:
            longest = longest[1:-1].strip()
        return longest
    # 整段都是元描述 → 返回空串让上层重试
    return ""


# ========================
# Prompt 模板
# ========================

GENERATE_SCRIPT_SYSTEM_PROMPT = """你是 DramaForge 编剧，把小说原文拆为分场脚本，并**一次性产出结构化解析**。

输出格式（严格 JSON，所有顶层字段必须存在，缺失则为空数组/默认对象）：

{
  "scenes": [
    {
      "index": 1,
      "title": "场景标题",
      "location": "地点",
      "time": "白天|夜晚|黄昏|清晨",
      "characters": ["角色A", "角色B"],
      "dialogue": "对话内容（多行用 \\\\n）",
      "description": "动作/画面描述",
      "duration_sec": 30
    }
  ],
  "characters": [
    {
      "name": "角色名",
      "identity": "身份/职业/阵营",
      "ageRange": "年龄段（如 25-30 / 少年 / 老年）",
      "gender": "男|女|其他",
      "era": "所属时代/世界观",
      "faceAnchor": {"faceShape": "长|圆|方|心形", "eyebrow": "平直|上扬|浓眉", "eyeType": "狭长|圆眼|凤眼", "noseType": "高直|宽鼻|细直", "lipType": "薄唇|厚唇", "boneStructure": "颧骨/下颌/眉骨 描述", "skinTone": "冷白|暖白|小麦|古铜", "landmarks": "痣/疤/胎记/纹身 位置"},
      "hairSystem": {"lengthAndStyle": "长度与束法", "color": "发色", "headwear": "头饰/帽子", "bangsDirection": "鬓角/刘海"},
      "clothingLayers": {"inner": "内层", "outer": "外层", "overlay": "套层", "waist": "腰部", "lower": "下装", "feet": "足部"},
      "specialState": "伤势/束缚/污垢/配饰/战损/改造"
    }
  ],
  "props": [
    {
      "name": "道具名",
      "category": "武器|工具|装饰|食物|其他",
      "material": "材质",
      "size": "尺寸/体积",
      "function": "功能/用途",
      "era": "所属时代/世界观"
    }
  ],
  "bigShots": [
    {
      "sceneIndex": 1,
      "index": 1,
      "scene": "与 scenes[index].location 对应的场景名",
      "characters": ["本镜实际出场角色名"],
      "props": ["本镜实际使用道具名"],
      "shotType": "特写|近景|中景|远景|全景",
      "cameraMove": "固定|推进|拉远|横移|跟拍",
      "action": "动作描述",
      "dialogue": "对白",
      "durationSec": 5
    }
  ],
  "visualSignature": {
    "medium": "实拍|2D动画|3D动画|手绘|水墨|油画|漫画|分镜草图",
    "aspectRatio": "16:9|9:16|1:1|2.39:1",
    "colorIds": [
      {"entity": "主色调描述", "hue": "色相或色值"},
      {"entity": "副色调描述", "hue": "色相或色值"}
    ],
    "coreTheme": "主题关键词"
  }
}

约束：
- 总时长尽量贴合用户的 duration_sec；每场 20-60 秒
- **scenes** 是核心必填项（否则前端无法渲染分场脚本）
- **characters / props / bigShots / visualSignature** 根据用户目标（goal.deliverables）输出：
  - 用户要求"角色"→ characters 必须填全（每个出场角色都要）
  - 用户要求"道具"→ props 必须填全
  - 用户要求"分镜"→ bigShots 必须从每场 scenes 拆出 1-3 个镜头
  - 用户要求"场景"→ scenes.location/time 已含；可省略 visualSignature
  - 视觉签名（visualSignature）总是输出（用于风格统一）
  - 如果用户只要求部分资产，未要求的字段填空数组/默认对象即可
- 仅输出 JSON，不要解释
"""


EXTRACT_CHARACTERS_SYSTEM_PROMPT = """你是 DramaForge 角色分析师，从【分场脚本】中识别所有出场角色。

【核心原则（必读，违反将被回退到 source prompt）】
**只能输出"能从脚本推导"的字段**。脚本是文字，没有视觉画面，所以：
- V3.0 详细字段（faceAnchor / hairSystem / clothingLayers）标记为 **best-effort**：
  - 脚本里有人物描写（如"身穿白衬衫"/"一头黑发"/"剑眉星目"）→ 提取并填入
  - 脚本里没有视觉描述 → **留空字符串**，**禁止编造**
  - 字段缺失时由下游 `_build_character_prompt` 根据 era/identity 填合理默认
- 必填字段（必须输出，非空）：name / identity / era / gender / ageRange
  这 5 个字段都可从分场脚本+剧情设定推导
- 路人群像只填 name + identity = "路人/背景"，其余字段留空串

【输入结构】
user 消息会给你：
1. 【分场脚本】— 每场包含：标题、地点/时间/时长、出场角色、画面描述、对白
2. （可选）脚本的 characters 列表 — generate_script 阶段已初步识别的角色名
3. （可选）脚本的 visualSignature — 时代/风格/色调线索

**输入识读指南**：
- 优先用"出场角色"列表确定角色名
- 缺失时，从"画面"和"对白"中识别人名（"林尘走进咖啡店..."或"林尘：你好"）
- 一个角色可能在多场出现 → 跨场合并为同一角色
- visualSignature.medium / aspectRatio → 决定 era 字段（实拍=现代，2D动画=动漫风等）

【输出格式（严格 JSON，5 字段必填，其余 best-effort）】
{
  "characters": [
    {
      // === 必填（5 个）===
      "name": "角色名",
      "identity": "身份/职业/阵营/角色定位（如 都市学生 / 反派老板 / 路人）",
      "era": "所属时代/世界观（从 visualSignature 推导，如 现代都市 / 唐代 / 民国上海 / 2087赛博朋克）",
      "gender": "男|女|其他",
      "ageRange": "年龄段（如 25-30 / 少年 / 老年 / 中年）",
      // === 最佳可空（best-effort：脚本有描写才填，没有留空串）===
      "appearance": "总体外观印象（仅当脚本有描写时填，如 古铜色皮肤 结实身材）",
      "personality": "性格关键词（从对白/剧情推导，如 沉默寡言 / 果断 / 温柔）",
      "plotRole": "剧情作用（主角/配角/反派/线索人物/路人）",
      // === V3.0 详细字段（best-effort：脚本明确提到才填，否则空串）===
      "faceAnchor": {
        "faceShape": "",      // 脸型 — 脚本明确提才填
        "eyebrow": "",        // 眉形
        "eyeType": "",        // 眼型
        "noseType": "",       // 鼻型
        "lipType": "",        // 唇形
        "boneStructure": "",  // 骨相
        "skinTone": "",       // 肤色
        "landmarks": ""       // 局部识别点
      },
      "hairSystem": {
        "lengthAndStyle": "", // 长度与束法
        "color": "",          // 发色
        "headwear": "",       // 头饰/帽子
        "bangsDirection": ""  // 鬓角/刘海
      },
      "clothingLayers": {
        "inner": "",          // 内层
        "outer": "",          // 外层
        "overlay": "",        // 套层
        "waist": "",          // 腰部
        "lower": "",          // 下装
        "feet": ""            // 足部
      },
      "specialState": "",     // 伤势/束缚/污垢/配饰/战损/改造（脚本明确提才填）
      "voice": ""             // 声音描述（脚本明确提才填）
    }
  ]
}

B.6 禁止事项（严格检查）：
1. **禁止编造**：faceAnchor / hairSystem / clothingLayers 字段脚本没提就留空串
2. **禁止把 thought（思考过程）塞进任何字段**（如"推测是..."/"根据XX判断..."）
3. **禁止空泛形容词**（"帅气"/"美丽"/"威严"必须转为具体五官描述，且仅当脚本支持时填）
4. **禁止比喻/拟人**（"如寒霜般的眼神" → 写实描述）
5. 古装题材禁止任何现代短发碎发；其他题材发型必须与时代严格匹配（仅当 hairSystem 字段非空时检查）
6. 角色提示词中禁止出现武器/法宝/道具/坐骑（须独立建道具卡）

字段为空时下游 `_build_character_prompt` 会按 era/identity 填合理默认 —
**空串 ≠ 缺数据**，**编造 = 坏数据**。

仅输出 JSON。"""


EXTRACT_PROPS_SYSTEM_PROMPT = """你是 DramaForge 道具师，从【分场脚本】中识别所有关键道具。

【核心原则（必读）】
**只能输出"能从脚本推导"的字段**：
- 必填字段（必须输出，非空）：name / category / plotFunction / era
  道具名、类别、剧情用途、所属时代 — 都能从分场脚本推导
- V3.0 详细字段（material / structure / craftAndWear / decoration / functionalDetail / size）：
  - 脚本有描写（如"玄铁短剑，剑柄缠丝带"）→ 提取并填入
  - 脚本没提视觉/材质细节 → **留空字符串**，**禁止编造**
  - 字段缺失时由下游 `_build_prop_prompt` 根据 category/era 填合理默认
- 普通背景物（桌椅、餐具、墙壁）不列 — 必须有剧情功能或角色识别价值

【输入结构】
user 消息会给你：
1. 【分场脚本】— 每场包含：标题、地点/时间/时长、出场角色、画面描述、对白
2. （可选）已识别角色列表（用于排除"角色是人物不是道具"）

**输入识读指南**：
- 从"画面"识别持握/穿戴/使用/提到的物品
- 从"对白"识别提到的物品（"这把剑送给你"）
- 武器/法宝/坐骑必须独立建道具卡（不要混进角色卡）
- 已识别的角色不是道具

【输出格式（严格 JSON，4 字段必填，其余 best-effort）】
{
  "props": [
    {
      // === 必填（4 个）===
      "name": "道具名",
      "category": "weapon|artifact|tool|token|vehicle|tech|daily|plotItem|document|wearable",
      "plotFunction": "剧情功能（一句话说明用途）",
      "era": "时代/世界观",
      // === 最佳可空 ===
      "ownerCharacter": "",  // 所属角色（可空）
      "ownerScene": "",      // 所属场景（可空）
      "appearance": "",      // 总体外观印象（脚本有描写才填）
      // === V3.0 详细字段（best-effort）===
      "size": "",            // 尺寸与体量
      "structure": "",       // 整体形制（结构/部件/比例）
      "material": "",        // 主体材质
      "craftAndWear": "",    // 工艺与年代痕迹
      "decoration": "",      // 装饰与纹样
      "functionalDetail": "",// 功能细节（机关/开关/弹匣/卡槽/指示灯）
      "specialState": "",    // 特殊状态（发光/损坏/沾血/缺失部件）
      "compositionType": "fourView"  // 关键道具 fourView，次要道具 single
    }
  ]
}

C.5 禁止事项：
1. **禁止编造**：V3.0 详细字段脚本没提就留空串
2. **禁止出现人物或人手**（道具卡为纯静物）
3. **禁止空泛形容词**（"精美"/"华丽"必须转为具体材质工艺，且仅当脚本支持时填）
4. **禁止与世界观脱节的材质**（古代道具不得出现塑料/LED，除非剧情设定）
5. **禁止把 thought 塞进字段**

字段为空时下游 `_build_prop_prompt` 会按 category/era 填合理默认 —
**空串 ≠ 缺数据**，**编造 = 坏数据**。

仅输出 JSON。"""


EXTRACT_SCENES_SYSTEM_PROMPT = """你是 DramaForge 美术指导，从【分场脚本】中识别所有拍摄场景。

【核心原则（必读）】
**只能输出"能从脚本推导"的字段**：
- 必填字段（必须输出，非空）：name / location / time / description
  场景名、地点、时间、整体描述 — 都能从分场脚本+画面推导
- V3.0 A.2 七层（worldPositioning / geography / mainStructure / extendedSpace /
  naturalAndDistant / lightAndColor / techSpec）：
  - 脚本有描写（"雨夜霓虹咖啡店"、"老旧教室木桌椅"）→ 填对应层
  - 脚本只提地点没描写（如"咖啡店"）→ **可空**，由下游 `_build_scene_prompt` 按 location 填合理默认
- ambientCharacters（A.1.1 必填）：每个场景至少 1 个（"无人氛围镜"必须显式标注）

【输入结构】
user 消息会给你一份【分场脚本】，每场包含：标题、地点、时间、画面描述、对白。

**输入识读指南**：
- "地点" + "时间" → scene.name 的种子（如"雨夜咖啡店"）
- "画面"中描述的环境细节（装潢、灯光、窗外景）→ scene.description 主来源
- 同地点不同时间算独立场景（"咖啡店白天" vs "咖啡店夜晚"）
- 远景天际线/物件极特写/故意空荡氛围镜 → name 标"无人氛围镜"

【输出格式（严格 JSON）】
{
  "scenes": [
    {
      // === 必填（4 个）===
      "name": "场景名（地点+时间+氛围，如 雨夜咖啡店）",
      "location": "具体地点",
      "time": "白天|夜晚|黄昏|清晨",
      "description": "环境整体描述（30-100字，融合主要视觉元素）",
      // === 最佳可空 ===
      "weather": "",     // 晴|雨|雪|雾（脚本提才填）
      "mood": "",        // 氛围词（脚本提才填）
      // === V3.0 七层（best-effort：脚本有描写才填，否则空串）===
      "worldPositioning": "",  // 30-50字：超写实 + 时代/风格 + 场景类型 + 美术风格
      "geography": "",         // 20-30字：具体地形/地段 + 空间关系
      "mainStructure": "",     // 100-150字：建筑/场景实体细节
      "extendedSpace": "",     // 80-100字：延伸空间 + 周边设施
      "naturalAndDistant": "", // 60-80字：近景 + 中景 + 远景
      "lightAndColor": "",     // 60-80字：主光源 + 光线效果 + 色调
      "techSpec": "",          // 50-70字：渲染引擎 + 镜头类型 + 参考作品
      // === A.1.1 + A.1.2（必填，下游 _build_scene_prompt 会给默认）===
      "qualitySuffix": "真人写实风格，电影画质，影视级真实材质，8K超精细，光影真实自然，物理准确的光照和阴影，材质纹理清晰可触",
      "ambientCharacters": ""  // 至少 1 个，例外为无人氛围镜
    }
  ]
}

A.1.1 场景人物硬约束：每个场景必须包含适配场景类型的人物，自然融入环境。
例外：远景天际线/物件极特写/故意空荡的氛围镜头 — 标注 "无人氛围镜" 并说明合理性。

A.4 色彩管理：禁止高饱和紫色/荧光色/霓虹色（赛博朋克等强霓虹世界观除外）。

去重：同地点不同时间的算独立场景。

字段为空时下游 `_build_scene_prompt` 会按 location/description 填合理默认 —
**空串 ≠ 缺数据**，**编造 = 坏数据**。

仅输出 JSON。"""


EXTRACT_SHOTS_SYSTEM_PROMPT = """你是 DramaForge 摄影指导，把【分场脚本 + 场景列表】拆为分镜。

【核心原则（必读）】
- 每个分镜 3-8 秒，总时长贴合场景。
- 必填字段（必须输出，非空）：scene / index / shotSize / cameraMovement / action
  场景引用、序号、景别、镜头运动、动作 — 都能从分场脚本+画面推导
- V1.6 7 列工业镜头卡（shotNumber / timecode / duration_sec / content / dialogue /
  voice_tone / sound / tags / vfxLevel / directionMarkers）：
  - 脚本有明确视觉/对白 → 填对应字段
  - 脚本没提 → **留空串或留空数组**（sound 必须有默认值"环境低频+细节高频"）

【输入结构】
user 消息会给你：
1. 【分场脚本】— 每场已展开 地点/时间/画面/对白
2. （可选）场景列表 — extract_scenes 的输出（含 worldPositioning 等七层）
3. （可选）visualSignature — 整体风格/色调/比例

**输入识读指南**：
- 每场 1-3 个分镜
- 关键对白必须落到具体分镜的 dialogue 字段
- 动作驱动：每镜必须含"谁在做什么"，禁止静态位置（"悬于"/"位于"）

【输出格式（严格 JSON）】
{
  "shots": [
    {
      // === 必填（5 个）===
      "scene": "场景名（与 scene.name 一致）",
      "index": 1,                // 场内的分镜序号
      "characters": ["本镜实际出场角色名"],
      "props": ["本镜实际使用道具名"],
      "shotSize": "极端特写|特写|近景|中近景|中景|中远景|全景|远景",
      "cameraMovement": "平视/俯拍/仰拍/荷兰角/POV/过肩/上帝视角/虫视角 + 摇/推/拉/横移/升降/斯坦尼康/手持/跟拍/推拉变焦/急摇/无人机/高速摄影/静止",
      "action": "动作描述（≤30字，主体 + 动作 + 关键细节，action-driven not static position）",
      // === 最佳可空 ===
      "shotNumber": 1,           // 全局分镜号
      "timecode": "0:00",        // 时间码
      "duration_sec": 5,
      "content": "≤30字 主体+动作+关键细节，可直接拍",
      "dialogue": "",            // 对白（可空）
      "voice_tone": "",          // 语气（可空）
      "sound": "ambient 环境低频 + sfx 细节高频",  // 必填（默认值兜底）
      "tags": [],                // 海报帧|伏笔|关键|重特效|长镜|音锚|特设备（单镜头最多 2 个）
      "vfxLevel": "",            // S|A|B|C（可选）
      "directionMarkers": ""     // CineForge 方向标【】4 类：入画+运动方向/镜头自身运动/Z-Y轴/多元素同时运动
    }
  ]
}

CineForge v1.22 硬约束：
- 动作驱动：每镜必须含"谁在做什么"，禁止静态位置
- 入画动作优先：用"从画面X侧入画" not "位于画面X"
- 严禁描述镜尾：无"停在 X"/"落在 Y"/"悬于"
- 一镜一焦点：不要同时塞 主角+次要+光线+背景
- 群像多样化：群像加"长相不同, 穿着不同"
- 多角色空间锚定：方向词加"画面"前缀
- 景别强制中文 7 档，无英文缩写

字段为空时下游 `_build_storyboard_prompt` 会给合理默认 —
**空串 ≠ 缺数据**，**编造 = 坏数据**。

仅输出 JSON。"""


OPTIMIZE_PROMPT_SYSTEM_PROMPT = """你是 DramaForge 提示词工程师，擅长把粗略描述改写为适合 {target} 生成模型的细 prompt。

If the context contains `canonical_layout`, treat it as a hard constraint. Preserve its layout, views, identity consistency, background, and negative constraints verbatim; never replace or remove those requirements. Only add subject, action, camera, material, or lighting details around it.

严格输出规则（违反将被过滤）：
- 只输出最终的 prompt 文本本身
- 不要解释、不要分点、不要 JSON、不要 markdown 代码块包裹
- 不要写"我们收到..."、"原始 prompt 是..."、"要求是改写为..."、"下面是..."等元描述
- 不要复述用户的输入、规则、要求

要求：
- 用具体名词代替抽象词
- 加入镜头/光线/色调/风格关键词
- 用英文输出（生成模型普遍用英文 prompt）
- 直接输出 prompt 文本，不要 JSON 包裹

示例输出（注意：只有 prompt 本身，没有任何前缀/解释/代码块）：
A male human knight in his early 30s, short brown hair, strong jawline, blue eyes, wearing polished silver plate armor with a steel helmet bearing a golden lion crest. He holds a broadsword resting on the ground. Full body: character portrait, front view, dramatic lighting, medieval fantasy style, photorealistic, highly detailed, dramatic fighting, medieval fantasy style, photorealistic, 8K."""


# ========================
# 工具内辅助
# ========================

def _format_goal(params: dict) -> str:
    goal = params.get("goal")
    if not goal:
        return ""
    return "【目标】\n" + json.dumps(goal, ensure_ascii=False)


def _resolve_structured_script(script_input, ctx: ToolContext | None) -> dict:
    """从多种输入形态中解析出结构化脚本 dict。

    背景：generate_script 的产物有三层"形状"，agent 在调用 extract_* 时
    可能传错任意一种：

    1. 完整 generate_script 输出 dict（含 scenes/characters/props/bigShots/
       visualSignature + body  markdown + asset_id + save_error）
    2. 字符串（LLM 误把 markdown body 当 long_text 塞进 script 参数）
    3. 部分 dict（只有 {"scenes": [...]}，缺 characters/props/bigShots）
    4. 包装过的 script 资产（来自 ctx.artifacts["script"][0]，含 extra.script）

    本函数把这些"形状"全部归一为：
        {
            "scenes": [...],
            "characters": [...],
            "props": [...],
            "bigShots": [...],
            "visualSignature": {...},
            "body": "<markdown>",
            "asset_id": "...",
            "source_kind": "novel|long_text",
        }

    解析顺序（优先级从高到低）：
    a) 显式传入了 valid dict（顶层含 scenes 或 characters） → 直接返回
    b) 字符串 → 当作 markdown body 缓存到 body 字段；不阻塞，从
       ctx.artifacts["script"] 找完整结构补全
    c) dict 但缺 scenes/characters → 从 ctx.artifacts["script"] 补全
    d) 完全没传或空 → 从 ctx.artifacts["script"] 取最新一个

    返回的 dict 始终有 "scenes"（list，可能为空）和 "body"（str）。
    """
    fallback_script: dict = {}

    def _from_artifact_dict(artifact: dict) -> dict:
        """从 ctx.artifacts['script'][0] 这种包装 dict 解出结构化数据。"""
        out: dict = {}
        if not isinstance(artifact, dict):
            return out
        # 1) extra.script 优先（V3.0 完整结构）
        extra = artifact.get("extra") or {}
        structured = extra.get("script") if isinstance(extra, dict) else None
        if isinstance(structured, dict):
            out["scenes"] = list(structured.get("scenes") or [])
            out["characters"] = list(structured.get("characters") or [])
            out["props"] = list(structured.get("props") or [])
            out["bigShots"] = list(structured.get("bigShots") or [])
            out["visualSignature"] = dict(structured.get("visualSignature") or {})
            if isinstance(structured.get("sceneAssets"), list) and not out["scenes"]:
                out["scenes"] = list(structured["sceneAssets"])
        # 2) artifact 自身顶层字段兜底
        for key in ("scenes", "characters", "props", "bigShots", "visualSignature"):
            if not out.get(key) and artifact.get(key):
                out[key] = artifact[key]
        # 3) body 字段（markdown）— 来自 extra.body / url / 直接 body
        body = ""
        if isinstance(extra, dict) and extra.get("body"):
            body = str(extra["body"])
        elif artifact.get("body"):
            body = str(artifact["body"])
        elif artifact.get("url") and "\n" in str(artifact.get("url") or ""):
            body = str(artifact["url"])
        if body:
            out["body"] = body
        # 4) 标识字段透传
        if artifact.get("id"):
            out["asset_id"] = str(artifact["id"])
        if isinstance(extra, dict) and extra.get("source_kind"):
            out["source_kind"] = str(extra["source_kind"])
        elif artifact.get("source_kind"):
            out["source_kind"] = str(artifact["source_kind"])
        return out

    # 1) 从 ctx.artifacts['script'] 预解析 fallback
    if ctx is not None and isinstance(getattr(ctx, "artifacts", None), dict):
        scripts_bucket = ctx.artifacts.get("script") or []
        for artifact in reversed(scripts_bucket):
            if not isinstance(artifact, dict):
                continue
            candidate = _from_artifact_dict(artifact)
            if candidate:
                fallback_script = candidate
                break

    # 2) 解析入参
    resolved: dict = {}
    body_only: str = ""
    if script_input is None:
        resolved = {}
    elif isinstance(script_input, str):
        body_only = script_input
    elif isinstance(script_input, dict):
        # 区分：直接结构化 vs 包装过的 script 资产
        if any(k in script_input for k in ("scenes", "characters", "props", "bigShots", "visualSignature")):
            # 看起来就是结构化数据
            resolved = {
                "scenes": list(script_input.get("scenes") or []),
                "characters": list(script_input.get("characters") or []),
                "props": list(script_input.get("props") or []),
                "bigShots": list(script_input.get("bigShots") or []),
                "visualSignature": dict(script_input.get("visualSignature") or {}),
            }
            # 兼容：generate_script 顶层会塞 body / asset_id / save_error，跳过这些
            if script_input.get("body"):
                resolved["body"] = str(script_input["body"])
        else:
            # 没有任何结构化字段，疑似包装过的资产
            maybe_asset = _from_artifact_dict(script_input)
            if maybe_asset:
                resolved = maybe_asset
    else:
        resolved = {}

    # 3) 补全：从 fallback 拿 scenes/characters/props/bigShots
    for key in ("scenes", "characters", "props", "bigShots", "visualSignature"):
        if not resolved.get(key) and fallback_script.get(key):
            resolved[key] = fallback_script[key]

    # 4) body 字段
    if body_only:
        resolved["body"] = body_only
    elif "body" not in resolved and fallback_script.get("body"):
        resolved["body"] = str(fallback_script["body"])

    # 5) scenes 兜底：若连 fallback 都没有 scenes 但有 body markdown，
    # 用 _scenes_to_markdown 的反向解析在 markdown 中识别 "第N场"
    if not resolved.get("scenes") and resolved.get("body"):
        resolved["scenes"] = _parse_scenes_from_markdown(resolved["body"])

    # 6) 确保 keys 存在
    resolved.setdefault("scenes", [])
    resolved.setdefault("characters", [])
    resolved.setdefault("props", [])
    resolved.setdefault("bigShots", [])
    resolved.setdefault("visualSignature", {})
    return resolved


def _parse_scenes_from_markdown(body: str) -> list[dict]:
    """从 markdown body 兜底提取 scenes 字段（仅 location/time/duration/characters/dialogue/description）。

    当 LLM 把 body 字符串塞进 script 参数、或 ctx.artifacts 里只有 markdown
    没有结构化 scenes 时，这是最后一道兜底。LLM 收到这个 scenes list
    后仍然可以基于 description / dialogue 提取角色/道具/场景/分镜。
    """
    import re

    if not body:
        return []
    scenes: list[dict] = []
    # 匹配 "第N场" / "场景N" / "【场N】" 段落
    pattern = re.compile(
        r"(?:^|\n)\s*(第[一二三四五六七八九十百零0-9]+场|场景[一二三四五六七八九十百零0-9]*|【场\d+】)\b[^\n]*",
        re.MULTILINE,
    )
    matches = list(pattern.finditer(body))
    if not matches:
        return []
    for idx, m in enumerate(matches):
        start = m.end()
        end = matches[idx + 1].start() if idx + 1 < len(matches) else len(body)
        section = body[start:end].strip()
        title_line = m.group(0).strip()
        # 解析元信息行（地点：xxx | 时间：xxx | 时长：xxx秒）
        location = ""
        time = ""
        duration_sec = 0
        loc_match = re.search(r"地点[：:]\s*([^\n|]+)", section)
        if loc_match:
            location = loc_match.group(1).strip()
        time_match = re.search(r"时间[：:]\s*([^\n|]+)", section)
        if time_match:
            time = time_match.group(1).strip()
        dur_match = re.search(r"时长[：:]\s*(\d+)\s*秒", section)
        if dur_match:
            try:
                duration_sec = int(dur_match.group(1))
            except (TypeError, ValueError):
                duration_sec = 0
        # 解析 "### 角色" / "### 画面" / "### 对白"
        characters: list[str] = []
        char_match = re.search(r"###\s*角色[^\n]*\n+([^\n#]+)", section)
        if char_match:
            characters = [c.strip() for c in re.split(r"[、，,]", char_match.group(1)) if c.strip()]
        desc = ""
        desc_match = re.search(r"###\s*画面[^\n]*\n+([^#]+?)(?=\n###|\n##|\Z)", section, re.DOTALL)
        if desc_match:
            desc = desc_match.group(1).strip()
        dialogue = ""
        dlg_match = re.search(r"###\s*对白[^\n]*\n+([^#]+?)(?=\n###|\n##|\Z)", section, re.DOTALL)
        if dlg_match:
            dialogue = dlg_match.group(1).strip()
        scenes.append({
            "index": idx + 1,
            "title": title_line,
            "location": location,
            "time": time,
            "characters": characters,
            "description": desc,
            "dialogue": dialogue,
            "duration_sec": duration_sec,
        })
    return scenes


def _format_script_for_llm(script: dict) -> str:
    """把结构化脚本格式化成 LLM 易读的 prompt 文本。

    关键：不是直接 dump 整个 JSON 字符串，而是分块呈现，让 LLM 知道：
    - 这是分场脚本（scenes 列表）
    - 已经在 generate_script 阶段解析过的字段（如 characters/props/scenes 顶层）也注入进来
    - 提取任务的目标是从 scenes 里发现新信息，或补全 V3.0 字段

    输出结构（按提取任务的相关性排序）：
    0. 【视觉签名 / Visual Signature】— era/aspectRatio/colorIds 时代风格线索
    1. 【分场脚本 / Scenes】— 每场的 标题/地点/时间/角色名/画面/对白（核心）
    2. （如果脚本有 characters 列表）【已识别角色 / Characters】— generate_script 阶段初步识别的
       角色名+identity+era，extract_characters 必须保留这些名字
    3. （如果脚本有 props 列表）【已识别道具 / Props】— generate_script 阶段初步识别的
       道具名+category，extract_props 必须保留这些
    4. （如果脚本有 bigShots 列表）【已识别大镜头 / Big Shots】— extract_shots 时参考细分

    字符长度控制：每场 description 截断到 300 字，dialogue 截断到 200 字，避免 token 爆炸。
    """
    if not isinstance(script, dict):
        return "（无脚本）"
    scenes = script.get("scenes") or []
    if not scenes:
        return "（脚本为空或无法解析）"

    out_lines: list[str] = []

    # 0. visualSignature 摘要（作为 era/时代/风格的统一线索）
    visual_signature = script.get("visualSignature") or {}
    if isinstance(visual_signature, dict) and visual_signature:
        bits: list[str] = []
        medium = visual_signature.get("medium")
        if medium:
            bits.append(f"媒介={medium}")
        ar = visual_signature.get("aspectRatio")
        if ar:
            bits.append(f"画幅={ar}")
        colors = visual_signature.get("colorIds")
        if isinstance(colors, list) and colors:
            bits.append("色调=" + "/".join(str(c) for c in colors if c))
        theme = visual_signature.get("coreTheme")
        if theme:
            bits.append(f"主题={theme}")
        if bits:
            out_lines.append("【视觉签名】" + " | ".join(bits))
            out_lines.append("")

    # 1. 分场脚本（核心：每场的 地点/时间/角色/画面/对白）
    out_lines.append(f"【分场脚本】共 {len(scenes)} 场")
    out_lines.append("")
    for idx, scene in enumerate(scenes, 1):
        if not isinstance(scene, dict):
            continue
        title = (scene.get("title") or f"第{idx}场").strip()
        location = (scene.get("location") or "").strip()
        time = (scene.get("time") or "").strip()
        characters = scene.get("characters") or []
        description = (scene.get("description") or "").strip()
        dialogue = (scene.get("dialogue") or "").strip()
        duration = scene.get("duration_sec")
        out_lines.append(f"━━━ 第{idx}场：{title} ━━━")
        meta_bits: list[str] = []
        if location:
            meta_bits.append(f"地点：{location}")
        if time:
            meta_bits.append(f"时间：{time}")
        if duration:
            meta_bits.append(f"时长：{duration}秒")
        if meta_bits:
            out_lines.append("  " + " | ".join(meta_bits))
        if characters:
            chars = "、".join(str(c) for c in characters if str(c).strip())
            if chars:
                out_lines.append(f"  出场角色：{chars}")
        if description:
            # 截断避免 token 爆炸
            desc_text = description if len(description) <= 300 else description[:300] + "…"
            out_lines.append(f"  画面：{desc_text}")
        if dialogue:
            dlg_text = dialogue if len(dialogue) <= 200 else dialogue[:200] + "…"
            out_lines.append(f"  对白：{dlg_text}")
        out_lines.append("")

    # 2. 已识别角色（来自 generate_script 阶段的初步提取）
    pre_characters = script.get("characters") or []
    if pre_characters:
        out_lines.append("【已识别角色（来自 generate_script，必须保留）】")
        for ch in pre_characters:
            if not isinstance(ch, dict):
                continue
            name = ch.get("name") or ""
            if not name:
                continue
            bits = [name]
            identity = ch.get("identity")
            if identity:
                bits.append(f"identity={identity}")
            era = ch.get("era")
            if era:
                bits.append(f"era={era}")
            gender = ch.get("gender")
            if gender:
                bits.append(f"gender={gender}")
            out_lines.append("  - " + " | ".join(bits))
        out_lines.append("")

    # 3. 已识别道具（来自 generate_script 阶段的初步提取）
    pre_props = script.get("props") or []
    if pre_props:
        out_lines.append("【已识别道具（来自 generate_script，必须保留）】")
        for p in pre_props:
            if not isinstance(p, dict):
                continue
            name = p.get("name") or ""
            if not name:
                continue
            bits = [name]
            category = p.get("category")
            if category:
                bits.append(f"category={category}")
            pf = p.get("plotFunction") or p.get("function")
            if pf:
                bits.append(f"plotFunction={pf}")
            out_lines.append("  - " + " | ".join(bits))
        out_lines.append("")

    # 4. 已识别大镜头（来自 generate_script 阶段，extract_shots 时参考）
    pre_shots = script.get("bigShots") or []
    if pre_shots:
        out_lines.append("【已识别大镜头（来自 generate_script，extract_shots 时可参考细分）】")
        for s in pre_shots:
            if not isinstance(s, dict):
                continue
            bits = []
            scene_idx = s.get("sceneIndex")
            if scene_idx:
                bits.append(f"scene#{scene_idx}")
            shot_idx = s.get("index")
            if shot_idx:
                bits.append(f"shot#{shot_idx}")
            if s.get("scene"):
                bits.append(f"scene={s['scene']}")
            if s.get("characters"):
                bits.append("characters=" + "/".join(
                    str(item.get("name") if isinstance(item, dict) else item)
                    for item in s["characters"]
                ))
            if s.get("props"):
                bits.append("props=" + "/".join(
                    str(item.get("name") if isinstance(item, dict) else item)
                    for item in s["props"]
                ))
            shot_type = s.get("shotType")
            if shot_type:
                bits.append(f"type={shot_type}")
            action = s.get("action")
            if action:
                bits.append(f"action={action}")
            if bits:
                out_lines.append("  - " + " | ".join(bits))
        out_lines.append("")

    return "\n".join(out_lines).rstrip() + "\n"


def _scenes_to_markdown(scenes: list[dict], long_text: str, source_kind: str) -> str:
    """把 generate_script 输出的 scenes 列表序列化为 markdown body。

    格式必须兼容前端 TextReader：
    - 一级标题（#）：脚本总名（"分场脚本"）
    - 场景标题：**纯文本** 行（无 markdown 标题前缀），保证
      - 文本行的开头"第N场"能被 stats 正则识别（`^第X场` 在 `^#{1,3}\\s+` 之后不匹配）
      - 场景标题作为段落渲染（ScriptParagraph 走 action 分支）
    - 角色 / 画面 / 对白 用 ### 小标题
    - 对白走 "角色：台词" 格式（与 ScriptParagraph 识别规则一致）
    - 末尾追加 long_text 节选

    关键修复：之前 _scenes_to_markdown 缺失，调用时直接 NameError，
    generate_script 工具的整个 try 块都未执行 → LLM 输出落库失败 →
    memory.artifacts 没有 script 资产 → 后续 extract_* 拿不到引用 →
    反复调 generate_script 直到 max_steps 耗尽 → TASK_FAILED。
    """
    if not scenes:
        # 兜底：LLM 没返回场景时给一个空模板，避免 body 为空导致 TextReader 闪退
        return "# 分场脚本\n\n（暂无场景）\n"

    out: list[str] = ["# 分场脚本", ""]
    for i, scene in enumerate(scenes, 1):
        title = (scene.get("title") or f"场景{i}").strip()
        location = (scene.get("location") or "").strip()
        time = (scene.get("time") or "").strip()
        characters = scene.get("characters") or []
        duration = scene.get("duration_sec")
        description = (scene.get("description") or "").strip()
        dialogue = (scene.get("dialogue") or "").strip()

        # 场景标题：必须以 "第N场" 起头，且不能被任何 markdown 标题前缀
        # 包裹，否则后端 / 前端的 computeTextStats 场景正则
        # (^|\n)\\s*第X场 无法匹配。这是 TextReader 与 stats 共享的事实源。
        out.append(f"第{i}场 · {title}")
        out.append("")

        # 场次元信息
        meta_bits: list[str] = []
        if location:
            meta_bits.append(f"地点：{location}")
        if time:
            meta_bits.append(f"时间：{time}")
        if duration:
            try:
                meta_bits.append(f"时长：{int(duration)}秒")
            except (TypeError, ValueError):
                meta_bits.append(f"时长：{duration}秒")
        if meta_bits:
            out.append(" | ".join(meta_bits))
            out.append("")

        # 角色：作为 h3 罗列
        if characters:
            char_list = [str(c).strip() for c in characters if str(c).strip()]
            if char_list:
                out.append("### 角色")
                out.append("")
                out.append("、".join(char_list))
                out.append("")

        # 动作/画面描述
        if description:
            out.append("### 画面")
            out.append("")
            out.append(description)
            out.append("")

        # 对白：按 "角色：台词" 拆分（多行），无角色名则当动作描写
        if dialogue:
            out.append("### 对白")
            out.append("")
            # 兼容 LLM 用 \n 或实际换行
            lines = dialogue.replace("\\n", "\n").split("\n")
            for line in lines:
                line = line.strip()
                if not line:
                    out.append("")
                    continue
                if "：" in line or ":" in line:
                    out.append(line)
                else:
                    out.append(f"（旁白）{line}")
            out.append("")

    # 末尾附上原始长文本节选（前 800 字），便于 TextReader 在用户编辑时回溯原文
    if long_text and source_kind in {"novel", "long_text"}:
        preview = long_text.strip()
        if len(preview) > 800:
            preview = preview[:800] + "…"
        label = "原文节选（小说）" if source_kind == "novel" else "原文节选（长文本）"
        out.append(f"## {label}")
        out.append("")
        out.append(preview)
        out.append("")

    return "\n".join(out).rstrip() + "\n"


def _compute_text_stats(body: str) -> dict:
    """计算文本统计：字数、章数、场数。

    必须与前端 use-canvas-store.ts 的 computeTextStats 算法保持一致，
    否则后端写入的 text_stats 与前端重新计算的结果不一致，
    TextReader 头部会闪烁/显示不同数字。
    """
    import re

    if not body:
        return {"words": 0, "chapters": 0, "scenes": 0}
    cjk = len([ch for ch in body if "\u4e00" <= ch <= "\u9fff"])
    non_cjk = "".join(" " if "\u4e00" <= ch <= "\u9fff" else ch for ch in body)
    ascii_words = len([w for w in non_cjk.split() if w])
    words = cjk + ascii_words
    chapters = sum(
        1
        for _ in re.finditer(r"^#{1,3}\s+", body, flags=re.MULTILINE)
    )
    scenes = len(
        re.findall(
            r"(^|\n)\s*(第[一二三四五六七八九十百零0-9]+场|场景[一二三四五六七八九十百零0-9]*[：:.\s]|【场\d+】)",
            body,
        )
    )
    return {"words": words, "chapters": chapters, "scenes": scenes}
