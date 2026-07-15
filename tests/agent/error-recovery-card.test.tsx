/**
 * TDD: ErrorRecoveryCard — 工具失败恢复模态卡。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ErrorRecoveryCard } from '@/agent/error-recovery-card';
import { useAgentStore } from '@/agent/use-agent-store';

vi.mock('@/services/apiClient', () => ({
  api: {
    respondAgent: vi.fn().mockResolvedValue({ ok: true }),
    resumeAgent: vi.fn().mockResolvedValue({ ok: true }),
  },
}));

describe('<ErrorRecoveryCard />', () => {
  beforeEach(() => {
    useAgentStore.getState().reset();
    useAgentStore.getState().setTask('t-1', 'running');
    vi.clearAllMocks();
  });

  it('renders nothing when pendingErrorRecovery is null', () => {
    const { container } = render(<ErrorRecoveryCard />);
    expect(container.firstChild).toBeNull();
  });

  it('renders modal card when pendingErrorRecovery is set', () => {
    useAgentStore.getState().applyEvent({
      type: 'tool_error',
      payload: {
        step_id: '3',
        tool: 'generate_image',
        error: 'network timeout',
        params: {},
        fallback_model_id: null,
        available_models: [],
      },
      timestamp: 1,
    });
    render(<ErrorRecoveryCard />);
    expect(screen.getByTestId('error-recovery-card')).toBeInTheDocument();
    expect(screen.getByTestId('erc-tool')).toHaveTextContent('generate_image');
    expect(screen.getByTestId('erc-error')).toHaveTextContent('network timeout');
  });

  it('defaults to retry action', () => {
    useAgentStore.getState().applyEvent({
      type: 'tool_error',
      payload: {
        step_id: '1', tool: 'x', error: 'e', params: {},
        fallback_model_id: null, available_models: [],
      },
      timestamp: 1,
    });
    render(<ErrorRecoveryCard />);
    const retryRadio = screen.getByDisplayValue('retry') as HTMLInputElement;
    expect(retryRadio.checked).toBe(true);
  });

  it('shows model select when change_model is selected', () => {
    useAgentStore.getState().applyEvent({
      type: 'tool_error',
      payload: {
        step_id: '1', tool: 'x', error: 'e', params: {},
        fallback_model_id: 'dall-e-2',
        available_models: [{ id: 'dall-e-2', label: 'DALL-E 2' }, { id: 'sdxl', label: 'SDXL' }],
      },
      timestamp: 1,
    });
    render(<ErrorRecoveryCard />);
    // 初始不显示 select
    expect(screen.queryByTestId('erc-model-select')).toBeNull();
    // 选 change_model
    fireEvent.click(screen.getByDisplayValue('change_model'));
    expect(screen.getByTestId('erc-model-select')).toBeInTheDocument();
  });

  it('calls api.respond with correct payload on confirm', async () => {
    const { api } = await import('@/services/apiClient');
    useAgentStore.getState().applyEvent({
      type: 'tool_error',
      payload: {
        step_id: '1', tool: 'x', error: 'e', params: {},
        fallback_model_id: 'dall-e-2',
        available_models: [{ id: 'dall-e-2', label: 'DALL-E 2' }],
      },
      timestamp: 1,
    });
    render(<ErrorRecoveryCard />);
    fireEvent.click(screen.getByDisplayValue('change_model'));
    fireEvent.click(screen.getByTestId('erc-confirm'));
    await waitFor(() => {
      expect(api.respondAgent).toHaveBeenCalledWith('t-1', {
        response: 'change_model',
        recovery_action: 'change_model',
        new_model_id: 'dall-e-2',
      });
      expect(api.resumeAgent).toHaveBeenCalledWith('t-1');
    });
  });

  it('skip action sends new_model_id=null', async () => {
    const { api } = await import('@/services/apiClient');
    useAgentStore.getState().applyEvent({
      type: 'tool_error',
      payload: {
        step_id: '1', tool: 'x', error: 'e', params: {},
        fallback_model_id: null, available_models: [],
      },
      timestamp: 1,
    });
    render(<ErrorRecoveryCard />);
    fireEvent.click(screen.getByDisplayValue('skip'));
    fireEvent.click(screen.getByTestId('erc-confirm'));
    await waitFor(() => {
      expect(api.respondAgent).toHaveBeenCalledWith('t-1', {
        response: 'skip',
        recovery_action: 'skip',
        new_model_id: null,
      });
    });
  });
});
