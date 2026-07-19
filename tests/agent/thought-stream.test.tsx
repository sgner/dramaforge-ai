/**
 * TDD: ThoughtStream — 侧栏流式展示 thoughts/actions/observations。
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { ThoughtStream, formatToolCall } from '@/agent/thought-stream';
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

  it('explains tool parameters in plain language instead of only showing raw JSON', () => {
    const text = formatToolCall('extract_characters', {});
    expect(text).toContain('整理角色信息');
    expect(text).toContain('从当前脚本中整理角色列表');
    expect(text).toContain('技术名称：extract_characters');
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

  it('does not render a null observation as the latest result', () => {
    useAgentStore.getState().applyEvent({
      type: 'observation',
      payload: { result: null, error: null },
      timestamp: 1,
    });
    render(<ThoughtStream />);
    expect(screen.queryByText('null')).not.toBeInTheDocument();
    expect(screen.getByTestId('thought-stream-empty')).toBeInTheDocument();
  });

  it('shows the observation error instead of hiding it behind a null result', () => {
    useAgentStore.getState().applyEvent({
      type: 'observation',
      payload: { success: false, result: null, error: '模型调用失败' },
      timestamp: 1,
    });
    render(<ThoughtStream />);
    expect(screen.getAllByText('失败：模型调用失败').length).toBeGreaterThan(0);
    expect(screen.queryByText('null')).not.toBeInTheDocument();
  });

  it('does not present an empty LLM response as a user-visible failure', () => {
    useAgentStore.getState().applyEvent({
      type: 'observation',
      payload: { success: false, tool: '_llm_call', error: 'LLM returned empty response' },
      timestamp: 1,
    });
    render(<ThoughtStream />);
    expect(screen.queryByText('失败：LLM returned empty response')).not.toBeInTheDocument();
    expect(screen.getAllByText(/模型暂未返回内容/).length).toBeGreaterThan(0);
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

  it('renders tool_retrying event with retry icon and attempt count', () => {
    useAgentStore.getState().applyEvent({
      type: 'tool_retrying',
      payload: { tool: 'generate_image', attempt: 1, max_retries: 2, delay_sec: 1.0, error: 'timeout' },
      timestamp: 1,
    });
    render(<ThoughtStream />);
    expect(screen.getAllByText(/重试中.*1.*2/)[0]).toBeInTheDocument();
  });

  it('renders tool_fallback_model event with switch icon and model name', () => {
    useAgentStore.getState().applyEvent({
      type: 'tool_fallback_model',
      payload: { tool: 'generate_image', from_model: 'dall-e-3', to_model: 'dall-e-2' },
      timestamp: 1,
    });
    render(<ThoughtStream />);
    expect(screen.getAllByText(/已切换到备选模型.*dall-e-2/)[0]).toBeInTheDocument();
  });
});
