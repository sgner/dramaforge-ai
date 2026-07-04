/**
 * agent-stream-manager — 全局 SSE 连接管理
 *
 * 设计目标：
 *   - 当用户进入 agent 模式并开始任务时，自动建立 SSE 连接
 *   - 当用户退出 agent 模式时，连接保持（不随组件 unmount 断开）
 *   - 任务完成（done/failed）时自动断开
 *   - 支持断线重连（指数退避）
 *
 * 使用：
 *   - 模块加载时自动启动（无副作用）
 *   - 调用 `setActiveTask(taskId)` 切换监听任务
 *   - 调用 `stopStream()` 显式停止
 */
import { useAgentStore } from './use-agent-store';

let es: EventSource | null = null;
let retryCount = 0;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let currentTaskId: string | null = null;
let lastEventTime = 0;
let heartbeatTimer: ReturnType<typeof setTimeout> | null = null;
const MAX_RETRIES = 8;
const BACKOFF_MS = 1000;
const MAX_BACKOFF_MS = 30000;
const HEARTBEAT_TIMEOUT = 30_000;

const EVENT_TYPES = [
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
];

function streamUrl(taskId: string): string {
  return `/api/agent/tasks/${encodeURIComponent(taskId)}/stream`;
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
}

function startHeartbeat(): void {
  if (heartbeatTimer) clearTimeout(heartbeatTimer);
  heartbeatTimer = setTimeout(() => {
    // 30s 没收到事件，认为连接断了
    if (Date.now() - lastEventTime > HEARTBEAT_TIMEOUT) {
      // eslint-disable-next-line no-console
      console.warn('[agent-stream-manager] heartbeat timeout, reconnecting');
      close();
      retryCount += 1;
      if (currentTaskId && retryCount < MAX_RETRIES) {
        const delay = Math.min(BACKOFF_MS * Math.pow(2, retryCount - 1), MAX_BACKOFF_MS);
        retryTimer = setTimeout(() => {
          retryTimer = null;
          open(currentTaskId);
        }, delay);
      }
    } else {
      startHeartbeat();
    }
  }, HEARTBEAT_TIMEOUT);
}

function open(taskId: string): void {
  if (typeof EventSource === 'undefined') return;
  if (es) close();
  currentTaskId = taskId;
  retryCount = 0;
  lastEventTime = Date.now();

  const stream = new EventSource(streamUrl(taskId));
  es = stream;
  startHeartbeat();

  stream.onopen = () => {
    retryCount = 0;
    lastEventTime = Date.now();
    startHeartbeat();
  };

  stream.onerror = () => {
    // eslint-disable-next-line no-console
    console.warn('[agent-stream-manager] connection error, retrying');
    close();
    if (currentTaskId && retryCount < MAX_RETRIES) {
      retryCount += 1;
      const delay = Math.min(BACKOFF_MS * Math.pow(2, retryCount - 1), MAX_BACKOFF_MS);
      retryTimer = setTimeout(() => {
        retryTimer = null;
        if (currentTaskId) open(currentTaskId);
      }, delay);
    }
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
    return;
  }
  if (currentTaskId === taskId && es) {
    return; // 已经在监听
  }
  open(taskId);
}

/**
 * 显式停止监听（任务完成 / 用户主动停止）
 */
export function stopStream(): void {
  close();
  currentTaskId = null;
}

/**
 * 获取当前监听状态
 */
export function getStreamState(): { active: boolean; taskId: string | null } {
  return { active: !!es, taskId: currentTaskId };
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
