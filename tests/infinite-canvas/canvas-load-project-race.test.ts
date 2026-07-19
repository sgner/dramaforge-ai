/**
 * 回归测试：画布切项目竞态 + 空数组覆盖保存（数据丢失级 bug）
 *
 * 覆盖三个修复点：
 *  1. loadProject 竞态守卫：A→B 快速切换，A 的慢响应返回后不得覆盖 B 的画布。
 *  2. hydrate 窗口守卫：loadProject 清空画布 → loadFromBackend 完成期间，
 *     不得把该项目的空 nodes PUT 到后端（saveNodes 是全量覆盖语义）。
 *     失败路径同样要解除守卫（否则该项目之后的编辑永远保存不上）。
 *  3. 保存定时器 per-project：A 项目有 pending 保存时切到 B，
 *     A 的保存不得被 B 的调度 clearTimeout 掉。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useCanvasStore } from '@/components/infinite-canvas/use-canvas-store';
import { api } from '@/services/apiClient';

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: any) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function nodeOut(id: string) {
  return { id, type: 'text', x: 0, y: 0, w: 260, h: 120, data: {} } as any;
}

function snap(projectId: string, nodeIds: string[]) {
  return {
    project: {
      id: projectId,
      name: projectId,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      viewport: { x: 0, y: 0, scale: 100 },
    },
    nodes: nodeIds.map(nodeOut),
    connections: [],
    assets: [],
  } as any;
}

function canvasNode(id: string) {
  return { id, type: 'text', x: 0, y: 0, w: 260, h: 120 } as any;
}

describe('use-canvas-store — 切项目竞态与空数组覆盖保存', () => {
  let getSnapshotSpy: ReturnType<typeof vi.spyOn>;
  let saveNodesSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
    // 重置 store（projectId=null 时订阅保存直接 return，不会产生调度）
    useCanvasStore.setState({
      projectId: null,
      nodes: [],
      connections: [],
      taskAssets: [],
      viewport: { x: -1800, y: -1000, scale: 1 },
    } as any);
    saveNodesSpy = vi.spyOn(api, 'saveNodes').mockResolvedValue({ ok: true, count: 0 } as any);
    vi.spyOn(api, 'saveConnections').mockResolvedValue({ ok: true, count: 0 } as any);
    vi.spyOn(api, 'updateProject').mockResolvedValue({} as any);
    vi.spyOn(api, 'createProjectWithId').mockResolvedValue({} as any);
    // 默认：任何项目都立即返回一个空快照（各测试按需覆盖）
    getSnapshotSpy = vi
      .spyOn(api, 'getSnapshot')
      .mockImplementation(async (pid: string) => snap(pid, []));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('快速切换 A→B：A 的慢响应返回后不得覆盖 B 的 nodes', async () => {
    const aLoad = deferred<any>();
    getSnapshotSpy.mockImplementation((pid: string) => {
      if (pid === 'race-a') return aLoad.promise;
      return Promise.resolve(snap(pid, [`${pid}-node`]));
    });

    useCanvasStore.getState().loadProject('race-a');
    useCanvasStore.getState().loadProject('race-b');
    // B 立即加载完成
    await vi.advanceTimersByTimeAsync(0);
    expect(useCanvasStore.getState().projectId).toBe('race-b');
    expect(useCanvasStore.getState().nodes.map((n) => n.id)).toEqual(['race-b-node']);

    // A 的慢响应此时才返回 —— 必须被丢弃
    aLoad.resolve(snap('race-a', ['race-a-node']));
    await vi.advanceTimersByTimeAsync(0);
    expect(useCanvasStore.getState().projectId).toBe('race-b');
    expect(useCanvasStore.getState().nodes.map((n) => n.id)).toEqual(['race-b-node']);
  });

  it('hydrate 窗口内不得向后端 PUT 空 nodes；加载完成后也不得保存空数组', async () => {
    const slowLoad = deferred<any>();
    getSnapshotSpy.mockImplementation((pid: string) => {
      if (pid === 'hyd-slow') return slowLoad.promise;
      return Promise.resolve(snap(pid, []));
    });

    useCanvasStore.getState().loadProject('hyd-slow');
    // hydrate 期间推进远超 600ms 防抖窗口 —— 不得发出任何针对 hyd-slow 的 saveNodes
    await vi.advanceTimersByTimeAsync(5000);
    const duringCalls = saveNodesSpy.mock.calls.filter((c) => c[0] === 'hyd-slow');
    expect(duringCalls).toEqual([]);

    // 加载完成后：恢复真实 nodes；随后的保存（既有行为）也必须是非空数据
    slowLoad.resolve(snap('hyd-slow', ['hyd-node-1']));
    await vi.advanceTimersByTimeAsync(0);
    expect(useCanvasStore.getState().nodes.map((n) => n.id)).toEqual(['hyd-node-1']);
    await vi.advanceTimersByTimeAsync(1000);
    const allCalls = saveNodesSpy.mock.calls.filter((c) => c[0] === 'hyd-slow');
    for (const call of allCalls) {
      expect((call[1] as any[]).length).toBeGreaterThan(0);
    }
  });

  it('加载失败路径同样解除守卫：失败后该项目的编辑仍能正常保存', async () => {
    getSnapshotSpy.mockImplementation((pid: string) => {
      if (pid === 'hyd-fail') return Promise.reject(new Error('500 backend boom'));
      return Promise.resolve(snap(pid, []));
    });

    useCanvasStore.getState().loadProject('hyd-fail');
    await vi.advanceTimersByTimeAsync(0); // 让失败路径走完（loadFromBackend 返回 null）
    expect(useCanvasStore.getState().projectId).toBe('hyd-fail');

    // 守卫已解除：用户之后的编辑必须在 600ms 后正常保存
    useCanvasStore.setState({ nodes: [canvasNode('fail-edit-1')] } as any);
    await vi.advanceTimersByTimeAsync(1000);
    const calls = saveNodesSpy.mock.calls.filter((c) => c[0] === 'hyd-fail');
    expect(calls.length).toBeGreaterThan(0);
    const lastPayload = calls[calls.length - 1][1] as any[];
    expect(lastPayload.map((n) => n.id)).toContain('fail-edit-1');
  });

  it('A 项目有 pending 保存时切到 B：A 的保存不被取消，最终仍发出', async () => {
    getSnapshotSpy.mockImplementation(async (pid: string) => snap(pid, []));

    useCanvasStore.getState().loadProject('keep-a');
    await vi.advanceTimersByTimeAsync(0);
    // 用户对 A 做了一次编辑 → 调度 600ms 防抖保存
    useCanvasStore.setState({ nodes: [canvasNode('keep-a-node')] } as any);

    // 不到 600ms 就切到 B —— B 的调度不得清掉 A 的 pending 保存
    useCanvasStore.getState().loadProject('keep-b');
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(1000);

    const aCalls = saveNodesSpy.mock.calls.filter((c) => c[0] === 'keep-a');
    expect(aCalls.length).toBeGreaterThan(0);
    const lastPayload = aCalls[aCalls.length - 1][1] as any[];
    expect(lastPayload.map((n) => n.id)).toContain('keep-a-node');
  });
});
