"""AgentRuntime：ReAct 主循环。

单步执行流程：
1. think() —— 让 LLM 决定下一步
2. parse_decision() —— 解析 LLM 输出
3. execute_action() —— 执行工具 / 处理 finish_task
4. add_step() —— 记录到 memory
5. emit event —— 通知订阅者
"""
from __future__ import annotations

import asyncio
import json
import re
from enum import Enum
from typing import Any

from .events import AgentEvent, EventType, event_bus
from .llm import build_react_prompt
from .memory import AgentMemory
from .tools.base import (
    BaseTool,
    NonRetryableError,
    RetryableError,
    RetryableTool,
    ToolContext,
    ToolRegistry,
    ToolValidationError,
)
from .media_assets import begin_media_asset, finish_media_asset
from .tools.planning import _coerce_json
from .task_profiles import TaskProfile, classify_task
from .rule_packs import get_rule_pack
from .prompt_engineering import build_prompt_rule_context
from .. import models


class AgentState(str, Enum):
    PENDING = "pending"
    RUNNING = "running"
    PAUSED = "paused"
    DONE = "done"
    FAILED = "failed"
    CANCELLED = "cancelled"


def parse_decision(raw: str) -> dict:
    """从 LLM 文本输出中解析决策 JSON，允许前后存在说明文字。"""
    data = _coerce_json(raw)
    if isinstance(data, dict):
        return data
    text = (raw or "").strip()
    raise ValueError(f"Invalid decision JSON: unable to extract an object\n{text[:200]}")


# ========================
# AgentRuntime
# ========================

class AgentRuntime:
    """ReAct 主循环。"""

    DEFAULT_MAX_STEPS = 30

    def __init__(
        self,
        task_id: str,
        llm: Any,
        memory: AgentMemory,
        registry: ToolRegistry | None = None,
        project_id: str | None = None,
        db: Any | None = None,
        api_config: Any | None = None,
        media_service: Any | None = None,
        max_steps: int = DEFAULT_MAX_STEPS,
        skip_confirm: bool = False,
        pending_request: dict | None = None,
        profile: TaskProfile | None = None,
    ):
        self.task_id = task_id
        self.llm = llm
        self.memory = memory
        self.registry = registry or ToolRegistry()
        self.project_id = project_id
        self.db = db
        self.api_config = api_config
        self.media_service = media_service
        self.max_steps = max_steps
        self.skip_confirm = skip_confirm
        self.pending_request = pending_request
        self.profile = profile
        self.state = AgentState.PENDING
        self._step_count = 0

    # ---------------- 主循环 ----------------

    async def step(self) -> bool:
        """执行一个 ReAct 步。返回 True 表示任务完成。"""
        if self.state in (AgentState.DONE, AgentState.CANCELLED):
            return True
        if self.state == AgentState.PAUSED:
            return False

        self.state = AgentState.RUNNING
        self._step_count += 1

        if self._step_count > self.max_steps:
            await self._emit(EventType.TASK_FAILED, {"error": f"超过最大步数 {self.max_steps}"})
            self.state = AgentState.FAILED
            return True

        # 1. think
        messages = self._build_messages()
        response = await self.llm.generate(messages)

        # stop_task may cancel while the LLM request is in flight. Never execute
        # the stale tool call that arrives after cancellation.
        if self.state == AgentState.CANCELLED:
            return True

        if response.tool_name is None:
            # LLM 没调用工具，按 content 解析为决策
            if not response.content:
                await self._add_failed_step("LLM returned empty response", {})
                return False
            try:
                decision = parse_decision(response.content)
            except ValueError as e:
                await self._add_failed_step(str(e), {})
                return False
            thought = str(decision.get("thought") or "").strip()
            action = decision.get("action") or {}
            if not thought:
                tool = action.get("tool") if isinstance(action, dict) else None
                thought = f"准备执行：{tool}" if tool else "正在分析下一步"
        else:
            thought = "(structured tool call)"
            action = {"tool": response.tool_name, "params": response.tool_args or {}}

        await self._emit(EventType.THOUGHT, {"text": thought, "step": self._step_count})

        # 2. 决策：finish_task / 调工具 / ask_user
        tool_name = action.get("tool", "")
        if self.state == AgentState.CANCELLED:
            return True
        if tool_name == "finish_task":
            # 记录 finish_task 这一步到 memory（与正常 tool 步骤一致，便于持久化）
            self.memory.add_step(
                step_number=self._step_count,
                thought=thought,
                action=action,
                observation={"summary": action.get("params", {})},
                status="success",
                cost_usd=response.cost_usd,
                tokens=response.total_tokens,
            )
            await self._emit(EventType.TASK_DONE, {"summary": action.get("params", {})})
            self.state = AgentState.DONE
            return True

        if tool_name == "ask_user":
            # 暂停等待用户输入
            self.pending_request = {
                "type": "ask_user",
                "question": action.get("params", {}).get("question", ""),
                "options": action.get("params", {}).get("options", []),
            }
            await self._emit(EventType.REQUEST_USER_INPUT, self.pending_request)
            self.state = AgentState.PAUSED
            self.memory.add_step(
                step_number=self._step_count,
                thought=thought,
                action=action,
                observation={"pending": "awaiting_user_input"},
                status="pending",
                cost_usd=response.cost_usd,
                tokens=response.total_tokens,
            )
            return False

        # 3. 执行工具
        # Story media requires a script. Pause before creating canvas
        # placeholders or invoking prompt optimization when it is missing.
        profile = self._selected_task_profile()
        if self._is_media_tool(tool_name) and not self._has_source_for_profile(profile):
            await self._pause_for_script_requirement(thought, response, profile)
            return False

        await self._emit(EventType.ACTION, {
            "tool": tool_name,
            "params": action.get("params", {}),
            "step": self._step_count,
            "requires_approval": self._requires_approval(tool_name),
        })

        tool_params = action.get("params", {})
        media_asset = self._begin_media_asset(tool_name, tool_params)
        media_batch_assets = self._begin_media_batch_assets(tool_params) if tool_name == "generate_media_batch" else []
        if media_asset:
            self.memory.artifacts.setdefault(media_asset["asset_kind"], []).append(media_asset)
            await self._emit(EventType.ARTIFACT_CREATED, media_asset)
        for pending_asset in media_batch_assets:
            self.memory.artifacts.setdefault(pending_asset["asset_kind"], []).append(pending_asset)
            await self._emit(EventType.ARTIFACT_CREATED, pending_asset)

        asset_event = {
            "inspect_asset": (EventType.ASSET_INSPECTION_STARTED, EventType.ASSET_INSPECTION_FINISHED),
            "prepare_character_asset": (EventType.ASSET_NORMALIZATION_STARTED, EventType.ASSET_NORMALIZATION_FINISHED),
        }.get(tool_name)
        if asset_event:
            await self._emit(asset_event[0], {
                "asset_id": tool_params.get("asset_id"),
                "source_asset_id": tool_params.get("source_asset_id"),
                "text": "正在检查上传资产" if tool_name == "inspect_asset" else "正在准备标准化角色资产",
            })
        observation, status = await self._execute_tool(tool_name, tool_params)
        if asset_event:
            result_payload = observation.get("result") if isinstance(observation, dict) else None
            await self._emit(asset_event[1], {
                "asset_id": (result_payload or {}).get("asset_id") if isinstance(result_payload, dict) else tool_params.get("asset_id"),
                "source_asset_id": (result_payload or {}).get("source_asset_id") if isinstance(result_payload, dict) else None,
                "success": status == "success",
                "error": observation.get("error") if isinstance(observation, dict) else None,
                "text": "上传资产检查完成" if tool_name == "inspect_asset" and status == "success" else (
                    "标准化角色资产已创建" if tool_name == "prepare_character_asset" and status == "success" else "资产处理失败"
                ),
            })

        if media_asset:
            result = observation.get("result") if isinstance(observation, dict) else None
            url = result.get("url") if isinstance(result, dict) else None
            error = observation.get("error") if isinstance(observation, dict) and status != "success" else None
            result_prompt = result.get("prompt") if isinstance(result, dict) else None
            updated_asset = finish_media_asset(
                self.db,
                media_asset["id"],
                url=url,
                error=error,
                prompt=result_prompt,
                prompt_source=result.get("source_prompt") if isinstance(result, dict) else None,
                prompt_optimized=result_prompt,
                extra={"continuity": result.get("continuity")} if isinstance(result, dict) and result.get("continuity") is not None else None,
            ) if self.db else {
                **media_asset, "url": url, "failed": bool(error), "error": error, "generating": False,
            }
            bucket = self.memory.artifacts.get(media_asset["asset_kind"], [])
            self.memory.artifacts[media_asset["asset_kind"]] = [
                updated_asset if item.get("id") == media_asset["id"] else item for item in bucket
            ]
            await self._emit(EventType.ARTIFACT_CREATED, updated_asset)

        if media_batch_assets and self.db:
            batch = observation.get("result") if isinstance(observation, dict) else None
            results = (batch or {}).get("results", []) if isinstance(batch, dict) else []
            by_index = {item.get("job_index"): item for item in results if isinstance(item, dict)}
            for pending in media_batch_assets:
                item = by_index.get(pending.get("extra", {}).get("job_index"), {})
                if not isinstance(item, dict):
                    continue
                updated = finish_media_asset(
                    self.db,
                    pending["id"],
                    url=item.get("url"),
                    error=None if item.get("success") else str(item.get("error") or "media generation failed"),
                    prompt=str(item.get("prompt") or ""),
                    prompt_source=str(item.get("source_prompt") or item.get("prompt") or ""),
                    prompt_optimized=str(item.get("prompt") or ""),
                    extra={"continuity": item.get("continuity")} if item.get("continuity") is not None else None,
                )
                asset_kind = pending["asset_kind"]
                bucket = self.memory.artifacts.setdefault(asset_kind, [])
                self.memory.artifacts[asset_kind] = [entry for entry in bucket if entry.get("id") != pending["id"]] + [updated]
                await self._emit(EventType.ARTIFACT_CREATED, updated)

        if tool_name == "save_asset" and status == "success":
            saved_asset = observation.get("result") if isinstance(observation, dict) else None
            if isinstance(saved_asset, dict) and saved_asset.get("id"):
                asset_kind = str(saved_asset.get("asset_kind") or saved_asset.get("kind") or "other")
                bucket = self.memory.artifacts.setdefault(asset_kind, [])
                if not any(isinstance(item, dict) and item.get("id") == saved_asset.get("id") for item in bucket):
                    bucket.append(saved_asset)
                await self._emit(EventType.ARTIFACT_CREATED, saved_asset)

        # 4. 记录 step
        self.memory.add_step(
            step_number=self._step_count,
            thought=thought,
            action=action,
            observation=observation,
            status=status,
            cost_usd=response.cost_usd,
            tokens=response.total_tokens,
        )

        # 5. 通知
        await self._emit(EventType.OBSERVATION, {
            "step": self._step_count,
            "success": status == "success",
            "result": observation.get("result") if status == "success" else None,
            "error": observation.get("error"),
        })

        # bridge: create_plan → memory.plan
        if tool_name == "create_plan" and isinstance(observation, dict) and isinstance(observation.get("result"), list):
            self.memory.plan = observation["result"]
            # Notify connected clients immediately; persistence alone only
            # makes the plan appear after a refresh.
            await self._emit(EventType.PLAN_READY, {"plan": self.memory.plan})

        return False

    @staticmethod
    def _is_media_tool(tool_name: str) -> bool:
        return tool_name in {
            "generate_character_portrait", "generate_prop_image", "generate_scene_image",
            "generate_storyboard_image", "generate_video", "generate_media_batch",
        }

    def _has_script_context(self) -> bool:
        """Return whether this task can derive media prompts from a script."""
        scripts = self.memory.artifacts.get("script", [])
        if any(isinstance(item, dict) and not item.get("failed") for item in scripts):
            return True
        for step in self.memory.short_term:
            if step.status != "success" or not isinstance(step.action, dict):
                continue
            tool_name = step.action.get("tool")
            result = step.observation.get("result") if isinstance(step.observation, dict) else None
            if tool_name == "generate_script" and isinstance(result, dict) and result:
                return True
            if tool_name == "save_asset" and isinstance(result, dict):
                asset_kind = result.get("asset_kind") or result.get("kind")
                if asset_kind == "script":
                    return True
        if self.db and self.project_id:
            try:
                script_asset = (
                    self.db.query(models.Asset)
                    .filter(
                        models.Asset.project_id == self.project_id,
                        models.Asset.asset_kind == "script",
                    )
                    .first()
                )
                if script_asset:
                    return True
            except Exception:
                pass
        return False

    def _selected_task_profile(self) -> TaskProfile:
        profile = self.hydrate_profile()
        source_context = self._answered_source_context(profile)
        if profile.needs_clarification and source_context:
            parsed_goal = dict(self._latest_parsed_goal() or {})
            parsed_goal.update(source_context)
            refreshed = classify_task(
                self.memory.user_goal,
                parsed_goal,
                self._project_asset_context(),
            )
            if refreshed.task_type == profile.task_type:
                self.profile = refreshed
                profile = refreshed
        return profile

    def _answered_source_context(self, profile: TaskProfile) -> dict:
        """Project a completed missing-source answer into current profile state."""
        if profile.task_type not in {"promotion", "commercial", "custom"}:
            return {}
        for step in reversed(self.memory.short_term):
            if step.status != "success" or (step.action or {}).get("tool") != "ask_user":
                continue
            params = (step.action or {}).get("params") or {}
            if not params.get("missing_inputs"):
                continue
            observation = step.observation if isinstance(step.observation, dict) else {}
            user_response = observation.get("user_response")
            if isinstance(user_response, dict):
                source = user_response.get("custom_text") or user_response.get("response")
            else:
                source = user_response
            if source in (None, "", [], {}):
                continue
            if profile.task_type == "promotion":
                return {"brief": source}
            if profile.task_type == "commercial":
                return {"product": source}
            return {"source": source}
        return {}

    def hydrate_profile(self) -> TaskProfile:
        """Return the persisted profile, deriving it once for legacy tasks."""
        if self.profile is None:
            self.profile = classify_task(
                self.memory.user_goal,
                self._latest_parsed_goal(),
                self._project_asset_context(),
            )
        return self.profile

    def _has_source_for_profile(self, profile: TaskProfile) -> bool:
        """Return whether the profile's structured source gate is satisfied."""
        if profile.task_type in {"drama_short", "documentary"}:
            return self._has_script_context()
        if not profile.needs_clarification:
            return True
        return False

    async def _pause_for_script_requirement(self, thought: str, response: Any, profile: TaskProfile | None = None) -> None:
        profile = profile or self._selected_task_profile()
        source_label = {
            "promotion": "promotion brief",
            "commercial": "product brief or product information",
            "custom": "structured source and agreed deliverables",
        }.get(profile.task_type, "complete story script")
        question = {
            "type": "ask_user",
            "step_id": "clarify_source",
            "missing_inputs": list(profile.missing_inputs),
            "question": (
                f"当前缺少可供拆解和生成提示词的{source_label}。"
                f"请提供{source_label}，我会先完成来源确认再生成媒体资产。"
            ),
            "options": ["由 agent 编写脚本"],
            "selection_mode": "text",
            "allow_custom": True,
        }
        self.pending_request = question
        self.memory.add_step(
            step_number=self._step_count,
            thought=thought,
            action={"tool": "ask_user", "params": question},
            observation={"pending": "awaiting_user_input", "reason": "script_required_before_media"},
            status="pending",
            cost_usd=response.cost_usd,
            tokens=response.total_tokens,
        )
        await self._emit(EventType.REQUEST_USER_INPUT, question)
        self.state = AgentState.PAUSED

    def _begin_media_asset(self, tool_name: str, params: dict) -> dict | None:
        """Create a visible canvas asset before a media provider request starts."""
        if not self.db or tool_name not in {
            "generate_character_portrait", "generate_prop_image", "generate_scene_image",
            "generate_storyboard_image", "generate_video",
        }:
            return None
        tool = self.registry.get(tool_name)
        category = getattr(tool, "category", "image")
        asset_kind = {
            "generate_character_portrait": "character",
            "generate_prop_image": "prop",
            "generate_scene_image": "scene",
            "generate_storyboard_image": "storyboard",
            "generate_video": "video",
        }[tool_name]
        source = params.get("character") or params.get("prop") or params.get("scene") or params.get("shot") or {}
        if not isinstance(source, dict):
            source = {"description": str(source)}
        name = source.get("name") or source.get("title") or source.get("index") or asset_kind
        prompt = str(source.get("prompt") or source.get("description") or "")
        if tool_name == "generate_character_portrait":
            from .tools.image_tools import _build_character_prompt
            prompt = _build_character_prompt(source, style=str(params.get("style") or "cinematic"))
        elif tool_name == "generate_prop_image":
            from .tools.image_tools import _build_prop_prompt
            prompt = _build_prop_prompt(source)
        elif tool_name == "generate_scene_image":
            from .tools.image_tools import _build_scene_prompt
            prompt = _build_scene_prompt(source)
        elif tool_name == "generate_storyboard_image":
            from .tools.image_tools import _build_storyboard_prompt
            prompt = _build_storyboard_prompt(source, params.get("scene"), params.get("characters"), params.get("props"))
        elif tool_name == "generate_video":
            from .tools.video_tools import _build_video_prompt
            prompt = _build_video_prompt(source, params.get("reference_asset_ids"))
        bindings = getattr(self.media_service, "capability_bindings", {}) or {}
        binding = bindings.get("video" if category == "video" else "image", {})
        extra = {
            "prompt_source": prompt,
            "prompt_optimized": prompt,
            "reference_asset_ids": list(params.get("reference_asset_ids") or []),
        }
        if tool_name == "generate_video":
            extra["continuity"] = {
                "scene": source.get("scene"),
                "shot": source.get("shot"),
                "characters": params.get("characters") or params.get("character") or [],
            }
        return begin_media_asset(
            self.db,
            project_id=self.project_id,
            kind="video" if category == "video" else "image",
            asset_kind=asset_kind,
            name=str(name),
            prompt=prompt,
            provider_id=binding.get("provider_id"),
            model_id=binding.get("model_id"),
            extra=extra,
        )

    def _begin_media_batch_assets(self, params: dict) -> list[dict]:
        if not self.db:
            return []
        assets: list[dict] = []
        bindings = getattr(self.media_service, "capability_bindings", {}) or {}
        for index, job in enumerate(params.get("jobs") or []):
            if not isinstance(job, dict):
                continue
            kind = str(job.get("kind") or "image")
            asset_kind = str(job.get("asset_kind") or ("video" if kind == "video" else "image"))
            prompt = str(job.get("prompt") or "")
            pending = begin_media_asset(
                self.db,
                project_id=self.project_id,
                kind=kind,
                asset_kind=asset_kind,
                name=str(job.get("name") or asset_kind),
                prompt=prompt,
                model_id=(bindings.get(kind) or {}).get("model_id"),
                extra={"job_index": index, "batch": True},
            )
            assets.append(pending)
        return assets

    async def resume(self, user_response: Any) -> bool:
        """从 PAUSED 恢复，继续执行。

        Spec B: 支持 tool_error 恢复（retry/change_model/skip）和原有 ask_user。
        """
        if self.state != AgentState.PAUSED:
            return False

        req = self.pending_request or {}
        req_type = req.get("type", "ask_user")

        if req_type == "tool_error":
            return await self._resume_from_tool_error(user_response)

        # 原有 ask_user 逻辑：把用户响应作为 observation 注入最近 step
        if self.memory.short_term and self.memory.short_term[-1].status == "pending":
            last = self.memory.short_term[-1]
            last.observation = {"success": True, "user_response": user_response}
            last.status = "success"
        else:
            self.memory.add_step(
                step_number=self._step_count + 1,
                thought="(user input)",
                action={"tool": "ask_user_response"},
                observation={"user_response": user_response},
                status="success",
            )
        self.pending_request = None
        self._selected_task_profile()
        self.state = AgentState.RUNNING
        await self._emit(EventType.USER_INPUT_RECEIVED, {"response": user_response})
        return await self.step()

    # ---------------- 辅助 ----------------

    def _build_messages(self) -> list[dict]:
        """构造发给 LLM 的消息列表。"""
        # 把每个工具的 parameters 也带过去，让 LLM 知道准确的参数名
        # （避免 LLM 自己瞎猜参数名 → 工具 validate 失败 → 进入死循环）
        tool_summaries = []
        for t in self.registry.list():
            params = [
                {
                    "name": p.name,
                    "type": p.type,
                    "description": p.description,
                    "required": bool(getattr(p, "required", True)),
                }
                for p in (t.parameters or [])
            ]
            tool_summaries.append({
                "name": t.name,
                "description": t.description,
                "parameters": params,
            })
        recent = [
            {
                "step_number": s.step_number,
                "thought": s.thought,
                "action": s.action,
                "observation": s.observation,
                "status": s.status,
            }
            for s in self.memory.recent_steps(10)
        ]
        prompt = build_react_prompt(
            user_goal=self.memory.user_goal,
            plan=self.memory.plan,
            artifacts=self.memory.artifacts,
            recent_steps=recent,
            tool_summaries=tool_summaries,
            project_assets=self._project_asset_context(),
        )
        assets = self._project_asset_context()
        parsed_goal = self._latest_parsed_goal()
        profile = self.hydrate_profile()
        rule_context = build_prompt_rule_context(get_rule_pack(profile.rule_pack_id), "agent_planning")
        prompt += (
            "\n\n[SELECTED TASK PROFILE]\n"
            + json.dumps(profile.model_dump(mode="json"), ensure_ascii=False)
            + "\n[RULE PACK SUMMARY]\n"
            + json.dumps(rule_context, ensure_ascii=False)
            + "\nBefore any media tool, ask the user for missing structured source inputs "
            "listed in the profile and wait until they are available."
        )
        return [
            {"role": "system", "content": prompt},
        ]

    def _latest_parsed_goal(self) -> dict | None:
        for step in reversed(self.memory.short_term):
            if not isinstance(step.action, dict) or step.action.get("tool") != "parse_user_goal":
                continue
            result = step.observation.get("result") if isinstance(step.observation, dict) else None
            if isinstance(result, dict):
                return result
        return None

    def _project_asset_context(self) -> list[dict]:
        """Expose only current-project asset identity/status to the planner."""
        if not self.db or not self.project_id:
            return []
        try:
            rows = (
                self.db.query(models.Asset)
                .filter(models.Asset.project_id == self.project_id)
                .order_by(models.Asset.created_at.asc())
                .limit(30)
                .all()
            )
        except Exception:
            # Prompt construction must not make an otherwise valid Agent task fail.
            return []
        return [
            {
                "id": row.id,
                "name": row.name,
                "title": row.title,
                "origin": row.origin,
                "asset_kind": row.asset_kind,
                "kind": row.kind,
                "inspection_status": row.inspection_status,
                "source_asset_id": row.source_asset_id,
            }
            for row in rows
        ]

    def _requires_approval(self, tool_name: str) -> bool:
        tool = self.registry.get(tool_name)
        if not tool:
            return False
        return getattr(tool, "requires_approval", False)

    async def _execute_tool(self, tool_name: str, params: dict) -> tuple[dict, str]:
        """执行工具，返回 (observation, status)。

        Spec B: 用 RetryableTool 包装 BaseTool，实现自动重试 + fallback 降级。
        RetryableError 耗尽后挂起任务（PAUSED）等待用户决策。
        """
        tool = self.registry.get(tool_name)
        if not tool:
            return {"error": f"Unknown tool: {tool_name}"}, "failed"

        ctx = ToolContext(
            task_id=self.task_id,
            project_id=self.project_id,
            db=self.db,
            llm_client=self.llm,
            api_config=self.api_config,
            media_service=self.media_service,
            artifacts=self.memory.artifacts,
            task_profile=self._selected_task_profile(),
            skip_confirm=self.skip_confirm,
            emit=lambda t, p: self._emit_sync(t, p),
        )
        # 用 RetryableTool 包装 BaseTool（自动重试 + fallback）
        media_tools = {
            "generate_character_portrait", "generate_prop_image", "generate_scene_image",
            "generate_storyboard_image", "generate_video", "generate_media_batch",
        }
        wrapped = RetryableTool(tool, max_retries=0) if isinstance(tool, BaseTool) and tool_name in media_tools else (RetryableTool(tool) if isinstance(tool, BaseTool) else tool)
        try:
            result = await wrapped.call(ctx, params)
            return {"success": True, "result": result}, "success"
        except ToolValidationError as e:
            return {"error": str(e)}, "failed"
        except RetryableError as e:
            if tool_name in media_tools:
                recovery = {"success": False, "error": str(e), "worker": "media-recovery"}
                await self._emit(EventType.MEDIA_RECOVERY_STARTED, {
                    "tool": tool_name, "params": params, "worker": "media-recovery",
                })
                try:
                    recovery_result = await RetryableTool(tool, max_retries=0).call(ctx, params)
                    recovery = {"success": True, "result": recovery_result, "worker": "media-recovery"}
                except Exception as recovery_error:
                    recovery = {"success": False, "error": str(recovery_error), "worker": "media-recovery"}
                await self._emit(EventType.MEDIA_RECOVERY_FINISHED, {
                    "tool": tool_name, "success": recovery["success"],
                    "error": recovery.get("error"), "worker": "media-recovery",
                })
                return {"error": str(e), "recovery": recovery}, "failed"
            # 挂起等待用户决策
            self.pending_request = {
                "type": "tool_error",
                "step_id": str(self._step_count),
                "tool": tool_name,
                "error": str(e),
                "params": params,
                "fallback_model_id": getattr(tool, "fallback_model_id", None),
                "available_models": self._list_available_models(tool),
            }
            await self._emit(EventType.TOOL_ERROR, self.pending_request)
            self.state = AgentState.PAUSED
            return {"error": str(e), "pending": "awaiting_user_recovery"}, "paused"
        except NonRetryableError as e:
            return {"error": str(e), "non_retryable": True}, "failed"
        except Exception as e:
            return {"error": str(e), "type": type(e).__name__}, "failed"

    async def _resume_from_tool_error(self, user_response: Any) -> bool:
        """用户对 tool_error 的响应：retry / change_model / skip。

        Spec B: 用户决策后恢复执行。
        - retry: 用原 params 重新执行
        - change_model: 更新 params.model_id 后重新执行
        - skip: 注入 user_skip observation，agent 继续 think
        """
        # 兼容 dict 和裸值
        if isinstance(user_response, dict):
            action = user_response.get("recovery_action", "retry")
            new_model_id = user_response.get("new_model_id")
        else:
            action = "retry"
            new_model_id = None

        step_id = self.pending_request["step_id"]
        tool_name = self.pending_request["tool"]
        params = self.pending_request["params"]
        error_msg = self.pending_request["error"]

        await self._emit(EventType.TOOL_RESUMED, {"step_id": step_id, "action": action})

        if action == "skip":
            # 注入 user_skip observation，step 标 skipped，agent 继续 think
            self.memory.add_step(
                step_number=self._step_count,
                thought="(user skipped)",
                action={"tool": tool_name, "params": params},
                observation={"success": False, "user_skip": True, "error": error_msg},
                status="skipped",
            )
            self.pending_request = None
            self.state = AgentState.RUNNING
            # 与 retry/change_model 一致：仅记录 step 并返回 False，
            # 由调用方决定何时再次推进 step()
            return False

        # retry / change_model → 重新执行该 step
        if action == "change_model" and new_model_id:
            params = {**params, "model_id": new_model_id}

        self.pending_request = None
        self.state = AgentState.RUNNING
        # 重新执行同一步（_step_count 不变）
        observation, status = await self._execute_tool(tool_name, params)
        # 记录 step + emit observation
        self.memory.add_step(
            step_number=self._step_count,
            thought="(retry after user recovery)",
            action={"tool": tool_name, "params": params},
            observation=observation,
            status=status,
        )
        await self._emit(EventType.OBSERVATION, {
            "step": self._step_count,
            "success": status == "success",
            "result": observation.get("result") if status == "success" else None,
            "error": observation.get("error"),
        })
        # 无论成功失败，都返回 False 让主循环继续 think 下一步
        return False

    def _list_available_models(self, tool) -> list[dict]:
        """查询同 category 的可用模型列表（供前端下拉）。

        Spec B: api_config 提供 list_models(category) 方法时返回模型列表，
        否则返回空列表（用户仍可手动输入 model_id）。
        """
        if not self.api_config:
            return []
        category = getattr(tool, "category", "")
        if not hasattr(self.api_config, "list_models"):
            return []
        models = self.api_config.list_models(category)
        return [
            {"id": m.get("id"), "label": m.get("label", m.get("id"))}
            for m in models
        ]

    async def _add_failed_step(self, error: str, action: dict) -> None:
        self.memory.add_step(
            step_number=self._step_count,
            thought="",
            action=action,
            observation={"error": error},
            status="failed",
        )
        # 发射 OBSERVATION 事件，让前端能看到 LLM 输出格式错误的反馈
        # （此前只记录到 memory 不发事件，前端在连续格式错误时看不到任何反馈，
        # agent 看似"卡住"，直到 max_steps 耗尽才收到 TASK_FAILED）
        await self._emit(EventType.OBSERVATION, {
            "step": self._step_count,
            "success": False,
            "result": None,
            "error": error,
        })

    async def _emit(self, event_type: str, payload: dict) -> None:
        event = AgentEvent(
            task_id=self.task_id,
            step_id=str(self._step_count),
            type=event_type,
            payload=payload,
        )
        await event_bus.publish(event)

    def _emit_sync(self, event_type: str, payload: dict) -> None:
        """ToolContext.emit 的同步包装。"""
        try:
            loop = asyncio.get_running_loop()
        except RuntimeError:
            return
        loop.create_task(self._emit(event_type, payload))
