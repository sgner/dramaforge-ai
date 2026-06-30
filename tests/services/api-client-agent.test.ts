/**
 * TDD: apiClient.listAgentTools / listAgentTasks — 对接后端
 *   GET /api/agent/tools
 *   GET /api/agent/tasks?project_id=X
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { api as apiClient } from '@/services/apiClient';

const jsonResponse = (body: unknown) => ({
  ok: true,
  headers: { get: (h: string) => (h.toLowerCase() === 'content-type' ? 'application/json' : null) },
  json: async () => body,
});

describe('apiClient agent methods', () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('listAgentTools returns array from /api/agent/tools', async () => {
    (globalThis.fetch as any).mockResolvedValueOnce(
      jsonResponse([{ name: 'a', description: 'd', category: 'planning', requires_approval: false }])
    );
    const r = await apiClient.listAgentTools();
    expect(r).toHaveLength(1);
    expect(r[0].name).toBe('a');
  });

  it('listAgentTasks with projectId calls query string', async () => {
    (globalThis.fetch as any).mockResolvedValueOnce(jsonResponse([]));
    await apiClient.listAgentTasks('p-123');
    const called = (globalThis.fetch as any).mock.calls[0][0] as string;
    expect(called).toContain('/api/agent/tasks');
    expect(called).toContain('project_id=p-123');
  });

  it('listAgentTasks without projectId omits query string', async () => {
    (globalThis.fetch as any).mockResolvedValueOnce(jsonResponse([]));
    await apiClient.listAgentTasks();
    const called = (globalThis.fetch as any).mock.calls[0][0] as string;
    expect(called).toMatch(/\/api\/agent\/tasks$/);
  });
});
