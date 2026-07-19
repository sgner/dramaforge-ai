/**
 * 回归：LLM 调用失败时 store 必须显式记录 llmError，
 * UI banner 才能找到它。否则错误信息只沉在 observations 数组里，
 * 用户看到"已提交，等待 agent 处理"的旧 ask_user 卡，以为 agent 还在跑。
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { useAgentStore } from '@/agent/use-agent-store';

describe('useAgentStore · LLM 错误处理', () => {
  beforeEach(() => {
    useAgentStore.getState().reset();
  });

  it('初始 llmError 必须为 null', () => {
    expect(useAgentStore.getState().llmError).toBeNull();
    expect(useAgentStore.getState().llmErrorAt).toBeNull();
  });

  it('observation.tool === "_llm_call" 且 success=false → 必须写 llmError + llmErrorAt', () => {
    useAgentStore.getState().setTask('t-1', 'running');
    const before = Date.now();
    useAgentStore.getState().applyEvent({
      type: 'observation',
      payload: {
        step: 15,
        success: false,
        error: 'LLM call failed: LLM network error after retry: ConnectError: [SSL: UNEXPECTED_EOF_WHILE_READING]',
        action: { tool: '_llm_call', params: {} },
      },
      timestamp: Date.now(),
    });
    const after = useAgentStore.getState();
    expect(after.llmError).toContain('SSL: UNEXPECTED_EOF_WHILE_READING');
    expect(after.llmErrorAt).not.toBeNull();
    expect(after.llmErrorAt!).toBeGreaterThanOrEqual(before);
  });

  it('_llm_call 失败时必须清 currentActivity（避免"正在生成XX"误导用户）', () => {
    // 关键：LLM 失败时 user 视觉上不应再看到"agent 正在做什么"，
    // 否则会和 banner 矛盾（"刚才还在生成，怎么突然失败？"）。
    const store = useAgentStore.getState();
    store.setTask('t-activity-clear', 'running');
    // 模拟：先有一个 action 把 currentActivity 写到"正在生成角色图..."
    store.applyEvent({
      type: 'action',
      payload: { tool: 'generate_character_portrait', params: { character: { name: '林尘' } } },
      timestamp: 1,
    });
    expect(useAgentStore.getState().currentActivity).toBe('正在生成角色图：林尘…');

    // LLM 调用失败 → currentActivity 必须被清掉
    useAgentStore.getState().applyEvent({
      type: 'observation',
      payload: {
        step: 2,
        success: false,
        error: 'LLM call failed: network unreachable',
        action: { tool: '_llm_call', params: {} },
      },
      timestamp: 2,
    });
    expect(useAgentStore.getState().currentActivity).toBeNull();
  });

  it('_llm_call 失败时必须把 status 兜底切到 paused（即使后端 TASK_PAUSED 漏发）', () => {
    // 关键：之前 LLM 失败时后端只发 OBSERVATION 不发 TASK_PAUSED，前端 status
    // 一直停留在 'running'，用户看到活动指示器还在但 task 实际已 paused。
    // 修复：observation 处理器兜底设置 status='paused'，与后端 DB 保持一致。
    useAgentStore.getState().setTask('t-status-paused', 'running');
    useAgentStore.getState().applyEvent({
      type: 'observation',
      payload: {
        step: 1,
        success: false,
        error: 'LLM call failed: 401 Unauthorized',
        action: { tool: '_llm_call', params: {} },
      },
      timestamp: Date.now(),
    });
    expect(useAgentStore.getState().status).toBe('paused');
  });

  it('_llm_call 失败时不应破坏已终态的任务（done/failed/cancelled）', () => {
    // 兜底逻辑必须尊重终态：用户已看到 done 后回放历史事件
    // （rehydrate / SSE replay），不应该把 done 改成 paused。
    useAgentStore.getState().setTask('t-done', 'done');
    useAgentStore.getState().applyEvent({
      type: 'observation',
      payload: {
        step: 1,
        success: false,
        error: 'old llm error from history',
        action: { tool: '_llm_call', params: {} },
      },
      timestamp: Date.now(),
    });
    expect(useAgentStore.getState().status).toBe('done');
    expect(useAgentStore.getState().llmError).toContain('old llm error');
  });

  it('非 _llm_call 失败的 observation → 绝不能污染 llmError', () => {
    useAgentStore.getState().setTask('t-1', 'running');
    useAgentStore.getState().applyEvent({
      type: 'observation',
      payload: {
        step: 1,
        success: false,
        error: 'tool failed',
        action: { tool: 'generate_image', params: {} },
      },
      timestamp: Date.now(),
    });
    // llmError 必须保持 null（普通工具失败由 ErrorRecoveryCard 处理）
    expect(useAgentStore.getState().llmError).toBeNull();
  });

  it('成功的 _llm_call observation → 绝不能写 llmError', () => {
    useAgentStore.getState().setTask('t-1', 'running');
    useAgentStore.getState().applyEvent({
      type: 'observation',
      payload: {
        step: 1,
        success: true,
        result: { content: '...' },
        action: { tool: '_llm_call', params: {} },
      },
      timestamp: Date.now(),
    });
    expect(useAgentStore.getState().llmError).toBeNull();
  });

  it('内部 JSON 解析重试 observation 不应显示为最新观察或 LLM 错误', () => {
    useAgentStore.getState().setTask('t-parse-noise', 'running');
    useAgentStore.getState().applyEvent({
      type: 'observation',
      payload: {
        step: 3,
        internal: true,
        success: false,
        error: 'Invalid decision JSON: unable to extract an object {"thought":"..."}',
        action: { tool: '_llm_call', params: {} },
      },
      timestamp: Date.now(),
    });

    const state = useAgentStore.getState();
    expect(state.observations).toHaveLength(0);
    expect(state.llmError).toBeNull();
  });

  it('历史遗留的 Invalid decision JSON 也不应污染用户界面', () => {
    useAgentStore.getState().setTask('t-legacy-parse-noise', 'running');
    useAgentStore.getState().applyEvent({
      type: 'observation',
      payload: {
        step: 3,
        success: false,
        error: 'Invalid decision JSON: unable to extract an object {"action":{}}',
        action: { tool: '_llm_call', params: {} },
      },
      timestamp: Date.now(),
    });

    const state = useAgentStore.getState();
    expect(state.observations).toHaveLength(0);
    expect(state.llmError).toBeNull();
  });

  it('task_resumed → 必须清掉 llmError（用户已 resume，banner 不应再挂）', () => {
    useAgentStore.getState().setTask('t-1', 'paused');
    useAgentStore.getState().applyEvent({
      type: 'observation',
      payload: {
        step: 1, success: false, error: 'old llm error',
        action: { tool: '_llm_call', params: {} },
      },
      timestamp: Date.now(),
    });
    expect(useAgentStore.getState().llmError).not.toBeNull();

    useAgentStore.getState().applyEvent({
      type: 'task_resumed', payload: {}, timestamp: Date.now(),
    });
    expect(useAgentStore.getState().llmError).toBeNull();
    expect(useAgentStore.getState().llmErrorAt).toBeNull();
  });

  it('user_input_received → 必须清掉 llmError（用户重答，LLM 即将被再调）', () => {
    useAgentStore.getState().setTask('t-1', 'paused');
    useAgentStore.getState().applyEvent({
      type: 'observation',
      payload: {
        step: 1, success: false, error: 'old llm error',
        action: { tool: '_llm_call', params: {} },
      },
      timestamp: Date.now(),
    });
    expect(useAgentStore.getState().llmError).not.toBeNull();

    useAgentStore.getState().applyEvent({
      type: 'user_input_received', payload: {}, timestamp: Date.now(),
    });
    expect(useAgentStore.getState().llmError).toBeNull();
  });

  it('clearLlmError → 必须把 llmError 和 llmErrorAt 都清掉', () => {
    useAgentStore.getState().setTask('t-1', 'paused');
    useAgentStore.getState().applyEvent({
      type: 'observation',
      payload: {
        step: 1, success: false, error: 'some error',
        action: { tool: '_llm_call', params: {} },
      },
      timestamp: Date.now(),
    });
    expect(useAgentStore.getState().llmError).not.toBeNull();

    useAgentStore.getState().clearLlmError();
    const after = useAgentStore.getState();
    expect(after.llmError).toBeNull();
    expect(after.llmErrorAt).toBeNull();
    // status 不能被 clearLlmError 重置（task 仍在 paused，可以重答问题）
    expect(after.status).toBe('paused');
  });

  it('reset() 必须把 llmError 一起清掉', () => {
    useAgentStore.getState().setTask('t-1', 'paused');
    useAgentStore.getState().applyEvent({
      type: 'observation',
      payload: {
        step: 1, success: false, error: 'x',
        action: { tool: '_llm_call', params: {} },
      },
      timestamp: Date.now(),
    });
    expect(useAgentStore.getState().llmError).not.toBeNull();

    useAgentStore.getState().reset();
    expect(useAgentStore.getState().llmError).toBeNull();
    expect(useAgentStore.getState().llmErrorAt).toBeNull();
  });
});
