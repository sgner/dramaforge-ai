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
  });
});
