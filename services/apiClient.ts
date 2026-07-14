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

export interface AgentTaskOut { /* moved up — kept for compat in case imported elsewhere */
  id: string;
  project_id?: string | null;
  user_goal: string;
  status: string;
  plan: any[];
  artifacts: Record<string, any>;
  pending_response?: any;
  total_cost_usd: number;
  total_tokens: number;
  max_steps: number;
  skip_confirm: boolean;
  created_at: string;
  updated_at: string;
}

export interface AgentStepOut { /* moved up — kept for compat */
  id: string;
  task_id: string;
  step_number: number;
  tool_name: string;
  tool_params?: any;
  observation?: any;
  thought?: string;
  status: string;
  error?: string;
  cost_usd: number;
  duration_sec: number;
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
  createProjectWithId: (projectId: string, name: string = 'Untitled') =>
    request<ProjectOut>('/projects', { method: 'POST', body: JSON.stringify({ id: projectId, name }) }),
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

  // ---------- Agent ----------
  createAgentTask: (payload: {
    project_id: string;
    user_goal: string;
    max_steps?: number;
    skip_confirm?: boolean;
  }) =>
    request<AgentTaskOut>('/agent/tasks', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  getAgentTask: (taskId: string) =>
    request<AgentTaskOut>(`/agent/tasks/${taskId}`),

  listAgentSteps: (taskId: string) =>
    request<AgentStepOut[]>(`/agent/tasks/${taskId}/steps`),

  respondAgent: (taskId: string, payload: {
    response: string;
    approved?: boolean;
    /** Spec B: 工具失败恢复决策 (retry / change_model / skip) */
    recovery_action?: 'retry' | 'change_model' | 'skip';
    /** Spec B: 换模型时的新 model id */
    new_model_id?: string | null;
  }) =>
    request<{ ok: boolean }>(`/agent/tasks/${taskId}/respond`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  pauseAgent: (taskId: string) =>
    request<{ ok: boolean }>(`/agent/tasks/${taskId}/pause`, { method: 'POST' }),

  resumeAgent: (taskId: string) =>
    request<{ ok: boolean }>(`/agent/tasks/${taskId}/resume`, { method: 'POST' }),

  /**
   * 启动 agent task：创建任务 → 返回 taskId。
   * 实际运行由前端调用 useAgentStream(taskId) 接收 SSE 事件。
   */
  startAgent: (
    projectId: string,
    userGoal: string,
    opts: {
      skip_confirm?: boolean;
      max_steps?: number;
      providerId?: string;
      modelId?: string;
    } = {}
  ) =>
    request<AgentTaskOut>('/agent/tasks', {
      method: 'POST',
      body: JSON.stringify({
        project_id: projectId,
        user_goal: userGoal,
        max_steps: opts.max_steps ?? 50,
        skip_confirm: opts.skip_confirm ?? false,
        // 仅传 provider_id / model_id；API key 走后端 env
        llm_provider_id: opts.providerId ?? null,
        llm_model_id: opts.modelId ?? null,
      }),
    }),

  listAgentTools: () =>
    request<{ name: string; description: string; category: string; requires_approval: boolean }[]>(
      '/agent/tools'
    ),

  listAgentTasks: (projectId?: string) => {
    const q = projectId ? `?project_id=${encodeURIComponent(projectId)}` : '';
    return request<AgentTaskOut[]>(`/agent/tasks${q}`);
  },

  // ---------- Providers (统一 endpoint, Plan 5) ----------
  // 合并 /api/llm-providers + /api/media-providers 为 /api/providers
  listProviders: () =>
    request<ProviderOut[]>('/providers'),

  getProvider: (providerId: string) =>
    request<ProviderOut>(`/providers/${encodeURIComponent(providerId)}`),

  upsertProvider: (
    providerId: string,
    payload: {
      name?: string;
      base_url: string;
      api_key?: string;        // 传空字符串或不传 → 保留 DB 原 key
      default_model?: string;
      protocol?: string;
      enabled?: boolean;
      chat_models?: string[];
      image_models?: string[];
      video_models?: string[];
      extra_config?: Record<string, any>;
    }
  ) =>
    request<ProviderOut>(`/providers/${encodeURIComponent(providerId)}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),

  deleteProvider: (providerId: string) =>
    request<{ deleted: string }>(`/providers/${encodeURIComponent(providerId)}`, {
      method: 'DELETE',
    }),

  // ---------- DramaTask (项目/任务) ----------
  // 替代前端 localStorage 的 dramaforge_tasks 持久化。
  // 整个 DramaTask 的所有字段（characters/bigShots/...）打包在 data 字段里。
  listDramaTasks: (opts: { includeDeleted?: boolean } = {}) => {
    const q = opts.includeDeleted ? '?include_deleted=true' : '';
    return request<DramaTaskApiOut[]>(`/drama-tasks${q}`);
  },
  getDramaTask: (taskId: string) =>
    request<DramaTaskApiOut>(`/drama-tasks/${encodeURIComponent(taskId)}`),
  /** 整体写入：name + 完整 data。id 不存在则创建。 */
  upsertDramaTask: (taskId: string, payload: { name?: string; deleted?: boolean; data: Record<string, any> }) =>
    request<DramaTaskApiOut>(`/drama-tasks/${encodeURIComponent(taskId)}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),
  /** 局部更新：data 走 deep-merge（不会覆盖未提供的 pipeline 字段）。 */
  patchDramaTask: (taskId: string, payload: { name?: string; deleted?: boolean; data?: Record<string, any> }) =>
    request<DramaTaskApiOut>(`/drama-tasks/${encodeURIComponent(taskId)}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),
  deleteDramaTask: (taskId: string) =>
    request<{ ok: boolean; deleted: string }>(`/drama-tasks/${encodeURIComponent(taskId)}`, {
      method: 'DELETE',
    }),

  // ---------- UserPreference (用户偏好) ----------
  // 替代散落在 localStorage 的小数据：language / current_canvas_id /
  // deleted_canvas_ids / canvas_emoji / step_bindings。
  getUserPreference: (key: string) =>
    request<UserPreferenceItem>(`/user-preferences/${encodeURIComponent(key)}`),
  setUserPreference: (key: string, value: any) =>
    request<UserPreferenceItem>(`/user-preferences/${encodeURIComponent(key)}`, {
      method: 'PUT',
      body: JSON.stringify({ value }),
    }),
  batchSetUserPreferences: (items: Record<string, any>) =>
    request<UserPreferenceItem[]>(`/user-preferences/_batch`, {
      method: 'POST',
      body: JSON.stringify({ items }),
    }),

  // ---------- Media Generation (后端代理供应商调用) ----------
  // 取代前端直连供应商。所有图片/视频由后端用 DB 里的 api_key 调。
  generateImage: (payload: {
    provider_id: string;
    model: string;
    prompt: string;
    ref_urls?: string[];
    aspect_ratio?: string;
    extra?: Record<string, any>;
  }) =>
    request<{ url: string; provider_id: string; model: string; raw: any }>('/media/generate/image', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  generateVideo: (payload: {
    provider_id: string;
    model: string;
    prompt: string;
    ref_urls?: string[];
    aspect_ratio?: string;
    duration_sec?: number;
    extra?: Record<string, any>;
  }) =>
    request<{ url: string; provider_id: string; model: string; raw: any }>('/media/generate/video', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
};

// ============ Provider (统一 endpoint, Plan 5) ============
/**
 * 后端 Pydantic ProviderOut schema（Plan 5 统一 endpoint）。
 * 字段顺序与 backend/app/routers/providers.py:ProviderOut 一致。
 */
export interface ProviderOut {
  id: number;
  provider_id: string;
  name: string;
  base_url: string;
  api_key: string;       // 后端已脱敏（仅前 4 + 后 4）
  default_model: string;
  protocol: string;
  enabled: boolean;
  chat_models: string[];
  image_models: string[];
  video_models: string[];
  extra_config: Record<string, any>;
  has_key: boolean;
  key_preview: string;
  created_at?: string;
  updated_at?: string;
}

// ============ DramaTask (替代 localStorage 的 dramaforge_tasks) ============
/**
 * 后端 DramaTaskOut — 整个 DramaTask 在 data 字段里。
 * 前端拿到后直接 setTasks([...data, ...]) 即可。
 */
export interface DramaTaskApiOut {
  id: string;
  name: string;
  deleted: boolean;
  data: Record<string, any>;
  created_at?: string;
  updated_at?: string;
}

// ============ UserPreference (替代散落的 localStorage) ============
export interface UserPreferenceItem {
  key: string;
  value: any;
  updated_at?: string;
}
