/**
 * TDD: AgentMode — 顶级页面，组合输入栏 + TaskList + ThoughtStream + ToolPalette。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { AgentMode } from '@/agent/agent-mode';
import { api } from '@/services/apiClient';
import { useAgentStore } from '@/agent/use-agent-store';
import { useCanvasStore } from '@/components/infinite-canvas/use-canvas-store';

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

  it('clears the previous project session when opening another project', async () => {
    useAgentStore.getState().setTask('old-task', 'paused', 'old-project');
    useAgentStore.getState().applyEvent({
      type: 'request_user_input',
      payload: { question: '旧项目的问题', options: ['旧选项'] },
    });
    vi.spyOn(api, 'listAgentTasks').mockResolvedValue([]);

    render(<AgentMode projectId="new-project" />);

    await waitFor(() => expect(useAgentStore.getState().projectId).toBeNull());
    expect(useAgentStore.getState().taskId).toBeNull();
    expect(useAgentStore.getState().pendingQuestion).toBeNull();
  });

  it('renders ToolPalette with tools', async () => {
    vi.spyOn(api, 'listAgentTasks').mockResolvedValue([]);
    render(<AgentMode projectId="p1" />);
    await waitFor(() => expect(screen.getByTestId('tool-palette')).toBeInTheDocument());
  });

  it('submitting goal calls startAgent and sets task in store', async () => {
    vi.spyOn(api, 'startAgent').mockResolvedValue({ id: 't-1' } as any);
    vi.spyOn(api, 'listAgentTasks').mockResolvedValue([]);
    useCanvasStore.getState().setApiConfig({
      providers: [{ id: 'custom-api', name: 'Custom API', baseUrl: 'https://example.test/v1', protocol: 'openai', enabled: true, apiKey: '', defaultModel: '', chatModels: ['chat-1'], imageModels: [], videoModels: [] } as any],
      modelBindings: [
        { kind: 'llm', providerId: 'custom-api', modelId: 'chat-1' },
        { kind: 'image', providerId: '', modelId: '' },
        { kind: 'video', providerId: '', modelId: '' },
      ],
    });
    render(<AgentMode projectId="p1" />);
    await waitFor(() => expect(screen.getByTestId('agent-mode-input')).toBeInTheDocument());
    fireEvent.change(screen.getByTestId('agent-mode-input'), { target: { value: '做一个短片' } });
    fireEvent.click(screen.getByTestId('agent-mode-submit'));
    await waitFor(() => expect(api.startAgent).toHaveBeenCalled());
    expect(useAgentStore.getState().taskId).toBe('t-1');
  });

  it('blocks Agent startup when the LLM capability binding is absent', async () => {
    vi.spyOn(api, 'startAgent').mockResolvedValue({ id: 't-fallback' } as any);
    vi.spyOn(api, 'listAgentTasks').mockResolvedValue([]);
    useCanvasStore.getState().setApiConfig({
      providers: [{
        id: 'custom-api', name: 'Custom API', baseUrl: 'https://example.test/v1',
        protocol: 'openai', enabled: true, apiKey: '', defaultModel: '',
        chatModels: ['deepseek-v4-flash'], imageModels: [], videoModels: [],
      } as any],
      modelBindings: [
        { kind: 'llm', providerId: '', modelId: '' },
        { kind: 'image', providerId: '', modelId: '' },
        { kind: 'video', providerId: '', modelId: '' },
      ],
    });

    render(<AgentMode projectId="p1" />);
    fireEvent.change(screen.getByTestId('agent-mode-input'), { target: { value: 'fallback config' } });
    fireEvent.click(screen.getByTestId('agent-mode-submit'));

    await waitFor(() => expect(screen.getByTestId('agent-mode-error')).toHaveTextContent(/LLM.*绑定|LLM.*配置/i));
    expect(api.startAgent).not.toHaveBeenCalled();
  });
});
