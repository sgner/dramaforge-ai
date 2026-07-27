/**
 * DramaForge AI 后端 API 客户端
 * 所有方法返回 Promise。后端地址通过 Vite proxy 转发到 localhost:8000。
 */
import type { Language } from '../types';

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
  /**
   * 连线附加数据（后端 Connection.data 列）。
   * 前端创建连线时若源节点是资产节点，会写入：
   *   { asset_ref, role: 'reference', from_asset_kind }
   * 后端 collect_canvas_references() 从此字段提取 asset_ref。
   */
  data?: Record<string, any>;
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
  status?: string;
  version?: number;
  source_asset_id?: string | null;
  derived_from?: string[];
  reference_role?: string | null;
  prompt_source?: string | null;
  prompt_optimized?: string | null;
  inspection_status?: string;
  inspection?: Record<string, any>;
  visual_identity?: Record<string, any>;
  reference_capabilities?: Record<string, any>;
  usage_count?: number;
  voice_id?: string | null;
  story_entity_id?: string | null;
  story_entity_name?: string | null;
  // 文本资产正文（小说/脚本）— 后端从 extra.body 提升
  body?: string | null;
  text_stats?: Record<string, any>;
  // 原始 extra（含 body/text_stats）
  extra_raw?: Record<string, any>;
  updated_at?: string;
}

export interface AgentTaskOut { /* moved up — kept for compat in case imported elsewhere */
  id: string;
  project_id?: string | null;
  user_goal: string;
  status: string;
  plan: any[];
  artifacts: Record<string, any>;
  pending_response?: any;
  pending_question?: any;
  task_profile?: Record<string, any> | null;
  rule_pack_version?: string | null;
  total_cost_usd: number;
  total_tokens: number;
  max_steps: number;
  skip_confirm: boolean;
  created_at: string;
  updated_at: string;
}

export interface AgentStepOut {
  id: string;
  task_id: string;
  step_number: number;
  thought?: string | null;
  action: { tool?: string; params?: any; [k: string]: any };
  observation: { success?: boolean; result?: any; error?: string; [k: string]: any };
  status: string;
  cost_usd: number;
  tokens: number;
  started_at?: string | null;
  finished_at?: string | null;
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
  identifyAsset: (assetId: string, payload: { asset_kind: string; name: string; story_entity_name?: string; voice_id?: string; extract_identity?: boolean }) =>
    request<{
      id: string; asset_kind: string; name: string;
      inspection_status: string; story_entity_id: string | null; voice_id?: string | null;
      visual_identity?: Record<string, string>;
    }>(`/assets/${assetId}/identify`, { method: 'POST', body: JSON.stringify(payload) }),
  getEntityImpact: (storyEntityId: string, projectId: string) =>
    request<{
      story_entity_id: string;
      impact: { asset_id: string; title: string; brief: string; url?: string | null; status?: string; created_at?: string | null }[];
      impacted_shots: number;
    }>(`/studio/entities/${encodeURIComponent(storyEntityId)}/impact?project_id=${encodeURIComponent(projectId)}`),

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

  continueConversation: (taskId: string, message: string) =>
    request<{ ok: boolean; task_id: string; status: string }>(`/agent/tasks/${taskId}/continue`, {
      method: 'POST',
      body: JSON.stringify({ message }),
    }),

  stopAgent: (taskId: string) =>
    request<{ ok: boolean; status: string }>(`/agent/tasks/${taskId}/stop`, { method: 'POST' }),

  retryAgent: (taskId: string, config?: { providerId?: string; modelId?: string }) =>
    request<{ ok: boolean; status: string }>(`/agent/tasks/${taskId}/retry`, {
      method: 'POST',
      body: JSON.stringify({
        llm_provider_id: config?.providerId ?? null,
        llm_model_id: config?.modelId ?? null,
      }),
    }),

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
      language?: Language;
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
        language: opts.language ?? 'en',
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

  verifyProvider: (providerId: string) =>
    request<{ ok: boolean; status: number; error?: string }>(`/providers/${encodeURIComponent(providerId)}/verify`, {
      method: 'POST',
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

  // ---------- LLM Generation (后端代理供应商调用) ----------
  // 与媒体生成同理：api_key 只存后端 DB，前端不直连供应商。
  // 提示词优化走这里，避免前端 store 里的空/脱敏 apiKey 导致上游 401"无效的令牌"。
  generateText: (payload: {
    provider_id: string;
    model: string;
    prompt: string;
    system_instruction?: string;
    temperature?: number;
    max_tokens?: number;
  }) =>
    request<{ text: string; provider_id: string; model: string }>('/llm/generate', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  // ---------- Studio (短剧工作室：整集异步生成) ----------
  // POST 立即返回 task_id（202），前端轮询 GET 直到 status !== 'running'。
  createStudioEpisode: (payload: StudioEpisodeCreatePayload) =>
    request<{ task_id: string }>('/studio/episodes', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  getStudioEpisode: (taskId: string) =>
    request<StudioEpisodeTaskOut>(`/studio/episodes/${encodeURIComponent(taskId)}`),

  listStudioCharacterCards: (projectId: string) =>
    request<StudioCharacterCardOut[]>(
      `/studio/character-cards?project_id=${encodeURIComponent(projectId)}`
    ),

  // 同步接口：vision LLM 从参考图提取身份指纹，可能较慢，调用方要给 loading 态。
  createStudioCharacterCard: (payload: StudioCharacterCardCreatePayload) =>
    request<StudioCharacterCardOut>('/studio/character-cards', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  // ---------- Studio 审片台（镜头人工审核 + 单镜头重生成） ----------
  listStudioShots: (projectId: string) =>
    request<StudioShotOut[]>(`/studio/shots?project_id=${encodeURIComponent(projectId)}`),

  reviewStudioShot: (assetId: string, action: StudioReviewAction, note?: string) =>
    request<StudioShotReviewOut>(`/studio/shots/${encodeURIComponent(assetId)}/review`, {
      method: 'POST',
      body: JSON.stringify(note ? { action, note } : { action }),
    }),

  // 同步接口，可能跑 1~2 分钟（编剧/美术/质检闭环），调用方要给 loading 态。
  regenerateStudioShot: (payload: StudioShotRegeneratePayload) =>
    request<StudioShotRegenerateOut>('/studio/shots/regenerate', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  // 导出选中镜头为 mp4（同步接口，调用方要给 loading 态）。
  createStudioExport: (payload: StudioExportCreatePayload) =>
    request<StudioExportOut>('/studio/export', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  // LLM 智能编排：给时间线资产排序并配时长/字幕（同步接口，无 LLM 配置时后端 400）。
  arrangeStudioAssets: (payload: StudioArrangePayload) =>
    request<StudioArrangeOut>('/studio/arrange', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  // 剪辑台时间线持久化（每项目一条，整体覆盖式保存）。
  getStudioTimeline: (projectId: string) =>
    request<StudioTimelineOut>(`/studio/timeline?project_id=${encodeURIComponent(projectId)}`),
  saveStudioTimeline: (projectId: string, items: StudioTimelineItemPayload[]) =>
    request<StudioTimelineOut>('/studio/timeline', {
      method: 'PUT',
      body: JSON.stringify({ project_id: projectId, items }),
    }),

  // ---------- Bootstrap (首屏合并端点) ----------
  // 合并 listDramaTasks + listProviders + getUserPreference('model_bindings')
  // 三个首屏请求为单个 /api/bootstrap，减少 RTT（3 → 1）。
  bootstrap: () =>
    request<BootstrapOut>('/bootstrap'),
};

/**
 * 画布图片节点的标准上传流程：返回 blob: URL 供即时预览，
 * 后台把文件上传到后端，成功后通过 onUploaded 回调替换成 /files/ 真实 URL。
 *
 * 背景：blob: URL 只存在于浏览器内存，后端生成时取不到图片内容——
 * 图生图/图生视频会把无法解析的引用丢弃，上游返 400"至少需要一张图片"。
 * 所以进入节点的图片必须落到后端 /files/。
 */
export const uploadImageWithPreview = (
  file: File,
  onUploaded: (backendUrl: string) => void,
): string => {
  const blobUrl = URL.createObjectURL(file);
  api.uploadImage(file)
    .then(({ url }) => {
      onUploaded(url);
      URL.revokeObjectURL(blobUrl);
    })
    .catch((e) => console.warn('[upload] image upload to backend failed, keeping blob URL', e));
  return blobUrl;
};

/**
 * GET /api/bootstrap 响应体。
 * 三个字段一一对应原 3 个端点的载荷。
 */
export interface BootstrapOut {
  /** DramaTask 列表（不含 deleted，与 GET /api/drama-tasks 等价）。 */
  tasks: DramaTaskApiOut[];
  /** Provider 列表（api_key 脱敏，与 GET /api/providers 等价）。 */
  providers: ProviderOut[];
  /** model_bindings 偏好（未设置时为 null）。 */
  modelBindings: any[] | null;
}

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

// ============ Prompt Templates ============
export interface PromptTemplateOut {
  id: string;
  name: string;
  category: string;
  scene: string;
  positive: string;
  negative: string;
  params: Record<string, string>;
  is_builtin: boolean;
  created_at: string;
  updated_at: string;
}

export const promptTemplates = {
  list: (category?: string) =>
    request<PromptTemplateOut[]>(
      category ? `/prompt-templates?category=${category}` : '/prompt-templates'
    ),
  get: (id: string) =>
    request<PromptTemplateOut>(`/prompt-templates/${id}`),
  create: (data: {
    name: string;
    category?: string;
    scene?: string;
    positive?: string;
    negative?: string;
    params?: Record<string, string>;
  }) =>
    request<PromptTemplateOut>('/prompt-templates', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  update: (id: string, data: Partial<PromptTemplateOut>) =>
    request<PromptTemplateOut>(`/prompt-templates/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),
  remove: (id: string) =>
    request<{ ok: boolean }>(`/prompt-templates/${id}`, { method: 'DELETE' }),
  batchRemove: (ids: string[]) =>
    request<{ removed: number }>('/prompt-templates/batch-delete', {
      method: 'POST',
      body: JSON.stringify({ ids }),
    }),
};

// ============ Studio (短剧工作室) ============
/** POST /api/studio/episodes 请求体。llm_* / character_card_ids / title 可选。 */
export interface StudioEpisodeCreatePayload {
  project_id: string;
  story_text: string;
  image_provider_id: string;
  image_model: string;
  llm_provider_id?: string;
  llm_model_id?: string;
  max_shots?: number;
  sec_per_image?: number;
  character_card_ids?: string[];
  title?: string;
}

/** 单个镜头的 agent 进度。 */
export interface StudioShotProgress {
  title: string;
  status: 'pending' | 'running' | 'approved' | 'max_rounds_exceeded';
  rounds: number;
}

/** GET /api/studio/episodes/{task_id} 响应体。 */
export interface StudioEpisodeTaskOut {
  task_id: string;
  status: 'running' | 'done' | 'partial' | 'failed' | 'error';
  progress: {
    phase: 'planning' | 'shooting' | 'exporting' | 'finished';
    current_shot: number;
    total_shots: number;
    shots: StudioShotProgress[];
  };
  result: null | {
    episode_asset_id: string;
    url: string;
    shots: any[];
    export: Record<string, any>;
  };
  error: null | string;
}

/** GET /api/studio/character-cards 响应项。 */
export interface StudioCharacterCardOut {
  card_id: string;
  name: string;
  identity: { face_anchor?: string; [k: string]: any };
  reference_asset_ids: string[];
  url?: string | null;
}

/** POST /api/studio/character-cards 请求体。reference_asset_ids 至少 1 个。 */
export interface StudioCharacterCardCreatePayload {
  project_id: string;
  name: string;
  reference_asset_ids: string[];
  llm_provider_id?: string;
  llm_model_id?: string;
}

// ============ Studio 审片台 ============
/** 人工审核动作：approve→approved，reject→rejected，lock→locked，unlock→pending_review。 */
export type StudioReviewAction = 'approve' | 'reject' | 'lock' | 'unlock';

export type StudioReviewStatus = 'pending_review' | 'approved' | 'rejected' | 'locked';

/** GET /api/studio/shots 响应项。同一 brief 的多个资产是同一镜头的多个版本。 */
export interface StudioShotOut {
  asset_id: string;
  brief: string;
  title: string;
  url: string;
  prompt: string;
  critic_status: 'approved' | 'max_rounds_exceeded' | null;
  review_status: StudioReviewStatus;
  review_note: string | null;
  /** 组内序号（1 起）。 */
  version: number;
  /** 组内版本总数。 */
  versions: number;
  created_at: string;
}

/** POST /api/studio/shots/{asset_id}/review 响应体。 */
export interface StudioShotReviewOut {
  asset_id: string;
  review_status: StudioReviewStatus;
  review_note: string | null;
}

/** POST /api/studio/shots/regenerate 请求体。 */
export interface StudioShotRegeneratePayload {
  project_id: string;
  asset_id: string;
  image_provider_id: string;
  image_model: string;
  llm_provider_id?: string;
  llm_model_id?: string;
  max_rounds?: number;
  /** 与 drama-task 脚本 bigShot 的显式关联（导演台断链修复） */
  bigshot_id?: string;
}

/** POST /api/studio/shots/regenerate 响应体（新资产 = 同 brief 新版本）。 */
export interface StudioShotRegenerateOut {
  status: string;
  asset_id: string;
  url: string;
  prompt: string;
  rounds: number;
  [k: string]: any;
}

/** POST /api/studio/export 请求体：把选中镜头资产合成 mp4。 */
export interface StudioExportCreatePayload {
  project_id: string;
  asset_ids: string[];
  sec_per_image?: number;
  /** 逐镜头秒数（与 asset_ids 等长）；给了就优先于 sec_per_image。 */
  durations?: number[];
  /** 逐镜头旁白（与 asset_ids 等长）；随导出资产登记，不再丢失。 */
  captions?: string[];
  title?: string;
}

/** GET/PUT /api/studio/timeline：剪辑台时间线持久化。 */
export interface StudioTimelineItemPayload {
  asset_id: string;
  sec: number;
  caption: string;
}

export interface StudioTimelineOut {
  project_id: string;
  items: StudioTimelineItemPayload[];
  updated_at?: string | null;
  dropped?: number;
}

/** POST /api/studio/arrange 请求体：LLM 智能编排时间线。 */
export interface StudioArrangePayload {
  project_id: string;
  asset_ids: string[];
  story_hint?: string;
  llm_provider_id?: string;
  llm_model_id?: string;
}

/** POST /api/studio/arrange 响应体（items 有序、完整覆盖输入资产）。 */
export interface StudioArrangeOut {
  items: { asset_id: string; sec: number; caption: string }[];
}

/** POST /api/studio/export 响应体。 */
export interface StudioExportOut {
  url: string;
  asset_id?: string;
  [k: string]: any;
}
