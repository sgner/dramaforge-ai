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
  | 'failed'
  | 'cancelled';

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
  options?: { id: string; label: string }[];
  selection_mode?: 'single' | 'multiple' | 'confirm' | 'text';
  allow_custom?: boolean;
  min_selections?: number;
  max_selections?: number;
  [k: string]: any;
}

export interface TaskProfile {
  task_type: string;
  input_mode?: string;
  source_kind?: string;
  script_required?: boolean;
  needs_clarification?: boolean;
  deliverables?: string[];
  asset_strategy?: string;
  confidence?: number;
  missing_inputs?: string[];
  rule_pack_id: string;
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
  taskProfile: TaskProfile | null;

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
  streamingText: string;

  // actions
  setTask: (taskId: string, status: AgentStatus, projectId?: string | null) => void;
  setStatus: (status: AgentStatus) => void;
  /**
   * 把后端持久化的 task 快照投影到 store（重开历史任务时用）。
   * 不会清空当前 state；只覆盖被提供的字段。
   */
  hydrate: (snapshot: {
    user_goal?: string | null;
    status?: string;
    plan?: any[];
    artifacts?: Record<string, ArtifactItem[]>;
    pending_response?: any;
    pending_question?: any;
    task_profile?: TaskProfile | null;
    rule_pack_version?: string | null;
    total_cost_usd?: number;
    total_tokens?: number;
    llm_provider_id?: string | null;
    llm_model_id?: string | null;
  }) => void;
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
  | 'streamingText'
> = {
  taskId: null,
  projectId: null,
  status: 'idle',
  thoughts: [],
  actions: [],
  observations: [],
  plan: [],
  artifacts: {},
  taskProfile: null,
  pendingQuestion: null,
  pendingPlan: null,
  pendingErrorRecovery: null,
  llmMode: null,
  llmFallbackReason: null,
  totalCostUsd: 0,
  totalTokens: 0,
  error: null,
  streamingText: '',
};

function bucketOf(assetKind: string | undefined): string {
  // 资产按细类分桶；未知细类归入 "other"
  return assetKind || 'other';
}

function hasEvent(events: AgentEventLike[], event: AgentEventLike): boolean {
  if (event.timestamp !== undefined && events.some((item) => item.timestamp === event.timestamp)) {
    return true;
  }
  const p = event.payload || {};
  const step = p.step ?? p.step_id;
  if (step !== undefined) {
    return events.some((item) => {
      const existing = item.payload || {};
      return (existing.step ?? existing.step_id) === step;
    });
  }
  return false;
}

function normalizeQuestion(payload: Record<string, any>): PendingQuestion {
  const rawOptions = Array.isArray(payload.options) ? payload.options : [];
  const options = rawOptions
    .map((option: any, index: number) => {
      if (typeof option === 'string') return { id: `option-${index}`, label: option };
      const label = String(option?.label ?? option?.value ?? '').trim();
      if (!label) return null;
      return { id: String(option?.id ?? option?.value ?? `option-${index}`), label };
    })
    .filter((option): option is { id: string; label: string } => !!option);
  const mode = payload.selection_mode || (options.length ? 'single' : 'text');
  return {
    ...payload,
    question: String(payload.question || ''),
    options,
    selection_mode: ['single', 'multiple', 'confirm', 'text'].includes(mode) ? mode : 'text',
    allow_custom: payload.allow_custom === true,
  };
}

export const useAgentStore = create<AgentState>((set) => ({
  ...INITIAL,

  setTask: (taskId, status, projectId = null) =>
    // 切任务时必须先 reset 到 INITIAL，否则上一个任务的 events/thoughts/actions
    // 还会留在 store 里，SSE 重放的新事件会附加到旧数据后面，导致
    // "重开历史任务显示 0 想法 0 动作"（events 被清空后被新 task 的 replay 覆盖），
    // 或者更糟：两个 task 的数据混在一起。
    set({ ...INITIAL, taskId, status, projectId }),

  setStatus: (status) => set({ status }),

  /**
   * 把后端持久化的 task 快照投影到 store。
   * 用于重开历史任务：把 DB 里的 plan/artifacts/status/成本 立即显示，
   * 这样在 SSE 还没重放到 events 之前，UI 已经能看到"非空"的初始状态。
   * 调用方应已在 setTask 中重置过 store。
   */
  hydrate: (snapshot: {
    user_goal?: string | null;
    status?: string;
    plan?: any[];
    artifacts?: Record<string, ArtifactItem[]>;
    pending_response?: any;
    pending_question?: any;
    task_profile?: TaskProfile | null;
    rule_pack_version?: string | null;
    total_cost_usd?: number;
    total_tokens?: number;
    llm_provider_id?: string | null;
    llm_model_id?: string | null;
  }) =>
    set((state) => {
      // 推断 llmMode：当前后端已无 stub 路径，task 一旦有 llm_provider_id 就是 real。
      // 旧任务可能是 LLMFactory 重构前的"stub"残留，但前端不再使用 stub 文案，
      // 统一回退到 'real' 横幅（"已连接真实 LLM — 正在调用供应商"）。
      let mode: 'real' | 'stub' | null = state.llmMode;
      if (snapshot.llm_provider_id || snapshot.llm_model_id) {
        mode = 'real';
      }
      return {
        status: (snapshot.status as AgentStatus) || state.status,
        plan: Array.isArray(snapshot.plan) ? snapshot.plan : state.plan,
        artifacts:
          snapshot.artifacts && typeof snapshot.artifacts === 'object'
            ? (snapshot.artifacts as Record<string, ArtifactItem[]>)
            : state.artifacts,
        taskProfile: snapshot.task_profile ?? state.taskProfile,
        totalCostUsd:
          typeof snapshot.total_cost_usd === 'number'
            ? snapshot.total_cost_usd
            : state.totalCostUsd,
        totalTokens:
          typeof snapshot.total_tokens === 'number'
            ? snapshot.total_tokens
            : state.totalTokens,
        llmMode: mode,
        // pending_response 可能是 ask_user 的 question（response 还没填），
        // 也可能是用户已 respond 完等待 runtime resume 的载荷。
        // 只有前者才需要恢复成 pendingQuestion；后者由 SSE 的
        // user_input_received / task_resumed 事件处理。
        pendingQuestion:
          snapshot.pending_question && typeof snapshot.pending_question === 'object' && typeof snapshot.pending_question.question === 'string'
            ? normalizeQuestion(snapshot.pending_question)
            : snapshot.pending_response &&
          typeof snapshot.pending_response === 'object' &&
          !('response' in snapshot.pending_response) &&
          typeof (snapshot.pending_response as any).question === 'string'
            ? normalizeQuestion(snapshot.pending_response as Record<string, any>)
            : state.pendingQuestion,
      };
    }),

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
          // setTask() already resets state when switching tasks. Do not clear the
          // event view here: reconnects replay task_started before historical
          // events, and clearing would make the UI flicker and discard hydrated
          // live state during a transient SSE failure.
          return {
            llmMode: mode,
            llmFallbackReason: reason,
            status: 'running',
          };
        }
        case 'thought':
          // Some older/partial LLM decisions contained only an action and an
          // empty thought. Do not let those become blank cards in the stream.
          if (typeof p.text !== 'string' || !p.text.trim()) return {};
          return hasEvent(state.thoughts, event)
            ? {}
            : {
                thoughts: [...state.thoughts, event],
                // Replayed history can contain thoughts before the original
                // request_user_input event. Keep the draft question mounted
                // while paused so reconnects cannot erase the user's typing.
                ...(state.status === 'paused' && state.pendingQuestion
                  ? {}
                  : { pendingQuestion: null }),
              };
        case 'text_delta':
          return { streamingText: `${state.streamingText}${String(p.text || '')}` };
        case 'prompt_optimization_started':
          return hasEvent(state.thoughts, event) ? {} : { thoughts: [...state.thoughts, { ...event, payload: { ...p, message: `正在优化${p.target === 'video' ? '视频' : '图像'}提示词` } }] };
        case 'prompt_optimization_finished':
          return hasEvent(state.thoughts, event) ? {} : { thoughts: [...state.thoughts, { ...event, payload: { ...p, message: '提示词优化完成，开始生成媒体' } }] };
        case 'action':
          return hasEvent(state.actions, event)
            ? {}
            : {
                actions: [...state.actions, event],
                ...(state.status === 'paused' && state.pendingQuestion
                  ? {}
                  : { pendingQuestion: null }),
              };
        case 'observation':
          return hasEvent(state.observations, event) ? {} : { observations: [...state.observations, event], streamingText: '' };
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
          if (p.id && existing.some((candidate) => candidate.id === p.id)) {
            return {
              artifacts: {
                ...state.artifacts,
                [cat]: existing.map((candidate) => candidate.id === p.id ? { ...candidate, ...item } : candidate),
              },
            };
          }
          return {
            artifacts: { ...state.artifacts, [cat]: [...existing, item] },
          };
        }
        case 'request_user_input':
          return { pendingQuestion: normalizeQuestion(p), status: 'paused' };
        case 'user_input_received':
          // Keep the question visible until the resumed runtime emits its
          // first thought/action. If resume fails after this event, the user
          // must still be able to see and retry the submitted question.
          return { status: 'running' };
        case 'tool_retrying':
          return hasEvent(state.thoughts, event) ? {} : { thoughts: [...state.thoughts, event] };
        case 'tool_fallback_model':
          return hasEvent(state.thoughts, event) ? {} : { thoughts: [...state.thoughts, event] };
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
        case 'media_recovery_started':
          return {
            thoughts: [...state.thoughts, {
              ...event,
              payload: { ...p, text: `媒体生成失败，旁路恢复 worker 正在重试 ${p.tool || ''}` },
            }],
            status: 'running',
          };
        case 'media_recovery_finished':
          return {
            thoughts: [...state.thoughts, {
              ...event,
              payload: { ...p, text: p.success ? '旁路恢复完成，结果已汇总' : `旁路恢复失败：${p.error || '未知错误'}` },
            }],
            status: 'running',
          };
        case 'asset_inspection_started':
        case 'asset_inspection_finished':
        case 'asset_normalization_started':
        case 'asset_normalization_finished':
          return {
            thoughts: [...state.thoughts, {
              ...event,
              payload: {
                ...p,
                text: p.text || (
                  t === 'asset_inspection_started' ? '正在检查上传资产' :
                  t === 'asset_inspection_finished' ? '上传资产检查完成' :
                  t === 'asset_normalization_started' ? '正在生成标准化资产' : '标准化资产已准备完成'
                ),
              },
            }],
          };
        case 'task_paused':
          return { status: 'paused' };
        case 'task_resumed':
          return { status: 'running' };
        case 'task_done':
          return { status: 'done' };
        case 'task_failed':
          return {
            status: p.cancelled ? 'cancelled' : 'failed',
            error: p.error || 'task failed',
          };
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
