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

  it('setTask resets previous task state (no event leakage when switching tasks)', () => {
    // 模拟先跑 task A：往 store 里塞一些 events
    useAgentStore.getState().setTask('t-A', 'running');
    useAgentStore.getState().applyEvent({ type: 'thought', payload: { text: 'A 的想法' }, timestamp: 1 });
    useAgentStore.getState().applyEvent({ type: 'action', payload: { tool: 'a_tool' }, timestamp: 2 });
    useAgentStore.getState().applyEvent({ type: 'observation', payload: { ok: true }, timestamp: 3 });
    expect(useAgentStore.getState().thoughts).toHaveLength(1);
    expect(useAgentStore.getState().actions).toHaveLength(1);
    expect(useAgentStore.getState().observations).toHaveLength(1);

    // 切到 task B：setTask 应当把 events 全清掉
    useAgentStore.getState().setTask('t-B', 'paused');

    const after = useAgentStore.getState();
    expect(after.taskId).toBe('t-B');
    expect(after.status).toBe('paused');
    expect(after.thoughts).toEqual([]);
    expect(after.actions).toEqual([]);
    expect(after.observations).toEqual([]);
    expect(after.plan).toEqual([]);
    expect(after.artifacts).toEqual({});
  });

  it('hydrate restores plan / artifacts / status / cost from persisted snapshot', () => {
    useAgentStore.getState().setTask('t-1', 'paused');
    useAgentStore.getState().hydrate({
      status: 'done',
      plan: [{ tool: 'a' }, { tool: 'b' }],
      artifacts: { character: [{ id: 'c1', kind: 'image', url: 'http://x' }] },
      total_cost_usd: 0.0123,
      total_tokens: 4567,
    });
    const after = useAgentStore.getState();
    expect(after.status).toBe('done');
    expect(after.plan).toEqual([{ tool: 'a' }, { tool: 'b' }]);
    expect(after.artifacts.character).toHaveLength(1);
    expect(after.totalCostUsd).toBe(0.0123);
    expect(after.totalTokens).toBe(4567);
  });

  it('hydrate restores pendingQuestion when pending_response is an unanswered ask_user payload', () => {
    useAgentStore.getState().setTask('t-2', 'paused');
    useAgentStore.getState().hydrate({
      status: 'paused',
      pending_response: {
        question: '你想要的题材是？',
        options: ['科幻', '悬疑'],
      },
    });
    const after = useAgentStore.getState();
    expect(after.pendingQuestion).not.toBeNull();
    expect(after.pendingQuestion!.question).toBe('你想要的题材是？');
    expect(after.pendingQuestion!.options).toEqual([
      { id: 'option-0', label: '科幻' },
      { id: 'option-1', label: '悬疑' },
    ]);
  });

  it('hydrate ignores pending_response that already has a response (already answered)', () => {
    useAgentStore.getState().setTask('t-3', 'paused');
    useAgentStore.getState().hydrate({
      status: 'paused',
      pending_response: { response: '科幻', approved: true },
    });
    // 不应当把已 answered 的 pending_response 还原成 pendingQuestion
    expect(useAgentStore.getState().pendingQuestion).toBeNull();
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
    expect(useAgentStore.getState().pendingQuestion).toMatchObject({
      question: '主角是男是女？',
      options: [{ id: 'option-0', label: '男' }, { id: 'option-1', label: '女' }],
      selection_mode: 'single',
    });
  });

  it('normalizes legacy string options as single-select options', () => {
    useAgentStore.getState().applyEvent({
      type: 'request_user_input',
      payload: { question: '选择题材', options: ['古风', '现代'] },
    });

    expect(useAgentStore.getState().pendingQuestion).toMatchObject({
      selection_mode: 'single',
      options: [
        { id: 'option-0', label: '古风' },
        { id: 'option-1', label: '现代' },
      ],
    });
  });

  it('preserves structured multiple-select metadata and response arrays', () => {
    useAgentStore.getState().applyEvent({
      type: 'request_user_input',
      payload: {
        question: '选择标签',
        options: [{ id: 'style', label: '古风' }, { id: 'tone', label: '悬疑' }],
        selection_mode: 'multiple',
        allow_custom: true,
        min_selections: 1,
        max_selections: 2,
      },
    });

    expect(useAgentStore.getState().pendingQuestion).toMatchObject({
      selection_mode: 'multiple',
      allow_custom: true,
      min_selections: 1,
      max_selections: 2,
      options: [
        { id: 'style', label: '古风' },
        { id: 'tone', label: '悬疑' },
      ],
    });

    useAgentStore.getState().applyEvent({
      type: 'user_input_received',
      payload: { response: ['古风', '悬疑'], custom_text: '节奏偏快' },
    });
    expect(useAgentStore.getState().pendingQuestion).toBeNull();
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

  it('applyEvent tool_error sets pendingErrorRecovery and status=paused', () => {
    const s = useAgentStore.getState();
    s.setTask('t-1', 'running');
    s.applyEvent({
      type: 'tool_error',
      payload: {
        step_id: '3',
        tool: 'generate_image',
        error: 'network timeout',
        params: { model_id: 'dall-e-3' },
        fallback_model_id: 'dall-e-2',
        available_models: [{ id: 'dall-e-2', label: 'DALL-E 2' }],
      },
      timestamp: 1,
    });
    const after = useAgentStore.getState();
    expect(after.status).toBe('paused');
    expect(after.pendingErrorRecovery).toEqual({
      stepId: '3',
      tool: 'generate_image',
      error: 'network timeout',
      params: { model_id: 'dall-e-3' },
      fallbackModelId: 'dall-e-2',
      availableModels: [{ id: 'dall-e-2', label: 'DALL-E 2' }],
    });
  });

  it('applyEvent tool_resumed clears pendingErrorRecovery and sets status=running', () => {
    const s = useAgentStore.getState();
    s.setTask('t-1', 'running');
    // 先触发 tool_error
    s.applyEvent({
      type: 'tool_error',
      payload: { step_id: '1', tool: 'x', error: 'e', params: {}, fallback_model_id: null, available_models: [] },
      timestamp: 1,
    });
    expect(useAgentStore.getState().pendingErrorRecovery).not.toBeNull();
    // 再触发 tool_resumed
    s.applyEvent({ type: 'tool_resumed', payload: { step_id: '1', action: 'retry' }, timestamp: 2 });
    const after = useAgentStore.getState();
    expect(after.pendingErrorRecovery).toBeNull();
    expect(after.status).toBe('running');
  });

  it('applyEvent tool_retrying appends to thoughts', () => {
    const s = useAgentStore.getState();
    s.setTask('t-1', 'running');
    s.applyEvent({
      type: 'tool_retrying',
      payload: { tool: 'generate_image', attempt: 1, max_retries: 2, delay_sec: 1.0, error: 'timeout' },
      timestamp: 1,
    });
    expect(useAgentStore.getState().thoughts).toHaveLength(1);
    expect(useAgentStore.getState().thoughts[0].type).toBe('tool_retrying');
  });

  it('applyEvent tool_fallback_model appends to thoughts', () => {
    const s = useAgentStore.getState();
    s.setTask('t-1', 'running');
    s.applyEvent({
      type: 'tool_fallback_model',
      payload: { tool: 'generate_image', from_model: 'dall-e-3', to_model: 'dall-e-2' },
      timestamp: 1,
    });
    expect(useAgentStore.getState().thoughts).toHaveLength(1);
    expect(useAgentStore.getState().thoughts[0].type).toBe('tool_fallback_model');
  });

  it('clearErrorRecovery clears pendingErrorRecovery', () => {
    const s = useAgentStore.getState();
    s.setTask('t-1', 'running');
    s.applyEvent({
      type: 'tool_error',
      payload: { step_id: '1', tool: 'x', error: 'e', params: {}, fallback_model_id: null, available_models: [] },
      timestamp: 1,
    });
    expect(useAgentStore.getState().pendingErrorRecovery).not.toBeNull();
    useAgentStore.getState().clearErrorRecovery();
    expect(useAgentStore.getState().pendingErrorRecovery).toBeNull();
  });
});
