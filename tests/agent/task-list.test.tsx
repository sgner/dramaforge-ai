import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { TaskList } from '@/agent/task-list';
import { api } from '@/services/apiClient';

describe('<TaskList />', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('renders empty state when no tasks', async () => {
    vi.spyOn(api, 'listAgentTasks').mockResolvedValue([]);
    render(<TaskList projectId="p1" onSelect={() => {}} />);
    await waitFor(() => expect(screen.getByTestId('task-list-empty')).toBeInTheDocument());
  });

  it('renders task rows with status badges', async () => {
    vi.spyOn(api, 'listAgentTasks').mockResolvedValue([
      { id: 't-1', user_goal: 'g1', status: 'running' },
      { id: 't-2', user_goal: 'g2', status: 'done' },
    ] as any);
    render(<TaskList projectId="p1" onSelect={() => {}} />);
    await waitFor(() => expect(screen.getByTestId('task-list-row-t-1')).toBeInTheDocument());
    expect(screen.getByTestId('task-list-row-t-2')).toBeInTheDocument();
    expect(screen.getByTestId('task-list-status-running')).toBeInTheDocument();
    expect(screen.getByTestId('task-list-status-done')).toBeInTheDocument();
  });

  it('clicking a row calls onSelect with task id', async () => {
    const onSelect = vi.fn();
    vi.spyOn(api, 'listAgentTasks').mockResolvedValue([
      { id: 't-1', user_goal: 'g1', status: 'running' },
    ] as any);
    render(<TaskList projectId="p1" onSelect={onSelect} />);
    await waitFor(() => screen.getByTestId('task-list-row-t-1'));
    fireEvent.click(screen.getByTestId('task-list-row-t-1'));
    expect(onSelect).toHaveBeenCalledWith('t-1');
  });

  it('refreshes on refresh button click', async () => {
    const spy = vi.spyOn(api, 'listAgentTasks').mockResolvedValue([]);
    render(<TaskList projectId="p1" onSelect={() => {}} />);
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByTestId('task-list-refresh'));
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(2));
  });
});
