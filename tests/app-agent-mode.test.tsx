/**
 * TDD: App.tsx — Agent Mode 入口现在在 InfiniteCanvas 工具栏内。
 * - 验证 CanvasToolbar 渲染时显示 "Agent" 入口按钮
 * - 验证点击后切换到 AgentMode 视图
 * - 验证 AgentMode 内 "退出" 按钮可返回
 * - 验证 URL ?agent=1 时自动进入
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';
import App from '@/App';

// 用 vi.hoisted 让 mock 工厂能访问 MOCK_PROJECT（vi.mock 会被 hoist 到文件顶部）
const { MOCK_PROJECT } = vi.hoisted(() => ({
  MOCK_PROJECT: {
    id: 'proj-1',
    name: 'Test Project',
    style: 'cinematic-realistic',
    language: 'zh',
    mode: 'auto',
    sourceType: 'idea',
    createdAt: Date.now(),
    status: 'idle',
    stepStatus: 'idle',
    progress: 0,
    rawNovelText: '',
    characters: [],
    bigShots: [],
  },
}));

// mock 掉 storageService / 持久化，预置一个项目让 InfiniteCanvas 可以打开
vi.mock('@/services/storageService', () => ({
  storageService: {
    loadTasks: () => [MOCK_PROJECT],
    loadFromBackup: () => [],
    saveTasks: () => undefined,
  },
}));

// mock 掉 api 客户端：避免 happy-dom 试图 fetch localhost:3000 产生 unhandled errors
vi.mock('@/services/apiClient', () => ({
  api: {
    listAgentTasks: vi.fn().mockResolvedValue([]),
    listAgentTools: vi.fn().mockResolvedValue([]),
    listProviders: vi.fn().mockResolvedValue([]),
    startAgent: vi.fn().mockResolvedValue({ id: 'mock-task' }),
    respondAgent: vi.fn().mockResolvedValue({ ok: true }),
    pauseAgent: vi.fn().mockResolvedValue({ ok: true }),
    resumeAgent: vi.fn().mockResolvedValue({ ok: true }),
    // 新版 DramaTask 走 api（替代 storageService.loadTasks）
    listDramaTasks: vi.fn().mockResolvedValue([
      {
        id: 'proj-1',
        name: 'Test Project',
        deleted: false,
        data: { ...MOCK_PROJECT },
        created_at: '2025-01-01T00:00:00',
        updated_at: '2025-01-01T00:00:00',
      },
    ]),
    upsertDramaTask: vi.fn().mockResolvedValue({ ok: true }),
    deleteDramaTask: vi.fn().mockResolvedValue({ ok: true }),
    getUserPreference: vi.fn().mockResolvedValue({ value: null }),
    setUserPreference: vi.fn().mockResolvedValue({ value: null }),
  },
}));

async function openCanvas() {
  // 等待后端异步加载完成 + 卡片渲染
  const projectCard = await screen.findByText('Test Project');
  await act(async () => {
    projectCard.click();
  });
}

describe('<App /> — Agent Mode 入口（位于 Canvas 工具栏）', () => {
  beforeEach(() => {
    cleanup();
    localStorage.clear();
  });

  it('在项目列表页不应有 "Agent" 按钮（不在首页 header）', () => {
    render(<App />);
    expect(screen.queryByTestId('enter-agent-mode')).toBeNull();
  });

  it('打开画布后，Canvas 工具栏显示 "Agent" 入口按钮', async () => {
    render(<App />);
    await openCanvas();
    const btn = screen.getByTestId('enter-agent-mode');
    expect(btn).toBeInTheDocument();
    expect(btn.textContent).toContain('Agent');
  });

  it('点击 Agent 按钮后渲染 AgentMode 画布（data-testid="agent-mode"）', async () => {
    render(<App />);
    await openCanvas();
    expect(screen.queryByTestId('agent-mode')).toBeNull();
    await act(async () => {
      fireEvent.click(screen.getByTestId('enter-agent-mode'));
    });
    expect(screen.getByTestId('agent-mode')).toBeInTheDocument();
    expect(screen.getByTestId('exit-agent-mode')).toBeInTheDocument();
  });

  it('点击 AgentMode 内 "退出" 按钮后返回画布', async () => {
    render(<App />);
    await openCanvas();
    await act(async () => {
      fireEvent.click(screen.getByTestId('enter-agent-mode'));
    });
    expect(screen.getByTestId('agent-mode')).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByTestId('exit-agent-mode'));
    });
    expect(screen.queryByTestId('agent-mode')).toBeNull();
    // 重新出现 "Agent" 入口按钮（画布已恢复）
    expect(screen.getByTestId('enter-agent-mode')).toBeInTheDocument();
  });

  it('URL ?agent=1 时自动进入 Agent Mode（自动选/建一个任务）', async () => {
    window.history.pushState({}, '', '?agent=1');
    render(<App />);
    // 等待 useEffect 跑完 + storageService 加载 + state 流转
    await act(async () => {
      await new Promise((r) => setTimeout(r, 200));
    });
    expect(screen.getByTestId('agent-mode')).toBeInTheDocument();
  });
});
