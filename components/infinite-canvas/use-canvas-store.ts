import React from 'react';
import { create } from 'zustand';
import {
  CanvasNode,
  Connection,
  Viewport,
  CanvasTheme,
  UndoState,
  UNDO_MAX,
  uid,
  DEFAULT_NODE_SIZES,
  TaskAssetRef,
  TaskAssetKind,
} from './types';
import {
  ApiConfig,
  DEFAULT_PROVIDERS,
  ModelConfig,
  Provider,
  ArtStyle,
  Language,
  getProviderForStep,
  getModelForStep,
  normalizeModelBindings,
} from '../../types';
import { generateCharacterDesign, generateStoryboardImage, generatePropImage, generateImageDirect } from '../../services/mediaService';
import { estimatedNodeRect } from './engine';
import { expandIdeaToStory, generateScriptFromNovel, optimizeSoraPromptViaBackend } from '../../services/llmClient';
import { getT } from '../../i18n';
import { api, type NodeOut, type ConnectionOut, type AssetOut } from '../../services/apiClient';

type AgentEventLite = { type: string; payload?: Record<string, any>; timestamp?: number };
type ArtifactLite = { id: string; kind?: string; asset_kind?: string; name?: string; url?: string; [k: string]: any };
type QuestionLite = { question: string; options?: string[]; [k: string]: any };

export type NodeRenderer = (node: CanvasNode) => React.ReactNode;

const pipelineAbortControllers = new Map<string, AbortController>();

/**
 * 计算文本统计：字数、章节数、场数。
 * - 章节：以 "## " 开头（markdown H2 风格）
 * - 场：以 "第X场" 或 "场景" 开头
 * - 字数：所有 CJK 字符 + 非空白拉丁词
 */
export function computeTextStats(body: string | undefined | null): { words: number; chapters: number; scenes: number } {
  if (!body) return { words: 0, chapters: 0, scenes: 0 };
  // CJK 字符数
  const cjk = (body.match(/[\u4e00-\u9fff]/g) || []).length;
  // 非空白 ASCII 词（每连续非空白算一个词）
  const nonCjk = body.replace(/[\u4e00-\u9fff]/g, ' ');
  const asciiWords = (nonCjk.match(/\S+/g) || []).length;
  const words = cjk + asciiWords;
  const chapters = (body.match(/^#{1,3}\s+/gm) || []).length;
  const scenes = (body.match(/(^|\n)\s*(第[一二三四五六七八九十百零0-9]+场|场景[一二三四五六七八九十百零0-9]*[：:.\s]|【场\d+】)/g) || []).length;
  return { words, chapters, scenes };
}

/** Return all image references feeding a generation node, preserving edge order. */
export function connectedImageUrls(nodes: CanvasNode[], connections: Connection[], targetId: string): string[] {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  return connections
    .filter((connection) => connection.to === targetId)
    .map((connection) => byId.get(connection.from))
    .filter((node): node is CanvasNode => node?.type === 'image' && typeof node.url === 'string' && node.url.trim().length > 0)
    .map((node) => node.url!.trim());
}

/**
 * 为「弹层手选模型」构造一次性模型配置。
 * 当用户在 Composer 弹层里选择了 provider+model、但全局 modelBindings 未配置
 * 对应步骤的模型绑定时，getModelForStep 会返回 null —— 此时用该兜底配置，
 * 而不是直接抛 canvasPanelRetryNoProvider。
 */
function buildEphemeralImageModel(providerId: string, modelName: string): ModelConfig {
  return {
    id: modelName,
    providerId,
    modelName,
    displayName: modelName,
    apiPath: '/images/generations',
    apiFormat: 'openai-image',
    customHeaders: '',
    customBodyTemplate: '',
    customResponsePath: '',
    pollApiPath: '',
    enabled: true,
  };
}

/**
 * Load the canvas state (nodes, connections, viewport, theme) from the backend
 * snapshot for the given project. Returns null if no project is open.
 */
async function loadFromBackend(projectId?: string): Promise<Partial<CanvasStore> | null> {
  if (!projectId) return null;
  try {
    const snap = await api.getSnapshot(projectId);
    return {
      nodes: snap.nodes.map(toCanvasNode),
      connections: snap.connections.map(toConnection),
      viewport: {
        x: snap.project.viewport.x,
        y: snap.project.viewport.y,
        scale: snap.project.viewport.scale / 100,
      },
      taskAssets: snap.assets.map(toTaskAssetRef),
    };
  } catch (e: any) {
    if (e && /404/.test(e.message || '')) {
      try {
        await api.createProjectWithId(projectId);
        return { nodes: [], connections: [], viewport: { x: -1800, y: -1000, scale: 1 }, taskAssets: [] };
      } catch (createErr) {
        console.warn('[dramaforge] backend auto-create project failed:', createErr);
        return null;
      }
    }
    console.warn('[dramaforge] backend load failed:', e);
    return null;
  }
}

function toCanvasNode(n: NodeOut): CanvasNode {
  return {
    id: n.id,
    type: n.type as any,
    x: n.x,
    y: n.y,
    w: n.w,
    h: n.h,
    ...n.data,
  } as CanvasNode;
}

function fromCanvasNode(n: CanvasNode): NodeOut {
  const { id, type, x, y, w, h, ...rest } = n as any;
  return { id, type, x, y, w, h, data: rest };
}

function toConnection(c: ConnectionOut): Connection {
  return { id: c.id, from: c.from_node, to: c.to_node, fromPort: c.from_port, toPort: c.to_port };
}

function fromConnection(c: Connection): ConnectionOut {
  return { id: c.id, from_node: c.from, to_node: c.to, from_port: c.fromPort, to_port: c.toPort };
}

function toTaskAssetRef(a: AssetOut): TaskAssetRef {
  return {
    id: a.id,
    kind: (a.asset_kind || 'image') as TaskAssetKind,
    title: a.title,
    name: a.name,
    url: a.url || '',
    prompt: a.prompt || '',
    providerId: a.provider_id || undefined,
    providerName: a.provider_name || undefined,
    modelId: a.model_id || undefined,
    failed: a.failed,
    error: a.error || undefined,
    generating: a.generating,
    status: a.status || undefined,
    version: a.version || undefined,
    sourceAssetId: a.source_asset_id || undefined,
    derivedFrom: a.derived_from || [],
    referenceRole: a.reference_role || undefined,
    promptSource: a.prompt_source || undefined,
    promptOptimized: a.prompt_optimized || undefined,
    inspectionStatus: a.inspection_status || undefined,
    // 文本资产正文（后端从 extra.body 提升到顶层）
    body: a.body || undefined,
    textStats: a.text_stats || undefined,
    // 关键：透传后端 extra 字段，ScriptNodeBody 需要从 extra.script 读结构化 JSON。
    // 之前这个字段丢失导致 ScriptNodeBody 永远拿到空数据（角色/道具/场景/分镜 全 0）。
    extra: (a as any).extra || undefined,
  } as TaskAssetRef;
}

function fromTaskAssetRef(r: TaskAssetRef, projectId?: string): Partial<AssetOut> & { kind: string } {
  // 把 body / textStats 塞进 extra（后端存到 extra 字段）
  const extra: Record<string, any> = {};
  if (r.body) extra.body = r.body;
  if (r.textStats) extra.text_stats = r.textStats;
  return {
    id: r.id,
    project_id: projectId,
    kind: r.kind === 'novel' || r.kind === 'script' ? 'text' : (r.kind === 'storyboard' ? 'image' : 'image'),
    asset_kind: r.kind,
    title: r.title,
    name: (r as any).name || r.title,
    url: r.url,
    prompt: r.prompt,
    provider_id: r.providerId,
    provider_name: r.providerName,
    model_id: r.modelId,
    failed: !!r.failed,
    error: r.error,
    generating: !!r.generating,
    status: r.status,
    version: r.version,
    source_asset_id: r.sourceAssetId,
    derived_from: r.derivedFrom,
    reference_role: r.referenceRole,
    prompt_source: r.promptSource,
    prompt_optimized: r.promptOptimized,
    inspection_status: r.inspectionStatus,
    body: r.body,
    text_stats: r.textStats,
    extra,
  };
}

// —— 保存定时器：per-project（Map<projectId, timer>）——
// 切项目时不得 clearTimeout 掉其他项目的 pending 保存，否则旧项目最后 600ms 的编辑会丢。
const saveNodesTimers = new Map<string, ReturnType<typeof setTimeout>>();
const saveConnTimers = new Map<string, ReturnType<typeof setTimeout>>();
const saveViewTimers = new Map<string, ReturnType<typeof setTimeout>>();

// —— loadProject 竞态 / hydrate 窗口守卫 ——
// loadProjectSeq：单调递增的请求序号，异步返回时校验，丢弃过期项目的加载结果。
// hydratingProjectId：从 loadProject 清空画布到 loadFromBackend 完成期间，
// 订阅保存逻辑不得把该项目的（空）nodes 覆盖保存到后端；失败路径同样解除守卫。
let loadProjectSeq = 0;
let hydratingProjectId: string | null = null;

function scheduleSaveNodes(projectId: string, nodes: CanvasNode[]) {
  if (hydratingProjectId === projectId) return; // hydrate 窗口内不保存，防止空数组覆盖后端
  const prev = saveNodesTimers.get(projectId);
  if (prev) clearTimeout(prev);
  saveNodesTimers.set(projectId, setTimeout(() => {
    saveNodesTimers.delete(projectId);
    api.saveNodes(projectId, nodes.map(fromCanvasNode)).catch((e) => console.warn('[dramaforge] saveNodes failed', e));
  }, 600));
}

function scheduleSaveConnections(projectId: string, conns: Connection[]) {
  if (hydratingProjectId === projectId) return;
  const prev = saveConnTimers.get(projectId);
  if (prev) clearTimeout(prev);
  saveConnTimers.set(projectId, setTimeout(() => {
    saveConnTimers.delete(projectId);
    api.saveConnections(projectId, conns.map(fromConnection)).catch((e) => console.warn('[dramaforge] saveConnections failed', e));
  }, 600));
}

function scheduleSaveViewport(projectId: string, viewport: Viewport) {
  if (hydratingProjectId === projectId) return;
  const prev = saveViewTimers.get(projectId);
  if (prev) clearTimeout(prev);
  saveViewTimers.set(projectId, setTimeout(() => {
    saveViewTimers.delete(projectId);
    api.updateProject(projectId, { viewport: { x: viewport.x, y: viewport.y, scale: Math.round(viewport.scale * 100) } })
      .catch((e) => console.warn('[dramaforge] saveViewport failed', e));
  }, 800));
}

async function syncAssetCreate(r: TaskAssetRef, projectId?: string): Promise<TaskAssetRef> {
  try {
    const created = await api.createAsset({ ...fromTaskAssetRef(r, projectId) });
    return { ...r, id: created.id };
  } catch (e) {
    console.warn('[dramaforge] syncAssetCreate failed', e);
    return r;
  }
}
async function syncAssetUpdate(r: TaskAssetRef): Promise<void> {
  try {
    await api.updateAsset(r.id, fromTaskAssetRef(r));
  } catch (e) {
    console.warn('[dramaforge] syncAssetUpdate failed', e);
  }
}
async function syncAssetDelete(id: string): Promise<void> {
  try {
    await api.deleteAsset(id);
  } catch (e) {
    console.warn('[dramaforge] syncAssetDelete failed', e);
  }
}

function rebuildTaskAssetsFromNodes(nodes: CanvasNode[]): TaskAssetRef[] {
  const tagMap: Record<string, string> = {
    character: 'assetTagCharacter',
    prop: 'assetTagProp',
    scene: 'assetTagBackground',
    storyboard: 'assetTagStoryboard',
    novel: 'canvasPanelAssetsNovel',
    script: 'canvasPanelAssetsScript',
  };
  const t = getT();
  const refs: TaskAssetRef[] = [];
  for (const n of nodes) {
    const kind = n._assetKind as string | undefined;
    if (!kind) continue;
    const tagKey = tagMap[kind] || '';
    const tagLabel = tagKey ? t(tagKey) : kind;
    const isText = kind === 'novel' || kind === 'script';
    refs.push({
      id: n.id,
      kind: kind as TaskAssetKind,
      name: (n.title || n.name || '') as string,
      url: n.url || '',
      tags: n._assetFailed ? [tagLabel, t('canvasPanelAssetTagFailed')] : [tagLabel],
      prompt: n._assetPrompt as string | undefined,
      providerId: n._assetProviderId as string | undefined,
      providerName: n._assetProviderName as string | undefined,
      modelId: n._assetModelId as string | undefined,
      generating: false,
      failed: n._assetFailed as boolean | undefined,
      error: n._assetError as string | undefined,
      status: n._assetStatus as string | undefined,
      version: typeof n._assetVersion === 'number' ? n._assetVersion : undefined,
      sourceAssetId: n._assetSourceAssetId as string | undefined,
      derivedFrom: Array.isArray(n._assetDerivedFrom) ? (n._assetDerivedFrom as string[]) : undefined,
      referenceRole: n._assetReferenceRole as string | undefined,
      promptSource: n._assetPromptSource as string | undefined,
      promptOptimized: n._assetPromptOptimized as string | undefined,
      inspectionStatus: n._assetInspectionStatus as string | undefined,
      ...(isText ? {} : {}),
    });
  }
  return refs;
}

const API_CONFIG_KEY = 'dramaforge-canvas-api-config';

function loadApiConfig(): ApiConfig {
  try {
    const raw = localStorage.getItem(API_CONFIG_KEY);
    if (!raw) return createDefaultApiConfig();
    const data = JSON.parse(raw);
    if (data && data.providers && (data.modelBindings || data.stepBindings)) {
      // Migrate old format: ensure providers have all fields
      data.providers = data.providers.map((p: any) => ({
        id: p.id || '',
        name: p.name || p.id || '',
        baseUrl: p.baseUrl || p.base_url || '',
        protocol: p.protocol || 'openai',
        enabled: p.enabled !== false,
        apiKey: p.apiKey || p.api_key || '',
        imageModels: p.imageModels || p.image_models || [],
        chatModels: p.chatModels || p.chat_models || [],
        videoModels: p.videoModels || p.video_models || [],
        hasKey: p.hasKey || p.has_key || false,
        keyPreview: p.keyPreview || p.key_preview || '',
        extraConfig: p.extraConfig || p.extra_config || {},
        walletApiKey: p.walletApiKey || '',
        hasWalletKey: p.hasWalletKey || false,
        walletKeyPreview: p.walletKeyPreview || '',
        volcengineAccessKeyId: p.volcengineAccessKeyId || '',
        volcengineSecretAccessKey: p.volcengineSecretAccessKey || '',
        hasVolcengineAccessKey: p.hasVolcengineAccessKey || false,
        volcengineAccessKeyPreview: p.volcengineAccessKeyPreview || '',
        hasVolcengineSecretKey: p.hasVolcengineSecretKey || false,
        volcengineSecretKeyPreview: p.volcengineSecretKeyPreview || '',
        volcengineProjectName: p.volcengineProjectName || 'default',
        volcengineRegion: p.volcengineRegion || 'cn-beijing',
      }));
      return normalizeModelBindings(data);
    }
    return createDefaultApiConfig();
  } catch {
    return createDefaultApiConfig();
  }
}

function saveApiConfig(config: ApiConfig) {
  try {
    localStorage.setItem(API_CONFIG_KEY, JSON.stringify(config));
  } catch {
    // localStorage full or unavailable
  }
}

/* ========================
 * File-scope imports.
 * `hydrateFromBackend` and other store actions call these directly.
 * ======================== */
// 在文件作用域内导入（hydrateFromBackend 等 store action 内部要直接调用）
import {
  migrateLocalProvidersToBackend as _migrateLocalProvidersToBackend,
  migrateLocalProvidersToBackendForce,
  resetMediaMigrationFlag,
  getLocalProvidersSnapshot,
  type MigrationResult,
} from '../../services/mediaProviderMigration';
// 保留旧 re-export（InfiniteCanvas 等外部模块 import 'use-canvas-store' 时要用）
export {
  _migrateLocalProvidersToBackend as migrateLocalProvidersToBackend,
  migrateLocalProvidersToBackendForce,
  resetMediaMigrationFlag,
  getLocalProvidersSnapshot,
};

// 重新导出 TaskAssetRef / TaskAssetKind，方便外部直接 `import { TaskAssetRef } from './use-canvas-store'`
export type { TaskAssetRef, TaskAssetKind } from './types';

function createDefaultApiConfig(): ApiConfig {
  return {
    providers: DEFAULT_PROVIDERS.map(p => ({
      ...p,
      imageModels: [...p.imageModels],
      chatModels: [...p.chatModels],
      videoModels: [...p.videoModels],
    })),
    modelBindings: normalizeModelBindings({ providers: DEFAULT_PROVIDERS }).modelBindings,
  };
}

const savedApiConfig = loadApiConfig();

interface CanvasStore {
  nodes: CanvasNode[];
  connections: Connection[];
  viewport: Viewport;
  selected: Set<string>;
  theme: CanvasTheme;
  undoStack: UndoState[];
  assetPanelOpen: boolean;
  composerOpen: boolean;
  apiConfig: ApiConfig;
  projectId: string | null;
  taskAssets: TaskAssetRef[];

  // 文本阅读器状态：当前打开的资产（null = 关闭）
  textReaderAsset: TaskAssetRef | null;
  textReaderInitialMode: 'read' | 'edit';

  // Cascade run state
  cascadeRunning: boolean;
  cascadeRunPath: string[];
  cascadeNodeStatus: Map<string, 'queued' | 'running' | 'done' | 'failed'>;

  addNode: (node: CanvasNode) => void;
  removeNodes: (ids: string[]) => void;
  updateNode: (id: string, updates: Partial<CanvasNode>) => void;
  moveNode: (id: string, x: number, y: number) => void;
  resizeNode: (id: string, w: number, h: number) => void;

  addConnection: (from: string, to: string) => void;
  removeConnection: (id: string) => void;

  setViewport: (viewport: Viewport) => void;
  setTheme: (theme: CanvasTheme) => void;

  select: (ids: string[], additive?: boolean) => void;
  clearSelection: () => void;
  toggleSelect: (id: string) => void;

  pushUndo: () => void;
  performUndo: () => void;

  copySelected: () => void;
  pasteNodes: (point: { x: number; y: number }) => void;
  clipboard: CanvasNode[];

  groupSelectedNodes: () => void;
  toggleAssetPanel: () => void;
  toggleComposer: () => void;

  setApiConfig: (config: ApiConfig) => void;
  setTaskAssets: (assets: TaskAssetRef[]) => void;

  /**
   * 打开文本阅读器（小说/脚本）。
   * - 传入 TaskAssetRef 时，从 taskAssets 中查最新 body（因为可能被其它路径更新过）
   * - 传入虚拟资产（仅存在于 node 中）时，直接用传入的 body
   */
  openTextReader: (asset: TaskAssetRef, initialMode?: 'read' | 'edit') => void;
  closeTextReader: () => void;

  /**
   * 更新文本资产（小说/脚本）的正文。
   * 同时持久化到后端（PUT /api/assets/{id}，body + text_stats）。
   * 如果传入 asset.body / textStats，会被存到 extra.body / extra.text_stats。
   */
  updateTextAssetBody: (assetId: string, body: string) => Promise<void>;

  /**
   * 从后端拉取 providers，merge 进 store 的 apiConfig。
   * - 后端有数据 → 用后端（保留 store 中已存在的明文 apiKey，避免把脱敏值写回）
   * - 后端为空 + localStorage 有 → 强制迁移 + 重新拉取 + merge localStorage 兜底
   * - 任何环节失败 → 不抛错，返回 false；调用方继续用 store 当前状态
   *
   * 用于：
   *   1) InfiniteCanvas 挂载时（与 migrateLocalProvidersToBackend 并行）
   *   2) handleSaveConfig 失败后的重试场景
   *   3) 任何需要从后端重新同步 provider 状态的入口
   */
  hydrateFromBackend: () => Promise<boolean>;

  // Cascade run actions
  startCascadeRun: (path: string[]) => void;
  updateCascadeNodeStatus: (nodeId: string, status: 'queued' | 'running' | 'done' | 'failed') => void;
  stopCascadeRun: () => void;

  // Video generation action
  runVideoGeneration: (nodeId: string, params: {
    prompt: string;
    providerId: string;
    modelId: string;
    inputImageUrls: string[];
    aspectRatio?: string;
    duration?: string;
  }) => Promise<void>;

  runPipeline: (nodeId: string, params: {
    inputText: string;
    sourceType: 'novel' | 'idea';
    style: ArtStyle;
    language: Language;
  }) => Promise<void>;

  stopPipeline: (nodeId: string) => void;

  retryFailedAsset: (taskAssetId: string, customPrompt?: string) => Promise<void>;

  /**
   * 图生图：以上传/已生成图片节点自身的 url 为参考图，生成结果写到右侧新建的
   * 图片节点（并自动连线），不覆盖源节点。新节点创建时即带 _pending loading
   * 状态；失败时写入 _assetFailed/_assetError 以显示错误占位。
   */
  runImageToImage: (sourceNodeId: string, params: {
    prompt: string;
    providerId: string;
    modelId: string;
    aspectRatio?: string;
  }) => Promise<void>;

  setNodes: (nodes: CanvasNode[]) => void;
  setConnections: (connections: Connection[]) => void;
  reset: () => void;
  loadProject: (projectId: string) => void;

  nodeOverrides: Record<string, { dx: number; dy: number }>;
  addAgentNodes: (input: {
    userGoal: string;
    plan: any[];
    actions: AgentEventLite[];
    observations: AgentEventLite[];
    artifacts: Record<string, ArtifactLite[]>;
    pendingQuestion: QuestionLite | null;
    status?: string;
  }) => void;
  clearAgentNodes: () => void;

  /** Fits agent-added nodes to the current viewport: computes bounds over all agent_node entries plus padding, then animates the viewport to encompass them. */
  fitAgentView: (boardW: number, boardH: number) => void;
}

export const useCanvasStore = create<CanvasStore>((set, get) => ({
  nodes: [],
  connections: [],
  viewport: { x: -1800, y: -1000, scale: 1 },
  selected: new Set(),
  theme: 'light',
  undoStack: [],
  clipboard: [],
  assetPanelOpen: false,
  composerOpen: false,
  apiConfig: savedApiConfig,
  projectId: null,
  taskAssets: [],
  textReaderAsset: null,
  textReaderInitialMode: 'read',
  cascadeRunning: false,
  cascadeRunPath: [],
  cascadeNodeStatus: new Map(),
  nodeOverrides: {},

  addNode: (node) =>
    set((s) => ({ nodes: [...s.nodes, node] })),

  removeNodes: (ids) =>
    set((s) => {
      const idSet = new Set(ids);
      const toDelete = new Set<string>();
      const collect = (id: string) => {
        if (toDelete.has(id)) return;
        toDelete.add(id);
        const n = s.nodes.find((x) => x.id === id);
        if (n && (n.type === 'group' || n.type === 'promptGroup')) {
          (n.items || []).forEach(collect);
        }
      };
      ids.forEach(collect);
      return {
        nodes: s.nodes.filter((n) => !toDelete.has(n.id)),
        connections: s.connections.filter(
          (c) => !toDelete.has(c.from) && !toDelete.has(c.to)
        ),
        selected: new Set([...s.selected].filter((id) => !toDelete.has(id))),
      };
    }),

  updateNode: (id, updates) =>
    set((s) => ({
      nodes: s.nodes.map((n) => (n.id === id ? { ...n, ...updates } : n)),
    })),

  moveNode: (id, x, y) =>
    set((s) => ({
      nodes: s.nodes.map((n) => (n.id === id ? { ...n, x, y } : n)),
    })),

  resizeNode: (id, w, h) =>
    set((s) => ({
      nodes: s.nodes.map((n) => {
        if (n.id !== id) return n;
        // 图片/视频节点已记录媒体宽高比（_imgAspect）：拖宽时自动保持比例
        const aspect = typeof n._imgAspect === 'number' && n._imgAspect > 0 ? n._imgAspect : null;
        if (aspect != null) {
          const chrome = typeof n._imgChrome === 'number' ? n._imgChrome : 0;
          h = Math.min(1200, Math.max(96, w * aspect + chrome));
        }
        return { ...n, w, h };
      }),
    })),

  addConnection: (from, to) =>
    set((s) => {
      if (!from || !to || from === to || s.connections.some((connection) => connection.from === from && connection.to === to)) {
        return s;
      }
      return { connections: [...s.connections, { id: uid('c'), from, to }] };
    }),

  removeConnection: (id) =>
    set((s) => ({
      connections: s.connections.filter((c) => c.id !== id),
    })),

  setViewport: (viewport) => set({ viewport }),

  setTheme: (theme) => set({ theme }),

  select: (ids, additive = false) =>
    set(() => ({
      selected: additive
        ? new Set([...get().selected, ...ids])
        : new Set(ids),
    })),

  clearSelection: () => set({ selected: new Set() }),

  toggleSelect: (id) =>
    set((s) => {
      const next = new Set(s.selected);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return { selected: next };
    }),

  pushUndo: () =>
    set((s) => {
      const state: UndoState = {
        nodes: JSON.parse(JSON.stringify(s.nodes)),
        connections: JSON.parse(JSON.stringify(s.connections)),
      };
      const stack = [...s.undoStack, state];
      if (stack.length > UNDO_MAX) stack.shift();
      return { undoStack: stack };
    }),

  performUndo: () =>
    set((s) => {
      if (!s.undoStack.length) return s;
      const state = s.undoStack[s.undoStack.length - 1];
      return {
        nodes: state.nodes,
        connections: state.connections,
        selected: new Set(),
        undoStack: s.undoStack.slice(0, -1),
      };
    }),

  copySelected: () =>
    set((s) => {
      const toCopy = [...s.selected]
        .map((id) => s.nodes.find((n) => n.id === id))
        .filter(Boolean) as CanvasNode[];
      return { clipboard: JSON.parse(JSON.stringify(toCopy)) };
    }),

  pasteNodes: (point) =>
    set((s) => {
      if (!s.clipboard.length) return s;
      const xs = s.clipboard.map((n) => n.x);
      const ys = s.clipboard.map((n) => n.y);
      const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
      const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
      const dx = point.x - cx;
      const dy = point.y - cy;
      const idMap = new Map<string, string>();
      const copies = s.clipboard.map((n) => {
        const copy = JSON.parse(JSON.stringify(n));
        copy.id = uid(n.type);
        copy.x = n.x + dx;
        copy.y = n.y + dy;
        copy.running = false;
        idMap.set(n.id, copy.id);
        return copy;
      });
      copies.forEach((c) => {
        if ((c.type === 'group' || c.type === 'promptGroup') && c.items) {
          c.items = c.items.map((id: string) => idMap.get(id) || id);
        }
      });
      const newSelected = new Set(copies.map((c) => c.id));
      return {
        nodes: [...s.nodes, ...copies],
        selected: newSelected,
      };
    }),

  groupSelectedNodes: () =>
    set((s) => {
      const targets = [...s.selected]
        .map((id) => s.nodes.find((n) => n.id === id))
        .filter((n): n is CanvasNode => !!n);
      if (targets.length < 2) return s;
      const xs = targets.map((n) => n.x);
      const ys = targets.map((n) => n.y);
      const ws = targets.map((n) => n.w);
      const hs = targets.map((n) => n.h || 220);
      const boxX = Math.min(...xs);
      const boxY = Math.min(...ys);
      const boxW = Math.max(...xs.map((x, i) => x + ws[i])) - boxX;
      const boxH = Math.max(...ys.map((y, i) => y + hs[i])) - boxY;
      const group: CanvasNode = {
        id: uid('grp'),
        type: 'group',
        x: boxX - 24,
        y: boxY - 40,
        w: boxW + 48,
        h: boxH + 64,
        items: targets.map((n) => n.id),
      };
      return {
        nodes: [...s.nodes, group],
        selected: new Set([group.id]),
      };
    }),

  toggleAssetPanel: () =>
    set((s) => ({ assetPanelOpen: !s.assetPanelOpen })),

  toggleComposer: () =>
    set((s) => ({ composerOpen: !s.composerOpen })),

  setApiConfig: (config) =>
    set({ apiConfig: config }),

  setTaskAssets: (assets) =>
    set({ taskAssets: assets }),

  openTextReader: (asset, initialMode = 'read') => {
    // 优先用 store 中最新版本的资产（其它路径可能刚更新过 body）
    const latest = get().taskAssets.find(a => a.id === asset.id);
    const toOpen = latest ?? asset;
    set({ textReaderAsset: toOpen, textReaderInitialMode: initialMode });
  },

  closeTextReader: () => {
    set({ textReaderAsset: null });
  },

  updateTextAssetBody: async (assetId: string, body: string) => {
    // 计算统计：字数 / 场数 / 章节数
    const stats = computeTextStats(body);
    // 1. 本地 store 立即更新（乐观写）
    const current = get().taskAssets;
    const updated = current.map(a =>
      a.id === assetId ? { ...a, body, textStats: stats } : a
    );
    set({ taskAssets: updated });
    // 2. 同步到后端
    try {
      await api.updateAsset(assetId, {
        body,
        text_stats: stats,
        // 同时把 body / textStats 存到 extra 字段（兼容旧 schema）
        extra: { body, text_stats: stats },
      });
    } catch (e) {
      console.warn('[dramaforge] updateTextAssetBody failed', e);
    }
  },

  hydrateFromBackend: async () => {
    try {
      const rows = await api.listProviders();
      const backendProviders: Provider[] = (rows || []).map((r: any) => ({
        id: r.provider_id,
        name: r.name || r.provider_id,
        baseUrl: r.base_url || '',
        protocol: r.protocol || 'openai',
        enabled: r.enabled !== false,
        // 后端 has_key=true → apiKey 在 DB 里但返给前端的是脱敏值
        // 不能把脱敏值写回 store，否则 setApiConfig → saveApiConfig → 后端 upsert
        // 会用脱敏值覆盖真 key。所以 has_key=true 时清空 apiKey 字段。
        apiKey: r.has_key ? '' : (r.api_key || ''),
        hasKey: r.has_key || false,
        keyPreview: r.key_preview || '',
        defaultModel: r.default_model || '',
        imageModels: r.image_models || [],
        chatModels: r.chat_models || [],
        videoModels: r.video_models || [],
      }));

      const cur = get().apiConfig;
      // 合并策略：保留 store 中已有的明文 apiKey
      // - 后端 has_key=true + store 也有明文 key → 用 store 的（避免覆盖）
      // - 后端 has_key=false + store 是空 → 用后端的（通常是初次配置）
      // - store 里有但后端没有 → 保留 store（用户新加的还没同步）
      const curById = new Map(cur.providers.map((p) => [p.id, p]));
      const merged: Provider[] = backendProviders.map((bp) => {
        const cp = curById.get(bp.id);
        if (!cp) return bp;
        // 后端有真 key + store 也有真 key：store 优先（store 可能有更新的值）
        if (bp.hasKey && cp.apiKey && cp.apiKey.trim() && !cp.apiKey.includes('***')) {
          return { ...bp, apiKey: cp.apiKey };
        }
        return bp;
      });
      // 保留 store 里有但后端没有的 provider（待同步）
      const mergedIds = new Set(merged.map((p) => p.id));
      for (const cp of cur.providers) {
        if (!mergedIds.has(cp.id)) {
          merged.push(cp);
        }
      }

      // 后端为空 + localStorage 有 key：尝试强制迁移兜底
      if (backendProviders.length === 0) {
        try {
          const localSnapshot = getLocalProvidersSnapshot();
          const localWithKey = localSnapshot.filter(
            (p) => p && p.id && p.baseUrl && p.apiKey,
          );
          if (localWithKey.length > 0) {
            const mig = await migrateLocalProvidersToBackendForce();
            if (mig.synced > 0) {
              // 重新拉取
              try {
                const fresh = await api.listProviders();
                const freshMapped: Provider[] = (fresh || []).map((r: any) => ({
                  id: r.provider_id,
                  name: r.name || r.provider_id,
                  baseUrl: r.base_url || '',
                  protocol: r.protocol || 'openai',
                  enabled: r.enabled !== false,
                  apiKey: r.has_key ? '' : (r.api_key || ''),
                  hasKey: r.has_key || false,
                  keyPreview: r.key_preview || '',
                  defaultModel: r.default_model || '',
                  imageModels: r.image_models || [],
                  chatModels: r.chat_models || [],
                  videoModels: r.video_models || [],
                }));
                // 用 fresh 替换 backendProviders，重新做合并
                const freshById = new Map(merged.map((p) => [p.id, p]));
                for (const fp of freshMapped) {
                  freshById.set(fp.id, fp);
                }
                const newMerged = Array.from(freshById.values());
                set({ apiConfig: normalizeModelBindings({ ...cur, providers: newMerged }) });
                return true;
              } catch (e) {
                console.warn('[hydrateFromBackend] re-list after migration failed', e);
              }
            }
          }
        } catch (e) {
          console.warn('[hydrateFromBackend] force-migrate failed', e);
        }
      }

      set({ apiConfig: normalizeModelBindings({ ...cur, providers: merged }) });
      return true;
    } catch (e) {
      console.warn('[hydrateFromBackend] listProviders failed', e);
      return false;
    }
  },

  startCascadeRun: (path) =>
    set(() => {
      const statusMap = new Map<string, 'queued' | 'running' | 'done' | 'failed'>();
      path.forEach((id) => statusMap.set(id, 'queued'));
      return { cascadeRunning: true, cascadeRunPath: path, cascadeNodeStatus: statusMap };
    }),

  updateCascadeNodeStatus: (nodeId, status) =>
    set((s) => {
      const newMap = new Map(s.cascadeNodeStatus);
      newMap.set(nodeId, status);
      return { cascadeNodeStatus: newMap };
    }),

  stopCascadeRun: () =>
    set({ cascadeRunning: false, cascadeRunPath: [], cascadeNodeStatus: new Map() }),

  runVideoGeneration: async (nodeId, params) => {
    const t = getT();
    const { prompt, providerId, modelId, inputImageUrls, aspectRatio, duration } = params;
    const cfg = get().apiConfig;
    const provider = cfg.providers.find(p => p.id === providerId);
    if (!provider) {
      get().updateNode(nodeId, { runError: 'optimizing prompt' });
      return;
    }
    const modelName = modelId;
    if (!modelName) {
      get().updateNode(nodeId, { runError: 'optimizing prompt' });
      return;
    }

    try {
      // 单节点直接运行：尊重用户输入的 prompt，不做隐式 LLM 优化
      // （优化是 pipeline 模式的显式步骤，见 runPipeline Step 7）。
      // prompt 原样发给供应商，不套 buildVideoPrompt 的风格/文化前缀包装。
      get().updateNode(nodeId, { _assetSourcePrompt: prompt, _assetPrompt: prompt });
      const result = await api.generateVideo({
        provider_id: provider.id,
        model: modelName,
        prompt,
        ref_urls: inputImageUrls,
        aspect_ratio: aspectRatio || '16:9',
        duration_sec: Number(duration) || 15,
      });
      const videoUrl = result.url;

      get().updateNode(nodeId, {
        url: videoUrl,
        mediaKind: 'video',
        runStatus: 'done',
        running: false,
      });
    } catch (e: any) {
      get().updateNode(nodeId, {
        runStatus: 'failed',
        running: false,
        runError: e?.message || 'optimizing prompt',
      });
    }
  },

  runPipeline: async (nodeId, params) => {
    const t = getT();
    const cfg = get().apiConfig;
    const pipelineNode = get().nodes.find(n => n.id === nodeId);
    if (!pipelineNode) return;

    const updatePipeline = (updates: Partial<CanvasNode>) => get().updateNode(nodeId, updates);

    const log = (msg: string) => {
      const node = get().nodes.find(n => n.id === nodeId);
      const prevLog = (node?._pipelineLog as string[]) || [];
      updatePipeline({ _pipelineLog: [...prevLog, msg] });
    };

    const isStopped = () => {
      const controller = pipelineAbortControllers.get(nodeId);
      return !controller || controller.signal.aborted;
    };

    const markStepDone = (step: string) => {
      const node = get().nodes.find(n => n.id === nodeId);
      const completed = (node?._pipelineCompletedSteps as string[]) || [];
      if (!completed.includes(step)) {
        updatePipeline({ _pipelineCompletedSteps: [...completed, step] });
      }
    };

    const isStepDone = (step: string) => {
      const completed = (pipelineNode._pipelineCompletedSteps as string[]) || [];
      return completed.includes(step);
    };

    const createAssetGroup = (kind: string, label: string, offsetX: number) => {
      const groupNode = createNode('group', {
        x: pipelineNode.x + pipelineNode.w + 60 + offsetX,
        y: pipelineNode.y,
      }, {
        title: label,
        items: [],
        _assetKind: kind,
        _groupId: 'root',
      });
      get().addNode(groupNode);
      return groupNode.id;
    };

    const addAssetNodeToGroup = (
      groupId: string,
      url: string,
      title: string,
      kind: string,
      index: number,
      metadata?: { prompt?: string; providerId?: string; providerName?: string; modelId?: string }
    ) => {
      const group = get().nodes.find(n => n.id === groupId);
      if (!group) return;
      const col = index % 3;
      const row = Math.floor(index / 3);
      const assetNode = createNode('image', {
        x: group.x + 24 + col * 290,
        y: group.y + 40 + row * 200,
      }, {
        url,
        title,
        mediaKind: 'image',
        _assetKind: kind,
        _groupId: groupId,
        _assetPrompt: metadata?.prompt,
        _assetProviderId: metadata?.providerId,
        _assetProviderName: metadata?.providerName,
        _assetModelId: metadata?.modelId,
      });
      get().addNode(assetNode);
      const updatedGroup = get().nodes.find(n => n.id === groupId);
      if (updatedGroup) {
        const items = [...(updatedGroup.items || []), assetNode.id];
        const itemCount = items.length;
        const cols = Math.min(itemCount, 3);
        const rows = Math.ceil(itemCount / 3);
        get().updateNode(groupId, {
          items,
          w: Math.max(280, 24 + cols * 290 + 24),
          h: 40 + rows * 200 + 24,
        });
      }
      const tagMap: Record<string, string> = {
        character: 'assetTagCharacter',
        prop: 'assetTagProp',
        scene: 'assetTagBackground',
        storyboard: 'assetTagStoryboard',
      };
      const tagKey = tagMap[kind] || '';
      const tagLabel = tagKey ? t(tagKey) : kind;
      const assetRef: TaskAssetRef = {
        id: assetNode.id,
        kind: kind as TaskAssetKind,
        name: title,
        url,
        tags: [tagLabel],
        prompt: metadata?.prompt,
        providerId: metadata?.providerId,
        providerName: metadata?.providerName,
        modelId: metadata?.modelId,
      };
      const current = get().taskAssets.filter(a => a.id !== assetRef.id);
      get().setTaskAssets([...current, assetRef]);
      void syncAssetCreate(assetRef, get().projectId || undefined);
    };

    const addFailedAssetNodeToGroup = (
      groupId: string,
      title: string,
      kind: string,
      index: number,
      errorMsg: string,
      metadata?: { prompt?: string; providerId?: string; providerName?: string; modelId?: string }
    ) => {
      const group = get().nodes.find(n => n.id === groupId);
      if (!group) return;
      const col = index % 3;
      const row = Math.floor(index / 3);
      const failedNodeId = uid('fail');
      const assetNode = createNode('image', {
        x: group.x + 24 + col * 290,
        y: group.y + 40 + row * 200,
      }, {
        title,
        mediaKind: 'image',
        _assetKind: kind,
        _groupId: groupId,
        _assetFailed: true,
        _assetError: errorMsg,
        _assetPrompt: metadata?.prompt,
        _assetProviderId: metadata?.providerId,
        _assetProviderName: metadata?.providerName,
        _assetModelId: metadata?.modelId,
      });
      assetNode.id = failedNodeId;
      get().addNode(assetNode);
      const updatedGroup = get().nodes.find(n => n.id === groupId);
      if (updatedGroup) {
        const items = [...(updatedGroup.items || []), assetNode.id];
        const itemCount = items.length;
        const cols = Math.min(itemCount, 3);
        const rows = Math.ceil(itemCount / 3);
        get().updateNode(groupId, {
          items,
          w: Math.max(280, 24 + cols * 290 + 24),
          h: 40 + rows * 200 + 24,
        });
      }
      const tagMap: Record<string, string> = {
        character: 'assetTagCharacter',
        prop: 'assetTagProp',
        scene: 'assetTagBackground',
        storyboard: 'assetTagStoryboard',
      };
      const tagKey = tagMap[kind] || '';
      const tagLabel = tagKey ? t(tagKey) : kind;
      const assetRef: TaskAssetRef = {
        id: assetNode.id,
        kind: kind as TaskAssetKind,
        name: title,
        url: '',
        tags: [tagLabel, t('canvasPanelAssetTagFailed')],
        prompt: metadata?.prompt,
        providerId: metadata?.providerId,
        providerName: metadata?.providerName,
        modelId: metadata?.modelId,
        failed: true,
        error: errorMsg,
      };
      const current = get().taskAssets.filter(a => a.id !== assetRef.id);
      get().setTaskAssets([...current, assetRef]);
      void syncAssetCreate(assetRef, get().projectId || undefined);
    };

    const addTextAssetNode = (text: string, title: string, kind: string, offsetX: number, metadata?: { providerId?: string; providerName?: string; modelId?: string }) => {
      const nodeType: 'novel' | 'script' | 'prompt' = kind === 'novel' ? 'novel' : kind === 'script' ? 'script' : 'prompt';
      const textNode = createNode(nodeType, {
        x: pipelineNode.x + pipelineNode.w + 60 + offsetX,
        y: pipelineNode.y,
      }, {
        text,
        title,
        _assetKind: kind,
        _groupId: 'root',
        _assetProviderId: metadata?.providerId,
        _assetProviderName: metadata?.providerName,
        _assetModelId: metadata?.modelId,
      });
      get().addNode(textNode);
      const assetRef: TaskAssetRef = {
        id: textNode.id,
        kind: kind as TaskAssetKind,
        name: title,
        url: '',
        tags: [kind === 'novel' ? t('assetTagNovel') : t('assetTagScript')],
        prompt: text,
        body: text,
        providerId: metadata?.providerId,
        providerName: metadata?.providerName,
        modelId: metadata?.modelId,
        textStats: computeTextStats(text),
      };
      const current = get().taskAssets.filter(a => a.id !== assetRef.id);
      get().setTaskAssets([...current, assetRef]);
      void syncAssetCreate(assetRef, get().projectId || undefined);
      return textNode.id;
    };

    const updateTextAssetContent = (assetId: string, text: string, generating: boolean) => {
      const current = get().taskAssets;
      const updated = current.map(a =>
        a.id === assetId ? { ...a, prompt: text, body: text, generating, textStats: computeTextStats(text) } : a
      );
      get().setTaskAssets(updated);
      get().updateNode(assetId, { text });
    };

    const abortController = new AbortController();
    pipelineAbortControllers.set(nodeId, abortController);
    const signal = abortController.signal;

    const isResume = !!(pipelineNode._pipelineStopped && pipelineNode._pipelineParams);
    const resumeParams = isResume ? pipelineNode._pipelineParams! : params;
    const { inputText, sourceType, style, language } = resumeParams;

    get().updateNode(nodeId, { runError: 'optimizing prompt' });
    updatePipeline({
      running: true,
      runStatus: 'running',
      _pipelineStopped: false,
      _pipelineParams: resumeParams,
      ...(isResume ? {} : {
        _pipelineProgress: 0,
        _pipelineStep: t('canvasPipelineStepInit'),
        _pipelineLog: [isResume ? t('canvasPipelineLogResume') : t('canvasPipelineLogStart')],
      }),
    });

    try {
      // ===== Step 1: PREPROCESSING =====
      if (!isStepDone('preprocessing')) {
        updatePipeline({ _pipelineStep: t('canvasPipelineStepPreprocess'), _pipelineProgress: 5 });
        log(sourceType === 'idea' ? t('canvasPipelineLogIdeaExpand') : t('canvasPipelineLogNovelProcess'));

        let processedText = inputText;
        if (sourceType === 'idea') {
          const llmProvider = getProviderForStep(cfg, 'preprocessing');
          const llmModel = getModelForStep(cfg, 'preprocessing');
          if (!llmProvider || !llmModel) throw new Error(t('canvasPipelineNoPreprocessProvider'));

          const novelNodeId = addTextAssetNode('', t('canvasPipelineAssetNovel'), 'novel', 0, {
            providerId: llmProvider.id,
            providerName: llmProvider.name,
            modelId: llmModel.modelName,
          });
          processedText = '';
          for await (const chunk of expandIdeaToStory(llmProvider, llmModel, inputText, language, signal)) {
            processedText += chunk;
            updatePipeline({ _pipelinePreview: processedText.slice(-200) });
            updateTextAssetContent(novelNodeId, processedText, true);
          }
          updateTextAssetContent(novelNodeId, processedText, false);
        } else {
          processedText = inputText;
          addTextAssetNode(processedText, t('canvasPipelineAssetNovel'), 'novel', 0);
        }
        log(t('canvasPipelineLogTextDone').replace('{0}', String(processedText.length)));
        updatePipeline({ _pipelineProgress: 15, _pipelineProcessedText: processedText });
        markStepDone('preprocessing');
      } else {
        log(t('canvasPipelineLogSkipStep').replace('{0}', t('canvasPipelineStepPreprocess')));
      }

      if (isStopped()) throw new DOMException('Aborted', 'AbortError');

      // ===== Step 2: SCRIPT_GENERATION =====
      let scriptResult: any = null;
      if (!isStepDone('scriptGeneration')) {
        updatePipeline({ _pipelineStep: t('canvasPipelineStepScript'), _pipelineProgress: 20 });
        log(t('canvasPipelineLogScript'));

        const scriptProvider = getProviderForStep(cfg, 'scriptGeneration');
        const scriptModel = getModelForStep(cfg, 'scriptGeneration');
        if (!scriptProvider || !scriptModel) throw new Error(t('canvasPipelineNoScriptProvider'));

        const scriptNodeId = addTextAssetNode('', t('canvasPipelineAssetScript'), 'script', 320, {
          providerId: scriptProvider.id,
          providerName: scriptProvider.name,
          modelId: scriptModel.modelName,
        });
        let accumulatedText = '';
        for await (const partial of generateScriptFromNovel(scriptProvider, scriptModel, pipelineNode._pipelineProcessedText || inputText, style, language, signal)) {
          scriptResult = partial;
          const charCount = partial.characters?.length || 0;
          const shotCount = partial.bigShots?.length || 0;
          updatePipeline({
            _pipelinePreview: t('canvasPipelinePreviewScript').replace('{0}', String(charCount)).replace('{1}', String(shotCount)),
          });
          const partialText = JSON.stringify(partial, null, 2);
          if (partialText !== accumulatedText) {
            accumulatedText = partialText;
            updateTextAssetContent(scriptNodeId, partialText, true);
          }
        }
        updateTextAssetContent(scriptNodeId, JSON.stringify(scriptResult, null, 2), false);

        const characters: any[] = scriptResult?.characters || [];
        const props: any[] = scriptResult?.props || [];
        const fromScriptElements = ((scriptResult?.script || []).filter((s: any) => s.sceneAsset).map((s: any) => s.sceneAsset)) as any[];
        const fromBigShots = (() => {
          const seen = new Set<string>();
          const result: any[] = [];
          for (const shot of (scriptResult?.bigShots || [])) {
            const sa = shot?.sceneAsset;
            if (sa && !seen.has(sa.mainStructure || sa.id || JSON.stringify(sa).slice(0, 50))) {
              seen.add(sa.mainStructure || sa.id || JSON.stringify(sa).slice(0, 50));
              result.push(sa);
            }
          }
          return result;
        })();
        const sceneAssets: any[] = (Array.isArray(scriptResult?.sceneAssets) && scriptResult.sceneAssets.length > 0)
          ? scriptResult.sceneAssets
          : (fromScriptElements.length > 0 ? fromScriptElements : fromBigShots);
        const bigShots: any[] = scriptResult?.bigShots || [];
        const visualSignature = scriptResult?.visualSignature;

        log(t('canvasPipelineLogScriptDone').replace('{0}', String(characters.length)).replace('{1}', String(props.length)).replace('{2}', String(sceneAssets.length)).replace('{3}', String(bigShots.length)));
        updatePipeline({
          _pipelineProgress: 40,
          _pipelineScriptResult: scriptResult,
        });
        markStepDone('scriptGeneration');
      } else {
        log(t('canvasPipelineLogSkipStep').replace('{0}', t('canvasPipelineStepScript')));
        scriptResult = pipelineNode._pipelineScriptResult;
      }

      if (isStopped()) throw new DOMException('Aborted', 'AbortError');

      const characters: any[] = scriptResult?.characters || [];
      const props: any[] = scriptResult?.props || [];
      const fromScriptElements2 = ((scriptResult?.script || []).filter((s: any) => s.sceneAsset).map((s: any) => s.sceneAsset)) as any[];
      const fromBigShots2 = (() => {
        const seen = new Set<string>();
        const result: any[] = [];
        for (const shot of (scriptResult?.bigShots || [])) {
          const sa = shot?.sceneAsset;
          if (sa && !seen.has(sa.mainStructure || sa.id || JSON.stringify(sa).slice(0, 50))) {
            seen.add(sa.mainStructure || sa.id || JSON.stringify(sa).slice(0, 50));
            result.push(sa);
          }
        }
        return result;
      })();
      const sceneAssets: any[] = (Array.isArray(scriptResult?.sceneAssets) && scriptResult.sceneAssets.length > 0)
        ? scriptResult.sceneAssets
        : (fromScriptElements2.length > 0 ? fromScriptElements2 : fromBigShots2);
      const bigShots: any[] = scriptResult?.bigShots || [];
      const visualSignature = scriptResult?.visualSignature;

      // ===== Step 3: CHARACTER_DESIGN =====
      if (!isStepDone('characterDesign')) {
        updatePipeline({ _pipelineStep: t('canvasPipelineStepCharacter'), _pipelineProgress: 45 });
        log(t('canvasPipelineLogCharGen').replace('{0}', String(characters.length)));

        const charProvider = getProviderForStep(cfg, 'characterDesign');
        const charModel = getModelForStep(cfg, 'characterDesign');
        if (charProvider && charModel && characters.length > 0) {
          const groupId = createAssetGroup('character', t('canvasPipelineAssetGroupCharacter'), 640);
          const BATCH = 3;
          let assetIdx = 0;
          for (let i = 0; i < characters.length; i += BATCH) {
            if (isStopped()) throw new DOMException('Aborted', 'AbortError');
            const batch = characters.slice(i, i + BATCH);
            await Promise.all(batch.map(async (char) => {
              try {
                const prompt = char.visualFeatures || char.description || char.name || '';
                const imgUrl = await generateCharacterDesign(char, style, language, charProvider, charModel, signal);
                addAssetNodeToGroup(groupId, imgUrl, char.name || t('canvasPipelineDefaultCharName'), 'character', assetIdx++, {
                  prompt,
                  providerId: charProvider.id,
                  providerName: charProvider.name,
                  modelId: charModel.modelName,
                });
                log(t('canvasPipelineLogCharDone').replace('{0}', char.name || t('canvasPipelineDefaultUnnamed')));
              } catch (e: any) {
                if (e.name === 'AbortError') throw e;
                const prompt = char.visualFeatures || char.description || char.name || '';
                addFailedAssetNodeToGroup(groupId, char.name || t('canvasPipelineDefaultCharName'), 'character', assetIdx++, e.message || t('canvasPipelineUnknownError'), {
                  prompt,
                  providerId: charProvider.id,
                  providerName: charProvider.name,
                  modelId: charModel.modelName,
                });
                log(t('canvasPipelineLogCharFail').replace('{0}', char.name).replace('{1}', e.message));
              }
            }));
          }
        } else {
          log(t('canvasPipelineNoCharProvider'));
        }
        updatePipeline({ _pipelineProgress: 60 });
        markStepDone('characterDesign');
      } else {
        log(t('canvasPipelineLogSkipStep').replace('{0}', t('canvasPipelineStepCharacter')));
      }

      if (isStopped()) throw new DOMException('Aborted', 'AbortError');

      // ===== Step 4: PROP_DESIGN =====
      if (!isStepDone('propDesign') && props.length > 0) {
        updatePipeline({ _pipelineStep: t('canvasPipelineStepProp'), _pipelineProgress: 62 });
        log(t('canvasPipelineLogPropGen').replace('{0}', String(props.length)));

        const propProvider = getProviderForStep(cfg, 'characterDesign');
        const propModel = getModelForStep(cfg, 'characterDesign');
        if (propProvider && propModel) {
          const groupId = createAssetGroup('prop', t('canvasPipelineAssetGroupProp'), 960);
          const BATCH = 3;
          let assetIdx = 0;
          for (let i = 0; i < props.length; i += BATCH) {
            if (isStopped()) throw new DOMException('Aborted', 'AbortError');
            const batch = props.slice(i, i + BATCH);
            await Promise.all(batch.map(async (prop) => {
              try {
                const prompt = prop.prompt || prop.name || 'prop';
                const imgUrl = await generatePropImage(prompt, propProvider, propModel, signal);
                addAssetNodeToGroup(groupId, imgUrl, prop.name || t('canvasPipelineDefaultPropName'), 'prop', assetIdx++, {
                  prompt,
                  providerId: propProvider.id,
                  providerName: propProvider.name,
                  modelId: propModel.modelName,
                });
                log(t('canvasPipelineLogPropDone').replace('{0}', prop.name || t('canvasPipelineDefaultUnnamed')));
              } catch (e: any) {
                if (e.name === 'AbortError') throw e;
                const prompt = prop.prompt || prop.name || 'prop';
                addFailedAssetNodeToGroup(groupId, prop.name || t('canvasPipelineDefaultPropName'), 'prop', assetIdx++, e.message || t('canvasPipelineUnknownError'), {
                  prompt,
                  providerId: propProvider.id,
                  providerName: propProvider.name,
                  modelId: propModel.modelName,
                });
                log(t('canvasPipelineLogPropFail').replace('{0}', prop.name).replace('{1}', e.message));
              }
            }));
          }
        }
        markStepDone('propDesign');
      } else if (!isStepDone('propDesign')) {
        markStepDone('propDesign');
      } else if (props.length > 0) {
        log(t('canvasPipelineLogSkipStep').replace('{0}', t('canvasPipelineStepProp')));
      }
      updatePipeline({ _pipelineProgress: 68 });

      if (isStopped()) throw new DOMException('Aborted', 'AbortError');

      // ===== Step 5: SCENE_DESIGN =====
      if (!isStepDone('sceneDesign') && sceneAssets.length > 0) {
        updatePipeline({ _pipelineStep: t('canvasPipelineStepScene'), _pipelineProgress: 70 });
        log(t('canvasPipelineLogSceneGen').replace('{0}', String(sceneAssets.length)));

        const sceneProvider = getProviderForStep(cfg, 'storyboarding');
        const sceneModel = getModelForStep(cfg, 'storyboarding');
        if (sceneProvider && sceneModel) {
          const groupId = createAssetGroup('scene', t('canvasPipelineAssetGroupScene'), 1280);
          const BATCH = 3;
          let assetIdx = 0;
          for (let i = 0; i < sceneAssets.length; i += BATCH) {
            if (isStopped()) throw new DOMException('Aborted', 'AbortError');
            const batch = sceneAssets.slice(i, i + BATCH);
            await Promise.all(batch.map(async (scene) => {
              try {
                const prompt = scene.prompt || scene.mainStructure || 'scene';
                const imgUrl = await generatePropImage(prompt, sceneProvider, sceneModel, signal);
                addAssetNodeToGroup(groupId, imgUrl, scene.mainStructure || t('canvasPipelineDefaultSceneName'), 'scene', assetIdx++, {
                  prompt,
                  providerId: sceneProvider.id,
                  providerName: sceneProvider.name,
                  modelId: sceneModel.modelName,
                });
                log(t('canvasPipelineLogSceneDone').replace('{0}', scene.mainStructure || t('canvasPipelineDefaultUnnamed')));
              } catch (e: any) {
                if (e.name === 'AbortError') throw e;
                const prompt = scene.prompt || scene.mainStructure || 'scene';
                addFailedAssetNodeToGroup(groupId, scene.mainStructure || t('canvasPipelineDefaultSceneName'), 'scene', assetIdx++, e.message || t('canvasPipelineUnknownError'), {
                  prompt,
                  providerId: sceneProvider.id,
                  providerName: sceneProvider.name,
                  modelId: sceneModel.modelName,
                });
                log(t('canvasPipelineLogSceneFail').replace('{0}', scene.mainStructure).replace('{1}', e.message));
              }
            }));
          }
        }
        markStepDone('sceneDesign');
      } else if (!isStepDone('sceneDesign')) {
        markStepDone('sceneDesign');
      } else if (sceneAssets.length > 0) {
        log(t('canvasPipelineLogSkipStep').replace('{0}', t('canvasPipelineStepScene')));
      }
      updatePipeline({ _pipelineProgress: 75 });

      if (isStopped()) throw new DOMException('Aborted', 'AbortError');

      // ===== Step 6: STORYBOARDING =====
      if (!isStepDone('storyboarding')) {
        updatePipeline({ _pipelineStep: t('canvasPipelineStepStoryboard'), _pipelineProgress: 78 });
        log(t('canvasPipelineLogShotGen').replace('{0}', String(bigShots.length)));

        const shotProvider = getProviderForStep(cfg, 'storyboarding');
        const shotModel = getModelForStep(cfg, 'storyboarding');
        if (shotProvider && shotModel && bigShots.length > 0) {
          const groupId = createAssetGroup('storyboard', t('canvasPipelineAssetGroupStoryboard'), 1600);
          const BATCH = 3;
          let assetIdx = 0;
          for (let i = 0; i < bigShots.length; i += BATCH) {
            if (isStopped()) throw new DOMException('Aborted', 'AbortError');
            const batch = bigShots.slice(i, i + BATCH);
            await Promise.all(batch.map(async (shot) => {
              try {
                const involvedChars = characters.filter(c =>
                  shot.charactersInvolved?.some((name: string) => name.toLowerCase().includes(c.name?.toLowerCase()))
                );
                const context = involvedChars.map((c: any) => `${c.name}: ${c.visualFeatures}`).join('; ');
                const refImages = involvedChars.map((c: any) => c.threeViewImg).filter(Boolean) as string[];
                const prompt = shot.storyboardPrompt || shot.description || '';
                const img = await generateStoryboardImage(
                  prompt, style, language, context, refImages, shotProvider, shotModel, signal
                );
                addAssetNodeToGroup(groupId, img, `${t('canvasPipelineDefaultShotName')} ${shot.id || assetIdx}`, 'storyboard', assetIdx++, {
                  prompt,
                  providerId: shotProvider.id,
                  providerName: shotProvider.name,
                  modelId: shotModel.modelName,
                });
                log(t('canvasPipelineLogShotDone').replace('{0}', String(shot.id || assetIdx)));
              } catch (e: any) {
                if (e.name === 'AbortError') throw e;
                const prompt = shot.storyboardPrompt || shot.description || '';
                addFailedAssetNodeToGroup(groupId, `${t('canvasPipelineDefaultShotName')} ${shot.id || assetIdx}`, 'storyboard', assetIdx++, e.message || t('canvasPipelineUnknownError'), {
                  prompt,
                  providerId: shotProvider.id,
                  providerName: shotProvider.name,
                  modelId: shotModel.modelName,
                });
                log(t('canvasPipelineLogShotFail').replace('{0}', String(shot.id)).replace('{1}', e.message));
              }
            }));
          }
        }
        updatePipeline({ _pipelineProgress: 90 });
        markStepDone('storyboarding');
      } else {
        log(t('canvasPipelineLogSkipStep').replace('{0}', t('canvasPipelineStepStoryboard')));
      }

      if (isStopped()) throw new DOMException('Aborted', 'AbortError');

      // ===== Step 7: PROMPT_OPTIMIZATION =====
      if (!isStepDone('promptOptimization')) {
        updatePipeline({ _pipelineStep: t('canvasPipelineStepPromptOpt'), _pipelineProgress: 92 });
        log(t('canvasPipelineLogPromptOpt'));

        const optProvider = getProviderForStep(cfg, 'promptOptimization');
        const optModel = getModelForStep(cfg, 'promptOptimization');
        if (optProvider && optModel && bigShots.length > 0) {
          const BATCH = 5;
          for (let i = 0; i < bigShots.length; i += BATCH) {
            if (isStopped()) throw new DOMException('Aborted', 'AbortError');
            const batch = bigShots.slice(i, i + BATCH);
            await Promise.all(batch.map(async (shot) => {
              try {
                const originalPrompt = shot.soraPromptOriginal || shot.soraPrompt || 'Scene';
                // 走后端代理（api_key 只存后端 DB），避免前端空/过期 key 导致 401"无效的令牌"
                const optimized = await optimizeSoraPromptViaBackend(
                  optProvider.id, optModel.modelName, originalPrompt, style, language, visualSignature,
                );
                shot.soraPrompt = optimized;
                shot.soraPromptOptimized = optimized;
              } catch (e: any) {
                if (e.name === 'AbortError') throw e;
                log(t('canvasPipelineLogPromptOptFail').replace('{0}', String(shot.id)));
              }
            }));
          }
          log(t('canvasPipelineLogPromptOptDone'));
        }
        markStepDone('promptOptimization');
      } else {
        log(t('canvasPipelineLogSkipStep').replace('{0}', t('canvasPipelineStepPromptOpt')));
      }

      pipelineAbortControllers.delete(nodeId);
      updatePipeline({
        running: false,
        runStatus: 'done',
        _pipelineProgress: 100,
        _pipelineStep: t('canvasPipelineStepDone'),
        _pipelineStopped: false,
        _pipelineLog: [...((get().nodes.find(n => n.id === nodeId)?._pipelineLog as string[]) || []), t('canvasPipelineLogAllDone')],
      });
    } catch (e: any) {
      pipelineAbortControllers.delete(nodeId);
      const currentLog = (get().nodes.find(n => n.id === nodeId)?._pipelineLog as string[]) || [];

      if (e.name === 'AbortError') {
        updatePipeline({
          running: false,
          runStatus: 'stopped',
          _pipelineStopped: true,
          _pipelineStep: t('canvasPipelineStepStopped'),
          _pipelineLog: [...currentLog, t('canvasPipelineLogStopped')],
        });
      } else {
        const errorMsg = e.message || t('canvasPipelineUnknownError');
        get().updateNode(nodeId, { runError: 'optimizing prompt' });
        updatePipeline({
          running: false,
          runStatus: 'failed',
          _pipelineLog: [...currentLog, t('canvasPipelineLogError').replace('{0}', errorMsg)],
        });
      }
    }
  },

  stopPipeline: (nodeId) => {
    const controller = pipelineAbortControllers.get(nodeId);
    if (controller) {
      controller.abort();
    }
  },

  retryFailedAsset: async (taskAssetId: string, customPrompt?: string) => {
    const t = getT();
    const cfg = get().apiConfig;
    let asset = get().taskAssets.find(a => a.id === taskAssetId);
    if (!asset) {
      const canvasNode0 = get().nodes.find(n => n.id === taskAssetId);
      if (!canvasNode0) return;
      const inferredKind = (canvasNode0._assetKind as string) ||
        (canvasNode0.type === 'video' ? 'storyboard' :
         canvasNode0.type === 'image' ? 'storyboard' : 'storyboard');
      const newAsset: TaskAssetRef = {
        id: taskAssetId,
        kind: inferredKind as any,
        title: (canvasNode0.name as string) || '',
        name: (canvasNode0.name as string) || '',
        url: canvasNode0.url || '',
        prompt: (canvasNode0._assetPrompt as string) || '',
        providerId: (canvasNode0._assetProviderId as string) || undefined,
        providerName: (canvasNode0._assetProviderName as string) || undefined,
        modelId: (canvasNode0._assetModelId as string) || undefined,
        failed: false,
        error: undefined,
        generating: false,
      } as TaskAssetRef;
      get().setTaskAssets([...get().taskAssets, newAsset]);
      void syncAssetCreate(newAsset, get().projectId || undefined);
      asset = newAsset;
    }

    const updatedAssets = get().taskAssets.map(a =>
      a.id === taskAssetId
        ? { ...a, failed: false, error: undefined, generating: true, prompt: customPrompt ?? a.prompt }
        : a
    );
    get().setTaskAssets(updatedAssets);
    const retryingAsset = updatedAssets.find(a => a.id === taskAssetId);
    if (retryingAsset) void syncAssetUpdate(retryingAsset);

    const canvasNode = get().nodes.find(n => n.id === taskAssetId);

    try {
      const step = (asset.kind === 'character' || asset.kind === 'prop') ? 'characterDesign' : 'storyboarding';
      let provider = cfg.providers.find(p => p.id === asset.providerId && p.enabled);
      if (!provider) provider = getProviderForStep(cfg, step) || undefined;
      let model = getModelForStep(cfg, step);
      if (provider && asset.modelId && asset.modelId !== 'default') {
        // 用户在弹层里手选了模型：直接使用它。即使全局未配置该步骤的模型绑定，
        // 也用一次性配置兜底，而不是抛 canvasPanelRetryNoProvider。
        model = model
          ? ({ ...model, modelName: asset.modelId } as any)
          : buildEphemeralImageModel(provider.id, asset.modelId);
      }

      if (!provider || !model) {
        throw new Error(t('canvasPanelRetryNoProvider'));
      }

      let url = '';
      const sourcePrompt = customPrompt || asset.prompt || asset.name || '';
      // 单节点重试/生成：直接使用用户输入的 prompt，不做隐式 LLM 优化
      const prompt = sourcePrompt;
      const referenceImages = canvasNode
        ? connectedImageUrls(get().nodes, get().connections, canvasNode.id)
        : [];
      if (customPrompt) {
        // 用户在浮窗直接输入 prompt 的单节点生成：原样使用，不套六宫格/静物等流程模板
        url = await generateImageDirect(prompt, provider, model, referenceImages);
      } else if (asset.kind === 'character') {
        url = await generatePropImage(prompt, provider, model, undefined, referenceImages);
      } else if (asset.kind === 'prop' || asset.kind === 'scene') {
        url = await generatePropImage(prompt, provider, model, undefined, referenceImages);
      } else if (asset.kind === 'storyboard') {
        url = await generateStoryboardImage(prompt, '', 'zh', '', referenceImages, provider, model, undefined);
      } else {
        throw new Error(t('canvasPanelRetryUnsupportedKind').replace('{0}', asset.kind));
      }

      const successAssets = get().taskAssets.map(a =>
        a.id === taskAssetId
          ? { ...a, failed: false, error: undefined, generating: false, url, prompt, providerId: provider!.id, providerName: provider!.name, modelId: model!.modelName }
          : a
      );
      get().setTaskAssets(successAssets);
      const successAsset = successAssets.find(a => a.id === taskAssetId);
      if (successAsset) void syncAssetUpdate(successAsset);
      if (canvasNode) {
        get().updateNode(canvasNode.id, {
          url,
          _assetFailed: false,
          _assetError: undefined,
          _assetPrompt: prompt,
          _assetSourcePrompt: sourcePrompt,
          _assetProviderId: provider!.id,
          _assetProviderName: provider!.name,
          _assetModelId: model!.modelName,
        } as Partial<CanvasNode>);
      }
    } catch (e: any) {
      const errorMsg = e.message || t('canvasPipelineUnknownError');
      const failAssets = get().taskAssets.map(a =>
        a.id === taskAssetId
          ? { ...a, failed: true, error: errorMsg, generating: false }
          : a
      );
      get().setTaskAssets(failAssets);
      const failAsset = failAssets.find(a => a.id === taskAssetId);
      if (failAsset) void syncAssetUpdate(failAsset);
      if (canvasNode) {
        get().updateNode(canvasNode.id, {
          _assetFailed: true,
          _assetError: errorMsg,
        } as Partial<CanvasNode>);
      }
    }
  },

  runImageToImage: async (sourceNodeId, params) => {
    const t = getT();
    const cfg = get().apiConfig;
    const sourceNode = get().nodes.find(n => n.id === sourceNodeId);
    if (!sourceNode) return;
    const sourceUrl = (sourceNode.url || '').trim();
    if (!sourceUrl) {
      // 源节点还没有图片 → 退化为原节点原地生成逻辑
      return get().retryFailedAsset(sourceNodeId, params.prompt);
    }

    // 1) 在源节点右侧创建带 loading(_pending) 状态的新图片节点，避让已有节点
    const srcRect = estimatedNodeRect(sourceNode);
    const size = DEFAULT_NODE_SIZES['image'] || { w: 260 };
    const newW = size.w || 260;
    const newH = size.h || 160;
    const gapX = 80;
    const gapY = 40;
    const nx = srcRect.x + srcRect.w + gapX;
    let ny = srcRect.y;
    const overlaps = (x: number, y: number) =>
      get().nodes.some(n => {
        if (n.id === sourceNodeId) return false;
        const r = estimatedNodeRect(n);
        return x < r.x + r.w && x + newW > r.x && y < r.y + r.h && y + newH > r.y;
      });
    let guard = 0;
    while (overlaps(nx, ny) && guard < 50) {
      ny += newH + gapY;
      guard += 1;
    }

    const newNode = createNode('image', { x: nx, y: ny }, {
      mediaKind: 'image',
      _assetKind: 'storyboard',
      _pending: [{ id: uid('pending'), startedAt: Date.now() }],
      _assetPrompt: params.prompt,
      _assetProviderId: params.providerId || undefined,
      _assetProviderName: cfg.providers.find(p => p.id === params.providerId)?.name,
      _assetModelId: params.modelId || undefined,
    } as Partial<CanvasNode>);
    get().addNode(newNode);
    get().addConnection(sourceNodeId, newNode.id);

    // 2) 登记 taskAsset（generating 状态，供资产面板同步显示）
    const newAsset: TaskAssetRef = {
      id: newNode.id,
      kind: 'storyboard',
      title: '',
      name: '',
      url: '',
      prompt: params.prompt,
      providerId: params.providerId || undefined,
      providerName: cfg.providers.find(p => p.id === params.providerId)?.name,
      modelId: params.modelId || undefined,
      failed: false,
      error: undefined,
      generating: true,
    } as TaskAssetRef;
    get().setTaskAssets([...get().taskAssets, newAsset]);
    void syncAssetCreate(newAsset, get().projectId || undefined);

    try {
      // 3) 供应商/模型：优先使用弹层选择，缺失时回退到全局模型绑定
      let provider = cfg.providers.find(p => p.id === params.providerId && p.enabled);
      if (!provider) provider = getProviderForStep(cfg, 'storyboarding') || undefined;
      let model: ModelConfig | undefined;
      if (params.modelId) {
        const bound = getModelForStep(cfg, 'storyboarding');
        model = bound
          ? ({ ...bound, modelName: params.modelId } as any)
          : provider
            ? buildEphemeralImageModel(provider.id, params.modelId)
            : undefined;
      } else {
        model = getModelForStep(cfg, 'storyboarding');
      }
      if (!provider || !model) {
        throw new Error(t('canvasPanelRetryNoProvider'));
      }

      const sourcePrompt = params.prompt;
      // 图生图单节点运行：直接使用用户输入的 prompt，不做隐式 LLM 优化
      const prompt = sourcePrompt;
      // 参考图：连入源节点的所有上游图都作为输入（与 agent 参考边语义一致），
      // 再加上源节点自身的图（源→新节点的连线使源图成为新节点的参考输入）
      const referenceImages = [
        ...connectedImageUrls(get().nodes, get().connections, sourceNodeId),
        sourceUrl,
      ].filter((u, i, arr) => !!u && arr.indexOf(u) === i);
      // 单节点图生图：prompt 原样使用，不套六宫格故事板等标准流程模板
      const url = await generateImageDirect(prompt, provider, model, referenceImages, params.aspectRatio);

      // 4) 成功：结果写到新节点，不覆盖源节点
      const successAssets = get().taskAssets.map(a =>
        a.id === newNode.id
          ? { ...a, failed: false, error: undefined, generating: false, url, prompt, providerId: provider!.id, providerName: provider!.name, modelId: model!.modelName }
          : a
      );
      get().setTaskAssets(successAssets);
      const successAsset = successAssets.find(a => a.id === newNode.id);
      if (successAsset) void syncAssetUpdate(successAsset);
      get().updateNode(newNode.id, {
        url,
        _pending: [],
        _assetFailed: false,
        _assetError: undefined,
        _assetPrompt: prompt,
        _assetSourcePrompt: sourcePrompt,
        _assetProviderId: provider!.id,
        _assetProviderName: provider!.name,
        _assetModelId: model!.modelName,
      } as Partial<CanvasNode>);
    } catch (e: any) {
      const errorMsg = e.message || t('canvasPipelineUnknownError');
      const failAssets = get().taskAssets.map(a =>
        a.id === newNode.id
          ? { ...a, failed: true, error: errorMsg, generating: false }
          : a
      );
      get().setTaskAssets(failAssets);
      const failAsset = failAssets.find(a => a.id === newNode.id);
      if (failAsset) void syncAssetUpdate(failAsset);
      get().updateNode(newNode.id, {
        _pending: [],
        _assetFailed: true,
        _assetError: errorMsg,
      } as Partial<CanvasNode>);
    }
  },

  setNodes: (nodes) => set({ nodes }),
  setConnections: (connections) => set({ connections }),

  //
  //
  //
  addAgentNodes: (input) => {
    const state = get();
    const { artifacts } = input;
    const projectId = state.projectId || 'global';

    const buckets: { kind: string; label: string; items: ArtifactLite[] }[] = [];
    const kindOrder: string[] = ['character', 'prop', 'scene', 'storyboard', 'novel', 'script', 'other'];
    const kindLabel: Record<string, string> = {
      character: 'character',
      prop: 'prop',
      scene: 'scene',
      storyboard: 'storyboard',
      novel: 'novel',
      script: 'script',
      other: 'other',
    };
    for (const kind of kindOrder) {
      const arr = (artifacts as Record<string, ArtifactLite[] | undefined>)[kind];
      if (Array.isArray(arr) && arr.length > 0) {
        buckets.push({ kind, label: kindLabel[kind] || kind, items: arr });
      }
    }
    for (const k of Object.keys(artifacts || {})) {
      if (kindOrder.includes(k)) continue;
      const arr = (artifacts as Record<string, ArtifactLite[] | undefined>)[k];
      if (Array.isArray(arr) && arr.length > 0) {
        buckets.push({ kind: k, label: k, items: arr });
      }
    }

    const HEADER_W = 220;
    const HEADER_H = 80;
    const IMG_W = 260;
    const IMG_H = 178;
    const ROW_GAP_Y = 32;
    const COL_GAP_X = 32;

    const newAssetRefs: TaskAssetRef[] = [];
    const assetNodeByKey = new Map<string, string>();
    const pendingReferenceEdges: Array<{ fromKey: string; toId: string }> = [];
    const t = getT();
    const assetTagMap: Record<string, string> = {
      character: 'assetTagCharacter',
      prop: 'assetTagProp',
      scene: 'assetTagBackground',
      storyboard: 'assetTagStoryboard',
      novel: 'canvasPanelAssetsNovel',
      script: 'canvasPanelAssetsScript',
    };

    set((s) => {
      const otherNodes = s.nodes.filter((n) => !n.id.startsWith('agent-'));
      const otherConns = s.connections.filter((c) => {
        const fromIsAgent = c.from.startsWith('agent-');
        const toIsAgent = c.to.startsWith('agent-');
        return !(fromIsAgent || toIsAgent);
      });
      const newAgentNodes: CanvasNode[] = [];

      const bucketHeights = buckets.map((bucket) => Math.max(IMG_H, bucket.items.length * (IMG_H + 12)) + 48);
      const rowHeights: number[] = [];
      buckets.forEach((_, index) => {
        const row = Math.floor(index / 3);
        rowHeights[row] = Math.max(rowHeights[row] || 0, bucketHeights[index]);
      });
      const rowOffsets: number[] = [];
      rowHeights.forEach((height, index) => {
        rowOffsets[index] = (rowOffsets[index - 1] || 0) + (index > 0 ? rowHeights[index - 1] + 72 : 0);
      });

      for (const [bucketIndex, bucket] of buckets.entries()) {
        const column = bucketIndex % 3;
        const row = Math.floor(bucketIndex / 3);
        const columnX = column * 390;
        const rowY = rowOffsets[row] || 0;
        const headerId = `agent-cat-${bucket.kind}-${projectId}`;
        const existingHeader = otherNodes.find((n) => n.id === headerId);
        const headerOverride = state.nodeOverrides[headerId] || { dx: 0, dy: 0 };
        if (false) newAgentNodes.push({
          id: headerId,
          type: 'prompt' as const,
          x: 0 + headerOverride.dx,
          y: runningY + headerOverride.dy,
          w: HEADER_W,
          h: HEADER_H,
          title: `${bucket.label} (${bucket.items.length})`,
          text: `${bucket.label} items: ${bucket.items.length}`,
          _agentLabel: bucket.label,
          _assetKind: bucket.kind,
          ...(existingHeader?.id ? {} : {}),
        } as CanvasNode);

        bucket.items.forEach((item, i) => {
          const assetId = (item.id as string) || `${bucket.kind}-${i}`;
          const imgNodeId = `agent-asset-${bucket.kind}-${projectId}-${assetId}`;
          const existingImg = otherNodes.find((n) => n.id === imgNodeId);
          const imgOverride = state.nodeOverrides[imgNodeId] || { dx: 0, dy: 0 };
          const itemUrl = (item as any).url as string | undefined;
          const itemName = ((item as any).name as string) || (item.asset_kind as string) || bucket.label;
          const itemPrompt = ((item as any).prompt as string) || '';
          const itemProviderId = ((item as any).provider_id as string) || '';
          const itemProviderName = ((item as any).provider_name as string) || itemProviderId;
          const itemModelId = ((item as any).model_id as string) || '';
          const registerAssetKey = (value: unknown) => {
            const key = typeof value === 'string'
              ? value.trim()
              : value && typeof value === 'object'
                ? String((value as any).id || (value as any).asset_id || (value as any).name || '').trim()
                : '';
            if (key) assetNodeByKey.set(key, imgNodeId);
          };
          registerAssetKey(assetId);
          registerAssetKey(itemName);
          registerAssetKey((item as any).asset_id);
          const extra = (item as any).extra && typeof (item as any).extra === 'object' ? (item as any).extra : {};
          const referenceValues = [
            (item as any).reference_asset_ids,
            (item as any).derived_from,
            (item as any).derivedFrom,
            extra.reference_asset_ids,
            extra.derived_from,
            extra.references,
          ].flatMap((value) => Array.isArray(value) ? value : value ? [value] : []);
          if (bucket.kind === 'storyboard') {
            referenceValues.forEach((value) => {
              const key = typeof value === 'string'
                ? value.trim()
                : value && typeof value === 'object'
                  ? String((value as any).id || (value as any).asset_id || (value as any).name || '').trim()
                  : '';
              if (key) pendingReferenceEdges.push({ fromKey: key, toId: imgNodeId });
            });
          }
          // 文本资产：body 可能放在 item.body（agent emit 的新格式）、
          // item.extra.body（兼容旧字段），或 item.url（最老版本兼容）。
          // TextReader 读 asset.body，这里必须从 item 里提取并写入 body 字段。
          const itemBody: string | undefined = (item as any).body
            ?? ((item as any).extra && typeof (item as any).extra === 'object' ? (item as any).extra.body : undefined)
            ?? (bucket.kind === 'novel' || bucket.kind === 'script' ? itemUrl : undefined);
          const itemTextStats = ((item as any).text_stats
            ?? ((item as any).extra && typeof (item as any).extra === 'object' ? (item as any).extra.text_stats : undefined)) || undefined;
          newAgentNodes.push({
            id: imgNodeId,
            // 关键修复：文本资产（novel/script）必须创建对应类型的节点（type='novel'/'script'），
            // 而不是强行塞进 'image' 上传节点。CanvasNode 根据 type 选择 NovelNodeBody/ScriptNodeBody 渲染，
            // 如果 type='image' 会显示成上传节点（Composer 浮窗、图片缩略图）。
            type: (bucket.kind === 'novel' || bucket.kind === 'script') ? bucket.kind as 'novel' | 'script' : 'image',
            x: columnX + imgOverride.dx,
            y: rowY + i * (IMG_H + 12) + imgOverride.dy,
            // 文本节点必须用 DEFAULT_NODE_SIZES.novel/script 的尺寸（与手动创建节点保持一致），
            // 否则会被压成 260x178 的图片节点，ScriptNodeBody 布局错乱。
            w: bucket.kind === 'novel' ? 420 : bucket.kind === 'script' ? 480 : IMG_W,
            h: bucket.kind === 'novel' ? 480 : bucket.kind === 'script' ? 420 : IMG_H,
            url: typeof itemUrl === 'string' ? itemUrl : '',
            name: itemName,
            // 关键修复：文本节点把 body 写入 node.text，并设置 _assetId 关联到 taskAssets，
            // 这样 NovelNodeBody/ScriptNodeBody 才能正确渲染（且 ScriptNodeBody 通过 _assetId 找到 taskAssets.body）。
            // 注意：必须用 imgNodeId（与下面 newAssetRefs.id 一致），不能用 assetId（item.id）。
            text: (bucket.kind === 'novel' || bucket.kind === 'script') ? (itemBody || '') : '',
            _assetId: (bucket.kind === 'novel' || bucket.kind === 'script') ? imgNodeId : '',
            generating: Boolean((item as any).generating),
            _assetFailed: Boolean((item as any).failed),
            _assetError: (item as any).error,
            _assetPrompt: itemPrompt,
            _assetProviderId: itemProviderId,
            _assetProviderName: itemProviderName,
            _assetModelId: itemModelId,
            _assetKind: bucket.kind,
            // 保留已有节点的尺寸与媒体自适应结果：否则每次 agent 轮询重建节点都会把
            // useMediaAutoFit 调好的高度重置为 IMG_H，Composer 浮窗位置随之跳动。
            ...(existingImg ? {
              running: existingImg.running,
              w: existingImg.w,
              h: existingImg.h,
              _imgAspect: existingImg._imgAspect,
              _imgChrome: existingImg._imgChrome,
            } : {}),
          } as CanvasNode);
          const tagKey = assetTagMap[bucket.kind] || '';
          const tagLabel = tagKey ? t(tagKey) : bucket.kind;
          newAssetRefs.push({
            id: imgNodeId,
            kind: bucket.kind as TaskAssetKind,
            name: itemName,
            url: typeof itemUrl === 'string' ? itemUrl : '',
            tags: Boolean((item as any).failed) ? [tagLabel, t('canvasPanelAssetTagFailed')] : [tagLabel],
            prompt: itemPrompt,
            providerId: itemProviderId || undefined,
            providerName: itemProviderName || undefined,
            modelId: itemModelId || undefined,
            generating: Boolean((item as any).generating),
            failed: Boolean((item as any).failed),
            error: (item as any).error,
            // 关键：把文本资产 body 写入 TaskAssetRef.body，否则 TextReader 打开为空
            body: itemBody,
            textStats: itemTextStats,
            // 关键：把后端 extra（含 extra.script 结构化 JSON）透传到 TaskAssetRef，
            // 否则 ScriptNodeBody 拿不到 characters/props/scenes/bigShots/visualSignature，
            // 渲染时 tabs 全 0。toTaskAssetRef 路径已经处理过这条，这次补齐 agent 路径。
            extra: (item as any).extra || undefined,
          });
        });

      }

      const agentConnections = pendingReferenceEdges
        .map((edge, index) => {
          const from = assetNodeByKey.get(edge.fromKey);
          if (!from || from === edge.toId) return null;
          return { id: `agent-ref-${projectId}-${index}-${from}-${edge.toId}`, from, to: edge.toId };
        })
        .filter((edge): edge is { id: string; from: string; to: string } => !!edge)
        .filter((edge, index, all) => all.findIndex((candidate) => candidate.from === edge.from && candidate.to === edge.to) === index);

      return {
        // 关键修复：保留所有 agent 创建的节点类型（image/novel/script/...），
        // 之前只过滤 image 导致 novel/script 被丢弃 → 用户看到的是"上传"节点。
        nodes: [...otherNodes, ...newAgentNodes],
        // These are functional reference edges: ComposerPanel and retry logic read
        // the connected image URLs, so clicking a storyboard node uses the same
        // character/scene assets that the agent used.
        connections: [...otherConns, ...agentConnections],
      };
    });

    const prevAssets = get().taskAssets || [];
    const nonAgentAssets = prevAssets.filter((a) => !a.id.startsWith('agent-asset-'));
    get().setTaskAssets([...nonAgentAssets, ...newAssetRefs]);
    const prevById = new Map(prevAssets.map((a) => [a.id, a]));
    for (const ref of newAssetRefs) {
      const prev = prevById.get(ref.id);
      if (!prev || prev.url !== ref.url) {
        void syncAssetCreate(ref, get().projectId || undefined);
      }
    }
  },

  clearAgentNodes: () =>
    set((s) => {
      const removed = new Set(s.nodes.filter((n) => n.id.startsWith('agent-')).map((n) => n.id));
      return {
        nodes: s.nodes.filter((n) => !removed.has(n.id)),
        connections: s.connections.filter((c) => !removed.has(c.from) && !removed.has(c.to)),
        selected: new Set([...s.selected].filter((id) => !removed.has(id))),
        taskAssets: s.taskAssets.filter((a) => !a.id.startsWith('agent-asset-')),
      };
    }),

  /* legacy agent timeline drag handling removed */
  /* recordAgentNodeDrag: (nodeId, x, y) =>
    set((s) => {
      const node = s.nodes.find((n) => n.id === nodeId);
      if (!node || !node.id.startsWith('agent-')) return s;
      const peers = s.nodes
        .filter((n) => n.id.startsWith('agent-'))
        .sort((a, b) => (a.y - b.y) || (a.x - b.x));
      const idx = peers.findIndex((n) => n.id === nodeId);
      if (idx < 0) return s;
      const baseX = node.x;
      const baseY = node.y;
      return {
        nodeOverrides: { ...s.nodeOverrides, [nodeId]: { dx: x - baseX, dy: y - baseY } },
      };
    }), */

  /* relayoutAgentNodes: () =>
    set((s) => {
      const agentNodes = s.nodes.filter((n) => n.id.startsWith('agent-'));
      if (!agentNodes.length) return s;
      const HEADER_W = 220;
      const HEADER_H = 80;
      const IMG_W = 260;
      const IMG_H = 178;
      const ROW_GAP_Y = 32;
      const COL_GAP_X = 32;

      const headers = agentNodes.filter((n) => n.type === 'prompt');
      const imagesByGroup = new Map<string, CanvasNode[]>();
      for (const img of agentNodes.filter((n) => n.type === 'image')) {
        const gid = (img._groupId as string) || '';
        if (!imagesByGroup.has(gid)) imagesByGroup.set(gid, []);
        imagesByGroup.get(gid)!.push(img);
      }

      const newAgentNodes: CanvasNode[] = [];
      let runningY = 0;
      for (const header of headers) {
        const images = imagesByGroup.get(header.id) || [];
        newAgentNodes.push({ ...header, x: 0, y: runningY, w: HEADER_W, h: HEADER_H });
        const imageX = HEADER_W + COL_GAP_X;
        images.forEach((img, i) => {
          newAgentNodes.push({
            ...img,
            x: imageX,
            y: runningY + i * (IMG_H + 12),
            w: IMG_W,
            h: IMG_H,
          });
        });
        const stackHeight = Math.max(HEADER_H, images.length * (IMG_H + 12));
        runningY += stackHeight + ROW_GAP_Y;
      }

      const otherNodes = s.nodes.filter((n) => !n.id.startsWith('agent-'));
      return {
        nodes: [...otherNodes, ...newAgentNodes],
        connections: s.connections,
        nodeOverrides: {},
      };
    }), */

  fitAgentView: (boardW, boardH) => {
    const state = get();
    const agents = state.nodes.filter((n) => n.id.startsWith('agent-'));
    if (!agents.length) return;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const n of agents) {
      minX = Math.min(minX, n.x);
      minY = Math.min(minY, n.y);
      maxX = Math.max(maxX, n.x + (n.w || 260));
      maxY = Math.max(maxY, n.y + (n.h || 178));
    }
    const PADDING = 32;
    const bboxW = maxX - minX;
    const bboxH = maxY - minY;
    if (bboxW <= 0 || bboxH <= 0) return;
    const w = Math.max(boardW || 0, 600);
    const h = Math.max(boardH || 0, 400);
    const scaleX = (w - PADDING * 2) / bboxW;
    const scaleY = (h - PADDING * 2) / bboxH;
    let scale = Math.min(scaleX, scaleY, 1);
    scale = Math.max(scale, 0.5);
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    const x = w / 2 - cx * scale;
    const y = h / 2 - cy * scale;
    set({ viewport: { x, y, scale } });
  },

  resetViewportToAgentOrigin: (boardW, boardH) => {
    const w = Math.max(boardW || 0, 600);
    const h = Math.max(boardH || 0, 400);
    set({ viewport: { x: w / 2, y: h / 2, scale: 1 } });
  },

  reset: () =>
    set({
      nodes: [],
      connections: [],
      selected: new Set(),
      undoStack: [],
      clipboard: [],
      assetPanelOpen: false,
      viewport: { x: -1800, y: -1000, scale: 1 },
      cascadeRunning: false,
      cascadeRunPath: [],
      cascadeNodeStatus: new Map(),
      nodeOverrides: {},
    }),

  loadProject: (projectId: string) => {
    const currentProjectId = get().projectId;
    if (currentProjectId === projectId) return;
    // 请求序号 + hydrate 守卫：清空画布后到 loadFromBackend 完成前，
    // 订阅保存不得把空 nodes 覆盖到后端；返回时若项目已再次切换则丢弃结果。
    const seq = ++loadProjectSeq;
    hydratingProjectId = projectId;
    set({
      projectId,
      nodes: [],
      connections: [],
      viewport: { x: -1800, y: -1000, scale: 1 },
      taskAssets: [],
      selected: new Set(),
      undoStack: [],
      clipboard: [],
      assetPanelOpen: false,
      composerOpen: false,
      cascadeRunning: false,
      cascadeRunPath: [],
      cascadeNodeStatus: new Map(),
    });
    void (async () => {
      const data = await loadFromBackend(projectId);
      // 竞态守卫：加载期间项目已被再次切换（A→B 后 A 的慢响应返回），丢弃过期结果
      if (seq !== loadProjectSeq || get().projectId !== projectId) return;
      // 解除 hydrate 守卫（成功与失败路径都要解除）
      hydratingProjectId = null;
      if (!data) return;
      const nodes = data.nodes || [];
      const taskAssets = (data.taskAssets && data.taskAssets.length > 0)
        ? data.taskAssets
        : rebuildTaskAssetsFromNodes(nodes);
      set({
        nodes,
        connections: data.connections || [],
        viewport: data.viewport || { x: -1800, y: -1000, scale: 1 },
        taskAssets,
      });
    })();
  },
}));

useCanvasStore.subscribe((state) => {
  if (!state.projectId) return;
  scheduleSaveNodes(state.projectId, state.nodes);
  scheduleSaveConnections(state.projectId, state.connections);
  scheduleSaveViewport(state.projectId, state.viewport);
  saveApiConfig(state.apiConfig);
});

export function createNode(
  type: CanvasNode['type'],
  point: { x: number; y: number },
  extra: Partial<CanvasNode> = {}
): CanvasNode {
  const size = DEFAULT_NODE_SIZES[type] || { w: 260 };
  return {
    id: uid(type),
    type,
    x: point.x,
    y: point.y,
    w: size.w,
    h: size.h,
    ...extra,
  };
}
