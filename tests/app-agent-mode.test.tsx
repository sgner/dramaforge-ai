/**
 * TDD: App.tsx — Agent Mode 入口现在在 InfiniteCanvas 工具栏内。
 * - 验证 CanvasToolbar 渲染时显示 "Agent" 入口按钮
 * - 验证点击后切换到 AgentMode 视图
 * - 验证 AgentMode 内 "退出" 按钮可返回
 * - 验证 URL ?agent=1 时自动进入
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, act, waitFor } from '@testing-library/react';
import App from '@/App';
import { api } from '@/services/apiClient';
import { useCanvasStore } from '@/components/infinite-canvas/use-canvas-store';

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
    // 新版首屏：bootstrap 合并 tasks + providers + modelBindings
    bootstrap: vi.fn().mockResolvedValue({
      tasks: [
        {
          id: 'proj-1',
          name: 'Test Project',
          deleted: false,
          data: { ...MOCK_PROJECT },
          created_at: '2025-01-01T00:00:00',
          updated_at: '2025-01-01T00:00:00',
        },
      ],
      providers: [],
      modelBindings: null,
    }),
    upsertDramaTask: vi.fn().mockResolvedValue({ ok: true }),
    deleteDramaTask: vi.fn().mockResolvedValue({ ok: true }),
    getUserPreference: vi.fn().mockResolvedValue({ value: null }),
    setUserPreference: vi.fn().mockResolvedValue({ value: null }),
  },
  // PromptLibraryPanel 内部会调用 promptTemplates.list() 拉取模板列表，
  // 这里给出空数组 mock，避免 unhandled rejection。
  promptTemplates: {
    list: vi.fn().mockResolvedValue([]),
    get: vi.fn().mockResolvedValue(undefined),
    create: vi.fn().mockResolvedValue(undefined),
    update: vi.fn().mockResolvedValue(undefined),
    remove: vi.fn().mockResolvedValue({ ok: true }),
    batchRemove: vi.fn().mockResolvedValue({ removed: 0 }),
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
    expect(screen.queryByTestId('exit-agent-mode')).toBeNull();
    expect(document.querySelectorAll('.canvas-root')).toHaveLength(1);
    expect(screen.getByTestId('enter-agent-mode')).toHaveClass('active');
  });

  it('点击 AgentMode 内 "退出" 按钮后返回画布', async () => {
    render(<App />);
    await openCanvas();
    await act(async () => {
      fireEvent.click(screen.getByTestId('enter-agent-mode'));
    });
    expect(screen.getByTestId('agent-mode')).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByTestId('enter-agent-mode'));
    });
    expect(screen.queryByTestId('agent-mode')).toBeNull();
    // 重新出现 "Agent" 入口按钮（画布已恢复）
    expect(screen.getByTestId('enter-agent-mode')).toBeInTheDocument();
    expect(document.querySelectorAll('.canvas-root')).toHaveLength(1);
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

  it('loads canvas API settings into the store used by AgentMode', async () => {
    vi.mocked(api.bootstrap).mockResolvedValue({
      tasks: [{
        id: 'proj-1',
        name: 'Test Project',
        deleted: false,
        data: { ...MOCK_PROJECT },
        created_at: '2025-01-01T00:00:00',
        updated_at: '2025-01-01T00:00:00',
      }],
      providers: [{
        provider_id: 'custom-api',
        name: 'Custom API',
        base_url: 'https://example.test/v1',
        protocol: 'openai',
        enabled: true,
        default_model: 'deepseek-v4-flash',
        chat_models: ['deepseek-v4-flash'],
        image_models: [],
        video_models: [],
      }],
      modelBindings: [{ kind: 'llm', providerId: 'custom-api', modelId: 'deepseek-v4-flash' }],
    } as any);

    render(<App />);
    await openCanvas();
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    expect(useCanvasStore.getState().apiConfig.modelBindings).toEqual([
      { kind: 'llm', providerId: 'custom-api', modelId: 'deepseek-v4-flash' },
      { kind: 'image', providerId: '', modelId: '' },
      { kind: 'video', providerId: '', modelId: '' },
    ]);
  });

  it('does not treat the masked provider key returned by the backend as an editable key', async () => {
    vi.mocked(api.bootstrap).mockResolvedValue({
      tasks: [{
        id: 'proj-1',
        name: 'Test Project',
        deleted: false,
        data: { ...MOCK_PROJECT },
        created_at: '2025-01-01T00:00:00',
        updated_at: '2025-01-01T00:00:00',
      }],
      providers: [{
        provider_id: 'custom-api',
        name: 'Custom API',
        base_url: 'https://example.test/v1',
        protocol: 'openai',
        enabled: true,
        api_key: 'sk-F***k1hm',
        has_key: true,
        key_preview: 'sk-F***k1hm',
        chat_models: ['chat-1'],
        image_models: [],
        video_models: [],
      }],
      modelBindings: [],
    } as any);

    render(<App />);
    await openCanvas();
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    const loaded = useCanvasStore.getState().apiConfig.providers.find((p) => p.id === 'custom-api');
    expect(loaded?.apiKey).toBe('');
    expect(loaded?.hasKey).toBe(true);
    expect(loaded?.keyPreview).toBe('sk-F***k1hm');
  });

  it('restores capability bindings from local backup when the provider API is unavailable', async () => {
    // bootstrap 整体失败 → 走 localStorage 兜底逻辑（providers 默认 + 本地 bindings）
    vi.mocked(api.bootstrap).mockRejectedValue(new Error('backend unavailable'));
    localStorage.setItem('dramaforge_model_bindings', JSON.stringify([
      { kind: 'llm', providerId: 'custom-api', modelId: 'chat-1' },
    ]));

    render(<App />);
    await openCanvas();
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });

    expect(useCanvasStore.getState().apiConfig.modelBindings).toEqual([
      { kind: 'llm', providerId: 'custom-api', modelId: 'chat-1' },
      { kind: 'image', providerId: '', modelId: '' },
      { kind: 'video', providerId: '', modelId: '' },
    ]);
  });

  it('shows prompt library panel when toggle button clicked', async () => {
    // ... existing setup that opens canvas ...
    // Reset mocks that may have been mutated by earlier tests (e.g. bootstrap
    // rejected in the "backend unavailable" test) so the App loads normally.
    vi.mocked(api.bootstrap).mockResolvedValue({
      tasks: [{
        id: 'proj-1',
        name: 'Test Project',
        deleted: false,
        data: { ...MOCK_PROJECT },
        created_at: '2025-01-01T00:00:00',
        updated_at: '2025-01-01T00:00:00',
      }],
      providers: [],
      modelBindings: null,
    });
    // Reset URL: an earlier test pushes ?agent=1 which would make the App boot
    // in agent mode, turning the enter-agent-mode click into an exit toggle.
    window.history.pushState({}, '', '/');
    render(<App />);
    await openCanvas();
    await act(async () => {
      fireEvent.click(screen.getByTestId('enter-agent-mode'));
    });
    // Find the bookmark/book icon button in the topbar
    const panelBtn = screen.getByTestId('prompt-library-toggle');
    fireEvent.click(panelBtn);
    await waitFor(() => {
      expect(screen.getByTestId('prompt-library-panel')).toBeInTheDocument();
    });
  });
});
