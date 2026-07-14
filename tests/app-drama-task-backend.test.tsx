/**
 * TDD: App.tsx — DramaTask 数据迁移到后端 (/api/drama-tasks)
 *
 * 关键设计：
 *  - 挂载时从后端 api.listDramaTasks 拉项目列表
 *  - tasks 变化时 debounce 500ms 后调 api.upsertDramaTask 同步
 *  - 删除 task 时调 api.deleteDramaTask
 *  - 老的 localStorage dramaforge_tasks 作为一次性迁移：后端为空时上传
 *  - 后端不可用时回落到 localStorage（兜底，不丢数据）
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { render, screen, waitFor, act, cleanup } from '@testing-library/react';
import App from '@/App';
import { api } from '@/services/apiClient';

// mock 掉 storageService / 持久化（兜底用，新版主存是 api）
const mockLoadTasks = vi.fn(() => []);
const mockLoadFromBackup = vi.fn(() => []);
const mockSaveTasks = vi.fn();
vi.mock('@/services/storageService', () => ({
  storageService: {
    loadTasks: () => mockLoadTasks(),
    loadFromBackup: () => mockLoadFromBackup(),
    saveTasks: (tasks: any) => mockSaveTasks(tasks),
    exportToFile: vi.fn(),
    importFromFile: vi.fn(),
  },
}));

// 默认空 backend，让 App 走"无项目"路径
const mockListDramaTasks = vi.fn().mockResolvedValue([]);
const mockUpsertDramaTask = vi.fn().mockResolvedValue({ ok: true });
const mockDeleteDramaTask = vi.fn().mockResolvedValue({ ok: true });

vi.mock('@/services/apiClient', () => ({
  api: {
    listAgentTasks: vi.fn().mockResolvedValue([]),
    listAgentTools: vi.fn().mockResolvedValue([]),
    listProviders: vi.fn().mockResolvedValue([]),
    startAgent: vi.fn().mockResolvedValue({ id: 'mock-task' }),
    respondAgent: vi.fn().mockResolvedValue({ ok: true }),
    pauseAgent: vi.fn().mockResolvedValue({ ok: true }),
    resumeAgent: vi.fn().mockResolvedValue({ ok: true }),
    listDramaTasks: (...args: any[]) => mockListDramaTasks(...args),
    upsertDramaTask: (...args: any[]) => mockUpsertDramaTask(...args),
    deleteDramaTask: (...args: any[]) => mockDeleteDramaTask(...args),
    getUserPreference: vi.fn().mockResolvedValue({ value: null }),
    setUserPreference: vi.fn().mockResolvedValue({ value: null }),
  },
}));

describe('<App /> — DramaTask 持久化到后端 (/api/drama-tasks)', () => {
  beforeEach(() => {
    cleanup();
    localStorage.clear();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    mockListDramaTasks.mockReset();
    mockUpsertDramaTask.mockReset();
    mockDeleteDramaTask.mockReset();
    mockLoadTasks.mockReset().mockReturnValue([]);
    mockLoadFromBackup.mockReset().mockReturnValue([]);
    mockSaveTasks.mockReset();
    mockListDramaTasks.mockResolvedValue([]);
    mockUpsertDramaTask.mockResolvedValue({ ok: true } as any);
    mockDeleteDramaTask.mockResolvedValue({ ok: true } as any);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('挂载时调 api.listDramaTasks 拉项目列表（不再从 localStorage 读）', async () => {
    mockListDramaTasks.mockResolvedValue([
      {
        id: 'p1',
        name: 'Backend Project',
        deleted: false,
        data: {
          name: 'Backend Project',
          style: 'Cinematic Realistic',
          language: 'zh',
          mode: 'auto',
          sourceType: 'idea',
          createdAt: 1700000000000,
          status: 'IDLE',
          stepStatus: 'idle',
          progress: 0,
          rawNovelText: '',
          characters: [],
          bigShots: [],
        },
        created_at: '2025-01-01T00:00:00',
        updated_at: '2025-01-01T00:00:00',
      },
    ] as any);

    render(<App />);
    await waitFor(() => {
      expect(mockListDramaTasks).toHaveBeenCalled();
    });
    await waitFor(() => {
      expect(screen.getByText('Backend Project')).toBeInTheDocument();
    });
  });

  it('后端返回空 + localStorage 有老数据 → 一次性迁移到后端', async () => {
    mockListDramaTasks.mockResolvedValue([]);
    const legacy = [
      {
        id: 'legacy-1',
        name: 'Old Legacy',
        style: 'Cinematic Realistic',
        language: 'zh',
        mode: 'auto',
        sourceType: 'idea',
        createdAt: 1690000000000,
        status: 'IDLE',
        stepStatus: 'idle',
        progress: 0,
        rawNovelText: '',
        characters: [],
        bigShots: [],
      },
    ];
    // localStorage 旧数据格式：{ tasks: [...], timestamp, version }
    localStorage.setItem('dramaforge_tasks', JSON.stringify({ tasks: legacy, timestamp: Date.now(), version: '1.0' }));

    render(<App />);
    await waitFor(() => {
      expect(mockListDramaTasks).toHaveBeenCalled();
    });
    // 等迁移完成（api.upsertDramaTask 应被调）
    await waitFor(() => {
      expect(mockUpsertDramaTask).toHaveBeenCalledWith('legacy-1', expect.objectContaining({
        name: 'Old Legacy',
        data: expect.objectContaining({ name: 'Old Legacy' }),
      }));
    });
    // 迁移成功后 localStorage 应被清空
    expect(localStorage.getItem('dramaforge_tasks')).toBeNull();
  });

  it('后端不可用时回落到 localStorage（兜底）', async () => {
    mockListDramaTasks.mockRejectedValue(new Error('network down'));
    const legacy = [
      {
        id: 'fallback-1',
        name: 'Fallback Project',
        style: 'Cinematic Realistic',
        language: 'zh',
        mode: 'auto',
        sourceType: 'idea',
        createdAt: 1690000000000,
        status: 'IDLE',
        stepStatus: 'idle',
        progress: 0,
        rawNovelText: '',
        characters: [],
        bigShots: [],
      },
    ];
    mockLoadTasks.mockReturnValue(legacy);

    render(<App />);
    // 兜底用 storageService.loadTasks
    await waitFor(() => {
      expect(mockLoadTasks).toHaveBeenCalled();
    });
    await waitFor(() => {
      expect(screen.getByText('Fallback Project')).toBeInTheDocument();
    });
  });

  it('后端空 + localStorage 也空 → 显示空状态（hero + 创建按钮）', async () => {
    mockListDramaTasks.mockResolvedValue([]);
    mockLoadTasks.mockReturnValue([]);
    mockLoadFromBackup.mockReturnValue([]);

    render(<App />);
    // 空状态显示 hero "DramaForge AI" + "新建项目" 按钮
    await waitFor(() => {
      expect(screen.getByText('DramaForge AI')).toBeInTheDocument();
    });
    // 创建按钮可见（用 .btn-press class 找）
    await waitFor(() => {
      expect(document.querySelector('.btn-press')).toBeTruthy();
    });
  });
});
