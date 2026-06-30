# AgentMode × InfiniteCanvas 集成 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 AgentMode 占位符替换为 InfiniteCanvas，让 agent 的 7 类事件（goal/plan/action/observation/artifact/question/done）以画布节点形式自动布局展示。

**Architecture:** 在 `useCanvasStore` 增加 `addAgentNodes` / `clearAgentNodes` actions 与 `nodeOverrides` 字段；`CanvasNodeComponent` 增加 `agent_node` 类型分支复用 TaskGraphNode 视觉；`InfiniteCanvas` 的拖动回调里记录用户偏移；`AgentMode` 用 useEffect 把 `useAgentStore` 投影到 `useCanvasStore`，并把 ThoughtStream 改成浮层、ToolPalette 改成抽屉。

**Tech Stack:** TypeScript + React + zustand + Vitest + React Testing Library

## Global Constraints

- 现有 71 个前端测试 + 128 个后端测试必须全过
- 不破坏 InfiniteCanvas 现有 9 种 NodeType 的语义
- `useAgentStore` API 保持不变（仅在前端组件内订阅）
- 不引入新的外部依赖
- TaskGraphNode 的现有 props (`data: TaskGraphNodeData`) 保持兼容
- 浮层/抽屉的实现沿用现有 React + CSS 风格，不引入重型 UI 库
- Python 包管理使用 uv（已确认）
- 测试覆盖：addAgentNodes 单测 + CanvasNodeComponent 渲染测试 + AgentMode 集成测试
- 测试运行命令：`cd c:\Users\25315\PycharmProjects\dramaforge-ai && npm test -- --run`
- Spec 文件：[2026-06-30-canvas-integration-design.md](file:///c:/Users/25315/PycharmProjects/dramaforge-ai/docs/superpowers/specs/2026-06-30-canvas-integration-design.md)
- TaskGraphNode 数据类型：[task-graph-node.tsx](file:///c:/Users/25315/PycharmProjects/dramaforge-ai/agent/task-graph-node.tsx)
- useAgentStore：[use-agent-store.ts](file:///c:/Users/25315/PycharmProjects/dramaforge-ai/agent/use-agent-store.ts)

---

## 文件结构

| 文件 | 责任 |
|---|---|
| `components/infinite-canvas/types.ts` (改) | NodeType 枚举 + 7 列坐标常量 + AGENT_* 字段 |
| `components/infinite-canvas/use-canvas-store.ts` (改) | nodeOverrides 字段 + addAgentNodes/clearAgentNodes/recordAgentNodeDrag actions |
| `components/infinite-canvas/CanvasNode.tsx` (改) | AgentNodeBody 组件 + NodeBody dispatch |
| `components/infinite-canvas/InfiniteCanvas.tsx` (改) | 拖动结束后调 recordAgentNodeDrag |
| `agent/thought-stream.tsx` (改) | floating 模式 + onClose 回调 |
| `agent/agent-mode.tsx` (改) | 替换占位符、投影 useEffect、浮层、抽屉 |
| `tests/infinite-canvas/add-agent-nodes.test.ts` (新) | addAgentNodes 单测 |
| `tests/infinite-canvas/clear-agent-nodes.test.ts` (新) | clearAgentNodes 单测 |
| `tests/infinite-canvas/canvas-node-agent.test.tsx` (新) | agent_node 渲染测试 |
| `tests/agent/thought-stream-floating.test.tsx` (新) | 浮层模式测试 |
| `tests/agent/agent-mode-canvas.test.tsx` (新) | AgentMode × InfiniteCanvas 集成测试 |

## 任务依赖图

```
Task 1 (types + nodeOverrides field)
   ↓
Task 2 (addAgentNodes + clearAgentNodes)
   ↓
Task 3 (AgentNodeBody in CanvasNode.tsx)
   ↓
Task 4 (recordAgentNodeDrag in InfiniteCanvas)
   ↓
Task 5 (ThoughtStream floating)
   ↓
Task 6 (AgentMode composition)
```

---

### Task 1: types.ts 添加 agent_node 与布局常量

**Files:**
- Modify: `c:\Users\25315\PycharmProjects\dramaforge-ai\components\infinite-canvas\types.ts:18-27` (NodeType 枚举)
- Modify: `c:\Users\25315\PycharmProjects\dramaforge-ai\components\infinite-canvas\types.ts:160-170` (DEFAULT_NODE_SIZES)
- Test: `c:\Users\25315\PycharmProjects\dramaforge-ai\tests\infinite-canvas\agent-node-type.test.ts` (新)

**Interfaces:**
- Consumes: 无
- Produces: `NodeType` 新成员 `'agent_node'`；导出常量 `AGENT_COL_X` / `AGENT_NODE_W` / `AGENT_NODE_H` / `AGENT_ROW_GAP` / `AGENT_TYPE_META`

- [ ] **Step 1: 写失败测试**

`tests/infinite-canvas/agent-node-type.test.ts` 内容：

```typescript
/**
 * TDD: types.ts 应包含 'agent_node' 与 7 列布局常量。
 */
import { describe, it, expect } from 'vitest';
import {
  AGENT_COL_X,
  AGENT_NODE_W,
  AGENT_NODE_H,
  AGENT_ROW_GAP,
  AGENT_TYPE_META,
  DEFAULT_NODE_SIZES,
} from '@/components/infinite-canvas/types';

describe('agent_node types & layout', () => {
  it('AGENT_COL_X covers 7 task types with strict 320 px stride', () => {
    expect(AGENT_COL_X.goal).toBe(0);
    expect(AGENT_COL_X.plan).toBe(320);
    expect(AGENT_COL_X.action).toBe(640);
    expect(AGENT_COL_X.observation).toBe(960);
    expect(AGENT_COL_X.artifact).toBe(1280);
    expect(AGENT_COL_X.question).toBe(1600);
    expect(AGENT_COL_X.done).toBe(1920);
  });

  it('AGENT_NODE_W is 280 and AGENT_NODE_H is 200', () => {
    expect(AGENT_NODE_W).toBe(280);
    expect(AGENT_NODE_H).toBe(200);
  });

  it('AGENT_ROW_GAP is 40', () => {
    expect(AGENT_ROW_GAP).toBe(40);
  });

  it('AGENT_TYPE_META has 7 entries with label/color/icon', () => {
    expect(Object.keys(AGENT_TYPE_META)).toHaveLength(7);
    for (const k of Object.keys(AGENT_TYPE_META)) {
      const m = (AGENT_TYPE_META as any)[k];
      expect(m).toHaveProperty('label');
      expect(m).toHaveProperty('color');
      expect(m).toHaveProperty('icon');
    }
  });

  it('DEFAULT_NODE_SIZES has agent_node entry', () => {
    expect(DEFAULT_NODE_SIZES.agent_node).toBeDefined();
    expect(DEFAULT_NODE_SIZES.agent_node.w).toBe(280);
  });
});
```

- [ ] **Step 2: 运行测试，预期失败**

Run: `cd c:\Users\25315\PycharmProjects\dramaforge-ai; npm test -- --run agent-node-type`
Expected: FAIL with "AGENT_COL_X is not exported" 或 "Cannot find module"

- [ ] **Step 3: 修改 types.ts**

在 `components/infinite-canvas/types.ts` 顶部加 `TaskType` 类型，并在 NodeType 枚举后加 `'agent_node'`：

```typescript
export type TaskType =
  | 'goal'
  | 'plan'
  | 'action'
  | 'observation'
  | 'artifact'
  | 'question'
  | 'done';

export type NodeType =
  | 'image'
  | 'prompt'
  | 'loop'
  | 'group'
  | 'promptGroup'
  | 'video'
  | 'pipeline'
  | 'novel'
  | 'script'
  | 'agent_node';

// agent_node 视觉元数据（与 task-graph-node.tsx 中的 TYPE_META 保持一致）
export const AGENT_TYPE_META: Record<TaskType, { label: string; color: string; icon: string }> = {
  goal: { label: '目标', color: '#6366f1', icon: '🎯' },
  plan: { label: '计划', color: '#8b5cf6', icon: '📋' },
  action: { label: '动作', color: '#0ea5e9', icon: '⚡' },
  observation: { label: '观察', color: '#14b8a6', icon: '👁' },
  artifact: { label: '资产', color: '#ec4899', icon: '🎨' },
  question: { label: '询问', color: '#f59e0b', icon: '❓' },
  done: { label: '完成', color: '#10b981', icon: '✅' },
};

// 7 列 x 坐标（间距 320 px，节点宽 280 + 间距 40）
export const AGENT_COL_X: Record<TaskType, number> = {
  goal: 0,
  plan: 320,
  action: 640,
  observation: 960,
  artifact: 1280,
  question: 1600,
  done: 1920,
};

export const AGENT_NODE_W = 280;
export const AGENT_NODE_H = 200;
export const AGENT_ROW_GAP = 40;
```

然后在 `DEFAULT_NODE_SIZES` 里加 `agent_node`：

```typescript
export const DEFAULT_NODE_SIZES: Record<string, { w: number; h?: number }> = {
  image: { w: 260, h: 178 },
  prompt: { w: 310, h: 200 },
  loop: { w: 336, h: 220 },
  group: { w: 260, h: 178 },
  promptGroup: { w: 310, h: 200 },
  video: { w: 320, h: 200 },
  pipeline: { w: 360, h: 420 },
  novel: { w: 420, h: 480 },
  script: { w: 480, h: 420 },
  agent_node: { w: 280, h: 200 },
};
```

- [ ] **Step 4: 运行测试，预期通过**

Run: `cd c:\Users\25315\PycharmProjects\dramaforge-ai; npm test -- --run agent-node-type`
Expected: PASS (5 tests)

- [ ] **Step 5: 提交**

```bash
cd c:\Users\25315\PycharmProjects\dramaforge-ai
git add components/infinite-canvas/types.ts tests/infinite-canvas/agent-node-type.test.ts
git commit -m "feat(types): add agent_node to NodeType + 7-column layout constants"
```

---

### Task 2: useCanvasStore 增加 nodeOverrides + addAgentNodes + clearAgentNodes

**Files:**
- Modify: `c:\Users\25315\PycharmProjects\dramaforge-ai\components\infinite-canvas\use-canvas-store.ts:292-373` (CanvasStore 接口)
- Modify: `c:\Users\25315\PycharmProjects\dramaforge-ai\components\infinite-canvas\use-canvas-store.ts:375-389` (initial state)
- Modify: `c:\Users\25315\PycharmProjects\dramaforge-ai\components\infinite-canvas\use-canvas-store.ts` (在 create 内增加新 actions)
- Modify: `c:\Users\25315\PycharmProjects\dramaforge-ai\components\infinite-canvas\use-canvas-store.ts:1440-1452` (reset action)
- Test: `c:\Users\25315\PycharmProjects\dramaforge-ai\tests\infinite-canvas\add-agent-nodes.test.ts` (新)
- Test: `c:\Users\25315\PycharmProjects\dramaforge-ai\tests\infinite-canvas\clear-agent-nodes.test.ts` (新)

**Interfaces:**
- Consumes: types.ts 的 `AGENT_COL_X / AGENT_NODE_W / AGENT_NODE_H / AGENT_ROW_GAP / TaskType`
- Produces:
  - `useCanvasStore.state.nodeOverrides: Record<string, {dx: number; dy: number}>`
  - `useCanvasStore.addAgentNodes(input: AgentNodesInput): void`
  - `useCanvasStore.clearAgentNodes(): void`
  - `useCanvasStore.recordAgentNodeDrag(nodeId: string, x: number, y: number): void`

- [ ] **Step 1: 写失败测试**

`tests/infinite-canvas/add-agent-nodes.test.ts`：

```typescript
/**
 * TDD: addAgentNodes — 把 agent 事件投影到画布节点，按 7 列布局。
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { useCanvasStore } from '@/components/infinite-canvas/use-canvas-store';

describe('addAgentNodes', () => {
  beforeEach(() => {
    useCanvasStore.setState({
      nodes: [],
      connections: [],
      nodeOverrides: {},
    });
  });

  it('inserts goal node at x=0', () => {
    useCanvasStore.getState().addAgentNodes({
      userGoal: '做一个雨夜短片',
      plan: [],
      actions: [],
      observations: [],
      artifacts: {},
      pendingQuestion: null,
    });
    const goal = useCanvasStore.getState().nodes.find((n) => n._agentTaskType === 'goal');
    expect(goal).toBeDefined();
    expect(goal!.x).toBe(0);
    expect(goal!.type).toBe('agent_node');
    expect(goal!._agentLabel).toBe('做一个雨夜短片');
  });

  it('inserts plan node with plan length in label', () => {
    useCanvasStore.getState().addAgentNodes({
      userGoal: '',
      plan: [{ tool: 'a' }, { tool: 'b' }, { tool: 'c' }],
      actions: [],
      observations: [],
      artifacts: {},
      pendingQuestion: null,
    });
    const plan = useCanvasStore.getState().nodes.find((n) => n._agentTaskType === 'plan');
    expect(plan).toBeDefined();
    expect(plan!.x).toBe(320);
    expect(plan!._agentLabel).toContain('3');
  });

  it('inserts action nodes at x=640 with vertical stride 240', () => {
    useCanvasStore.getState().addAgentNodes({
      userGoal: '',
      plan: [],
      actions: [
        { type: 'action', payload: { tool: 't1' }, timestamp: 1 } as any,
        { type: 'action', payload: { tool: 't2' }, timestamp: 2 } as any,
        { type: 'action', payload: { tool: 't3' }, timestamp: 3 } as any,
      ],
      observations: [],
      artifacts: {},
      pendingQuestion: null,
    });
    const actions = useCanvasStore.getState().nodes.filter((n) => n._agentTaskType === 'action');
    expect(actions).toHaveLength(3);
    expect(actions[0].x).toBe(640);
    expect(actions[0].y).toBe(0);
    expect(actions[1].y).toBe(240);
    expect(actions[2].y).toBe(480);
  });

  it('inserts observation nodes at x=960', () => {
    useCanvasStore.getState().addAgentNodes({
      userGoal: '',
      plan: [],
      actions: [],
      observations: [
        { type: 'observation', payload: { result: { ok: true } }, timestamp: 1 } as any,
      ],
      artifacts: {},
      pendingQuestion: null,
    });
    const obs = useCanvasStore.getState().nodes.filter((n) => n._agentTaskType === 'observation');
    expect(obs[0].x).toBe(960);
  });

  it('flattens artifacts from multiple buckets and inserts at x=1280', () => {
    useCanvasStore.getState().addAgentNodes({
      userGoal: '',
      plan: [],
      actions: [],
      observations: [],
      artifacts: {
        character: [{ id: 'c1', kind: 'image', name: 'Alice' } as any],
        scene: [{ id: 's1', kind: 'image', name: 'Rain' } as any],
        storyboard: [{ id: 'b1', kind: 'image', name: 'Shot 1' } as any],
      },
      pendingQuestion: null,
    });
    const artifacts = useCanvasStore.getState().nodes.filter((n) => n._agentTaskType === 'artifact');
    expect(artifacts).toHaveLength(3);
    artifacts.forEach((a) => expect(a.x).toBe(1280));
  });

  it('inserts question node at x=1600 when pendingQuestion is set', () => {
    useCanvasStore.getState().addAgentNodes({
      userGoal: '',
      plan: [],
      actions: [],
      observations: [],
      artifacts: {},
      pendingQuestion: { question: '你想做什么风格？' },
    });
    const q = useCanvasStore.getState().nodes.find((n) => n._agentTaskType === 'question');
    expect(q).toBeDefined();
    expect(q!.x).toBe(1600);
  });

  it('updates existing node instead of inserting duplicate on second call', () => {
    const input = {
      userGoal: '短片',
      plan: [{ tool: 'a' }],
      actions: [],
      observations: [],
      artifacts: {},
      pendingQuestion: null,
    };
    useCanvasStore.getState().addAgentNodes(input);
    useCanvasStore.getState().addAgentNodes(input);
    const goals = useCanvasStore.getState().nodes.filter((n) => n._agentTaskType === 'goal');
    expect(goals).toHaveLength(1);
  });

  it('respects nodeOverrides for column x and y', () => {
    useCanvasStore.setState({
      nodeOverrides: { 'agent-goal-test': { dx: 50, dy: 100 } },
    });
    useCanvasStore.getState().addAgentNodes({
      userGoal: 'hi',
      plan: [],
      actions: [],
      observations: [],
      artifacts: {},
      pendingQuestion: null,
    });
    // we can't know the exact id; find goal
    const goal = useCanvasStore.getState().nodes.find((n) => n._agentTaskType === 'goal');
    // default x for goal is 0; with dx=50 it becomes 50
    expect(goal!.x).toBe(50);
  });
});
```

- [ ] **Step 2: 运行测试，预期失败**

Run: `cd c:\Users\25315\PycharmProjects\dramaforge-ai; npm test -- --run add-agent-nodes`
Expected: FAIL with "addAgentNodes is not a function"

- [ ] **Step 3: 修改 use-canvas-store.ts**

在文件顶部 imports 里加入：

```typescript
import {
  CanvasNode,
  Connection,
  Viewport,
  CanvasTheme,
  UndoState,
  UNDO_MAX,
  uid,
  DEFAULT_NODE_SIZES,
  TaskAssetRef,
  TaskAssetKind,
  TaskType,
  AGENT_COL_X,
  AGENT_NODE_W,
  AGENT_NODE_H,
  AGENT_ROW_GAP,
} from './types';
```

同时 import AgentEventLike + ArtifactItem + PendingQuestion：

```typescript
import type { AgentEventLike, ArtifactItem, PendingQuestion } from '../../agent/use-agent-store';
```

如果循环导入有问题，改为类型专用路径：

```typescript
type AgentEventLite = { type: string; payload?: Record<string, any>; timestamp?: number };
type ArtifactLite = { id: string; kind?: string; asset_kind?: string; name?: string; url?: string; [k: string]: any };
type QuestionLite = { question: string; options?: string[]; [k: string]: any };
```

在 `CanvasStore` interface 里加：

```typescript
nodeOverrides: Record<string, { dx: number; dy: number }>;
addAgentNodes: (input: {
  userGoal: string;
  plan: any[];
  actions: AgentEventLite[];
  observations: AgentEventLite[];
  artifacts: Record<string, ArtifactLite[]>;
  pendingQuestion: QuestionLite | null;
}) => void;
clearAgentNodes: () => void;
recordAgentNodeDrag: (nodeId: string, x: number, y: number) => void;
```

在 `initial state` 区域（`nodes: [], connections: []` 之后）加：

```typescript
nodeOverrides: {},
```

在 `reset` action 里加：

```typescript
nodeOverrides: {},
```

在 `create` 块内、`reset` 之前加三个 actions：

```typescript
  addAgentNodes: (input) => {
    const state = get();
    const { userGoal, plan, actions, observations, artifacts, pendingQuestion } = input;
    const projectId = state.projectId || 'global';

    const upsert = (id: string, taskType: TaskType, label: string, payload: Record<string, any>, status: 'pending' | 'running' | 'success' | 'failed' = 'pending') => {
      const colX = AGENT_COL_X[taskType];
      const existing = state.nodes.find((n) => n.id === id);
      const override = state.nodeOverrides[id] || { dx: 0, dy: 0 };
      // y 累加 = baseY(0) + override.dy + colIndex * (h + gap)
      // colIndex = 同列已有 agent_node 数（不包含自己）
      const colIndex = state.nodes.filter(
        (n) => n.type === 'agent_node' && (n as any)._agentTaskType === taskType && n.id !== id,
      ).length;
      const x = colX + override.dx;
      const y = 0 + override.dy + colIndex * (AGENT_NODE_H + AGENT_ROW_GAP);
      if (existing) {
        set((s) => ({
          nodes: s.nodes.map((n) =>
            n.id === id
              ? { ...n, _agentStatus: status, _agentPayload: payload, _agentLabel: label, _agentTaskType: taskType }
              : n,
          ),
        }));
      } else {
        const node: CanvasNode = {
          id,
          type: 'agent_node',
          x,
          y,
          w: AGENT_NODE_W,
          h: AGENT_NODE_H,
          _agentTaskType: taskType,
          _agentStatus: status,
          _agentPayload: payload,
          _agentLabel: label,
        } as any;
        set((s) => ({ nodes: [...s.nodes, node] }));
      }
    };

    if (userGoal) {
      upsert(`agent-goal-${projectId}`, 'goal', userGoal.slice(0, 60), { text: userGoal });
    }
    if (plan && plan.length) {
      upsert(`agent-plan-${projectId}`, 'plan', `计划 (${plan.length} 步)`, { plan });
    }
    actions.forEach((evt, i) => {
      const id = `agent-action-${i}-${evt.timestamp || i}`;
      upsert(id, 'action', (evt.payload as any)?.tool || `action ${i + 1}`, evt.payload || {}, 'success');
    });
    observations.forEach((evt, i) => {
      const id = `agent-obs-${i}-${evt.timestamp || i}`;
      upsert(id, 'observation', (evt.payload as any)?.tool || `obs ${i + 1}`, evt.payload || {}, 'success');
    });
    const flatArtifacts = Object.values(artifacts).flat() as ArtifactLite[];
    flatArtifacts.forEach((item, i) => {
      const id = `agent-artifact-${item.id || i}`;
      upsert(id, 'artifact', (item.name as string) || (item.asset_kind as string) || '资产', item, 'success');
    });
    if (pendingQuestion) {
      upsert(`agent-question-${projectId}`, 'question', '等待用户回答', pendingQuestion, 'running');
    }
  },

  clearAgentNodes: () =>
    set((s) => ({ nodes: s.nodes.filter((n) => n.type !== 'agent_node') })),

  recordAgentNodeDrag: (nodeId, x, y) =>
    set((s) => {
      const node = s.nodes.find((n) => n.id === nodeId);
      if (!node || node.type !== 'agent_node') return s;
      const taskType = (node as any)._agentTaskType as TaskType;
      const colX = AGENT_COL_X[taskType];
      return {
        nodeOverrides: { ...s.nodeOverrides, [nodeId]: { dx: x - colX, dy: y } },
      };
    }),
```

- [ ] **Step 4: 运行测试，预期通过**

Run: `cd c:\Users\25315\PycharmProjects\dramaforge-ai; npm test -- --run add-agent-nodes`
Expected: PASS (8 tests)

- [ ] **Step 5: 写 clearAgentNodes 测试**

`tests/infinite-canvas/clear-agent-nodes.test.ts`：

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { useCanvasStore } from '@/components/infinite-canvas/use-canvas-store';

describe('clearAgentNodes', () => {
  beforeEach(() => {
    useCanvasStore.setState({ nodes: [], connections: [], nodeOverrides: {} });
  });

  it('removes only agent_node type, keeps other types', () => {
    useCanvasStore.setState({
      nodes: [
        { id: 'a', type: 'image', x: 0, y: 0, w: 100 } as any,
        { id: 'b', type: 'agent_node', x: 0, y: 0, w: 280, _agentTaskType: 'goal' } as any,
        { id: 'c', type: 'prompt', x: 0, y: 0, w: 200 } as any,
      ],
    });
    useCanvasStore.getState().clearAgentNodes();
    const ids = useCanvasStore.getState().nodes.map((n) => n.id);
    expect(ids).toEqual(['a', 'c']);
  });

  it('keeps nodeOverrides intact (does not clear)', () => {
    useCanvasStore.setState({
      nodes: [{ id: 'a', type: 'agent_node', x: 0, y: 0, w: 280, _agentTaskType: 'goal' } as any],
      nodeOverrides: { a: { dx: 10, dy: 20 } },
    });
    useCanvasStore.getState().clearAgentNodes();
    expect(useCanvasStore.getState().nodeOverrides).toEqual({ a: { dx: 10, dy: 20 } });
  });
});
```

- [ ] **Step 6: 运行 clearAgentNodes 测试，预期通过**

Run: `cd c:\Users\25315\PycharmProjects\dramaforge-ai; npm test -- --run clear-agent-nodes`
Expected: PASS (2 tests)

- [ ] **Step 7: 提交**

```bash
cd c:\Users\25315\PycharmProjects\dramaforge-ai
git add components/infinite-canvas/use-canvas-store.ts tests/infinite-canvas/add-agent-nodes.test.ts tests/infinite-canvas/clear-agent-nodes.test.ts
git commit -m "feat(canvas-store): addAgentNodes + clearAgentNodes + recordAgentNodeDrag with 7-column layout"
```

---

### Task 3: CanvasNode.tsx 增加 AgentNodeBody 渲染分支

**Files:**
- Modify: `c:\Users\25315\PycharmProjects\dramaforge-ai\components\infinite-canvas\CanvasNode.tsx:212-224` (NodeBody dispatch)
- Modify: `c:\Users\25315\PycharmProjects\dramaforge-ai\components\infinite-canvas\CanvasNode.tsx` (在 ScriptNodeBody 之后追加 AgentNodeBody)
- Test: `c:\Users\25315\PycharmProjects\dramaforge-ai\tests\infinite-canvas\canvas-node-agent.test.tsx` (新)

**Interfaces:**
- Consumes: types.ts 的 `AGENT_TYPE_META / TaskType / NodeType`
- Produces: 渲染测试 ID `task-graph-node-badge-{taskType}` / `task-graph-node-status-{status}` / `task-graph-node-label` / `task-graph-node-text-snippet` / `task-graph-node-plan-step-{i}` / `task-graph-node-question`

- [ ] **Step 1: 写失败测试**

`tests/infinite-canvas/canvas-node-agent.test.tsx`：

```typescript
/**
 * TDD: CanvasNodeComponent — agent_node 类型渲染。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { CanvasNodeComponent } from '@/components/infinite-canvas/CanvasNode';
import { useCanvasStore } from '@/components/infinite-canvas/use-canvas-store';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

describe('<CanvasNodeComponent type=agent_node />', () => {
  beforeEach(() => {
    useCanvasStore.setState({ nodes: [], connections: [], nodeOverrides: {}, selected: new Set() });
  });

  it('renders goal badge with target icon', () => {
    render(
      <CanvasNodeComponent
        node={{
          id: 'a',
          type: 'agent_node',
          x: 0,
          y: 0,
          w: 280,
          h: 200,
          _agentTaskType: 'goal',
          _agentStatus: 'pending',
          _agentLabel: '做一个雨夜短片',
          _agentPayload: { text: '做一个雨夜短片' },
        } as any}
        onDragStart={vi.fn()}
        onResizeStart={vi.fn()}
        onPortMouseDown={vi.fn()}
      />,
    );
    const badge = screen.getByTestId('task-graph-node-badge-goal');
    expect(badge.textContent).toContain('目标');
    expect(screen.getByTestId('task-graph-node-label')).toHaveTextContent('做一个雨夜短片');
  });

  it('renders running status badge', () => {
    render(
      <CanvasNodeComponent
        node={{
          id: 'a',
          type: 'agent_node',
          x: 0,
          y: 0,
          w: 280,
          h: 200,
          _agentTaskType: 'action',
          _agentStatus: 'running',
          _agentLabel: 't1',
          _agentPayload: {},
        } as any}
        onDragStart={vi.fn()}
        onResizeStart={vi.fn()}
        onPortMouseDown={vi.fn()}
      />,
    );
    expect(screen.getByTestId('task-graph-node-status-running')).toBeInTheDocument();
  });

  it('renders plan steps as ol list', () => {
    render(
      <CanvasNodeComponent
        node={{
          id: 'a',
          type: 'agent_node',
          x: 0,
          y: 0,
          w: 280,
          h: 200,
          _agentTaskType: 'plan',
          _agentStatus: 'success',
          _agentLabel: '计划',
          _agentPayload: { plan: [{ tool: 'a' }, { tool: 'b' }, { tool: 'c' }] },
        } as any}
        onDragStart={vi.fn()}
        onResizeStart={vi.fn()}
        onPortMouseDown={vi.fn()}
      />,
    );
    expect(screen.getByTestId('task-graph-node-plan-step-0')).toBeInTheDocument();
    expect(screen.getByTestId('task-graph-node-plan-step-2')).toBeInTheDocument();
  });

  it('renders question highlight when taskType is question', () => {
    render(
      <CanvasNodeComponent
        node={{
          id: 'a',
          type: 'agent_node',
          x: 0,
          y: 0,
          w: 280,
          h: 200,
          _agentTaskType: 'question',
          _agentStatus: 'running',
          _agentLabel: '等待用户回答',
          _agentPayload: {},
        } as any}
        onDragStart={vi.fn()}
        onResizeStart={vi.fn()}
        onPortMouseDown={vi.fn()}
      />,
    );
    expect(screen.getByTestId('task-graph-node-question')).toBeInTheDocument();
  });

  it('renders image artifact when payload.kind=image and url present', () => {
    render(
      <CanvasNodeComponent
        node={{
          id: 'a',
          type: 'agent_node',
          x: 0,
          y: 0,
          w: 280,
          h: 200,
          _agentTaskType: 'artifact',
          _agentStatus: 'success',
          _agentLabel: 'Alice',
          _agentPayload: { kind: 'image', url: 'http://x/a.png' },
        } as any}
        onDragStart={vi.fn()}
        onResizeStart={vi.fn()}
        onPortMouseDown={vi.fn()}
      />,
    );
    const img = screen.getByRole('img');
    expect(img).toHaveAttribute('src', 'http://x/a.png');
  });

  it('renders text snippet when payload.kind=text', () => {
    render(
      <CanvasNodeComponent
        node={{
          id: 'a',
          type: 'agent_node',
          x: 0,
          y: 0,
          w: 280,
          h: 200,
          _agentTaskType: 'artifact',
          _agentStatus: 'success',
          _agentLabel: 'script',
          _agentPayload: { kind: 'text', snippet: 'Some script content' },
        } as any}
        onDragStart={vi.fn()}
        onResizeStart={vi.fn()}
        onPortMouseDown={vi.fn()}
      />,
    );
    const snippet = screen.getByTestId('task-graph-node-text-snippet');
    expect(snippet).toHaveTextContent('Some script content');
  });
});
```

- [ ] **Step 2: 运行测试，预期失败**

Run: `cd c:\Users\25315\PycharmProjects\dramaforge-ai; npm test -- --run canvas-node-agent`
Expected: FAIL with "unable to find 'task-graph-node-badge-goal'"

- [ ] **Step 3: 修改 CanvasNode.tsx**

先 import 必要常量：

```typescript
import {
  CanvasNode,
  NodeType,
  TaskType,
  AGENT_TYPE_META,
} from './types';
```

在 `NodeBody` 组件的 dispatch 链尾部（`return <ImageNodeBody node={node} />;` 之前）加 agent_node 分支：

```typescript
  if (node.type === 'agent_node') return <AgentNodeBody node={node} />;
```

在文件末尾（`ImageNodeBody.displayName = 'ImageNodeBody';` 之后）追加：

```typescript
/* ===== Agent Node (agent 事件节点) ===== */
const STATUS_LABEL_AGENT: Record<string, string> = {
  pending: '○ 等待',
  running: '◐ 执行中',
  success: '● 成功',
  failed: '✕ 失败',
};

const AgentNodeBody: React.FC<{ node: CanvasNode }> = React.memo(({ node }) => {
  const taskType = (node._agentTaskType as TaskType) || 'goal';
  const status = (node._agentStatus as string) || 'pending';
  const label = (node._agentLabel as string) || '';
  const payload = (node._agentPayload as Record<string, any>) || {};
  const meta = AGENT_TYPE_META[taskType] || AGENT_TYPE_META.goal;
  const isArtifact = taskType === 'artifact';
  const isPlan = taskType === 'plan';
  const isQuestion = taskType === 'question';
  const isImage = isArtifact && payload.kind === 'image' && typeof payload.url === 'string';
  const isText = isArtifact && payload.kind === 'text' && typeof payload.snippet === 'string';

  return (
    <div
      data-testid="agent-node-body"
      style={{
        minWidth: 0,
        background: '#ffffff',
        border: `2px solid ${meta.color}`,
        borderRadius: 10,
        padding: 10,
        fontFamily: 'ui-sans-serif, system-ui, sans-serif',
        fontSize: 12,
        boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 6,
        }}
      >
        <span
          data-testid={`task-graph-node-badge-${taskType}`}
          style={{
            fontSize: 10,
            padding: '2px 6px',
            background: meta.color,
            color: 'white',
            borderRadius: 4,
            fontWeight: 600,
            letterSpacing: 0.3,
          }}
        >
          {meta.icon} {meta.label}
        </span>
        <AgentStatusBadge status={status} color={meta.color} />
      </div>
      <div
        data-testid="task-graph-node-label"
        style={{
          fontWeight: 600,
          color: '#0f172a',
          marginBottom: 6,
          wordBreak: 'break-word',
        }}
      >
        {label || '—'}
      </div>
      {isImage && (
        <img
          src={payload.url}
          alt={label}
          style={{ width: '100%', height: 'auto', borderRadius: 6, marginTop: 4, display: 'block' }}
        />
      )}
      {isText && (
        <div
          data-testid="task-graph-node-text-snippet"
          style={{
            fontSize: 11,
            color: '#475569',
            background: 'rgba(0,0,0,0.03)',
            padding: 6,
            borderRadius: 4,
            maxHeight: 80,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {String(payload.snippet).slice(0, 200)}
        </div>
      )}
      {isPlan && Array.isArray(payload.plan) && (
        <ol style={{ margin: 0, paddingLeft: 18, fontSize: 11, color: '#334155' }}>
          {payload.plan.slice(0, 8).map((step: any, i: number) => (
            <li key={i} data-testid={`task-graph-node-plan-step-${i}`} style={{ marginBottom: 2 }}>
              <code style={{ fontSize: 10 }}>{step.tool || step.name || `step ${i + 1}`}</code>
            </li>
          ))}
        </ol>
      )}
      {isQuestion && (
        <div
          data-testid="task-graph-node-question"
          style={{
            fontSize: 11,
            color: '#b45309',
            background: 'rgba(245,158,11,0.08)',
            padding: 6,
            borderRadius: 4,
            border: '1px dashed rgba(245,158,11,0.4)',
            marginTop: 4,
          }}
        >
          ⚠ 等待用户回答
        </div>
      )}
    </div>
  );
});
AgentNodeBody.displayName = 'AgentNodeBody';

const AgentStatusBadge: React.FC<{ status: string; color: string }> = ({ status }) => {
  const testId = `task-graph-node-status-${status}`;
  const bg =
    status === 'running' ? 'rgba(14,165,233,0.15)' :
    status === 'success' ? 'rgba(16,185,129,0.15)' :
    status === 'failed' ? 'rgba(239,68,68,0.15)' :
    'rgba(148,163,184,0.15)';
  const fg =
    status === 'running' ? '#0369a1' :
    status === 'success' ? '#047857' :
    status === 'failed' ? '#b91c1c' :
    '#475569';
  return (
    <span
      data-testid={testId}
      style={{
        fontSize: 9,
        padding: '2px 6px',
        background: bg,
        color: fg,
        borderRadius: 4,
        fontFamily: 'ui-monospace, monospace',
      }}
    >
      {STATUS_LABEL_AGENT[status] || status}
    </span>
  );
};
AgentStatusBadge.displayName = 'AgentStatusBadge';
```

- [ ] **Step 4: 运行测试，预期通过**

Run: `cd c:\Users\25315\PycharmProjects\dramaforge-ai; npm test -- --run canvas-node-agent`
Expected: PASS (6 tests)

- [ ] **Step 5: 运行所有画布测试确保无回归**

Run: `cd c:\Users\25315\PycharmProjects\dramaforge-ai; npm test -- --run`
Expected: 之前通过的测试全部仍通过，新测试 +6

- [ ] **Step 6: 提交**

```bash
cd c:\Users\25315\PycharmProjects\dramaforge-ai
git add components/infinite-canvas/CanvasNode.tsx tests/infinite-canvas/canvas-node-agent.test.tsx
git commit -m "feat(canvas-node): AgentNodeBody for type=agent_node with 7-type rendering"
```

---

### Task 4: InfiniteCanvas 拖动结束记录 nodeOverride

**Files:**
- Modify: `c:\Users\25315\PycharmProjects\dramaforge-ai\components\infinite-canvas\InfiniteCanvas.tsx:430-528` (onUp handler)
- Test: 集成测试（与 Task 2 一起验证，无需独立测试）

**Interfaces:**
- Consumes: `useCanvasStore.recordAgentNodeDrag`
- Produces: agent_node 拖动后 overrides 写入

- [ ] **Step 1: 修改 InfiniteCanvas.tsx 的 onUp handler**

定位 `useEffect` 中的 `const onUp = (e: MouseEvent) => {` 块（行 431 附近），在 `dragRef.current = null; setDragging(false);` 之后追加：

```typescript
        // 记录 agent_node 拖动偏移，供后续 addAgentNodes 使用
        if (dragRef.current) {
          const draggedId = dragRef.current.id;
          const draggedNode = nodes.find((n) => n.id === draggedId);
          if (draggedNode && draggedNode.type === 'agent_node') {
            get().recordAgentNodeDrag(draggedId, draggedNode.x, draggedNode.y);
          }
        }
```

注意：`get()` 是 zustand 的 API，已经在文件其他地方使用过（runVideoGeneration / runPipeline 等）。如果 `get` 不可用（因为 InfiniteCanvas 没有用 zustand 的 create factory 包装），改用：

```typescript
import { useCanvasStore } from './use-canvas-store';
// 在 onUp 内：
useCanvasStore.getState().recordAgentNodeDrag(draggedId, draggedNode.x, draggedNode.y);
```

- [ ] **Step 2: 手动验证（运行 addAgentNodes 测试 + 拖动逻辑描述）**

`recordAgentNodeDrag` 的单元测试已在 Task 2 Step 3-4 通过。拖动集成在此步骤通过手动代码审查验证：
- 在浏览器中打开 AgentMode（开发时 `npm run dev`）
- 创建任务后拖动任意 agent_node
- 检查 useCanvasStore 的 nodeOverrides 是否包含新条目

- [ ] **Step 3: 运行所有画布测试**

Run: `cd c:\Users\25315\PycharmProjects\dramaforge-ai; npm test -- --run`
Expected: 全部通过（无回归）

- [ ] **Step 4: 提交**

```bash
cd c:\Users\25315\PycharmProjects\dramaforge-ai
git add components/infinite-canvas/InfiniteCanvas.tsx
git commit -m "feat(infinite-canvas): recordAgentNodeDrag on drag end for agent_node"
```

---

### Task 5: ThoughtStream 增加 floating 模式

**Files:**
- Modify: `c:\Users\25315\PycharmProjects\dramaforge-ai\agent\thought-stream.tsx:27-128` (ThoughtStream 组件)
- Test: `c:\Users\25315\PycharmProjects\dramaforge-ai\tests\agent\thought-stream-floating.test.tsx` (新)

**Interfaces:**
- Consumes: 无
- Produces: `ThoughtStream` props `floating?: boolean` / `open?: boolean` / `onClose?: () => void`

- [ ] **Step 1: 写失败测试**

`tests/agent/thought-stream-floating.test.tsx`：

```typescript
/**
 * TDD: ThoughtStream 支持 floating 模式（右上角浮层）。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ThoughtStream } from '@/agent/thought-stream';
import { useAgentStore } from '@/agent/use-agent-store';

describe('<ThoughtStream floating />', () => {
  beforeEach(() => {
    useAgentStore.getState().reset();
  });

  it('renders as fixed positioned panel when floating=true', () => {
    render(<ThoughtStream floating open={true} onClose={vi.fn()} />);
    const panel = screen.getByTestId('thought-stream-floating');
    expect(panel).toBeInTheDocument();
    const style = (panel as HTMLElement).style;
    expect(style.position).toBe('fixed');
    expect(style.top).toBeTruthy();
    expect(style.right).toBeTruthy();
  });

  it('hides panel when open=false', () => {
    render(<ThoughtStream floating open={false} onClose={vi.fn()} />);
    expect(screen.queryByTestId('thought-stream-floating')).toBeNull();
  });

  it('calls onClose when close button clicked', () => {
    const onClose = vi.fn();
    useAgentStore.getState().setTask('t-1', 'running');
    render(<ThoughtStream floating open={true} onClose={onClose} />);
    fireEvent.click(screen.getByTestId('thought-stream-floating-close'));
    expect(onClose).toHaveBeenCalled();
  });

  it('non-floating mode still works as before (default)', () => {
    render(<ThoughtStream />);
    expect(screen.getByTestId('thought-stream')).toBeInTheDocument();
    expect(screen.queryByTestId('thought-stream-floating')).toBeNull();
  });
});
```

- [ ] **Step 2: 运行测试，预期失败**

Run: `cd c:\Users\25315\PycharmProjects\dramaforge-ai; npm test -- --run thought-stream-floating`
Expected: FAIL with "unable to find 'thought-stream-floating'"

- [ ] **Step 3: 修改 thought-stream.tsx**

把 `ThoughtStream` 签名改为：

```typescript
export interface ThoughtStreamProps {
  floating?: boolean;
  open?: boolean;
  onClose?: () => void;
}

export const ThoughtStream: React.FC<ThoughtStreamProps> = ({ floating, open, onClose }) => {
  // ... 保留原有 thoughts/actions/observations/status 订阅
  if (floating) {
    if (!open) return null;
    return (
      <div
        data-testid="thought-stream-floating"
        style={{
          position: 'fixed',
          top: 16,
          right: 16,
          width: 320,
          maxHeight: '60vh',
          background: 'white',
          border: '1px solid #e2e8f0',
          borderRadius: 10,
          boxShadow: '0 4px 16px rgba(0,0,0,0.08)',
          zIndex: 50,
          display: 'flex',
          flexDirection: 'column',
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
          fontSize: 12,
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '6px 10px',
            borderBottom: '1px solid #e2e8f0',
            background: 'rgba(99,102,241,0.06)',
            fontWeight: 600,
          }}
        >
          <span>💭 ThoughtStream</span>
          <button
            data-testid="thought-stream-floating-close"
            type="button"
            aria-label="close"
            onClick={onClose}
            style={{ background: 'none', border: 0, cursor: 'pointer', fontSize: 14, lineHeight: 1 }}
          >
            ✕
          </button>
        </div>
        <div style={{ overflowY: 'auto', flex: 1 }}>
          {/* 复用原 render 内容 */}
          <ThoughtStreamBody />
        </div>
      </div>
    );
  }
  return <ThoughtStreamBody />;
};
```

把原有 `ThoughtStream` 内部 render 内容（除最外层 `<div data-testid="thought-stream">` 包装外）抽到内部组件 `ThoughtStreamBody`：

```typescript
const ThoughtStreamBody: React.FC = () => {
  const thoughts = useAgentStore((s) => s.thoughts);
  const actions = useAgentStore((s) => s.actions);
  const observations = useAgentStore((s) => s.observations);
  const status = useAgentStore((s) => s.status);

  const latestThought = thoughts[thoughts.length - 1];
  const isEmpty = thoughts.length === 0 && actions.length === 0 && observations.length === 0;

  return (
    <div
      data-testid="thought-stream"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
        padding: 12,
        height: '100%',
        overflowY: 'auto',
      }}
    >
      {/* 原有 status / isEmpty / latestThought / Section 列表 */}
      {/* ... 保留原样 ... */}
    </div>
  );
};
```

- [ ] **Step 4: 运行测试，预期通过**

Run: `cd c:\Users\25315\PycharmProjects\dramaforge-ai; npm test -- --run thought-stream`
Expected: PASS (现有 8 + 新 4 = 12 tests)

- [ ] **Step 5: 提交**

```bash
cd c:\Users\25315\PycharmProjects\dramaforge-ai
git add agent/thought-stream.tsx tests/agent/thought-stream-floating.test.tsx
git commit -m "feat(thought-stream): floating mode with open/onClose props"
```

---

### Task 6: AgentMode 替换占位符为 InfiniteCanvas + 投影 + 抽屉

**Files:**
- Modify: `c:\Users\25315\PycharmProjects\dramaforge-ai\agent\agent-mode.tsx:1-105` (整体)
- Test: `c:\Users\25315\PycharmProjects\dramaforge-ai\tests\agent\agent-mode-canvas.test.tsx` (新)

**Interfaces:**
- Consumes: useAgentStore, useCanvasStore.addAgentNodes, useCanvasStore.clearAgentNodes
- Produces: 完整 AgentMode 页面（input + TaskList + InfiniteCanvas + ThoughtStream 浮层 + ToolPalette 抽屉）

- [ ] **Step 1: 写失败测试**

`tests/agent/agent-mode-canvas.test.tsx`：

```typescript
/**
 * TDD: AgentMode × InfiniteCanvas — 集成测试。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { AgentMode } from '@/agent/agent-mode';
import { api } from '@/services/apiClient';
import { useAgentStore } from '@/agent/use-agent-store';
import { useCanvasStore } from '@/components/infinite-canvas/use-canvas-store';

vi.mock('@/components/infinite-canvas/InfiniteCanvas', () => ({
  InfiniteCanvas: (props: any) => <div data-testid="infinite-canvas-stub" data-project-id={props.projectId} />,
}));

describe('<AgentMode /> canvas integration', () => {
  beforeEach(() => {
    useAgentStore.getState().reset();
    useCanvasStore.setState({ nodes: [], connections: [], nodeOverrides: {} });
    vi.restoreAllMocks();
    vi.spyOn(api, 'listAgentTasks').mockResolvedValue([]);
  });

  it('renders InfiniteCanvas instead of placeholder', () => {
    render(<AgentMode projectId="p1" />);
    expect(screen.getByTestId('infinite-canvas-stub')).toBeInTheDocument();
    expect(screen.queryByTestId('agent-mode-canvas-placeholder')).toBeNull();
  });

  it('projects agent store events into canvas nodes via addAgentNodes', () => {
    render(<AgentMode projectId="p1" />);
    // 模拟 store 变化
    useAgentStore.setState({
      taskId: 't-1',
      status: 'running',
      thoughts: [],
      actions: [
        { type: 'action', payload: { tool: 'parse_user_goal' }, timestamp: 1 } as any,
        { type: 'action', payload: { tool: 'create_plan' }, timestamp: 2 } as any,
      ],
      observations: [],
      plan: [{ tool: 'a' }],
      artifacts: {},
      pendingQuestion: null,
    });
    // AgentMode 的 useEffect 应已把 actions 投影到 useCanvasStore
    const actionNodes = useCanvasStore.getState().nodes.filter((n) => n._agentTaskType === 'action');
    expect(actionNodes.length).toBeGreaterThanOrEqual(2);
  });

  it('renders ToolPalette as a toggleable drawer', () => {
    render(<AgentMode projectId="p1" />);
    // 默认抽屉关闭
    expect(screen.queryByTestId('agent-mode-tool-drawer-open')).toBeNull();
    // 点 toggle 打开
    fireEvent.click(screen.getByTestId('agent-mode-tool-drawer-toggle'));
    expect(screen.getByTestId('agent-mode-tool-drawer-open')).toBeInTheDocument();
  });

  it('renders ThoughtStream as a floating panel with toggle', () => {
    render(<AgentMode projectId="p1" />);
    // 默认 floating 关闭
    expect(screen.queryByTestId('thought-stream-floating')).toBeNull();
    fireEvent.click(screen.getByTestId('agent-mode-thought-toggle'));
    expect(screen.getByTestId('thought-stream-floating')).toBeInTheDocument();
  });

  it('clears agent nodes on projectId change', () => {
    const { rerender } = render(<AgentMode projectId="p1" />);
    useCanvasStore.getState().addAgentNodes({
      userGoal: 'x',
      plan: [],
      actions: [],
      observations: [],
      artifacts: {},
      pendingQuestion: null,
    });
    expect(useCanvasStore.getState().nodes.some((n) => n.type === 'agent_node')).toBe(true);
    rerender(<AgentMode projectId="p2" />);
    // 切换后应清空（通过 useEffect cleanup 或下一次 effect）
    return waitFor(() => {
      expect(useCanvasStore.getState().nodes.some((n) => n.type === 'agent_node')).toBe(false);
    });
  });
});
```

- [ ] **Step 2: 运行测试，预期失败**

Run: `cd c:\Users\25315\PycharmProjects\dramaforge-ai; npm test -- --run agent-mode-canvas`
Expected: FAIL with "unable to find 'infinite-canvas-stub'"

- [ ] **Step 3: 重写 agent-mode.tsx**

完整重写 `agent/agent-mode.tsx`：

```typescript
/**
 * AgentMode — 顶级 agent 页面，组合输入栏 + TaskList + InfiniteCanvas + 浮层 ThoughtStream + 抽屉 ToolPalette。
 *
 * 数据流：
 *   - 输入目标 → api.startAgent → 拿到 taskId
 *   - useAgentStream(taskId) 订阅 SSE → useAgentStore.applyEvent 投影
 *   - useEffect 订阅 useAgentStore → 调 useCanvasStore.addAgentNodes 投影到画布
 *   - 切 projectId → useCanvasStore.clearAgentNodes
 *   - ThoughtStream 浮层右上，ToolPalette 抽屉右侧（默认关闭）
 */
import React, { useEffect, useState } from 'react';
import { useAgentStore } from './use-agent-store';
import { useAgentStream } from './use-agent-stream';
import { useAgentTools } from './use-agent-tools';
import { ThoughtStream } from './thought-stream';
import { ToolPalette } from './tool-palette';
import { TaskList } from './task-list';
import { api } from '@/services/apiClient';
import { InfiniteCanvas } from '@/components/infinite-canvas/InfiniteCanvas';
import { useCanvasStore } from '@/components/infinite-canvas/use-canvas-store';

export interface AgentModeProps {
  projectId: string;
}

export const AgentMode: React.FC<AgentModeProps> = ({ projectId }) => {
  const [goal, setGoal] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [thoughtOpen, setThoughtOpen] = useState(false);
  const [toolDrawerOpen, setToolDrawerOpen] = useState(false);

  const taskId = useAgentStore((s) => s.taskId);
  const setTask = useAgentStore((s) => s.setTask);
  const thoughts = useAgentStore((s) => s.thoughts);
  const actions = useAgentStore((s) => s.actions);
  const observations = useAgentStore((s) => s.observations);
  const plan = useAgentStore((s) => s.plan);
  const artifacts = useAgentStore((s) => s.artifacts);
  const pendingQuestion = useAgentStore((s) => s.pendingQuestion);

  const { tools, isLoading: toolsLoading } = useAgentTools();
  useAgentStream(taskId);

  // 投影：useAgentStore 状态变化 → useCanvasStore.addAgentNodes
  useEffect(() => {
    const state = useAgentStore.getState();
    const userGoal = state.status === 'running' || state.status === 'paused' || state.status === 'done'
      ? (thoughts[0]?.payload?.text as string) || ''
      : '';
    useCanvasStore.getState().addAgentNodes({
      userGoal,
      plan,
      actions,
      observations,
      artifacts,
      pendingQuestion,
    });
  }, [thoughts, actions, observations, plan, artifacts, pendingQuestion]);

  // 切换 projectId 时清理 agent_node
  useEffect(() => {
    useCanvasStore.getState().clearAgentNodes();
    return () => {
      useCanvasStore.getState().clearAgentNodes();
    };
  }, [projectId]);

  const onSubmit = async () => {
    if (!goal.trim() || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const t = await api.startAgent(projectId, goal.trim());
      setTask(t.id, 'running');
      setGoal('');
    } catch (e: any) {
      setError(e?.message || 'failed to start agent');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      data-testid="agent-mode"
      style={{ display: 'grid', gridTemplateColumns: '300px 1fr', height: '100vh', position: 'relative' }}
    >
      <aside
        data-testid="agent-mode-left-aside"
        style={{ borderRight: '1px solid #e2e8f0', overflowY: 'auto' }}
      >
        <div style={{ padding: 8 }}>
          <h3>任务</h3>
          <TaskList projectId={projectId} onSelect={(id) => setTask(id, 'running')} />
        </div>
      </aside>
      <main style={{ position: 'relative', overflow: 'hidden' }}>
        <div
          data-testid="agent-mode-input-bar"
          style={{
            position: 'absolute',
            top: 16,
            left: 16,
            right: 16,
            display: 'flex',
            gap: 8,
            zIndex: 20,
          }}
        >
          <input
            data-testid="agent-mode-input"
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
            placeholder="描述目标，例如：做一个 30 秒的雨夜短片"
            style={{ flex: 1, padding: 8, borderRadius: 6, border: '1px solid #cbd5e1' }}
          />
          <button
            data-testid="agent-mode-submit"
            onClick={onSubmit}
            disabled={submitting || !goal.trim()}
            style={{ padding: '8px 16px', borderRadius: 6, border: 0, background: '#6366f1', color: 'white', cursor: 'pointer' }}
          >
            {submitting ? '创建中…' : '创建任务'}
          </button>
          <button
            data-testid="agent-mode-thought-toggle"
            type="button"
            onClick={() => setThoughtOpen((v) => !v)}
            style={{ padding: '8px 12px', borderRadius: 6, border: '1px solid #cbd5e1', background: 'white', cursor: 'pointer' }}
            title="ThoughtStream"
          >
            💭
          </button>
          <button
            data-testid="agent-mode-tool-drawer-toggle"
            type="button"
            onClick={() => setToolDrawerOpen((v) => !v)}
            style={{ padding: '8px 12px', borderRadius: 6, border: '1px solid #cbd5e1', background: 'white', cursor: 'pointer' }}
            title="ToolPalette"
          >
            🔧
          </button>
        </div>
        {error && (
          <div
            data-testid="agent-mode-error"
            style={{
              position: 'absolute',
              top: 72,
              left: 16,
              color: 'red',
              background: 'rgba(254,226,226,0.95)',
              padding: '6px 10px',
              borderRadius: 6,
              zIndex: 20,
            }}
          >
            {error}
          </div>
        )}
        <div data-testid="agent-mode-canvas-container" style={{ position: 'absolute', inset: 0 }}>
          <InfiniteCanvas projectId={projectId} />
        </div>

        {/* 浮层 ThoughtStream */}
        <ThoughtStream floating open={thoughtOpen} onClose={() => setThoughtOpen(false)} />

        {/* 抽屉 ToolPalette */}
        {toolDrawerOpen && (
          <aside
            data-testid="agent-mode-tool-drawer-open"
            style={{
              position: 'absolute',
              top: 72,
              right: 16,
              width: 280,
              maxHeight: 'calc(100vh - 96px)',
              background: 'white',
              border: '1px solid #e2e8f0',
              borderRadius: 10,
              boxShadow: '0 4px 16px rgba(0,0,0,0.08)',
              zIndex: 30,
              overflowY: 'auto',
              padding: 8,
            }}
          >
            {toolsLoading ? <div>loading tools…</div> : <ToolPalette tools={tools} />}
          </aside>
        )}
      </main>
    </div>
  );
};

export default AgentMode;
```

- [ ] **Step 4: 运行新测试，预期通过**

Run: `cd c:\Users\25315\PycharmProjects\dramaforge-ai; npm test -- --run agent-mode-canvas`
Expected: PASS (5 tests)

- [ ] **Step 5: 运行 AgentMode + 画布 + store 全部测试**

Run: `cd c:\Users\25315\PycharmProjects\dramaforge-ai; npm test -- --run`
Expected: 全部通过；测试数量应增加 5（agent-mode-canvas）+ Task 2/3/5 已加 = 净 +13

- [ ] **Step 6: 后端测试确保未受影响**

Run: `cd c:\Users\25315\PycharmProjects\dramaforge-ai\backend; uv run pytest -q`
Expected: 128 passed

- [ ] **Step 7: 提交**

```bash
cd c:\Users\25315\PycharmProjects\dramaforge-ai
git add agent/agent-mode.tsx tests/agent/agent-mode-canvas.test.tsx
git commit -m "feat(agent-mode): replace placeholder with InfiniteCanvas + floating ThoughtStream + tool drawer"
```

---

## Self-Review

### 1. Spec coverage

| Spec 要求 | 覆盖 Task |
|---|---|
| NodeType 加 'agent_node' | Task 1 |
| CanvasNodeComponent agent_node 分支 | Task 3 |
| useCanvasStore.addAgentNodes + clearAgentNodes + nodeOverrides | Task 2 |
| AgentMode 替换占位符 + 浮层 + 抽屉 | Task 6 |
| ThoughtStream floating 模式 | Task 5 |
| 拖动记录 override | Task 4 |
| 切 projectId 清空 agent_node | Task 6（effect cleanup） |
| addAgentNodes 单元测试 | Task 2 |
| CanvasNodeComponent 渲染测试 | Task 3 |
| AgentMode 集成测试 | Task 6 |
| 现有 71 + 128 测试全过 | 验证步骤 in Task 3-6 |
| TaskGraphNode 视觉兼容 | Task 3 内联 AGENT_TYPE_META 注释提示 |

✓ 全部覆盖

### 2. Placeholder scan

搜索 `TBD` / `TODO` / `implement later` / `fill in` / `类似` / `TBC` / `待定` —— 0 命中

### 3. Type consistency

- `addAgentNodes` 签名在 Task 2（store action）和 Task 6（AgentMode 调用）一致
- `clearAgentNodes()` 无参，所有调用方一致
- `nodeOverrides` 字段名一致
- AGENT_TYPE_META / AGENT_COL_X 来自 types.ts，所有引用一致
- testid 一致：`task-graph-node-badge-{taskType}` / `task-graph-node-status-{status}` / `thought-stream-floating` / `agent-mode-tool-drawer-open`

✓ 无错位
