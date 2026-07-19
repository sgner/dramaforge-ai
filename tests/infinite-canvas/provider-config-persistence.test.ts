/**
 * 供应商配置丢失 bug 修复测试。
 *
 * Bug 场景：
 *   1. 用户在 ApiSettingsModal 配置 provider
 *   2. handleSaveConfig 触发 fire-and-forget 的 api.upsertProvider
 *   3. 如果 upsert 失败（网络抖动 / 后端冷启动），localStorage 有数据但后端没有
 *   4. 重启服务后，App.tsx bootstrap 读后端空数据，applyLoadedApiConfig 覆盖 store
 *   5. 用户看到 provider 消失
 *
 * 修复（2026-07-17）：
 *   - mediaProviderMigration: migrateLocalProvidersToBackendForce() 绕过 hasMigrated 守卫
 *   - mediaProviderMigration: getLocalProvidersSnapshot() 暴露 localStorage 原始数据
 *   - App.tsx bootstrap: 后端空 + localStorage 有 → 强制迁移 + 重新拉取 + merge
 *   - use-canvas-store: hydrateFromBackend() 从后端拉取并合并到 store
 *
 * 本测试文件验证上述修复点。
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

// ---- mock localStorage + window 在 import store 之前 ----
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

const upsertMock = vi.fn();
const listMock = vi.fn();

vi.mock('../../services/apiClient', () => ({
  api: {
    upsertProvider: (...args: any[]) => upsertMock(...args),
    listProviders: (...args: any[]) => listMock(...args),
    listDramaTasks: vi.fn().mockResolvedValue([]),
    getUserPreference: vi.fn().mockResolvedValue({ value: null }),
    bootstrap: vi.fn().mockResolvedValue({
      tasks: [],
      providers: [],
      modelBindings: null,
    }),
  },
}));

// mock mediaService — 它会拉 axios，而 axios 在 vitest happy-dom 中初始化会失败。
// use-canvas-store 间接导入 mediaService，所以这里必须 stub 掉。
vi.mock('../../services/mediaService', () => ({
  generateSoraVideo: vi.fn(),
  generateCharacterDesign: vi.fn(),
  generateStoryboardImage: vi.fn(),
  generatePropImage: vi.fn(),
  optimizeCanvasMediaPrompt: vi.fn(),
}));

// mock normalizeModelBindings（避免引入 types 模块的副作用）
vi.mock('../../types', async () => {
  const actual = await vi.importActual<any>('../../types');
  return {
    ...actual,
    normalizeModelBindings: (cfg: any) => ({
      ...(cfg || {}),
      modelBindings: (cfg && cfg.modelBindings) || [],
    }),
  };
});

// ======================== getLocalProvidersSnapshot ========================
describe('getLocalProvidersSnapshot', () => {
  beforeEach(() => {
    localStorageMock.clear();
  });

  it('localStorage 为空时返回空数组', async () => {
    const { getLocalProvidersSnapshot } = await import('../../services/mediaProviderMigration');
    const r = getLocalProvidersSnapshot();
    expect(r).toEqual([]);
  });

  it('localStorage 有 providers 时原样返回', async () => {
    localStorageMock.setItem(
      'dramaforge-canvas-api-config',
      JSON.stringify({
        providers: [
          { id: 'openai', name: 'OpenAI', baseUrl: 'https://api.openai.com', apiKey: 'sk-1', protocol: 'openai', enabled: true },
          { id: 'no-key', name: 'NoKey', baseUrl: 'https://x.com', apiKey: '', protocol: 'openai', enabled: true },
        ],
        stepBindings: [],
      }),
    );
    const { getLocalProvidersSnapshot } = await import('../../services/mediaProviderMigration');
    const r = getLocalProvidersSnapshot();
    expect(r.length).toBe(2);
    expect(r[0].id).toBe('openai');
    expect(r[0].apiKey).toBe('sk-1');
    // 没 key 的也保留（由调用方决定要不要过滤）
    expect(r[1].id).toBe('no-key');
    expect(r[1].apiKey).toBe('');
  });

  it('localStorage JSON 损坏时返回空数组（不抛）', async () => {
    localStorageMock.setItem('dramaforge-canvas-api-config', '{not-json');
    const { getLocalProvidersSnapshot } = await import('../../services/mediaProviderMigration');
    const r = getLocalProvidersSnapshot();
    expect(r).toEqual([]);
  });

  it('localStorage 不是预期结构（没有 providers 字段）时返回空数组', async () => {
    localStorageMock.setItem('dramaforge-canvas-api-config', JSON.stringify({ unrelated: 1 }));
    const { getLocalProvidersSnapshot } = await import('../../services/mediaProviderMigration');
    const r = getLocalProvidersSnapshot();
    expect(r).toEqual([]);
  });
});

// ======================== migrateLocalProvidersToBackendForce ========================
describe('migrateLocalProvidersToBackendForce', () => {
  beforeEach(() => {
    localStorageMock.clear();
    upsertMock.mockReset();
  });

  it('绕过 hasMigrated 守卫：标志位已置 1 仍会重试', async () => {
    // 模拟"之前迁移过但没成功"的状态
    localStorageMock.setItem('dramaforge-media-migrated-v1', '1');
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

    const { migrateLocalProvidersToBackendForce } = await import('../../services/mediaProviderMigration');
    const r = await migrateLocalProvidersToBackendForce();
    // 关键断言：hasMigrated 守卫被绕过，仍调用了 upsert
    expect(r.attempted).toBe(1);
    expect(r.synced).toBe(1);
    expect(upsertMock).toHaveBeenCalledTimes(1);
    // 成功后 markMigrated 仍然写（幂等）
    expect(localStorageMock.getItem('dramaforge-media-migrated-v1')).toBe('1');
  });

  it('后端 upsert 失败时不写迁移标志 + 返回失败项', async () => {
    upsertMock.mockRejectedValueOnce(new Error('boom'));
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

    const { migrateLocalProvidersToBackendForce } = await import('../../services/mediaProviderMigration');
    const r = await migrateLocalProvidersToBackendForce();
    expect(r.attempted).toBe(1);
    expect(r.synced).toBe(0);
    expect(r.failed.length).toBe(1);
    expect(r.failed[0].id).toBe('p1');
    // 关键：失败不写标志 → 下次可重试
    expect(localStorageMock.getItem('dramaforge-media-migrated-v1')).not.toBe('1');
  });

  it('localStorage 为空时不调 upsert', async () => {
    const { migrateLocalProvidersToBackendForce } = await import('../../services/mediaProviderMigration');
    const r = await migrateLocalProvidersToBackendForce();
    expect(r.attempted).toBe(0);
    expect(r.synced).toBe(0);
    expect(upsertMock).not.toHaveBeenCalled();
  });
});

// ======================== hydrateFromBackend ========================
describe('useCanvasStore.hydrateFromBackend', () => {
  beforeEach(() => {
    localStorageMock.clear();
    upsertMock.mockReset();
    listMock.mockReset();
  });

  it('后端有数据时用后端替换 store（保留 store 中的明文 apiKey）', async () => {
    listMock.mockResolvedValueOnce([
      {
        provider_id: 'openai',
        name: 'OpenAI',
        base_url: 'https://api.openai.com/v1',
        api_key: 'sk-masked-***-1234', // 脱敏值
        protocol: 'openai',
        enabled: true,
        has_key: true,
        key_preview: '***1234',
        image_models: ['dall-e-3'],
        chat_models: ['gpt-4o'],
        video_models: [],
      },
    ]);

    // 初始化 store with 默认 config（来自 localStorage 的 store 初始化）
    const { useCanvasStore } = await import('../../components/infinite-canvas/use-canvas-store');
    // 直接 setApiConfig 一个含明文 apiKey 的 store
    useCanvasStore.getState().setApiConfig({
      providers: [
        {
          id: 'openai',
          name: 'OpenAI',
          baseUrl: 'https://api.openai.com/v1',
          protocol: 'openai',
          enabled: true,
          apiKey: 'sk-real-secret-from-store',
          hasKey: true,
          keyPreview: '',
          imageModels: ['dall-e-3'],
          chatModels: ['gpt-4o'],
          videoModels: [],
        },
      ],
      modelBindings: [],
    });

    const ok = await useCanvasStore.getState().hydrateFromBackend();
    expect(ok).toBe(true);

    const merged = useCanvasStore.getState().apiConfig.providers;
    const openai = merged.find((p) => p.id === 'openai');
    expect(openai).toBeDefined();
    // 关键：保留 store 的明文 key（避免被后端脱敏值覆盖）
    expect(openai!.apiKey).toBe('sk-real-secret-from-store');
    expect(openai!.hasKey).toBe(true);
  });

  it('后端为空 + localStorage 有 key 时强制迁移 + 重新拉取 + merge', async () => {
    // 第一次 list：后端空
    // 第二次 list（migration 之后）：后端有数据
    listMock
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          provider_id: 'openai',
          name: 'OpenAI',
          base_url: 'https://api.openai.com/v1',
          api_key: '***',
          protocol: 'openai',
          enabled: true,
          has_key: true,
          key_preview: '',
          image_models: [],
          chat_models: [],
          video_models: [],
        },
      ]);
    upsertMock.mockResolvedValueOnce({ provider_id: 'openai' });

    // localStorage 兜底：有 openai provider + key
    localStorageMock.setItem(
      'dramaforge-canvas-api-config',
      JSON.stringify({
        providers: [
          {
            id: 'openai',
            name: 'OpenAI',
            baseUrl: 'https://api.openai.com/v1',
            apiKey: 'sk-from-localstorage',
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

    const { useCanvasStore } = await import('../../components/infinite-canvas/use-canvas-store');
    useCanvasStore.getState().setApiConfig({
      providers: [
        {
          id: 'openai',
          name: 'OpenAI',
          baseUrl: 'https://api.openai.com/v1',
          protocol: 'openai',
          enabled: true,
          apiKey: 'sk-from-localstorage',
          hasKey: true,
          keyPreview: '',
          imageModels: [],
          chatModels: [],
          videoModels: [],
        },
      ],
      modelBindings: [],
    });

    const ok = await useCanvasStore.getState().hydrateFromBackend();
    expect(ok).toBe(true);
    // 迁移被触发
    expect(upsertMock).toHaveBeenCalled();
    // listProviders 被调了 2 次（首查 + 迁移后重查）
    expect(listMock).toHaveBeenCalledTimes(2);
  });

  it('后端 list 抛错时返回 false 不抛（不破坏 store 状态）', async () => {
    listMock.mockRejectedValueOnce(new Error('network-error'));

    const { useCanvasStore } = await import('../../components/infinite-canvas/use-canvas-store');
    useCanvasStore.getState().setApiConfig({
      providers: [
        {
          id: 'preserved',
          name: 'preserved',
          baseUrl: 'https://example.com',
          protocol: 'openai',
          enabled: true,
          apiKey: 'sk-keep-me',
          hasKey: true,
          keyPreview: '',
          imageModels: [],
          chatModels: [],
          videoModels: [],
        },
      ],
      modelBindings: [],
    });

    const ok = await useCanvasStore.getState().hydrateFromBackend();
    expect(ok).toBe(false);
    // store 状态保持
    const after = useCanvasStore.getState().apiConfig.providers;
    expect(after.length).toBe(1);
    expect(after[0].id).toBe('preserved');
  });

  it('store 中有但后端没有的 provider 被保留（不丢失用户新增未同步的）', async () => {
    listMock.mockResolvedValueOnce([
      {
        provider_id: 'backend-only',
        name: 'Backend',
        base_url: 'https://b.com',
        api_key: '',
        protocol: 'openai',
        enabled: true,
        has_key: false,
        key_preview: '',
        image_models: [],
        chat_models: [],
        video_models: [],
      },
    ]);

    const { useCanvasStore } = await import('../../components/infinite-canvas/use-canvas-store');
    useCanvasStore.getState().setApiConfig({
      providers: [
        {
          id: 'store-only',
          name: 'StoreOnly',
          baseUrl: 'https://s.com',
          protocol: 'openai',
          enabled: true,
          apiKey: 'sk-new',
          hasKey: true,
          keyPreview: '',
          imageModels: [],
          chatModels: [],
          videoModels: [],
        },
      ],
      modelBindings: [],
    });

    await useCanvasStore.getState().hydrateFromBackend();
    const merged = useCanvasStore.getState().apiConfig.providers;
    const ids = merged.map((p) => p.id).sort();
    expect(ids).toEqual(['backend-only', 'store-only']);
  });
});
