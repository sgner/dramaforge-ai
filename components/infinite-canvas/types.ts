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
  ;

// 单条横向时间线：所有事件按发生顺序一字排开，超出一行后换行。
// 目标：用户一眼看到完整 agent 进展，无需上下滚动。
// 黑白灰风格：去掉彩色边框，只保留"节点类型 icon"作为视觉区分。
export const AGENT_TYPE_META: Record<string, { label: string; color: string; icon: string }> = {
  goal: { label: '目标', color: 'var(--text, #0f172a)', icon: '◎' },
  plan: { label: '计划', color: 'var(--text, #0f172a)', icon: '▤' },
  action: { label: '动作', color: 'var(--text, #0f172a)', icon: '▶' },
  observation: { label: '观察', color: 'var(--text, #0f172a)', icon: '◉' },
  artifact: { label: '资产', color: 'var(--text, #0f172a)', icon: '◆' },
  question: { label: '询问', color: 'var(--text, #0f172a)', icon: '?' },
  done: { label: '完成', color: 'var(--text, #0f172a)', icon: '✓' },
};

// 紧凑节点尺寸（横向时间线）
// 每行节点数（横向时间线流：默认 5 个/行，超出换行）
// 画布上 agent_node 总数上限：超出后合并最旧的 observation 节点，避免页面卡顿
// 实际经验：12 个紧凑节点占 3 行 × 5 列 = 1100×440 px，缩放后单屏可看完整时间线
// 同类型节点在画布上保留的最大数量（超过时合并）

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
  /** 源端口（与后端 from_port 对应；toConnection 已透传，旧连线可能为空） */
  fromPort?: string;
  /** 目标端口（与后端 to_port 对应；toConnection 已透传，旧连线可能为空） */
  toPort?: string;
  /**
   * 连线附加数据。创建连线时若源节点是资产节点，会自动填充：
   *   { asset_ref, role: 'reference', from_asset_kind }
   * 供后端 collect_canvas_references() 收集资产引用关系。
   */
  data?: Record<string, any>;
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
  /** 显示标题（可与 name 不同；如未设置则用 name） */
  title?: string;
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
  status?: string;
  version?: number;
  sourceAssetId?: string;
  derivedFrom?: string[];
  referenceRole?: string;
  promptSource?: string;
  promptOptimized?: string;
  inspectionStatus?: string;
  /** Story Bible 实体外键 */
  storyEntityId?: string;
  storyEntityName?: string;
  /** 文本资产正文（小说/脚本用） */
  body?: string;
  /** 文本资产字数/场数（统计字段，避免每次计算） */
  textStats?: { words?: number; scenes?: number; chapters?: number };
  /**
   * 后端原始 extra 字典（含脚本节点需要的结构化 JSON 字段 extra.script）。
   * 前端 ScriptNodeBody 优先从 extra.script 读综合 JSON（角色/道具/场景/分镜/视觉签名），
   * 失败时回退到 text（markdown）的 JSON.parse。
   * 之前这个字段没被 toTaskAssetRef 透传，ScriptNodeBody 拿到 markdown → JSON.parse 失败 → 全部为空。
   */
  extra?: Record<string, any>;
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
};

export function uid(prefix = 'n'): string {
  return `${prefix}_${Math.random().toString(16).slice(2)}_${Date.now()}`;
}
