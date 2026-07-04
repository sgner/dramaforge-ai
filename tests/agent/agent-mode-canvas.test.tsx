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

  it('shows LLM mode banner with stub warning when task_started reports stub mode', async () => {
    render(<AgentMode projectId="p1" />);
    useAgentStore.setState({ taskId: 't-1', status: 'running' });
    useAgentStore.getState().applyEvent({
      type: 'task_started',
      payload: { task_id: 't-1', llm_mode: 'stub', llm_fallback_reason: 'no LLM configured' },
      timestamp: 1,
    });
    await waitFor(() => {
      const banner = screen.getByTestId('agent-llm-mode-banner');
      expect(banner).toBeInTheDocument();
      expect(banner.className).toContain('stub');
      expect(banner.textContent || '').toMatch(/DevScriptedLLM/);
    });
  });

  it('shows LLM mode banner in real mode when LLM is configured', async () => {
    render(<AgentMode projectId="p1" />);
    useAgentStore.setState({ taskId: 't-2', status: 'running' });
    useAgentStore.getState().applyEvent({
      type: 'task_started',
      payload: { task_id: 't-2', llm_mode: 'real', llm_fallback_reason: null },
      timestamp: 1,
    });
    await waitFor(() => {
      const banner = screen.getByTestId('agent-llm-mode-banner');
      expect(banner.className).toContain('real');
      expect(banner.textContent || '').toMatch(/真实 LLM/);
    });
  });

  it('relayout button clears drag overrides and re-snaps nodes to grid', () => {
    useCanvasStore.setState({ projectId: 'p1' });
    useCanvasStore.getState().addAgentNodes({
      userGoal: '短片',
      plan: [{ tool: 'a' }],
      actions: [
        { type: 'action', payload: { tool: 't1' }, timestamp: 1 } as any,
        { type: 'action', payload: { tool: 't2' }, timestamp: 2 } as any,
      ],
      observations: [],
      artifacts: {},
      pendingQuestion: null,
    });
    // 模拟用户拖动 goal 节点产生 override
    useCanvasStore.setState({
      nodeOverrides: { 'agent-goal-p1': { dx: 999, dy: 999 } },
    });
    // 验证 override 存在
    expect(useCanvasStore.getState().nodeOverrides['agent-goal-p1']).toEqual({ dx: 999, dy: 999 });
    // 触发重排
    useCanvasStore.getState().relayoutAgentNodes();
    // override 应清空，goal 节点回到默认 colX=0
    const goal = useCanvasStore.getState().nodes.find((n) => n._agentTaskType === 'goal');
    expect(goal).toBeDefined();
    expect(goal!.x).toBe(0);
    expect(goal!.y).toBe(0);
    expect(useCanvasStore.getState().nodeOverrides['agent-goal-p1']).toBeUndefined();
  });
});
