/**
 * 供应商迁移：localStorage → 后端 DB
 *
 * 验证点：
 * 1. 一次性：第二次调用直接 return（因为 flag 已被写）
 * 2. 含明文 apiKey 的 provider 被同步到 DB
 * 3. 没 baseUrl / 没 apiKey 的 provider 被跳过
 * 4. 同步失败不抛、不阻塞其他
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

// ---- mock localStorage + apiClient 在 import store 之前 ----
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (k: string) => (k in store ? store[k] : null),
    setItem: (k: string, v: string) => {
      store[k] = String(v);
    },
    removeItem: (k: string) => {
      delete store[k];
    },
    clear: () => {
      store = {};
    },
    _dump: () => ({ ...store }),
  };
})();

vi.stubGlobal('localStorage', localStorageMock);
vi.stubGlobal('window', {} as any);

const upsertMock = vi.fn(async (id: string, payload: any) => {
  if (id === 'fail-provider') throw new Error('sync-fail');
  return { provider_id: id, ...payload };
});

vi.mock('../../services/apiClient', () => ({
  api: {
    upsertMediaProvider: upsertMock,
  },
}));

// 必须放在 mock 之后
const { migrateLocalProvidersToBackend } = await import(
  '../../services/mediaProviderMigration'
);

describe('migrateLocalProvidersToBackend', () => {
  beforeEach(() => {
    localStorageMock.clear();
    upsertMock.mockClear();
  });

  it('跳过空 / 默认 provider，同步有 key 的 provider', async () => {
    localStorageMock.setItem(
      'dramaforge-canvas-api-config',
      JSON.stringify({
        providers: [
          // 1) 有 key — 应同步
          {
            id: 'openai',
            name: 'OpenAI',
            baseUrl: 'https://api.openai.com/v1',
            apiKey: 'sk-test-1234',
            protocol: 'openai',
            enabled: true,
            imageModels: ['dall-e-3'],
            chatModels: ['gpt-4o'],
            videoModels: [],
          },
          // 2) 没 key — 跳过
          {
            id: 'no-key',
            name: 'NoKey',
            baseUrl: 'https://example.com',
            apiKey: '',
            protocol: 'openai',
            enabled: true,
            imageModels: [],
            chatModels: [],
            videoModels: [],
          },
          // 3) 没 baseUrl — 跳过
          {
            id: 'no-url',
            name: 'NoUrl',
            baseUrl: '',
            apiKey: 'sk-x',
            protocol: 'openai',
            enabled: true,
          },
          // 4) 默认 provider 形态（DEFAULT_PROVIDERS 中无 baseUrl / 无 key）— 跳过
          {
            id: 'default-empty',
            name: 'Default',
            baseUrl: '',
            apiKey: '',
            protocol: 'openai',
            enabled: true,
          },
        ],
        stepBindings: [],
      }),
    );

    const r = await migrateLocalProvidersToBackend();
    expect(r.attempted).toBe(1);
    expect(r.synced).toBe(1);
    expect(r.skipped).toBe(3);
    expect(r.failed).toEqual([]);

    // 验证 upsert 收到的 payload
    expect(upsertMock).toHaveBeenCalledTimes(1);
    const [id, payload] = upsertMock.mock.calls[0];
    expect(id).toBe('openai');
    expect(payload.base_url).toBe('https://api.openai.com/v1');
    expect(payload.api_key).toBe('sk-test-1234');
    expect(payload.protocol).toBe('openai');
    expect(payload.image_models).toEqual(['dall-e-3']);

    // 标记已写入
    expect(localStorageMock.getItem('dramaforge-media-migrated-v1')).toBe('1');
  });

  it('一次性：第二次调用直接返回（不再调用 upsert）', async () => {
    localStorageMock.setItem(
      'dramaforge-canvas-api-config',
      JSON.stringify({
        providers: [
          {
            id: 'p1',
            name: 'p1',
            baseUrl: 'https://example.com',
            apiKey: 'sk-1',
            protocol: 'openai',
            enabled: true,
            imageModels: [],
            chatModels: [],
            videoModels: [],
          },
        ],
        stepBindings: [],
      }),
    );

    const r1 = await migrateLocalProvidersToBackend();
    expect(r1.synced).toBe(1);

    const r2 = await migrateLocalProvidersToBackend();
    expect(r2.attempted).toBe(0);
    expect(r2.synced).toBe(0);
    // 总调用次数仍是 1
    expect(upsertMock).toHaveBeenCalledTimes(1);
  });

  it('单条失败不阻塞其他', async () => {
    localStorageMock.setItem(
      'dramaforge-canvas-api-config',
      JSON.stringify({
        providers: [
          {
            id: 'fail-provider',
            name: 'Fail',
            baseUrl: 'https://example.com',
            apiKey: 'sk-fail',
            protocol: 'openai',
            enabled: true,
            imageModels: [],
            chatModels: [],
            videoModels: [],
          },
          {
            id: 'ok-provider',
            name: 'OK',
            baseUrl: 'https://example.com',
            apiKey: 'sk-ok',
            protocol: 'openai',
            enabled: true,
            imageModels: [],
            chatModels: [],
            videoModels: [],
          },
        ],
        stepBindings: [],
      }),
    );

    const r = await migrateLocalProvidersToBackend();
    expect(r.attempted).toBe(2);
    expect(r.synced).toBe(1);
    expect(r.failed.length).toBe(1);
    expect(r.failed[0].id).toBe('fail-provider');
    expect(upsertMock).toHaveBeenCalledTimes(2);
  });

  it('空 localStorage 不报错', async () => {
    const r = await migrateLocalProvidersToBackend();
    expect(r.attempted).toBe(0);
    expect(r.synced).toBe(0);
    expect(upsertMock).not.toHaveBeenCalled();
  });
});
