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

const MOCK_PROJECT = {
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
};

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
    startAgent: vi.fn().mockResolvedValue({ id: 'mock-task' }),
    respondAgent: vi.fn().mockResolvedValue({ ok: true }),
    pauseAgent: vi.fn().mockResolvedValue({ ok: true }),
    resumeAgent: vi.fn().mockResolvedValue({ ok: true }),
  },
}));

async function openCanvas() {
  // 找到项目卡片并点击
  const projectCard = screen.getByText('Test Project');
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
