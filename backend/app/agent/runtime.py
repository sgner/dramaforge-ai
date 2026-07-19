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
import logging
import re
from enum import Enum

logger = logging.getLogger(__name__)
from typing import Any

from .events import AgentEvent, EventType, event_bus
from .llm import build_react_prompt
from .llm import LLMError as _LLMError
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
from .task_profiles import (
    TaskProfile,
    classify_task,
    is_deliverables_question,
    parse_user_deliverable_answer,
)
from .user_messages import missing_source_question
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


# 鉴权类错误关键字：这类错误（401/403/invalid api key）重试无意义
# （client 层对 4xx 也不重试），命中后跳过自动重试直接暂停。
_AUTH_ERROR_MARKERS = (
    "401", "403", "unauthorized", "forbidden",
    "invalid api key", "invalid_api_key", "incorrect api key",
    "authentication", "api key",
)


def _is_auth_llm_error(err: str) -> bool:
    """判断 LLM 错误是否属于鉴权/配置类（自动重试无意义）。"""
    text = (err or "").lower()
    return any(marker in text for marker in _AUTH_ERROR_MARKERS)


def _err_brief(err: str, limit: int = 120) -> str:
    """截断错误摘要，保证事件 payload 紧凑。"""
    text = (err or "").strip().replace("\n", " ")
    return text[:limit]


def parse_decision(raw: str) -> dict:
    """从 LLM 文本输出中解析决策 JSON，允许前后存在说明文字。"""
    data = _coerce_json(raw)
    if isinstance(data, dict):
        return data
    text = (raw or "").strip()
    raise ValueError(f"Invalid decision JSON: unable to extract an object\n{text[:200]}")


# ========================
# 资产完成度校验
# ========================

# deliverables 名字（来自 TaskProfile）到 artifacts asset_kind 的归一化映射。
# 例如 promotional_video / commercial_video 都归一到 "video"，因为媒体工具
# 实际写入 artifacts 时用的 asset_kind 是 "video"。
_DELIVERABLE_ASSET_KIND_MAP: dict[str, str] = {
    "script": "script",
    "commercial_script": "script",
    "storyboard": "storyboard",
    "video": "video",
    "promotional_video": "video",
    "commercial_video": "video",
    "research_summary": "research_summary",
    "campaign_brief": "campaign_brief",
    "agreed_deliverables": "agreed_deliverables",
}

_MEDIA_TOOL_NAMES = {
    "generate_character_portrait", "generate_prop_image", "generate_scene_image",
    "generate_storyboard_image", "generate_video", "generate_media_batch",
}


def compute_assets_summary(artifacts: dict[str, list[dict]]) -> dict[str, int]:
    """统计 memory.artifacts 中每个 asset_kind 的可用资产数量。

    artifacts 的键已经是 asset_kind（如 "script"/"character"/"scene"）。
    统计时排除 failed / generating 状态的条目，确保只反映"真实可用"的资产。
    文本和脚本同样作为一类资产统计（asset_kind="script" 或 "text" 等）。
    """
    summary: dict[str, int] = {}
    for kind, items in (artifacts or {}).items():
        if not isinstance(items, list):
            continue
        count = sum(
            1
            for item in items
            if isinstance(item, dict)
            and not item.get("failed")
            and not item.get("generating")
        )
        if count > 0:
            summary[kind] = count
    return summary


def compute_missing_deliverables(summary: dict[str, int], deliverables: list[str]) -> list[str]:
    """对照 TaskProfile.deliverables 找出尚未生成的交付物。

    deliverables 中的名字（如 "promotional_video"）和 artifacts 的 asset_kind
    （如 "video"）可能不一致，通过 _DELIVERABLE_ASSET_KIND_MAP 归一化后再比较。
    """
    missing: list[str] = []
    for deliverable in deliverables or []:
        asset_kind = _DELIVERABLE_ASSET_KIND_MAP.get(deliverable, deliverable)
        if summary.get(asset_kind, 0) == 0:
            missing.append(deliverable)
    return missing


# ========================
# AgentRuntime
# ========================

class AgentRuntime:
    """ReAct 主循环。"""

    DEFAULT_MAX_STEPS = 30
    # 连续 LLM 输出解析失败（空响应 / 非法 JSON）熔断阈值：
    # 第一次达到时注入格式提示自我纠正并重置计数；同一任务第二次达到
    # 才把任务置 PAUSED 等用户介入，而不是一路烧到 max_steps。
    MAX_CONSECUTIVE_PARSE_FAILURES = 3
    # LLM 调用失败自动重试退避（秒）：初次失败后依次等 2s/5s/10s 再试，
    # 全部失败才暂停。测试里通过 monkeypatch asyncio.sleep 避免真实等待。
    LLM_AUTO_RETRY_BACKOFF = (2, 5, 10)
    # 非媒体工具同一工具连续失败达到该次数才暂停等用户决策；
    # 未达到时失败作为 observation 返回，让 agent 自我纠正。
    TOOL_FAILURE_PAUSE_THRESHOLD = 3

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
        self._consecutive_parse_failures = 0
        # 解析熔断是否已触发过一次（第一次触发注入提示自动恢复，
        # 第二次触发才暂停）。resume/重建后保守视为未触发。
        self._parse_breaker_tripped = False
        # 非媒体工具连续失败跟踪：同一工具连续失败达到阈值才暂停。
        self._last_failed_tool: str | None = None
        self._tool_failure_streak = 0

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
            # 最大步数是单轮保护，不是任务失败。扩展一个新的检查点窗口，
            # 让 agent 可以根据已记录的失败观察继续自我纠正。
            previous_limit = self.max_steps
            self.max_steps += self.DEFAULT_MAX_STEPS
            await self._emit_notice(
                "warning",
                f"本轮执行步数达到 {previous_limit}，已自动开启下一轮并保留当前进度",
                source="runtime",
            )
            return False

        # 1. think（LLM 调用失败时自动重试，重试耗尽才暂停，见 _call_llm_with_retry）
        messages = self._build_messages()
        response = await self._call_llm_with_retry(messages)
        if self.state == AgentState.CANCELLED:
            return True
        if response is None:
            # LLM 重试耗尽 / 鉴权错误：_call_llm_with_retry 已完成暂停流程
            return False

        # stop_task may cancel while the LLM request is in flight. Never execute
        # the stale tool call that arrives after cancellation.
        if self.state == AgentState.CANCELLED:
            return True

        if response.tool_name is None:
            # LLM 没调用工具，按 content 解析为决策
            if not response.content:
                await self._handle_parse_failure("LLM returned empty response")
                return False
            try:
                decision = parse_decision(response.content)
            except ValueError as e:
                await self._handle_parse_failure(str(e))
                return False
            thought = str(decision.get("thought") or "").strip()
            action = decision.get("action") or {}
            if not thought:
                tool = action.get("tool") if isinstance(action, dict) else None
                thought = f"准备执行：{tool}" if tool else "正在分析下一步"
        else:
            thought = "(structured tool call)"
            action = {"tool": response.tool_name, "params": response.tool_args or {}}

        # 本步成功拿到可执行决策（文本解析成功或结构化 tool call），
        # 重置连续解析失败计数（只统计"连续"失败，中间有成功即清零）。
        self._consecutive_parse_failures = 0

        await self._emit(EventType.THOUGHT, {"text": thought, "step": self._step_count})

        # 2. 决策：finish_task / 调工具 / ask_user
        tool_name = action.get("tool", "")
        if self.state == AgentState.CANCELLED:
            return True
        if tool_name == "finish_task":
            # 资产完成度校验：防止 agent 仅生成文本就假完成。
            # 统计 memory.artifacts 中真实可用的资产，对照 TaskProfile.deliverables
            # 找出缺失项，一并放入 TASK_DONE payload 供前端展示。
            profile = self.hydrate_profile()
            deliverables = list(profile.deliverables) if profile else []
            assets_summary = compute_assets_summary(self.memory.artifacts)
            missing_deliverables = compute_missing_deliverables(assets_summary, deliverables)
            finish_params = action.get("params", {}) or {}
            task_done_payload = {
                "summary": finish_params,
                "assets_summary": assets_summary,
                "deliverables": deliverables,
                "missing_deliverables": missing_deliverables,
                "total_assets": sum(assets_summary.values()),
                "incomplete": bool(missing_deliverables),
            }
            # 记录 finish_task 这一步到 memory（与正常 tool 步骤一致，便于持久化）
            self.memory.add_step(
                step_number=self._step_count,
                thought=thought,
                action=action,
                observation={
                    "summary": finish_params,
                    "assets_summary": assets_summary,
                    "deliverables": deliverables,
                    "missing_deliverables": missing_deliverables,
                },
                status="success",
                cost_usd=response.cost_usd,
                tokens=response.total_tokens,
            )
            await self._emit(EventType.TASK_DONE, task_done_payload)
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

        tool_params = action.get("params", {})
        if tool_name == "generate_script":
            tool_params = self._prepare_generate_script_params(tool_params)

        await self._emit(EventType.ACTION, {
            "tool": tool_name,
            "params": tool_params,
            "step": self._step_count,
            "requires_approval": self._requires_approval(tool_name),
        })

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
            dev_fallback = bool(result.get("dev_fallback")) if isinstance(result, dict) else False
            updated_asset = finish_media_asset(
                self.db,
                media_asset["id"],
                url=url,
                error=error,
                prompt=result_prompt,
                prompt_source=result.get("source_prompt") if isinstance(result, dict) else None,
                prompt_optimized=result_prompt,
                extra={k: v for k, v in {
                    "continuity": result.get("continuity") if isinstance(result, dict) else None,
                    "reference_asset_ids": result.get("reference_asset_ids") if isinstance(result, dict) else None,
                }.items() if v},
                dev_fallback=dev_fallback,
            ) if self.db else {
                **media_asset, "url": url,
                "failed": bool(error) or dev_fallback,
                "error": error or ("dev fallback: upstream provider returned a placeholder URL" if dev_fallback else None),
                "dev_fallback": dev_fallback,
                "generating": False,
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
                    extra={k: v for k, v in {
                        "continuity": item.get("continuity"),
                        "reference_asset_ids": item.get("reference_asset_ids"),
                    }.items() if v},
                    dev_fallback=bool(item.get("dev_fallback")),
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
        await self._emit(EventType.OBSERVATION, self._observation_event_payload(
            observation,
            status,
            self._step_count,
        ))

        # bridge: create_plan → memory.plan
        if tool_name == "create_plan" and isinstance(observation, dict) and isinstance(observation.get("result"), list):
            self.memory.plan = observation["result"]
            # Notify connected clients immediately; persistence alone only
            # makes the plan appear after a refresh.
            await self._emit(EventType.PLAN_READY, {"plan": self.memory.plan})

        return False

    async def _call_llm_with_retry(self, messages: list[dict]):
        """调用 LLM，失败时按 LLM_AUTO_RETRY_BACKOFF 自动重试。

        返回 LLMResponse；以下情况返回 None（调用方据此结束本步）：
        - 重试全部耗尽：记 failed step + OBSERVATION + TASK_PAUSED，切 PAUSED
          （保留原有暂停语义：任务不丢进度，修复配置后 /resume 接着跑）；
        - 鉴权类错误（401/403/invalid api key）：重试无意义，直接走同一暂停流程；
        - 退避期间任务被取消：不做任何暂停处理，由上层取消逻辑接管。

        每次重试前发 agent_notice（warning），最终失败发 agent_notice（error），
        让前端/agent 都能感知"系统在自动恢复"而不是无声卡住。
        """
        max_retries = len(self.LLM_AUTO_RETRY_BACKOFF)
        last_err = ""
        is_auth = False
        for attempt in range(max_retries + 1):
            try:
                return await self.llm.generate(messages)
            except _LLMError as e:
                last_err = str(e) or "LLM call failed with empty message"
                is_auth = _is_auth_llm_error(last_err)
                if is_auth:
                    logger.warning(
                        "[agent] step %s LLM auth/config error, skip auto-retry: %s",
                        self._step_count, last_err,
                    )
                    break
                if attempt < max_retries:
                    logger.warning(
                        "[agent] step %s LLM call failed (auto-retry %s/%s): %s",
                        self._step_count, attempt + 1, max_retries, last_err,
                    )
                    await self._emit_notice(
                        "warning",
                        f"LLM 调用失败（{_err_brief(last_err)}），正在自动重试"
                        f"（第 {attempt + 1}/{max_retries} 次）…",
                        source="llm",
                    )
                    await asyncio.sleep(self.LLM_AUTO_RETRY_BACKOFF[attempt])
                    # stop_task 可能在退避期间取消任务，不再继续重试/暂停
                    if self.state == AgentState.CANCELLED:
                        return None

        # 重试耗尽 / 鉴权错误：记 failed step 写进 memory + emit OBSERVATION
        # 让用户看到根因；然后切到 PAUSED，loop 看到 PAUSED 自然退出，
        # task 状态回滚 paused（保留 memory / steps），修复后 /resume 接着跑。
        err = last_err
        logger.warning(
            "[agent] step %s LLM call failed after %s auto-retries: %s (provider=%s, model=%s)",
            self._step_count, max_retries, err, getattr(self.llm, 'provider_id', '?'),
            getattr(self.llm, 'model', '?'),
        )
        await self._add_failed_step(
            error=f"LLM call failed: {err}",
            action={"tool": "_llm_call", "params": {}},
        )
        if is_auth:
            await self._emit_notice(
                "error",
                f"LLM 鉴权失败（{_err_brief(err)}），任务已暂停，请检查 API 配置后恢复",
                source="llm",
            )
        else:
            await self._emit_notice(
                "error",
                f"LLM 调用连续失败，已自动重试 {max_retries} 次仍不成功，任务已暂停，可稍后恢复",
                source="llm",
            )
        # 关键：必须显式发 TASK_PAUSED，否则前端 useAgentStore.status 会一直
        # 停留在 'running'。_run_runtime_loop 只更新 DB 状态，不发事件。
        await self._emit(EventType.TASK_PAUSED, {
            "reason": "llm_call_failed",
            "error": err,
        })
        self.state = AgentState.PAUSED
        return None

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
        # 关键修复：用户已经回答过"要哪些交付物"，必须投影到 profile。
        # 之前的逻辑只投影"structured source"（脚本正文），对"deliverables selection"
        # 这类问题完全没处理 → needs_clarification 一直为 True → agent 反复询问同一问题。
        source_context = self._answered_source_context(profile)
        deliverables_context = self._answered_deliverables_context(profile)
        # 关键：保留当前 profile 已有的 user_confirmed_deliverables。
        # DB 持久化恢复后，profile 已经有确认值；如果 classify_task 重新跑（不带该字段），
        # 会把确认值丢掉，再走老路 needs_clarification=True → 再次询问。
        existing_confirmed = list(profile.user_confirmed_deliverables or [])
        existing_excluded = list(profile.user_excluded_deliverables or [])
        # 合并 source + deliverables：用户可能在两轮分别回答了不同类型的问题
        if source_context or deliverables_context or existing_confirmed:
            parsed_goal = dict(self._latest_parsed_goal() or {})
            parsed_goal.update(source_context)
            parsed_goal.update(deliverables_context)
            # 显式把确认值塞给 classify_task（虽然它不读，但保持数据流一致）
            if existing_confirmed:
                parsed_goal["user_confirmed_deliverables"] = existing_confirmed
            refreshed = classify_task(
                self.memory.user_goal,
                parsed_goal,
                self._project_asset_context(),
            )
            # 关键：re-classify 会丢失 user_confirmed_deliverables，需要手动重建。
            # 优先级：最新回答（deliverables_context）> 已有确认（existing_confirmed）
            new_confirmed = (
                deliverables_context.get("user_confirmed_deliverables")
                or existing_confirmed
            )
            if new_confirmed:
                self.profile = refreshed.with_user_confirmed(
                    new_confirmed,
                    existing_excluded,
                )
                profile = self.profile
            elif refreshed.task_type == profile.task_type:
                # 没有 confirmed 改动时，仅当 task_type 一致才采用 refreshed
                # （避免莫名切换 task_type 后 missing_inputs 抖动）
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

    def _answered_deliverables_context(self, profile: TaskProfile) -> dict:
        """检测用户是否已回答了"要哪些交付物"。

        关键修复：原先依赖 is_deliverables_question(question) 过滤——但 LLM 经常
        自由发挥提问（"你想基于'xxx'这个主题创作什么？请告诉我更多细节"），
        问题文本不包含 deliverable 关键词，导致用户明明回答了
        "我只要场景概念图和角色图"也被忽略，user_confirmed_deliverables
        永远不写入 → agent 又问"要哪些交付物"。

        新策略：优先用 parse_user_deliverable_answer(answer) 解析——
        只要能解析出非空 deliverable 列表（说明用户回答中确实点名了某些资产），
        就采用。这避免了"question 文本不标准 → 答案被丢弃"的误判。
        但仍保留 is_deliverables_question 的过滤，避免把"2分钟"/"奇幻风格"
        这类纯描述性回答误识别为 deliverable。
        """
        if profile.task_type not in {"custom", "drama_short", "documentary", "promotion", "commercial"}:
            return {}
        for step in reversed(self.memory.short_term):
            if step.status != "success" or (step.action or {}).get("tool") != "ask_user":
                continue
            params = (step.action or {}).get("params") or {}
            question = params.get("question", "")
            observation = step.observation if isinstance(step.observation, dict) else {}
            user_response = observation.get("user_response")
            if isinstance(user_response, dict):
                answer = user_response.get("response") or user_response.get("custom_text")
            else:
                answer = user_response
            if not answer or not str(answer).strip():
                continue
            # 用 parse_user_deliverable_answer 解析——这是关键。
            # 即使 question 文本不是标准"哪些交付物"格式，只要答案中
            # 提到 character/scene/prop/storyboard/script/video/audio
            # 等关键词，就当作已确认的 deliverable。
            confirmed = parse_user_deliverable_answer(answer)
            if not confirmed:
                # 答案没有 deliverable 关键词 → 可能是其它类型回答
                # （如时长/风格/角色数量）。如果 question 明确是 deliverable
                # 问题但回答是"全部/所有"，parse_user_deliverable_answer
                # 会返回空 list —— 这种情况下不需要再处理（让 agent 走全流程）。
                continue
            # 命中 deliverable 答案：
            # - question 包含 deliverable 关键词 → 直接采用
            # - question 不包含 deliverable 关键词但答案明确提到资产 →
            #   也采用（解决 LLM 自由提问场景下的丢答案问题）
            return {"source": str(answer or ""), "user_confirmed_deliverables": confirmed}
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
        # 关键：用户已确认 deliverables → gate 永远通过，不再弹澄清。
        # 这是修复"agent 反复询问要哪些交付物"死循环的核心。
        if profile.user_confirmed_deliverables:
            return True
        if profile.task_type in {"drama_short", "documentary"}:
            return self._has_script_context()
        # custom 任务：如果 deliverables 只含媒体资产（character/scene/prop/storyboard）
        # 且不含 script/video，说明是单一资产生成任务，不需要 structured source。
        # 这让"给我画一个角色图"这类非线性任务能直接调用 generate_* 工具。
        if profile.task_type == "custom":
            media_only_deliverables = {"character", "scene", "prop", "storyboard"}
            if profile.deliverables and all(
                d in media_only_deliverables for d in profile.deliverables
            ):
                return True
        if not profile.needs_clarification:
            return True
        return False

    async def _pause_for_script_requirement(self, thought: str, response: Any, profile: TaskProfile | None = None) -> None:
        profile = profile or self._selected_task_profile()
        copy = missing_source_question(profile.task_type, profile.language)
        question = {
            "type": "ask_user",
            "step_id": "clarify_source",
            "missing_inputs": list(profile.missing_inputs),
            "question": copy["question"],
            "options": copy["options"],
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
        # 强制使用结构化构建函数生成 prompt，拒绝 LLM 在 character/prop/scene 对象中
        # 塞入的 prompt/description 原文（此前 LLM 会把 thought 文本塞进 description，
        # 导致 thought 被当作生成提示词写入 Asset 节点浮窗）。
        # 只有结构化字段（name/age/gender/appearance/personality 等）会被采用。
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
        else:
            prompt = str(source.get("name") or source.get("title") or asset_kind)
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

    async def continue_conversation(self, user_message: str) -> bool:
        """从 DONE 状态恢复，注入用户追加需求并继续 ReAct 循环。

        多轮对话入口：任务完成后用户不满意或想追加要求时调用。
        会先压缩上一轮的早期步骤（控制 token 预算），再把新消息
        作为新的 step 注入，状态转为 RUNNING。
        """
        if self.state != AgentState.DONE:
            return False
        if not user_message or not user_message.strip():
            return False

        # 1. 压缩早期步骤（如果步数超过阈值）
        compress_threshold = 15
        if self.memory.should_compress(threshold=compress_threshold):
            await self._compress_conversation_memory(
                turn=len(self.memory.conversation_turns) + 1,
                user_message=user_message,
                keep_recent=10,
            )

        # 2. 追加用户目标（保留原始 goal，追加后续需求）
        self.memory.user_goal = (
            f"{self.memory.user_goal}\n\n[用户追加] {user_message.strip()}"
        )

        # 3. 注入新 step：标记用户追加需求
        self._step_count += 1
        self.memory.add_step(
            step_number=self._step_count,
            thought="(用户追加需求，继续对话)",
            action={"tool": "user_followup", "params": {"message": user_message.strip()}},
            observation={"awaiting_agent_response": True, "user_message": user_message.strip()},
            status="success",
        )

        # 4. 状态转为 RUNNING，通知前端
        self.state = AgentState.RUNNING
        await self._emit(EventType.CONVERSATION_CONTINUED, {
            "user_message": user_message.strip(),
            "turn": len(self.memory.conversation_turns) + 1,
            "compressed": bool(self.memory.compressed_summary),
        })
        return await self.step()

    async def _compress_conversation_memory(
        self,
        turn: int,
        user_message: str,
        keep_recent: int = 10,
    ) -> None:
        """压缩早期步骤为摘要，控制 prompt token 预算。

        把 short_term 中除最近 keep_recent 步之外的早期步骤喂给 LLM
        生成摘要，存入 memory.compressed_summary 和 conversation_turns，
        然后删除被压缩的早期 steps。
        """
        from .llm import build_compression_prompt

        if len(self.memory.short_term) <= keep_recent:
            return

        steps_to_compress = [s.to_dict() for s in self.memory.short_term[:-keep_recent]]
        step_range = [
            steps_to_compress[0]["step_number"],
            steps_to_compress[-1]["step_number"],
        ]

        # 调 LLM 生成摘要
        messages = build_compression_prompt(
            user_goal=self.memory.user_goal,
            steps_to_compress=steps_to_compress,
            artifacts=self.memory.artifacts,
        )
        try:
            response = await self.llm.generate(messages)
            summary = (response.content or "").strip()
            if not summary:
                summary = f"（压缩失败：LLM 返回空内容，原始步骤 #{step_range[0]}-#{step_range[1]}）"
        except Exception as e:  # noqa: BLE001
            summary = f"（压缩异常：{e}，原始步骤 #{step_range[0]}-#{step_range[1]}）"

        # 合并已有摘要（多轮压缩时累积）
        if self.memory.compressed_summary:
            self.memory.compressed_summary = (
                f"{self.memory.compressed_summary}\n\n{summary}"
            )
        else:
            self.memory.compressed_summary = summary

        # 记录这一轮对话
        self.memory.add_conversation_turn(
            turn=turn,
            user_message=user_message,
            agent_summary=summary,
            step_range=step_range,
        )

        # 删除被压缩的早期 steps。
        # 不变量：保留的 StepRecord 必须保持原 step_number（不重排、不重置
        # _step_count），否则 _persist_steps 按 step_number 对齐落库时会与
        # DB 已有行错位/冲突。
        self.memory.short_term = self.memory.short_term[-keep_recent:]

        await self._emit(EventType.MEMORY_COMPRESSED, {
            "turn": turn,
            "step_range": step_range,
            "compressed_count": len(steps_to_compress),
            "summary_length": len(summary),
        })

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
            compressed_summary=self.memory.compressed_summary,
            conversation_turns=self.memory.conversation_turns,
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

    def _prepare_generate_script_params(self, params: dict) -> dict:
        """在脚本工具边界恢复已扩写素材，避免梗概覆盖完整故事。"""
        current = dict(params or {})
        expanded = self._latest_expanded_story()
        if expanded:
            current["source_text"] = expanded
            current["long_text"] = expanded
            current["source_kind"] = "novel"
            current["source_maturity"] = "long_form_source"
            current.pop("novel_text", None)
            return current
        parsed_goal = self._latest_parsed_goal() or {}
        source_text = str(parsed_goal.get("source_text") or "").strip()
        if source_text:
            current["source_text"] = source_text
            current["long_text"] = source_text
            current["source_maturity"] = parsed_goal.get("source_maturity") or "synopsis"
            current.pop("novel_text", None)
        return current

    def _latest_expanded_story(self) -> str:
        """Return the latest successful expand_story result from Agent memory."""
        for step in reversed(self.memory.short_term):
            action = step.action if isinstance(step.action, dict) else {}
            if action.get("tool") != "expand_story" or step.status != "success":
                continue
            observation = step.observation if isinstance(step.observation, dict) else {}
            result = observation.get("result") if isinstance(observation, dict) else None
            if isinstance(result, dict):
                text = str(result.get("long_text") or result.get("source_text") or "").strip()
                if text:
                    return text
        return ""

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
        media_tools = _MEDIA_TOOL_NAMES
        wrapped = RetryableTool(tool) if isinstance(tool, BaseTool) else tool
        try:
            result = await wrapped.call(ctx, params)
            if tool_name in media_tools:
                media_error = self._media_result_error(tool_name, result)
                if media_error:
                    return await self._pause_for_media_failure(tool_name, params, media_error)
            # 成功一次即清零连续失败计数（只统计"连续"失败）
            self._last_failed_tool = None
            self._tool_failure_streak = 0
            return {"success": True, "result": result}, "success"
        except ToolValidationError as e:
            return {"error": str(e)}, "failed"
        except RetryableError as e:
            if tool_name in media_tools:
                await self._emit(EventType.MEDIA_RECOVERY_STARTED, {
                    "tool": tool_name, "params": params, "worker": "media-recovery",
                    "retry_exhausted": True,
                })
                await self._emit(EventType.MEDIA_RECOVERY_FINISHED, {
                    "tool": tool_name, "success": False,
                    "error": str(e), "worker": "media-recovery",
                    "retry_exhausted": True,
                })
                return await self._pause_for_media_failure(tool_name, params, str(e))
            # 非媒体工具：先让 agent 自我纠正——失败作为 observation 返回，
            # agent 下一步 think 时可以换方案/换参数，而不是一次失败就暂停。
            # 防死循环：同一工具连续失败达到 TOOL_FAILURE_PAUSE_THRESHOLD 才
            # 挂起等用户决策（retry/change_model/skip）。
            if self._last_failed_tool == tool_name:
                self._tool_failure_streak += 1
            else:
                self._last_failed_tool = tool_name
                self._tool_failure_streak = 1
            if self._tool_failure_streak < self.TOOL_FAILURE_PAUSE_THRESHOLD:
                logger.warning(
                    "[agent] task %s tool %s failed (%s/%s consecutive), agent will self-correct: %s",
                    self.task_id, tool_name, self._tool_failure_streak,
                    self.TOOL_FAILURE_PAUSE_THRESHOLD, e,
                )
                await self._emit_notice(
                    "warning",
                    f"工具 {tool_name} 执行失败：{_err_brief(str(e))}，agent 将尝试其他方案",
                    source="tool",
                )
                return {
                    "success": False,
                    "error": str(e),
                    "retryable_exhausted": True,
                    "consecutive_failures": self._tool_failure_streak,
                }, "failed"
            # 同一工具连续失败达到阈值：挂起等待用户决策
            await self._emit_notice(
                "error",
                f"工具 {tool_name} 连续 {self._tool_failure_streak} 次执行失败，任务已暂停等待处理",
                source="tool",
            )
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

    @staticmethod
    def _media_result_error(tool_name: str, result: Any) -> str | None:
        """Reject incomplete media results before the Agent can plan downstream work."""
        if not isinstance(result, dict):
            return "媒体工具没有返回有效结果"
        if tool_name == "generate_media_batch":
            failed = int(result.get("failed") or 0)
            if failed:
                return f"{failed} 个资产生成失败，不能继续后续操作"
            return None
        if result.get("dev_fallback"):
            return "媒体服务只返回了占位结果，资产没有真实生成"
        if not str(result.get("url") or "").strip():
            return "媒体工具没有返回可用资产地址"
        return None

    async def _pause_for_media_failure(
        self,
        tool_name: str,
        params: dict,
        error: str,
    ) -> tuple[dict, str]:
        """Pause media failures so Agent cannot consume incomplete assets downstream."""
        self.pending_request = {
            "type": "tool_error",
            "step_id": str(self._step_count),
            "tool": tool_name,
            "error": error,
            "params": params,
            "fallback_model_id": getattr(self.registry.get(tool_name), "fallback_model_id", None),
            "available_models": self._list_available_models(self.registry.get(tool_name)),
        }
        await self._emit(EventType.TOOL_ERROR, self.pending_request)
        self.state = AgentState.PAUSED
        return {
            "error": error,
            "pending": "awaiting_user_recovery",
        }, "paused"

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
        await self._emit(EventType.OBSERVATION, self._observation_event_payload(
            observation,
            status,
            self._step_count,
        ))
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

    async def _handle_parse_failure(self, error: str) -> None:
        """记录一次 LLM 输出解析失败（空响应 / 非法 JSON）。

        两级熔断：
        - 连续失败首次达到 MAX_CONSECUTIVE_PARSE_FAILURES：不暂停，向 memory
          注入系统提示（要求严格输出单个 JSON 决策对象），重置计数，发
          agent_notice(warning) 后继续跑，给模型一次自我纠正的机会；
        - 同一任务第二次达到（自我纠正无效）：走与 llm_call_failed 相同的
          PAUSED 路径（发 TASK_PAUSED + 置 pending_request），让用户看到根因
          并通过 /resume 恢复，而不是用全量 prompt 空转到 max_steps。
        暂停时计数清零，用户恢复后可再获得完整的一轮重试预算。
        """
        self._consecutive_parse_failures += 1
        # 空响应通常是供应商瞬时没有返回内容，属于内部重试，不是用户操作
        # 失败。不要写入 failed step / observation，避免前端显示误导性的
        # “失败：LLM returned empty response”。真正的格式错误仍保留失败记录。
        if error == "LLM returned empty response":
            await self._emit_notice(
                "warning",
                "模型暂未返回内容，正在自动重试",
                source="llm",
            )
        else:
            # 解析失败属于 Agent 自我纠错过程，不是用户任务失败；保留在
            # memory 供 Agent 诊断，但标记为 internal，前端不展示原始模型输出。
            await self._add_failed_step(error, {}, internal=True)
        if self._consecutive_parse_failures < self.MAX_CONSECUTIVE_PARSE_FAILURES:
            return
        failures = self._consecutive_parse_failures
        if not self._parse_breaker_tripped:
            # 第一次熔断：注入格式提示 + 重置计数 + 继续（自动恢复）
            self._parse_breaker_tripped = True
            hint = (
                "系统提示：你连续多次输出无法解析的内容。请严格输出单个 JSON 对象："
                '{"thought": "...", "action": {"tool": "...", "params": {...}}}，'
                "不要输出其他文字。"
            )
            # 提示写进刚记录的 failed step 的 observation，下次 think 时
            # agent 能在 recent_steps 里看到，满足"agent 自知发生过异常"。
            if self.memory.short_term:
                last = self.memory.short_term[-1]
                if isinstance(last.observation, dict):
                    last.observation["system_hint"] = hint
            self._consecutive_parse_failures = 0
            logger.warning(
                "[agent] task %s: parse breaker tripped (%s consecutive failures); "
                "injected format hint and continuing (last error: %s)",
                self.task_id, failures, error,
            )
            await self._emit_notice(
                "warning",
                f"LLM 连续 {failures} 次输出无法解析的内容，已自动注入格式提示并继续执行",
                source="llm",
            )
            return
        # 第二次熔断：自我纠正无效，暂停等人工
        logger.warning(
            "[agent] task %s: %s consecutive LLM output parse failures after auto-recovery, pausing task (last error: %s)",
            self.task_id, failures, error,
        )
        self.pending_request = {
            "type": "auto_recovery",
            "question": (
                f"LLM 连续 {failures} 次返回无法解析的内容（空响应或非法 JSON）。"
                "为避免继续消耗 token，任务已暂停。"
                "请检查模型配置或调整需求描述后回复任意内容重试。"
            ),
            "options": ["重试", "终止任务"],
        }
        await self._emit_notice(
            "error",
            "LLM 输出连续无法解析，自动纠正未生效，任务已暂停，请检查模型配置后恢复",
            source="llm",
        )
        await self._emit(EventType.TASK_PAUSED, {
            "reason": "llm_output_parse_failed",
            "error": "LLM 输出格式无法解析，已暂停等待恢复",
            "consecutive_failures": failures,
        })
        # 清零：resume 后若再次连续失败会重新累计到阈值再暂停。
        self._consecutive_parse_failures = 0
        self.state = AgentState.PAUSED

    async def _add_failed_step(self, error: str, action: dict, *, internal: bool = False) -> None:
        observation = {"error": error}
        if internal:
            observation["internal"] = True
        self.memory.add_step(
            step_number=self._step_count,
            thought="",
            action=action,
            observation=observation,
            status="failed",
        )
        # 发射 OBSERVATION 事件，让前端能看到 LLM 输出格式错误的反馈
        # （此前只记录到 memory 不发事件，前端在连续格式错误时看不到任何反馈，
        # agent 看似"卡住"，直到 max_steps 耗尽才收到 TASK_FAILED）
        #
        # 关键：必须把 action 字段也带进 payload。
        # 前端 use-agent-store 的 observation 处理器靠
        # `obs.action.tool === '_llm_call'` 来识别 LLM 错误并显示红色 banner。
        # 之前漏发 action 字段时，banner 永远不出现，用户看到的就是"前端没提示 + 状态没回滚"。
        await self._emit(EventType.OBSERVATION, self._observation_event_payload(
            observation,
            "failed",
            self._step_count,
            action=action,
        ))

    @staticmethod
    def _observation_event_payload(
        observation: dict | None,
        status: str,
        step: int,
        *,
        action: dict | None = None,
    ) -> dict:
        """构造前端观察事件，省略没有实际内容的 null 字段。"""
        source = observation if isinstance(observation, dict) else {}
        payload: dict = {"step": step, "success": status == "success"}
        result = source.get("result")
        error = source.get("error")
        if result is not None:
            payload["result"] = result
        if error:
            payload["error"] = error
        if source.get("internal") is True:
            payload["internal"] = True
        if action is not None:
            payload["action"] = action
        return payload

    async def _emit(self, event_type: str, payload: dict) -> None:
        event = AgentEvent(
            task_id=self.task_id,
            step_id=str(self._step_count),
            type=event_type,
            payload=payload,
        )
        await event_bus.publish(event)

    async def _emit_notice(self, level: str, message: str, source: str | None = None) -> None:
        """发 agent_notice 事件：系统自动重试/恢复动作对用户可见。

        payload 保持 JSON 可序列化：{level, message, source?}。
        """
        payload: dict = {"level": level, "message": message}
        if source:
            payload["source"] = source
        await self._emit(EventType.AGENT_NOTICE, payload)

    def _emit_sync(self, event_type: str, payload: dict) -> None:
        """ToolContext.emit 的同步包装。"""
        try:
            loop = asyncio.get_running_loop()
        except RuntimeError:
            return
        loop.create_task(self._emit(event_type, payload))
