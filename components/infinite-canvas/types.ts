export type CanvasTheme = 'light' | 'dark';

export interface CanvasInfo {
  id: string;
  title: string;
  emoji?: string;
  updatedAt: number;
  nodeCount: number;
  deleted?: boolean;
}

export interface Viewport {
  x: number;
  y: number;
  scale: number;
}

export type TaskType =
  | 'goal'
  | 'plan'
  | 'action'
  | 'observation'
  | 'artifact'
  | 'question'
  | 'done';

export type NodeType =
  | 'image'
  | 'prompt'
  | 'loop'
  | 'group'
  | 'promptGroup'
  | 'video'
  | 'pipeline'
  | 'novel'
  | 'script'
  | 'agent_node';

// agent_node 视觉元数据（与 task-graph-node.tsx 中的 TYPE_META 保持一致）
export const AGENT_TYPE_META: Record<TaskType, { label: string; color: string; icon: string }> = {
  goal: { label: '目标', color: '#6366f1', icon: '🎯' },
  plan: { label: '计划', color: '#8b5cf6', icon: '📋' },
  action: { label: '动作', color: '#0ea5e9', icon: '⚡' },
  observation: { label: '观察', color: '#14b8a6', icon: '👁' },
  artifact: { label: '资产', color: '#ec4899', icon: '🎨' },
  question: { label: '询问', color: '#f59e0b', icon: '❓' },
  done: { label: '完成', color: '#10b981', icon: '✅' },
};

// 7 列 x 坐标（间距 320 px，节点宽 280 + 间距 40）
export const AGENT_COL_X: Record<TaskType, number> = {
  goal: 0,
  plan: 320,
  action: 640,
  observation: 960,
  artifact: 1280,
  question: 1600,
  done: 1920,
};

export const AGENT_NODE_W = 280;
export const AGENT_NODE_H = 200;
export const AGENT_ROW_GAP = 40;

export interface CanvasNode {
  id: string;
  type: NodeType;
  x: number;
  y: number;
  w: number;
  h?: number;
  title?: string;
  url?: string;
  text?: string;
  items?: string[];
  running?: boolean;
  runStatus?: 'queued' | 'running' | 'done' | 'failed' | 'stopped';
  runError?: string;
  images?: (string | { url: string; width?: number; height?: number })[];
  _pending?: PendingOutput[];
  _cascadeIdx?: number;
  _cascadeFailed?: boolean;
  /** 资产元数据：生成此资产使用的提示词 */
  _assetPrompt?: string;
  /** 资产元数据：生成此资产使用的供应商 ID */
  _assetProviderId?: string;
  /** 资产元数据：生成此资产使用的供应商名称 */
  _assetProviderName?: string;
  /** 资产元数据：生成此资产使用的模型 ID */
  _assetModelId?: string;
  /** 资产元数据：资产种类（character/prop/scene/storyboard/novel/script） */
  _assetKind?: string;
  /** 资产元数据：所属组节点 ID */
  _groupId?: string;
  /** 资产元数据：是否生成失败 */
  _assetFailed?: boolean;
  /** 资产元数据：生成失败的错误信息 */
  _assetError?: string;
  /** Pipeline 状态：当前执行步骤名 */
  _pipelineStep?: string;
  /** Pipeline 状态：进度百分比 0-100 */
  _pipelineProgress?: number;
  /** Pipeline 状态：日志列表 */
  _pipelineLog?: string[];
  /** Pipeline 状态：预览文本 */
  _pipelinePreview?: string;
  /** Pipeline 状态：已完成步骤（用于断点续执行） */
  _pipelineCompletedSteps?: string[];
  /** Pipeline 状态：执行参数（用于断点续执行） */
  _pipelineParams?: {
    inputText: string;
    sourceType: 'novel' | 'idea';
    style: string;
    language: string;
  };
  /** Pipeline 状态：中间结果 - 预处理后的小说文本 */
  _pipelineProcessedText?: string;
  /** Pipeline 状态：中间结果 - 脚本分析结果 */
  _pipelineScriptResult?: any;
  /** Pipeline 状态：是否已停止（用于断点续执行） */
  _pipelineStopped?: boolean;
  [key: string]: unknown;
}

export interface PendingOutput {
  id: string;
  startedAt: number;
  previewSize?: { w: number; h: number };
}

export interface Connection {
  id: string;
  from: string;
  to: string;
}

export interface PortPoint {
  x: number;
  y: number;
}

export interface SelectionBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface KnifePoint {
  x: number;
  y: number;
}

export interface MinimapState {
  bounds: { x: number; y: number; w: number; h: number };
  scale: number;
  ox: number;
  oy: number;
  cw: number;
  ch: number;
}

export interface UndoState {
  nodes: CanvasNode[];
  connections: Connection[];
}

export type TaskAssetKind = 'character' | 'scene' | 'storyboard' | 'prop' | 'novel' | 'script';

export interface TaskAssetRef {
  id: string;
  kind: TaskAssetKind;
  name: string;
  url: string;
  tags?: string[];
  /** 资产生成使用的提示词 */
  prompt?: string;
  /** 资产生成使用的供应商 ID */
  providerId?: string;
  /** 资产生成使用的供应商名称 */
  providerName?: string;
  /** 资产生成使用的模型 ID */
  modelId?: string;
  /** 资产是否正在生成中（用于流式展示） */
  generating?: boolean;
  /** 资产是否生成失败 */
  failed?: boolean;
  /** 生成失败时的错误信息 */
  error?: string;
}

export const UNDO_MAX = 30;
export const WORLD_WIDTH = 6000;
export const WORLD_HEIGHT = 4000;

export const DEFAULT_NODE_SIZES: Record<string, { w: number; h?: number }> = {
  image: { w: 260, h: 178 },
  prompt: { w: 310, h: 200 },
  loop: { w: 336, h: 220 },
  group: { w: 260, h: 178 },
  promptGroup: { w: 310, h: 200 },
  video: { w: 320, h: 200 },
  pipeline: { w: 360, h: 420 },
  novel: { w: 420, h: 480 },
  script: { w: 480, h: 420 },
  agent_node: { w: 280, h: 200 },
};

export function uid(prefix = 'n'): string {
  return `${prefix}_${Math.random().toString(16).slice(2)}_${Date.now()}`;
}
