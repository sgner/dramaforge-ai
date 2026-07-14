/**
 * TDD: CanvasGate 项目列表走 FastAPI 后端（不再用 localStorage 存项目数据）。
 *
 * 用户切浏览器 / 换设备 / 清缓存后，项目数据不应丢失。
 * 关键设计：
 *  - 挂载时调 api.listProjects() 拉项目列表
 *  - 创建 / 改名 / 软删 / 硬删 全部走后端
 *  - 软删除（trash）的 id 仍放 localStorage（仅 id 列表，不存数据本身）
 *  - emoji 等小 UI 字段放 localStorage（丢了不影响数据）
 *  - 后端不可用时不回落到 localStorage 的项目列表（避免误导用户）
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { CanvasGate } from '@/components/infinite-canvas/CanvasGate';
import { api } from '@/services/apiClient';

function makeProjects(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    id: `p${i + 1}`,
    name: `Project ${i + 1}`,
    created_at: new Date(2025, 0, i + 1).toISOString(),
    updated_at: new Date(2025, 0, i + 1).toISOString(),
    viewport: { x: 0, y: 0, scale: 1 },
    node_count: i,
  }));
}

describe('<CanvasGate /> — projects from backend (no localStorage)', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
    // 兜底：偏好 API 默认返 null（测试中需要时再覆盖）
    vi.spyOn(api, 'getUserPreference').mockImplementation(async (key: string) => {
      if (key === 'deleted_canvas_ids') {
        const raw = localStorage.getItem('dramaforge-deleted-canvas-ids');
        if (raw) {
          try { return { value: JSON.parse(raw) } as any; } catch {}
        }
      }
      if (key === 'canvas_emoji') {
        const raw = localStorage.getItem('dramaforge-canvas-emoji');
        if (raw) {
          try { return { value: JSON.parse(raw) } as any; } catch {}
        }
      }
      return { value: null } as any;
    });
    vi.spyOn(api, 'setUserPreference').mockResolvedValue({ key: '', value: null } as any);
  });

  it('loads project list from api.listProjects on mount', async () => {
    const listSpy = vi.spyOn(api, 'listProjects').mockResolvedValue(makeProjects(3) as any);
    render(<CanvasGate onOpenCanvas={vi.fn()} onNewCanvas={vi.fn()} />);
    // 加载中
    expect(screen.getByTestId('canvas-gate-loading')).toBeInTheDocument();
    // 加载完应显示 3 个项目
    await waitFor(() => {
      expect(screen.getByText('Project 1')).toBeInTheDocument();
      expect(screen.getByText('Project 2')).toBeInTheDocument();
      expect(screen.getByText('Project 3')).toBeInTheDocument();
    });
    expect(listSpy).toHaveBeenCalledTimes(1);
    // 不再展示 "loading"
    expect(screen.queryByTestId('canvas-gate-loading')).toBeNull();
  });

  it('does NOT read project list from localStorage (dramaforge-canvas-list)', async () => {
    // 预先在 localStorage 放一些"老"数据
    localStorage.setItem(
      'dramaforge-canvas-list',
      JSON.stringify([
        { id: 'old-1', title: 'Old Project', updatedAt: Date.now(), nodeCount: 0 } as any,
      ]),
    );
    vi.spyOn(api, 'listProjects').mockResolvedValue(makeProjects(1) as any);
    render(<CanvasGate onOpenCanvas={vi.fn()} onNewCanvas={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('Project 1')).toBeInTheDocument());
    // 老数据不应该出现（已经从 localStorage 移除，新行为完全走后端）
    expect(screen.queryByText('Old Project')).toBeNull();
  });

  it('shows backend error when api.listProjects fails (no silent fallback)', async () => {
    vi.spyOn(api, 'listProjects').mockRejectedValue(new Error('network down'));
    render(<CanvasGate onOpenCanvas={vi.fn()} onNewCanvas={vi.fn()} />);
    await waitFor(() => expect(screen.getByTestId('canvas-gate-error')).toBeInTheDocument());
    expect(screen.getByTestId('canvas-gate-error').textContent).toMatch(/network down/);
    // 创建按钮应禁用（避免在后端不可用时创建丢失）
    expect(screen.getByTestId('canvas-gate-create')).toBeDisabled();
    expect(screen.getByTestId('canvas-gate-create-smart')).toBeDisabled();
  });

  it('create button calls api.createProjectWithId and updates state', async () => {
    vi.spyOn(api, 'listProjects').mockResolvedValue([]);
    const createSpy = vi.spyOn(api, 'createProjectWithId').mockResolvedValue({
      id: 'new-1',
      name: 'New',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      viewport: { x: 0, y: 0, scale: 1 },
    } as any);
    const onNew = vi.fn();
    render(<CanvasGate onOpenCanvas={vi.fn()} onNewCanvas={onNew} />);
    await waitFor(() => expect(screen.queryByTestId('canvas-gate-loading')).toBeNull());
    fireEvent.click(screen.getByTestId('canvas-gate-create-smart'));
    await waitFor(() => {
      expect(createSpy).toHaveBeenCalled();
      expect(onNew).toHaveBeenCalled();
    });
    expect(screen.getByText('New')).toBeInTheDocument();
  });

  it('rename calls api.updateProject with the new name', async () => {
    vi.spyOn(api, 'listProjects').mockResolvedValue(makeProjects(1) as any);
    const updateSpy = vi.spyOn(api, 'updateProject').mockResolvedValue({} as any);
    render(<CanvasGate onOpenCanvas={vi.fn()} onNewCanvas={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('Project 1')).toBeInTheDocument());
    // 点卡片上的 edit 按钮（lucide Pencil 图标）进入编辑模式
    const editBtns = document.querySelectorAll('.canvas-card-edit') as NodeListOf<HTMLButtonElement>;
    expect(editBtns.length).toBeGreaterThan(0);
    fireEvent.click(editBtns[0]);
    const input = screen.getByRole('textbox') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'Renamed' } });
    fireEvent.blur(input);
    await waitFor(() => {
      expect(updateSpy).toHaveBeenCalledWith('p1', { name: 'Renamed' });
    });
    // 乐观更新：UI 立即显示 Renamed
    expect(screen.getByText('Renamed')).toBeInTheDocument();
  });

  it('soft delete adds id to deletedIds set (no backend call), keeps data safe', async () => {
    vi.spyOn(api, 'listProjects').mockResolvedValue(makeProjects(2) as any);
    const deleteSpy = vi.spyOn(api, 'deleteProject').mockResolvedValue({} as any);
    render(<CanvasGate onOpenCanvas={vi.fn()} onNewCanvas={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('Project 1')).toBeInTheDocument());
    // 点卡片上的 delete 按钮（lucide Trash2 图标）→ 二次确认
    const delBtn = document.querySelector('.canvas-delete') as HTMLButtonElement;
    expect(delBtn).toBeTruthy();
    fireEvent.click(delBtn);
    // 二次确认对话框出现，里面有"删除"和"取消"两个按钮
    await waitFor(() => {
      expect(document.querySelector('.canvas-delete-confirm')).toBeTruthy();
    });
    // 点"删除"确认软删
    const confirmBtns = document.querySelectorAll('.canvas-delete-confirm button') as NodeListOf<HTMLButtonElement>;
    // 第一个是"删除"
    fireEvent.click(confirmBtns[0]);
    await waitFor(() => {
      // 后端硬删 API 软删时不应被调用
      expect(deleteSpy).not.toHaveBeenCalled();
    });
    // Project 1 不在 active 列表里
    expect(screen.queryByText('Project 1')).toBeNull();
    expect(screen.getByText('Project 2')).toBeInTheDocument();
    // 切到 trash 应能看到 Project 1
    const trashBtn = document.querySelector('.gate-trash-btn') as HTMLButtonElement;
    expect(trashBtn).toBeTruthy();
    fireEvent.click(trashBtn);
    expect(screen.getByText('Project 1')).toBeInTheDocument();
    // localStorage 里应有 deletedIds
    const saved = JSON.parse(localStorage.getItem('dramaforge-deleted-canvas-ids') || '[]');
    expect(saved).toContain('p1');
  });

  it('permanent delete in trash calls api.deleteProject (hard delete)', async () => {
    vi.spyOn(api, 'listProjects').mockResolvedValue(makeProjects(1) as any);
    const deleteSpy = vi.spyOn(api, 'deleteProject').mockResolvedValue({} as any);
    // 预先标记 p1 为已删
    localStorage.setItem('dramaforge-deleted-canvas-ids', JSON.stringify(['p1']));
    render(<CanvasGate onOpenCanvas={vi.fn()} onNewCanvas={vi.fn()} />);
    await waitFor(() => expect(screen.queryByTestId('canvas-gate-loading')).toBeNull());
    // 进 trash
    const trashBtn = document.querySelector('.gate-trash-btn') as HTMLButtonElement;
    fireEvent.click(trashBtn);
    expect(screen.getByText('Project 1')).toBeInTheDocument();
    // 永久删除按钮（在 trash 模式下，卡片上）
    const permBtns = document.querySelectorAll('.canvas-delete') as NodeListOf<HTMLButtonElement>;
    // trash 模式下第一个 canvas-delete 是永久删除
    fireEvent.click(permBtns[0]);
    await waitFor(() => {
      expect(deleteSpy).toHaveBeenCalledWith('p1');
    });
  });
});
