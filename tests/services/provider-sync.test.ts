/**
 * 供应商同步策略测试 —— 验证"只 upsert，不 delete"契约。
 *
 * 根因（2026-07-18 修复）：
 *   原 handleSaveConfig 用 prev/next diff，prev 有但 next 没有的 provider
 *   会被自动 DELETE。在 bootstrap race condition 下（打开 modal →
 *   bootstrap 完成 → setApiConfig 覆盖 → 用户保存）prev 与 next 短暂错位，
 *   把后端 DB 的 provider 全清空。
 *
 * 修复：抽 syncProvidersToBackend 到 services/providerSync.ts，
 *       内部只 upsert，不 delete。删除只走 modal 显式 🗑 按钮。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { syncProvidersToBackend } from '../../services/providerSync';
import type { Provider } from '../../types';

const upsertMock = vi.fn();
const deleteMock = vi.fn();

vi.mock('../../services/apiClient', () => ({
  api: {
    upsertProvider: (...args: any[]) => upsertMock(...args),
    deleteProvider: (...args: any[]) => deleteMock(...args),
  },
}));

function makeProvider(overrides: Partial<Provider>): Provider {
  return {
    id: 'p1',
    name: 'p1',
    baseUrl: 'https://x.com',
    protocol: 'openai',
    enabled: true,
    apiKey: '',
    hasKey: false,
    keyPreview: '',
    imageModels: [],
    chatModels: [],
    videoModels: [],
    defaultModel: '',
    ...overrides,
  } as Provider;
}

describe('syncProvidersToBackend', () => {
  beforeEach(() => {
    upsertMock.mockReset();
    deleteMock.mockReset();
    upsertMock.mockResolvedValue({});
  });

  // ── 核心契约：绝不调 deleteProvider ────────────────────────
  it('绝不调 api.deleteProvider（防止 race condition 静默清空 DB）', async () => {
    const prev = [
      makeProvider({ id: 'a', baseUrl: 'https://a.com', apiKey: 'sk-a' }),
      makeProvider({ id: 'b', baseUrl: 'https://b.com', apiKey: 'sk-b' }),
      makeProvider({ id: 'c', baseUrl: 'https://c.com', apiKey: 'sk-c' }),
    ];
    // next 少一个 d 都没有，但 prev 里的 a/b/c 一个都没传（race condition 模拟）
    const next = [
      makeProvider({ id: 'a', baseUrl: 'https://a.com', apiKey: 'sk-a' }),
    ];
    await syncProvidersToBackend(prev, next, { silent: true });
    expect(deleteMock).not.toHaveBeenCalled();
  });

  it('race 模拟：prev 有 5 个，next 只有 1 个（modal 缓存陈旧），不删任何', async () => {
    const prev = Array.from({ length: 5 }, (_, i) =>
      makeProvider({ id: `p${i}`, baseUrl: `https://p${i}.com`, apiKey: `sk-${i}` }),
    );
    const next = [prev[0]];
    const result = await syncProvidersToBackend(prev, next, { silent: true });
    // 只 upsert 1 个，不删
    expect(result.upserted).toEqual(['p0']);
    expect(deleteMock).not.toHaveBeenCalled();
    expect(upsertMock).toHaveBeenCalledTimes(1);
  });

  // ── apiKey 保留语义 ─────────────────────────────────────
  it('key 未变化时 api_key 传 null（后端保留原 key，不被脱敏值覆盖）', async () => {
    const prev = [makeProvider({ id: 'p1', baseUrl: 'https://x.com', apiKey: 'sk-real' })];
    const next = [makeProvider({ id: 'p1', baseUrl: 'https://x.com', apiKey: 'sk-real' })];
    await syncProvidersToBackend(prev, next, { silent: true });
    const payload = upsertMock.mock.calls[0][1];
    expect(payload.api_key).toBeNull();
  });

  it('key 变化时 api_key 传新值', async () => {
    const prev = [makeProvider({ id: 'p1', baseUrl: 'https://x.com', apiKey: 'sk-old' })];
    const next = [makeProvider({ id: 'p1', baseUrl: 'https://x.com', apiKey: 'sk-new' })];
    await syncProvidersToBackend(prev, next, { silent: true });
    const payload = upsertMock.mock.calls[0][1];
    expect(payload.api_key).toBe('sk-new');
  });

  it('新增 provider（prev 没有）时 api_key 原样传过去', async () => {
    const prev: Provider[] = [];
    const next = [makeProvider({ id: 'new1', baseUrl: 'https://new.com', apiKey: 'sk-fresh' })];
    await syncProvidersToBackend(prev, next, { silent: true });
    const payload = upsertMock.mock.calls[0][1];
    expect(payload.api_key).toBe('sk-fresh');
  });

  // ── 跳过语义 ─────────────────────────────────────────
  it('baseUrl 为空的 provider 跳过 upsert（前端早 fail 避免后端 422）', async () => {
    const prev: Provider[] = [];
    const next = [
      makeProvider({ id: 'no-url', baseUrl: '' }),
      makeProvider({ id: 'has-url', baseUrl: 'https://x.com' }),
    ];
    const result = await syncProvidersToBackend(prev, next, { silent: true });
    expect(result.skipped).toEqual(['no-url']);
    expect(result.upserted).toEqual(['has-url']);
    expect(upsertMock).toHaveBeenCalledTimes(1);
  });

  // ── 错误处理 ─────────────────────────────────────────
  it('单条 upsert 失败不阻塞其他', async () => {
    upsertMock.mockRejectedValueOnce(new Error('boom'));
    const prev: Provider[] = [];
    const next = [
      makeProvider({ id: 'fail', baseUrl: 'https://fail.com' }),
      makeProvider({ id: 'ok', baseUrl: 'https://ok.com' }),
    ];
    const result = await syncProvidersToBackend(prev, next, { silent: true });
    expect(result.upserted).toEqual(['ok']);
    expect(result.errors).toEqual([{ id: 'fail', reason: 'boom' }]);
  });
});
