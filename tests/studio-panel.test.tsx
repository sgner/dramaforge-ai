/**
 * StudioPanel 组件测试（三台：导演台 / 剪辑台 / 成片库）：
 *  1. 默认进入导演台阶段；无角色卡 / 镜头审片 / 故事阶段；生成设置行在导演台
 *  2. 导演台：加载流程（rebuild-from-nodes + getDramaTask + listAssets + listStudioShots）、
 *     剧本镜头结构（序号/场景/角色/故事板）、视频状态徽章（已有/生成中/缺失）、
 *     审片徽章与通过/退回（就地更新）、生成设置缺省时重生成禁用、重生成走生成设置并刷新、
 *     "送入剪辑台"（时间线预填 + 切阶段 + 缺失镜头 confirm）
 *  3. 剪辑台：补充素材 bin 默认折叠、展开后只显示未入轨资产；快捷键（Delete 移除选中 /
 *     Ctrl+E 导出 / ←→ seek）；原有编排 / 导出 / 播放 / 标尺 / 拖调时长等用例保留
 *  4. 成片库：列出项目视频类资产（kind==='video' 或 asset_kind==='sequence'），空态提示
 *
 * mock 方式：vi.mock('@/services/apiClient') 替换整个 api 对象。
 * i18n：不包 I18nProvider，useI18n 兜底返回 zh 文案。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, act, cleanup, within } from '@testing-library/react';
import { StudioPanel } from '@/components/StudioPanel';

const mockListProviders = vi.fn();
const mockRebuild = vi.fn();
const mockGetDramaTask = vi.fn();
const mockListShots = vi.fn();
const mockReview = vi.fn();
const mockRegenerate = vi.fn();
const mockExport = vi.fn();
const mockListAssets = vi.fn();
const mockArrange = vi.fn();
const mockUpdateAsset = vi.fn();

vi.mock('@/services/apiClient', () => ({
  api: {
    listProviders: (...args: any[]) => mockListProviders(...args),
    rebuildAssets: (...args: any[]) => mockRebuild(...args),
    getDramaTask: (...args: any[]) => mockGetDramaTask(...args),
    listStudioShots: (...args: any[]) => mockListShots(...args),
    reviewStudioShot: (...args: any[]) => mockReview(...args),
    regenerateStudioShot: (...args: any[]) => mockRegenerate(...args),
    createStudioExport: (...args: any[]) => mockExport(...args),
    listAssets: (...args: any[]) => mockListAssets(...args),
    arrangeStudioAssets: (...args: any[]) => mockArrange(...args),
    updateAsset: (...args: any[]) => mockUpdateAsset(...args),
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

/** 脚本 bigShots：bs-1 已有视频（匹配 asset-1 + 审片记录）、bs-2 生成中（只有故事板资产）、bs-3 素材缺失。 */
const BIG_SHOTS = [
  {
    id: 'bs-1',
    order: 1,
    sceneAsset: { location: '雨夜街道' },
    charactersInvolved: ['小雪', '阿明'],
    storyboardImageUrl: '/files/sb1.png',
    videoUrl: '/files/v1.mp4',
    generationStatus: 'completed',
    soraPrompt: '雨夜追车长镜头',
    includedDialogues: [],
  },
  {
    id: 'bs-2',
    order: 2,
    sceneAsset: { location: '室内咖啡馆' },
    charactersInvolved: ['小雪'],
    storyboardImageUrl: '/files/sb2.png',
    generationStatus: 'generating',
    soraPrompt: '室内特写',
    includedDialogues: [],
  },
  {
    id: 'bs-3',
    order: 3,
    sceneAsset: { location: '天台' },
    charactersInvolved: ['阿明'],
    storyboardImageUrl: '/files/sb3.png',
    soraPrompt: '天台对决',
    includedDialogues: [],
  },
];

/** 构造审片镜头（asset_kind=="shot"，按 url 与 bigShot 匹配）。 */
function makeShot(overrides: Record<string, any>) {
  return {
    asset_id: 'shot-a1',
    brief: '雨夜街道',
    title: '镜头 1',
    url: '/files/v1.mp4',
    prompt: 'rainy street',
    critic_status: 'approved',
    review_status: 'pending_review',
    review_note: null,
    version: 1,
    versions: 1,
    created_at: '2026-07-19T10:00:00Z',
    ...overrides,
  };
}

/** 构造项目资产。 */
function makeAsset(overrides: Record<string, any>) {
  return {
    id: 'asset-1',
    project_id: 'proj-1',
    kind: 'image',
    asset_kind: 'shot',
    title: '雨夜街道',
    name: '雨夜街道',
    url: '/files/a1.png',
    failed: false,
    generating: false,
    extra: {},
    created_at: '2026-07-19T10:00:00Z',
    ...overrides,
  };
}

/** 等待导演台加载完成（默认即导演台阶段）。 */
async function enterDirector() {
  await waitFor(() => {
    expect(screen.getByTestId('studio-dir-shot-bs-1')).toBeInTheDocument();
  });
}

/** 进入剪辑台阶段并展开补充素材 bin，等待资产加载完成。 */
async function enterTimeline() {
  fireEvent.click(screen.getByTestId('studio-stage-timeline'));
  fireEvent.click(screen.getByTestId('studio-bin-expand'));
  await waitFor(() => {
    expect(screen.getByTestId('studio-tl-asset-asset-1')).toBeInTheDocument();
  });
}

/** 在导演台"生成设置"行选好图像供应商/模型。 */
function fillGenSettings() {
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
    mockRebuild.mockResolvedValue({ ok: true, created: 0 });
    mockUpdateAsset.mockResolvedValue({ ok: true });
    mockGetDramaTask.mockResolvedValue({
      id: 'proj-1',
      name: '测试剧',
      deleted: false,
      data: { bigShots: BIG_SHOTS, characters: [] },
    });
    mockListShots.mockResolvedValue([makeShot({})]);
    // 项目资产：asset-1（bs-1 视频）/ asset-5（bs-2 故事板）/ asset-2 角色图 / asset-3 视频 /
    // asset-4（failed + 无 url）应被各处过滤
    mockListAssets.mockResolvedValue([
      makeAsset({ id: 'asset-1', kind: 'video', asset_kind: 'shot', title: '雨夜街道', url: '/files/v1.mp4' }),
      makeAsset({ id: 'asset-5', kind: 'image', asset_kind: 'shot', title: '镜头2故事板', url: '/files/sb2.png' }),
      makeAsset({ id: 'asset-2', asset_kind: 'character', title: '角色设定图', url: '/files/a2.png' }),
      makeAsset({ id: 'asset-3', kind: 'video', asset_kind: 'sequence', title: '片段', url: '/files/film1.mp4' }),
      makeAsset({ id: 'asset-4', title: '坏图', url: null, failed: true }),
    ]);
    // jsdom 无真实媒体播放：stub play/pause，避免 Not implemented 报错
    window.HTMLMediaElement.prototype.play = vi.fn().mockResolvedValue(undefined) as any;
    window.HTMLMediaElement.prototype.pause = vi.fn() as any;
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('默认进入导演台阶段，无角色卡/镜头审片/故事阶段，生成设置行在导演台', async () => {
    render(<StudioPanel projectId="proj-1" onClose={() => {}} />);

    // 阶段导航：导演台 / 剪辑台 / 成片库
    expect(screen.getByTestId('studio-stage-director')).toBeInTheDocument();
    expect(screen.getByTestId('studio-stage-timeline')).toBeInTheDocument();
    expect(screen.getByTestId('studio-stage-episode')).toBeInTheDocument();
    expect(screen.queryByTestId('studio-stage-cards')).toBeNull();
    expect(screen.queryByTestId('studio-stage-shots')).toBeNull();
    expect(screen.queryByTestId('studio-stage-story')).toBeNull();

    // 默认导演台：剧本结构 + 生成设置行 + 汇总条
    await enterDirector();
    expect(screen.getByTestId('studio-director-desk')).toBeInTheDocument();
    expect(screen.getByTestId('studio-gen-settings')).toBeInTheDocument();
    expect(screen.getByTestId('studio-dir-summary')).toBeInTheDocument();
    expect(screen.getByTestId('studio-send-timeline')).toBeInTheDocument();

    // 加载流程：同步画布产物 → 脚本 → 资产 → 审片记录
    expect(mockRebuild).toHaveBeenCalledWith('proj-1');
    expect(mockGetDramaTask).toHaveBeenCalledWith('proj-1');
    expect(mockListAssets).toHaveBeenCalledWith('proj-1');
    expect(mockListShots).toHaveBeenCalledWith('proj-1');
    expect(mockListProviders).toHaveBeenCalled();
  });

  it('导演台：展示脚本镜头结构（序号/场景/角色）与视频状态徽章（已有/生成中/缺失）', async () => {
    render(<StudioPanel projectId="proj-1" onClose={() => {}} />);
    await enterDirector();

    // 三个镜头按脚本序各一行
    const row1 = screen.getByTestId('studio-dir-shot-bs-1');
    const row2 = screen.getByTestId('studio-dir-shot-bs-2');
    const row3 = screen.getByTestId('studio-dir-shot-bs-3');
    expect(within(row1).getByText('#1')).toBeInTheDocument();
    expect(within(row2).getByText('#2')).toBeInTheDocument();
    expect(within(row3).getByText('#3')).toBeInTheDocument();

    // 场景与出场角色
    expect(row1.textContent).toContain('雨夜街道');
    expect(row1.textContent).toContain('小雪, 阿明');
    expect(row2.textContent).toContain('室内咖啡馆');

    // 视频状态徽章
    expect(screen.getByTestId('studio-dir-video-bs-1')).toHaveTextContent('已有视频');
    expect(screen.getByTestId('studio-dir-video-bs-2')).toHaveTextContent('生成中');
    expect(screen.getByTestId('studio-dir-video-bs-3')).toHaveTextContent('缺失');

    // 审片状态徽章（仅匹配到 shot 资产的镜头）
    expect(screen.getByTestId('studio-dir-review-bs-1')).toHaveTextContent('待审');
    expect(screen.queryByTestId('studio-dir-review-bs-2')).toBeNull();

    // bs-2 有资产但未进审片列表 → 素材车间产物；bs-3 缺失 → 去素材车间生成
    expect(screen.getByTestId('studio-dir-workshop-bs-2')).toHaveTextContent('素材车间产物');
    expect(screen.getByTestId('studio-dir-go-workshop-bs-3')).toHaveTextContent('去素材车间生成');

    // 汇总：3 个镜头 · 已有视频 1 · 缺失 1 · 待审 1
    expect(screen.getByTestId('studio-dir-summary-text')).toHaveTextContent(
      '共 3 个镜头 · 已有视频 1 · 缺失 1 · 待审 1'
    );
  });

  it('导演台：extra.bigshot_id 显式关联优先于 URL 匹配（重生成换 URL 不断链）', async () => {
    // asset-9 的 URL 与 bs-1 的 videoUrl 完全不同（重生成后的新 URL），
    // 但 extra.bigshot_id === 'bs-1'，必须仍被匹配到。
    mockListAssets.mockResolvedValue([
      makeAsset({
        id: 'asset-9', kind: 'video', asset_kind: 'shot',
        title: '雨夜街道 v2', url: '/files/v2-new.mp4',
        extra: { bigshot_id: 'bs-1' },
      }),
    ]);
    render(<StudioPanel projectId="proj-1" onClose={() => {}} />);
    await enterDirector();

    expect(screen.getByTestId('studio-dir-video-bs-1')).toHaveTextContent('已有视频');
    // 显式关联命中 → 不需要自愈回写
    expect(mockUpdateAsset).not.toHaveBeenCalled();
  });

  it('导演台：URL 匹配上的资产缺 bigshot_id 时自愈回写', async () => {
    render(<StudioPanel projectId="proj-1" onClose={() => {}} />);
    await enterDirector();

    // asset-1 仅靠 videoUrl 匹配 bs-1，extra 无 bigshot_id → 触发回写
    await waitFor(() => {
      expect(mockUpdateAsset).toHaveBeenCalledWith('asset-1', {
        extra: { bigshot_id: 'bs-1' },
      });
    });
  });

  it('导演台：重生成携带 bigshot_id，新版本继承显式关联', async () => {
    mockRegenerate.mockResolvedValue({ status: 'approved' });
    render(<StudioPanel projectId="proj-1" onClose={() => {}} />);
    await enterDirector();
    await fillGenSettings();

    fireEvent.click(screen.getByTestId('studio-dir-regen-bs-1'));

    await waitFor(() => {
      expect(mockRegenerate).toHaveBeenCalledWith(
        expect.objectContaining({ asset_id: 'shot-a1', bigshot_id: 'bs-1' }),
      );
    });
  });

  it('导演台：通过/退回调 review API 并就地把状态更新', async () => {
    mockReview.mockResolvedValue({
      asset_id: 'shot-a1',
      review_status: 'approved',
      review_note: null,
    });
    render(<StudioPanel projectId="proj-1" onClose={() => {}} />);
    await enterDirector();
    expect(screen.getByTestId('studio-dir-review-bs-1')).toHaveTextContent('待审');

    // 通过
    fireEvent.click(screen.getByTestId('studio-dir-approve-bs-1'));
    await waitFor(() => {
      expect(mockReview).toHaveBeenCalledWith('shot-a1', 'approve', undefined);
    });
    await waitFor(() => {
      expect(screen.getByTestId('studio-dir-review-bs-1')).toHaveTextContent('已通过');
    });

    // 退回（弹备注输入）
    vi.spyOn(window, 'prompt').mockReturnValue('光影不对');
    mockReview.mockResolvedValue({
      asset_id: 'shot-a1',
      review_status: 'rejected',
      review_note: '光影不对',
    });
    fireEvent.click(screen.getByTestId('studio-dir-reject-bs-1'));
    await waitFor(() => {
      expect(mockReview).toHaveBeenCalledWith('shot-a1', 'reject', '光影不对');
    });
    await waitFor(() => {
      expect(screen.getByTestId('studio-dir-review-bs-1')).toHaveTextContent('已退回');
    });
  });

  it('导演台：缺生成设置时重生成禁用并提示；选好后调 regenerate API 并刷新', async () => {
    mockRegenerate.mockResolvedValue({
      status: 'approved',
      asset_id: 'shot-a2',
      url: '/files/v1v2.mp4',
      prompt: 'rainy street v2',
      rounds: 2,
    });
    render(<StudioPanel projectId="proj-1" onClose={() => {}} />);
    await enterDirector();
    await waitFor(() => {
      expect(
        (screen.getByTestId('studio-image-provider') as HTMLSelectElement).querySelector(
          'option[value="img-prov"]'
        )
      ).not.toBeNull();
    });

    // 图像供应商下拉只含 enabled 且有 image_models 的 provider
    const select = screen.getByTestId('studio-image-provider') as HTMLSelectElement;
    expect(select.querySelector('option[value="disabled-prov"]')).toBeNull();
    expect(select.querySelector('option[value="llm-prov"]')).toBeNull();

    // 未选供应商/模型：提示可见 + 重生成禁用
    expect(screen.getByTestId('studio-gen-settings-hint')).toHaveTextContent(
      '选择图像供应商和模型后才能重新生成镜头'
    );
    expect(screen.getByTestId('studio-dir-regen-bs-1')).toBeDisabled();
    fireEvent.click(screen.getByTestId('studio-dir-regen-bs-1'));
    expect(mockRegenerate).not.toHaveBeenCalled();

    // 选好后：提示消失、按钮可用，点击调 API 并整体刷新
    fillGenSettings();
    expect(screen.queryByTestId('studio-gen-settings-hint')).toBeNull();
    expect(screen.getByTestId('studio-dir-regen-bs-1')).not.toBeDisabled();

    const callsBefore = mockListShots.mock.calls.length;
    fireEvent.click(screen.getByTestId('studio-dir-regen-bs-1'));
    await waitFor(() => {
      expect(mockRegenerate).toHaveBeenCalledWith({
        project_id: 'proj-1',
        asset_id: 'shot-a1',
        image_provider_id: 'img-prov',
        image_model: 'img-v1',
        bigshot_id: 'bs-1',
      });
    });
    await waitFor(() => {
      expect(mockListShots.mock.calls.length).toBeGreaterThan(callsBefore);
    });
  });

  it('导演台：送入剪辑台——时间线按脚本序预填并切到剪辑台阶段（缺失镜头先 confirm）', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<StudioPanel projectId="proj-1" onClose={() => {}} />);
    await enterDirector();

    fireEvent.click(screen.getByTestId('studio-send-timeline'));

    // 缺失 1 个镜头（bs-3）→ confirm 提示
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(confirmSpy.mock.calls[0][0]).toContain('1');

    // 切到剪辑台，时间线预填 2 个可送镜头（bs-1 / bs-2），默认各 3 秒
    await waitFor(() => {
      expect(screen.getByTestId('studio-timeline')).toBeInTheDocument();
    });
    expect(within(screen.getByTestId('studio-tl-clip-0')).getByText('雨夜街道')).toBeInTheDocument();
    expect(within(screen.getByTestId('studio-tl-clip-1')).getByText('镜头2故事板')).toBeInTheDocument();
    // caption 取 soraPrompt
    expect(within(screen.getByTestId('studio-tl-clip-0')).getByText('雨夜追车长镜头')).toBeInTheDocument();
    expect(screen.getByTestId('studio-tl-stats')).toHaveTextContent('2 个镜头 · 总时长 00:06');
  });

  it('剪辑台：补充素材 bin 默认折叠，展开后只显示未入轨资产（入轨即消失，移除后回归）', async () => {
    render(<StudioPanel projectId="proj-1" onClose={() => {}} />);
    await enterDirector();
    fireEvent.click(screen.getByTestId('studio-stage-timeline'));

    // 默认折叠：只有展开条，没有完整 bin
    expect(screen.getByTestId('studio-bin-expand')).toBeInTheDocument();
    expect(screen.queryByTestId('studio-asset-bin')).toBeNull();

    // 展开：可用资产都在（failed + 无 url 的被过滤）
    fireEvent.click(screen.getByTestId('studio-bin-expand'));
    await waitFor(() => {
      expect(screen.getByTestId('studio-tl-asset-asset-1')).toBeInTheDocument();
    });
    expect(screen.getByTestId('studio-tl-asset-asset-2')).toBeInTheDocument();
    expect(screen.getByTestId('studio-tl-asset-asset-3')).toBeInTheDocument();
    expect(screen.queryByTestId('studio-tl-asset-asset-4')).toBeNull();

    // 入轨后从 bin 消失（不可重复添加）
    fireEvent.click(screen.getByTestId('studio-tl-asset-asset-1'));
    expect(screen.getByTestId('studio-tl-clip-0')).toBeInTheDocument();
    expect(screen.queryByTestId('studio-tl-asset-asset-1')).toBeNull();

    // 从时间线移除后回归 bin
    fireEvent.click(screen.getByTestId('studio-tl-clip-0'));
    fireEvent.click(screen.getByTestId('studio-tl-remove-0'));
    expect(screen.queryByTestId('studio-tl-clip-0')).toBeNull();
    expect(screen.getByTestId('studio-tl-asset-asset-1')).toBeInTheDocument();
  });

  it('剪辑台：快捷键——←→ seek、Delete 移除选中、Ctrl+E 导出', async () => {
    mockExport.mockResolvedValue({ asset_id: 'e-1', url: '/files/tl-export.mp4' });
    render(<StudioPanel projectId="proj-1" onClose={() => {}} />);
    await enterTimeline();
    fireEvent.click(screen.getByTestId('studio-tl-asset-asset-1'));
    fireEvent.click(screen.getByTestId('studio-tl-asset-asset-2'));

    // ←/→ seek ±1s（初始 00:00 / 00:04）
    expect(screen.getByTestId('studio-timecode')).toHaveTextContent('00:00 / 00:04');
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    expect(screen.getByTestId('studio-timecode')).toHaveTextContent('00:01');
    fireEvent.keyDown(window, { key: 'ArrowLeft' });
    expect(screen.getByTestId('studio-timecode')).toHaveTextContent('00:00');

    // 选中 clip 0 后 Delete 移除
    fireEvent.click(screen.getByTestId('studio-tl-clip-0'));
    fireEvent.keyDown(window, { key: 'Delete' });
    expect(screen.queryByTestId('studio-tl-clip-1')).toBeNull();
    expect(within(screen.getByTestId('studio-tl-clip-0')).getByText('角色设定图')).toBeInTheDocument();

    // Ctrl+E 导出（时间线非空）
    fireEvent.keyDown(window, { key: 'e', ctrlKey: true });
    await waitFor(() => {
      expect(mockExport).toHaveBeenCalledWith({
        project_id: 'proj-1',
        asset_ids: ['asset-2'],
        durations: [2],
        title: undefined,
      });
    });
  });

  it('剪辑台：空时间线引导文案指向导演台；快捷键提示条可见', async () => {
    render(<StudioPanel projectId="proj-1" onClose={() => {}} />);
    await enterTimeline();

    expect(screen.getByTestId('studio-tl-empty')).toHaveTextContent(
      '去导演台整理剧集，或从补充素材手动添加'
    );
    expect(screen.getByTestId('studio-arrange-btn')).toBeDisabled();
    expect(screen.getByTestId('studio-tl-export-btn')).toBeDisabled();
    expect(screen.getByTestId('studio-tl-shortcut-hint')).toHaveTextContent(
      '空格 播放 · ←→ 快退/快进 · Del 删除镜头 · ⌘/Ctrl+E 导出'
    );
  });

  it('剪辑台：bin tab 筛选（图片/视频）', async () => {
    render(<StudioPanel projectId="proj-1" onClose={() => {}} />);
    await enterTimeline();

    // 视频 tab 只剩视频资产
    fireEvent.click(screen.getByTestId('studio-bin-tab-video'));
    expect(screen.getByTestId('studio-tl-asset-asset-1')).toBeInTheDocument();
    expect(screen.getByTestId('studio-tl-asset-asset-3')).toBeInTheDocument();
    expect(screen.queryByTestId('studio-tl-asset-asset-2')).toBeNull();
    fireEvent.click(screen.getByTestId('studio-bin-tab-all'));
    expect(screen.getByTestId('studio-tl-asset-asset-2')).toBeInTheDocument();
  });

  it('剪辑台：点击资产加入时间线末尾（默认 2 秒/镜头）', async () => {
    render(<StudioPanel projectId="proj-1" onClose={() => {}} />);
    await enterTimeline();

    fireEvent.click(screen.getByTestId('studio-tl-asset-asset-1'));
    expect(screen.getByTestId('studio-tl-clip-0')).toBeInTheDocument();
    expect(screen.queryByTestId('studio-tl-empty')).toBeNull();

    // 追加第二个资产到末尾
    fireEvent.click(screen.getByTestId('studio-tl-asset-asset-2'));
    expect(screen.getByTestId('studio-tl-clip-1')).toBeInTheDocument();
    expect(within(screen.getByTestId('studio-tl-clip-1')).getByText('角色设定图')).toBeInTheDocument();

    // 检查器统计：2 个镜头，默认各 2 秒 → 00:04
    expect(screen.getByTestId('studio-tl-stats')).toHaveTextContent('2 个镜头 · 总时长 00:04');
    expect(screen.getByTestId('studio-arrange-btn')).not.toBeDisabled();
    expect(screen.getByTestId('studio-tl-export-btn')).not.toBeDisabled();
  });

  it('剪辑台：选中 clip 后支持上移/下移/移除与秒数编辑', async () => {
    render(<StudioPanel projectId="proj-1" onClose={() => {}} />);
    await enterTimeline();
    fireEvent.click(screen.getByTestId('studio-tl-asset-asset-1'));
    fireEvent.click(screen.getByTestId('studio-tl-asset-asset-2'));
    fireEvent.click(screen.getByTestId('studio-tl-asset-asset-3'));

    // 初始顺序（V1 轨 clip 块）
    expect(within(screen.getByTestId('studio-tl-clip-0')).getByText('雨夜街道')).toBeInTheDocument();
    expect(within(screen.getByTestId('studio-tl-clip-2')).getByText('片段')).toBeInTheDocument();

    // 首项上移禁用、末项下移禁用（选中后在 clip 检查器操作）
    fireEvent.click(screen.getByTestId('studio-tl-clip-0'));
    expect(screen.getByTestId('studio-tl-up-0')).toBeDisabled();
    fireEvent.click(screen.getByTestId('studio-tl-clip-2'));
    expect(screen.getByTestId('studio-tl-down-2')).toBeDisabled();

    // 下移第一项（选中态跟随 clip 移动）
    fireEvent.click(screen.getByTestId('studio-tl-clip-0'));
    fireEvent.click(screen.getByTestId('studio-tl-down-0'));
    expect(within(screen.getByTestId('studio-tl-clip-0')).getByText('角色设定图')).toBeInTheDocument();
    expect(within(screen.getByTestId('studio-tl-clip-1')).getByText('雨夜街道')).toBeInTheDocument();

    // 再上移回去
    fireEvent.click(screen.getByTestId('studio-tl-up-1'));
    expect(within(screen.getByTestId('studio-tl-clip-0')).getByText('雨夜街道')).toBeInTheDocument();

    // 秒数编辑（选中态跟随回到 clip 0）
    fireEvent.change(screen.getByTestId('studio-tl-sec-0'), { target: { value: '5' } });
    expect((screen.getByTestId('studio-tl-sec-0') as HTMLInputElement).value).toBe('5');
    expect(screen.getByTestId('studio-tl-stats')).toHaveTextContent('00:09');

    // 移除中间项
    fireEvent.click(screen.getByTestId('studio-tl-clip-1'));
    fireEvent.click(screen.getByTestId('studio-tl-remove-1'));
    expect(within(screen.getByTestId('studio-tl-clip-0')).getByText('雨夜街道')).toBeInTheDocument();
    expect(within(screen.getByTestId('studio-tl-clip-1')).getByText('片段')).toBeInTheDocument();
    expect(screen.queryByTestId('studio-tl-clip-2')).toBeNull();
    // 移除后资产回归 bin，可重新添加
    expect(screen.getByTestId('studio-tl-asset-asset-2')).toBeInTheDocument();
  });

  it('剪辑台：智能编排按返回 items 重排时间线并回填 sec/caption（故事线索随请求提交）', async () => {
    mockArrange.mockResolvedValue({
      items: [
        { asset_id: 'asset-2', sec: 5, caption: '开场：角色亮相' },
        { asset_id: 'asset-1', sec: 3, caption: '收尾：雨夜背影' },
      ],
    });

    render(<StudioPanel projectId="proj-1" onClose={() => {}} />);
    await enterTimeline();
    fireEvent.click(screen.getByTestId('studio-tl-asset-asset-1'));
    fireEvent.click(screen.getByTestId('studio-tl-asset-asset-2'));

    // 填写可选故事线索（story_hint）
    fireEvent.change(screen.getByTestId('studio-story-hint-input'), {
      target: { value: '雨夜寻猫' },
    });

    fireEvent.click(screen.getByTestId('studio-arrange-btn'));

    await waitFor(() => {
      expect(mockArrange).toHaveBeenCalledWith({
        project_id: 'proj-1',
        asset_ids: ['asset-1', 'asset-2'],
        story_hint: '雨夜寻猫',
        llm_provider_id: undefined,
        llm_model_id: undefined,
      });
    });

    // 按返回顺序重排：asset-2 在前；caption 回填到 clip 块
    await waitFor(() => {
      expect(within(screen.getByTestId('studio-tl-clip-0')).getByText('角色设定图')).toBeInTheDocument();
    });
    expect(within(screen.getByTestId('studio-tl-clip-1')).getByText('雨夜街道')).toBeInTheDocument();
    expect(within(screen.getByTestId('studio-tl-clip-0')).getByText('开场：角色亮相')).toBeInTheDocument();
    // 回填 sec（选中 clip 后在检查器可见）
    fireEvent.click(screen.getByTestId('studio-tl-clip-0'));
    expect((screen.getByTestId('studio-tl-sec-0') as HTMLInputElement).value).toBe('5');
    fireEvent.click(screen.getByTestId('studio-tl-clip-1'));
    expect((screen.getByTestId('studio-tl-sec-1') as HTMLInputElement).value).toBe('3');
    expect(screen.getByTestId('studio-tl-stats')).toHaveTextContent('00:08');
  });

  it('剪辑台：智能编排失败时显示错误横幅且时间线不变', async () => {
    mockArrange.mockRejectedValue(new Error('API 400 Bad Request: 未配置 LLM'));

    render(<StudioPanel projectId="proj-1" onClose={() => {}} />);
    await enterTimeline();
    fireEvent.click(screen.getByTestId('studio-tl-asset-asset-1'));
    fireEvent.click(screen.getByTestId('studio-tl-asset-asset-2'));

    fireEvent.click(screen.getByTestId('studio-arrange-btn'));

    await waitFor(() => {
      expect(screen.getByTestId('studio-form-error')).toBeInTheDocument();
    });
    expect(screen.getByTestId('studio-form-error').textContent).toContain('未配置 LLM');
    // 时间线顺序未变
    expect(within(screen.getByTestId('studio-tl-clip-0')).getByText('雨夜街道')).toBeInTheDocument();
  });

  it('剪辑台：导出带逐镜头 durations 与成片标题，成功后展示结果、下载链接与"已存入成片库"提示', async () => {
    mockExport.mockResolvedValue({ asset_id: 'e-2', url: '/files/tl-export.mp4' });

    render(<StudioPanel projectId="proj-1" onClose={() => {}} />);
    await enterTimeline();
    fireEvent.click(screen.getByTestId('studio-tl-asset-asset-1'));
    fireEvent.click(screen.getByTestId('studio-tl-asset-asset-2'));
    // 选中 clip 1 改秒数，再取消选中回到序列汇总（导出按钮所在）
    fireEvent.click(screen.getByTestId('studio-tl-clip-1'));
    fireEvent.change(screen.getByTestId('studio-tl-sec-1'), { target: { value: '4' } });
    fireEvent.click(screen.getByTestId('studio-tl-clip-1'));

    // 填写可选成片标题
    fireEvent.change(screen.getByTestId('studio-film-title-input'), {
      target: { value: '雨夜寻猫 第一集' },
    });

    fireEvent.click(screen.getByTestId('studio-tl-export-btn'));

    await waitFor(() => {
      expect(mockExport).toHaveBeenCalledWith({
        project_id: 'proj-1',
        asset_ids: ['asset-1', 'asset-2'],
        durations: [2, 4],
        title: '雨夜寻猫 第一集',
      });
    });

    await waitFor(() => {
      expect(screen.getByTestId('studio-tl-video')).toBeInTheDocument();
    });
    expect(screen.getByTestId('studio-tl-video')).toHaveAttribute('src', '/files/tl-export.mp4');
    expect(screen.getByTestId('studio-tl-download')).toHaveAttribute('href', '/files/tl-export.mp4');
    // 导出成片由后端登记为项目资产：提示已存入成片库
    expect(screen.getByTestId('studio-tl-export-saved')).toHaveTextContent('已存入成片库');
  });

  it('剪辑台：播放推进时间码与 playhead，播到末尾自动停止', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    render(<StudioPanel projectId="proj-1" onClose={() => {}} />);
    await enterTimeline();
    fireEvent.click(screen.getByTestId('studio-tl-asset-asset-1'));
    fireEvent.click(screen.getByTestId('studio-tl-asset-asset-2'));

    // 初始时间码：0 / 4s（mm:ss 显示）
    expect(screen.getByTestId('studio-timecode')).toHaveTextContent('00:00 / 00:04');

    fireEvent.click(screen.getByTestId('studio-play-btn'));
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });

    // 播放 1s：时间码 00:01，playhead 偏移 1s × 24px
    expect(screen.getByTestId('studio-timecode')).toHaveTextContent('00:01');
    expect((screen.getByTestId('studio-playhead') as HTMLElement).style.left).toBe('24px');

    // 播到末尾：停在 00:04 并自动暂停
    await act(async () => {
      vi.advanceTimersByTime(5000);
    });
    expect(screen.getByTestId('studio-timecode')).toHaveTextContent('00:04');
    expect(screen.getByTestId('studio-play-btn')).toHaveAttribute('title', '播放');
  });

  it('剪辑台：点击标尺 seek 播放头', async () => {
    render(<StudioPanel projectId="proj-1" onClose={() => {}} />);
    await enterTimeline();
    fireEvent.click(screen.getByTestId('studio-tl-asset-asset-1'));
    fireEvent.click(screen.getByTestId('studio-tl-asset-asset-2'));

    // jsdom 中 getBoundingClientRect 全 0：clientX=48 → 48/24 = 2s
    fireEvent.pointerDown(screen.getByTestId('studio-tl-ruler'), { clientX: 48 });
    expect(screen.getByTestId('studio-timecode')).toHaveTextContent('00:02');
  });

  it('剪辑台：点击 clip 选中后检查器可编辑，再点取消选中', async () => {
    render(<StudioPanel projectId="proj-1" onClose={() => {}} />);
    await enterTimeline();
    fireEvent.click(screen.getByTestId('studio-tl-asset-asset-1'));

    // 未选中：显示提示，无秒数输入
    expect(screen.getByText('点击时间线上的镜头进行编辑')).toBeInTheDocument();
    expect(screen.queryByTestId('studio-tl-sec-0')).toBeNull();

    // 选中 clip 0：检查器显示该 clip 且可改秒数
    fireEvent.click(screen.getByTestId('studio-tl-clip-0'));
    const inspector = screen.getByTestId('studio-clip-inspector');
    expect(within(inspector).getByText('雨夜街道')).toBeInTheDocument();
    fireEvent.change(screen.getByTestId('studio-tl-sec-0'), { target: { value: '6' } });
    expect(screen.getByTestId('studio-tl-stats')).toHaveTextContent('00:06');

    // 再次点击取消选中，回到序列汇总
    fireEvent.click(screen.getByTestId('studio-tl-clip-0'));
    expect(screen.queryByTestId('studio-tl-sec-0')).toBeNull();
    expect(screen.getByTestId('studio-arrange-btn')).toBeInTheDocument();
  });

  it('剪辑台：A1 音轨与字幕轨为灰显占位轨（即将支持）', async () => {
    render(<StudioPanel projectId="proj-1" onClose={() => {}} />);
    await enterTimeline();

    expect(screen.getByTestId('studio-track-audio')).toHaveTextContent('即将支持');
    expect(screen.getByTestId('studio-track-subtitle')).toHaveTextContent('即将支持');
  });

  it('剪辑台：clip 右缘拖动调时长（步进 0.5s，clamp 1~15s）', async () => {
    render(<StudioPanel projectId="proj-1" onClose={() => {}} />);
    await enterTimeline();
    fireEvent.click(screen.getByTestId('studio-tl-asset-asset-1'));
    fireEvent.click(screen.getByTestId('studio-tl-clip-0'));

    const handle = screen.getByTestId('studio-tl-resize-0');
    // 2s × 24px = 48px；向右拖 36px = +1.5s → 3.5s
    fireEvent.pointerDown(handle, { clientX: 48 });
    fireEvent.pointerMove(window, { clientX: 48 + 36 });
    fireEvent.pointerUp(window);
    expect((screen.getByTestId('studio-tl-sec-0') as HTMLInputElement).value).toBe('3.5');

    // 向左拖过界 → clamp 到 1s
    fireEvent.pointerDown(handle, { clientX: 84 });
    fireEvent.pointerMove(window, { clientX: -500 });
    fireEvent.pointerUp(window);
    expect((screen.getByTestId('studio-tl-sec-0') as HTMLInputElement).value).toBe('1');

    // 向右拖过界 → clamp 到 15s
    fireEvent.pointerDown(handle, { clientX: 24 });
    fireEvent.pointerMove(window, { clientX: 24 + 24 * 30 });
    fireEvent.pointerUp(window);
    expect((screen.getByTestId('studio-tl-sec-0') as HTMLInputElement).value).toBe('15');
  });

  it('剪辑台：类型 chips 与图片/视频 tab 取交集（图片 tab + 镜头类型 → 只显示图片类 shot）', async () => {
    render(<StudioPanel projectId="proj-1" onClose={() => {}} />);
    await enterTimeline();

    // 默认全部 tab：类型 chips 带数量角标
    expect(screen.getByTestId('studio-bin-type-all')).toBeInTheDocument();
    expect(screen.getByTestId('studio-bin-type-character').textContent).toContain('1');
    expect(screen.getByTestId('studio-bin-type-shot').textContent).toContain('2');
    expect(screen.getByTestId('studio-bin-type-sequence').textContent).toContain('1');

    // 图片 tab + 镜头类型：只剩图片类 shot（asset-5）
    fireEvent.click(screen.getByTestId('studio-bin-tab-image'));
    fireEvent.click(screen.getByTestId('studio-bin-type-shot'));
    expect(screen.getByTestId('studio-tl-asset-asset-5')).toBeInTheDocument();
    expect(screen.queryByTestId('studio-tl-asset-asset-2')).toBeNull();
    expect(screen.queryByTestId('studio-tl-asset-asset-1')).toBeNull();

    // 切到角色类型：只剩 asset-2
    fireEvent.click(screen.getByTestId('studio-bin-type-character'));
    expect(screen.queryByTestId('studio-tl-asset-asset-5')).toBeNull();
    expect(screen.getByTestId('studio-tl-asset-asset-2')).toBeInTheDocument();

    // 回全部类型：图片 tab 下两个图片资产都在
    fireEvent.click(screen.getByTestId('studio-bin-type-all'));
    expect(screen.getByTestId('studio-tl-asset-asset-5')).toBeInTheDocument();
    expect(screen.getByTestId('studio-tl-asset-asset-2')).toBeInTheDocument();
  });

  it('剪辑台：数量为 0 的类型 chip 不显示（全部类型始终显示），资产卡片带类型角标', async () => {
    render(<StudioPanel projectId="proj-1" onClose={() => {}} />);
    await enterTimeline();

    // 默认资产无 场景/道具/其他 → chips 不渲染
    expect(screen.queryByTestId('studio-bin-type-scene')).toBeNull();
    expect(screen.queryByTestId('studio-bin-type-prop')).toBeNull();
    expect(screen.queryByTestId('studio-bin-type-other')).toBeNull();
    expect(screen.getByTestId('studio-bin-type-all')).toBeInTheDocument();

    // 资产卡片左上角类型角标
    expect(screen.getByTestId('studio-tl-asset-kind-asset-1')).toHaveTextContent('镜头');
    expect(screen.getByTestId('studio-tl-asset-kind-asset-2')).toHaveTextContent('角色');
    expect(screen.getByTestId('studio-tl-asset-kind-asset-3')).toHaveTextContent('成片');
  });

  it('剪辑台：切换 tab 后选中类型无结果自动回落全部类型', async () => {
    render(<StudioPanel projectId="proj-1" onClose={() => {}} />);
    await enterTimeline();

    // 图片 tab 下选中"角色"（1 个结果）
    fireEvent.click(screen.getByTestId('studio-bin-tab-image'));
    fireEvent.click(screen.getByTestId('studio-bin-type-character'));
    expect(screen.getByTestId('studio-tl-asset-asset-2')).toBeInTheDocument();
    expect(screen.queryByTestId('studio-tl-asset-asset-5')).toBeNull();

    // 切到视频 tab：角色类型在视频 tab 下为 0 → chip 隐藏且自动回落全部类型
    fireEvent.click(screen.getByTestId('studio-bin-tab-video'));
    await waitFor(() => {
      expect(screen.getByTestId('studio-tl-asset-asset-3')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('studio-bin-type-character')).toBeNull();
    // 回落后视频 tab 的全部资产可见（若仍停留在角色类型则列表为空）
    expect(screen.queryByTestId('studio-tl-no-assets')).toBeNull();
  });

  it('成片库：列出项目视频类资产（video / sequence），排除图片与失败资产', async () => {
    render(<StudioPanel projectId="proj-1" onClose={() => {}} />);
    // 进入阶段前换成含两个成片（一个 kind=video、一个 asset_kind=sequence）的资产列表
    mockListAssets.mockResolvedValue([
      makeAsset({ id: 'asset-1', title: '雨夜街道' }),
      makeAsset({
        id: 'asset-3',
        kind: 'video',
        asset_kind: 'sequence',
        title: '片段',
        url: '/files/film1.mp4',
      }),
      makeAsset({
        id: 'asset-6',
        kind: 'image',
        asset_kind: 'sequence',
        title: '第一集成片',
        url: '/files/film2.mp4',
      }),
      makeAsset({ id: 'asset-4', kind: 'video', title: '坏片', url: null, failed: true }),
    ]);
    fireEvent.click(screen.getByTestId('studio-stage-episode'));

    await waitFor(() => {
      expect(screen.getByTestId('studio-film-grid')).toBeInTheDocument();
    });
    expect(mockListAssets).toHaveBeenCalledWith('proj-1');

    // 视频类资产入库展示，图片/失败资产不展示
    expect(screen.getByTestId('studio-film-asset-3')).toBeInTheDocument();
    expect(screen.getByTestId('studio-film-asset-6')).toBeInTheDocument();
    expect(screen.queryByTestId('studio-film-asset-1')).toBeNull();
    expect(screen.queryByTestId('studio-film-asset-4')).toBeNull();

    // 视频卡片：<video controls> + 标题 + 下载链接
    const film3 = screen.getByTestId('studio-film-asset-3');
    const video = film3.querySelector('video');
    expect(video).toHaveAttribute('src', '/files/film1.mp4');
    expect(video).toHaveAttribute('controls');
    expect(within(film3).getByText('片段')).toBeInTheDocument();
    const link = film3.querySelector('a[download]');
    expect(link).toHaveAttribute('href', '/files/film1.mp4');
  });

  it('成片库：项目无视频资产时显示空态', async () => {
    mockListAssets.mockResolvedValue([makeAsset({ id: 'asset-1' })]);
    render(<StudioPanel projectId="proj-1" onClose={() => {}} />);
    fireEvent.click(screen.getByTestId('studio-stage-episode'));

    await waitFor(() => {
      expect(screen.getByTestId('studio-film-empty')).toBeInTheDocument();
    });
    expect(screen.getByTestId('studio-film-empty')).toHaveTextContent(
      '还没有成片，去剪辑台导出第一个'
    );
    expect(screen.queryByTestId('studio-film-grid')).toBeNull();
  });
});
