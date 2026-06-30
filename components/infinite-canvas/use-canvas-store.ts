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
