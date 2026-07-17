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
import { api, type AgentStepOut } from '@/services/apiClient';

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
  /**
   * 用户已对当前 pendingQuestion 提交了回复，等待 backend 消费。
   * 关键：放在 store 而不是组件 useState，否则 forceReconnect / rehydrate 触发后
   * `useEffect([draftKey])` 不会重跑，导致 answered 状态丢失、UI 重新变可编辑。
   * 真正"已锁定"的判定：pendingQuestionAnswered=true。
   */
  pendingQuestionAnswered: boolean;

  // LLM 模式
  llmMode: 'real' | 'stub' | null;
  llmFallbackReason: string | null;

  // SSE 连接状态（用于 UI 提示"连接已断开" / "正在重连" / "已重连"）
  connectionStatus: 'connected' | 'reconnecting' | 'disconnected';
  connectionDetail: string | null;
  /**
   * SSE 累计重连失败次数，达到上限（8）后 connectionStatus=disconnected，
   * store 持有这个值，UI 借此知道"已放弃重连，需要用户手动操作"。
   */
  reconnectAttempt: number;

  // 成本
  totalCostUsd: number;
  totalTokens: number;

  // 错误
  error: string | null;
  streamingText: string;

  // 资产完成度（TASK_DONE 时由后端校验后填入，用于展示真实生成情况）
  assetsSummary: Record<string, number> | null;
  missingDeliverables: string[];

  // 多轮对话记忆
  conversationTurns: Array<{ turn: number; user_message: string; agent_summary: string; step_range: number[] }>;
  memoryCompressed: boolean;

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
  /**
   * 从后端 AgentStep 表加载历史步骤，转换成 thoughts/actions/observations
   * 事件灌入 store。用于重开历史任务时恢复完整的执行历史（检查点模式），
   * 不依赖 SSE 内存重放 buffer（后端重启后 buffer 丢失）。
   *
   * 每个 step 的 step_number 作为去重键：后续 SSE 重放的相同 step 事件
   * 会被 applyEvent 的 hasEvent 去重，不会重复追加。
   */
  hydrateSteps: (steps: AgentStepOut[]) => void;
  applyEvent: (event: AgentEventLike) => void;
  clearPendingQuestion: () => void;
  clearErrorRecovery: () => void;
  /**
   * 用户已对当前 pendingQuestion 提交了回复。
   * 锁定 UI，避免 forceReconnect / rehydrate 重新打开回复组件。
   * pendingQuestion 清空时由 reducer 自动重置为 false。
   */
  markPendingQuestionAnswered: () => void;
  /**
   * 显式更新 SSE 连接状态，由 agent-stream-manager 调用。
   * 详见 connectionStatus 字段注释。
   */
  setConnectionStatus: (status: 'connected' | 'reconnecting' | 'disconnected', detail?: string | null) => void;
  setReconnectAttempt: (n: number) => void;
  /**
   * 任务完成后继续对话：调用后端 /continue 端点注入用户追加需求。
   * 后端会压缩早期记忆、追加 user_goal、发 CONVERSATION_CONTINUED 事件。
   * 前端只需调 API，事件由 SSE stream handler 接收。
   */
  continueConversation: (message: string) => Promise<void>;
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
  | 'pendingQuestionAnswered'
  | 'llmMode'
  | 'llmFallbackReason'
  | 'connectionStatus'
  | 'connectionDetail'
  | 'reconnectAttempt'
  | 'totalCostUsd'
  | 'totalTokens'
  | 'error'
  | 'streamingText'
  | 'assetsSummary'
  | 'missingDeliverables'
  | 'conversationTurns'
  | 'memoryCompressed'
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
  pendingQuestionAnswered: false,
  llmMode: null,
  llmFallbackReason: null,
  connectionStatus: 'connected',
  connectionDetail: null,
  reconnectAttempt: 0,
  totalCostUsd: 0,
  totalTokens: 0,
  error: null,
  streamingText: '',
  assetsSummary: null,
  missingDeliverables: [],
  conversationTurns: [],
  memoryCompressed: false,
};

function bucketOf(assetKind: string | undefined): string {
  // 资产按细类分桶；未知细类归入 "other"
  return assetKind || 'other';
}

/**
 * deliverables 名字到 artifacts asset_kind 的归一化映射。
 * 与后端 runtime.py 的 _DELIVERABLE_ASSET_KIND_MAP 保持一致。
 */
const DELIVERABLE_ASSET_KIND_MAP: Record<string, string> = {
  script: 'script',
  commercial_script: 'script',
  storyboard: 'storyboard',
  video: 'video',
  promotional_video: 'video',
  commercial_video: 'video',
  research_summary: 'research_summary',
  campaign_brief: 'campaign_brief',
  agreed_deliverables: 'agreed_deliverables',
};

/**
 * 从 store.artifacts 计算资产摘要（每个 asset_kind 的可用数量）。
 * 用于 hydrate 已完成任务时恢复 assetsSummary（TASK_DONE 事件可能已随
 * 后端重启丢失），以及前端 UI 实时展示。
 */
function computeAssetsSummaryFromArtifacts(
  artifacts: Record<string, ArtifactItem[]>,
): Record<string, number> {
  const summary: Record<string, number> = {};
  for (const [kind, items] of Object.entries(artifacts || {})) {
    if (!Array.isArray(items)) continue;
    const count = items.filter(
      (item) => item && typeof item === 'object' && !item.failed && !item.generating,
    ).length;
    if (count > 0) summary[kind] = count;
  }
  return summary;
}

function computeMissingDeliverablesFromSummary(
  summary: Record<string, number>,
  deliverables: string[] | undefined,
): string[] {
  if (!Array.isArray(deliverables) || deliverables.length === 0) return [];
  return deliverables.filter((deliverable) => {
    const assetKind = DELIVERABLE_ASSET_KIND_MAP[deliverable] ?? deliverable;
    return (summary[assetKind] ?? 0) === 0;
  });
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

export const useAgentStore = create<AgentState>((set, get) => ({
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
      const nextArtifacts =
        snapshot.artifacts && typeof snapshot.artifacts === 'object'
          ? (snapshot.artifacts as Record<string, ArtifactItem[]>)
          : state.artifacts;
      const nextStatus = (snapshot.status as AgentStatus) || state.status;
      const nextProfile = snapshot.task_profile ?? state.taskProfile;
      // 已完成任务恢复时，TASK_DONE 事件可能已随后端重启丢失，
      // 从 artifacts + taskProfile 重新计算资产摘要，确保 UI 仍能展示
      // 真实生成情况和缺失项。
      const shouldComputeSummary = nextStatus === 'done' && !state.assetsSummary;
      const computedSummary = shouldComputeSummary
        ? computeAssetsSummaryFromArtifacts(nextArtifacts)
        : null;
      const computedMissing = shouldComputeSummary && nextProfile
        ? computeMissingDeliverablesFromSummary(computedSummary ?? {}, nextProfile.deliverables)
        : [];
      // 计算 hydrate 后是否仍有 pending question，用于决定 answered 是否保留
      const hasPendingQFromSnapshot = nextStatus === 'paused' && (
        (snapshot.pending_question && typeof snapshot.pending_question === 'object' && typeof snapshot.pending_question.question === 'string') ||
        (snapshot.pending_response &&
          typeof snapshot.pending_response === 'object' &&
          !('response' in snapshot.pending_response) &&
          typeof (snapshot.pending_response as any).question === 'string')
      );
      return {
        status: nextStatus,
        plan: Array.isArray(snapshot.plan) ? snapshot.plan : state.plan,
        artifacts: nextArtifacts,
        taskProfile: nextProfile,
        totalCostUsd:
          typeof snapshot.total_cost_usd === 'number'
            ? snapshot.total_cost_usd
            : state.totalCostUsd,
        totalTokens:
          typeof snapshot.total_tokens === 'number'
            ? snapshot.total_tokens
            : state.totalTokens,
        llmMode: mode,
        assetsSummary: computedSummary ?? state.assetsSummary,
        missingDeliverables: computedMissing.length ? computedMissing : state.missingDeliverables,
        conversationTurns: Array.isArray(snapshot.conversation_turns)
          ? snapshot.conversation_turns as typeof state.conversationTurns
          : state.conversationTurns,
        memoryCompressed: Boolean(snapshot.memory_summary) || state.memoryCompressed,
        // pending_response 可能是 ask_user 的 question（response 还没填），
        // 也可能是用户已 respond 完等待 runtime resume 的载荷。
        // 只有前者才需要恢复成 pendingQuestion；后者由 SSE 的
        // user_input_received / task_resumed 事件处理。
        // 关键：只在 status === 'paused' 时恢复。
        // 覆盖 rehydrate 时序问题：用户刚提交回复、forceReconnect 触发 rehydrate，
        // 但后端 resume 是异步的——snapshot.status 此时可能已是 running。
        // 此时不恢复 pendingQuestion，让 UI 立即前进，避免"卡在回复卡"循环。
        pendingQuestion: nextStatus !== 'paused'
          ? null
          : snapshot.pending_question && typeof snapshot.pending_question === 'object' && typeof snapshot.pending_question.question === 'string'
            ? normalizeQuestion(snapshot.pending_question)
            : snapshot.pending_response &&
          typeof snapshot.pending_response === 'object' &&
          !('response' in snapshot.pending_response) &&
          typeof (snapshot.pending_response as any).question === 'string'
            ? normalizeQuestion(snapshot.pending_response as Record<string, any>)
            : state.pendingQuestion,
        // 已回答状态：仅在"恢复后的 pendingQuestion 仍然非空"时保留（重开历史 paused 任务），
        // 否则强制清零（task 已 running / done / failed / 不再有 pending question）。
        pendingQuestionAnswered: hasPendingQFromSnapshot ? state.pendingQuestionAnswered : false,
      };
    }),

  hydrateSteps: (steps) =>
    set((state) => {
      const thoughts: AgentEventLike[] = [];
      const actions: AgentEventLike[] = [];
      const observations: AgentEventLike[] = [];
      for (const s of steps) {
        // thought 可能为 null 或空字符串，跳过空值避免 ThoughtStream 出现空白卡片
        if (typeof s.thought === 'string' && s.thought.trim()) {
          thoughts.push({
            type: 'thought',
            payload: { text: s.thought, step: s.step_number },
          });
        }
        // action: { tool, params } — 非空才灌入
        if (s.action && (s.action.tool || s.action.params)) {
          actions.push({
            type: 'action',
            payload: { ...s.action, step: s.step_number },
          });
        }
        // observation: { success, result/error } — 非空才灌入
        if (s.observation && (s.observation.success !== undefined || s.observation.result !== undefined || s.observation.error)) {
          observations.push({
            type: 'observation',
            payload: { ...s.observation, step: s.step_number },
          });
        }
      }
      return { thoughts, actions, observations };
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
                //
                // 用户已回答后（pendingQuestionAnswered=true），灰色卡片需保持可见，
                // 让用户知道"agent 正在处理我的回答"。仅在以下情况清空：
                //   1. status === 'failed' / 'done' / 'cancelled'（任务结束）
                //   2. 新的 request_user_input 事件（handled below）
                //   3. 用户显式调用 clearPendingQuestion
                // 注：清空 pendingQuestion 时同时清 answered，否则下次 ask_user
                // 会带着"已答完"状态显示，UI 永远变灰。
                ...((state.status === 'paused' && state.pendingQuestion) || state.pendingQuestionAnswered
                  ? {}
                  : { pendingQuestion: null, pendingQuestionAnswered: false }),
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
                // 与 thought 同样的清理规则：已回答的灰色 question 保持可见
                ...((state.status === 'paused' && state.pendingQuestion) || state.pendingQuestionAnswered
                  ? {}
                  : { pendingQuestion: null, pendingQuestionAnswered: false }),
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
          // 收到新的提问 → 重置 answered 状态（旧 answered 必然属于上一个问题）
          return { pendingQuestion: normalizeQuestion(p), status: 'paused', pendingQuestionAnswered: false };
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
          return {
            status: 'done',
            assetsSummary:
              p.assets_summary && typeof p.assets_summary === 'object'
                ? p.assets_summary as Record<string, number>
                : state.assetsSummary,
            missingDeliverables: Array.isArray(p.missing_deliverables)
              ? p.missing_deliverables as string[]
              : state.missingDeliverables,
            // 任务完成：清空已答的灰色 question 残留，避免与"继续对话"输入框同时显示
            pendingQuestion: null,
            pendingQuestionAnswered: false,
          };
        case 'task_failed':
          return {
            status: p.cancelled ? 'cancelled' : 'failed',
            error: p.error || 'task failed',
            // 任务失败/取消：清空灰色 question（如果还有 pending_response 残留也要清）
            pendingQuestion: null,
            pendingQuestionAnswered: false,
          };
        case 'conversation_continued':
          // 继续对话：状态切回 running，记录轮次
          return {
            status: 'running',
            error: null,
            conversationTurns: p.turn && p.user_message
              ? [
                  ...state.conversationTurns,
                  {
                    turn: p.turn as number,
                    user_message: p.user_message as string,
                    agent_summary: '',
                    step_range: [],
                  },
                ]
              : state.conversationTurns,
          };
        case 'memory_compressed':
          // 记忆压缩完成：标记已压缩，后续可从 hydrate 恢复
          return { memoryCompressed: true };
        case 'cost_update':
          return {
            totalCostUsd: state.totalCostUsd + Number(p.cost_usd || 0),
            totalTokens: state.totalTokens + Number(p.tokens || 0),
          };
        default:
          return {};
      }
    }),

  clearPendingQuestion: () => set({ pendingQuestion: null, pendingQuestionAnswered: false }),

  clearErrorRecovery: () => set({ pendingErrorRecovery: null }),

  markPendingQuestionAnswered: () => set({ pendingQuestionAnswered: true }),

  setConnectionStatus: (status, detail = null) => set({ connectionStatus: status, connectionDetail: detail }),

  setReconnectAttempt: (n) => set({ reconnectAttempt: Math.max(0, n) }),

  continueConversation: async (message: string) => {
    const { taskId } = get();
    if (!taskId) throw new Error('no active task');
    const trimmed = message.trim();
    if (!trimmed) throw new Error('message must not be empty');
    // 乐观清空 done 状态的资产摘要显示，避免与新轮次混淆
    set({ error: null });
    await api.continueConversation(taskId, trimmed);
    // 后端会发 CONVERSATION_CONTINUED + TASK_RESUMED 事件，
    // applyEvent 会把 status 切回 running。此处不手动改状态，
    // 避免与 SSE 事件竞争。
  },

  reset: () => set({ ...INITIAL }),
}));
