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
import { toast } from '@/utils/toast';

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

/** Parse failures are an internal Agent self-recovery signal, not a user task failure. */
function isJsonParseNoise(payload: Record<string, any> | undefined): boolean {
  if (!payload) return false;
  if (payload.internal === true) return true;
  const error = typeof payload.error === 'string' ? payload.error : '';
  return error.startsWith('Invalid decision JSON:');
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
  /**
   * LLM 调用错误（网络断 / SSL / 鉴权 / 限流 等）。
   * 与 `error`（任务整体失败）不同：LLM 错误时任务只是 PAUSED，
   * 用户仍可修复 LLM provider 然后重试。
   * 触发场景：runtime.step() 收到 LLMError 时 _add_failed_step 写了一条
   * status=failed 的 observation，tool 字段为 '_llm_call'。
   * UI 应展示一个明显 banner + "Open API Settings" 按钮。
   */
  llmError: string | null;
  llmErrorAt: number | null;  // 用于判断 stale（>60s 提示刷新）
  streamingText: string;

  /**
   * 实时活动状态：人类可读的"agent 当前在做什么"描述。
   * 来源：SSE 的 action / prompt_optimization_* / artifact_created / thought 事件。
   * 在 UI 顶部以浮动 chip 形式展示，让用户清楚 agent 当前阶段
   * （如"正在优化提示词"/"正在生成角色图"/"正在准备标准化资产"）。
   * status === 'paused' 时为 null（用户被问问题），status === 'done' 时为 null。
   */
  currentActivity: string | null;

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
    // 可选：DB 中的步骤历史，用于在 pending_question 缺失时从最近 ask_user step
    // 提取 question 文本，确保 UI 恢复的提问卡不出现空白。
    steps?: Array<{
      step_number?: number;
      thought?: string;
      action?: { tool?: string; params?: Record<string, any> };
      observation?: Record<string, any>;
      status?: string;
    }>;
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
  /** 清除任务级错误 banner（task_failed / 提交看门狗超时写入的 error）。 */
  clearError: () => void;
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
  | 'currentActivity'
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
  llmError: null,
  llmErrorAt: null,
  streamingText: '',
  assetsSummary: null,
  missingDeliverables: [],
  conversationTurns: [],
  memoryCompressed: false,
  currentActivity: null,
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

/**
 * 把 tool 名字翻译成人类可读的中文活动描述。
 * 用于 currentActivity 状态字段，让用户清楚知道 agent 当前在做什么
 * （避免只能看思考流才知道进度）。
 *
 * 命名风格：正在进行 + 资产类型/动作，让用户感知"在做什么"，而不是"在调用什么函数"。
 */
const TOOL_ACTIVITY_LABELS: Record<string, (p: Record<string, any>) => string> = {
  parse_user_goal: () => '正在解析你的目标…',
  create_plan: () => '正在规划步骤…',
  expand_story: () => '正在扩写故事…',
  generate_script: (p) => `正在编写${p?.format === 'screenplay' ? '文学剧本' : '脚本'}…`,
  optimize_prompt: () => '正在优化提示词…',
  generate_character_portrait: (p) => {
    const name = p?.character?.name || p?.name;
    return name ? `正在生成角色图：${name}…` : '正在生成角色图…';
  },
  generate_scene_image: (p) => {
    const name = p?.scene?.name || p?.name;
    return name ? `正在生成场景图：${name}…` : '正在生成场景图…';
  },
  generate_prop_image: (p) => {
    const name = p?.prop?.name || p?.name;
    return name ? `正在生成道具图：${name}…` : '正在生成道具图…';
  },
  generate_storyboard_image: (p) => {
    const name = p?.shot?.name || p?.name;
    return name ? `正在生成分镜图：${name}…` : '正在生成分镜图…';
  },
  generate_video: () => '正在生成视频…',
  generate_media_batch: () => '正在批量生成媒体…',
  save_asset: () => '正在保存资产…',
  inspect_asset: () => '正在检查上传资产…',
  prepare_character_asset: () => '正在准备标准化角色资产…',
  ask_user: () => '正在等你回复',
};

function toolActivityLabel(tool: string | undefined, params: Record<string, any> = {}): string {
  if (!tool) return '正在执行…';
  const fn = TOOL_ACTIVITY_LABELS[tool];
  if (fn) return fn(params);
  // 兜底：把 snake_case 转成中文"正在操作…"
  return `正在执行：${tool.replace(/_/g, ' ')}…`;
}

/**
 * 提交看门狗：用户提交回复后（pendingQuestionAnswered=true，UI 显示
 * "已提交，等待 agent 处理…"），如果 N 秒内没有任何 SSE 推进事件
 * （thought/action/observation/task_* 等），认为 agent 无响应——
 * 解锁"已提交"卡让用户可以重试，并用 toast + error banner 提示。
 * 任何推进事件都会重置计时；任务进入终态 / 新提问到达 / 任务切换时清除。
 */
export const SUBMIT_WATCHDOG_TIMEOUT_MS = 90_000;

export const useAgentStore = create<AgentState>((set, get) => {
  let submitWatchdogTimer: ReturnType<typeof setTimeout> | null = null;

  const clearSubmitWatchdog = () => {
    if (submitWatchdogTimer) {
      clearTimeout(submitWatchdogTimer);
      submitWatchdogTimer = null;
    }
  };

  const armSubmitWatchdog = () => {
    clearSubmitWatchdog();
    submitWatchdogTimer = setTimeout(() => {
      submitWatchdogTimer = null;
      const s = get();
      if (!s.pendingQuestionAnswered) return;
      if (['done', 'failed', 'cancelled'].includes(s.status)) return;
      // 资产生成等长耗时工具可能在 heartbeat 之外很久没有业务事件。
      // 只要 store 仍有明确的当前活动，就说明 agent 正在执行，不应回退成“无响应”。
      if (s.currentActivity) {
        armSubmitWatchdog();
        return;
      }
      const message =
        '你的回复已提交，但 agent 长时间没有任何进展，似乎无响应。请重新发送你的回复重试。';
      // 解锁"已提交，等待 agent 处理…"卡，让用户可以重新发送；
      // error 字段驱动 agent-mode 顶部的错误 banner，toast 给即时反馈。
      set({ pendingQuestionAnswered: false, error: message });
      toast.error(message);
    }, SUBMIT_WATCHDOG_TIMEOUT_MS);
  };

  return {
  ...INITIAL,

  setTask: (taskId, status, projectId = null) => {
    clearSubmitWatchdog();
    // 切任务时必须先 reset 到 INITIAL，否则上一个任务的 events/thoughts/actions
    // 还会留在 store 里，SSE 重放的新事件会附加到旧数据后面，导致
    // "重开历史任务显示 0 想法 0 动作"（events 被清空后被新 task 的 replay 覆盖），
    // 或者更糟：两个 task 的数据混在一起。
    set({ ...INITIAL, taskId, status, projectId });
  },

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
  }) => {
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
      // 关键：用户在 resume 失败后被回滚到 paused，pending_question 已被 consume
      // （ask_user step status 改成 success），但 pending_response 仍保留。
      // 此时 UI 必须把"已提交但 backend 处理失败"的灰色卡保持可见，让用户能看到
      // 自己刚才的回答并能再次点击"重试发送"。否则 UI 出现空白卡，用户无法继续。
      const hasSubmittedPendingResponse = nextStatus === 'paused' && (
        snapshot.pending_response &&
        typeof snapshot.pending_response === 'object' &&
        'response' in snapshot.pending_response
      );
      // 当 pending_response 已有 response 但 pending_question 缺失（resume 失败回滚场景），
      // 从 task_profile.user_confirmed_deliverables 或最近一个 ask_user step 重建 question。
      // 优先用 task_profile 里的 question 缓存（如果后端保存了），
      // 否则用 user_confirmed_deliverables 作为简短提示。
      let reconstructedQuestion: PendingQuestion | null = null;
      if (hasSubmittedPendingResponse && !hasPendingQFromSnapshot) {
        const cachedQ = (snapshot.pending_response as any)?.question;
        if (typeof cachedQ === 'string' && cachedQ.trim()) {
          reconstructedQuestion = {
            question: cachedQ,
            selection_mode: 'text',
            allow_custom: false,
          };
        } else if (nextProfile?.user_confirmed_deliverables?.length) {
          // fallback：用确认的 deliverables 描述作为"已回答"的提示
          reconstructedQuestion = {
            question: `你已确认交付物：${nextProfile.user_confirmed_deliverables.join('、')}`,
            selection_mode: 'text',
            allow_custom: false,
          };
        } else if (Array.isArray(snapshot.steps) && snapshot.steps.length > 0) {
          // 兜底：从最近一个 ask_user step 的 action.params.question 提取真实问题文本。
          // 这是最后一道防线——保证提问卡永远显示"问题是什么"，而不是空白。
          for (let i = snapshot.steps.length - 1; i >= 0; i--) {
            const s = snapshot.steps[i];
            const tool = s?.action?.tool;
            if (tool === 'ask_user') {
              const q = (s?.action?.params || {}).question;
              if (typeof q === 'string' && q.trim()) {
                reconstructedQuestion = {
                  question: q,
                  selection_mode: 'text',
                  allow_custom: false,
                };
                break;
              }
            }
          }
          if (!reconstructedQuestion) {
            reconstructedQuestion = {
              question: '你已提交回复，agent 正在处理…',
              selection_mode: 'text',
              allow_custom: false,
            };
          }
        } else {
          // 兜底：用户已提交但后端没存 question 文本、task_profile 也无
          // confirmed 信息——给一个通用"已提交"提示，避免 UI 出现空白卡。
          // 后端会在 user_respond 时存 question，但若是旧版数据或异常路径
          // 走到这里，UI 至少能告诉用户"agent 正在处理你的回复"。
          reconstructedQuestion = {
            question: '你已提交回复，agent 正在处理…',
            selection_mode: 'text',
            allow_custom: false,
          };
        }
      }
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
              : reconstructedQuestion ?? state.pendingQuestion,
        // 已回答状态：
        // 1. 有 pending question → 保留已有 answered（重开历史 paused 任务）
        // 2. 用户已提交（pending_response.response 存在）但 question 被 consume → 标为已答，
        //    让 UI 显示灰色"已提交"卡
        // 3. 其他情况 → 重置
        pendingQuestionAnswered: hasPendingQFromSnapshot
          ? state.pendingQuestionAnswered
          : hasSubmittedPendingResponse
            ? true
            : false,
      };
    });
    // hydrate 也可能重建灰色"已提交"卡（resume 失败回滚场景），
    // 同样需要看门狗兜底，避免"已提交"状态无限悬挂。
    if (get().pendingQuestionAnswered) armSubmitWatchdog();
  },

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
        if (s.observation && !isJsonParseNoise(s.observation) && (
          s.observation.success !== undefined ||
          (typeof s.observation.error === 'string' && s.observation.error.trim()) ||
          (s.observation.result !== undefined && s.observation.result !== null) ||
          Object.keys(s.observation).some((key) => !['result', 'error'].includes(key))
        )) {
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
      // 提交看门狗：任何推进事件（heartbeat 保活帧除外）都重置计时。
      // 在 switch 之前统一处理；task_done / task_failed / request_user_input
      // 等终态/解锁 case 内部会再 clear，最终状态以 case 为准。
      if (submitWatchdogTimer && t !== 'heartbeat') armSubmitWatchdog();
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
          return hasEvent(state.thoughts, event)
            ? {}
            : {
                thoughts: [...state.thoughts, { ...event, payload: { ...p, message: `正在优化${p.target === 'video' ? '视频' : '图像'}提示词` } }],
                // 关键：让活动指示器在 LLM 优化提示词期间切换成"正在优化提示词"，
                // 而不是停留在"正在生成XXX"的旧描述。
                currentActivity: `正在优化${p.target === 'video' ? '视频' : '图像'}提示词…`,
              };
        case 'prompt_optimization_finished':
          return hasEvent(state.thoughts, event)
            ? {}
            : {
                thoughts: [...state.thoughts, { ...event, payload: { ...p, message: '提示词优化完成，开始生成媒体' } }],
                // 完成后切到"正在生成XX"，给用户清晰进度反馈
                currentActivity: '正在生成媒体…',
              };
        case 'action':
          return hasEvent(state.actions, event)
            ? {}
            : {
                actions: [...state.actions, event],
                // 与 thought 同样的清理规则：已回答的灰色 question 保持可见
                ...((state.status === 'paused' && state.pendingQuestion) || state.pendingQuestionAnswered
                  ? {}
                  : { pendingQuestion: null, pendingQuestionAnswered: false }),
                // 关键：实时活动状态——告诉用户 agent 当前在执行什么工具。
                // ask_user 不需要更新 activity（status 会被切到 paused，活动指示器会隐藏）。
                ...(p.tool === 'ask_user'
                  ? {}
                  : {
                      currentActivity: toolActivityLabel(p.tool, p.params || {}),
                      // action is stronger evidence than a stale paused snapshot:
                      // the backend has already started executing a real tool.
                      status: ['done', 'failed', 'cancelled'].includes(state.status)
                        ? state.status
                        : 'running',
                    }),
              };
        case 'observation':
          // 非法决策 JSON 是 Agent 内部自动纠错信号，不应显示为用户任务失败。
          // 同时兼容历史事件（旧后端没有 internal 标记）。
          if (isJsonParseNoise(p)) return {};
          // 关键：_llm_call 失败的 observation 必须在 store 里有专属 slice 存，
          // 不能只塞 observations 数组（数组里的内容很难被 UI 优先发现，
          // 用户会以为 agent 还在跑）。触发场景：runtime.step() 收到 LLMError
          // → _add_failed_step → 写 observation {success:false, error:..., action:{tool:'_llm_call'}},
          // action.tool 标记为 '_llm_call'。
          const obs = (event as any).payload || {};
          // 忽略仅包含 result=null / error=null 的占位事件，避免 ThoughtStream
          // 在任务刚开始时显示“最新观察 null”。有 success 字段的事件仍保留，
          // 因为它可能表达“成功但没有详细返回值”。
          const hasObservationContent =
            obs.success !== undefined ||
            (typeof obs.error === 'string' && obs.error.trim().length > 0) ||
            (obs.result !== undefined && obs.result !== null) ||
            Object.keys(obs).some((key) => !['result', 'error'].includes(key));
          if (!hasObservationContent) return {};
          const obsAction = (obs as any).action || {};
          const obsTool = obsAction.tool;
          const obsError = obs.error;
          const baseObsUpdate = hasEvent(state.observations, event)
            ? {}
            : { observations: [...state.observations, event], streamingText: '' };
          if (obsTool === '_llm_call' && obsError) {
            return {
              ...baseObsUpdate,
              llmError: String(obsError),
              llmErrorAt: Date.now(),
              // LLM 失败时一定要清掉 activity：之前条件是"paused 才保留"，但用户
              // 视觉上看到"正在生成XX"会觉得 agent 还在跑。
              // 后端在 LLM 失败时也会发 TASK_PAUSED 把 status 切到 paused，但
              // 兜底这里也强制清，避免 TASK_PAUSED 晚到 / 漏发时 UI 仍误导。
              currentActivity: null,
              // 兜底同步 status='paused'：与后端 DB + TASK_PAUSED 事件保持一致。
              // 若用户处于终态（done/failed/cancelled），保留原状态。
              status: ['done', 'failed', 'cancelled'].includes(state.status)
                ? state.status
                : 'paused',
            };
          }
          return baseObsUpdate;
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
        case 'asset_updated': {
          // Agent 通过 update_text_asset 工具更新了小说/脚本正文
          // 把最新 body / text_stats 同步到 artifacts 中相应条目
          const cat = bucketOf(p.asset_kind);
          const existing = state.artifacts[cat] || [];
          const updatedItem: ArtifactItem = {
            id: p.id,
            kind: p.kind,
            asset_kind: p.asset_kind,
            name: p.name,
            url: p.url,
            body: p.body,
            text_stats: p.text_stats,
            version: p.version,
            ...p,
          };
          if (p.id && existing.some((candidate) => candidate.id === p.id)) {
            return {
              artifacts: {
                ...state.artifacts,
                [cat]: existing.map((candidate) =>
                  candidate.id === p.id ? { ...candidate, ...updatedItem } : candidate,
                ),
              },
            };
          }
          return {
            artifacts: { ...state.artifacts, [cat]: [...existing, updatedItem] },
          };
        }
        case 'request_user_input': {
          // 新提问到达 → 看门狗使命结束（UI 已解锁等用户输入）
          clearSubmitWatchdog();
          // 收到新的提问 → 重置 answered 状态（旧 answered 必然属于上一个问题）
          // 关键兜底：若 SSE payload 缺 question 字段（之前 _pause_for_script_requirement
          // 这类内置问题有时不带 question），从最近一次 ask_user step 的 action.params
          // 提取。这样提问卡一定能显示问题文本，不会出现"agent 正在等待你的回复"
          // 下面一片空白的 bug。
          return {
            pendingQuestion: normalizeQuestion(p),
            status: 'paused',
            pendingQuestionAnswered: false,
            currentActivity: null,
          };
        }
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
        case 'media_recovery_progress': {
          const progressText = p.status === 'fallback_model'
            ? `媒体生成切换降级模型：${p.from_model || '?'} → ${p.to_model || '?'}`
            : `旁路重试中（第 ${p.attempt ?? '?'}/${p.max_attempts ?? '?'} 次）：${p.tool || ''}`;
          return {
            thoughts: [...state.thoughts, {
              ...event,
              payload: { ...p, text: progressText },
            }],
            status: 'running',
          };
        }
        case 'media_recovery_finished':
          return {
            thoughts: [...state.thoughts, {
              ...event,
              payload: { ...p, text: p.success ? '旁路恢复完成，结果已汇总' : `旁路恢复失败：${p.error || '未知错误'}` },
            }],
            status: 'running',
          };
        case 'agent_notice': {
          // 自动恢复、服务重连等系统异常也必须进入 ThoughtStream，
          // 让用户知道 agent 没有静默停住。
          const noticeThoughts = hasEvent(state.thoughts, event)
            ? state.thoughts
            : [...state.thoughts, { ...event, payload: { ...p, text: p.message || 'agent 正在处理异常' } }];
          // 用户提交回复后，编排层故障（NoLLMConfigured / 重建 runtime 失败等）
          // 只发 error 级 notice，不发 task_paused——必须在这里解锁"已提交"卡，
          // 否则卡片永远卡在禁用状态（自动恢复重试的 warning notice 会不停重置
          // 看门狗计时）。warning 级不解锁：agent 仍在自动重试/自我纠正。
          if (p.level === 'error' && state.pendingQuestionAnswered) {
            clearSubmitWatchdog();
            const detail = typeof p.message === 'string' && p.message.trim()
              ? p.message
              : '未知错误';
            return {
              thoughts: noticeThoughts,
              status: ['done', 'failed', 'cancelled'].includes(state.status)
                ? state.status
                : 'paused',
              currentActivity: null,
              pendingQuestionAnswered: false,
              error: `agent 处理你的回复时出错：${detail}。可以重新发送你的回复重试。`,
            };
          }
          return { thoughts: noticeThoughts };
        }
        case 'asset_inspection_started':
          return {
            thoughts: [...state.thoughts, {
              ...event,
              payload: {
                ...p,
                text: p.text || '正在检查上传资产',
              },
            }],
            currentActivity: '正在检查上传资产…',
          };
        case 'asset_inspection_finished':
          return {
            thoughts: [...state.thoughts, {
              ...event,
              payload: {
                ...p,
                text: p.text || '上传资产检查完成',
              },
            }],
          };
        case 'asset_normalization_started':
          return {
            thoughts: [...state.thoughts, {
              ...event,
              payload: {
                ...p,
                text: p.text || '正在生成标准化资产',
              },
            }],
            currentActivity: '正在生成标准化资产…',
          };
        case 'asset_normalization_finished':
          return {
            thoughts: [...state.thoughts, {
              ...event,
              payload: {
                ...p,
                text: p.text || '标准化资产已准备完成',
              },
            }],
          };
        case 'task_paused': {
          // 暂停等待用户输入：清空 activity（避免"正在生成XX"误导）
          // 用户刚提交回复（pendingQuestionAnswered=true）后 agent 处理失败暂停
          // （如 LLM 连续调用失败、auto_recovery 暂停）：必须解锁"已提交"卡，
          // 让用户能修改答案后重新发送；否则卡片会卡在禁用状态直到 90s 看门狗
          // 兜底，期间自动恢复重试的 notice 还会不断重置看门狗计时，卡得更久。
          if (state.pendingQuestionAnswered) {
            clearSubmitWatchdog();
            const detail = typeof p.error === 'string' && p.error.trim()
              ? p.error
              : String(p.reason || '未知错误');
            return {
              status: 'paused',
              currentActivity: null,
              pendingQuestionAnswered: false,
              error: `agent 处理你的回复时出错：${detail}。可以重新发送你的回复重试。`,
            };
          }
          return { status: 'paused', currentActivity: null };
        }
        case 'task_resumed':
          // 任务重新开始（用户 /resume 或新轮次）：清掉 LLM 错误 banner。
          // 旧 LLM 错误已不适用，banner 还挂着会误导用户以为任务仍在出错。
          return { status: 'running', llmError: null, llmErrorAt: null };
        case 'user_input_received':
          // 用户点击了"重答"/"重试"，LLM 即将再次被调，清掉旧错误 banner。
          return { status: 'running', llmError: null, llmErrorAt: null };
        case 'task_done': {
          clearSubmitWatchdog();
          return {
            status: 'done',
            currentActivity: null,
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
        }
        case 'task_failed': {
          clearSubmitWatchdog();
          // resume 失败回滚：后端 continue_runtime 异常时会把任务回滚到 paused
          // 并保留 pending_response（见 backend/app/routers/agent.py），任务本身
          // 并没有失败。此时不能把 status 置为 failed——与 DB 矛盾，且 SSE manager
          // 会把 failed 当终态关闭连接；而是回到 paused、解锁"已提交"提问卡
          // 让用户可以重试，并通过 error banner + toast 明确告知"出错了，可以重试"。
          if (p.recoverable) {
            const message = `agent 处理你的回复时出错：${p.error || '未知错误'}。可以重新发送你的回复重试。`;
            toast.error(message);
            return {
              status: ['done', 'cancelled'].includes(state.status) ? state.status : 'paused',
              error: message,
              currentActivity: null,
              // 解锁"已提交，等待 agent 处理…"卡：保留 pendingQuestion，
              // 用户可以修改答案后重新发送。
              pendingQuestionAnswered: false,
            };
          }
          const message = p.error || 'task failed';
          toast.error(`任务失败：${message}`);
          return {
            status: p.cancelled ? 'cancelled' : 'failed',
            error: message,
            currentActivity: null,
            // 任务失败/取消：清空灰色 question（如果还有 pending_response 残留也要清）
            pendingQuestion: null,
            pendingQuestionAnswered: false,
          };
        }
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

  clearPendingQuestion: () => {
    clearSubmitWatchdog();
    set({ pendingQuestion: null, pendingQuestionAnswered: false });
  },

  clearErrorRecovery: () => set({ pendingErrorRecovery: null }),

  /**
   * 清除 LLM 错误 banner。用户点"重试"/"关闭"或修复 LLM provider 重新调用时调用。
   * 注意：不重置 status —— task 仍在 PAUSED，pendingQuestion 仍存在，
   * 用户可以重答问题 /resume。
   */
  clearLlmError: () => set({ llmError: null, llmErrorAt: null }),

  markPendingQuestionAnswered: () => {
    set({ pendingQuestionAnswered: true });
    // 进入"已提交，等待 agent 处理…"状态 → 启动看门狗兜底
    armSubmitWatchdog();
  },

  clearError: () => set({ error: null }),

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

  reset: () => {
    clearSubmitWatchdog();
    set({ ...INITIAL });
  },
  };
});
