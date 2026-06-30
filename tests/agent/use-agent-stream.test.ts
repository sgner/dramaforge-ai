/**
 * TDD: useAgentStream — SSE 客户端 hook。
 *
 * 关键行为：
 * - 订阅 /api/agent/tasks/{taskId}/stream
 * - 解析 event/data，调用 store.applyEvent
 * - 暴露 connection 状态 (idle/connecting/open/closed/error)
 * - 提供 disconnect() 和 reconnect()
 * - 组件 unmount 时自动关闭
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

// ---------- EventSource mock ----------
type Listener = (ev: any) => void;

class MockEventSource {
  static instances: MockEventSource[] = [];
  url: string;
  readyState: number = 0; // CONNECTING
  onopen: Listener | null = null;
  onerror: Listener | null = null;
  onmessage: Listener | null = null;
  // event-type listeners: e.g. 'thought' -> fn
  _listeners: Record<string, Listener[]> = {};

  constructor(url: string) {
    this.url = url;
    MockEventSource.instances.push(this);
  }

  addEventListener(type: string, fn: Listener) {
    (this._listeners[type] ||= []).push(fn);
  }
  removeEventListener(type: string, fn: Listener) {
    this._listeners[type] = (this._listeners[type] || []).filter((f) => f !== fn);
  }

  close() {
    this.readyState = 2;
  }

  // 测试辅助
  emit(type: string, data: any) {
    const ev = { type, data: typeof data === 'string' ? data : JSON.stringify(data) };
    const fns = this._listeners[type] || [];
    fns.forEach((f) => f(ev));
    if (this[`on${type}` as 'onmessage' | 'onerror' | 'onopen']) {
      (this[`on${type}` as 'onmessage' | 'onerror' | 'onopen'] as Listener)(ev);
    }
  }
  open() {
    this.readyState = 1;
    this.onopen?.(new Event('open'));
  }
  fail() {
    this.readyState = 0;
    this.onerror?.(new Event('error'));
  }
}

(globalThis as any).EventSource = MockEventSource;

import { useAgentStream } from '@/agent/use-agent-stream';
import { useAgentStore } from '@/agent/use-agent-store';

describe('useAgentStream', () => {
  beforeEach(() => {
    MockEventSource.instances = [];
    useAgentStore.getState().reset();
  });

  it('opens EventSource on mount with task id in url', () => {
    useAgentStore.getState().setTask('t-1', 'running');
    renderHook(() => useAgentStream('t-1'));
    expect(MockEventSource.instances).toHaveLength(1);
    expect(MockEventSource.instances[0].url).toBe('/api/agent/tasks/t-1/stream');
  });

  it('does not open EventSource when taskId is null', () => {
    renderHook(() => useAgentStream(null));
    expect(MockEventSource.instances).toHaveLength(0);
  });

  it('connection state starts at connecting then open', async () => {
    useAgentStore.getState().setTask('t-1', 'running');
    const { result } = renderHook(() => useAgentStream('t-1'));
    expect(result.current.state).toBe('connecting');
    act(() => {
      MockEventSource.instances[0].open();
    });
    expect(result.current.state).toBe('open');
  });

  it('forwards typed events to store.applyEvent', () => {
    useAgentStore.getState().setTask('t-1', 'running');
    renderHook(() => useAgentStream('t-1'));
    const es = MockEventSource.instances[0];
    act(() => {
      es.emit('thought', { type: 'thought', payload: { text: '你好' }, timestamp: 1 });
    });
    expect(useAgentStore.getState().thoughts).toHaveLength(1);
    expect(useAgentStore.getState().thoughts[0].payload.text).toBe('你好');
  });

  it('forwards task_done event to store and changes status', () => {
    useAgentStore.getState().setTask('t-1', 'running');
    renderHook(() => useAgentStream('t-1'));
    const es = MockEventSource.instances[0];
    act(() => {
      es.emit('task_done', { type: 'task_done', payload: {} });
    });
    expect(useAgentStore.getState().status).toBe('done');
  });

  it('handles non-JSON data gracefully (no throw)', () => {
    useAgentStore.getState().setTask('t-1', 'running');
    renderHook(() => useAgentStream('t-1'));
    const es = MockEventSource.instances[0];
    expect(() => {
      act(() => {
        es.emit('thought', 'not-json');
      });
    }).not.toThrow();
  });

  it('on error sets state to error', () => {
    useAgentStore.getState().setTask('t-1', 'running');
    const { result } = renderHook(() => useAgentStream('t-1'));
    act(() => {
      MockEventSource.instances[0].fail();
    });
    expect(result.current.state).toBe('error');
  });

  it('disconnect closes the EventSource and sets state to closed', () => {
    useAgentStore.getState().setTask('t-1', 'running');
    const { result } = renderHook(() => useAgentStream('t-1'));
    act(() => {
      result.current.disconnect();
    });
    expect(MockEventSource.instances[0].readyState).toBe(2);
    expect(result.current.state).toBe('closed');
  });

  it('closes EventSource on unmount', () => {
    useAgentStore.getState().setTask('t-1', 'running');
    const { unmount } = renderHook(() => useAgentStream('t-1'));
    const es = MockEventSource.instances[0];
    unmount();
    expect(es.readyState).toBe(2);
  });

  it('reconnect closes old and opens new EventSource', () => {
    useAgentStore.getState().setTask('t-1', 'running');
    const { result } = renderHook(() => useAgentStream('t-1'));
    const first = MockEventSource.instances[0];
    act(() => {
      result.current.reconnect();
    });
    expect(first.readyState).toBe(2);
    expect(MockEventSource.instances).toHaveLength(2);
    expect(MockEventSource.instances[1].url).toBe('/api/agent/tasks/t-1/stream');
  });
});

describe('useAgentStream backoff', () => {
  beforeEach(() => {
    MockEventSource.instances = [];
    useAgentStore.getState().reset();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('retries connection on error with exponential backoff', async () => {
    useAgentStore.getState().setTask('t-1', 'running');
    renderHook(() => useAgentStream('t-1', { backoffMs: 100, maxBackoffMs: 800 }));
    expect(MockEventSource.instances).toHaveLength(1);
    // 第 1 次失败
    act(() => { MockEventSource.instances[0].fail(); });
    await act(async () => { vi.advanceTimersByTime(100); });
    expect(MockEventSource.instances.length).toBeGreaterThanOrEqual(2);
  });

  it('stops retrying after 4 attempts and sets state to error', async () => {
    useAgentStore.getState().setTask('t-1', 'running');
    const { result } = renderHook(() => useAgentStream('t-1', { backoffMs: 10, maxBackoffMs: 40 }));
    for (let i = 0; i < 4; i++) {
      const es = MockEventSource.instances[MockEventSource.instances.length - 1];
      act(() => { es.fail(); });
      await act(async () => { vi.advanceTimersByTime(100); });
    }
    expect(result.current.state).toBe('error');
  });

  it('useAgentStream accepts options parameter without breaking existing behavior', () => {
    useAgentStore.getState().setTask('t-1', 'running');
    // 不传 options 也应该能跑
    expect(() => renderHook(() => useAgentStream('t-1'))).not.toThrow();
  });
});
