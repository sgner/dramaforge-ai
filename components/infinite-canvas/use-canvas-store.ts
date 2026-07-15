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
  DEFAULT_STEP_BINDINGS,
  ModelConfig,
  Provider,
  ArtStyle,
  Language,
  getProviderForStep,
  getModelForStep,
} from '../../types';
import { generateSoraVideo, generateCharacterDesign, generateStoryboardImage, generatePropImage } from '../../services/mediaService';
import { expandIdeaToStory, generateScriptFromNovel, optimizeSoraPrompt } from '../../services/llmClient';
import { getT } from '../../i18n';
import { api, type NodeOut, type ConnectionOut, type AssetOut } from '../../services/apiClient';

// 本地轻量类型别名 — 避免与 agent/use-agent-store.ts 形成循环导入
type AgentEventLite = { type: string; payload?: Record<string, any>; timestamp?: number };
type ArtifactLite = { id: string; kind?: string; asset_kind?: string; name?: string; url?: string; [k: string]: any };
type QuestionLite = { question: string; options?: string[]; [k: string]: any };

export type NodeRenderer = (node: CanvasNode) => React.ReactNode;

// Pipeline AbortController 存储（运行时，不持久化）
const pipelineAbortControllers = new Map<string, AbortController>();

// ============ 后端 API 包装（localStorage 已废弃，所有数据走 FastAPI + SQLite）============

/**
 * 从后端加载项目快照，返回 { nodes, connections, viewport, theme, taskAssets }
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
    // 404: 项目在后端不存在，自动创建一个空项目以便后续保存能成功
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
  } as TaskAssetRef;
}

function fromTaskAssetRef(r: TaskAssetRef, projectId?: string): Partial<AssetOut> & { kind: string } {
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
  };
}

// 防抖保存：避免每次 state 微变化都打后端
let saveNodesTimer: ReturnType<typeof setTimeout> | null = null;
let saveConnTimer: ReturnType<typeof setTimeout> | null = null;
let saveViewTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleSaveNodes(projectId: string, nodes: CanvasNode[]) {
  if (saveNodesTimer) clearTimeout(saveNodesTimer);
  saveNodesTimer = setTimeout(() => {
    api.saveNodes(projectId, nodes.map(fromCanvasNode)).catch((e) => console.warn('[dramaforge] saveNodes failed', e));
  }, 600);
}

function scheduleSaveConnections(projectId: string, conns: Connection[]) {
  if (saveConnTimer) clearTimeout(saveConnTimer);
  saveConnTimer = setTimeout(() => {
    api.saveConnections(projectId, conns.map(fromConnection)).catch((e) => console.warn('[dramaforge] saveConnections failed', e));
  }, 600);
}

function scheduleSaveViewport(projectId: string, viewport: Viewport) {
  if (saveViewTimer) clearTimeout(saveViewTimer);
  saveViewTimer = setTimeout(() => {
    api.updateProject(projectId, { viewport: { x: viewport.x, y: viewport.y, scale: Math.round(viewport.scale * 100) } })
      .catch((e) => console.warn('[dramaforge] saveViewport failed', e));
  }, 800);
}

// 同步创建/更新/删除资产到后端
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

// 从画布节点反向重建 taskAssets（兜底：旧数据没有保存 taskAssets 字段时使用）
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
      // 文本资产把 text 作为 prompt 的补充展示（侧栏用 assetKind=text 渲染卡片）
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
    if (data && data.providers && data.stepBindings) {
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
      // Migrate old stepBindings format
      data.stepBindings = (data.stepBindings || []).map((b: any) => ({
        step: b.step,
        providerId: b.providerId || b.provider_id || '',
        modelId: b.modelId || b.model_id || '',
      }));
      return data;
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
 * 供应商迁移：localStorage → 后端 DB
 * 实际逻辑在 services/mediaProviderMigration.ts；这里保留旧名 re-export 避免破坏调用方。
 * 一次性：完成后写 `dramaforge-media-migrated-v1=1`，后续不再尝试。
 * 目标：把用户此前在前端 localStorage 配置的供应商（含 apiKey）一次性入库；
 *       之后所有读 / 写都走后端，前端不再持有明文 apiKey。
 * ======================== */
export {
  migrateLocalProvidersToBackend,
  resetMediaMigrationFlag,
  type MigrationResult,
} from '../../services/mediaProviderMigration';

function createDefaultApiConfig(): ApiConfig {
  return {
    providers: DEFAULT_PROVIDERS.map(p => ({
      ...p,
      imageModels: [...p.imageModels],
      chatModels: [...p.chatModels],
      videoModels: [...p.videoModels],
    })),
    stepBindings: DEFAULT_STEP_BINDINGS.map(b => ({ ...b })),
  };
}

// 初始化为空状态 — 真实数据由 loadProject 异步从后端拉取
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

  // Pipeline action — 将小说/想法转换为资产节点
  runPipeline: (nodeId: string, params: {
    inputText: string;
    sourceType: 'novel' | 'idea';
    style: ArtStyle;
    language: Language;
  }) => Promise<void>;

  // Pipeline 停止执行
  stopPipeline: (nodeId: string) => void;

  // 重试/重新生成单个资产（支持失败资产重试 + 正常资产重新生成 + 自定义 prompt）
  retryFailedAsset: (taskAssetId: string, customPrompt?: string) => Promise<void>;

  setNodes: (nodes: CanvasNode[]) => void;
  setConnections: (connections: Connection[]) => void;
  reset: () => void;
  loadProject: (projectId: string) => void;

  // AgentMode × Canvas 集成：把 agent 事件投影到 7 列画布节点
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

  /** 自动缩放 viewport 以容纳所有 agent_node + 一些 padding，让用户一眼看到完整时间线 */
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
      nodes: s.nodes.map((n) => (n.id === id ? { ...n, w, h } : n)),
    })),

  addConnection: (from, to) =>
    set((s) => ({
      connections: [
        ...s.connections,
        { id: uid('c'), from, to },
      ],
    })),

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
      get().updateNode(nodeId, { runStatus: 'failed', runError: t('canvasVideoNoProvider') });
      return;
    }
    // modelId 是模型名字符串（来自 Provider.videoModels）
    const modelName = modelId;
    if (!modelName) {
      get().updateNode(nodeId, { runStatus: 'failed', runError: t('canvasVideoSelectModel') });
      return;
    }

    // 从 Provider 和模型名构建 ModelConfig
    const model: ModelConfig = {
      id: modelName,
      providerId: provider.id,
      modelName,
      displayName: modelName,
      apiPath: '/video/generations',
      apiFormat: 'openai-video',
      customHeaders: '',
      customBodyTemplate: '',
      customResponsePath: '',
      pollApiPath: '',
      enabled: true,
    };

    get().updateNode(nodeId, { runStatus: 'running', runError: undefined, running: true });

    try {
      const referenceImage = inputImageUrls[0];
      const videoUrl = await generateSoraVideo(
        prompt,
        'cinematic',
        'zh',
        provider,
        model,
        referenceImage,
        (status) => {
          get().updateNode(nodeId, { runError: status });
        }
      );

      get().updateNode(nodeId, {
        url: videoUrl,
        mediaKind: 'video',
        runStatus: 'done',
        running: false,
        runError: undefined,
      });
    } catch (e: any) {
      get().updateNode(nodeId, {
        runStatus: 'failed',
        running: false,
        runError: e.message || t('canvasVideoStatusFailed'),
      });
    }
  },

  runPipeline: async (nodeId, params) => {
    const t = getT();
    const cfg = get().apiConfig;
    const pipelineNode = get().nodes.find(n => n.id === nodeId);
    if (!pipelineNode) return;

    // 辅助：更新流水线节点状态
    const updatePipeline = (updates: Partial<CanvasNode>) => get().updateNode(nodeId, updates);

    // 辅助：日志
    const log = (msg: string) => {
      const node = get().nodes.find(n => n.id === nodeId);
      const prevLog = (node?._pipelineLog as string[]) || [];
      updatePipeline({ _pipelineLog: [...prevLog, msg] });
    };

    // 辅助：检查是否已停止
    const isStopped = () => {
      const controller = pipelineAbortControllers.get(nodeId);
      return !controller || controller.signal.aborted;
    };

    // 辅助：标记步骤完成
    const markStepDone = (step: string) => {
      const node = get().nodes.find(n => n.id === nodeId);
      const completed = (node?._pipelineCompletedSteps as string[]) || [];
      if (!completed.includes(step)) {
        updatePipeline({ _pipelineCompletedSteps: [...completed, step] });
      }
    };

    // 辅助：检查步骤是否已完成（断点续执行）
    const isStepDone = (step: string) => {
      const completed = (pipelineNode._pipelineCompletedSteps as string[]) || [];
      return completed.includes(step);
    };

    // 辅助：创建资产组节点并返回组 ID
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

    // 辅助：在组内添加资产节点（不连线）并同步到 taskAssets
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
      // 更新组的 items 列表和尺寸
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
      // 同步到 taskAssets（让资产库侧栏实时显示）
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
      // 用 setTaskAssets 替换以避免增量冲突
      const current = get().taskAssets.filter(a => a.id !== assetRef.id);
      get().setTaskAssets([...current, assetRef]);
      // 同步到后端
      void syncAssetCreate(assetRef, get().projectId || undefined);
    };

    // 辅助：记录一个失败的资产（保留提示词 + 错误信息），并在画布上占位展示
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
      // 使用稳定 ID 便于后续重试时按 id 替换
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
      // 更新组的 items 列表和尺寸
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
      // 同步到 taskAssets（保留提示词 + 错误）
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
      // 同步到后端
      void syncAssetCreate(assetRef, get().projectId || undefined);
    };

    // 辅助：创建文本资产节点（小说/脚本等）并同步到 taskAssets
    const addTextAssetNode = (text: string, title: string, kind: string, offsetX: number, metadata?: { providerId?: string; providerName?: string; modelId?: string }) => {
      // kind 为 novel/script 时使用专用节点类型
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
      // 同步到 taskAssets：对于文本资产，url 字段用 data URL 形式存储
      // 但为了避免在侧栏显示图片，kind 为 novel/script 时会被侧栏特殊渲染
      const assetRef: TaskAssetRef = {
        id: textNode.id,
        kind: kind as TaskAssetKind,
        name: title,
        url: '', // 文本资产 url 为空
        tags: [kind === 'novel' ? t('assetTagNovel') : t('assetTagScript')],
        prompt: text,
        providerId: metadata?.providerId,
        providerName: metadata?.providerName,
        modelId: metadata?.modelId,
      };
      const current = get().taskAssets.filter(a => a.id !== assetRef.id);
      get().setTaskAssets([...current, assetRef]);
      // 同步到后端
      void syncAssetCreate(assetRef, get().projectId || undefined);
      return textNode.id;
    };

    // 辅助：流式更新文本资产（仅在生成中增量更新文本内容）
    const updateTextAssetContent = (assetId: string, text: string, generating: boolean) => {
      const current = get().taskAssets;
      const updated = current.map(a =>
        a.id === assetId ? { ...a, prompt: text, generating } : a
      );
      get().setTaskAssets(updated);
      // 同时更新画布节点 text
      get().updateNode(assetId, { text });
    };

    // 创建 AbortController
    const abortController = new AbortController();
    pipelineAbortControllers.set(nodeId, abortController);
    const signal = abortController.signal;

    // 判断是否为续执行
    const isResume = !!(pipelineNode._pipelineStopped && pipelineNode._pipelineParams);
    const resumeParams = isResume ? pipelineNode._pipelineParams! : params;
    const { inputText, sourceType, style, language } = resumeParams;

    // 初始化
    updatePipeline({
      running: true,
      runStatus: 'running',
      runError: undefined,
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

          // 准备小说资产节点（在生成中先创建占位节点）
          const novelNodeId = addTextAssetNode('', t('canvasPipelineAssetNovel'), 'novel', 0, {
            providerId: llmProvider.id,
            providerName: llmProvider.name,
            modelId: llmModel.modelName,
          });
          processedText = '';
          for await (const chunk of expandIdeaToStory(llmProvider, llmModel, inputText, language, signal)) {
            processedText += chunk;
            updatePipeline({ _pipelinePreview: processedText.slice(-200) });
            // 流式同步到资产库
            updateTextAssetContent(novelNodeId, processedText, true);
          }
          // 标记生成完成
          updateTextAssetContent(novelNodeId, processedText, false);
        } else {
          // 原始小说直接入库（立即完成）
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

        // 准备脚本资产节点（在生成中先创建占位节点）
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
          // 流式同步到资产库
          const partialText = JSON.stringify(partial, null, 2);
          if (partialText !== accumulatedText) {
            accumulatedText = partialText;
            updateTextAssetContent(scriptNodeId, partialText, true);
          }
        }
        // 标记脚本生成完成
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
          // 创建角色资产组
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
                let optimized = '';
                for await (const chunk of optimizeSoraPrompt(optProvider, optModel, originalPrompt, style, language, visualSignature, signal)) {
                  optimized += chunk;
                }
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

      // ===== 完成 =====
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
        // 用户主动停止
        updatePipeline({
          running: false,
          runStatus: 'stopped',
          _pipelineStopped: true,
          _pipelineStep: t('canvasPipelineStepStopped'),
          _pipelineLog: [...currentLog, t('canvasPipelineLogStopped')],
        });
      } else {
        // 执行失败
        const errorMsg = e.message || t('canvasPipelineUnknownError');
        updatePipeline({
          running: false,
          runStatus: 'failed',
          runError: errorMsg,
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

  // 重试/重新生成单个资产（支持失败资产重试 + 正常资产重新生成 + 自定义 prompt）
  retryFailedAsset: async (taskAssetId: string, customPrompt?: string) => {
    const t = getT();
    const cfg = get().apiConfig;
    let asset = get().taskAssets.find(a => a.id === taskAssetId);
    // 找不到 taskAsset 时，根据画布节点信息自动创建一个临时资产（支持上传节点直接生成）
    if (!asset) {
      const canvasNode0 = get().nodes.find(n => n.id === taskAssetId);
      if (!canvasNode0) return;
      // 推断资产类型：节点 _assetKind 优先，否则根据节点类型推断
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
      // 写入 taskAssets 列表并同步后端
      get().setTaskAssets([...get().taskAssets, newAsset]);
      void syncAssetCreate(newAsset, get().projectId || undefined);
      asset = newAsset;
    }

    // 标记为重试中（generating + 清空 failed）
    const updatedAssets = get().taskAssets.map(a =>
      a.id === taskAssetId
        ? { ...a, failed: false, error: undefined, generating: true, prompt: customPrompt ?? a.prompt }
        : a
    );
    get().setTaskAssets(updatedAssets);
    // 同步后端
    const retryingAsset = updatedAssets.find(a => a.id === taskAssetId);
    if (retryingAsset) void syncAssetUpdate(retryingAsset);

    // 找到对应画布节点（位置信息）
    const canvasNode = get().nodes.find(n => n.id === taskAssetId);

    try {
      // 找到供应商/模型：优先使用资产保存的 providerId / modelId
      const step = (asset.kind === 'character' || asset.kind === 'prop') ? 'characterDesign' : 'storyboarding';
      let provider = cfg.providers.find(p => p.id === asset.providerId && p.enabled);
      if (!provider) provider = getProviderForStep(cfg, step) || undefined;
      // 复用 step 默认模型（已包含完整的 apiPath/apiFormat 等）
      let model = getModelForStep(cfg, step);
      // 如果资产记录了不同的 modelName 但默认绑定模型名不同，则构造一个临时 ModelConfig
      if (provider && asset.modelId && model && model.modelName !== asset.modelId) {
        model = { ...model, modelName: asset.modelId } as any;
      }

      if (!provider || !model) {
        throw new Error(t('canvasPanelRetryNoProvider'));
      }

      let url = '';
      const prompt = customPrompt || asset.prompt || asset.name || '';
      if (asset.kind === 'character') {
        // 角色没有原始 char 对象，直接用 prompt 生成
        url = await generatePropImage(prompt, provider, model, undefined);
      } else if (asset.kind === 'prop' || asset.kind === 'scene') {
        url = await generatePropImage(prompt, provider, model, undefined);
      } else if (asset.kind === 'storyboard') {
        url = await generateStoryboardImage(prompt, '', 'zh', '', [], provider, model, undefined);
      } else {
        throw new Error(t('canvasPanelRetryUnsupportedKind').replace('{0}', asset.kind));
      }

      // 成功：更新 taskAssets + 画布节点 url + prompt
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
          _assetProviderId: provider!.id,
          _assetProviderName: provider!.name,
          _assetModelId: model!.modelName,
        } as Partial<CanvasNode>);
      }
    } catch (e: any) {
      // 失败：保留 failed 状态，更新错误信息
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
          _assetError: errorMsg,
        } as Partial<CanvasNode>);
      }
    }
  },

  setNodes: (nodes) => set({ nodes }),
  setConnections: (connections) => set({ connections }),

  // AgentMode × Canvas 集成：把 agent 产出的资产投影到画布。
  //
  // 设计原则：复用现有的 'image' 节点类型（不是再造轮子）。
  // 'image' 节点已经支持：上传、展示、Image-to-Image 生成、重试、右键菜单
  // （预览/编辑/复制URL/下载/删除）、资产元数据展示。
  // 每个 agent 资产 → 一个 'image' 节点；每个 asset_kind 桶 → 一个 'prompt'
  // header 节点做分类标签。
  //
  // 布局：每个分类一行
  //   ┌─ Header (prompt, "角色 (3)")  ┐
  //                                  │ image
  //                                  │ image
  //                                  │ image
  //   Header (prompt, "场景 (1)")  ┐  image
  //   Header (prompt, "分镜 (2)")  ┐  image
  //                              │  image
  //                              │  image
  //
  // ID 前缀约定（用于 clearAgentNodes / relayoutAgentNodes 过滤）：
  //   - image 节点：   `agent-asset-{kind}-{projectId}-{assetId}`
  //   - header 节点：  `agent-cat-{kind}-{projectId}`
  //   任何 `id.startsWith('agent-')` 的节点都视为 agent 投影节点，clear/relayout 时清掉。
  addAgentNodes: (input) => {
    const state = get();
    const { artifacts } = input;
    const projectId = state.projectId || 'global';

    // 1) 把 artifacts 按 asset_kind 桶分类
    const buckets: { kind: string; label: string; items: ArtifactLite[] }[] = [];
    const kindOrder: string[] = ['character', 'prop', 'scene', 'storyboard', 'novel', 'script', 'other'];
    const kindLabel: Record<string, string> = {
      character: '角色',
      prop: '道具',
      scene: '场景',
      storyboard: '分镜',
      novel: '小说',
      script: '剧本',
      other: '其他',
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

    // 2) 布局常量
    const HEADER_W = 220;
    const HEADER_H = 80;
    const IMG_W = 260;     // 复用 DEFAULT_NODE_SIZES.image.w
    const IMG_H = 178;     // 复用 DEFAULT_NODE_SIZES.image.h
    const ROW_GAP_Y = 32;  // 类别之间的垂直间距
    const COL_GAP_X = 32;  // header 与 image、image 与 image 之间的水平间距

    // 3) 应用更新：先清掉所有 agent 投影节点（按 id 前缀），再加新的
    set((s) => {
      // 保留所有非 agent 节点（user-drawn）
      const otherNodes = s.nodes.filter((n) => !n.id.startsWith('agent-'));
      const otherConns = s.connections.filter((c) => {
        const fromIsAgent = c.from.startsWith('agent-');
        const toIsAgent = c.to.startsWith('agent-');
        return !(fromIsAgent || toIsAgent);
      });
      const newAgentNodes: CanvasNode[] = [];

      // 跟踪所有 agent 节点的 id，用于过滤 connection
      let runningY = 0;
      for (const bucket of buckets) {
        // 3.1) 这个分类的 header (prompt 节点)
        const headerId = `agent-cat-${bucket.kind}-${projectId}`;
        const existingHeader = otherNodes.find((n) => n.id === headerId);
        const headerOverride = state.nodeOverrides[headerId] || { dx: 0, dy: 0 };
        // 分类标题不再创建节点；资产直接复用普通 image 节点。
        if (false) newAgentNodes.push({
          id: headerId,
          type: 'prompt' as const,
          x: 0 + headerOverride.dx,
          y: runningY + headerOverride.dy,
          w: HEADER_W,
          h: HEADER_H,
          title: `${bucket.label} (${bucket.items.length})`,
          text: `${bucket.label} · ${bucket.items.length} 个资产\n\nagent 已生成 ${bucket.items.length} 个「${bucket.label}」类资产。点击下方任一图片可继续编辑 / 上传 / 基于此图继续生成。`,
          // 标记：用于区分 agent header 与用户画的 prompt
          _agentLabel: bucket.label,
          _assetKind: bucket.kind,
          ...(existingHeader?.id ? {} : {}),
        } as CanvasNode);

        // 3.2) 这个分类下的每个 image 节点
        const imageX = 0;
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
          newAgentNodes.push({
            id: imgNodeId,
            type: 'image' as const,
            x: imageX + imgOverride.dx,
            y: runningY + i * (IMG_H + 12) + imgOverride.dy, // 同一分类内 images 垂直堆叠
            w: IMG_W,
            h: IMG_H,
            url: typeof itemUrl === 'string' ? itemUrl : '',
            name: itemName,
            // 资产元数据（image 节点原生支持）
            _assetPrompt: itemPrompt,
            _assetProviderId: itemProviderId,
            _assetProviderName: itemProviderName,
            _assetModelId: itemModelId,
            _assetKind: bucket.kind,
            // 保留用户拖动过的其他字段
            ...(existingImg ? { running: existingImg.running } : {}),
          } as CanvasNode);
        });

        // 下一个分类从 (runningY + max(HEADER_H, items_count * IMG_H) + ROW_GAP_Y) 开始
        const stackHeight = Math.max(HEADER_H, bucket.items.length * (IMG_H + 12));
        runningY += stackHeight + ROW_GAP_Y;
      }

      return {
        // AgentMode 只允许资产进入画布；agent 过程由 ThoughtStream 展示。
        nodes: [...otherNodes, ...newAgentNodes.filter((node) => node.type === 'image')],
        connections: otherConns,
      };
    });
  },

  clearAgentNodes: () =>
    // 按 id 前缀过滤：所有 'agent-' 开头的节点都是 agent 投影出来的
    // （包括 image / prompt header / 旧的 agent_node timeline）
    set((s) => {
      const removed = new Set(s.nodes.filter((n) => n.id.startsWith('agent-')).map((n) => n.id));
      return {
        nodes: s.nodes.filter((n) => !removed.has(n.id)),
        connections: s.connections.filter((c) => !removed.has(c.from) && !removed.has(c.to)),
        selected: new Set([...s.selected].filter((id) => !removed.has(id))),
      };
    }),

  // 用户拖动 agent 节点时记录偏移。适用所有 id 以 'agent-' 开头的节点
  // （image / prompt header / 旧 agent_node）。根据节点类型用对应基准尺寸。
  /* legacy agent timeline drag handling removed */
  /* recordAgentNodeDrag: (nodeId, x, y) =>
    set((s) => {
      const node = s.nodes.find((n) => n.id === nodeId);
      if (!node || !node.id.startsWith('agent-')) return s;
      // 找该节点所属 "行"（同一 _groupId 或按 y→x 排序）
      const peers = s.nodes
        .filter((n) => n.id.startsWith('agent-'))
        .sort((a, b) => (a.y - b.y) || (a.x - b.x));
      const idx = peers.findIndex((n) => n.id === nodeId);
      if (idx < 0) return s;
      // 用节点实际尺寸算基准位置
      const baseX = node.x; // 不算 dx/dy 时 x 就是 base，因为 set 时已经加过
      const baseY = node.y;
      return {
        nodeOverrides: { ...s.nodeOverrides, [nodeId]: { dx: x - baseX, dy: y - baseY } },
      };
    }), */

  // 重新整理 agent 节点布局：按所属 _groupId 分组、按 y→x 排序、清空 override
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

      // 按 _groupId 分组：header 自己一组（_groupId 是它自己的 id）；
      // image 节点按 _groupId 聚到对应 header。
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
      // 不创建 agent 之间的连接（资产之间无强时序）
      return {
        nodes: [...otherNodes, ...newAgentNodes],
        connections: s.connections,
        nodeOverrides: {},
      };
    }), */

  // 自动缩放 viewport 让用户一眼看到完整 agent 时间线
  // 算法：取所有 id 以 'agent-' 开头的节点（image 资产 + prompt header）的
  // bbox → 算合适 scale → 算 viewport xy 居中
  // 容错：boardW/boardH 极小时也能 fit（防止 div 还没渲染好时调用）
  fitAgentView: (boardW, boardH) => {
    const state = get();
    const agents = state.nodes.filter((n) => n.id.startsWith('agent-'));
    if (!agents.length) return;
    // 包围盒
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const n of agents) {
      minX = Math.min(minX, n.x);
      minY = Math.min(minY, n.y);
      maxX = Math.max(maxX, n.x + (n.w || 260));
      maxY = Math.max(maxY, n.y + (n.h || 178));
    }
    // padding：四周各留 32px
    const PADDING = 32;
    const bboxW = maxX - minX;
    const bboxH = maxY - minY;
    if (bboxW <= 0 || bboxH <= 0) return;
    // 兜底 board 尺寸（避免 0 除）
    const w = Math.max(boardW || 0, 600);
    const h = Math.max(boardH || 0, 400);
    // 计算合适 scale：保证不放大（scale ≤ 1）但能 fit 整张时间线
    const scaleX = (w - PADDING * 2) / bboxW;
    const scaleY = (h - PADDING * 2) / bboxH;
    let scale = Math.min(scaleX, scaleY, 1);
    scale = Math.max(scale, 0.5); // 下限：不要缩太小看不清
    // 居中
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    const x = w / 2 - cx * scale;
    const y = h / 2 - cy * scale;
    set({ viewport: { x, y, scale } });
  },

  // 把 viewport 移动到 (0, 0) 区域（agent 节点布局原点），用于"刚进入 agent 模式还没有节点"时
  // 避免 viewport 默认在 (-1800, -1000) 远离节点位置
  resetViewportToAgentOrigin: (boardW, boardH) => {
    const w = Math.max(boardW || 0, 600);
    const h = Math.max(boardH || 0, 400);
    // 把画布中心放到 (0, 0) 区域
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
    // 1) 立即清空当前状态
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
    // 2) 异步从后端拉取快照
    void (async () => {
      const data = await loadFromBackend(projectId);
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

// Auto-save 到后端（替代 localStorage）
useCanvasStore.subscribe((state) => {
  if (!state.projectId) return; // 未选择项目时不打后端
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
