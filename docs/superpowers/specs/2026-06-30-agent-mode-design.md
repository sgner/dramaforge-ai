# AgentMode 页面 + 工具远端化 + 任务列表 + SSE 优化 — Design Spec

> **日期**：2026-06-30
> **状态**：待用户审阅
> **范围**：单 spec + 多 task plan，4 个 feature 顺序推进

## 0. 全局约束

- 现有 53 个前端测试 + 123 个后端测试必须全过
- 不动 `useAgentStore` 的对外 API
- 不动 18 工具的 `name`/`category` 字段（仅允许新增 metadata）
- 前端画布**复用现有 InfiniteCanvas**（自定义实现，非 react flow）
- 架构图统一用 SVG 绘制
- Python 包管理使用 uv（已确认）

## 1. 架构

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 720 380" font-family="ui-monospace,monospace" font-size="12">
  <rect x="10" y="10" width="700" height="200" fill="#f8fafc" stroke="#94a3b8" rx="6"/>
  <text x="20" y="30" font-weight="bold">AgentMode Page (新)</text>
  <rect x="30" y="50" width="160" height="140" fill="#eef2ff" stroke="#6366f1" rx="4"/>
  <text x="40" y="70">ThoughtStream</text>
  <rect x="210" y="50" width="320" height="140" fill="#fdf2f8" stroke="#ec4899" rx="4"/>
  <text x="220" y="70">InfiniteCanvas (TaskGraph 节点)</text>
  <rect x="550" y="50" width="150" height="140" fill="#ecfdf5" stroke="#10b981" rx="4"/>
  <text x="560" y="70">ToolPalette</text>
  <rect x="30" y="170" width="670" height="30" fill="#fef3c7" stroke="#f59e0b" rx="4"/>
  <text x="40" y="190">Input bar: [描述目标] [创建任务] [任务列表]</text>

  <line x1="360" y1="210" x2="360" y2="240" stroke="#64748b" marker-end="url(#arr)"/>
  <defs>
    <marker id="arr" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
      <path d="M0,0 L10,5 L0,10 z" fill="#64748b"/>
    </marker>
  </defs>

  <rect x="10" y="240" width="700" height="120" fill="#0f172a" stroke="#0f172a" rx="4"/>
  <text x="20" y="260" fill="#94a3b8">Backend (FastAPI + uv)</text>
  <text x="20" y="280" fill="#cbd5e1">GET  /api/agent/tools          (返回 18 工具元数据)</text>
  <text x="20" y="296" fill="#cbd5e1">POST /api/agent/tasks          (project_id + user_goal → taskId)</text>
  <text x="20" y="312" fill="#cbd5e1">GET  /api/agent/tasks/{id}/stream  (SSE)</text>
  <text x="20" y="328" fill="#cbd5e1">POST /api/agent/tasks/{id}/respond (用户回答)</text>
  <text x="20" y="344" fill="#cbd5e1">GET  /api/agent/tasks?project_id=X (任务列表)</text>
</svg>
```

## 2. 组件清单 + 接口

### 2.1 前端新增/修改

| 文件 | 行为 |
|---|---|
| `agent/agent-mode.tsx` (新) | 顶级组件：input + 任务列表 + InfiniteCanvas（带 ThoughtStream 浮层 + ToolPalette 抽屉） |
| `agent/task-list.tsx` (新) | 列出 project 下所有任务 |
| `agent/task-graph-node.tsx` (改) | 去掉 @xyflow/react 依赖；导出为普通 React 组件 |
| `agent/use-agent-stream.ts` (改) | 指数退避 (1s/2s/4s/8s cap 30s) + 切换 taskId dispose 旧 stream |
| `agent/use-agent-tools.ts` (新) | 拉 `/api/agent/tools`，失败 fallback 硬编码 |
| `agent/tool-palette.tsx` (改) | props 接收 `tools` |
| `components/infinite-canvas/InfiniteCanvas.tsx` (改) | 注册 `agent_node` 类型到 NodeTypes |
| `components/infinite-canvas/use-canvas-store.ts` (改) | +`addAgentNodes(plan, actions, observations, artifacts, pendingQuestion)` |
| `services/apiClient.ts` (改) | +`listAgentTasks(projectId)`、+`listAgentTools()` |

### 2.2 后端新增/修改

| 文件 | 行为 |
|---|---|
| `app/routers/agent.py` (改) | +`GET /api/agent/tools`、`+GET /api/agent/tasks?project_id=X` |
| `app/agent/runtime.py` (改) | step 中检测 `tool_name == "create_plan"` → 写入 `memory.plan` |
| `app/agent/tools/__init__.py` (改) | +`list_tool_metadata()` 导出 name/category/description/requires_approval |

### 2.3 核心接口签名

**前端（TypeScript）：**

```typescript
// useAgentStream 加重试
useAgentStream(
  taskId: string | null,
  options?: { backoffMs?: number; maxBackoffMs?: number }
): UseAgentStreamResult  // { state, disconnect, reconnect }

// 新 hook
useAgentTools(): { 
  tools: PaletteTool[]; 
  isLoading: boolean; 
  error: Error | null;
}

// 新组件
TaskList: React.FC<{ projectId: string; onSelect: (taskId: string) => void }>
AgentMode: React.FC<{ projectId: string }>
```

**后端（Python / FastAPI）：**

```python
@app.get("/api/agent/tools") -> list[ToolMetadata]
class ToolMetadata(BaseModel):
    name: str
    description: str
    category: str
    requires_approval: bool

@app.get("/api/agent/tasks") -> list[AgentTaskOut]
# query: project_id (optional)
```

## 3. 数据流

```
用户输入 goal
    ↓
AgentMode.onSubmit
    │  POST /api/agent/tasks {project_id, user_goal}
    ↓
taskId 返回
    ├── useAgentStore.setTask(taskId, "running")
    └── useAgentStream(taskId).open()
            ↓ SSE events
            useAgentStore.applyEvent
            ├── thought → thoughts[]
            ├── action → actions[]
            ├── observation → observations[]
            ├── plan_ready → plan[] (并触发后端 memory.plan 桥接)
            ├── artifact_created → artifacts[category]
            ├── request_user_input → pendingQuestion + status=paused
            ├── task_done / task_failed → status=done/failed
            └── cost_update → totalCostUsd

InfiniteCanvas 订阅 useAgentStore
    ├── plan[] → plan 节点
    ├── actions[] → action 节点
    ├── observations[] → observation 节点
    ├── artifacts[character/scene/shot/...][]
    │   → artifact 节点
    └── pendingQuestion → question 节点（高亮）

ToolPalette 订阅 useAgentTools()
    └── GET /api/agent/tools
            ├── 成功 → 远端 18 工具
            └── 失败 → fallback PALETTE_TOOLS 硬编码
```

**关键事件链：**
1. `task_started` → store: status=running
2. `plan_ready` → store: plan + 触发后端 runtime 把 result 写入 memory.plan
3. 用户回答 → `POST /api/agent/tasks/{id}/respond` → `user_input_received` → store: status=running
4. 任意阶段 `artifact_created` → 写入 DB + store
5. `task_done` → store: status=done + 关闭 SSE

## 4. 错误处理

| 场景 | 行为 |
|---|---|
| `POST /api/agent/tasks` 失败 | UI 弹错误提示 + 输入框恢复可编辑 |
| SSE 断开 | `useAgentStream` 自动重连 (指数退避)；UI 显示 "重新连接中…" |
| SSE 4 次重连失败 | 状态变 `error`，UI 提示用户重试 |
| `request_user_input` 超时未回答 | 后端超时自动恢复 running（v1 不实现，留 TODO） |
| `task_failed` 事件 | store 记录 error，UI 红色高亮 |
| `/api/agent/tools` 拉取失败 | 静默 fallback 到 PALETTE_TOOLS，控制台 warn |
| `useAgentStream` 切换 taskId | 旧 stream 立刻 close，新 stream open |

## 5. 测试策略

| 层 | 测试类型 | 关键 case |
|---|---|---|
| 后端 | pytest 单元 | runtime 检测 `create_plan` → memory.plan；`/api/agent/tools` 返回 18 项；`/api/agent/tasks?project_id=X` 过滤正确 |
| 前端 hook | vitest + @testing-library | `useAgentStream` 退避 (1s/2s/4s/8s, 4 次后转 error)、taskId 切换 close 旧 stream |
| 前端 hook | 同上 | `useAgentTools` 远端成功、远端失败 fallback |
| 前端组件 | 同上 | `TaskList` 渲染列表 + 状态着色 + 点击触发 onSelect |
| 端到端 | 集成测试 | 创建任务 → 模拟 SSE → 验证 store/artifacts 同步 |
| 既有 | 不动 | 53 个前端 + 123 个后端测试必须保持全过 |

## 6. 范围外（v1 不做）

- Plan 阶段强制用户审核 UI 流（v1.1）
- 旧 useTaskExecutor 与新 agent runtime 的兼容/切换开关
- 多用户协作
- WebSocket 替代 SSE
- 服务端 sandbox
