/**
 * TDD: AgentMode × InfiniteCanvas — 集成测试。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { AgentMode } from '@/agent/agent-mode';
import { api } from '@/services/apiClient';
import { useAgentStore } from '@/agent/use-agent-store';
import { useCanvasStore } from '@/components/infinite-canvas/use-canvas-store';

vi.mock('@/components/infinite-canvas/InfiniteCanvas', () => ({
  InfiniteCanvas: (props: any) => <div data-testid="infinite-canvas-stub" data-project-id={props.projectId} />,
}));

describe('<AgentMode /> canvas integration', () => {
  beforeEach(() => {
    useAgentStore.getState().reset();
    useCanvasStore.setState({ nodes: [], connections: [], nodeOverrides: {} });
    vi.restoreAllMocks();
    vi.spyOn(api, 'listAgentTasks').mockResolvedValue([]);
  });

  it('renders InfiniteCanvas instead of placeholder', () => {
    render(<AgentMode projectId="p1" />);
    expect(screen.getByTestId('infinite-canvas-stub')).toBeInTheDocument();
    expect(screen.queryByTestId('agent-mode-canvas-placeholder')).toBeNull();
  });

  it('projects agent store events into canvas nodes via addAgentNodes', () => {
    render(<AgentMode projectId="p1" />);
    useAgentStore.setState({
      taskId: 't-1',
      status: 'running',
      thoughts: [],
      actions: [
        { type: 'action', payload: { tool: 'parse_user_goal' }, timestamp: 1 } as any,
        { type: 'action', payload: { tool: 'create_plan' }, timestamp: 2 } as any,
      ],
      observations: [],
      plan: [{ tool: 'a' }],
      artifacts: {},
      pendingQuestion: null,
    });
    const actionNodes = useCanvasStore.getState().nodes.filter((n) => n._agentTaskType === 'action');
    expect(actionNodes.length).toBeGreaterThanOrEqual(2);
  });

  it('renders ToolPalette as a toggleable drawer', () => {
    render(<AgentMode projectId="p1" />);
    expect(screen.queryByTestId('agent-mode-tool-drawer-open')).toBeNull();
    fireEvent.click(screen.getByTestId('agent-mode-tool-drawer-toggle'));
    expect(screen.getByTestId('agent-mode-tool-drawer-open')).toBeInTheDocument();
  });

  it('renders ThoughtStream as a floating panel with toggle', () => {
    render(<AgentMode projectId="p1" />);
    expect(screen.queryByTestId('thought-stream-floating')).toBeNull();
    fireEvent.click(screen.getByTestId('agent-mode-thought-toggle'));
    expect(screen.getByTestId('thought-stream-floating')).toBeInTheDocument();
  });

  it('clears agent nodes on projectId change', () => {
    const { rerender } = render(<AgentMode projectId="p1" />);
    useCanvasStore.getState().addAgentNodes({
      userGoal: 'x',
      plan: [],
      actions: [],
      observations: [],
      artifacts: {},
      pendingQuestion: null,
    });
    expect(useCanvasStore.getState().nodes.some((n) => n.type === 'agent_node')).toBe(true);
    rerender(<AgentMode projectId="p2" />);
    return waitFor(() => {
      expect(useCanvasStore.getState().nodes.some((n) => n.type === 'agent_node')).toBe(false);
    });
  });

  it('renders ErrorRecoveryCard when pendingErrorRecovery is set', async () => {
    const { useAgentStore } = await import('@/agent/use-agent-store');
    render(<AgentMode projectId="p1" />);
    // 初始不显示
    expect(screen.queryByTestId('error-recovery-card')).toBeNull();
    // 触发 tool_error
    useAgentStore.getState().applyEvent({
      type: 'tool_error',
      payload: {
        step_id: '1', tool: 'x', error: 'e', params: {},
        fallback_model_id: null, available_models: [],
      },
      timestamp: 1,
    });
    await waitFor(() => {
      expect(screen.getByTestId('error-recovery-card')).toBeInTheDocument();
    });
  });
});
