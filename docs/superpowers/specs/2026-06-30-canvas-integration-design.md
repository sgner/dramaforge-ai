# AgentMode × InfiniteCanvas 集成 — Design Spec

> **日期**：2026-06-30
> **状态**：待用户审阅
> **范围**：把 spec 2026-06-30-agent-mode-design.md 第 2.1 节里 4 个画布相关改动补齐
> **前置**：上一阶段 9 个任务全部完成（commit 509da65），AgentMode 占位符已建，TaskGraphNode 已独立化

## 0. 全局约束

- 现有 71 个前端测试 + 128 个后端测试必须全过
- 不破坏 InfiniteCanvas 现有 9 种 NodeType 的语义
- `useAgentStore` API 保持不变（仅在前端组件内订阅）
- 不引入新的外部依赖
- TaskGraphNode 的现有 props (`data: TaskGraphNodeData`) 保持兼容
- 浮层/抽屉的实现沿用现有 React + CSS 风格，不引入重型 UI 库
- Python 包管理使用 uv（已确认）
- 测试覆盖：addAgentNodes 单测 + CanvasNodeComponent 渲染测试 + AgentMode 集成测试

## 1. 架构

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 720 420" font-family="ui-monospace,monospace" font-size="12">
  <rect x="10" y="10" width="700" height="280" fill="#f8fafc" stroke="#94a3b8" rx="6"/>
  <text x="20" y="30" font-weight="bold">AgentMode Page</text>

  <rect x="30" y="50" width="180" height="220" fill="#eef2ff" stroke="#6366f1" rx="4"/>
  <text x="40" y="70">Input bar</text>
  <text x="40" y="86">+ TaskList</text>

  <rect x="230" y="50" width="320" height="220" fill="#fdf2f8" stroke="#ec4899" rx="4"/>
  <text x="240" y="70">InfiniteCanvas</text>
  <text x="240" y="86" fill="#475569">├─ CanvasToolbar</text>
  <text x="240" y="102" fill="#475569">├─ agent_node × N (7 列)</text>
  <text x="240" y="118" fill="#475569">├─ CanvasLinks</text>
  <text x="240" y="134" fill="#475569">└─ ThoughtStream 浮层 (右上)</text>

  <rect x="570" y="50" width="130" height="220" fill="#ecfdf5" stroke="#10b981" rx="4"/>
  <text x="580" y="70">ToolPalette</text>
  <text x="580" y="86" fill="#475569">抽屉 (右侧)</text>

  <text x="240" y="180" fill="#0f172a" font-weight="bold">列布局:</text>
  <text x="240" y="198" fill="#475569">x=0:goal | x=320:plan | x=640:action | x=960:obs</text>
  <text x="240" y="214" fill="#475569">x=1280:artifact | x=1600:question | x=1920:done</text>
  <text x="240" y="234" fill="#475569">节点宽 280，垂直间距 40，列内 y 累加 240</text>

  <line x1="360" y1="290" x2="360" y2="320" stroke="#64748b" marker-end="url(#arr)"/>
  <defs>
    <marker id="arr" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
      <path d="M0,0 L10,5 L0,10 z" fill="#64748b"/>
    </marker>
  </defs>

  <rect x="10" y="320" width="700" height="90" fill="#0f172a" stroke="#0f172a" rx="4"/>
  <text x="20" y="340" fill="#94a3b8">Data flow</text>
  <text x="20" y="358" fill="#cbd5e1">useAgentStream → useAgentStore.applyEvent → 订阅 thoughts/actions/observations/plan/artifacts</text>
  <text x="20" y="376" fill="#cbd5e1">AgentMode 组件 useEffect 依赖上述字段 → 调 useCanvasStore.addAgentNodes({...})</text>
  <text x="20" y="394" fill="#cbd5e1">addAgentNodes → 对每事件 addNode / updateNode (x 落列, y 累加, override 偏移)</text>
</svg>
```

## 2. 组件清单 + 接口

### 2.1 前端新增/修改

| 文件 | 行为 |
|---|---|
| `components/infinite-canvas/types.ts` (改) | + `'agent_node'` 到 NodeType 枚举 |
| `components/infinite-canvas/CanvasNode.tsx` (改) | + 渲染分支：`node.type === 'agent_node'` 时读取 `_agentTaskType` / `_agentStatus` / `_agentPayload`，复用 TaskGraphNode 视觉 |
| `components/infinite-canvas/use-canvas-store.ts` (改) | + `nodeOverrides: Record<string, {dx: number; dy: number}>` 字段 + `addAgentNodes(input)` action |
| `agent/agent-mode.tsx` (改) | 替换画布占位符为 `<InfiniteCanvas projectId={projectId} />`；加 useEffect 订阅 useAgentStore 投影到 useCanvasStore；ThoughtStream 改为右上浮层（可隐藏）；ToolPalette 改为右侧抽屉（默认关闭 + 触发按钮） |
| `agent/thought-stream.tsx` (改) | 增加 `floating?: boolean` props + `onClose?` callback；floating=true 时绝对定位右上 |
| `agent/tool-palette.tsx` (无改动) | 保持现有实现，AgentMode 控制其容器可见性 |
| `agent/task-graph-node.tsx` (无改动) | 视觉模板来源；CanvasNodeComponent 内部内联其逻辑（不强制 import 避免循环） |
| `tests/agent/add-agent-nodes.test.ts` (新) | addAgentNodes 单元测试 |
| `tests/infinite-canvas/canvas-node-agent.test.tsx` (新) | agent_node 渲染分支测试 |
| `tests/agent/agent-mode-canvas.test.tsx` (新) | AgentMode × InfiniteCanvas 集成测试 |

### 2.2 核心接口签名

**TypeScript：**

```typescript
// types.ts
export type NodeType =
  | 'image' | 'prompt' | 'loop' | 'group' | 'promptGroup'
  | 'video' | 'pipeline' | 'novel' | 'script'
  | 'agent_node';  // 新增

// CanvasNode 额外字段（用 _ 前缀避免与现有 key 冲突）
// _agentTaskType: TaskType  // 'goal' | 'plan' | 'action' | 'observation' | 'artifact' | 'question' | 'done'
// _agentStatus: TaskStatus  // 'pending' | 'running' | 'success' | 'failed'
// _agentPayload: Record<string, any>
// _agentLabel: string

// useCanvasStore 新增
nodeOverrides: Record<string, { dx: number; dy: number }>;
addAgentNodes(input: {
  userGoal: string;
  plan: any[];
  actions: AgentEventLike[];
  observations: AgentEventLike[];
  artifacts: Record<string, ArtifactItem[]>;
  pendingQuestion: PendingQuestion | null;
}): void;
clearAgentNodes: () => void;  // 切 projectId 时调，移除所有 type==='agent_node' 的节点

// AgentMode 内部 layout 坐标常量
const AGENT_COL_X: Record<TaskType, number> = {
  goal: 0, plan: 320, action: 640, observation: 960,
  artifact: 1280, question: 1600, done: 1920,
};
const AGENT_NODE_W = 280;
const AGENT_NODE_H = 200;  // 默认
const AGENT_ROW_GAP = 40;

// ThoughtStream 新 props
ThoughtStream: React.FC<{
  floating?: boolean;
  open?: boolean;
  onClose?: () => void;
}>
```

## 3. 数据流

1. **用户输入目标** → `api.startAgent(projectId, goal)` → 拿到 `taskId`
2. **useAgentStream(taskId)** 订阅 SSE → `useAgentStore.applyEvent(event)` 投影
3. **AgentMode** `useEffect` 依赖 `useAgentStore` 的 `thoughts/actions/observations/plan/artifacts/pendingQuestion`
4. 每次依赖变化时调 `useCanvasStore.addAgentNodes({...})`：
   - 遍历每个事件 → 计算 `(col.x + override.dx, baseY + override.dy + index * (h + gap))`
   - 已存在的 node（id 匹配）→ `updateNode` 更新 status / payload
   - 新事件 → `addNode` 插入
5. **CanvasNodeComponent** 渲染 `agent_node` 类型时，调用内联的 `<AgentNodeBody>`（基于 TaskGraphNode 视觉）
6. **用户拖动节点** → `onDragStart` 触发 `useCanvasStore` 的 `moveNode`，同时记录 `nodeOverrides[id] = {dx: curX - col.x, dy: curY - baseY}`
7. 后续新事件使用 override 偏移

## 4. addAgentNodes 行为详解

```typescript
function addAgentNodes(input) {
  const { userGoal, plan, actions, observations, artifacts, pendingQuestion } = input;
  const state = get();

  // 1) goal 节点（每个 task 唯一）
  if (userGoal) {
    const id = `agent-goal-${projectId}`;
    upsertNode(id, 'goal', userGoal, { text: userGoal });
  }

  // 2) plan 节点（每次 plan_ready 事件唯一）
  if (plan && plan.length) {
    const id = `agent-plan-${projectId}`;
    upsertNode(id, 'plan', `计划 (${plan.length} 步)`, { plan });
  }

  // 3) action 节点（每个 action 事件一个）
  actions.forEach((evt, i) => upsertAgentItem(evt, 'action', i, { tool: evt.payload?.tool, args: evt.payload?.args }));

  // 4) observation 节点（每个 observation 事件一个）
  observations.forEach((evt, i) => upsertAgentItem(evt, 'observation', i, { result: evt.payload?.result, error: evt.payload?.error }));

  // 5) artifact 节点（每个资产一个）
  Object.values(artifacts).flat().forEach((item, i) => {
    const id = `agent-artifact-${item.id}`;
    upsertNode(id, 'artifact', item.name || item.asset_kind, { kind: item.kind, url: item.url, snippet: item.snippet }, 'success');
  });

  // 6) pendingQuestion 节点
  if (pendingQuestion) {
    const id = `agent-question-${projectId}`;
    upsertNode(id, 'question', '等待用户回答', { question: pendingQuestion.question, options: pendingQuestion.options });
  }

  // 7) done 节点（task 完成后由 AgentMode 主动调 addAgentNodes 触发）
}
```

**upsertNode 内部**：
```typescript
function upsertNode(id, taskType, label, payload, status='pending') {
  const col = AGENT_COL_X[taskType];
  const existing = state.nodes.find(n => n.id === id);
  const override = state.nodeOverrides[id] || { dx: 0, dy: 0 };
  const colIndex = countNodesInCol(taskType);  // 同列已有多少个
  const x = col + override.dx;
  const y = baseY + override.dy + colIndex * (AGENT_NODE_H + AGENT_ROW_GAP);

  const canvasNode = {
    id, type: 'agent_node', x, y, w: AGENT_NODE_W, h: AGENT_NODE_H,
    _agentTaskType: taskType, _agentStatus: status, _agentPayload: payload, _agentLabel: label,
  };

  if (existing) {
    // 保留用户拖动后的 y 偏移：只更新 _agent* 字段
    updateNode(id, {
      _agentStatus: status, _agentPayload: payload, _agentLabel: label,
    });
  } else {
    addNode(canvasNode);
  }
}
```

**用户拖动记录**（在 CanvasNodeComponent 的 moveNode 后）：
```typescript
// 在 InfiniteCanvas 的拖动回调中追加
const handleNodeDragEnd = useCallback((id) => {
  const node = get().nodes.find(n => n.id === id);
  if (node && node.type === 'agent_node') {
    const taskType = node._agentTaskType as TaskType;
    const colX = AGENT_COL_X[taskType];
    set((s) => ({
      nodeOverrides: { ...s.nodeOverrides, [id]: { dx: node.x - colX, dy: node.y - baseY } }
    }));
  }
}, []);
```

## 5. 错误处理

| 场景 | 行为 |
|---|---|
| useAgentStore 缺字段 | `addAgentNodes` 接受 undefined → 跳过该类 |
| 同 id 节点已存在 | `updateNode` 而非 `addNode`（避免重复） |
|- 切任务 (projectId 变化) | AgentMode 在 useEffect cleanup 调 `clearAgentNodes()`，从 `useCanvasStore.nodes` 中过滤删除所有 `type==='agent_node'` 的节点；`nodeOverrides` 不主动清空（keyed by id，旧 id 不再被引用会自动过期） |
| 拖动 race condition | override 用 set 覆盖写，最后一次胜出 |
| agent_node 接收空 payload | 显示 "—" 占位 |
| TaskGraphNode 与新视觉差异 | CanvasNodeComponent 内联实现，不依赖外部组件，确保一致 |

## 6. 测试策略

### 6.1 单元测试

- **`tests/infinite-canvas/add-agent-nodes.test.ts`**：
  - 调 addAgentNodes 传入 1 个 goal → 验证 nodes 数组 +1，id 格式正确，x=0
  - 传入 3 个 action → 验证 x=640，y 分别为 0/240/480
  - 同 id 第二次调用 → 验证 updateNode 而非 addNode
  - 传入 artifacts 跨 3 个 bucket → 验证合并后扁平
  - 传入 pendingQuestion → 验证 question 节点存在

- **`tests/infinite-canvas/canvas-node-agent.test.tsx`**：
  - 渲染 `<CanvasNodeComponent node={{type:'agent_node', _agentTaskType:'goal', ...}} />` → 验证 badge 文本"🎯 目标"
  - `_agentStatus='running'` → 验证 "◐ 执行中" 文本
  - `_agentTaskType='artifact'` + payload.kind='image' → 验证 img 标签
  - `_agentTaskType='plan'` + payload.plan.length=3 → 验证 3 个 li

### 6.2 集成测试

- **`tests/agent/agent-mode-canvas.test.tsx`**：
  - 渲染 `<AgentMode projectId="p1" />` → 验证 `data-testid="infinite-canvas"` 存在（占位符 testid 移除）
  - mock useAgentStore 状态含 2 个 actions → 调 addAgentNodes → 验证 useCanvasStore.nodes 长度 ≥ 3
  - toggle floating → 验证 ThoughtStream testid 变化
  - click ToolPalette toggle → 验证抽屉打开

### 6.3 TDD 顺序

按子代理驱动开发的"先失败测试 + 后实现"循环：
1. 类型 + addAgentNodes 接口 → 写测试 → 实现 → 验证
2. CanvasNodeComponent agent_node 分支 → 写测试 → 实现 → 验证
3. AgentMode × InfiniteCanvas 集成 → 写测试 → 实现 → 验证
4. ThoughtStream 浮层 + ToolPalette 抽屉样式 → 写测试 → 实现 → 验证

## 7. 范围外（明确不做）

- ❌ agent_node 之间的连线（plan → action → observation 因果链）
- ❌ agent_node 选中后的详情侧栏
- ❌ 节点右键菜单（删除/复制等）
- ❌ 多任务并行展示（先支持单 task）
- ❌ 缩放画布的特殊适配（复用现有 InfiniteCanvas 行为）
- ❌ 把 useCanvasStore 拆分为独立 agent store（保持单 store）
- ❌ 后端改动（纯前端集成）
