/**
 * useAgentStore — agent 任务的全局状态 (zustand)。
 *
 * 设计：把后端 AgentEvent 投影到前端可消费的字段：
 * - thoughts / actions / observations 三个 stream（侧栏 ThoughtStream 用）
 * - plan（用户审核）
 * - artifacts（按 category 分桶，画布节点用）
 * - pendingQuestion（用户输入卡）
 */
import { create } from 'zustand';

export type AgentStatus =
  | 'idle'
  | 'pending'
  | 'running'
  | 'paused'
  | 'done'
  | 'failed';

export interface AgentEventLike {
  type: string;
  payload?: Record<string, any>;
  timestamp?: number;
}

export interface ArtifactItem {
  id: string;
  kind: string;
  asset_kind?: string;
  name?: string;
  url?: string;
  [k: string]: any;
}

export interface PendingQuestion {
  question: string;
  options?: string[];
  [k: string]: any;
}

export interface PendingErrorRecovery {
  stepId: string;
  tool: string;
  error: string;
  params: Record<string, any>;
  fallbackModelId: string | null;
  availableModels: { id: string; label: string }[];
}

export interface AgentState {
  // 任务标识
  taskId: string | null;
  projectId: string | null;
  status: AgentStatus;

  // 事件流（投影后）
  thoughts: AgentEventLike[];
  actions: AgentEventLike[];
  observations: AgentEventLike[];

  // 计划 + 资产
  plan: any[];
  artifacts: Record<string, ArtifactItem[]>;

  // 用户交互
  pendingQuestion: PendingQuestion | null;
  pendingPlan: any[] | null;
  pendingErrorRecovery: PendingErrorRecovery | null;

  // LLM 模式
  llmMode: 'real' | 'stub' | null;
  llmFallbackReason: string | null;

  // 成本
  totalCostUsd: number;
  totalTokens: number;

  // 错误
  error: string | null;

  // actions
  setTask: (taskId: string, status: AgentStatus, projectId?: string | null) => void;
  setStatus: (status: AgentStatus) => void;
  applyEvent: (event: AgentEventLike) => void;
  clearPendingQuestion: () => void;
  clearErrorRecovery: () => void;
  reset: () => void;
}

const INITIAL: Pick<
  AgentState,
  | 'taskId'
  | 'projectId'
  | 'status'
  | 'thoughts'
  | 'actions'
  | 'observations'
  | 'plan'
  | 'artifacts'
  | 'pendingQuestion'
  | 'pendingPlan'
  | 'pendingErrorRecovery'
  | 'llmMode'
  | 'llmFallbackReason'
  | 'totalCostUsd'
  | 'totalTokens'
  | 'error'
> = {
  taskId: null,
  projectId: null,
  status: 'idle',
  thoughts: [],
  actions: [],
  observations: [],
  plan: [],
  artifacts: {},
  pendingQuestion: null,
  pendingPlan: null,
  pendingErrorRecovery: null,
  llmMode: null,
  llmFallbackReason: null,
  totalCostUsd: 0,
  totalTokens: 0,
  error: null,
};

function bucketOf(assetKind: string | undefined): string {
  // 资产按细类分桶；未知细类归入 "other"
  return assetKind || 'other';
}

export const useAgentStore = create<AgentState>((set) => ({
  ...INITIAL,

  setTask: (taskId, status, projectId = null) =>
    set({ taskId, status, projectId }),

  setStatus: (status) => set({ status }),

  applyEvent: (event) =>
    set((state) => {
      const t = event.type;
      const p = event.payload || {};
      switch (t) {
        case 'task_started': {
          // 后端在 runtime 启动时上报 LLM 模式 + fallback 原因
          // real = 真实 LLM（DB 里有 provider/api_key）
          // stub = DevScriptedLLM 假任务（需要用户在 API 设置里配 LLM key）
          const mode = p.llm_mode === 'real' ? 'real' : (p.llm_mode === 'stub' ? 'stub' : state.llmMode);
          const reason = typeof p.llm_fallback_reason === 'string' ? p.llm_fallback_reason : state.llmFallbackReason;
          return { llmMode: mode, llmFallbackReason: reason, status: 'running' };
        }
        case 'thought':
          return { thoughts: [...state.thoughts, event] };
        case 'action':
          return { actions: [...state.actions, event] };
        case 'observation':
          return { observations: [...state.observations, event] };
        case 'goal_parsed':
          return { plan: Array.isArray(p.plan) ? p.plan : state.plan };
        case 'plan_ready':
          return {
            plan: Array.isArray(p.plan) ? p.plan : state.plan,
            pendingPlan: Array.isArray(p.plan) ? p.plan : state.pendingPlan,
          };
        case 'plan_revised':
          return {
            plan: Array.isArray(p.plan) ? p.plan : state.plan,
          };
        case 'artifact_created': {
          const cat = bucketOf(p.asset_kind);
          const existing = state.artifacts[cat] || [];
          const item: ArtifactItem = {
            id: p.id,
            kind: p.kind,
            asset_kind: p.asset_kind,
            name: p.name,
            url: p.url,
            ...p,
          };
          return {
            artifacts: { ...state.artifacts, [cat]: [...existing, item] },
          };
        }
        case 'request_user_input':
          return {
            pendingQuestion: {
              question: p.question,
              options: p.options,
              ...p,
            },
            status: 'paused',
          };
        case 'user_input_received':
          return { pendingQuestion: null, status: 'running' };
        case 'tool_retrying':
          return { thoughts: [...state.thoughts, event] };
        case 'tool_fallback_model':
          return { thoughts: [...state.thoughts, event] };
        case 'tool_error':
          return {
            pendingErrorRecovery: {
              stepId: p.step_id,
              tool: p.tool,
              error: p.error,
              params: p.params,
              fallbackModelId: p.fallback_model_id,
              availableModels: p.available_models || [],
            },
            status: 'paused',
          };
        case 'tool_resumed':
          return { pendingErrorRecovery: null, status: 'running' };
        case 'task_paused':
          return { status: 'paused' };
        case 'task_resumed':
          return { status: 'running' };
        case 'task_done':
          return { status: 'done' };
        case 'task_failed':
          return { status: 'failed', error: p.error || 'task failed' };
        case 'cost_update':
          return {
            totalCostUsd: state.totalCostUsd + Number(p.cost_usd || 0),
            totalTokens: state.totalTokens + Number(p.tokens || 0),
          };
        default:
          return {};
      }
    }),

  clearPendingQuestion: () => set({ pendingQuestion: null }),

  clearErrorRecovery: () => set({ pendingErrorRecovery: null }),

  reset: () => set({ ...INITIAL }),
}));
