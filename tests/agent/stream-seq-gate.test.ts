/**
 * agent-stream-manager 事件序号闸测试（阶段 2.2）。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@/services/apiClient', () => ({
  api: {
    getAgentTask: vi.fn().mockResolvedValue({ user_goal: 'g', status: 'running' }),
    listAgentSteps: vi.fn().mockResolvedValue([]),
  },
}));

import { __streamSeqTest__ } from '@/agent/agent-stream-manager';

describe('acceptSeq (event seq gate)', () => {
  beforeEach(() => {
    __streamSeqTest__.setLastSeq(0);
  });

  it('accepts events in order and tracks the cursor', () => {
    expect(__streamSeqTest__.acceptSeq(1, 't1')).toBe(true);
    expect(__streamSeqTest__.acceptSeq(2, 't1')).toBe(true);
    expect(__streamSeqTest__.getLastSeq()).toBe(2);
  });

  it('skips duplicate/replayed events (seq <= lastSeq)', () => {
    __streamSeqTest__.setLastSeq(3);
    expect(__streamSeqTest__.acceptSeq(2, 't1')).toBe(false);
    expect(__streamSeqTest__.acceptSeq(3, 't1')).toBe(false);
    expect(__streamSeqTest__.acceptSeq(4, 't1')).toBe(true);
  });

  it('triggers rehydrate on gap but still applies the event', () => {
    __streamSeqTest__.setLastSeq(2);
    // 缺页 3，直接来 4 → 应放行并触发 rehydrate（内部调 api.getAgentTask）
    expect(__streamSeqTest__.acceptSeq(4, 't1')).toBe(true);
    expect(__streamSeqTest__.getLastSeq()).toBe(4);
  });

  it('passes through events without seq (heartbeat / legacy)', () => {
    __streamSeqTest__.setLastSeq(5);
    expect(__streamSeqTest__.acceptSeq(undefined, 't1')).toBe(true);
    expect(__streamSeqTest__.acceptSeq(0, 't1')).toBe(true);
    expect(__streamSeqTest__.getLastSeq()).toBe(5);
  });
});
