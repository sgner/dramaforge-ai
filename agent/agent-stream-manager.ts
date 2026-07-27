/**
 * agent-stream-manager — 全局 SSE 连接管理
 *
 * 设计目标：
 *   - 当用户进入 agent 模式并开始任务时，自动建立 SSE 连接
 *   - 当用户退出 agent 模式时，连接保持（不随组件 unmount 断开）
 *   - 任务完成（done/failed）时自动断开
 *   - 支持断线重连（指数退避）
 *   - 任何连接状态变更都同步到 useAgentStore.connectionStatus，
 *     桌宠/ThoughtStream 借此感知"正在重连"/"连接已断开"并展示。
 *
 * 使用：
 *   - 模块加载时自动启动（无副作用）
 *   - 调用 `setActiveTask(taskId)` 切换监听任务
 *   - 调用 `stopStream()` 显式停止
 */
import { useAgentStore } from './use-agent-store';
import { api } from '@/services/apiClient';

let es: EventSource | null = null;
let retryCount = 0;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let currentTaskId: string | null = null;
let lastEventTime = 0;
let heartbeatTimer: ReturnType<typeof setTimeout> | null = null;
let stableTimer: ReturnType<typeof setTimeout> | null = null;
const MAX_RETRIES = 8;
const BACKOFF_MS = 1000;
const MAX_BACKOFF_MS = 30000;
// 必须 > 后端 HEARTBEAT_INTERVAL_S（15s）* 3，留足余量应对代理/浏览器静默断开。
// 之前 45s 在用户回答 ask_user 期间仍可能触发误判；60s（4 倍心跳）更稳。
const HEARTBEAT_TIMEOUT = 60_000;

/**
 * ⚠️ 同步要求：此清单必须与后端 backend/app/agent/events.py 的 EventType 枚举保持一致。
 * 后端 to_sse() 一律发送 named event（`event: <type>`），EventSource 对未注册的
 * 事件名会静默丢弃（onmessage 收不到 named event），因此后端新增事件类型时
 * 必须同步加到这里，否则对应事件（如 tool_error 错误恢复）在前端是死代码。
 *
 * 例外（不在 EventType 枚举内，但后端同样以 named event 发射）：
 *   - heartbeat：backend/app/routers/agent.py 的 _sse_heartbeat() 保活帧
 *   - asset_updated：backend/app/agent/tools/asset_tools.py 以裸字符串 emit
 */
const EVENT_TYPES = [
  // --- 非枚举：连接保活 ---
  'heartbeat',
  // --- 以下与 backend EventType 一一对应（保持同步！） ---
  'task_started',
  'goal_parsed',
  'thought',
  'action',
  'observation',
  'plan_ready',
  'plan_revised',
  'request_user_input',
  'user_input_received',
  'artifact_created',
  'cost_update',
  'task_paused',
  'task_resumed',
  'task_done',
  'task_failed',
  'step_retrying',
  'text_delta',
  'prompt_optimization_started',
  'prompt_optimization_finished',
  // Spec B: 工具失败恢复
  'tool_retrying',
  'tool_fallback_model',
  'tool_error',
  'tool_resumed',
  'media_recovery_started',
  'media_recovery_progress',
  'media_recovery_finished',
  'studio_step',
  'asset_inspection_started',
  'asset_inspection_finished',
  'asset_normalization_started',
  'asset_normalization_finished',
  // 多轮对话记忆
  'conversation_continued',
  'memory_compressed',
  // --- 非枚举：asset_tools.py 裸字符串发射 ---
  'asset_updated',
];

function streamUrl(taskId: string): string {
  return `/api/agent/tasks/${encodeURIComponent(taskId)}/stream`;
}

/**
 * 同步连接状态到 store。所有调用入口都在 scheduleReconnect / open / close 内部，
 * UI 端只需订阅 useAgentStore.connectionStatus 即可（无需主动轮询）。
 */
function setStatus(status: 'connected' | 'reconnecting' | 'disconnected', detail: string | null = null): void {
  try {
    useAgentStore.getState().setConnectionStatus(status, detail);
    useAgentStore.getState().setReconnectAttempt(retryCount);
  } catch {
    /* store 还没初始化（极早期） */
  }
}

function close(): void {
  if (es) {
    try { es.close(); } catch { /* ignore */ }
    es = null;
  }
  if (retryTimer) {
    clearTimeout(retryTimer);
    retryTimer = null;
  }
  if (heartbeatTimer) {
    clearTimeout(heartbeatTimer);
    heartbeatTimer = null;
  }
  if (stableTimer) {
    clearTimeout(stableTimer);
    stableTimer = null;
  }
}

/**
 * 统一的"重连"入口。
 * heartbeat timeout 和 stream.onerror 都调这里，避免 retryCount 被双路径重复累加、
 * 重连预算被提前耗尽。
 *
 * 重要：setStatus('reconnecting') 在 scheduleReconnect 入口处统一调一次，
 * heartbeat 和 onerror 不再各自 setStatus。
 */
function scheduleReconnect(reason: 'heartbeat' | 'error'): void {
  if (!currentTaskId) {
    setStatus('disconnected', 'no active task');
    return;
  }
  if (retryCount >= MAX_RETRIES) {
    // 预算耗尽，放弃重连，告知 UI 用户需要手动操作
    // eslint-disable-next-line no-console
    console.warn(`[agent-stream-manager] reconnect budget exhausted (${retryCount}/${MAX_RETRIES}), taskId=${currentTaskId} reason=${reason}`);
    setStatus('disconnected', `已尝试重连 ${retryCount} 次仍失败，请刷新或重试`);
    return;
  }
  close();
  retryCount += 1;
  const delay = Math.min(BACKOFF_MS * Math.pow(2, retryCount - 1), MAX_BACKOFF_MS);
  setStatus('reconnecting', `第 ${retryCount}/${MAX_RETRIES} 次重连（${reason}，${Math.round(delay / 1000)}s 后）`);
  retryTimer = setTimeout(() => {
    retryTimer = null;
    if (currentTaskId) open(currentTaskId);
  }, delay);
}

function startHeartbeat(): void {
  if (heartbeatTimer) clearTimeout(heartbeatTimer);
  heartbeatTimer = setTimeout(() => {
    // HEARTBEAT_TIMEOUT 内没收到任何事件，认为连接断了
    if (Date.now() - lastEventTime > HEARTBEAT_TIMEOUT) {
      // eslint-disable-next-line no-console
      console.warn('[agent-stream-manager] heartbeat timeout, reconnecting');
      scheduleReconnect('heartbeat');
    } else {
      startHeartbeat();
    }
  }, HEARTBEAT_TIMEOUT);
}

/**
 * 重连后强制重新 hydrate：从后端拉 task snapshot + 历史 steps，
 * 重建 store 状态（含 pendingQuestion/thoughts/actions/observations）。
 *
 * 解决的问题：断线重连后 SSE 只能重放内存 buffer，但后端可能已重启导致
 * buffer 丢失；此时 PAUSED 等待回复的任务会丢失 pendingQuestion，
 * 用户看不到回复组件。从 DB AgentStep + AgentTask 表恢复是可靠来源。
 *
 * 并发安全：与 agent-mode.tsx 的 onSelect hydrate 共用 store set，
 * zustand 自动串行化；若两者同时运行，后者覆盖前者，最终状态一致。
 */
async function rehydrateAfterReconnect(taskId: string): Promise<void> {
  try {
    const [snapshot, steps] = await Promise.all([
      api.getAgentTask(taskId),
      api.listAgentSteps(taskId),
    ]);
    const store = useAgentStore.getState();
    store.hydrate({
      user_goal: snapshot.user_goal,
      status: snapshot.status,
      plan: snapshot.plan,
      artifacts: (snapshot.artifacts as any) || {},
      pending_question: snapshot.pending_question,
      pending_response: snapshot.pending_response,
      task_profile: snapshot.task_profile as any,
      rule_pack_version: snapshot.rule_pack_version,
      total_cost_usd: snapshot.total_cost_usd,
      total_tokens: snapshot.total_tokens,
      llm_provider_id: snapshot.llm_provider_id,
      llm_model_id: snapshot.llm_model_id,
    });
    store.hydrateSteps(steps);
    // eslint-disable-next-line no-console
    console.info('[agent-stream-manager] rehydrated after reconnect', taskId, snapshot.status);
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('[agent-stream-manager] rehydrate failed', e);
  }
}

function open(taskId: string, resetRetries = false): void {
  if (typeof EventSource === 'undefined') return;
  if (es) close();
  currentTaskId = taskId;
  if (resetRetries) retryCount = 0;
  lastEventTime = Date.now();
  // 注：isReconnect gate 已移除——所有 onopen 都触发 rehydrate，
  // 既覆盖 organic retry，也覆盖 forceReconnect 路径。
  // 重复 hydrate 代价不高（同一份 snapshot 二次 set），但避免"forceReconnect 后
  // 没有 rehydrate 走 store pendingQuestion 丢失"这个 bug。

  const stream = new EventSource(streamUrl(taskId));
  es = stream;
  startHeartbeat();

  stream.onopen = () => {
    if (es !== stream) return;
    lastEventTime = Date.now();
    startHeartbeat();
    setStatus('connected');
    // Only reset the retry budget after the connection has stayed healthy.
    // EventSource can briefly report `open` and fail immediately afterwards;
    // resetting here would turn that loop into unbounded reconnects.
    if (stableTimer) clearTimeout(stableTimer);
    stableTimer = setTimeout(() => {
      if (es === stream) {
        retryCount = 0;
        useAgentStore.getState().setReconnectAttempt(0);
      }
      stableTimer = null;
    }, 10_000);
    // 所有 onopen 路径都触发 rehydrate（见上面注释）
    void rehydrateAfterReconnect(taskId);
  };

  stream.onerror = () => {
    if (es !== stream) return;
    // 检查 task 是否已结束。后端 stream 重放完 TASK_DONE/TASK_FAILED 事件后
    // 会主动 return 关闭连接，此时 EventSource 触发 onerror 是正常关闭，
    // 不应重连——否则会陷入"重连→重放→关闭→重连"死循环。
    const taskStatus = useAgentStore.getState().status;
    const terminalStates = ['done', 'failed', 'cancelled'];
    if (terminalStates.includes(taskStatus)) {
      // eslint-disable-next-line no-console
      console.info('[agent-stream-manager] connection closed (task ended), no reconnect', taskStatus);
      close();
      setStatus('connected', 'task ended'); // 不是"断开"，是正常关闭
      return;
    }
    // eslint-disable-next-line no-console
    console.warn('[agent-stream-manager] connection error, scheduling reconnect');
    scheduleReconnect('error');
  };

  for (const t of EVENT_TYPES) {
    stream.addEventListener(t, (ev: any) => {
      lastEventTime = Date.now();
      startHeartbeat();
      const raw = ev?.data ?? '';
      let payload: Record<string, any> = {};
      try {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') {
          if ('type' in parsed) {
            useAgentStore.getState().applyEvent({
              type: parsed.type,
              payload: parsed.payload || {},
              timestamp: parsed.timestamp,
            });
            return;
          }
          payload = parsed;
        }
      } catch {
        return;
      }
      useAgentStore.getState().applyEvent({ type: t, payload, timestamp: Date.now() / 1000 });
    });
  }

  stream.onmessage = (ev: any) => {
    lastEventTime = Date.now();
    startHeartbeat();
    try {
      const parsed = JSON.parse(ev.data);
      if (parsed && typeof parsed === 'object' && 'type' in parsed) {
        useAgentStore.getState().applyEvent({
          type: parsed.type,
          payload: parsed.payload || {},
          timestamp: parsed.timestamp,
        });
      }
    } catch {
      /* ignore */
    }
  };
}

/**
 * 切换到指定 task。如果已经在监听该 task，则不重启连接。
 */
export function setActiveTask(taskId: string | null): void {
  if (!taskId) {
    close();
    currentTaskId = null;
    setStatus('disconnected', 'no active task');
    return;
  }
  if (currentTaskId === taskId && es) {
    return; // 已经在监听
  }
  open(taskId, true);
}

/**
 * 显式停止监听（任务完成 / 用户主动停止）
 */
export function stopStream(): void {
  close();
  currentTaskId = null;
  setStatus('disconnected', 'stopped');
}

/**
 * 强制重连 SSE（即使 taskId 没变）。
 *
 * 使用场景：用户点击"继续"/"重试"按钮时，HTTP API 成功但 SSE 可能已断开，
 * 后端发射的 TASK_RESUMED 事件前端收不到。此时需要强制重建 SSE 连接
 * 以接收后续事件。
 *
 * 与 setActiveTask 的区别：setActiveTask 在 taskId 未变时不重连；
 * forceReconnect 无条件先 close 再 open。
 */
export function forceReconnect(): void {
  if (currentTaskId) {
    close();
    retryCount = 0;
    setStatus('reconnecting', 'manual reconnect');
    open(currentTaskId, true);
  }
}

/**
 * 获取当前监听状态
 */
export function getStreamState(): { active: boolean; taskId: string | null } {
  return { active: !!es, taskId: currentTaskId };
}

/**
 * 用户手动触发"重试连接"——在重连预算耗尽后给用户一个出口。
 * 不暴露在 store / props，仅供其他模块 import 调用。
 *
 * 鲁棒性：即使 currentTaskId 因为某种原因被清空（比如 SSE 在 task 切换时
 * 中间状态被 close），只要 store.taskId 还在，仍能重连。Store 是单一事实源。
 */
export function retryNow(): void {
  const store = useAgentStore.getState();
  const taskId = currentTaskId || store.taskId;
  if (!taskId) {
    setStatus('disconnected', '没有可用的 task id，请刷新页面');
    return;
  }
  retryCount = 0;
  store.setReconnectAttempt(0);
  close();
  setStatus('reconnecting', 'user-triggered retry');
  currentTaskId = taskId;
  open(taskId, true);
}

// 监听 useAgentStore 状态变化，自动管理 SSE
let lastKnownTaskId: string | null = null;
let lastKnownStatus: string = 'idle';

useAgentStore.subscribe((state) => {
  const tid = state.taskId;
  const st = state.status;

  if (tid !== lastKnownTaskId) {
    lastKnownTaskId = tid;
    if (tid) {
      setActiveTask(tid);
    } else {
      stopStream();
    }
  }

  // 任务完成或失败时不断开（保持订阅以接收后续事件，比如 cost_update）
  // 只有当 taskId 被清空时才断开
  if (st !== lastKnownStatus) {
    lastKnownStatus = st;
  }
});
