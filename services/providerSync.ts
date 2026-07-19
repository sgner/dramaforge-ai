/**
 * 供应商同步策略（Plan 5 + 2026-07-18 修复）。
 *
 * 行为契约：
 * 1. **只 upsert，绝不自动 delete**。
 *    删除只能由用户通过 modal 顶部的 🗑 按钮触发（modal 显式调
 *    api.deleteProvider），不能由 sync 副作用触发。
 * 2. apiKey 字段在"用户没改"时传 null —— 后端 PUT /api/providers/{id}
 *    看到 None/空 → 保留 DB 原 key。避免脱敏值覆盖真 key。
 *
 * 为什么去掉 auto-delete：
 *   React state `apiConfig` 在 bootstrap 完成时会被 `applyLoadedApiConfig` 覆盖；
 *   打开 modal → bootstrap 完成 → 用户保存 这条 race condition 下，
 *   prev (最新后端) 和 next (modal 缓存) 会短暂错位。原来的 diff-and-delete
 *   会把所有"prev 有但 next 没有"的 provider 全部 DELETE，
 *   即使后端 DB 里有完整数据也会被清空。
 *
 * 2026-07-18 修复：删掉 `handleSaveConfig` 里的
 *     for (prevP of prev) if (!next.find(p.id === prevP.id)) api.delete...
 * 改用本文件的 syncProvidersToBackend —— 只 upsert，不 delete。
 */
import type { Provider } from '../types';
import { api } from './apiClient';

export interface ProviderSyncResult {
  /** 实际调了 upsert 的 provider id 列表（与 next 一致，但跳过空 baseUrl） */
  upserted: string[];
  /** 跳过的 provider id 列表（baseUrl 缺失 → 后端会 422） */
  skipped: string[];
  /** 单条失败信息（不阻塞其他） */
  errors: { id: string; reason: string }[];
}

export interface SyncProvidersOptions {
  /** 显式注入的 upsert 函数（测试用） */
  upsert?: typeof api.upsertProvider;
  /** 静默收集 errors，不 console.warn；用于测试断言 */
  silent?: boolean;
}

/**
 * 把 `next` 里的每个 provider upsert 到后端。
 *
 * - 跳过 baseUrl 为空的（后端 PUT 会 422，与其让后端报错，不如前端早 fail）
 * - apiKey 字段语义：
 *     - prev 里没有该 id（新增）→ 把 next.apiKey 原样传过去
 *     - prev 有该 id 且 key 变了 → 把 next.apiKey 传过去
 *     - prev 有该 id 且 key 没变 → 传 null（后端保留 DB 原 key）
 * - **不调用 api.deleteProvider**。
 *   任何"prev 有但 next 没有"的 provider 由后端 DB 保留，绝不主动删。
 *
 * 返回值：实际调过 upsert 的 id、跳过的 id、错误明细。
 */
export async function syncProvidersToBackend(
  prev: Provider[],
  next: Provider[],
  opts: SyncProvidersOptions = {},
): Promise<ProviderSyncResult> {
  const upsert = opts.upsert || api.upsertProvider;
  const result: ProviderSyncResult = { upserted: [], skipped: [], errors: [] };
  const prevById = new Map(prev.map((p) => [p.id, p] as const));

  for (const p of next) {
    if (!p.baseUrl || !String(p.baseUrl).trim()) {
      result.skipped.push(p.id);
      if (!opts.silent) {
        // eslint-disable-next-line no-console
        console.warn(`[syncProviders] skip ${p.id}: baseUrl empty`);
      }
      continue;
    }
    const prevP = prevById.get(p.id);
    const apiKeyChanged = !prevP || (prevP.apiKey || '') !== (p.apiKey || '');
    const payload: Parameters<typeof api.upsertProvider>[1] = {
      name: p.name,
      base_url: p.baseUrl,
      default_model: p.defaultModel || '',
      protocol: p.protocol || 'openai',
      enabled: p.enabled !== false,
      chat_models: p.chatModels || [],
      image_models: p.imageModels || [],
      video_models: p.videoModels || [],
      // null/empty → 后端保留原 key
      api_key: apiKeyChanged ? (p.apiKey || '') : null,
    };
    try {
      await upsert(p.id, payload);
      result.upserted.push(p.id);
    } catch (e: any) {
      result.errors.push({ id: p.id, reason: e?.message || 'sync failed' });
      if (!opts.silent) {
        // eslint-disable-next-line no-console
        console.warn(`[syncProviders] upsert ${p.id} failed`, e);
      }
    }
  }
  return result;
}
