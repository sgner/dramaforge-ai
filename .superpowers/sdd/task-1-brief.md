# Task 1: types.ts 添加 agent_node 与布局常量

**Files:**
- Modify: `c:\Users\25315\PycharmProjects\dramaforge-ai\components\infinite-canvas\types.ts:18-27` (NodeType 枚举)
- Modify: `c:\Users\25315\PycharmProjects\dramaforge-ai\components\infinite-canvas\types.ts:160-170` (DEFAULT_NODE_SIZES)
- Test: `c:\Users\25315\PycharmProjects\dramaforge-ai\tests\infinite-canvas\agent-node-type.test.ts` (新)

**Interfaces:**
- Consumes: 无
- Produces: `NodeType` 新成员 `'agent_node'`；导出常量 `AGENT_COL_X` / `AGENT_NODE_W` / `AGENT_NODE_H` / `AGENT_ROW_GAP` / `AGENT_TYPE_META`

## Step 1: 写失败测试

Create `tests/infinite-canvas/agent-node-type.test.ts` with this exact content:

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

## Step 2: 运行测试，预期失败

Run: `cd c:\Users\25315\PycharmProjects\dramaforge-ai; npm test -- --run agent-node-type`
Expected: FAIL with "AGENT_COL_X is not exported" 或 "Cannot find module"

## Step 3: 修改 types.ts

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

## Step 4: 运行测试，预期通过

Run: `cd c:\Users\25315\PycharmProjects\dramaforge-ai; npm test -- --run agent-node-type`
Expected: PASS (5 tests)

## Step 5: 提交

```bash
cd c:\Users\25315\PycharmProjects\dramaforge-ai
git add components/infinite-canvas/types.ts tests/infinite-canvas/agent-node-type.test.ts
git commit -m "feat(types): add agent_node to NodeType + 7-column layout constants"
```
