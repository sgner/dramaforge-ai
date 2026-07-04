# Agent 真实 LLM 集成 — Design Spec

> **日期**：2026-07-02
> **状态**：待用户审阅
> **范围**：单 spec + 单 implementation plan

## 0. 全局约束

- 现有 127 个前端测试 + 172 个后端测试必须全过
- 不动 `useAgentStore` / `LLMClient` Protocol 的对外 API
- 不动 18 工具的 `name` / `category` 字段
- 不在 DB 中存任何 API key 明文
- 仅本机 dev 使用：API key 走 env 变量（不需要加密存储）
- 现有 `DevScriptedLLM` + `StubMediaService` 必须保留，作为 fallback

## 1. 背景与问题

现状：用户在 API 配置页输入 key → 存在 `localStorage` → 画布自己的图像/视频生成器读到并用，**但 agent 流程完全用不到**。

后端 `_spawn_runtime` 写死：

```python
llm = DevScriptedLLM(user_goal=...)
media = StubMediaService()
for tool in registry.list():
    if tool.category in ("image", "video", "audio"):
        tool._media_service = media
```

`DevScriptedLLM` 永远走预设脚本，不发任何 LLM HTTP 请求。`StubMediaService` 把 prompt 哈希成 data URL，不发任何 media 请求。**用户配置的 key 完全没被消费**。

后端协议层其实已经存在：

- `backend/app/agent/llm.py` 定义 `LLMClient` Protocol + `LLMResponse`
- `backend/app/agent/media_service.py` 定义 `MediaService` Protocol + `MediaRequest` / `MediaResult`
- 都有 `_parse_function_call()` 解析 OpenAI 格式响应

但**没有真实实现**。

## 2. 目标与非目标

### 2.1 目标

1. **真实 LLM**：当 env 配了 API key 时，agent 用 OpenAI 兼容 chat protocol（gpt-3.5/4o、deepseek、kimi、qwen、火山引擎、vllm 等）调用真实 LLM，消耗真实额度。
2. **降级稳健**：env 缺 key / provider 不识别 / 调用失败 → 退回 stub，agent 不至于完全坏掉；同时发出 warning event 让前端 UI 能看到降级原因。
3. **零侵入升级**：保留 `DevScriptedLLM` + `StubMediaService` 作为默认；保留所有现有测试。
4. **Media 保留 stub**：本期**不做真实 image / video / audio 集成**，media 工具继续走 stub。原因：用户选了"OpenAI 兼容 chat protocol"，没选 media。简化范围。

### 2.2 非目标

- 不实现 jimeng / apimart / sd-webui 等非 OpenAI 兼容协议
- 不在 DB / 文件中存 API key
- 不修改画布自身 `useCanvasStore` 已有的 LLM 调用路径
- 不修改 18 工具的注册表和 metadata
- 不做 image / video / audio 的真实 API 集成（保留 stub）

## 3. 架构

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 720 360" font-family="ui-monospace,monospace" font-size="12">
  <rect x="10" y="10" width="700" height="100" fill="#f8fafc" stroke="#94a3b8" rx="6"/>
  <text x="20" y="30" font-weight="bold">Frontend (React + zustand)</text>
  <rect x="30" y="50" width="300" height="40" fill="#eef2ff" stroke="#6366f1" rx="4"/>
  <text x="40" y="72">ApiSettingsModal → localStorage (apiConfig)</text>
  <rect x="350" y="50" width="340" height="40" fill="#eef2ff" stroke="#6366f1" rx="4"/>
  <text x="360" y="72">api.startAgent(projectId, goal, provider_id)</text>

  <line x1="510" y1="90" x2="510" y2="130" stroke="#64748b" marker-end="url(#arr)"/>
  <defs>
    <marker id="arr" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
      <path d="M0 0 L10 5 L0 10 z" fill="#64748b"/>
    </marker>
  </defs>

  <rect x="10" y="130" width="700" height="200" fill="#0f172a" stroke="#0f172a" rx="4"/>
  <text x="20" y="150" fill="#94a3b8">Backend (FastAPI + SQLite)</text>
  <rect x="30" y="170" width="320" height="50" fill="#1e293b" stroke="#475569" rx="4"/>
  <text x="40" y="190" fill="#cbd5e1">AgentTask row</text>
  <text x="40" y="208" fill="#94a3b8">+ llm_provider_id  + llm_model_id</text>

  <rect x="380" y="170" width="310" height="50" fill="#1e293b" stroke="#475569" rx="4"/>
  <text x="390" y="190" fill="#cbd5e1">_spawn_runtime(task_dict)</text>
  <text x="390" y="208" fill="#94a3b8">选 LLM：真实 or stub（按 env + provider_id）</text>

  <rect x="30" y="240" width="660" height="70" fill="#1e293b" stroke="#475569" rx="4"/>
  <text x="40" y="260" fill="#cbd5e1">LLM Factory (新)</text>
  <text x="40" y="280" fill="#94a3b8">read env:  LLM_PROVIDERS_JSON  |  LLM_DEFAULT_PROVIDER  |  LLM_API_KEY  |  LLM_BASE_URL  |  LLM_MODEL</text>
  <text x="40" y="298" fill="#94a3b8">build OpenAICompatibleLLMClient if env 配齐 ;  else DevScriptedLLM</text>

  <line x1="200" y1="310" x2="200" y2="340" stroke="#64748b" marker-end="url(#arr)"/>
  <rect x="120" y="340" width="540" height="14" fill="#0f172a"/>
  <text x="130" y="352" fill="#94a3b8">→ POST {env.LLM_BASE_URL}/v1/chat/completions  (gpt / deepseek / kimi / qwen / vllm ...)</text>
</svg>
```

## 4. 组件与接口

### 4.1 后端：LLM Factory

新文件 [backend/app/agent/llm_factory.py](file:///c:\Users\25315\PycharmProjects\dramaforge-ai\backend\app\agent\llm_factory.py)

```python
@dataclass
class LLMProviderConfig:
    provider_id: str            # 'openai' / 'deepseek' / 'kimi' / 'qwen' / 'custom'
    base_url: str               # 'https://api.openai.com'
    api_key: str                # 从 env 读
    default_model: str          # 'gpt-4o-mini' / 'deepseek-chat' / ...


def load_llm_configs_from_env() -> list[LLMProviderConfig]:
    """从 LLM_PROVIDERS_JSON 解析；缺失则返回 []. 单 provider 简化：LLM_API_KEY+LLM_BASE_URL+LLM_MODEL."""

def select_llm_for_task(
    task_provider_id: str | None,
    configs: list[LLMProviderConfig],
) -> LLMClient:
    """选真实 LLM；没匹配 / 缺 key → 返回 DevScriptedLLM，emit warning."""
```

降级策略：

| 情况 | 选谁 | 通知方式 |
|---|---|---|
| `task_provider_id` 为 None | `DevScriptedLLM` | 启动日志 |
| `task_provider_id` 在 env 找不到 / env 完全没配 | `DevScriptedLLM` | `task_started` payload 加 `llm_mode: "stub"` + `llm_fallback_reason: "<原因>"`（不发 `tool_fallback_model`，因还没有任何 step 执行） |
| 调用真实 LLM 时 HTTP 401/403 | 立即 raise `LLMError` → 走 runtime 的 `tool_error` 流程 → 该 step 失败、后续步骤退回 stub | `tool_error` 事件 |
| 调用真实 LLM 时 5xx / 429 / timeout | retry 1 次（指数退避）；仍失败 → 走 `tool_error` | `tool_error` 事件 |

### 4.2 后端：OpenAICompatibleLLMClient

新文件 [backend/app/agent/openai_llm_client.py](file:///c:\Users\25315\PycharmProjects\dramaforge-ai\backend\app\agent\openai_llm_client.py)

实现 [backend/app/agent/llm.py#L150-L168](file:///c:\Users\25315\PycharmProjects\dramaforge-ai\backend\app\agent\llm.py#L150-L168) 定义的 `LLMClient` Protocol。

```python
class OpenAICompatibleLLMClient:
    def __init__(self, base_url: str, api_key: str, model: str): ...

    async def generate(self, messages, tools=None, temperature=0.7, max_tokens=4000) -> LLMResponse:
        # POST {base_url}/v1/chat/completions
        # 解析 tool_calls → 复用 _parse_function_call
        # 解析 usage → prompt_tokens / completion_tokens / cost_usd(按 token 估算)

    async def generate_structured(self, messages, json_schema=None, ...) -> LLMResponse:
        # 同样 endpoint，加 response_format={"type": "json_object"}
```

关键点：
- 用 `httpx.AsyncClient`（与 FastAPI 异步一致；不要 requests 阻塞）
- 超时 60s；retry 1 次（指数退避 1s）以容忍瞬时网络抖动
- 401 / 403 / 404 立刻 raise `LLMError`，不 retry（避免打空 key）
- prompt 里 tools 格式按 OpenAI function calling 标准：`{"type": "function", "function": {"name", "description", "parameters"}}`
- 18 个工具的 `LLMClient` 协议签名不变，新增的客户端只是 Protocol 的另一实现

### 4.3 后端：AgentTask schema 加两字段

修改 [backend/app/models/agent_task.py](file:///c:\Users\25315\PycharmProjects\dramaforge-ai\backend\app\models\agent_task.py) 与对应 [schemas](file:///c:\Users\25315\PycharmProjects\dramaforge-ai\backend\app\models) / migration：

```python
llm_provider_id: str | None = None    # 'openai' / 'deepseek' / ... ；None = dev/stub
llm_model_id: str | None = None       # 实际使用的模型
```

`_spawn_runtime` 改造：

```python
async def _spawn_runtime(task_dict: dict) -> None:
    llm = select_llm_for_task(
        task_provider_id=task_dict.get("llm_provider_id"),
        configs=load_llm_configs_from_env(),
    )
    # media service 仍 stub（本期范围）
    media = StubMediaService()
    # ... 后续不变
```

启动时 emit `task_started` payload 加 `llm_mode: "real" | "stub"`，让 UI 能展示。

### 4.4 前端：api.startAgent 接受 provider_id

修改 [services/apiClient.ts](file:///c:\Users\25315\PycharmProjects\dramaforge-ai\services\apiClient.ts) `startAgent`：

```typescript
startAgent(projectId: string, goal: string, opts?: { providerId?: string; modelId?: string }): Promise<...>
```

默认 `opts.providerId` 取 `useCanvasStore.getState().apiConfig.stepBindings?.llm?.providerId`（沿用前端已配置的 provider 选择，但**不发 key**）。

[agent/agent-mode.tsx](file:///c:\Users\25315\PycharmProjects\dramaforge-ai\agent\agent-mode.tsx) `onSubmit` 传 opts。

前端 UI 不变（用户仍可在 ApiSettingsModal 配 key — 那只是让前端画布自己的图像/视频/Agent 走前端代理；后端 agent 走 env）。但要在 ApiSettingsModal 顶部加一个 **小提示**：「Agent 流程使用后端环境变量中的 API key；此处的 key 仅供画布自身生成使用」。

## 5. 数据流

```text
User opens ApiSettingsModal
  → configures provider (openai/deepseek/...) + (key 仅用于画布自身)
  → saved to localStorage

User 在 AgentMode 输入目标
  → onSubmit → api.startAgent(projectId, goal, { providerId: config.stepBindings.llm.providerId })
  → POST /api/agent/tasks  { project_id, user_goal, llm_provider_id, llm_model_id }
  → backend: AgentTask row 入库
  → backend: asyncio.create_task(_spawn_runtime(task_dict))
  → backend: _spawn_runtime
       → llm = select_llm_for_task(provider_id, load_llm_configs_from_env())
         - provider_id 匹配 + env 有 key → OpenAICompatibleLLMClient
         - 否则 → DevScriptedLLM
       → runtime.run_loop()
         - llm.generate(messages) → 真实 POST env.LLM_BASE_URL/v1/chat/completions
                                    或  DevScriptedLLM 返回预设决策
       → 事件流通过 SSE 推给前端，前端 UI 不变
```

## 6. 错误处理

| 失败点 | 处理 |
|---|---|
| env 完全没配（无 LLM_API_KEY / LLM_PROVIDERS_JSON） | 启动时 logging.warning 一次；agent 自动退回 stub；`task_started` payload 含 `llm_mode: "stub"` |
| env 配了但 `task_provider_id` 不在 env 中 | `tool_fallback_model` 事件 + 退回 stub |
| 真实 LLM 调用 401/403/404 | 立即 raise `LLMError`；runtime 走 `tool_error` 流程 + 计入 step 失败；不在该 task 后续步骤继续尝试（避免反复打空） |
| 真实 LLM 调用 429/5xx/timeout | retry 1 次（指数退避）；仍失败 → `tool_error` |
| 网络中断 | retry 完仍失败 → 走 fallback（dev 模式提示） |

## 7. 测试

### 7.1 新增单元测试

`backend/tests/test_openai_llm_client.py`：
- `test_openai_client_builds_correct_request` — 验证请求体（URL / headers / body schema）
- `test_openai_client_parses_tool_call_response` — 验证 tool_calls 解析
- `test_openai_client_parses_text_response` — 验证纯文本响应
- `test_openai_client_retries_on_5xx` — 用 respx mock HTTP 5xx
- `test_openai_client_raises_on_401` — 不 retry
- `test_openai_client_handles_timeout` — 用 respx mock 慢响应

`backend/tests/test_llm_factory.py`：
- `test_factory_returns_real_llm_when_env_configured`
- `test_factory_falls_back_to_stub_when_no_env`
- `test_factory_falls_back_when_provider_id_unknown`
- `test_factory_loads_multiple_providers_from_json`

### 7.2 回归

- `backend/tests/test_agent_e2e.py` — 不变（仍走 DevScriptedLLM，验证 stub 流程）
- `backend/tests/test_runtime_autostart.py` — 不变
- `backend/tests/test_sse_replay_buffer.py` — 不变
- `backend/tests/test_agent_routes.py` — 加一个 case：POST /api/agent/tasks 带 `llm_provider_id` 字段
- 前端 127 个测试 — 不变

## 8. 实施顺序（写完 spec 后由 writing-plans skill 拆 task）

1. 后端：env 解析 + LLMProviderConfig dataclass + `load_llm_configs_from_env`
2. 后端：`OpenAICompatibleLLMClient` 实现 + 单元测试
3. 后端：`select_llm_for_task` factory + 单元测试
4. 后端：AgentTask schema 加 `llm_provider_id` / `llm_model_id` + 路由接收 + `_spawn_runtime` 改造
5. 前端：`api.startAgent` 接受 opts；`agent-mode.tsx` 传 provider_id
6. 前端：ApiSettingsModal 顶部加 env 说明
7. 跑全部测试（127 前端 + 172+ 后端）确保无回归
