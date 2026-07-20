/**
 * App.tsx — 工作室入口（项目卡直达 + 画布工具栏入口）
 *
 * 首页不放工作室横幅。入口验证：
 *  1. 首页无 studio-banner / open-studio CTA；项目网格标题为"素材车间"（workshopTitle）
 *  2. 点项目卡的"去工作室成片"按钮 → StudioPanel 以该项目 id 打开
 *  3. 画布页工具栏"去工作室成片"按钮（canvas-open-studio）→ StudioPanel 以当前项目 id 打开
 *
 * StudioPanel 整体 mock，只断言收到的 props，不触发其内部 API 轮询。
 * i18n：不预设 localStorage 语言，默认 zh 文案。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor, act } from '@testing-library/react';
import App from '@/App';

// 用 vi.hoisted 让 mock 工厂能访问（vi.mock 会被 hoist 到文件顶部）
const { MOCK_PROJECT, mockStudioPanel } = vi.hoisted(() => ({
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
  mockStudioPanel: vi.fn(),
}));

// mock StudioPanel：记录 props，渲染占位节点，不走真实 API
vi.mock('@/components/StudioPanel', () => ({
  StudioPanel: (props: any) => {
    mockStudioPanel(props);
    return <div data-testid="studio-panel-mock" />;
  },
}));

// mock storageService / 持久化，预置一个项目
vi.mock('@/services/storageService', () => ({
  storageService: {
    loadTasks: () => [MOCK_PROJECT],
    loadFromBackup: () => [],
    saveTasks: () => undefined,
  },
}));

// mock api 客户端：bootstrap 返回一个项目，避免 happy-dom fetch localhost
vi.mock('@/services/apiClient', () => ({
  api: {
    listAgentTasks: vi.fn().mockResolvedValue([]),
    listAgentTools: vi.fn().mockResolvedValue([]),
    listProviders: vi.fn().mockResolvedValue([]),
    startAgent: vi.fn().mockResolvedValue({ id: 'mock-task' }),
    respondAgent: vi.fn().mockResolvedValue({ ok: true }),
    pauseAgent: vi.fn().mockResolvedValue({ ok: true }),
    resumeAgent: vi.fn().mockResolvedValue({ ok: true }),
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
  promptTemplates: {
    list: vi.fn().mockResolvedValue([]),
    get: vi.fn().mockResolvedValue(undefined),
    create: vi.fn().mockResolvedValue(undefined),
    update: vi.fn().mockResolvedValue(undefined),
    remove: vi.fn().mockResolvedValue({ ok: true }),
    batchRemove: vi.fn().mockResolvedValue({ removed: 0 }),
  },
}));

describe('<App /> — 工作室入口（项目卡 + 画布工具栏）', () => {
  beforeEach(() => {
    cleanup();
    localStorage.clear();
    mockStudioPanel.mockClear();
  });

  it('首页无工作室横幅（open-studio CTA 已撤），项目区正名"素材车间"', async () => {
    render(<App />);
    // 等项目从 bootstrap 加载、首页渲染完成
    await screen.findByText('Test Project');

    expect(screen.queryByTestId('studio-banner')).toBeNull();
    expect(screen.queryByTestId('open-studio')).toBeNull();
    // 项目区正名"素材车间"
    expect(screen.getByText('素材车间')).toBeInTheDocument();
  });

  it('点项目卡的"去工作室成片"按钮 → StudioPanel 以该项目 id 打开', async () => {
    render(<App />);
    await screen.findByText('Test Project');

    fireEvent.click(screen.getByTitle('去工作室成片'));

    await waitFor(() => {
      expect(screen.getByTestId('studio-panel-mock')).toBeInTheDocument();
    });
    expect(mockStudioPanel).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: 'proj-1' })
    );
    // 卡片直达带 stopPropagation：不会选中项目进入画布
    expect(screen.getByText('Test Project')).toBeInTheDocument();
  });

  it('画布工具栏"去工作室成片"按钮 → StudioPanel 以当前项目 id 打开', async () => {
    render(<App />);
    // 进入画布页：InfiniteCanvas 是 lazy 加载，等工具栏按钮出现
    const projectCard = await screen.findByText('Test Project');
    await act(async () => {
      projectCard.click();
    });
    const studioBtn = await screen.findByTestId('canvas-open-studio');
    expect(studioBtn).toHaveAttribute('title', '去工作室成片');

    fireEvent.click(studioBtn);

    await waitFor(() => {
      expect(screen.getByTestId('studio-panel-mock')).toBeInTheDocument();
    });
    expect(mockStudioPanel).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: 'proj-1' })
    );
  });
});
