/**
 * TDD: ThoughtStream — 侧栏流式展示 thoughts/actions/observations。
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { ThoughtStream } from '@/agent/thought-stream';
import { useAgentStore } from '@/agent/use-agent-store';

describe('<ThoughtStream />', () => {
  beforeEach(() => {
    useAgentStore.getState().reset();
  });

  it('renders the empty state when there are no events', () => {
    render(<ThoughtStream />);
    expect(screen.getByTestId('thought-stream')).toBeInTheDocument();
    expect(screen.getByTestId('thought-stream-empty')).toBeInTheDocument();
  });

  it('renders a thought entry with its text', () => {
    useAgentStore.getState().applyEvent({
      type: 'thought',
      payload: { text: '我先解析用户目标' },
      timestamp: 1,
    });
    render(<ThoughtStream />);
    const list = screen.getByTestId('thought-stream-thoughts');
    expect(within(list).getByText('我先解析用户目标')).toBeInTheDocument();
  });

  it('renders an action entry with tool name', () => {
    useAgentStore.getState().applyEvent({
      type: 'action',
      payload: { tool: 'parse_user_goal', params: { goal: 'x' } },
      timestamp: 1,
    });
    render(<ThoughtStream />);
    const list = screen.getByTestId('thought-stream-actions');
    expect(within(list).getByText(/parse_user_goal/)).toBeInTheDocument();
  });

  it('renders an observation entry with ok result', () => {
    useAgentStore.getState().applyEvent({
      type: 'observation',
      payload: { result: { ok: true, id: 'a1' } },
      timestamp: 1,
    });
    render(<ThoughtStream />);
    const list = screen.getByTestId('thought-stream-observations');
    expect(within(list).getByText(/ok/)).toBeInTheDocument();
  });

  it('shows the latest thought highlighted', () => {
    useAgentStore.getState().applyEvent({
      type: 'thought',
      payload: { text: '第一条' },
      timestamp: 1,
    });
    useAgentStore.getState().applyEvent({
      type: 'thought',
      payload: { text: '第二条' },
      timestamp: 2,
    });
    render(<ThoughtStream />);
    const latest = screen.getByTestId('thought-stream-latest');
    expect(within(latest).getByText('第二条')).toBeInTheDocument();
  });

  it('shows running indicator when status is running', () => {
    useAgentStore.getState().setTask('t-1', 'running');
    render(<ThoughtStream />);
    expect(screen.getByTestId('thought-stream-running')).toBeInTheDocument();
  });

  it('does not show running indicator when status is idle', () => {
    render(<ThoughtStream />);
    expect(screen.queryByTestId('thought-stream-running')).toBeNull();
  });

  it('shows failed badge when status is failed', () => {
    useAgentStore.getState().setTask('t-1', 'failed');
    useAgentStore.getState().applyEvent({
      type: 'task_failed',
      payload: { error: '出错了' },
      timestamp: 1,
    });
    render(<ThoughtStream />);
    expect(screen.getByTestId('thought-stream-failed')).toBeInTheDocument();
  });
});
