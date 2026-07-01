/**
 * TDD: App.tsx — Agent Mode 切换功能。
 * - 验证 "Agent Mode" 按钮在 header 中存在
 * - 验证点击后切换到 AgentMode 视图
 * - 验证 "退出 Agent Mode" 按钮可返回
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';
import App from '@/App';

// mock 掉 storageService / 持久化，避免 localStorage 副作用
vi.mock('@/services/storageService', () => ({
  storageService: {
    loadTasks: () => [],
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

describe('<App /> — Agent Mode 入口', () => {
  beforeEach(() => {
    cleanup();
    localStorage.clear();
  });

  it('在 header 中显示 "Agent Mode" 按钮', () => {
    render(<App />);
    const btn = screen.getByTestId('enter-agent-mode');
    expect(btn).toBeInTheDocument();
    expect(btn.textContent).toContain('Agent Mode');
  });

  it('点击 Agent Mode 按钮后渲染 AgentMode 画布（data-testid="agent-mode"）', async () => {
    render(<App />);
    // 初始不应有 agent-mode
    expect(screen.queryByTestId('agent-mode')).toBeNull();
    // 点击
    await act(async () => {
      fireEvent.click(screen.getByTestId('enter-agent-mode'));
    });
    // AgentMode 渲染
    expect(screen.getByTestId('agent-mode')).toBeInTheDocument();
    // 退出按钮出现
    expect(screen.getByTestId('exit-agent-mode')).toBeInTheDocument();
  });

  it('点击 "退出 Agent Mode" 后返回项目列表', async () => {
    render(<App />);
    await act(async () => {
      fireEvent.click(screen.getByTestId('enter-agent-mode'));
    });
    expect(screen.getByTestId('agent-mode')).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByTestId('exit-agent-mode'));
    });
    expect(screen.queryByTestId('agent-mode')).toBeNull();
    // 重新出现 "Agent Mode" 入口按钮
    expect(screen.getByTestId('enter-agent-mode')).toBeInTheDocument();
  });

  it('URL ?agent=1 时自动进入 Agent Mode（自动选/建一个任务）', async () => {
    // 修改 URL（happy-dom 支持）
    window.history.pushState({}, '', '?agent=1');
    render(<App />);
    // 等 useEffect 跑完
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.getByTestId('agent-mode')).toBeInTheDocument();
  });
});
