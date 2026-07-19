/**
 * 提交反馈回归测试 — 线上事故：用户回答 agent 提问后，UI 卡在
 * "✓ 已提交，等待 agent 处理…" 状态永远不动，没有任何错误提示。
 *
 * 后端取证：任务 status=paused、pending_response 已写入（respond 成功），
 * 但 resume 失败回滚后前端完全无感知（后端会发射 recoverable 的 TASK_FAILED）。
 *
 * 覆盖三条修复路径：
 * 1. respond 成功但 resume 返回 400 → 不进入"已提交"锁定态，展示失败原因 + toast。
 * 2. 收到 recoverable 的 task_failed 事件 → "已提交"态解除，错误信息可见。
 * 3. 提交后 90s 无任何 SSE 推进事件 → 看门狗解锁并提示"agent 似乎无响应，可重试"。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { AskUserResponse } from '@/agent/ask-user-response';
import { api } from '@/services/apiClient';
import { useAgentStore, SUBMIT_WATCHDOG_TIMEOUT_MS } from '@/agent/use-agent-store';
import { subscribeToast, type ToastType } from '@/utils/toast';

describe('提交反馈（submit feedback）', () => {
  let toasts: { type: ToastType; message: string }[] = [];
  let unsubscribe: () => void;

  beforeEach(() => {
    useAgentStore.getState().reset();
    vi.restoreAllMocks();
    toasts = [];
    unsubscribe = subscribeToast((type, message) => {
      toasts.push({ type, message });
    });
  });

  afterEach(() => {
    unsubscribe();
    // 防止看门狗定时器泄漏到后续测试
    useAgentStore.getState().reset();
  });

  function makePendingQuestion(question: string, options: string[]) {
    useAgentStore.setState({
      taskId: 't-submit-1',
      projectId: 'p1',
      status: 'paused',
      pendingQuestion: {
        question,
        options: options.map((label, i) => ({ id: `option-${i}`, label })),
        selection_mode: options.length ? 'single' : 'text',
        context: {},
      } as any,
    });
  }

  it('respond 成功但 resume 返回 400 → 不进入"已提交"态，展示失败原因并 toast', async () => {
    makePendingQuestion('选一个', ['A', 'B']);
    const respondSpy = vi.spyOn(api, 'respondAgent').mockResolvedValue({ ok: true } as any);
    vi.spyOn(api, 'resumeAgent').mockRejectedValue(
      new Error('API 400 Bad Request: {"detail":"Cannot resume task in status running"}'),
    );
    render(<AskUserResponse />);

    fireEvent.click(screen.getByTestId('ask-user-option-0'));
    fireEvent.click(screen.getByTestId('ask-user-submit'));

    await waitFor(() => expect(respondSpy).toHaveBeenCalledTimes(1));

    // 卡片必须显示错误（含后端 detail），不能停在"已提交，等待 agent 处理…"
    await waitFor(() => {
      const alert = screen.getByRole('alert');
      expect(alert.textContent).toContain('Cannot resume task in status running');
      expect(alert.textContent).toContain('回复已提交');
    });
    // store 未进入 answered 锁定态，卡片仍可交互（可重试）
    expect(useAgentStore.getState().pendingQuestionAnswered).toBe(false);
    expect(screen.getByTestId('ask-user-submit')).not.toBeDisabled();
    expect(screen.getByTestId('ask-user-response').className).not.toContain('is-locked');
    // toast 提示失败原因
    await waitFor(() => {
      expect(
        toasts.some(
          (t) => t.type === 'error' && t.message.includes('Cannot resume task in status running'),
        ),
      ).toBe(true);
    });
  });

  it('respond 网络错误 → 提示发送失败，可重试', async () => {
    makePendingQuestion('选一个', ['A', 'B']);
    vi.spyOn(api, 'respondAgent').mockRejectedValue(new Error('network down'));
    const resumeSpy = vi.spyOn(api, 'resumeAgent').mockResolvedValue({ ok: true } as any);
    render(<AskUserResponse />);

    fireEvent.click(screen.getByTestId('ask-user-option-0'));
    fireEvent.click(screen.getByTestId('ask-user-submit'));

    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toContain('发送失败');
    });
    // respond 失败时不应再调 resume
    expect(resumeSpy).not.toHaveBeenCalled();
    expect(useAgentStore.getState().pendingQuestionAnswered).toBe(false);
    expect(toasts.some((t) => t.type === 'error' && t.message.includes('发送失败'))).toBe(true);
  });

  it('收到 recoverable 的 task_failed → "已提交"态解除，错误可见，status 回到 paused', () => {
    const s = useAgentStore.getState();
    s.setTask('t-recoverable', 'running');
    s.applyEvent({ type: 'request_user_input', payload: { question: '确认继续？' }, timestamp: 1 });
    s.markPendingQuestionAnswered();
    s.applyEvent({ type: 'user_input_received', payload: { response: '继续' }, timestamp: 2 });
    // 此时 UI 处于"已提交，等待 agent 处理…"锁定态
    expect(useAgentStore.getState().pendingQuestionAnswered).toBe(true);

    // 后端 resume 失败回滚：status=paused + pending_response 保留 + TASK_FAILED(recoverable)
    s.applyEvent({
      type: 'task_failed',
      payload: {
        error: 'Connection reset by peer',
        recoverable: true,
        hint: 'task rolled back to paused; pending_response preserved; call /resume to retry',
      },
      timestamp: 3,
    });

    const after = useAgentStore.getState();
    // 关键 1：不能置为 failed（与 DB 的 paused 矛盾，且 SSE manager 会把 failed 当终态关连接）
    expect(after.status).toBe('paused');
    // 关键 2："已提交"锁定态解除，用户可以重试
    expect(after.pendingQuestionAnswered).toBe(false);
    // 关键 3：问题卡保留（用户能看到自己回答的是什么问题）
    expect(after.pendingQuestion).not.toBeNull();
    // 关键 4：错误信息写入 store（agent-mode banner 展示）且 toast 提示
    expect(after.error).toContain('Connection reset by peer');
    expect(after.error).toContain('重试');
    expect(
      toasts.some((t) => t.type === 'error' && t.message.includes('Connection reset by peer')),
    ).toBe(true);
  });

  it('非 recoverable 的 task_failed 仍置 failed 并清空提问卡（原行为不变）', () => {
    const s = useAgentStore.getState();
    s.setTask('t-fatal', 'running');
    s.applyEvent({ type: 'request_user_input', payload: { question: 'q' }, timestamp: 1 });
    s.markPendingQuestionAnswered();
    s.applyEvent({ type: 'task_failed', payload: { error: '致命错误' }, timestamp: 2 });

    const after = useAgentStore.getState();
    expect(after.status).toBe('failed');
    expect(after.error).toBe('致命错误');
    expect(after.pendingQuestion).toBeNull();
    expect(after.pendingQuestionAnswered).toBe(false);
    expect(toasts.some((t) => t.type === 'error' && t.message.includes('致命错误'))).toBe(true);
  });

  it('clearError 清除错误 banner 状态', () => {
    const s = useAgentStore.getState();
    s.setTask('t-clear', 'running');
    s.applyEvent({ type: 'task_failed', payload: { error: 'x' }, timestamp: 1 });
    expect(useAgentStore.getState().error).not.toBeNull();
    useAgentStore.getState().clearError();
    expect(useAgentStore.getState().error).toBeNull();
  });
});

describe('提交看门狗（submit watchdog）', () => {
  let toasts: { type: ToastType; message: string }[] = [];
  let unsubscribe: () => void;

  beforeEach(() => {
    vi.useFakeTimers();
    useAgentStore.getState().reset();
    toasts = [];
    unsubscribe = subscribeToast((type, message) => {
      toasts.push({ type, message });
    });
  });

  afterEach(() => {
    unsubscribe();
    useAgentStore.getState().reset();
    vi.useRealTimers();
  });

  function armAnswered() {
    const s = useAgentStore.getState();
    s.setTask('t-watchdog', 'paused');
    s.applyEvent({ type: 'request_user_input', payload: { question: 'q' }, timestamp: 1 });
    s.markPendingQuestionAnswered();
    expect(useAgentStore.getState().pendingQuestionAnswered).toBe(true);
  }

  it('提交后 90s 无任何推进事件 → 解锁"已提交"态并提示 agent 无响应', () => {
    armAnswered();
    vi.advanceTimersByTime(SUBMIT_WATCHDOG_TIMEOUT_MS + 100);

    const after = useAgentStore.getState();
    expect(after.pendingQuestionAnswered).toBe(false);
    expect(after.error).toContain('无响应');
    expect(after.error).toContain('重试');
    expect(toasts.some((t) => t.type === 'error' && t.message.includes('无响应'))).toBe(true);
  });

  it('90s 内收到推进事件 → 计时器重置，不误报', () => {
    armAnswered();
    // 80s 时收到 thought（agent 仍在推进）→ 计时器重置
    vi.advanceTimersByTime(SUBMIT_WATCHDOG_TIMEOUT_MS - 10_000);
    useAgentStore.getState().applyEvent({
      type: 'thought',
      payload: { text: '继续处理' },
      timestamp: 2,
    });
    // 再过 80s（距提交已 160s，但距上次推进只有 80s）→ 不应触发
    vi.advanceTimersByTime(SUBMIT_WATCHDOG_TIMEOUT_MS - 10_000);
    expect(useAgentStore.getState().pendingQuestionAnswered).toBe(true);
    expect(useAgentStore.getState().error).toBeNull();
    // 再推进过完整的超时窗口 → 触发
    vi.advanceTimersByTime(10_000 + 100);
    expect(useAgentStore.getState().pendingQuestionAnswered).toBe(false);
    expect(useAgentStore.getState().error).toContain('无响应');
  });

  it('heartbeat 保活帧不算推进事件（连接活着但 agent 没干活仍要兜底）', () => {
    armAnswered();
    // 每 15s 一个 heartbeat，模拟连接健康但 agent 无进展
    for (let i = 0; i < 6; i++) {
      vi.advanceTimersByTime(15_000);
      useAgentStore.getState().applyEvent({ type: 'heartbeat', payload: {}, timestamp: i + 2 });
    }
    // 90s 已过 → 看门狗必须触发
    expect(useAgentStore.getState().pendingQuestionAnswered).toBe(false);
    expect(useAgentStore.getState().error).toContain('无响应');
  });

  it('资产生成持续超过 90s 时不应触发无响应回退', () => {
    armAnswered();
    useAgentStore.getState().applyEvent({
      type: 'action',
      payload: { tool: 'generate_character_portrait', params: {} },
      timestamp: 2,
    });

    vi.advanceTimersByTime(SUBMIT_WATCHDOG_TIMEOUT_MS * 2 + 100);

    const after = useAgentStore.getState();
    expect(after.pendingQuestionAnswered).toBe(true);
    expect(after.error).toBeNull();
  });

  it('任务结束（task_done）→ 看门狗清除，不再误报', () => {
    armAnswered();
    useAgentStore.getState().applyEvent({ type: 'task_done', payload: {}, timestamp: 2 });
    vi.advanceTimersByTime(SUBMIT_WATCHDOG_TIMEOUT_MS * 3);
    expect(useAgentStore.getState().status).toBe('done');
    expect(useAgentStore.getState().error).toBeNull();
    expect(toasts.filter((t) => t.type === 'error')).toHaveLength(0);
  });

  it('新提问到达（request_user_input）→ 看门狗清除', () => {
    armAnswered();
    useAgentStore.getState().applyEvent({
      type: 'request_user_input',
      payload: { question: '下一个问题' },
      timestamp: 2,
    });
    vi.advanceTimersByTime(SUBMIT_WATCHDOG_TIMEOUT_MS * 3);
    expect(useAgentStore.getState().error).toBeNull();
    expect(toasts.filter((t) => t.type === 'error')).toHaveLength(0);
  });
});
