/**
 * TDD: addAgentNodes — 把 agent 事件投影到画布节点，按"单条横向时间线"布局。
 *
 * 布局策略（横向时间线）：
 *  - 所有事件按发生顺序（goal → plan → actions → observations → artifacts → question）
 *    排成一条横向时间线
 *  - 每行 AGENT_GRID_COLS=5 个节点，超出换行（row=floor(idx/5), col=idx%5）
 *  - plan / artifact / question 节点用 AGENT_NODE_H_TALL=168，其他用 AGENT_NODE_H=120
 *  - 总节点数 MAX_AGENT_NODES=20 / 同类型 MAX_AGENT_NODES_PER_TYPE=8
 *  - 目标：用户一眼看到完整 agent 进展
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { useCanvasStore } from '@/components/infinite-canvas/use-canvas-store';
import {
  AGENT_NODE_W,
  AGENT_NODE_H,
  AGENT_NODE_H_TALL,
  AGENT_COL_GAP,
  AGENT_ROW_GAP,
  AGENT_GRID_COLS,
} from '@/components/infinite-canvas/types';

describe('addAgentNodes (horizontal timeline)', () => {
  beforeEach(() => {
    useCanvasStore.setState({
      nodes: [],
      connections: [],
      nodeOverrides: {},
    });
  });

  it('inserts goal node at x=0 (start of timeline)', () => {
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
    expect(goal!.y).toBe(0);
    expect(goal!.type).toBe('agent_node');
    expect(goal!._agentLabel).toBe('做一个雨夜短片');
  });

  it('inserts plan node at x=0 (first item) when no goal', () => {
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
    // userGoal 为空时 plan 排在 idx 0 → x=0
    expect(plan!.x).toBe(0);
    expect(plan!.y).toBe(0);
    expect(plan!._agentLabel).toContain('3');
    expect(plan!.h).toBe(AGENT_NODE_H_TALL);
  });

  it('5 action nodes after a goal fill the first row, 6th overflows to row 2', () => {
    useCanvasStore.getState().addAgentNodes({
      userGoal: 'g',
      plan: [],
      actions: Array.from({ length: 5 }, (_, i) => ({
        type: 'action',
        payload: { tool: `t${i + 1}` },
        timestamp: i + 1,
      })) as any,
      observations: [],
      artifacts: {},
      pendingQuestion: null,
    });
    const allAgents = useCanvasStore.getState().nodes
      .filter((n) => n.type === 'agent_node')
      .sort((a, b) => (a.y - b.y) || (a.x - b.x));
    expect(allAgents).toHaveLength(6);
    // idx 0 = goal, x=0, y=0
    expect(allAgents[0]._agentTaskType).toBe('goal');
    expect(allAgents[0].x).toBe(0);
    expect(allAgents[0].y).toBe(0);
    // idx 1 = action[0], col=1, x=236, y=0
    expect(allAgents[1]._agentTaskType).toBe('action');
    expect(allAgents[1].x).toBe(1 * (AGENT_NODE_W + AGENT_COL_GAP));
    expect(allAgents[1].y).toBe(0);
    // idx 4 = action[3], col=4, x=944, y=0
    expect(allAgents[4].x).toBe(4 * (AGENT_NODE_W + AGENT_COL_GAP));
    expect(allAgents[4].y).toBe(0);
    // idx 5 = action[4], col=0, row=1 → x=0, y=136
    expect(allAgents[5]._agentTaskType).toBe('action');
    expect(allAgents[5].x).toBe(0);
    expect(allAgents[5].y).toBe(AGENT_NODE_H + AGENT_ROW_GAP);
  });

  it('overflow to 2nd row when total event count > GRID_COLS', () => {
    // 6 events = goal + 5 actions → 第 6 个 action (idx=5) 应该换行
    useCanvasStore.getState().addAgentNodes({
      userGoal: 'g',
      plan: [],
      actions: Array.from({ length: 5 }, (_, i) => ({
        type: 'action',
        payload: { tool: `t${i + 1}` },
        timestamp: i + 1,
      })) as any,
      observations: [],
      artifacts: {},
      pendingQuestion: null,
    });
    const actions = useCanvasStore.getState().nodes.filter((n) => n._agentTaskType === 'action');
    expect(actions).toHaveLength(5);
    // 第 5 个 action (idx=5 in timeline，因为 goal=0) → row 1
    const lastAction = actions[4];
    expect(lastAction.y).toBe(AGENT_NODE_H + AGENT_ROW_GAP);
  });

  it('inserts observation nodes continuing the timeline flow', () => {
    useCanvasStore.getState().addAgentNodes({
      userGoal: 'g',
      plan: [],
      actions: [],
      observations: [
        { type: 'observation', payload: { result: { ok: true } }, timestamp: 1 } as any,
        { type: 'observation', payload: { result: { ok: true } }, timestamp: 2 } as any,
      ],
      artifacts: {},
      pendingQuestion: null,
    });
    const obs = useCanvasStore.getState().nodes.filter((n) => n._agentTaskType === 'observation');
    expect(obs).toHaveLength(2);
    // 2 个 obs 紧跟 goal (idx 0)：obs[0] idx=1, obs[1] idx=2
    expect(obs[0].x).toBe(1 * (AGENT_NODE_W + AGENT_COL_GAP));
    expect(obs[1].x).toBe(2 * (AGENT_NODE_W + AGENT_COL_GAP));
  });

  it('flattens artifacts from multiple buckets and continues timeline', () => {
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
    // 3 artifacts 在第 1 行：idx 0-2
    expect(artifacts[0].x).toBe(0);
    expect(artifacts[1].x).toBe(1 * (AGENT_NODE_W + AGENT_COL_GAP));
    expect(artifacts[2].x).toBe(2 * (AGENT_NODE_W + AGENT_COL_GAP));
    expect(artifacts[0].y).toBe(0);
  });

  it('inserts question node continuing the timeline when pendingQuestion is set', () => {
    useCanvasStore.getState().addAgentNodes({
      userGoal: 'g',
      plan: [],
      actions: [],
      observations: [],
      artifacts: {},
      pendingQuestion: { question: '你想做什么风格？' },
    });
    const q = useCanvasStore.getState().nodes.find((n) => n._agentTaskType === 'question');
    expect(q).toBeDefined();
    // idx 1 (goal + question)
    expect(q!.x).toBe(1 * (AGENT_NODE_W + AGENT_COL_GAP));
    expect(q!.h).toBe(AGENT_NODE_H_TALL);
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

  it('respects nodeOverrides for x/y offset', () => {
    useCanvasStore.setState({ projectId: 'test' });
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
    const goal = useCanvasStore.getState().nodes.find((n) => n._agentTaskType === 'goal');
    expect(goal!.x).toBe(50);
    expect(goal!.y).toBe(100);
  });

  it('caps total node count when many observations are added', () => {
    const many = Array.from({ length: 50 }, (_, i) => ({
      type: 'observation',
      payload: { result: { i } },
      timestamp: i,
    }));
    useCanvasStore.getState().addAgentNodes({
      userGoal: '',
      plan: [],
      actions: [],
      observations: many as any,
      artifacts: {},
      pendingQuestion: null,
    });
    const obs = useCanvasStore.getState().nodes.filter((n) => n._agentTaskType === 'observation');
    // 限制单类型最多 5 个（MAX_AGENT_NODES_PER_TYPE）
    expect(obs.length).toBeLessThanOrEqual(5);
    expect(obs.length).toBeGreaterThan(0);
  });
});
