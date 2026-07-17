import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AgentPetController, clampPetPosition, defaultPetPosition, loadAgentPetPosition, truncatePetText } from '@/agent/agent-pet-controller';
import { useAgentStore } from '@/agent/use-agent-store';
import { api } from '@/services/apiClient';

function createContainer(width = 800, height = 600) {
  const element = document.createElement('div');
  vi.spyOn(element, 'getBoundingClientRect').mockReturnValue({
    x: 0, y: 0, top: 0, left: 0, right: width, bottom: height,
    width, height, toJSON: () => ({}),
  } as DOMRect);
  return element;
}

describe('AgentPetController', () => {
  beforeEach(() => {
    localStorage.clear();
    useAgentStore.getState().reset();
    vi.restoreAllMocks();
  });

  it('truncates long text in the pet display', () => {
    expect(truncatePetText('a'.repeat(200), 20)).toBe(`${'a'.repeat(20)}…`);
    expect(truncatePetText('short', 20)).toBe('short');
  });

  it('starts at the center of the visible canvas when no position is saved', () => {
    expect(defaultPetPosition({ width: 900, height: 600 })).toEqual({ x: 402, y: 244 });
  });

  it('clamps persisted positions to the visible container', () => {
    expect(clampPetPosition({ x: 999, y: -20 }, { width: 400, height: 300 }, { width: 96, height: 112 })).toEqual({ x: 304, y: 0 });
    localStorage.setItem('agent-pet-position:p1', JSON.stringify({ x: 999, y: -20 }));
    expect(loadAgentPetPosition('p1')).toEqual({ x: 999, y: -20 });
  });

  it('restores a project-specific position and persists bounded dragging', async () => {
    localStorage.setItem('agent-pet-position:p1', JSON.stringify({ x: 120, y: 140 }));
    const container = createContainer();
    const ref = { current: container };
    render(<AgentPetController projectId="p1" containerRef={ref} />);

    const pet = await screen.findByTestId('agent-pet');
    const controller = screen.getByTestId('agent-pet-controller');
    await waitFor(() => expect(controller).toHaveStyle({ left: '120px', top: '140px' }));
    fireEvent.pointerDown(screen.getByTestId('agent-pet-handle'), { clientX: 140, clientY: 160, pointerId: 1 });
    fireEvent.pointerMove(document, { clientX: 1000, clientY: 1000, pointerId: 1 });
    fireEvent.pointerUp(document, { pointerId: 1 });

    await waitFor(() => {
      expect(controller).toHaveStyle({ left: '704px', top: '488px' });
      expect(JSON.parse(localStorage.getItem('agent-pet-position:p1') || '{}')).toEqual({ x: 704, y: 488 });
    });
  });

  it('shows the Agent panel by default and toggles it from the pet', () => {
    const container = createContainer();
    render(<AgentPetController projectId="p1" containerRef={{ current: container }} />);
    expect(screen.getByTestId('agent-pet-panel')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('agent-pet'));
    expect(screen.queryByTestId('agent-pet-panel')).toBeNull();
  });

  it('renders the pending question in the pet bubble and submits free text', async () => {
    vi.spyOn(api, 'respondAgent').mockResolvedValue({ ok: true } as any);
    vi.spyOn(api, 'resumeAgent').mockResolvedValue({ ok: true } as any);
    useAgentStore.setState({ taskId: 't1', status: 'paused', pendingQuestion: { question: '请告诉我你的偏好', options: [], selection_mode: 'text' } as any });
    const container = createContainer();
    render(<AgentPetController projectId="p1" containerRef={{ current: container }} />);

    expect(screen.getByTestId('agent-pet-question')).toBeInTheDocument();
    fireEvent.change(screen.getByTestId('ask-user-input'), { target: { value: '现代悬疑' } });
    fireEvent.click(screen.getByTestId('ask-user-submit'));

    await waitFor(() => expect(api.respondAgent).toHaveBeenCalledWith('t1', { response: '现代悬疑' }));
    expect(api.resumeAgent).toHaveBeenCalledWith('t1');
  });

  it('shows the latest media prompt and model in the expanded panel', () => {
    useAgentStore.setState({
      actions: [{ type: 'action', payload: {
        tool: 'generate_character_portrait',
        params: { character: { name: '阿瑞斯' } },
      } }],
      artifacts: {
        character: [{
          id: 'asset-1',
          asset_kind: 'character',
          name: '阿瑞斯',
          prompt: 'four-view warrior portrait, cinematic lighting',
          provider_id: 'custom-api',
          model_id: 'gpt-image-2',
          generating: true,
        }],
      },
    });
    const container = createContainer();
    render(<AgentPetController projectId="p1" containerRef={{ current: container }} />);

    expect(screen.getByTestId('agent-pet-media-prompt')).toHaveTextContent('four-view warrior portrait');
    expect(screen.getByTestId('agent-pet-media-model')).toHaveTextContent('gpt-image-2');
  });

  it('shows the SSE reconnecting banner with a retry button when connectionStatus is reconnecting', () => {
    useAgentStore.setState({ taskId: 't-conn', projectId: 'p1', status: 'running' });
    useAgentStore.getState().setConnectionStatus('reconnecting', '第 1/8 次重连');
    const container = createContainer();
    render(<AgentPetController projectId="p1" containerRef={{ current: container }} />);

    const banner = screen.getByTestId('agent-pet-connection-reconnecting');
    expect(banner).toBeInTheDocument();
    expect(banner.textContent).toContain('正在重连');
    expect(screen.getByTestId('agent-pet-connection-retry')).toBeInTheDocument();
  });

  it('shows the SSE disconnected banner when the retry budget is exhausted', () => {
    useAgentStore.setState({ taskId: 't-conn', projectId: 'p1', status: 'running' });
    useAgentStore.getState().setConnectionStatus('disconnected', '已尝试 8 次仍失败');
    const container = createContainer();
    render(<AgentPetController projectId="p1" containerRef={{ current: container }} />);

    const banner = screen.getByTestId('agent-pet-connection-disconnected');
    expect(banner).toBeInTheDocument();
    expect(banner.textContent).toContain('连接已断开');
    expect(screen.getByTestId('agent-pet-connection-retry')).toBeInTheDocument();
  });

  it('hides the connection banner when status is connected', () => {
    useAgentStore.setState({ taskId: 't-conn', projectId: 'p1', status: 'running', connectionStatus: 'connected', connectionDetail: null });
    const container = createContainer();
    render(<AgentPetController projectId="p1" containerRef={{ current: container }} />);

    expect(screen.queryByTestId('agent-pet-connection-reconnecting')).toBeNull();
    expect(screen.queryByTestId('agent-pet-connection-disconnected')).toBeNull();
  });
});
