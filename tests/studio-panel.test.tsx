/**
 * StudioPanel 组件测试：
 *  1. 渲染表单（故事输入 / 供应商下拉 / 生成按钮）
 *  2. 提交后 POST 拿 task_id 并开始轮询 GET
 *  3. 轮询到 status=done 后显示 <video> 和下载链接
 *  4. 卸载后停止轮询（不再发 GET）
 *
 * mock 方式：vi.mock('@/services/apiClient') 替换整个 api 对象。
 * i18n：不包 I18nProvider，useI18n 兜底返回 zh 文案。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, act, cleanup } from '@testing-library/react';
import { StudioPanel } from '@/components/StudioPanel';

const mockListProviders = vi.fn();
const mockListCards = vi.fn();
const mockCreate = vi.fn();
const mockGet = vi.fn();

vi.mock('@/services/apiClient', () => ({
  api: {
    listProviders: (...args: any[]) => mockListProviders(...args),
    listStudioCharacterCards: (...args: any[]) => mockListCards(...args),
    createStudioEpisode: (...args: any[]) => mockCreate(...args),
    getStudioEpisode: (...args: any[]) => mockGet(...args),
  },
}));

const PROVIDERS = [
  {
    provider_id: 'img-prov',
    name: 'Image Provider',
    enabled: true,
    image_models: ['img-v1', 'img-v2'],
    chat_models: [],
    video_models: [],
  },
  {
    provider_id: 'llm-prov',
    name: 'LLM Provider',
    enabled: true,
    image_models: [],
    chat_models: ['chat-v1'],
    video_models: [],
  },
  {
    provider_id: 'disabled-prov',
    name: 'Disabled Provider',
    enabled: false,
    image_models: ['img-x'],
    chat_models: [],
    video_models: [],
  },
];

const runningTask = {
  task_id: 'task-1',
  status: 'running',
  progress: {
    phase: 'shooting',
    current_shot: 1,
    total_shots: 2,
    shots: [
      { title: '镜头 1', status: 'running', rounds: 1 },
      { title: '镜头 2', status: 'pending', rounds: 0 },
    ],
  },
  result: null,
  error: null,
};

const doneTask = {
  task_id: 'task-1',
  status: 'done',
  progress: {
    phase: 'finished',
    current_shot: 2,
    total_shots: 2,
    shots: [
      { title: '镜头 1', status: 'approved', rounds: 2 },
      { title: '镜头 2', status: 'approved', rounds: 1 },
    ],
  },
  result: { episode_asset_id: 'a-1', url: '/files/ep1.mp4', shots: [], export: {} },
  error: null,
};

/** 填好故事 + 选好图像供应商/模型。 */
async function fillForm() {
  fireEvent.change(screen.getByTestId('studio-story-input'), {
    target: { value: '一个女孩在雨中寻找丢失的猫。' },
  });
  fireEvent.change(screen.getByTestId('studio-image-provider'), {
    target: { value: 'img-prov' },
  });
  fireEvent.change(screen.getByTestId('studio-image-model'), {
    target: { value: 'img-v1' },
  });
}

describe('<StudioPanel />', () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    mockListProviders.mockResolvedValue(PROVIDERS);
    mockListCards.mockResolvedValue([
      {
        card_id: 'card-1',
        name: '小雪',
        identity: { face_anchor: '圆脸，齐刘海，大眼睛' },
        reference_asset_ids: [],
        url: null,
      },
    ]);
    mockCreate.mockResolvedValue({ task_id: 'task-1' });
    mockGet.mockResolvedValue(runningTask);
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('渲染表单：故事输入 / 标题 / 镜头数 / 供应商下拉 / 角色卡 / 生成按钮', async () => {
    render(<StudioPanel projectId="proj-1" onClose={() => {}} />);

    expect(screen.getByTestId('studio-story-input')).toBeInTheDocument();
    expect(screen.getByTestId('studio-title-input')).toBeInTheDocument();
    expect(screen.getByTestId('studio-max-shots')).toHaveValue(5);
    expect(screen.getByTestId('studio-generate-button')).toBeInTheDocument();

    // providers 加载后：图像供应商下拉只含 enabled 且有 image_models 的 provider
    await waitFor(() => {
      const select = screen.getByTestId('studio-image-provider') as HTMLSelectElement;
      expect(select.querySelector('option[value="img-prov"]')).not.toBeNull();
    });
    const select = screen.getByTestId('studio-image-provider') as HTMLSelectElement;
    expect(select.querySelector('option[value="disabled-prov"]')).toBeNull();
    expect(select.querySelector('option[value="llm-prov"]')).toBeNull();

    // 角色卡列表（name + face_anchor 摘要）
    await waitFor(() => {
      expect(screen.getByText('小雪')).toBeInTheDocument();
    });
    expect(screen.getByText('圆脸，齐刘海，大眼睛')).toBeInTheDocument();
    expect(mockListCards).toHaveBeenCalledWith('proj-1');
  });

  it('点"生成整集"后 POST 创建任务并开始轮询', async () => {
    render(<StudioPanel projectId="proj-1" onClose={() => {}} />);
    await waitFor(() => {
      expect(
        (screen.getByTestId('studio-image-provider') as HTMLSelectElement).querySelector(
          'option[value="img-prov"]'
        )
      ).not.toBeNull();
    });
    await fillForm();
    // 选中角色卡
    fireEvent.click(screen.getByTestId('studio-card-card-1'));

    fireEvent.click(screen.getByTestId('studio-generate-button'));

    await waitFor(() => {
      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          project_id: 'proj-1',
          story_text: '一个女孩在雨中寻找丢失的猫。',
          image_provider_id: 'img-prov',
          image_model: 'img-v1',
          max_shots: 5,
          character_card_ids: ['card-1'],
        })
      );
    });

    // 提交后立即第一次轮询，进度区出现
    await waitFor(() => {
      expect(mockGet).toHaveBeenCalledWith('task-1');
    });
    expect(screen.getByTestId('studio-progress')).toBeInTheDocument();
    expect(screen.getByTestId('studio-shot-0')).toBeInTheDocument();
  });

  it('轮询到 done 后显示 video 和下载链接', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    mockGet.mockResolvedValueOnce(runningTask).mockResolvedValue(doneTask);

    render(<StudioPanel projectId="proj-1" onClose={() => {}} />);
    await waitFor(() => {
      expect(
        (screen.getByTestId('studio-image-provider') as HTMLSelectElement).querySelector(
          'option[value="img-prov"]'
        )
      ).not.toBeNull();
    });
    await fillForm();
    fireEvent.click(screen.getByTestId('studio-generate-button'));

    // 第一次轮询（立即）：running
    await waitFor(() => {
      expect(mockGet).toHaveBeenCalledTimes(1);
    });
    expect(screen.queryByTestId('studio-video')).toBeNull();

    // 推进 3s：第二次轮询返回 done → 停止轮询并显示 video
    await act(async () => {
      vi.advanceTimersByTime(3100);
    });
    await waitFor(() => {
      expect(screen.getByTestId('studio-video')).toBeInTheDocument();
    });
    const video = screen.getByTestId('studio-video') as HTMLVideoElement;
    expect(video.getAttribute('src')).toBe('/files/ep1.mp4');
    expect(screen.getByTestId('studio-download')).toHaveAttribute('href', '/files/ep1.mp4');

    // done 后不再轮询
    const callsAfterDone = mockGet.mock.calls.length;
    await act(async () => {
      vi.advanceTimersByTime(7000);
    });
    expect(mockGet.mock.calls.length).toBe(callsAfterDone);
  });

  it('组件卸载后停止轮询', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    render(<StudioPanel projectId="proj-1" onClose={() => {}} />);
    await waitFor(() => {
      expect(
        (screen.getByTestId('studio-image-provider') as HTMLSelectElement).querySelector(
          'option[value="img-prov"]'
        )
      ).not.toBeNull();
    });
    await fillForm();
    fireEvent.click(screen.getByTestId('studio-generate-button'));

    await waitFor(() => {
      expect(mockGet).toHaveBeenCalledTimes(1);
    });

    cleanup(); // 卸载
    await act(async () => {
      vi.advanceTimersByTime(10000);
    });
    expect(mockGet).toHaveBeenCalledTimes(1);
  });

  it('failed 状态显示错误信息', async () => {
    mockGet.mockResolvedValue({
      ...runningTask,
      status: 'failed',
      error: 'LLM upstream 401',
    });
    render(<StudioPanel projectId="proj-1" onClose={() => {}} />);
    await waitFor(() => {
      expect(
        (screen.getByTestId('studio-image-provider') as HTMLSelectElement).querySelector(
          'option[value="img-prov"]'
        )
      ).not.toBeNull();
    });
    await fillForm();
    fireEvent.click(screen.getByTestId('studio-generate-button'));

    await waitFor(() => {
      expect(screen.getByTestId('studio-task-error')).toBeInTheDocument();
    });
    expect(screen.getByTestId('studio-task-error').textContent).toContain('LLM upstream 401');
    expect(screen.queryByTestId('studio-video')).toBeNull();
  });
});
