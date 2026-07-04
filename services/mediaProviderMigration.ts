/**
 * 供应商迁移工具：把 localStorage 中已配置的供应商（含 apiKey）一次性入库到后端 DB。
 *
 * 设计目标：
 * - 旧版：供应商配置存在前端 localStorage，前端直连供应商
 * - 新版：所有供应商配置统一到后端 DB，前端不再持有明文 apiKey
 * - 迁移：用户首次加载新版本时，自动把 localStorage 中有 apiKey 的 provider 入库；
 *         完成后写 `dramaforge-media-migrated-v1=1` 标志，避免重复入库
 */
import { api } from './apiClient';
import type { Provider } from '../types';

const MEDIA_MIGRATION_KEY = 'dramaforge-media-migrated-v1';
const API_CONFIG_KEY = 'dramaforge-canvas-api-config';

export interface MigrationResult {
  attempted: number;
  synced: number;
  failed: { id: string; reason: string }[];
  skipped: number;
}

function hasMigrated(): boolean {
  try {
    return localStorage.getItem(MEDIA_MIGRATION_KEY) === '1';
  } catch {
    return false;
  }
}

function markMigrated(): void {
  try {
    localStorage.setItem(MEDIA_MIGRATION_KEY, '1');
  } catch {
    /* ignore */
  }
}

function readProvidersFromLocalStorage(): Provider[] {
  try {
    const raw = localStorage.getItem(API_CONFIG_KEY);
    if (!raw) return [];
    const data = JSON.parse(raw);
    if (!data || !Array.isArray(data.providers)) return [];
    return data.providers as Provider[];
  } catch {
    return [];
  }
}

/**
 * 把 localStorage 中的供应商配置一次性同步到后端 DB。
 * - 跳过没 baseUrl / 没 apiKey 的 provider
 * - 单条失败不阻塞其他（best-effort）
 * - 完成后写迁移标志，避免重复入库
 */
export async function migrateLocalProvidersToBackend(): Promise<MigrationResult> {
  const result: MigrationResult = {
    attempted: 0,
    synced: 0,
    failed: [],
    skipped: 0,
  };
  if (typeof window === 'undefined') return result;
  if (hasMigrated()) return result;

  const providers = readProvidersFromLocalStorage();
  for (const p of providers) {
    const id = String(p.id || '').trim();
    const baseUrl = String(p.baseUrl || '').trim();
    if (!id || !baseUrl) {
      result.skipped += 1;
      continue;
    }
    const hasRealKey = !!(p.apiKey && String(p.apiKey).trim());
    if (!hasRealKey) {
      result.skipped += 1;
      continue;
    }
    result.attempted += 1;
    try {
      await api.upsertProvider(id, {
        name: p.name || id,
        base_url: baseUrl,
        api_key: String(p.apiKey),
        protocol: p.protocol || 'openai',
        enabled: p.enabled !== false,
        image_models: p.imageModels || [],
        chat_models: p.chatModels || [],
        video_models: p.videoModels || [],
        extra_config: {},
      });
      result.synced += 1;
    } catch (e: any) {
      result.failed.push({ id, reason: e?.message || 'sync failed' });
    }
  }
  markMigrated();
  return result;
}

/** 调试用：清除迁移标志（不常用）。 */
export function resetMediaMigrationFlag(): void {
  try {
    localStorage.removeItem(MEDIA_MIGRATION_KEY);
  } catch {
    /* ignore */
  }
}
