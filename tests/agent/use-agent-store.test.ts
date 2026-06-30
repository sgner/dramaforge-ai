/**
 * TDD: useAgentStore (zustand) — 管理 agent 任务状态、事件流、用户交互。
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { useAgentStore } from '@/agent/use-agent-store';

describe('useAgentStore', () => {
  beforeEach(() => {
    // 每个测试前 reset
    useAgentStore.getState().reset();
  });

  it('initial state is idle with empty collections', () => {
    const s = useAgentStore.getState();
    expect(s.status).toBe('idle');
    expect(s.taskId).toBeNull();
    expect(s.thoughts).toEqual([]);
    expect(s.actions).toEqual([]);
    expect(s.observations).toEqual([]);
    expect(s.artifacts).toEqual({});
    expect(s.plan).toEqual([]);
    expect(s.pendingQuestion).toBeNull();
    expect(s.error).toBeNull();
  });

  it('setTask seeds taskId and switches to running when status is running', () => {
    const s = useAgentStore.getState();
    s.setTask('t-1', 'running');
    const after = useAgentStore.getState();
    expect(after.taskId).toBe('t-1');
    expect(after.status).toBe('running');
  });

  it('applyEvent adds thought to thoughts list', () => {
    const s = useAgentStore.getState();
    s.setTask('t-1', 'running');
    s.applyEvent({ type: 'thought', payload: { text: '我先解析用户目标' }, timestamp: 1 });
    expect(useAgentStore.getState().thoughts).toEqual([
      { type: 'thought', payload: { text: '我先解析用户目标' }, timestamp: 1 },
    ]);
  });

  it('applyEvent adds action to actions list', () => {
    const s = useAgentStore.getState();
    s.setTask('t-1', 'running');
    s.applyEvent({ type: 'action', payload: { tool: 'parse_user_goal', params: {} }, timestamp: 1 });
    expect(useAgentStore.getState().actions).toHaveLength(1);
    expect(useAgentStore.getState().actions[0].payload.tool).toBe('parse_user_goal');
  });

  it('applyEvent adds observation to observations list', () => {
    const s = useAgentStore.getState();
    s.setTask('t-1', 'running');
    s.applyEvent({ type: 'observation', payload: { result: { ok: true } }, timestamp: 1 });
    expect(useAgentStore.getState().observations).toHaveLength(1);
  });

  it('applyEvent plan_ready sets plan array', () => {
    const s = useAgentStore.getState();
    s.setTask('t-1', 'running');
    s.applyEvent({
      type: 'plan_ready',
      payload: { plan: [{ step: 1, tool: 'generate_script' }] },
      timestamp: 1,
    });
    expect(useAgentStore.getState().plan).toEqual([{ step: 1, tool: 'generate_script' }]);
  });

  it('applyEvent artifact_created merges into artifacts by category', () => {
    const s = useAgentStore.getState();
    s.setTask('t-1', 'running');
    s.applyEvent({
      type: 'artifact_created',
      payload: { kind: 'image', asset_kind: 'character', id: 'a1', name: '林尘' },
      timestamp: 1,
    });
    const arts = useAgentStore.getState().artifacts;
    expect(arts.character).toEqual([
      { kind: 'image', asset_kind: 'character', id: 'a1', name: '林尘' },
    ]);
  });

  it('applyEvent request_user_input sets pendingQuestion', () => {
    const s = useAgentStore.getState();
    s.setTask('t-1', 'paused');
    s.applyEvent({
      type: 'request_user_input',
      payload: { question: '主角是男是女？', options: ['男', '女'] },
      timestamp: 1,
    });
    expect(useAgentStore.getState().pendingQuestion).toEqual({
      question: '主角是男是女？',
      options: ['男', '女'],
    });
  });

  it('applyEvent user_input_received clears pendingQuestion', () => {
    const s = useAgentStore.getState();
    s.setTask('t-1', 'paused');
    s.applyEvent({ type: 'request_user_input', payload: { question: 'q' }, timestamp: 1 });
    s.applyEvent({ type: 'user_input_received', payload: { response: 'r', approved: true }, timestamp: 2 });
    expect(useAgentStore.getState().pendingQuestion).toBeNull();
  });

  it('applyEvent task_done sets status to done', () => {
    const s = useAgentStore.getState();
    s.setTask('t-1', 'running');
    s.applyEvent({ type: 'task_done', payload: {}, timestamp: 1 });
    expect(useAgentStore.getState().status).toBe('done');
  });

  it('applyEvent task_failed sets status to failed and records error', () => {
    const s = useAgentStore.getState();
    s.setTask('t-1', 'running');
    s.applyEvent({ type: 'task_failed', payload: { error: '出错了' }, timestamp: 1 });
    expect(useAgentStore.getState().status).toBe('failed');
    expect(useAgentStore.getState().error).toBe('出错了');
  });

  it('applyEvent cost_update accumulates totalCostUsd', () => {
    const s = useAgentStore.getState();
    s.setTask('t-1', 'running');
    s.applyEvent({ type: 'cost_update', payload: { cost_usd: 0.05 }, timestamp: 1 });
    s.applyEvent({ type: 'cost_update', payload: { cost_usd: 0.10 }, timestamp: 2 });
    expect(useAgentStore.getState().totalCostUsd).toBeCloseTo(0.15);
  });

  it('clearPendingQuestion clears pendingQuestion only', () => {
    const s = useAgentStore.getState();
    s.setTask('t-1', 'paused');
    s.applyEvent({ type: 'request_user_input', payload: { question: 'q' }, timestamp: 1 });
    s.clearPendingQuestion();
    expect(useAgentStore.getState().pendingQuestion).toBeNull();
    expect(useAgentStore.getState().status).toBe('paused');
  });

  it('reset returns to initial state', () => {
    const s = useAgentStore.getState();
    s.setTask('t-1', 'running');
    s.applyEvent({ type: 'thought', payload: { text: 'x' }, timestamp: 1 });
    s.reset();
    const after = useAgentStore.getState();
    expect(after.status).toBe('idle');
    expect(after.taskId).toBeNull();
    expect(after.thoughts).toEqual([]);
  });
});
