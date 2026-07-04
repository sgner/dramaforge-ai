# Provider 统一与 Stub 清理 — 4-Plan 路线图

> 本文档是 4 个 plan 的总览。Plan 1 已详细写完（见 `2026-07-04-provider-unification.md`），Plan 2/3/4 等 Plan 1 完成后再细化（避免依赖未完成代码导致返工）。

## 背景与根因

**核心痛点**：Agent 模式走 DevScriptedLLM 假任务，不跑真实 LLM。

**根因**：项目里有三套 provider 数据源互不相通——
1. `media_provider_configs` 表（canvas 媒体生成用，用户已配 `custom-api`）
2. `llm_provider_configs` 表（agent runtime 用，0 行）
3. localStorage `apiConfig.providers`（canvas LLM 文本流式直调供应商用）

前端 Agent 模式下拉框 fallback 读 canvas provider（media 表），后端 `load_llm_configs` 只读 llm 表（空）→ `select_llm_for_task` 静默回 `DevScriptedLLM` → 产出 `_FAKE_SCRIPT` 硬编码内容。

**用户决策**：完全统一（合并表 + canvas LLM 也走后端）+ 全部删除 stub（DevScriptedLLM + StubMediaService）+ 拆多个 plan。

---

## Plan 1: 后端 provider 表合并 + Agent 切换 ✅ 已详细写完

**文件**：`docs/superpowers/plans/2026-07-04-provider-unification.md`

**Goal**：合并 `media_provider_configs` + `llm_provider_configs` 为统一 `provider_configs` 表，agent runtime 和 canvas 媒体共用同一份配置。

**8 个 Task**：
1. 新建 `ProviderConfig` ORM 模型
2. 数据迁移脚本（media + llm → provider_configs）
3. `load_llm_configs` 改读新表
4. `media.py _load_provider` 改读新表
5. provider CRUD 路由统一（`/api/llm-providers` + `/api/media-providers` 都操作新表）
6. 前端 `ApiSettingsModal` 合并 upsert 入口
7. `agent-mode.tsx` 简化 dbProviders 加载
8. 废弃旧表标记 + 清理 dead import

**交付价值**：用户已配的 `custom-api` 立即可被 agent 用上，走真实 LLM（不再走 DevScriptedLLM）。

**依赖**：无（基础 plan）

---

## Plan 2: 移除 DevScriptedLLM + StubMediaService ⏳ 待 Plan 1 完成后细化

**Goal**：删除所有测试用预设行为，让 agent 在无 provider 时直接报错而非静默回 stub；agent 媒体工具改调真实 media service。

**Architecture**：
- 删除 `backend/app/agent/dev_scripted_llm.py` 整个文件
- `select_llm_for_task`（`llm_factory.py:115-169`）移除所有 stub 返回分支，无可用 provider 时抛 `LLMNotConfiguredError`（或返回 `None` 让 runtime 上报失败）
- `backend/app/routers/agent.py:_spawn_runtime` 捕获该错误，发 `TASK_FAILED` 事件，前端 banner 明示"未配置 LLM provider"
- 删除 `backend/app/agent/media_service.py` 里的 `StubMediaService`，新增 `BackendMediaService` 调 `media.py` 的 `_openai_image`/`_openai_video` 真实实现
- 更新依赖 stub 的测试：`test_llm_factory.py` / `test_sse_replay_buffer.py` / `test_agent_e2e.py` 等改用真实 mock（pytest fixture 注入 fake LLMClient）

**预估 Task**：
1. 定义 `LLMNotConfiguredError` + `select_llm_for_task` 改抛错
2. `_spawn_runtime` 捕获错误 + 发 TASK_FAILED 事件
3. 新建 `BackendMediaService`（调 media.py 真实实现）
4. agent.py 注入 `BackendMediaService` 替代 `StubMediaService`
5. 删除 `DevScriptedLLM` 类 + `StubMediaService` 类
6. 更新/删除依赖 stub 的测试
7. 前端 banner 在 stub 模式文案移除（`agent-mode.tsx` / `use-agent-store.ts`）

**依赖**：Plan 1（agent 已能读真实 provider，stub 才能安全删除）

---

## Plan 3: canvas LLM 文本流式改走后端代理 ⏳ 待 Plan 1 完成后细化

**Goal**：canvas 的 LLM 文本流式（续写/生成剧本/预处理小说）从"前端直调供应商"改为"走后端代理"，前端不再持有明文 api_key。

**Architecture**：
- 新建 `backend/app/routers/llm.py`，`POST /api/llm/stream` 透传 SSE（用 DB 里的明文 key 调供应商，流式回传前端）
- 前端 `services/llmClient.ts:38-100` 的 `startStream` 改调 `/api/llm/stream`，不再从 `apiConfig.providers[].apiKey` 取 key
- `services/llmClient.ts` 的 `buildLlmStreamRequest` 废弃（key 在后端）
- 废弃 localStorage `apiConfig.providers[].apiKey` / `walletApiKey` / `volcengine*Key` 字段
- `hooks/useTaskExecutor.ts` / `useTaskActions.ts` / `CanvasNode.tsx` 的 LLM 调用改传 `providerId + modelId` 给后端代理，不传 key

**预估 Task**：
1. 后端 `/api/llm/stream` 路由 + SSE 透传实现
2. 后端流式调用 OpenAI 兼容接口的 client（复用 `OpenAICompatibleLLMClient` 或新建）
3. 前端 `llmClient.ts` 改调后端代理
4. 前端 LLM 调用点（`useTaskExecutor` / `useTaskActions` / `CanvasNode`）改传 providerId
5. 废弃 localStorage 明文 key 字段 + `buildLlmStreamRequest`
6. 端到端验证（续写/生成剧本/预处理小说）

**依赖**：Plan 1（后端代理读 `provider_configs` 表拿 key）

**风险**：canvas LLM 流式是高频调用，后端代理性能需验证；SSE 透传的中断/超时处理要仔细。

---

## Plan 4: stepBindings 入 DB + 前端 apiConfig 收尾 ⏳ 待 Plan 1+3 完成后细化

**Goal**：`stepBindings`（LLM 步骤绑定，如 scriptGeneration 用哪个 provider/model）入后端 DB；前端 `apiConfig` 只保留 UI 偏好，不再持久化 key 或 binding。

**Architecture**：
- 新建 `step_bindings` 表（`step` + `provider_id` + `model_id`）或扩展 `provider_configs` 加 `default_for_step` 字段
- 后端 `/api/step-bindings` CRUD 路由
- 前端 `ApiSettingsModal` 的 stepBindings 编辑改调后端
- `use-canvas-store.ts:1797` 的 `saveApiConfig(state.apiConfig)` 改为只缓存 UI 偏好（不持 key/binding）
- `loadApiConfig` 不再从 localStorage 读 provider/binding，改从后端读
- `agent-mode.tsx:241-246` 的 stepBindings fallback 逻辑删除（统一从后端读）

**预估 Task**：
1. 新建 `step_bindings` 表 + ORM 模型
2. 后端 CRUD 路由
3. 前端 `ApiSettingsModal` stepBindings 编辑改调后端
4. `use-canvas-store` apiConfig 持久化逻辑收尾
5. `agent-mode.tsx` fallback 逻辑清理
6. 端到端验证

**依赖**：Plan 1（provider_configs 表）+ Plan 3（前端不再持 key）

---

## 执行顺序建议

```
Plan 1 (基础) ──┬─→ Plan 2 (删 stub)
                ├─→ Plan 3 (canvas LLM 走后端) ──→ Plan 4 (stepBindings + 收尾)
                └─→ (Plan 2 与 Plan 3 可并行)
```

**推荐**：先执行 Plan 1，验证 agent 走真实 LLM 后，再启动 Plan 2/3。Plan 4 最后做（收尾性质）。
