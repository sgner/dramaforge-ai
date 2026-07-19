/**
 * @deprecated 该 hook 已被 agent/agent-stream-manager.ts（全局 SSE 管理器）取代，
 * 生产代码不再引用（仅 tests/agent/use-agent-stream.test.ts 仍在用）。
 * 注意：本文件内的 TYPES 清单未与后端 EventType 全量同步（缺 tool_error 等
 * Spec B 事件），如需复用请先对齐 agent-stream-manager.ts 的 EVENT_TYPES。
 *
 * useAgentStream — SSE 客户端 hook。
 *
 * 用法：
 *   const { state, disconnect, reconnect } = useAgentStream(taskId, options?);
 *
 * 行为：
 * - 订阅 GET /api/agent/tasks/{taskId}/stream
 * - 把每个 event-type 消息解析为 AgentEventLike 并转发给 useAgentStore.applyEvent
 * - 跟踪连接状态: 'idle' | 'connecting' | 'open' | 'closed' | 'error'
 * - taskId 为 null 时不连接
 * - 组件 unmount 时自动关闭
 * - 连接断开时按指数退避自动重连 (delay = min(backoffMs * 2^attempt, maxBackoffMs))，
 *   累计失败 maxRetries 次后停止重试并保持 state='error'
 */
import { useEffect, useRef, useState, useCallback } from 'react';
import { useAgentStore } from './use-agent-store';

export type StreamState = 'idle' | 'connecting' | 'open' | 'closed' | 'error';

export interface UseAgentStreamOptions {
  /** 首次重试的退避基数（毫秒），默认 1000 */
  backoffMs?: number;
  /** 单次重试的最大退避（毫秒），默认 30000 */
  maxBackoffMs?: number;
  /** 最多重试次数（达到后 state 变为 'error'），默认 4 */
  maxRetries?: number;
}

export interface UseAgentStreamResult {
  state: StreamState;
  disconnect: () => void;
  reconnect: () => void;
}

function streamUrl(taskId: string): string {
  return `/api/agent/tasks/${encodeURIComponent(taskId)}/stream`;
}

export function useAgentStream(
  taskId: string | null,
  options?: UseAgentStreamOptions,
): UseAgentStreamResult {
  const [state, setState] = useState<StreamState>(taskId ? 'connecting' : 'idle');
  const esRef = useRef<EventSource | null>(null);
  const retryCountRef = useRef(0);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const applyEvent = useAgentStore((s) => s.applyEvent);

  const backoffMs = options?.backoffMs ?? 1000;
  const maxBackoffMs = options?.maxBackoffMs ?? 30000;
  const maxRetries = options?.maxRetries ?? 4;

  // 用 ref 持有最新的 open 实现，避免 onerror/setTimeout 闭包陈旧
  const openRef = useRef<(id: string) => void>(() => {});

  // 关闭当前连接 + 取消待执行的重试定时器
  const close = useCallback(() => {
    if (esRef.current) {
      try {
        esRef.current.close();
      } catch {
        /* ignore */
      }
      esRef.current = null;
    }
    if (retryTimerRef.current != null) {
      clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
  }, []);

  const open = useCallback(
    (id: string) => {
      close();
      if (typeof EventSource === 'undefined') return;
      // 注意：retryCount 由调用方决定是否重置：
      // - useEffect / reconnect / disconnect 后：调用方在调用 open 前手动重置
      // - setTimeout 触发的自动重连：不重置，累计失败次数
      setState('connecting');
      const es = new EventSource(streamUrl(id));
      esRef.current = es;

      es.onopen = () => setState('open');
      es.onerror = () => {
        // 每次失败：累计计数 + 标记为 error（兼容旧测试 "on error sets state to error"）
        retryCountRef.current += 1;
        setState('error');
        if (retryCountRef.current >= maxRetries) {
          // 已达上限，停止重试
          return;
        }
        const attempt = retryCountRef.current - 1;
        const delay = Math.min(
          backoffMs * Math.pow(2, attempt),
          maxBackoffMs,
        );
        retryTimerRef.current = setTimeout(() => {
          retryTimerRef.current = null;
          // 使用 ref 调用最新的 open，避免循环依赖
          openRef.current(id);
        }, delay);
      };

      // 监听所有已知事件类型（后端推什么类型都会触发同名 listener）
      const TYPES = [
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
      for (const t of TYPES) {
        es.addEventListener(t, (ev: any) => {
          const raw = ev?.data ?? '';
          let payload: Record<string, any> = {};
          try {
            const parsed = JSON.parse(raw);
            if (parsed && typeof parsed === 'object') {
              // 兼容：后端推的是完整 event 还是裸 payload
              if ('type' in parsed) {
                applyEvent({
                  type: parsed.type,
                  payload: parsed.payload || {},
                  timestamp: parsed.timestamp,
                });
                return;
              }
              payload = parsed;
            }
          } catch {
            // 非 JSON：忽略该条
            return;
          }
          applyEvent({ type: t, payload, timestamp: Date.now() / 1000 });
        });
      }

      // 通用 message 也兜底
      es.onmessage = (ev: any) => {
        try {
          const parsed = JSON.parse(ev.data);
          if (parsed && typeof parsed === 'object' && 'type' in parsed) {
            applyEvent({
              type: parsed.type,
              payload: parsed.payload || {},
              timestamp: parsed.timestamp,
            });
          }
        } catch {
          /* ignore */
        }
      };
    },
    [close, applyEvent, backoffMs, maxBackoffMs, maxRetries],
  );

  // 每次渲染同步最新 open 实现到 ref
  openRef.current = open;

  // taskId 变化时重连（同时重置 retryCount）
  useEffect(() => {
    if (!taskId) {
      close();
      setState('idle');
      return;
    }
    retryCountRef.current = 0;
    open(taskId);
    return () => {
      close();
      setState('closed');
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskId]);

  const disconnect = useCallback(() => {
    close();
    setState('closed');
  }, [close]);

  const reconnect = useCallback(() => {
    if (taskId) {
      retryCountRef.current = 0;
      open(taskId);
    }
  }, [open, taskId]);

  return { state, disconnect, reconnect };
}
