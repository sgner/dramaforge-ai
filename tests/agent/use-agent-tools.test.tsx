/**
 * TDD: useAgentTools — 拉取 /api/agent/tools 远端元数据，失败时回退到 PALETTE_TOOLS。
 *
 * 关键行为：
 * - 成功拉取时，返回远端 tool 列表
 * - 拉取失败（网络/非 2xx）时，回退到 PALETTE_TOOLS，并保留 error
 * - isLoading 从 true 变为 false
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useAgentTools } from '@/agent/use-agent-tools';

const REMOTE = [
  { name: 'foo', description: 'd', category: 'planning', requires_approval: false },
  { name: 'bar', description: 'd', category: 'llm', requires_approval: true },
];

describe('useAgentTools', () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => REMOTE,
    } as any);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns remote tools on success', async () => {
    const { result } = renderHook(() => useAgentTools());
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.tools).toHaveLength(2);
    expect(result.current.tools[0].name).toBe('foo');
    expect(result.current.error).toBeNull();
  });

  it('falls back to hardcoded palette on fetch failure', async () => {
    (globalThis.fetch as any).mockRejectedValueOnce(new Error('network'));
    const { result } = renderHook(() => useAgentTools());
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.tools.length).toBeGreaterThanOrEqual(18);
    expect(result.current.error).not.toBeNull();
  });

  it('isLoading starts true then turns false', async () => {
    const { result } = renderHook(() => useAgentTools());
    expect(result.current.isLoading).toBe(true);
    await waitFor(() => expect(result.current.isLoading).toBe(false));
  });
});
