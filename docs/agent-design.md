# DramaForge AI — Agent 系统设计文档

> 版本：基于 `refactor/runway-ui` 分支当前实现逆向整理（2026-07-23）
> 范围：前端 `agent/`（约 4.6k 行 TS/TSX + 1.3k 行 CSS）、后端 `backend/app/agent/` + `backend/app/routers/agent.py`（约 12.9k 行 Python）
> 读者：需要理解、维护或扩展 Agent 系统的工程师

---

## 1. 系统概述

Agent 系统是 DramaForge AI 的自动化生产引擎：用户用一句自然语言描述目标（"把《后室》拍成 60 秒短剧"），系统通过 **ReAct（Reasoning + Acting）循环**自主完成 扩写故事 → 生成脚本 → 提取角色/道具/场景/分镜 → 批量生成图像/视频资产 的全流程，过程中可以向用户提问澄清，失败时提供结构化恢复入口。

核心特征：

- **事件驱动前后端解耦**：后端每推进一步都发射 SSE 事件，前端是纯的事件投影 + DB 快照水合，任何一侧重启都可恢复。
- **资产即唯一事实源**：所有生成物落 `assets` 表，画布节点、agent 记忆、任务快照都是它的投影。
- **人在环路（HITL）**：`ask_user` 提问、工具失败恢复卡、完成后续写对话，三类人工介入点全部走同一套 respond/resume 通道。
- **多 agent 子系统并存**：主 ReAct runtime 之外，还有独立的 studio 编剧/美术/质检三角闭环（见 §5.6）。

---

## 2. 总体架构

```
┌──────────────────────────── 前端（React + zustand）────────────────────────────┐
│  AgentPetController（桌宠+浮动面板）  ThoughtStream  PlanList  TaskList         │
│  AskUserResponse  ErrorRecoveryCard  ToolPalette   AgentMode（overlay 容器）    │
│        │                                                                        │
│  useAgentStore（zustand，applyEvent reducer + hydrate/hydrateSteps 快照水合）    │
│        │                                                                        │
│  agent-stream-manager（SSE：重放+重连+心跳+自动 rehydrate）   apiClient（REST）  │
└────────│───────────────────────────────────────────────────│──────────────────┘
         │ SSE: GET /api/agent/tasks/{id}/stream              │ REST /api/agent/*
┌────────│───────────────────────────────────────────────────│──────────────────┐
│  routers/agent.py（编排层：spawn/persist/recovery/zombie 恢复、14 个端点）      │
│        │                                                                        │
│  AgentRuntime（runtime.py：ReAct 主循环、状态机、熔断、媒体门禁、记忆压缩）       │
│        │                                                                        │
│  ToolRegistry（27 个工具）→ LLM 抽象层 / MediaService / assets 表               │
│  EventBus（per-task 内存日志 + Queue 订阅，MAX_LOG 5000）                        │
└─────────────────────────────────────────────────────────────────────────────────┘
```

关键边界：

- **runtime 不管持久化**：checkpoint（`_persist_steps`）、崩溃恢复（`_rebuild_runtime_from_db`）、僵尸任务处理全在路由编排层，runtime 只负责推理循环。
- **前端不执行工具**：`use-agent-tools.ts` 只是拉取 `/api/agent/tools` 元数据供 ToolPalette 展示，没有任何本地工具逻辑。
- **画布只投影资产**：agent 的思考/计划/动作不进画布节点，只有 `artifacts` 经 `useCanvasStore.addAgentNodes` 生成 `agent-` 前缀节点（`agent-mode.tsx:245` 注释明确此设计）。

---

## 3. 前端架构（`agent/`）

### 3.1 状态中枢：useAgentStore（zustand）

`agent/use-agent-store.ts`（1137 行）是进程级 session store（非 per-project），核心 state（:79-218）：

| 分组 | 字段 | 说明 |
|---|---|---|
| 任务标识 | `taskId` / `projectId` / `status` | status 比后端多一个 `idle` 初态 |
| 三条事件流 | `thoughts` / `actions` / `observations` | ThoughtStream 的数据源 |
| 计划 | `plan` / `pendingPlan` | plan_ready 事件同时写两者 |
| 资产 | `artifacts: Record<asset_kind, ArtifactItem[]>` | 按资产种类分桶 |
| 任务画像 | `taskProfile` | 含 task_type / deliverables / rule_pack_id 等 |
| 提问 | `pendingQuestion` / `pendingQuestionAnswered` | 支持 single/multiple/confirm/text 四种模式；"已提交"锁定态放 store 是为了跨组件共享（:99-105） |
| 错误恢复 | `pendingErrorRecovery` | tool_error 事件的恢复卡数据（含可用模型列表） |
| LLM 错误 | `llmError` / `llmErrorAt` | 与任务级 `error` 分离；识别标记是 observation 里 `action.tool === '_llm_call'`（虚拟工具名） |
| 连接 | `connectionStatus` / `reconnectAttempt` | connected / reconnecting / disconnected |
| 流式文本 | `streamingText` | text_delta 累加，observation 到达时清空 |
| 当前活动 | `currentActivity` | 中文活动标签映射表 TOOL_ACTIVITY_LABELS（:373-409） |
| 记忆 | `conversationTurns` / `memoryCompressed` | 多轮续写对话 |

三个核心 action：

- **`applyEvent`**（:675-1091）：事件 reducer，覆盖 33 种事件；内置噪音过滤 `isJsonParseNoise`（过滤 internal 步骤和 JSON 解析失败回显）。
- **`hydrate` / `hydrateSteps`**（:472-673）：把后端 task 快照 + DB steps 投影成 store 状态，是断线恢复的确定性路径（不依赖 SSE 重放）。
- **提交看门狗**（:418-450）：用户提交回复后 90s 无任何推进事件 → 自动解锁"已提交"卡 + 写 error + toast；`currentActivity` 非空时续命。

### 3.2 SSE 层：agent-stream-manager

`agent/agent-stream-manager.ts`（399 行）是现役全局 SSE 管理器（`use-agent-stream.ts` 已废弃，仅测试引用）：

- **事件注册表**：`EVENT_TYPES` 硬编码 33 个 named event（:44-83），**必须与后端 EventType 枚举严格同步**——EventSource 对未注册的事件名会静默丢弃。另含 2 个非枚举事件：`heartbeat`（路由层保活帧）、`asset_updated`（asset_tools 裸字符串发射）。
- **重连策略**：指数退避 1s→30s 上限，最多 8 次（:27-29）；连接稳定 10s 后才重置重试预算（:229-236），避免抖动网络下预算被秒耗。
- **心跳**：60s 无事件触发主动重连（:32，必须大于后端 15s 心跳 × 3）。
- **重连必水合**：每次 `onopen` 都并行拉 `getAgentTask` + `listAgentSteps` 重建 store（:176-204）——解决后端重启后内存 replay buffer 丢失导致 pendingQuestion 消失的问题。
- **终态不重连**：`onerror` 时若 store.status 已是终态则正常关闭（:246-254），避免"重连→重放→关闭"死循环。
- **自动生命周期**：订阅 store 的 taskId 变化自动 setActiveTask/stopStream（:381-399）。

### 3.3 UI 组件职责

| 组件 | 职责 |
|---|---|
| `agent-mode.tsx`（942 行） | Agent 模式容器：`position:absolute; inset:0` 覆盖在 InfiniteCanvas 上共存；左 aside 任务抽屉 + 各类浮动 banner/抽屉；提交前防御性 `upsertProvider` 把 localStorage 配置推回 DB；只把 artifacts 投影进画布 |
| `agent-pet-controller.tsx`（318 行） | 桌宠：无独立状态机，直接投影 store.status 驱动 CSS 动画（idle/pending/running/paused/done/failed/cancelled）；拖拽位置按 projectId 持久化 localStorage；浮动面板含 stats/最新思考/流式文本/media 卡/goal 输入/继续对话 |
| `thought-stream.tsx`（385 行） | 思考流面板：状态指示 + 统计 pill + 最新三条高亮 + PlanList + 资产 + 可展开完整记录；`TOOL_PARAMETER_HELP` 把工具参数翻成中文 |
| `plan-list.tsx`（310 行） | 计划列表：按 step_number 匹配 actions/observations 推断每步状态（:15-28 规则）；failed 步骤可从卡片注入自然语言重试请求（走后端 continue，非精确重跑） |
| `task-list.tsx`（191 行） | 任务抽屉：running/pending 时 3s 轮询，其他 30s；行内 继续/停止/重试 操作，重试后可带当前画布 LLM 绑定 |
| `tool-palette.tsx`（163 行） | 工具面板：6 类分组 + 基于 store.actions 的调用统计；数据来自 `/api/agent/tools`，硬编码清单仅是 fallback |
| `ask-user-response.tsx`（241 行） | 提问卡：四种选择模式 + allow_custom 补充 + min/max 校验；提交 = respond → resume → markAnswered；draft 按 `taskId:questionKey` 存模块级 Map |
| `error-recovery-card.tsx`（172 行） | 工具失败恢复卡：retry/change_model/skip 三选 + 模型下拉；提交 = respondAgent({recovery_action, new_model_id}) → resumeAgent |
| `activity-indicator.tsx` | **已废弃**（功能并入桌宠状态栏） |

**「生成提示词」media 卡**（agent-pet-media）的数据来源：store.artifacts 中最后一个带 prompt/model 的 artifact（`agent-pet-controller.tsx:169-172`），源头是后端媒体生成链路发射的 `artifact_created` 事件（payload 带 prompt/provider_name/model_id）。

---

## 4. 后端架构（`backend/app/agent/`）

### 4.1 ReAct 主循环：runtime.py（1506 行）

**状态机**（:48-54）：`PENDING / RUNNING / PAUSED / DONE / FAILED / CANCELLED`。前端多一个 `idle`。

**关键常量**：

| 常量 | 值 | 语义 |
|---|---|---|
| `DEFAULT_MAX_STEPS` | 30 | 用尽不失败，自动 +30 步续跑并发 warning notice（:217-227） |
| `MAX_CONSECUTIVE_PARSE_FAILURES` | 3 | 两级熔断：首次注入格式提示自纠，第二次 PAUSED |
| `LLM_AUTO_RETRY_BACKOFF` | (2,5,10)s | LLM 失败自动重试 3 次；鉴权类错误跳过（:66-69） |
| `TOOL_FAILURE_PAUSE_THRESHOLD` | 3 | 非媒体工具同工具连续失败 3 次才挂起（前两次返回 failed observation 让 agent 自纠） |

**step() 主循环**（:207-472）每步流程：

```
构建 messages（系统提示词 + 任务画像 + 规则包 + 最近 10 步 + 资产清单）
  → LLM 决策（结构化 tool_call 或 content JSON，parse_decision :78-84）
  → 发 THOUGHT
  → 分支：
     ├─ finish_task（虚拟工具）→ 资产完成度校验 → TASK_DONE（带 missing_deliverables）
     ├─ ask_user → 置 pending_request + REQUEST_USER_INPUT + PAUSED
     ├─ 媒体工具门禁（_has_source_for_profile 不满足 → 内置提问 PAUSED）
     └─ 常规工具 → 发 ACTION →（媒体先建 generating 占位资产发 ARTIFACT_CREATED）
                   → _execute_tool → 成功发 OBSERVATION / 失败见下
```

**失败路径分层**：

1. **LLM 调用失败**（`_call_llm_with_retry` :474-549）：(2,5,10)s 退避 3 次 → 耗尽后记 `action.tool='_llm_call'` 的 failed step（前端 llmError banner 的识别标记）+ agent_notice(error) + 显式 TASK_PAUSED。
2. **工具失败**（`_execute_tool` :1133-1229）：RetryableTool 包装（指数退避重试 → fallback 模型试 1 次）；耗尽后——媒体工具直接 TOOL_ERROR + PAUSED；非媒体先让 agent 自纠，连续 3 次才挂起。
3. **媒体结果校验**（`_media_result_error` :1231-1245）：无 url / dev_fallback / batch 含失败项 → 视为失败暂停。
4. **解析失败**（`_handle_parse_failure` :1349-1430）：空响应只发 notice；其他记 internal failed step；首次注入 system_hint，第二次 PAUSED + pending_request type="auto_recovery"。

**resume(user_response)**（:853-884）：pending_request 为 tool_error → `_resume_from_tool_error`（retry/change_model 重新执行同一步；skip 记 skipped step）；否则把回复注入最近 pending step 的 observation，发 USER_INPUT_RECEIVED 继续循环。

**continue_conversation**（:886-929）：仅 DONE 状态；步数 >15 时先 LLM 摘要压缩早期记忆（保留最近 10 步，发 MEMORY_COMPRESSED）；user_goal 追加"[用户追加]"。

### 4.2 LLM 抽象层

- **`llm.py`**：`LLMClient` Protocol（generate + generate_structured）；`REACT_SYSTEM_PROMPT`（:67-161，"DramaForge Director Agent"人设 + 素材/脚本铁律 + drama_short 13 步流程）；`MEDIA_PARALLEL_POLICY`（≥2 个独立媒体必须走 generate_media_batch）；`build_react_prompt` 拼装完整上下文（目标/摘要/计划/资产/最近 10 步/工具清单）。
- **`openai_llm_client.py`**：唯一现役实现，兼容所有 OpenAI 协议端点（OpenAI/DeepSeek/Kimi/Qwen/火山/本地 vllm）。5xx/429/超时/断连指数退避 3 次，其他 4xx 立即抛错；内置 7 个模型单价表估算成本；支持流式 `generate_streaming`（SSE delta → text_delta 事件）。注意：runtime 主循环走 system prompt 文本 JSON 决策，**实际不传 tools 参数**（tool_call 分支是兼容路径）。
- **`llm_factory.py`**：从统一 `provider_configs` 表选 LLM；找不到抛 `NoLLMConfigured`——**绝不回退 stub**（stub 路径已删除）。
- 媒体侧 `StubMediaService` 仍存在（data URL 占位，仅供测试）。

### 4.3 工具系统（27 个工具）

**基类**（`tools/base.py`）：错误层级 `ToolError → ToolValidationError / RetryableError / NonRetryableError`；`ToolContext` 携带 task/project/db/llm/media_service/artifacts（与 memory.artifacts 同引用）/emit；`RetryableTool` 装饰器实现 重试→fallback 模型 两阶段容错（成功清零失败 streak）。

**完整工具清单**（`tools/__init__.py:56-87` ALL_TOOLS）：

| 类别 | 工具 | 说明 |
|---|---|---|
| planning | `parse_user_goal` | 用户原话→结构化目标 + classify_task 任务画像 |
| planning | `create_plan` | 目标→5-10 步计划（requires_approval 仅元数据，无运行时强制） |
| planning | `ask_user` | 暂停循环向用户提问（4 种选择模式） |
| llm | `expand_story` | 想法→≥1000 字完整故事，自动落 novel 资产；过短抛 RetryableError |
| llm | `generate_script` | 长文本→结构化分场脚本（scenes/characters/props/bigShots/visualSignature），双格式落库；解析失败不静默降级 |
| llm | `extract_characters / extract_props / extract_scenes / extract_shots` | 脚本→V3.0 规范结构化列表（script 参数可 None，自动从 artifacts 兜底） |
| llm | `optimize_prompt` | 粗 prompt→生成级细 prompt；多层 sanitize 剥离 thinking/元描述 |
| image | `generate_character_portrait` | 角色概念表（V3.0 B.4 四区域布局） |
| image | `generate_prop_image` | 道具图（fourView/single） |
| image | `generate_scene_image` | 场景概念图（七层+ambientCharacters） |
| image | `generate_storyboard_image` | 六宫格故事板（2x3） |
| video | `generate_video` | 分镜→视频片段 |
| image | `generate_media_batch` | asyncio.gather 并行多 job，单项失败不阻塞；canonical 资产跳过 LLM 改写 |
| audio | `generate_voiceover / generate_bgm` | TTS / 背景音乐 |
| asset | `save_asset` | 幂等落库（按 project+kind+asset_kind+name+prompt 去重） |
| asset | `get_artifacts` | 项目资产查询（≤50） |
| asset | `read_text_asset / update_text_asset` | 读/写 novel、script 正文（version+1，发 asset_updated） |
| asset | `inspect_asset` | 多模态 LLM 检查上传资产是否达标；文本自动路由 read_text_asset |
| asset | `prepare_character_asset` | 不达标角色图→创建标准化衍生资产 |
| asset | `search_project_assets` | 项目资产搜索（按 story_entity 聚合） |
| studio | `studio_generate_shot` | 单镜头三角闭环（编剧→美术→质检，发 studio_step） |
| studio | `studio_generate_episode` | 整集编排（导演拆镜头→逐镜头过审→合成 mp4，on_progress 桥接 studio_step） |

**媒体执行链路**（同步 await，batch 内部并行）：

```
generate_* 工具 → _build_*_prompt（结构化构建，拒绝 LLM 塞入的 prompt 原文）
  → optimize_generation_prompt（prompt_engineering.py，发 prompt_optimization_* 事件；
     canonical_layout 存在时跳过 LLM 改写只加硬约束）
  → resolve_asset_references（reference_asset_ids → URL）
  → DatabaseMediaService.generate（按 capability binding 选 provider/model，
     复用 routers/media 的 _openai_image/_openai_video）
  → begin_media_asset（generating 占位，复用/复活/新建三级策略）
  → finish_media_asset（回写 url/error/prompt，发 ARTIFACT_CREATED 更新）
```

**零信任边界**：`sanitize_structured_field`（prompt_engineering.py:11-40）防止 LLM planning 文本泄漏进结构化字段；`_append_generation_hard_constraints` 注入视觉签名 continuity anchor。

### 4.4 事件系统：events.py

`EventBus`：per-task asyncio.Queue 订阅 + per-task 内存事件日志（上限 5000 条 FIFO）；`get_replay` 供新 SSE 订阅者重放。**日志在内存中，后端重启即丢失**（前端靠 DB hydrate 兜底，这是有意设计）。

**EventType 33 个枚举值**（:15-53），按用途分组：

| 分组 | 事件 |
|---|---|
| 生命周期 | task_started / task_paused / task_resumed / task_done / task_failed |
| ReAct 循环 | thought / action / observation / plan_ready |
| 人机交互 | request_user_input / user_input_received |
| 资产 | artifact_created（+ 非枚举 asset_updated） |
| 流式 | text_delta |
| 提示词工程 | prompt_optimization_started / prompt_optimization_finished |
| 容错 | tool_retrying / tool_fallback_model / tool_error / tool_resumed / media_recovery_started / media_recovery_finished |
| 资产智能 | asset_inspection_started/finished / asset_normalization_started/finished |
| 记忆 | conversation_continued / memory_compressed |
| 通知 | agent_notice（level: info/warning/error） |
| **幽灵事件** | goal_parsed / plan_revised / step_retrying / cost_update —— 枚举存在但**后端从不发射**，前端对应分支是死代码 |

另有两个非枚举 named event：`heartbeat`（路由层 15s 保活帧）、`asset_updated`。

### 4.5 支撑模块

| 模块 | 职责 |
|---|---|
| `memory.py` | AgentMemory：plan/short_term(StepRecord)/artifacts/conversation_turns/compressed_summary；纯内存，持久化靠路由层 |
| `task_profiles.py` | 确定性任务画像：`classify_task` 纯函数（单一资产意图短路→关键词分类→deliverables 默认表），5 种 task_type |
| `rule_packs.py` | 版本化规则包（hard_rules/prompt_templates/validators/workflow_steps），每 task_type 一个 `{type}.v1` |
| `specs.py` | 从 docs/ 懒加载三个规范文件（资产大师 V3.0、视频提示词、分镜解析），按工具名提取章节注入系统提示词 |
| `prompt_engineering.py` | 媒体提示词统一边界：optimize/sanitize/硬约束/参考资产收集 |
| `prompt_template_seed.py` | 10 个内置提示词模板，startup 幂等写 DB |
| `user_messages.py` | ask_user 澄清文案四语言本地化（zh/en/ja/ko） |
| `capabilities.py` | 从 UserPreference[model_bindings] 读 llm/image/video 三能力绑定并校验 |
| `media_service.py` | MediaRequest/MediaResult 抽象 + DatabaseMediaService + StubMediaService |
| `media_assets.py` | begin/finish_media_asset：占位资产生命周期管理 |
| `asset_intelligence.py` | 多模态检查/标准化原语（inspect_asset/prepare_asset/NORMALIZATION_TEMPLATES） |
| `character_cards.py` | Track C 角色卡：vision LLM 提取身份指纹，服务 studio 闭环（非主 runtime） |

### 4.6 studio 多 agent 子系统（独立于主 runtime）

- **`studio.py`**：编剧/美术/质检三角闭环——各自独立 system prompt + 黑板 trace，不共享上下文；`run_studio_shot`：brief → 编剧 prompt → 美术生成 → 质检 inspect_asset 过审/打回（最多 max_rounds）。
- **`director.py`**：导演 agent：story → LLM 拆 3-8 个镜头 brief → 逐镜头 run_studio_shot → export_sequence 合成整集。
- **`studio_export.py`**：ffmpeg concat 镜头资产 → 1280x720/30fps/libx264 mp4 落库（ffmpeg 缺失抛错）。
- **`studio_tasks.py`**：整集任务的进程内存注册表（明确接受重启丢任务）。
- 路由：`/api/studio/*`（shots/review/regenerate/character-cards/episodes/export/arrange），与主 agent runtime **无共享状态**。

---

## 5. API 端点（`backend/app/routers/agent.py`，prefix `/api/agent`）

| 方法 + 路径 | 用途 |
|---|---|
| GET `/tools` | 工具元数据列表（docstring 写"18 个"已过时，实际 27） |
| POST `/tasks` | 创建任务（user_goal/language/project_id/max_steps/skip_confirm/llm 绑定）；存 task_profile 后异步 spawn |
| GET `/tasks?project_id=` | 任务列表 |
| GET `/tasks/{id}` | 任务详情（含从最近 pending ask_user step 推导的 pending_question） |
| PATCH `/tasks/{id}` | 更新 status/plan/artifacts/pending_response/cost 等 |
| DELETE `/tasks/{id}` | 删除任务（级联删 steps） |
| GET `/tasks/{id}/steps` | 步骤历史（step_number 升序） |
| GET `/tasks/{id}/stream` | **SSE**：先重放 event_bus 日志再 live；15s 心跳；终态事件后关闭 |
| POST `/tasks/{id}/respond` | 写 pending_response；approved=False 且 paused → 置 failed；发 USER_INPUT_RECEIVED |
| POST `/tasks/{id}/resume` | 校验状态后 `_continue_runtime` 从 DB 重建 runtime 续跑 |
| POST `/tasks/{id}/pause` | running→paused，发 TASK_PAUSED |
| POST `/tasks/{id}/stop` | pending/running→cancelled，发 TASK_FAILED{cancelled:true} |
| POST `/tasks/{id}/retry` | failed/cancelled 从头重试：删 steps + 清事件日志 + 可覆盖 LLM 绑定 |
| POST `/tasks/{id}/continue` | done 任务追加需求：置 paused + `_continue_runtime` |

### 编排层机制

- **内存注册表**：`_RUNNING_RUNTIMES` / `_RUNNING_TASKS`（:54-56）。
- **spawn 失败自愈**：`_spawn_runtime` 启动失败自动重试 3 次 → 耗尽置 paused + `_schedule_auto_recovery`（退避 3/8/20s）。
- **崩溃重建**：`_rebuild_runtime_from_db`（:621-799）从 DB 全量重建 runtime——优先用当前全局 LLM 绑定覆盖 task 钉住的 provider；恢复 `_step_count`；重建 ask_user / tool_error 两种 pending_request。
- **逐步落库**：`_run_runtime_loop_once` 每步后 `_persist_steps`（按 step_number 幂等 INSERT/UPDATE）+ `_sync_task_artifacts`。
- **未预期异常**：`_run_runtime_loop` 最多自动恢复 3 次，恢复事件以 failed step 写进 memory。
- **僵尸任务**：`recover_zombie_agent_tasks`（startup 钩子）——重启后**不自动重跑**，running 置 paused + pending_response 标记 resume_required，等用户显式继续。
- **恢复并发限制**：`_RUNTIME_RECOVERY_SEMAPHORE=3`，防 SQLite 连接池耗尽。

---

## 6. 端到端时序

```
用户输入目标（桌宠面板 goal 输入）
  → AgentMode.onSubmit（校验画布 LLM 绑定 + 防御性 upsertProvider）
  → POST /api/agent/tasks（classify_task 存 task_profile）
  → _spawn_runtime：选 LLM（失败→paused+auto_recovery）→ 发 TASK_STARTED
  → 前端 setTask → stream-manager 自动开 SSE（先收全量 replay）

ReAct 循环（每步）：
  THOUGHT → ACTION →（媒体先建占位 ARTIFACT_CREATED）→ 工具执行
    （内部可能 emit text_delta / prompt_optimization_* / artifact_created）
  → OBSERVATION → _persist_steps 落库

ask_user 问答：
  LLM 提问或门禁触发 → REQUEST_USER_INPUT + PAUSED
  → 前端 pendingQuestion → 用户提交
  → POST /respond（写 pending_response + USER_INPUT_RECEIVED）
  → POST /resume → _continue_runtime 重建 runtime → 注入回复 → 继续循环
  （前端 markAnswered 锁定 + 90s 看门狗兜底）

工具失败：
  RetryableTool 自动重试（tool_retrying）→ fallback 模型（tool_fallback_model）
  → 耗尽（媒体/连续 3 次）→ TOOL_ERROR + PAUSED
  → 前端 ErrorRecoveryCard → respond(recovery_action) + resume
  → _resume_from_tool_error（retry/change_model/skip）

完成：
  LLM 调 finish_task → 完成度校验（missing_deliverables）
  → TASK_DONE → SSE 关闭
  → 用户可 POST /continue 追加需求（超 15 步先记忆压缩）

断线恢复：
  SSE 断 → 指数退避重连（≤8 次）→ onopen 必 rehydrate（DB 快照 + steps）
  后端重启 → zombie 任务置 paused 等手动继续；replay buffer 丢失由 DB hydrate 兜底
```

---

## 7. 数据模型与持久化

| 存储 | 内容 |
|---|---|
| `agent_tasks` 表 | status / plan(JSON) / artifacts(JSON 冗余投影) / pending_response / total_cost_usd / total_tokens / max_steps / skip_confirm / llm_provider_id / llm_model_id / task_profile(JSON) / rule_pack_version / conversation_turns / memory_summary |
| `agent_steps` 表 | step_number / thought / action / observation / status / cost / tokens / 时间戳——**唯一永久 checkpoint**，按 step_number 幂等写入 |
| `assets` 表 | 所有生成资产：project_id 外键、kind、asset_kind、status(uploaded/processing/ready/failed/warning)、version、source_asset_id 派生链、inspection_*、prompt_source/prompt_optimized |
| `provider_configs` + `UserPreference[model_bindings]` | LLM/媒体能力配置与三能力绑定（llm/image/video，可选 ref_model_id） |
| `EventBus` 内存日志 | per-task 事件重放 buffer（5000 条上限，重启丢失） |

**恢复三层兜底**：SSE replay（内存，最快）→ hydrate（task 快照）→ hydrateSteps（DB steps，最可靠）。step 历史是唯一的永久事实源。

**agent 与项目的关系**：AgentTask.project_id → Project；一个项目可挂多个 agent 任务；memory.artifacts 是 assets 表的内存投影，每步经 `_sync_task_artifacts` 冗余存到 agent_tasks.artifacts JSON 列；画布 `agent-` 前缀节点由 artifacts 投影生成并持久化为项目节点（离开 Agent 模式仍可见）。

---

## 8. 可靠性与容错设计总览

| 层 | 机制 |
|---|---|
| LLM 调用 | (2,5,10)s 自动重试 3 次；鉴权错误不重试；HTTP 层 5xx/429/超时/断连指数退避 3 次 + jitter |
| 工具执行 | RetryableError 指数退避（max_retries=2）→ fallback 模型 1 次 → 媒体/连续 3 次失败才 PAUSED |
| 解析失败 | 空响应不记步；连续 3 次 → 注入格式提示自纠 → 再失败 PAUSED + auto_recovery |
| 媒体结果 | 无 url / dev_fallback / batch 含失败项 → 视为失败暂停 |
| 提交看门狗（前端） | 90s 无推进自动解锁"已提交"卡；currentActivity 非空闲续命 |
| SSE | 15s 服务端心跳 / 60s 客户端超时 / 指数退避重连 8 次 / 稳定 10s 重置预算 / 终态不重连 |
| 进程崩溃 | spawn 重试 3 次 + auto_recovery(3/8/20s)；未预期异常自动恢复 3 次；恢复并发上限 3 |
| 后端重启 | zombie 任务置 paused 标记 resume_required，**不自动重跑**，等用户显式继续 |
| 步骤落库 | 每步幂等 persist；失败发去抖 notice 不阻断循环 |

---

## 9. 附录 A：已知技术债（文档与实现不符 / 死代码）

1. **幽灵事件**：`goal_parsed` / `plan_revised` / `step_retrying` / `cost_update` 在 EventType 枚举和前端都有处理，但后端从不发射——前端对应分支（如 cost_update 累加成本）是死代码，成本只能经 hydrate 恢复。
2. **`media_recovery_*` 名不副实**：payload 带 `worker:'media-recovery'`，但只是 runtime `_execute_tool` 里同步连发两个事件，不存在旁路恢复 worker（runtime.py:1172-1180）。
3. **工具数量三处不一致**：routers/agent.py:151 docstring "18 个"；tools/__init__.py docstring 分类计数 21；前端 PALETTE_TOOLS 硬编码 18（仅 fallback）。实际 ALL_TOOLS=**24**。
4. **`use-agent-stream.ts` 已废弃**但仍在仓库且 tests 引用；其事件清单缺 Spec B 之后的事件。
5. **`respondAgent` 类型不符**：apiClient 声明 `response: string`，AskUserResponse 多选实际传 `string[]`（后端 schema `Optional[Any]` 允许）。
6. **死代码**：`activity-indicator.tsx`；`LegacyAskUserResponse`（agent-mode.tsx:788-940）。
7. **max_steps 默认值不一致**：schemas 默认 30；apiClient.startAgent 默认 50；路由兜底 `or 30`。
8. **注释陈旧**：routers/agent.py:290 注释称前端心跳超时 45s（实际 60s）；models.py:139 status 注释缺 cancelled。
9. **虚拟工具名**：`_llm_call`（LLM 失败标记）、`finish_task` / `user_followup` / `ask_user_response` / `_system_notice` 都不在 registry，工具清单统计需排除。
10. **`clearLlmError` 未在 AgentState interface 声明**但已实现并被使用（use-agent-store.ts:1105）。
11. **`skip_confirm` 是死字段**：全链路透传但无任何工具读取；`requires_approval` 仅透传到 ACTION 事件，无运行时门禁。
12. **PRD 未实现项**：`docs/agent-rewrite/PRD.md` 的"任务图画布"（DAG 节点自动布局）、分支/A-B 测试均未实现——现行画布只投影资产节点。

## 附录 B：相关文档

- `docs/agent-workflow.md`：现行准确（状态投影策略、并行语义、2026-07-16 交接记录），仅"恢复与取消"一节的事件名措辞与实现略有出入。
- `docs/agent-rewrite/`（PRD/tech-design/plan）：设计期文档，多处已过时（SSE URL、事件表、状态机、持久化伪代码），以本文档为准。
