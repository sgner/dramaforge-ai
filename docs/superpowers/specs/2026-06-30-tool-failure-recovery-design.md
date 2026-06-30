# 工具失败恢复 (Tool Failure Recovery) — Design Spec

> **日期**：2026-06-30
> **状态**：待用户审阅
> **范围**：让 agent 在工具调用失败时自我恢复（自动重试 + 换模型），最后决策权交给用户
> **前置**：AgentMode × InfiniteCanvas 集成已完成（commit c97f4f4），6 个 task 全部落地
> **PRD 对应**：US-6 失败恢复

## 0. 全局约束

- 现有 100 个前端测试 + 131 个后端测试必须全过
- `Tool` / `BaseTool` / `ToolContext` / `ToolRegistry` 现有 API 保持兼容（只增字段/方法）
- `EventType` 枚举只增不改
- `AgentUserResponse` schema 只增字段不改语义
- 不引入新的外部依赖
- Python 包管理使用 uv（已确认）
- TDD：每个任务先写失败测试，再实现，最后验证全绿
- 测试运行命令：
  - 后端：`cd backend; uv run pytest -q`
  - 前端：`cd ..; npm test -- --run`

## 1. 目标 & 范围

### 1.1 目标

让 agent 在工具调用失败时**自我恢复**（自动重试 N 次 + 换 fallback 模型），并把**最后的决策权**交给用户（重试/换模型/跳过），确保单个工具失败不会让整个任务崩溃。

### 1.2 MVP 范围（本 spec 全部做）

- 工具调用失败自动重试 N 次（指数退避）
- 重试耗尽后自动换 fallback 模型重试一次
- 仍失败后挂起任务，前端弹模态卡让用户决策
- 3 选项：重试（同 params）、换模型（指定新 model_id）、跳过
- 跳过时注入 observation 让 agent 决定如何继续
- 后端推送 `tool_retrying` / `tool_fallback_model` / `tool_error` 三类事件
- 前端 ThoughtStream 显示重试/切换气泡
- 前端 ErrorRecoveryCard 画布中央模态卡

### 1.3 范围外（明确不做）

- ❌ 调用前高成本工具审批（属于 Spec A：人类介入）
- ❌ 跨任务重试策略累积（每次 task 独立）
- ❌ 自动重试 budget 全局上限（每个 tool 独立计数）
- ❌ 错误上报到 Sentry/Datadog
- ❌ Plan 阶段修改
- ❌ 分支 A/B 测试

## 2. 决策汇总

| 项 | 决策 | 理由 |
|---|---|---|
| 失败流程 | 自动重试 N 次 → 换 fallback 模型 → 问用户 | 三级降级，最大化自动恢复，保留用户控制 |
| Fallback 模型来源 | 每 tool 静态 `fallback_model_id` 字段 | 明确可控，与 PRD 一致 |
| 重试配置 | 每 tool 静态 `max_retries=2` + `retry_backoff_base=1.0` | 全局默认 + tool 可覆盖 |
| 恢复 UI | 画布中央模态卡 (ErrorRecoveryCard) | 注意焦点集中 |
| 跳过语义 | step 状态 `skipped`，observation 注入 `user_skip`，agent 决定下游 | 智能，不硬中断 |
| 换模型选项 | 查 `api_config` 同 category 模型下拉 | 与现有 ApiSettings 共享 |

## 3. 后端架构

### 3.1 RetryableTool 包装器

**文件**：`backend/app/agent/tools/base.py`（新增类）

包装任意 `BaseTool`，实现自动重试 + fallback_model 降级：

```python
class RetryableTool:
    """包装 Tool，实现自动重试 + fallback_model 降级。

    流程：
    1. 尝试原始 params 调用
    2. RetryableError → 指数退避重试 max_retries 次
    3. 仍失败 → 若 tool.fallback_model_id 存在，换模型重试 1 次
    4. 仍失败 → 抛 RetryableError 让 runtime 进入 PAUSED
    """

    def __init__(self, tool: BaseTool, max_retries: int | None = None, backoff_base: float | None = None):
        self.tool = tool
        self.max_retries = max_retries if max_retries is not None else getattr(tool, "max_retries", 2)
        self.backoff_base = backoff_base if backoff_base is not None else getattr(tool, "retry_backoff_base", 1.0)

    async def call(self, ctx: ToolContext, params: dict) -> dict:
        last_error: Exception | None = None
        original_model_id = params.get("model_id")

        for attempt in range(self.max_retries + 1):
            try:
                return await self.tool.call(ctx, params)
            except RetryableError as e:
                last_error = e
                if attempt < self.max_retries:
                    delay = self.backoff_base * (2 ** attempt)
                    ctx.emit_event("tool_retrying", {
                        "tool": self.tool.name,
                        "attempt": attempt + 1,
                        "max_retries": self.max_retries,
                        "delay_sec": delay,
                        "error": str(e),
                    })
                    await asyncio.sleep(delay)
                    continue
                # 重试耗尽 → 尝试 fallback_model
                fb = getattr(self.tool, "fallback_model_id", None)
                if fb and params.get("model_id") != fb:
                    new_params = {**params, "model_id": fb}
                    ctx.emit_event("tool_fallback_model", {
                        "tool": self.tool.name,
                        "from_model": original_model_id,
                        "to_model": fb,
                    })
                    try:
                        return await self.tool.call(ctx, new_params)
                    except RetryableError as e2:
                        last_error = e2
                # fallback 也失败或无 fallback → 抛出让 runtime 挂起
                break
            except NonRetryableError:
                raise  # 不可重试直接抛出
        raise last_error  # type: ignore[misc]
```

**关键属性透传**：`RetryableTool` 需暴露 `name` / `description` / `category` / `requires_approval` / `parameters` / `estimated_cost_usd` / `estimated_time_sec` / `idempotent` / `fallback_model_id` / `max_retries` / `retry_backoff_base`，通过 `__getattr__` 委托给 `self.tool`。

### 3.2 BaseTool 扩展字段

**文件**：`backend/app/agent/tools/base.py`（修改 `BaseTool`）

新增 3 个类属性：

```python
class BaseTool:
    # ... 现有字段 ...
    max_retries: int = 2
    retry_backoff_base: float = 1.0
    fallback_model_id: str | None = None
```

各 tool 子类按需覆盖（如 `GenerateVideoTool.fallback_model_id = "pika-v1"`）。

### 3.3 新增 EventType

**文件**：`backend/app/agent/events.py`

```python
class EventType(str, Enum):
    # ... 现有 ...
    STEP_RETRYING = "step_retrying"           # 已存在
    TOOL_RETRYING = "tool_retrying"           # 新增
    TOOL_FALLBACK_MODEL = "tool_fallback_model"  # 新增
    TOOL_ERROR = "tool_error"                 # 新增：挂起等待用户决策
    TOOL_RESUMED = "tool_resumed"             # 新增：用户决策后恢复
```

### 3.4 Runtime 改造

**文件**：`backend/app/agent/runtime.py`（修改 `_execute_tool`）

改造 `_execute_tool`：

1. 查 `tool` 后，用 `RetryableTool(tool)` 包装（若 tool 是 `BaseTool` 实例）
2. 调用 `RetryableTool.call(ctx, params)`
3. 捕获 `RetryableError`：
   - **不返回 failed**，而是：
     - 设置 `self.pending_request = {"type": "tool_error", "step_id": str(self._step_count), "tool": tool_name, "error": str(e), "params": params, "fallback_model_id": getattr(tool, "fallback_model_id", None), "available_models": self._list_available_models(tool)}`
     - 发 `tool_error` 事件
     - `self.state = AgentState.PAUSED`
     - 返回 `({"error": str(e), "pending": "awaiting_user_recovery"}, "paused")`

```python
async def _execute_tool(self, tool_name: str, params: dict) -> tuple[dict, str]:
    tool = self.registry.get(tool_name)
    if not tool:
        return {"error": f"Unknown tool: {tool_name}"}, "failed"

    ctx = ToolContext(
        task_id=self.task_id,
        project_id=self.project_id,
        db=self.db,
        llm_client=self.llm,
        api_config=self.api_config,
        artifacts=self.memory.artifacts,
        skip_confirm=self.skip_confirm,
        emit=lambda t, p: self._emit_sync(t, p),
    )
    wrapped = RetryableTool(tool) if isinstance(tool, BaseTool) else tool
    try:
        result = await wrapped.call(ctx, params)
        return {"success": True, "result": result}, "success"
    except ToolValidationError as e:
        return {"error": str(e)}, "failed"
    except RetryableError as e:
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
```

**新增辅助方法**：

```python
def _list_available_models(self, tool) -> list[dict]:
    """查询同 category 的可用模型列表（供前端下拉）。"""
    if not self.api_config:
        return []
    category = getattr(tool, "category", "")
    # api_config 应提供 list_models(category) 方法
    models = self.api_config.list_models(category) if hasattr(self.api_config, "list_models") else []
    return [{"id": m.get("id"), "label": m.get("label", m.get("id"))} for m in models]
```

### 3.5 resume() 扩展

**文件**：`backend/app/agent/runtime.py`（修改 `resume`）

`resume()` 现有逻辑处理 `ask_user`。新增 `tool_error` 分支：

```python
async def resume(self, user_response: Any) -> bool:
    if self.state != AgentState.PAUSED:
        return False

    req = self.pending_request or {}
    req_type = req.get("type", "ask_user")

    if req_type == "tool_error":
        return await self._resume_from_tool_error(user_response)
    else:
        # 现有 ask_user 逻辑
        ...

async def _resume_from_tool_error(self, user_response: dict) -> bool:
    """用户对 tool_error 的响应：retry / change_model / skip。"""
    action = user_response.get("recovery_action", "retry")
    new_model_id = user_response.get("new_model_id")
    step_id = self.pending_request["step_id"]
    tool_name = self.pending_request["tool"]
    params = self.pending_request["params"]

    await self._emit(EventType.TOOL_RESUMED, {"step_id": step_id, "action": action})

    if action == "skip":
        # 注入 user_skip observation，step 标 skipped，agent 继续 think
        self.memory.add_step(
            step_number=self._step_count,
            thought="(user skipped)",
            action={"tool": tool_name, "params": params},
            observation={"success": False, "user_skip": True, "error": self.pending_request["error"]},
            status="skipped",
        )
        self.pending_request = None
        self.state = AgentState.RUNNING
        return await self.step()

    # retry / change_model → 重新执行该 step
    if action == "change_model" and new_model_id:
        params = {**params, "model_id": new_model_id}

    self.pending_request = None
    self.state = AgentState.RUNNING
    # 重新执行同一步（_step_count 不变）
    observation, status = await self._execute_tool(tool_name, params)
    # 记录 step + emit observation（复用主循环逻辑）
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
```

### 3.6 Schema 扩展

**文件**：`backend/app/schemas.py`（修改 `AgentUserResponse`）

```python
class AgentUserResponse(BaseModel):
    response: Optional[Any] = None
    approved: bool = True
    # 新增：失败恢复决策
    recovery_action: Optional[Literal["retry", "change_model", "skip"]] = None
    new_model_id: Optional[str] = None

    class Config:
        from_attributes = True
```

### 3.7 Router 改造

**文件**：`backend/app/routers/agent.py`（修改 `user_respond`）

`user_respond` 把 `recovery_action` / `new_model_id` 传给 runtime.resume：

```python
@router.post("/tasks/{task_id}/respond")
async def user_respond(task_id: str, body: schemas.AgentUserResponse, db: Session = Depends(get_db)):
    task = db.query(AgentTask).filter_by(id=task_id).first()
    if not task:
        raise HTTPException(404, f"Task {task_id} not found")
    task.pending_response = {"response": body.response, "approved": body.approved}
    if body.recovery_action:
        task.pending_response["recovery_action"] = body.recovery_action
    if body.new_model_id:
        task.pending_response["new_model_id"] = body.new_model_id
    if body.approved is False and task.status == "paused":
        task.status = "failed"
    db.commit()
    await event_bus.publish(AgentEvent(
        task_id=task_id, type=EventType.USER_INPUT_RECEIVED,
        payload={
            "response": body.response,
            "approved": body.approved,
            "recovery_action": body.recovery_action,
            "new_model_id": body.new_model_id,
        },
    ))
    return {"ok": True}
```

**注意**：runtime 实际 resume 由 runtime 主循环消费 `pending_response` 触发（现有机制不变），本 spec 仅扩展 payload。

## 4. 前端架构

### 4.1 useAgentStore 扩展

**文件**：`agent/use-agent-store.ts`

新增状态字段：

```typescript
export interface PendingErrorRecovery {
  stepId: string;
  tool: string;
  error: string;
  params: Record<string, any>;
  fallbackModelId: string | null;
  availableModels: { id: string; label: string }[];
}

export interface AgentState {
  // ... 现有 ...
  pendingErrorRecovery: PendingErrorRecovery | null;
  clearErrorRecovery: () => void;
}
```

`applyEvent` 新增 case：

```typescript
case 'tool_retrying':
  // 追加到 thoughts 显示 "🔄 重试中"
  return { thoughts: [...state.thoughts, event] };
case 'tool_fallback_model':
  return { thoughts: [...state.thoughts, event] };
case 'tool_error':
  return {
    pendingErrorRecovery: {
      stepId: p.step_id,
      tool: p.tool,
      error: p.error,
      params: p.params,
      fallbackModelId: p.fallback_model_id,
      availableModels: p.available_models || [],
    },
    status: 'paused',
  };
case 'tool_resumed':
  return { pendingErrorRecovery: null, status: 'running' };
```

### 4.2 ErrorRecoveryCard 组件

**新文件**：`agent/error-recovery-card.tsx`

画布中央模态卡：

```tsx
export const ErrorRecoveryCard: React.FC = () => {
  const pending = useAgentStore((s) => s.pendingErrorRecovery);
  const [action, setAction] = useState<'retry' | 'change_model' | 'skip'>('retry');
  const [modelId, setModelId] = useState<string>('');

  useEffect(() => {
    if (pending) {
      setAction('retry');
      setModelId(pending.fallbackModelId || (pending.availableModels[0]?.id ?? ''));
    }
  }, [pending]);

  if (!pending) return null;

  const onConfirm = async () => {
    await api.respond(taskId, {
      response: action,
      recovery_action: action,
      new_model_id: action === 'change_model' ? modelId : null,
    });
  };

  return (
    <div data-testid="error-recovery-card" style={overlayStyle}>
      <div style={cardStyle}>
        <h3>⚠ 工具执行失败</h3>
        <div data-testid="erc-tool">工具: <code>{pending.tool}</code></div>
        <div data-testid="erc-error">错误: {pending.error}</div>

        <div role="radiogroup">
          <label><input type="radio" name="erc-action" value="retry" checked={action==='retry'} onChange={...} /> 重试</label>
          <label><input type="radio" name="erc-action" value="change_model" ... /> 换模型</label>
          <label><input type="radio" name="erc-action" value="skip" ... /> 跳过</label>
        </div>

        {action === 'change_model' && (
          <select data-testid="erc-model-select" value={modelId} onChange={...}>
            {pending.availableModels.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
          </select>
        )}

        <button data-testid="erc-confirm" onClick={onConfirm}>确认</button>
      </div>
    </div>
  );
};
```

### 4.3 AgentMode 集成

**文件**：`agent/agent-mode.tsx`

在画布容器层加入 `<ErrorRecoveryCard />`：

```tsx
<div data-testid="agent-mode-canvas-container" style={{ position: 'absolute', inset: 0 }}>
  <InfiniteCanvas projectId={projectId} />
  <ErrorRecoveryCard />
</div>
```

### 4.4 ThoughtStream 增强

**文件**：`agent/thought-stream.tsx`

`fmtPayload` 已能处理任意 payload。新增对 `tool_retrying` / `tool_fallback_model` 的友好格式化：

```typescript
function fmtPayload(ev: AgentEventLike): string {
  const p = ev.payload || {};
  if (ev.type === 'tool_retrying') return `🔄 重试中 (第 ${p.attempt}/${p.max_retries} 次): ${p.error}`;
  if (ev.type === 'tool_fallback_model') return `↩ 已切换到备选模型: ${p.to_model}`;
  // ... 现有 ...
}
```

## 5. 数据流

```
1. AgentRuntime.step() → _execute_tool("generate_image", {...})
2. RetryableTool.call() 第 1 次失败 → emit tool_retrying → sleep 1s
3. RetryableTool.call() 第 2 次失败 → emit tool_retrying → sleep 2s
4. RetryableTool.call() 第 3 次失败（max_retries=2 耗尽）
5. fallback_model_id 存在 → emit tool_fallback_model → 换模型重试
6. fallback 也失败 → 抛 RetryableError
7. Runtime 捕获 → emit tool_error → state=PAUSED → pending_request 填充
8. 前端 useAgentStore.applyEvent('tool_error') → pendingErrorRecovery 填充
9. ErrorRecoveryCard 渲染 → 用户选 "换模型" + 选 model_id → 点击确认
10. POST /tasks/{id}/respond { recovery_action: "change_model", new_model_id: "X" }
11. 后端 user_respond → 写入 pending_response → emit USER_INPUT_RECEIVED
12. Runtime resume() → 检测 type=tool_error → _resume_from_tool_error
13. 重新执行 _execute_tool(同 tool, params.model_id=X)
14. 成功 → emit OBSERVATION → state=RUNNING → 继续 ReAct 循环
```

## 6. 错误处理矩阵

| 场景 | 行为 |
|---|---|
| RetryableError（网络超时） | 自动重试 max_retries 次 |
| NonRetryableError（参数错误） | 直接抛出，不重试，step failed |
| ToolValidationError | 直接抛出，step failed |
| 重试耗尽 + 无 fallback | 抛 RetryableError → runtime PAUSED → 问用户 |
| 重试耗尽 + 有 fallback + fallback 成功 | 返回成功结果，继续 |
| 重试耗尽 + 有 fallback + fallback 失败 | 抛 RetryableError → runtime PAUSED → 问用户 |
| 用户选 retry | 重新执行同 step 同 params |
| 用户选 change_model | params.model_id = new_model_id 后重执行 |
| 用户选 skip | step 状态 skipped，observation 注入 user_skip，agent 继续 think |
| api_config 为 None | available_models 返回空列表，用户仍可手动输入 |
| 用户长时间不响应 | task 保持 paused，不超时 |

## 7. 测试策略

### 7.1 后端单元测试

**新文件**：`backend/tests/test_retryable_tool.py`

- `RetryableTool` 成功调用：不重试，返回结果
- `RetryableError` 重试 max_retries 次后成功
- `RetryableError` 重试耗尽 + 无 fallback → 抛出
- `RetryableError` 重试耗尽 + 有 fallback + fallback 成功
- `RetryableError` 重试耗尽 + 有 fallback + fallback 失败 → 抛出
- `NonRetryableError` 不重试，直接抛出
- `ToolValidationError` 不重试，直接抛出
- emit `tool_retrying` 事件（验证 emit_event 被调用）
- emit `tool_fallback_model` 事件
- 指数退避 sleep 被调用（mock asyncio.sleep）

**修改**：`backend/tests/test_agent_runtime.py`

- `_execute_tool` 捕获 RetryableError → 设置 pending_request + state=PAUSED
- `_execute_tool` 推送 tool_error 事件
- `_resume_from_tool_error` retry 路径
- `_resume_from_tool_error` change_model 路径
- `_resume_from_tool_error` skip 路径（observation 注入 user_skip）

### 7.2 前端单元测试

**新文件**：`tests/agent/error-recovery-card.test.tsx`

- pendingErrorRecovery 为 null → 不渲染
- pendingErrorRecovery 存在 → 渲染模态卡
- 默认选中 "retry"
- 选 "change_model" → 显示模型下拉
- 点击确认 → 调用 api.respond + 正确 payload
- 显示 tool name 和 error

**修改**：`tests/agent/use-agent-store.test.ts`

- applyEvent('tool_error') → pendingErrorRecovery 填充 + status=paused
- applyEvent('tool_resumed') → pendingErrorRecovery 清空 + status=running
- applyEvent('tool_retrying') → thoughts 追加
- applyEvent('tool_fallback_model') → thoughts 追加

**修改**：`tests/agent/thought-stream.test.tsx`

- tool_retrying 事件显示 "🔄 重试中"
- tool_fallback_model 事件显示 "↩ 已切换"

### 7.3 TDD 顺序

按子代理驱动开发的"先失败测试 + 后实现"循环：

1. **Task 1**：`RetryableTool` 包装器 + `BaseTool` 扩展字段 → 写测试 → 实现 → 验证
2. **Task 2**：`EventType` 新增 3 类 + `events.py` → 写测试 → 实现 → 验证
3. **Task 3**：`Runtime._execute_tool` 改造 + `_resume_from_tool_error` → 写测试 → 实现 → 验证
4. **Task 4**：`Schema` 扩展 + `Router` 改造 → 写测试 → 实现 → 验证
5. **Task 5**：`useAgentStore` 扩展 + `ErrorRecoveryCard` 组件 → 写测试 → 实现 → 验证
6. **Task 6**：`AgentMode` 集成 + `ThoughtStream` 增强 → 写测试 → 实现 → 验证

## 8. 文件清单

| 文件 | 改动 | 责任 |
|---|---|---|
| `backend/app/agent/tools/base.py` (改) | + `RetryableTool` 类 + `BaseTool` 3 字段 | 重试 + fallback 包装 |
| `backend/app/agent/events.py` (改) | + 3 个 EventType | 事件类型 |
| `backend/app/agent/runtime.py` (改) | `_execute_tool` 改造 + `_resume_from_tool_error` + `_list_available_models` | 挂起 + 恢复 |
| `backend/app/schemas.py` (改) | `AgentUserResponse` + 2 字段 | API schema |
| `backend/app/routers/agent.py` (改) | `user_respond` 传递 recovery 字段 | 路由 |
| `agent/use-agent-store.ts` (改) | + `pendingErrorRecovery` + 4 个 case | 前端状态 |
| `agent/error-recovery-card.tsx` (新) | 模态卡组件 | UI |
| `agent/agent-mode.tsx` (改) | 挂载 ErrorRecoveryCard | 集成 |
| `agent/thought-stream.tsx` (改) | fmtPayload 增强 | 显示 |
| `backend/tests/test_retryable_tool.py` (新) | RetryableTool 单测 | TDD |
| `backend/tests/test_agent_runtime.py` (改) | runtime 改造测试 | TDD |
| `tests/agent/error-recovery-card.test.tsx` (新) | 组件测试 | TDD |
| `tests/agent/use-agent-store.test.ts` (改) | store 扩展测试 | TDD |
| `tests/agent/thought-stream.test.tsx` (改) | 显示增强测试 | TDD |

## 9. 任务依赖图

```
Task 1 (RetryableTool + BaseTool fields)
   ↓
Task 2 (EventType + events.py)
   ↓
Task 3 (Runtime _execute_tool + _resume_from_tool_error)
   ↓
Task 4 (Schema + Router)
   ↓
Task 5 (useAgentStore + ErrorRecoveryCard)
   ↓
Task 6 (AgentMode integration + ThoughtStream)
```

任务间严格串行：后端 runtime 完成后前端才能集成。

## 10. 验收标准

- [ ] RetryableTool 单测全绿（10+ 用例）
- [ ] Runtime 失败恢复路径单测全绿
- [ ] ErrorRecoveryCard 组件测试全绿
- [ ] useAgentStore 新 case 测试全绿
- [ ] 现有 100 前端 + 131 后端测试不回归
- [ ] 手动验证：构造一个会失败的工具调用，观察自动重试 → fallback → 模态卡 → 用户恢复 全流程
