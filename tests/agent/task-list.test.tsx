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

  it('resumes a paused task from its row action', async () => {
    vi.spyOn(api, 'listAgentTasks').mockResolvedValue([
      { id: 't-paused', user_goal: 'paused goal', status: 'paused' },
    ] as any);
    const resumeSpy = vi.spyOn(api, 'resumeAgent').mockResolvedValue({ ok: true } as any);
    render(<TaskList projectId="p1" onSelect={() => {}} />);
    await waitFor(() => screen.getByTestId('task-list-row-t-paused'));

    fireEvent.click(screen.getByTestId('task-list-resume-t-paused'));
    await waitFor(() => expect(resumeSpy).toHaveBeenCalledWith('t-paused'));
  });

  it('stops a running task from its row action', async () => {
    vi.spyOn(api, 'listAgentTasks').mockResolvedValue([
      { id: 't-running', user_goal: 'running goal', status: 'running' },
    ] as any);
    const stopSpy = vi.spyOn(api, 'stopAgent').mockResolvedValue({ ok: true } as any);
    render(<TaskList projectId="p1" onSelect={() => {}} />);
    await waitFor(() => screen.getByTestId('task-list-row-t-running'));

    fireEvent.click(screen.getByTestId('task-list-stop-t-running'));
    await waitFor(() => expect(stopSpy).toHaveBeenCalledWith('t-running'));
  });

  it('retries a failed task from its row action', async () => {
    vi.spyOn(api, 'listAgentTasks').mockResolvedValue([
      { id: 't-failed', user_goal: 'failed goal', status: 'failed' },
    ] as any);
    const retrySpy = vi.spyOn(api, 'retryAgent').mockResolvedValue({ ok: true } as any);
    render(<TaskList projectId="p1" onSelect={() => {}} />);
    await waitFor(() => screen.getByTestId('task-list-row-t-failed'));

    fireEvent.click(screen.getByTestId('task-list-retry-t-failed'));
    await waitFor(() => expect(retrySpy).toHaveBeenCalledWith('t-failed'));
  });
});
