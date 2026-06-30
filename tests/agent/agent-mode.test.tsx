/**
 * TDD: AgentMode — 顶级页面，组合输入栏 + TaskList + ThoughtStream + ToolPalette。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { AgentMode } from '@/agent/agent-mode';
import { api } from '@/services/apiClient';
import { useAgentStore } from '@/agent/use-agent-store';

describe('<AgentMode />', () => {
  beforeEach(() => {
    useAgentStore.getState().reset();
    vi.restoreAllMocks();
  });

  it('renders input bar with goal field and create button', () => {
    render(<AgentMode projectId="p1" />);
    expect(screen.getByTestId('agent-mode-input')).toBeInTheDocument();
    expect(screen.getByTestId('agent-mode-submit')).toBeInTheDocument();
  });

  it('renders TaskList component', async () => {
    vi.spyOn(api, 'listAgentTasks').mockResolvedValue([]);
    render(<AgentMode projectId="p1" />);
    await waitFor(() => expect(screen.getByTestId('task-list')).toBeInTheDocument());
  });

  it('renders ToolPalette with tools', async () => {
    vi.spyOn(api, 'listAgentTasks').mockResolvedValue([]);
    render(<AgentMode projectId="p1" />);
    await waitFor(() => expect(screen.getByTestId('tool-palette')).toBeInTheDocument());
  });

  it('submitting goal calls startAgent and sets task in store', async () => {
    vi.spyOn(api, 'startAgent').mockResolvedValue({ id: 't-1' } as any);
    vi.spyOn(api, 'listAgentTasks').mockResolvedValue([]);
    render(<AgentMode projectId="p1" />);
    await waitFor(() => expect(screen.getByTestId('agent-mode-input')).toBeInTheDocument());
    fireEvent.change(screen.getByTestId('agent-mode-input'), { target: { value: '做一个短片' } });
    fireEvent.click(screen.getByTestId('agent-mode-submit'));
    await waitFor(() => expect(api.startAgent).toHaveBeenCalled());
    expect(useAgentStore.getState().taskId).toBe('t-1');
  });
});
