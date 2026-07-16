import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { PromptLibraryPanel } from '../../components/PromptLibraryPanel';
import { promptTemplates } from '../../services/apiClient';

// Mock the API
vi.mock('../../services/apiClient', () => ({
  promptTemplates: {
    list: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
    batchRemove: vi.fn(),
  },
}));

const mockTemplates = [
  { id: 'builtin_md_1', name: '多机位九宫格', category: 'character', scene: '9 views', positive: 'A multi-camera sheet', negative: 'bad', params: {}, is_builtin: true, created_at: '', updated_at: '' },
  { id: 'builtin_md_10', name: '360全景图', category: 'view', scene: '360 pano', positive: 'panorama', negative: 'seam', params: {}, is_builtin: true, created_at: '', updated_at: '' },
  { id: 'tpl_abc', name: 'My Custom', category: 'custom', scene: 'custom', positive: 'custom prompt', negative: '', params: {}, is_builtin: false, created_at: '', updated_at: '' },
];

beforeEach(() => {
  vi.mocked(promptTemplates.list).mockResolvedValue(mockTemplates);
});

describe('PromptLibraryPanel', () => {
  it('renders templates from API', async () => {
    render(<PromptLibraryPanel onInsert={vi.fn()} />);
    await waitFor(() => {
      expect(screen.getByText('多机位九宫格')).toBeInTheDocument();
      expect(screen.getByText('360全景图')).toBeInTheDocument();
    });
  });

  it('filters by category', async () => {
    vi.mocked(promptTemplates.list).mockClear();
    vi.mocked(promptTemplates.list).mockResolvedValue(mockTemplates.filter(t => t.category === 'character'));
    render(<PromptLibraryPanel onInsert={vi.fn()} />);
    const charBtn = await screen.findByText('角色');
    fireEvent.click(charBtn);
    await waitFor(() => {
      expect(promptTemplates.list).toHaveBeenCalledWith('character');
    });
  });

  it('searches by name', async () => {
    render(<PromptLibraryPanel onInsert={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('多机位九宫格')).toBeInTheDocument());
    const input = screen.getByPlaceholderText('搜索...');
    fireEvent.change(input, { target: { value: '360' } });
    expect(screen.getByText('360全景图')).toBeInTheDocument();
    expect(screen.queryByText('多机位九宫格')).not.toBeInTheDocument();
  });

  it('calls onInsert when insert button clicked', async () => {
    const onInsert = vi.fn();
    render(<PromptLibraryPanel onInsert={onInsert} />);
    await waitFor(() => expect(screen.getByText('多机位九宫格')).toBeInTheDocument());
    const insertBtn = screen.getAllByText('插入')[0];
    fireEvent.click(insertBtn);
    expect(onInsert).toHaveBeenCalledWith(mockTemplates[0]);
  });

  it('shows builtin badge for builtin templates', async () => {
    render(<PromptLibraryPanel onInsert={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('多机位九宫格')).toBeInTheDocument());
    expect(screen.getAllByText('内置').length).toBeGreaterThan(0);
  });

  it('hides delete button for builtin templates', async () => {
    render(<PromptLibraryPanel onInsert={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('多机位九宫格')).toBeInTheDocument());
    // Builtin templates should not have delete buttons
    // User template "My Custom" should have delete
    const deleteBtns = screen.getAllByText('删除');
    expect(deleteBtns.length).toBe(1); // Only the user template
  });

  it('creates new template', async () => {
    vi.mocked(promptTemplates.create).mockResolvedValue({
      id: 'tpl_new', name: 'New Template', category: 'custom', scene: '', positive: 'new', negative: '', params: {}, is_builtin: false, created_at: '', updated_at: '',
    });
    render(<PromptLibraryPanel onInsert={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('多机位九宫格')).toBeInTheDocument());
    fireEvent.click(screen.getByText('新建模板'));
    fireEvent.change(screen.getByLabelText('名称'), { target: { value: 'New Template' } });
    fireEvent.change(screen.getByLabelText('正向提示词'), { target: { value: 'new' } });
    fireEvent.click(screen.getByText('保存'));
    await waitFor(() => {
      expect(promptTemplates.create).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'New Template', positive: 'new' })
      );
    });
  });
});
