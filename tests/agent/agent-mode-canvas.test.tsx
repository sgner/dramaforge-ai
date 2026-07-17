/**
 * TDD: AgentMode × InfiniteCanvas — 集成测试。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
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
    useCanvasStore.setState({ nodes: [], connections: [], nodeOverrides: {}, theme: 'light' });
    vi.restoreAllMocks();
    vi.spyOn(api, 'listAgentTasks').mockResolvedValue([]);
    vi.spyOn(api, 'listAgentSteps').mockResolvedValue([]);
  });

  afterEach(() => {
    useCanvasStore.setState({ theme: 'light' });
  });

  it('renders Agent overlay without creating a nested InfiniteCanvas', () => {
    render(<AgentMode projectId="p1" />);
    expect(screen.queryByTestId('infinite-canvas-stub')).toBeNull();
    expect(screen.getByTestId('agent-mode-overlay')).toBeInTheDocument();
    expect(screen.queryByTestId('agent-mode-canvas-placeholder')).toBeNull();
  });

  it('propagates the canvas dark theme to the Agent overlay chrome', () => {
    useCanvasStore.setState({ theme: 'dark' });
    render(<AgentMode projectId="p1" />);

    expect(screen.getByTestId('agent-mode')).toHaveClass('theme-dark');
  });

  it('can collapse the task drawer without affecting the canvas overlay', () => {
    render(<AgentMode projectId="p1" />);
    const aside = screen.getByTestId('agent-mode-left-aside');
    expect(aside).not.toHaveClass('closed');
    fireEvent.click(screen.getByTestId('agent-mode-task-drawer-toggle'));
    expect(aside).toHaveClass('closed');
    expect(screen.getByTestId('agent-mode-overlay')).toBeInTheDocument();
  });

  it('uses the shared canvas API toolbar and renders the draggable pet instead of Agent API controls', async () => {
    render(<AgentMode projectId="p1" />);
    expect(screen.queryByTestId('agent-mode-api-summary')).toBeNull();
    expect(screen.queryByTestId('agent-mode-api-settings')).toBeNull();
    expect(await screen.findByTestId('agent-pet')).toBeInTheDocument();
  });

  it('projects agent artifacts as image nodes on the canvas (reuses existing image type)', () => {
    render(<AgentMode projectId="p1" />);
    useAgentStore.setState({
      taskId: 't-1',
      status: 'running',
      thoughts: [],
      actions: [],
      observations: [],
      plan: [],
      artifacts: {
        character: [
          { id: 'c1', kind: 'image', name: 'A', url: 'u1' },
          { id: 'c2', kind: 'image', name: 'B', url: 'u2' },
        ],
        scene: [{ id: 's1', kind: 'image', name: 'Rain', url: 'u3' }],
      },
      pendingQuestion: null,
    });
    // 3 个资产 → 3 个 image 节点（不是自定义 agent_node）
    const imgNodes = useCanvasStore.getState().nodes.filter((n) => n.type === 'image');
    expect(imgNodes.length).toBe(3);
    // 没有自定义 timeline 节点
    expect(useCanvasStore.getState().nodes.filter((n) => n.type === 'agent_node')).toHaveLength(0);
    expect(useCanvasStore.getState().nodes.every((node) => node.type === 'image')).toBe(true);
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
      userGoal: '',
      plan: [],
      actions: [],
      observations: [],
      artifacts: { character: [{ id: 'c1', url: 'u' }] } as any,
      pendingQuestion: null,
    });
    // addAgentNodes 现在创建 'image' 和 'prompt'（按 id 前缀 'agent-' 过滤）
    expect(
      useCanvasStore.getState().nodes.some((n) => n.id.startsWith('agent-')),
    ).toBe(true);
    rerender(<AgentMode projectId="p2" />);
    return waitFor(() => {
      expect(
        useCanvasStore.getState().nodes.some((n) => n.id.startsWith('agent-')),
      ).toBe(false);
    });
  });

  it('selecting a task hydrates the store from the persisted snapshot', async () => {
    // 1. 先填一些 task-A 的事件到 store
    useAgentStore.getState().setTask('t-A', 'running');
    useAgentStore.getState().applyEvent({ type: 'thought', payload: { text: 'A 的想法' }, timestamp: 1 });
    useAgentStore.getState().applyEvent({ type: 'action', payload: { tool: 'a_tool' }, timestamp: 2 });

    // 2. mock 列表 + snapshot
    vi.spyOn(api, 'listAgentTasks').mockResolvedValue([
      { id: 't-B', user_goal: 'B 的目标', status: 'paused' } as any,
    ]);
    vi.spyOn(api, 'getAgentTask').mockResolvedValue({
      id: 't-B',
      user_goal: 'B 的目标',
      status: 'paused',
      plan: [{ tool: 'b1' }, { tool: 'b2' }],
      artifacts: { character: [{ id: 'c1', kind: 'image', url: 'u' }] },
      pending_response: { question: 'B 在问什么？', options: ['a', 'b'] },
      total_cost_usd: 0.5,
      total_tokens: 123,
    } as any);

    render(<AgentMode projectId="p1" />);

    // 3. 等任务列表出现，点击 t-B
    const row = await waitFor(() => screen.getByTestId('task-list-row-t-B'));
    fireEvent.click(row);

    // 4. 等 hydrate 跑完
    await waitFor(() => {
      const s = useAgentStore.getState();
      expect(s.taskId).toBe('t-B');
      // 旧 task A 的 events 必须被清掉
      expect(s.thoughts).toEqual([]);
      expect(s.actions).toEqual([]);
      // snapshot 里的 plan/artifacts/pendingQuestion 应当被恢复
      expect(s.plan).toEqual([{ tool: 'b1' }, { tool: 'b2' }]);
      expect((s.artifacts as any).character).toHaveLength(1);
      expect(s.pendingQuestion?.question).toBe('B 在问什么？');
      expect(s.totalCostUsd).toBe(0.5);
      expect(s.totalTokens).toBe(123);
    });
  });

  it('selecting a task restores thoughts/actions/observations from persisted steps (checkpoint)', async () => {
    // 检查点模式：从 DB AgentStep 表恢复执行历史，不依赖 SSE 内存重放
    vi.spyOn(api, 'listAgentTasks').mockResolvedValue([
      { id: 't-D', user_goal: 'D 的目标', status: 'paused' } as any,
    ]);
    vi.spyOn(api, 'getAgentTask').mockResolvedValue({
      id: 't-D',
      user_goal: 'D 的目标',
      status: 'paused',
      plan: [],
      artifacts: {},
      pending_response: { question: 'D 在等回复', options: [] },
    } as any);
    vi.spyOn(api, 'listAgentSteps').mockResolvedValue([
      {
        id: 's1',
        task_id: 't-D',
        step_number: 1,
        thought: '第一步想法',
        action: { tool: 'write_script', params: { topic: 'test' } },
        observation: { success: true, result: { text: '剧本完成' } },
        status: 'success',
        cost_usd: 0.01,
        tokens: 50,
      },
      {
        id: 's2',
        task_id: 't-D',
        step_number: 2,
        thought: '第二步想法',
        action: { tool: 'ask_user', params: {} },
        observation: {},
        status: 'pending',
        cost_usd: 0,
        tokens: 0,
      },
    ] as any);

    render(<AgentMode projectId="p1" />);
    const row = await waitFor(() => screen.getByTestId('task-list-row-t-D'));
    fireEvent.click(row);

    await waitFor(() => {
      const s = useAgentStore.getState();
      expect(s.taskId).toBe('t-D');
      // 检查点：steps 历史被恢复到 thoughts/actions/observations
      expect(s.thoughts).toHaveLength(2);
      expect(s.thoughts[0].payload.text).toBe('第一步想法');
      expect(s.thoughts[1].payload.text).toBe('第二步想法');
      expect(s.actions).toHaveLength(2);
      expect(s.actions[0].payload.tool).toBe('write_script');
      expect(s.actions[1].payload.tool).toBe('ask_user');
      expect(s.observations).toHaveLength(1);
      expect(s.observations[0].payload.success).toBe(true);
      // pending_question 也应从 snapshot 恢复
      expect(s.pendingQuestion?.question).toBe('D 在等回复');
    });
  });

  it('selecting a task fetches snapshot and falls back gracefully if API fails', async () => {
    vi.spyOn(api, 'listAgentTasks').mockResolvedValue([
      { id: 't-C', user_goal: 'C', status: 'running' } as any,
    ]);
    vi.spyOn(api, 'getAgentTask').mockRejectedValue(new Error('network'));

    render(<AgentMode projectId="p1" />);
    const row = await waitFor(() => screen.getByTestId('task-list-row-t-C'));
    fireEvent.click(row);

    // 即使 hydrate 失败，setTask 仍应把 taskId 切到 t-C
    await waitFor(() => {
      expect(useAgentStore.getState().taskId).toBe('t-C');
    });
    // store 仍应是 INITIAL 状态（除了 taskId）
    expect(useAgentStore.getState().plan).toEqual([]);
    expect(useAgentStore.getState().artifacts).toEqual({});
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

  /* removed: the status capsule and inline LLM badge are no longer rendered */
  it.skip('shows LLM mode badge with stub warning when task_started reports stub mode', async () => {
    render(<AgentMode projectId="p1" />);
    useAgentStore.setState({ taskId: 't-1', status: 'running' });
    useAgentStore.getState().applyEvent({
      type: 'task_started',
      payload: { task_id: 't-1', llm_mode: 'stub', llm_fallback_reason: 'no LLM configured' },
      timestamp: 1,
    });
    await waitFor(() => {
      const progress = screen.getByTestId('agent-mode-progress');
      expect(progress).toBeInTheDocument();
      const badge = progress.querySelector('.agent-llm-badge.stub');
      expect(badge).not.toBeNull();
      expect((badge as HTMLElement).title).toMatch(/DevScriptedLLM/);
    });
  });

  it.skip('shows LLM mode badge in real mode when LLM is configured', async () => {
    render(<AgentMode projectId="p1" />);
    useAgentStore.setState({ taskId: 't-2', status: 'running' });
    useAgentStore.getState().applyEvent({
      type: 'task_started',
      payload: { task_id: 't-2', llm_mode: 'real', llm_fallback_reason: null },
      timestamp: 1,
    });
    await waitFor(() => {
      const progress = screen.getByTestId('agent-mode-progress');
      const badge = progress.querySelector('.agent-llm-badge.real');
      expect(badge).not.toBeNull();
      expect((badge as HTMLElement).title).toMatch(/真实 LLM/);
    });
  });

  /* it('relayout button clears drag overrides and re-snaps nodes to grid', () => {
    useCanvasStore.setState({ projectId: 'p1' });
    useCanvasStore.getState().addAgentNodes({
      userGoal: '',
      plan: [],
      actions: [],
      observations: [],
      artifacts: {
        character: [{ id: 'c1', url: 'u' }] as any,
        scene: [{ id: 's1', url: 'u' }] as any,
      },
      pendingQuestion: null,
    });
    // 模拟用户拖动 character header 产生 override
    const characterHeaderId = 'agent-cat-character-p1';
    useCanvasStore.setState({
      nodeOverrides: { [characterHeaderId]: { dx: 999, dy: 999 } },
    });
    expect(useCanvasStore.getState().nodeOverrides[characterHeaderId]).toEqual({ dx: 999, dy: 999 });
    // 触发重排
    useCanvasStore.getState().relayoutAgentNodes();
    // override 应清空，character header 回到默认 (0, 0)
    const characterHeader = useCanvasStore.getState().nodes.find(
      (n) => n.id === characterHeaderId,
    );
    expect(characterHeader).toBeDefined();
    expect(characterHeader!.x).toBe(0);
    expect(characterHeader!.y).toBe(0);
    expect(useCanvasStore.getState().nodeOverrides[characterHeaderId]).toBeUndefined();
  }); */
});
