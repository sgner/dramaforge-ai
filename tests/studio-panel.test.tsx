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
const mockListShots = vi.fn();
const mockReview = vi.fn();
const mockRegenerate = vi.fn();

vi.mock('@/services/apiClient', () => ({
  api: {
    listProviders: (...args: any[]) => mockListProviders(...args),
    listStudioCharacterCards: (...args: any[]) => mockListCards(...args),
    createStudioEpisode: (...args: any[]) => mockCreate(...args),
    getStudioEpisode: (...args: any[]) => mockGet(...args),
    listStudioShots: (...args: any[]) => mockListShots(...args),
    reviewStudioShot: (...args: any[]) => mockReview(...args),
    regenerateStudioShot: (...args: any[]) => mockRegenerate(...args),
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
    mockListShots.mockResolvedValue([]);
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

  it('审片台：渲染镜头列表（版本分组 + critic/审核状态标记）', async () => {
    mockListShots.mockResolvedValue([
      {
        asset_id: 'a-1',
        brief: '雨夜街道',
        title: '镜头 1',
        url: '/files/s1v1.png',
        prompt: 'rainy street',
        critic_status: 'approved',
        review_status: 'pending_review',
        review_note: null,
        version: 1,
        versions: 2,
        created_at: '2026-07-19T10:00:00Z',
      },
      {
        asset_id: 'a-2',
        brief: '雨夜街道',
        title: '镜头 1',
        url: '/files/s1v2.png',
        prompt: 'rainy street v2',
        critic_status: 'max_rounds_exceeded',
        review_status: 'locked',
        review_note: null,
        version: 2,
        versions: 2,
        created_at: '2026-07-19T10:05:00Z',
      },
      {
        asset_id: 'a-3',
        brief: '室内特写',
        title: '镜头 2',
        url: '/files/s2v1.png',
        prompt: 'close up',
        critic_status: null,
        review_status: 'rejected',
        review_note: '光影不对',
        version: 1,
        versions: 1,
        created_at: '2026-07-19T10:10:00Z',
      },
    ]);

    render(<StudioPanel projectId="proj-1" onClose={() => {}} />);

    await waitFor(() => {
      expect(screen.getByTestId('studio-shot-card-a-1')).toBeInTheDocument();
    });
    expect(mockListShots).toHaveBeenCalledWith('proj-1');

    // brief 分组 + version x/y
    expect(screen.getByText('雨夜街道')).toBeInTheDocument();
    expect(screen.getByText('室内特写')).toBeInTheDocument();
    expect(screen.getByText('v1/2')).toBeInTheDocument();
    expect(screen.getByText('v2/2')).toBeInTheDocument();

    // 缩略图
    expect(screen.getByTestId('studio-shot-card-a-1').querySelector('img')).toHaveAttribute(
      'src',
      '/files/s1v1.png'
    );

    // review_status 标记（zh 兜底文案）
    expect(screen.getByTestId('studio-review-status-a-1')).toHaveTextContent('待审');
    expect(screen.getByTestId('studio-review-status-a-2')).toHaveTextContent('已锁定');
    expect(screen.getByTestId('studio-review-status-a-3')).toHaveTextContent('已退回');

    // critic 初筛标记
    expect(screen.getByTestId('studio-shot-card-a-1')).toHaveTextContent('初筛通过');
    expect(screen.getByTestId('studio-shot-card-a-2')).toHaveTextContent('初筛未过');

    // 退回备注
    expect(screen.getByTestId('studio-shot-card-a-3')).toHaveTextContent('光影不对');

    // 已锁定的显示"解锁"，未锁定的显示"通过/退回/锁定"
    expect(screen.getByTestId('studio-review-unlock-a-2')).toBeInTheDocument();
    expect(screen.queryByTestId('studio-review-approve-a-2')).toBeNull();
    expect(screen.getByTestId('studio-review-approve-a-1')).toBeInTheDocument();
    expect(screen.getByTestId('studio-review-reject-a-1')).toBeInTheDocument();
    expect(screen.getByTestId('studio-review-lock-a-1')).toBeInTheDocument();
  });

  it('审片台：点"通过"调 review API 并就地把状态更新为已通过', async () => {
    mockListShots.mockResolvedValue([
      {
        asset_id: 'a-1',
        brief: '雨夜街道',
        title: '镜头 1',
        url: '/files/s1.png',
        prompt: 'rainy street',
        critic_status: 'approved',
        review_status: 'pending_review',
        review_note: null,
        version: 1,
        versions: 1,
        created_at: '2026-07-19T10:00:00Z',
      },
    ]);
    mockReview.mockResolvedValue({
      asset_id: 'a-1',
      review_status: 'approved',
      review_note: null,
    });

    render(<StudioPanel projectId="proj-1" onClose={() => {}} />);
    await waitFor(() => {
      expect(screen.getByTestId('studio-review-approve-a-1')).toBeInTheDocument();
    });
    expect(screen.getByTestId('studio-review-status-a-1')).toHaveTextContent('待审');

    fireEvent.click(screen.getByTestId('studio-review-approve-a-1'));

    await waitFor(() => {
      expect(mockReview).toHaveBeenCalledWith('a-1', 'approve', undefined);
    });
    await waitFor(() => {
      expect(screen.getByTestId('studio-review-status-a-1')).toHaveTextContent('已通过');
    });
  });

  it('审片台：点"重新生成"调 regenerate API（表单区供应商/模型）并刷新列表', async () => {
    mockListShots.mockResolvedValue([
      {
        asset_id: 'a-1',
        brief: '雨夜街道',
        title: '镜头 1',
        url: '/files/s1.png',
        prompt: 'rainy street',
        critic_status: 'approved',
        review_status: 'pending_review',
        review_note: null,
        version: 1,
        versions: 1,
        created_at: '2026-07-19T10:00:00Z',
      },
    ]);
    mockRegenerate.mockResolvedValue({
      status: 'approved',
      asset_id: 'a-2',
      url: '/files/s1v2.png',
      prompt: 'rainy street v2',
      rounds: 2,
    });

    render(<StudioPanel projectId="proj-1" onClose={() => {}} />);
    await waitFor(() => {
      expect(
        (screen.getByTestId('studio-image-provider') as HTMLSelectElement).querySelector(
          'option[value="img-prov"]'
        )
      ).not.toBeNull();
    });
    await waitFor(() => {
      expect(screen.getByTestId('studio-regen-a-1')).toBeInTheDocument();
    });
    await fillForm();

    const callsBefore = mockListShots.mock.calls.length;
    fireEvent.click(screen.getByTestId('studio-regen-a-1'));

    await waitFor(() => {
      expect(mockRegenerate).toHaveBeenCalledWith({
        project_id: 'proj-1',
        asset_id: 'a-1',
        image_provider_id: 'img-prov',
        image_model: 'img-v1',
        llm_provider_id: undefined,
        llm_model_id: undefined,
      });
    });
    // 完成后刷新镜头列表
    await waitFor(() => {
      expect(mockListShots.mock.calls.length).toBeGreaterThan(callsBefore);
    });
  });

  it('审片台：未选图像供应商/模型时点"重新生成"报表单错误，不调 API', async () => {
    mockListShots.mockResolvedValue([
      {
        asset_id: 'a-1',
        brief: '雨夜街道',
        title: '镜头 1',
        url: '/files/s1.png',
        prompt: 'rainy street',
        critic_status: 'approved',
        review_status: 'pending_review',
        review_note: null,
        version: 1,
        versions: 1,
        created_at: '2026-07-19T10:00:00Z',
      },
    ]);

    render(<StudioPanel projectId="proj-1" onClose={() => {}} />);
    await waitFor(() => {
      expect(screen.getByTestId('studio-regen-a-1')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('studio-regen-a-1'));

    expect(mockRegenerate).not.toHaveBeenCalled();
    expect(screen.getByTestId('studio-form-error')).toBeInTheDocument();
  });
});
