import { describe, it, expect, vi, beforeEach } from 'vitest';
import { promptTemplates, PromptTemplateOut } from '../../services/apiClient';

// Mock fetch
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

function mockResponse(data: any, ok = true, status = 200) {
  return {
    ok,
    status,
    statusText: 'OK',
    headers: new Headers({ 'content-type': 'application/json' }),
    text: async () => JSON.stringify(data),
    json: async () => data,
  } as Response;
}

beforeEach(() => mockFetch.mockReset());

describe('promptTemplates API', () => {
  it('list() calls GET /api/prompt-templates', async () => {
    const items: PromptTemplateOut[] = [
      { id: 'builtin_md_1', name: 'Test', category: 'character', scene: '', positive: 'p', negative: 'n', params: {}, is_builtin: true, created_at: '', updated_at: '' },
    ];
    mockFetch.mockResolvedValue(mockResponse(items));
    const result = await promptTemplates.list();
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/prompt-templates',
      expect.objectContaining({ headers: expect.any(Object) })
    );
    expect(result).toEqual(items);
  });

  it('list(category) adds query param', async () => {
    mockFetch.mockResolvedValue(mockResponse([]));
    await promptTemplates.list('character');
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/prompt-templates?category=character',
      expect.any(Object)
    );
  });

  it('create() sends POST', async () => {
    const created = { id: 'tpl_abc', name: 'New', category: 'custom', scene: '', positive: 'p', negative: '', params: {}, is_builtin: false, created_at: '', updated_at: '' };
    mockFetch.mockResolvedValue(mockResponse(created));
    const result = await promptTemplates.create({ name: 'New', category: 'custom', scene: '', positive: 'p', negative: '', params: {} });
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/prompt-templates',
      expect.objectContaining({ method: 'POST', body: expect.any(String) })
    );
    expect(result.id).toBe('tpl_abc');
  });

  it('update() sends PUT', async () => {
    mockFetch.mockResolvedValue(mockResponse({ id: 'tpl_abc', name: 'Updated' }));
    await promptTemplates.update('tpl_abc', { name: 'Updated' });
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/prompt-templates/tpl_abc',
      expect.objectContaining({ method: 'PUT' })
    );
  });

  it('remove() sends DELETE', async () => {
    mockFetch.mockResolvedValue(mockResponse({ ok: true }));
    await promptTemplates.remove('tpl_abc');
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/prompt-templates/tpl_abc',
      expect.objectContaining({ method: 'DELETE' })
    );
  });
});
