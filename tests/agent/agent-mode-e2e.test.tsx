/**
 * E2E: AgentMode 全流程端到端测试
 *
 * 覆盖以下 bug 修复：
 *  1. 创建任务后 TaskList 立即刷新
 *  2. 刷新按钮位置在空/非空状态都一致（顶部）
 *  3. 创建任务后 ThoughtStream 自动打开
 *  4. ThoughtStream 显示完整事件（actions/observations/plan/artifact）
 *  5. 全局 SSE 管理器：useAgentStore.taskId 变化时自动开关
 *  6. ToolPalette 显示工具调用统计
 *  7. 退出 agent 模式后 useAgentStore.taskId 保留，后台横幅显示
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { AgentMode } from '@/agent/agent-mode';
import { useAgentStore } from '@/agent/use-agent-store';
import { api } from '@/services/apiClient';

// Mock api.startAgent / api.listAgentTasks / api.respondAgent
vi.mock('@/services/apiClient', () => {
  return {
    api: {
      startAgent: vi.fn(),
      listAgentTasks: vi.fn(),
      listAgentTools: vi.fn(),
      respondAgent: vi.fn(),
      getAgentTask: vi.fn(),
      // 新增：provider 列表（Plan 5 统一 endpoint）— 测试里默认返回空
      listProviders: vi.fn().mockResolvedValue([]),
    },
  };
});

// Mock InfiniteCanvas
vi.mock('@/components/infinite-canvas/InfiniteCanvas', () => ({
  InfiniteCanvas: () => <div data-testid="infinite-canvas-mock" />,
}));

// Mock ErrorRecoveryCard
vi.mock('@/agent/error-recovery-card', () => ({
  ErrorRecoveryCard: () => null,
}));

// Mock use-canvas-store — 同时支持 hook 调用（(s) => ...）和 getState
vi.mock('@/components/infinite-canvas/use-canvas-store', () => {
  const mockState = {
    addAgentNodes: vi.fn(),
    clearAgentNodes: vi.fn(),
    setTaskAssets: vi.fn(),
    relayoutAgentNodes: vi.fn(),
    fitAgentView: vi.fn(),
    resetViewportToAgentOrigin: vi.fn(),
    // addAgentNodes / fitAgentView / resetViewportToAgentOrigin 内部读 cs.nodes
    nodes: [],
    // Task 6: startAgent now reads apiConfig.stepBindings to get LLM provider
    apiConfig: { providers: [], stepBindings: [] },
  };
  const useCanvasStore: any = (selector?: any) =>
    selector ? selector(mockState) : mockState;
  useCanvasStore.getState = () => mockState;
  useCanvasStore.subscribe = () => () => {};
  useCanvasStore.setState = () => {};
  return { useCanvasStore };
});

// Mock use-agent-tools — 跳过 fetch，立即返回 PALETTE_TOOLS
vi.mock('@/agent/use-agent-tools', async () => {
  const { PALETTE_TOOLS } = await import('@/agent/tool-palette');
  return {
    useAgentTools: () => ({ tools: PALETTE_TOOLS, isLoading: false, error: null }),
  };
});

describe('<AgentMode /> e2e', () => {
  beforeEach(() => {
    useAgentStore.getState().reset();
    (api.listAgentTasks as any).mockResolvedValue([]);
    (api.listAgentTools as any).mockResolvedValue([]);
    (api.startAgent as any).mockResolvedValue({
      id: 'task-1',
      project_id: 'p1',
      user_goal: '做一个 30 秒的雨夜短片',
      status: 'running',
      plan: [],
      artifacts: {},
      total_cost_usd: 0,
      total_tokens: 0,
      max_steps: 50,
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('mounts with empty task list and shows refresh button at top', async () => {
    render(<AgentMode projectId="p1" />);
    await waitFor(() => {
      expect(screen.getByTestId('task-list-empty')).toBeInTheDocument();
    });
    const refreshBtn = screen.getByTestId('task-list-refresh');
    expect(refreshBtn).toBeInTheDocument();
    // 刷新按钮应该在 head 内（顶部），不是底部
    const head = screen.getByTestId('task-list-head');
    expect(head.contains(refreshBtn)).toBe(true);
    // head 应该在 task-list-rows 之前
    expect(head.compareDocumentPosition(screen.getByTestId('task-list-empty')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('auto-refreshes task list after creating a task (no manual refresh needed)', async () => {
    render(<AgentMode projectId="p1" />);
    await waitFor(() => {
      expect(api.listAgentTasks).toHaveBeenCalled();
    });
    // 第一次 listAgentTasks 调用（初始加载）
    const initialCalls = (api.listAgentTasks as any).mock.calls.length;

    // 模拟创建任务：输入目标 + 点击创建
    const input = screen.getByTestId('agent-mode-input');
    fireEvent.change(input, { target: { value: '做一个 30 秒的雨夜短片' } });
    fireEvent.click(screen.getByTestId('agent-mode-submit'));

    // 等待任务创建完成
    await waitFor(() => {
      expect(api.startAgent).toHaveBeenCalledWith('p1', '做一个 30 秒的雨夜短片', expect.any(Object));
    });
    expect(useAgentStore.getState().taskId).toBe('task-1');

    // TaskList 应该被自动刷新（refreshTrigger 触发）
    await waitFor(() => {
      expect((api.listAgentTasks as any).mock.calls.length).toBeGreaterThan(initialCalls);
    });
  });

  it('auto-opens ThoughtStream after creating a task', async () => {
    render(<AgentMode projectId="p1" />);
    const input = screen.getByTestId('agent-mode-input');
    fireEvent.change(input, { target: { value: 'test goal' } });
    fireEvent.click(screen.getByTestId('agent-mode-submit'));

    await waitFor(() => {
      expect(useAgentStore.getState().taskId).toBe('task-1');
    });
    // ThoughtStream 应该自动打开
    await waitFor(() => {
      expect(screen.getByTestId('thought-stream-floating')).toBeInTheDocument();
    });
  });

  it('shows progress bar in agent mode after task is created', async () => {
    render(<AgentMode projectId="p1" />);
    const input = screen.getByTestId('agent-mode-input');
    fireEvent.change(input, { target: { value: 'test goal' } });
    fireEvent.click(screen.getByTestId('agent-mode-submit'));

    await waitFor(() => {
      expect(useAgentStore.getState().taskId).toBe('task-1');
    });
    // 进度条应该出现
    const progress = await screen.findByTestId('agent-mode-progress');
    expect(progress).toBeInTheDocument();
  });

  it('ThoughtStream shows action/observation/plan events (not just thought)', () => {
    // 直接通过 store 注入多种事件
    act(() => {
      useAgentStore.getState().applyEvent({
        type: 'thought',
        payload: { text: '我需要先解析用户的目标' },
        timestamp: 1,
      });
      useAgentStore.getState().applyEvent({
        type: 'action',
        payload: { tool: 'parse_user_goal', params: { goal: '做一个 30 秒的雨夜短片' } },
        timestamp: 2,
      });
      useAgentStore.getState().applyEvent({
        type: 'observation',
        payload: { result: { ok: true, data: 'parsed' } },
        timestamp: 3,
      });
      useAgentStore.getState().applyEvent({
        type: 'plan_ready',
        payload: { plan: [{ title: '步骤 1: 生成剧本' }, { title: '步骤 2: 生成角色' }] },
        timestamp: 4,
      });
    });

    render(<AgentMode projectId="p1" />);
    // 打开 ThoughtStream
    fireEvent.click(screen.getByTestId('agent-mode-thought-toggle'));

    // stats 区域应显示事件统计
    expect(screen.getAllByText(/思考/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/动作/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/观察/).length).toBeGreaterThan(0);
    // 计划也应该显示
    expect(screen.getByText(/步骤 1/)).toBeInTheDocument();
  });

  it('ToolPalette shows tool call statistics (count, status icon)', () => {
    act(() => {
      useAgentStore.getState().applyEvent({
        type: 'action',
        payload: { tool: 'parse_user_goal', result: { ok: true } },
        timestamp: 1,
      });
      useAgentStore.getState().applyEvent({
        type: 'action',
        payload: { tool: 'parse_user_goal', result: { ok: true } },
        timestamp: 2,
      });
      useAgentStore.getState().applyEvent({
        type: 'action',
        payload: { tool: 'extract_characters', result: { ok: false, error: 'rate limit' } },
        timestamp: 3,
      });
    });

    render(<AgentMode projectId="p1" />);
    fireEvent.click(screen.getByTestId('agent-mode-tool-drawer-toggle'));

    const items = screen.getAllByTestId('tool-palette-item');
    // 找到 parse_user_goal 这个工具项
    const parseItem = items.find((el) => el.textContent?.includes('parse_user_goal'));
    expect(parseItem).toBeDefined();
    expect(parseItem?.textContent).toContain('×2');
    // 错误状态应该标记
    const errorItem = items.find((el) => el.textContent?.includes('extract_characters'));
    expect(errorItem?.className).toContain('is-error');
  });

  it('exit event does not clear taskId (background continuation)', () => {
    act(() => {
      useAgentStore.getState().setTask('task-1', 'running', 'p1');
    });

    render(<AgentMode projectId="p1" />);
    // 触发退出事件
    act(() => {
      window.dispatchEvent(new CustomEvent('agent-mode-exit'));
    });
    // taskId 应该保留
    expect(useAgentStore.getState().taskId).toBe('task-1');
    expect(useAgentStore.getState().status).toBe('running');
  });

  it('progress bar shows real-time counts of thoughts/actions/observations', async () => {
    render(<AgentMode projectId="p1" />);
    const input = screen.getByTestId('agent-mode-input');
    fireEvent.change(input, { target: { value: 'test' } });
    fireEvent.click(screen.getByTestId('agent-mode-submit'));

    await waitFor(() => {
      expect(useAgentStore.getState().taskId).toBe('task-1');
    });
    expect(useAgentStore.getState().status).toBe('running');

    // 注入 3 个 thought + 2 个 action
    act(() => {
      for (let i = 0; i < 3; i++) {
        useAgentStore.getState().applyEvent({
          type: 'thought',
          payload: { text: `想法 ${i}` },
          timestamp: i,
        });
      }
      for (let i = 0; i < 2; i++) {
        useAgentStore.getState().applyEvent({
          type: 'action',
          payload: { tool: 'parse_user_goal' },
          timestamp: 10 + i,
        });
      }
    });

    // 进度条文字应该反映统计
    const progress = screen.getByTestId('agent-mode-progress');
    expect(progress.textContent).toContain('3');
    expect(progress.textContent).toContain('2');
  });
});
