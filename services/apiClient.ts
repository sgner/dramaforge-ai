/**
 * DramaForge AI 后端 API 客户端
 * 所有方法返回 Promise。后端地址通过 Vite proxy 转发到 localhost:8000。
 */
const BASE = '/api';

async function request<T = any>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const url = `${BASE}${path}`;
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`API ${res.status} ${res.statusText}: ${text}`);
  }
  // 204 / 空 body
  const ct = res.headers.get('content-type') || '';
  if (!ct.includes('application/json')) return undefined as any;
  return res.json();
}

// ============ Project ============
export interface ProjectOut {
  id: string;
  name: string;
  created_at: string;
  updated_at: string;
  viewport: { x: number; y: number; scale: number };
}

export interface NodeOut {
  id: string;
  type: string;
  x: number;
  y: number;
  w: number;
  h: number;
  data: Record<string, any>;
}

export interface ConnectionOut {
  id: string;
  from_node: string;
  to_node: string;
  from_port: string;
  to_port: string;
}

export interface AssetOut {
  id: string;
  project_id?: string | null;
  kind: string;
  asset_kind?: string | null;
  title: string;
  name: string;
  url?: string | null;
  prompt?: string | null;
  provider_id?: string | null;
  provider_name?: string | null;
  model_id?: string | null;
  failed: boolean;
  error?: string | null;
  generating: boolean;
  extra: Record<string, any>;
  created_at: string;
}

export interface ProjectSnapshot {
  project: ProjectOut;
  nodes: NodeOut[];
  connections: ConnectionOut[];
  assets: AssetOut[];
}

export const api = {
  // ---------- Health ----------
  health: () => request<{ status: string }>('/health'),

  // ---------- Projects ----------
  listProjects: () => request<ProjectOut[]>('/projects'),
  createProject: (name: string) =>
    request<ProjectOut>('/projects', { method: 'POST', body: JSON.stringify({ name }) }),
  getSnapshot: (projectId: string) =>
    request<ProjectSnapshot>(`/projects/${projectId}`),
  updateProject: (projectId: string, payload: { name?: string; viewport?: { x: number; y: number; scale: number } }) =>
    request<ProjectOut>(`/projects/${projectId}`, { method: 'PATCH', body: JSON.stringify(payload) }),
  deleteProject: (projectId: string) =>
    request<{ ok: boolean }>(`/projects/${projectId}`, { method: 'DELETE' }),

  saveNodes: (projectId: string, nodes: NodeOut[]) =>
    request<{ ok: boolean; count: number }>(`/projects/${projectId}/nodes`, {
      method: 'PUT',
      body: JSON.stringify({ nodes }),
    }),

  saveConnections: (projectId: string, connections: ConnectionOut[]) =>
    request<{ ok: boolean; count: number }>(`/projects/${projectId}/connections`, {
      method: 'PUT',
      body: JSON.stringify({ connections }),
    }),

  // ---------- Assets ----------
  listAssets: (projectId?: string) => {
    const q = projectId ? `?project_id=${encodeURIComponent(projectId)}` : '';
    return request<AssetOut[]>(`/assets${q}`);
  },
  createAsset: (payload: Partial<AssetOut> & { kind: string }) =>
    request<AssetOut>('/assets', { method: 'POST', body: JSON.stringify(payload) }),
  updateAsset: (assetId: string, payload: Partial<AssetOut>) =>
    request<AssetOut>(`/assets/${assetId}`, { method: 'PATCH', body: JSON.stringify(payload) }),
  deleteAsset: (assetId: string) =>
    request<{ ok: boolean }>(`/assets/${assetId}`, { method: 'DELETE' }),
  rebuildAssets: (projectId: string) =>
    request<{ ok: boolean; created: number }>(`/assets/rebuild-from-nodes/${projectId}`, { method: 'POST' }),

  // ---------- Uploads ----------
  uploadImage: async (file: File): Promise<{ url: string; filename: string; size: number }> => {
    const fd = new FormData();
    fd.append('file', file);
    const res = await fetch(`${BASE}/uploads/image`, { method: 'POST', body: fd });
    if (!res.ok) throw new Error(`Upload failed: ${res.status}`);
    return res.json();
  },
};
