"""Studio 工具：把工作室多 agent 流程包装为 ReAct 工具（编排层合并）。

studio_generate_shot   — 编剧→美术→质检三角闭环（run_studio_shot）
studio_generate_episode — 导演拆镜头→逐镜头过审→整集 mp4（run_studio_episode）

包装后 studio 流程自动获得：SSE 事件可见性（studio_step）、取消语义
（runtime cancel 沿 provider await 链传播）、任务持久化（AgentStep 落库）。
studio 内部的确定性 for 循环保持不变——那是它稳定的原因。
"""
from __future__ import annotations

from .base import BaseTool, ToolContext, ToolParameter

_ROLE_LABELS = {
    "screenwriter": "编剧",
    "artist": "美术",
    "critic": "质检",
    "director": "导演",
}


def _resolve_image_binding(ctx: ToolContext, params: dict) -> tuple[str, str]:
    """解析图像供应商/模型：参数显式覆盖 > capability binding。"""
    provider_id = params.get("image_provider_id")
    model_id = params.get("image_model")
    if provider_id and model_id:
        return provider_id, model_id
    bindings = getattr(ctx.media_service, "capability_bindings", None) or {}
    binding = bindings.get("image") or {}
    provider_id = provider_id or binding.get("provider_id")
    # studio 生成带参考图（角色卡 i2i），优先 ref_model_id（与 media_service 一致）
    model_id = model_id or binding.get("ref_model_id") or binding.get("model_id")
    if not provider_id or not model_id:
        raise ValueError("image capability binding is not configured")
    return provider_id, model_id


class StudioGenerateShotTool(BaseTool):
    """单镜头三角闭环：编剧写 prompt → 美术生成 → 质检过审（≤max_rounds 轮）。"""

    name = "studio_generate_shot"
    description = (
        "用工作室三角闭环生成一个过审镜头：编剧把 brief 写成生成 prompt，美术生成，"
        "质检按镜头级标准 + 角色卡一致性检查，不合格带反馈重来（最多 max_rounds 轮）。"
        "交人审的状态：approved / max_rounds_exceeded / check_error。"
    )
    category = "studio"
    requires_approval = True
    estimated_cost_usd = 0.15
    estimated_time_sec = 120.0
    idempotent = False
    parameters = [
        ToolParameter(name="brief", type="string", description="镜头 brief（中文描述镜头内容）", required=True),
        ToolParameter(name="character_card_ids", type="array", description="可选：一致性锁定的角色卡 id 列表", required=False),
        ToolParameter(name="max_rounds", type="number", description="最多闭环轮次（1-5，默认 3）", required=False),
        ToolParameter(name="image_provider_id", type="string", description="可选：覆盖图像供应商", required=False),
        ToolParameter(name="image_model", type="string", description="可选：覆盖图像模型", required=False),
    ]

    async def validate(self, ctx: ToolContext, params: dict) -> str | None:
        if not str(params.get("brief") or "").strip():
            return "brief 不能为空"
        return None

    async def execute(self, ctx: ToolContext, params: dict) -> dict:
        if not ctx.db or not ctx.project_id:
            raise ValueError("studio_generate_shot requires a project-scoped database context")
        from ..studio import run_studio_shot

        provider_id, model_id = _resolve_image_binding(ctx, params)
        result = await run_studio_shot(
            ctx.db,
            project_id=ctx.project_id,
            brief=str(params["brief"]),
            image_provider_id=provider_id,
            image_model=model_id,
            max_rounds=int(params.get("max_rounds") or 3),
            character_card_ids=list(params.get("character_card_ids") or []) or None,
        )
        # trace → studio_step 事件（闭环是同步的，步骤在完成后统一回放）
        for step in result.trace:
            ctx.emit_event("studio_step", {
                "role": _ROLE_LABELS.get(step.role, step.role),
                "action": step.action,
                "summary": step.summary,
                "round": step.round,
                "tool": self.name,
            })
        return {
            "status": result.status,
            "asset_id": result.asset_id,
            "url": result.url,
            "rounds": result.rounds,
            "kind": "studio_shot",
        }


class StudioGenerateEpisodeTool(BaseTool):
    """整集编排：导演拆镜头 → 逐镜头三角闭环 → 合成 mp4。"""

    name = "studio_generate_episode"
    description = (
        "一段故事生成整集短片：导演把故事拆成 3-8 个镜头，逐镜头跑三角闭环过审，"
        "最后合成 mp4 并登记为项目资产。进度通过 studio_step 事件实时可见。"
    )
    category = "studio"
    requires_approval = True
    estimated_cost_usd = 1.0
    estimated_time_sec = 600.0
    idempotent = False
    parameters = [
        ToolParameter(name="story_text", type="string", description="故事文本（导演据此拆镜头）", required=True),
        ToolParameter(name="max_shots", type="number", description="最多镜头数（默认 5）", required=False),
        ToolParameter(name="sec_per_image", type="number", description="每镜头秒数（默认 3）", required=False),
        ToolParameter(name="character_card_ids", type="array", description="可选：一致性锁定的角色卡 id 列表", required=False),
        ToolParameter(name="title", type="string", description="可选：成片标题", required=False),
        ToolParameter(name="image_provider_id", type="string", description="可选：覆盖图像供应商", required=False),
        ToolParameter(name="image_model", type="string", description="可选：覆盖图像模型", required=False),
    ]

    async def validate(self, ctx: ToolContext, params: dict) -> str | None:
        if not str(params.get("story_text") or "").strip():
            return "story_text 不能为空"
        return None

    async def execute(self, ctx: ToolContext, params: dict) -> dict:
        if not ctx.db or not ctx.project_id:
            raise ValueError("studio_generate_episode requires a project-scoped database context")
        from ..director import run_studio_episode

        provider_id, model_id = _resolve_image_binding(ctx, params)

        def on_progress(progress: dict) -> None:
            phase = progress.get("phase")
            current = progress.get("current_shot", 0)
            total = progress.get("total_shots", 0)
            ctx.emit_event("studio_step", {
                "role": "导演",
                "action": phase,
                "summary": f"{phase}（{current}/{total}）" if total else str(phase),
                "phase": phase,
                "current_shot": current,
                "total_shots": total,
                "shots": progress.get("shots") or [],
                "tool": self.name,
            })

        result = await run_studio_episode(
            ctx.db,
            project_id=ctx.project_id,
            story_text=str(params["story_text"]),
            image_provider_id=provider_id,
            image_model=model_id,
            max_shots=int(params.get("max_shots") or 5),
            sec_per_image=float(params.get("sec_per_image") or 3.0),
            character_card_ids=list(params.get("character_card_ids") or []) or None,
            title=str(params.get("title") or ""),
            on_progress=on_progress,
        )
        return {
            "status": result.get("status"),
            "url": result.get("url"),
            "asset_id": result.get("asset_id"),
            "shots": result.get("shots") or [],
            "kind": "studio_episode",
        }
