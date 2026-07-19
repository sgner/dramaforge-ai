/**
 * 回归：用户提交回复后 agent 处理失败，"已提交"锁定卡必须解锁。
 *
 * 故障路径（backend/app/agent/runtime.py + routers/agent.py）：
 * - runtime LLM 连续调用失败 → OBSERVATION(_llm_call) + error notice + TASK_PAUSED
 * - 编排层故障（NoLLMConfigured / 重建 runtime 失败）→ 只发 error 级 agent_notice，
 *   不发 task_paused
 * 修复前：pendingQuestionAnswered 保持 true，卡片卡在"已提交，等待 agent 处理…"
 * 禁用状态；自动恢复重试的 warning notice 又不断重置 90s 提交看门狗，实际无限期卡死。
 * 修复后：task_paused / error 级 agent_notice 到达时立即解锁卡片并提示可重发。
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { useAgentStore } from '@/agent/use-agent-store';

function setupAnsweredQuestion() {
  const store = useAgentStore.getState();
  store.setTask('t-unlock', 'running');
  store.applyEvent({
    type: 'request_user_input',
    payload: { step_id: 's1', question: '确认继续吗？', options: ['继续', '调整'] },
    timestamp: 1,
  });
  useAgentStore.getState().markPendingQuestionAnswered();
}

describe('useAgentStore · 提交后失败解锁提问卡', () => {
  beforeEach(() => {
    useAgentStore.getState().reset();
  });

  it('task_paused 到达时已提交卡片必须解锁，保留问题并提示可重发', () => {
    setupAnsweredQuestion();
    expect(useAgentStore.getState().pendingQuestionAnswered).toBe(true);

    useAgentStore.getState().applyEvent({
      type: 'task_paused',
      payload: { reason: 'llm_call_failed', error: 'LLM call failed: 402 insufficient balance' },
      timestamp: 2,
    });

    const s = useAgentStore.getState();
    expect(s.pendingQuestionAnswered).toBe(false);
    expect(s.status).toBe('paused');
    // 问题保留：用户能修改答案后重新发送
    expect(s.pendingQuestion).not.toBeNull();
    expect(s.error).toContain('insufficient balance');
    expect(s.error).toContain('重新发送');
  });

  it('task_paused 到达时未提交（卡片本就 editable）→ 不写 error，仅切 paused', () => {
    const store = useAgentStore.getState();
    store.setTask('t-unlock', 'running');
    store.applyEvent({
      type: 'request_user_input',
      payload: { step_id: 's1', question: '确认继续吗？', options: ['继续'] },
      timestamp: 1,
    });

    useAgentStore.getState().applyEvent({
      type: 'task_paused',
      payload: { reason: 'ask_user' },
      timestamp: 2,
    });

    const s = useAgentStore.getState();
    expect(s.status).toBe('paused');
    expect(s.error).toBeNull();
  });

  it('error 级 agent_notice 到达时已提交卡片必须解锁（编排层故障不发 task_paused）', () => {
    setupAnsweredQuestion();

    useAgentStore.getState().applyEvent({
      type: 'agent_notice',
      payload: { level: 'error', message: 'no llm provider configured. Open API settings to add at least one provider.', source: 'configuration' },
      timestamp: 2,
    });

    const s = useAgentStore.getState();
    expect(s.pendingQuestionAnswered).toBe(false);
    expect(s.status).toBe('paused');
    expect(s.pendingQuestion).not.toBeNull();
    expect(s.error).toContain('no llm provider');
    // notice 本身也要进入 ThoughtStream
    expect(s.thoughts.some((t) => t.type === 'agent_notice')).toBe(true);
  });

  it('warning 级 agent_notice 不解锁（agent 仍在自动重试/自我纠正）', () => {
    setupAnsweredQuestion();

    useAgentStore.getState().applyEvent({
      type: 'agent_notice',
      payload: { level: 'warning', message: 'LLM 调用失败，正在自动重试（第 1/3 次）…', source: 'llm' },
      timestamp: 2,
    });

    const s = useAgentStore.getState();
    expect(s.pendingQuestionAnswered).toBe(true);
    expect(s.error).toBeNull();
  });

  it('error 级 agent_notice 在终态任务上不改变 status', () => {
    setupAnsweredQuestion();
    useAgentStore.getState().applyEvent({
      type: 'task_done',
      payload: {},
      timestamp: 2,
    });
    // task_done 会清掉 answered；重新构造一个"已提交但任务已 done"的边界态
    useAgentStore.getState().applyEvent({
      type: 'request_user_input',
      payload: { step_id: 's2', question: '再来一次？', options: ['好'] },
      timestamp: 3,
    });
    useAgentStore.getState().markPendingQuestionAnswered();
    useAgentStore.setState({ status: 'done' });

    useAgentStore.getState().applyEvent({
      type: 'agent_notice',
      payload: { level: 'error', message: 'late failure', source: 'runtime' },
      timestamp: 4,
    });

    expect(useAgentStore.getState().status).toBe('done');
    expect(useAgentStore.getState().pendingQuestionAnswered).toBe(false);
  });
});
