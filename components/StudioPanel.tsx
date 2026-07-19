/**
 * StudioPanel — 专业工作室布局：左侧阶段导航 + 中央工作区 + 右侧检查器（可折叠）。
 *
 * 阶段：故事（story）/ 角色卡（cards）/ 镜头审片（shots）/ 成片（episode）。
 * 后端契约见 services/apiClient.ts 的 Studio 类型：
 *   POST /api/studio/episodes          → 202 { task_id }（轮询 GET 直到 status !== 'running'）
 *   GET  /api/studio/shots             → 镜头列表（同 brief 多资产 = 同镜头多版本）
 *   POST /api/studio/shots/{id}/review → 人工审核（approve/reject/lock/unlock）
 *   POST /api/studio/shots/regenerate  → 单镜头重生成（同步，1~2 分钟）
 *   POST /api/studio/export            → 选中镜头合成 mp4（同步）
 * 轮询间隔 3s，status !== 'running' 或组件卸载/重新生成时停止；done/partial 后自动切到成片阶段。
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  ArrowLeft,
  CheckCheck,
  CheckCircle,
  Clapperboard,
  Clock,
  Download,
  FileText,
  Film,
  Loader2,
  Lock,
  LockOpen,
  MonitorPlay,
  PanelRightClose,
  PanelRightOpen,
  RefreshCw,
  Users,
  X,
  XCircle,
} from 'lucide-react';
import {
  api,
  ProviderOut,
  StudioCharacterCardOut,
  StudioEpisodeTaskOut,
  StudioExportOut,
  StudioReviewAction,
  StudioReviewStatus,
  StudioShotOut,
  StudioShotProgress,
  StudioShotReviewOut,
} from '../services/apiClient';
import { useI18n } from '../i18n';

const POLL_INTERVAL_MS = 3000;

type StudioStage = 'story' | 'cards' | 'shots' | 'episode';
type ShotFilter = 'all' | StudioReviewStatus;

interface StudioPanelProps {
  /** 当前项目 id（有画布上下文时传入）。 */
  projectId?: string | null;
  /** 可选项目列表（项目选择下拉）；为空时退化为手输 project id。 */
  projects?: { id: string; name: string }[];
  onClose: () => void;
}

// 深色专业工作台配色
const inputCls =
  'w-full bg-[#0d1117] border border-[#2a3342] rounded-xl px-4 py-2.5 text-sm text-[#e6eaf2] ' +
  'focus:outline-none focus:border-brand-600/60 focus:ring-1 focus:ring-brand-600/30 transition-all placeholder:text-[#5b6474]';
const labelCls = 'block text-xs font-bold text-[#8b94a7] mb-1.5 uppercase tracking-wider';
const panelCls = 'bg-[#151a23] border border-[#232b38] rounded-2xl';
const actionBtnCls =
  'px-3 py-1.5 rounded-lg text-xs font-bold transition-all disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1';

export const StudioPanel: React.FC<StudioPanelProps> = ({ projectId, projects = [], onClose }) => {
  const { t } = useI18n();

  const [selectedProjectId, setSelectedProjectId] = useState(
    projectId || projects[0]?.id || 'studio-demo'
  );
  const [storyText, setStoryText] = useState('');
  const [title, setTitle] = useState('');
  const [maxShots, setMaxShots] = useState(5);

  const [providers, setProviders] = useState<ProviderOut[]>([]);
  const [imageProviderId, setImageProviderId] = useState('');
  const [imageModel, setImageModel] = useState('');
  const [llmProviderId, setLlmProviderId] = useState('');
  const [llmModelId, setLlmModelId] = useState('');

  const [cards, setCards] = useState<StudioCharacterCardOut[]>([]);
  const [selectedCardIds, setSelectedCardIds] = useState<Set<string>>(new Set());

  const [task, setTask] = useState<StudioEpisodeTaskOut | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // 审片台：项目全部镜头（按 brief 分组的版本列表）
  const [shots, setShots] = useState<StudioShotOut[]>([]);
  const [shotsLoading, setShotsLoading] = useState(false);
  const [reviewingId, setReviewingId] = useState<string | null>(null);
  const [regeneratingId, setRegeneratingId] = useState<string | null>(null);
  const [approvingAll, setApprovingAll] = useState(false);

  // 工作台布局状态
  const [stage, setStage] = useState<StudioStage>('story');
  const [inspectorOpen, setInspectorOpen] = useState(true);
  const [selectedShotId, setSelectedShotId] = useState<string | null>(null);
  const [shotFilter, setShotFilter] = useState<ShotFilter>('all');

  // 成片导出
  const [exportSelIds, setExportSelIds] = useState<Set<string>>(new Set());
  const [exportSecPerImage, setExportSecPerImage] = useState(2);
  const [exporting, setExporting] = useState(false);
  const [exportResult, setExportResult] = useState<StudioExportOut | null>(null);

  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPolling = useCallback(() => {
    if (pollTimerRef.current) {
      clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  }, []);

  // 卸载时停止轮询
  useEffect(() => stopPolling, [stopPolling]);

  // 加载供应商（只保留 enabled）
  useEffect(() => {
    let cancelled = false;
    api
      .listProviders()
      .then((rows) => {
        if (!cancelled) setProviders((rows || []).filter((p) => p.enabled));
      })
      .catch((e) => console.warn('[Studio] listProviders failed', e));
    return () => {
      cancelled = true;
    };
  }, []);

  // 项目切换时重新拉角色卡，并清空已选/选中镜头/导出状态
  useEffect(() => {
    setSelectedCardIds(new Set());
    setSelectedShotId(null);
    setExportSelIds(new Set());
    setExportResult(null);
    setShotFilter('all');
    if (!selectedProjectId.trim()) {
      setCards([]);
      return;
    }
    let cancelled = false;
    api
      .listStudioCharacterCards(selectedProjectId.trim())
      .then((rows) => {
        if (!cancelled) setCards(rows || []);
      })
      .catch((e) => {
        console.warn('[Studio] listStudioCharacterCards failed', e);
        if (!cancelled) setCards([]);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedProjectId]);

  // 审片台：拉取项目全部镜头
  const refreshShots = useCallback(async () => {
    const pid = selectedProjectId.trim();
    if (!pid) {
      setShots([]);
      return;
    }
    setShotsLoading(true);
    try {
      const rows = await api.listStudioShots(pid);
      setShots(rows || []);
    } catch (e) {
      console.warn('[Studio] listStudioShots failed', e);
    } finally {
      setShotsLoading(false);
    }
  }, [selectedProjectId]);

  // 面板加载 / 项目切换时拉镜头列表
  useEffect(() => {
    void refreshShots();
  }, [refreshShots]);

  const imageProviders = providers.filter((p) => (p.image_models || []).length > 0);
  const llmProviders = providers.filter((p) => (p.chat_models || []).length > 0);
  const selectedImageProvider = imageProviders.find((p) => p.provider_id === imageProviderId);
  const selectedLlmProvider = llmProviders.find((p) => p.provider_id === llmProviderId);

  const startPolling = useCallback(
    (taskId: string) => {
      stopPolling();
      const tick = async () => {
        try {
          const data = await api.getStudioEpisode(taskId);
          setTask(data);
          if (data.status !== 'running') {
            stopPolling();
            // 整集生成结束后刷新审片台镜头列表；有结果时自动切到成片阶段
            void refreshShots();
            if ((data.status === 'done' || data.status === 'partial') && data.result) {
              setStage('episode');
            }
          }
        } catch (e: any) {
          stopPolling();
          setTask((prev) => ({
            task_id: taskId,
            status: 'error',
            progress: prev?.progress ?? {
              phase: 'finished',
              current_shot: 0,
              total_shots: 0,
              shots: [],
            },
            result: prev?.result ?? null,
            error: e?.message || String(e),
          }));
        }
      };
      void tick();
      pollTimerRef.current = setInterval(tick, POLL_INTERVAL_MS);
    },
    [stopPolling, refreshShots]
  );

  const handleGenerate = async () => {
    if (!storyText.trim()) {
      setFormError(t('studioErrorStoryRequired'));
      return;
    }
    if (!imageProviderId || !imageModel) {
      setFormError(t('studioErrorProviderRequired'));
      return;
    }
    setFormError(null);
    stopPolling();
    setTask(null);
    setSubmitting(true);
    try {
      const { task_id } = await api.createStudioEpisode({
        project_id: selectedProjectId.trim(),
        story_text: storyText,
        image_provider_id: imageProviderId,
        image_model: imageModel,
        llm_provider_id: llmProviderId || undefined,
        llm_model_id: llmModelId || undefined,
        max_shots: maxShots,
        character_card_ids: selectedCardIds.size > 0 ? Array.from(selectedCardIds) : undefined,
        title: title.trim() || undefined,
      });
      startPolling(task_id);
    } catch (e: any) {
      setFormError(e?.message || String(e));
    } finally {
      setSubmitting(false);
    }
  };

  const toggleCard = (cardId: string) => {
    setSelectedCardIds((prev) => {
      const next = new Set(prev);
      if (next.has(cardId)) next.delete(cardId);
      else next.add(cardId);
      return next;
    });
  };

  // ---------- 审片台 ----------

  /** 审核操作：approve/reject/lock/unlock；reject 时弹备注输入。成功后就地更新。 */
  const handleReview = async (shot: StudioShotOut, action: StudioReviewAction) => {
    let note: string | undefined;
    if (action === 'reject') {
      const input = window.prompt(t('studioReviewNotePrompt'));
      if (input === null) return; // 用户取消
      note = input.trim() || undefined;
    }
    setReviewingId(shot.asset_id);
    try {
      const res = await api.reviewStudioShot(shot.asset_id, action, note);
      setShots((prev) =>
        prev.map((s) =>
          s.asset_id === shot.asset_id
            ? { ...s, review_status: res.review_status, review_note: res.review_note }
            : s
        )
      );
    } catch (e: any) {
      console.warn('[Studio] reviewStudioShot failed', e);
      setFormError(e?.message || String(e));
    } finally {
      setReviewingId(null);
    }
  };

  /** 全部通过：对所有待审镜头批量 approve。 */
  const handleApproveAll = async () => {
    const pending = shots.filter((s) => s.review_status === 'pending_review');
    if (pending.length === 0) return;
    setFormError(null);
    setApprovingAll(true);
    try {
      const results = await Promise.all(
        pending.map((s) => api.reviewStudioShot(s.asset_id, 'approve'))
      );
      const byId = new Map<string, StudioShotReviewOut>(
        results.map((r) => [r.asset_id, r] as [string, StudioShotReviewOut])
      );
      setShots((prev) =>
        prev.map((s) => {
          const r = byId.get(s.asset_id);
          return r ? { ...s, review_status: r.review_status, review_note: r.review_note } : s;
        })
      );
    } catch (e: any) {
      console.warn('[Studio] approve-all failed', e);
      setFormError(e?.message || String(e));
    } finally {
      setApprovingAll(false);
    }
  };

  /** 单镜头重生成：同步接口（1~2 分钟），用表单区已选的图像供应商/模型。 */
  const handleRegenerate = async (shot: StudioShotOut) => {
    if (!imageProviderId || !imageModel) {
      setFormError(t('studioErrorProviderRequired'));
      return;
    }
    setFormError(null);
    setRegeneratingId(shot.asset_id);
    try {
      await api.regenerateStudioShot({
        project_id: selectedProjectId.trim(),
        asset_id: shot.asset_id,
        image_provider_id: imageProviderId,
        image_model: imageModel,
        llm_provider_id: llmProviderId || undefined,
        llm_model_id: llmModelId || undefined,
      });
      await refreshShots(); // 新版本出现，version 数 +1
    } catch (e: any) {
      console.warn('[Studio] regenerateStudioShot failed', e);
      setFormError(e?.message || String(e));
    } finally {
      setRegeneratingId(null);
    }
  };

  // ---------- 成片导出 ----------

  const toggleExportSel = (assetId: string) => {
    setExportSelIds((prev) => {
      const next = new Set(prev);
      if (next.has(assetId)) next.delete(assetId);
      else next.add(assetId);
      return next;
    });
  };

  /** 导出选中镜头为 mp4（同步接口）。 */
  const handleExport = async () => {
    if (exportSelIds.size === 0) return;
    setFormError(null);
    setExporting(true);
    try {
      const res = await api.createStudioExport({
        project_id: selectedProjectId.trim(),
        asset_ids: Array.from(exportSelIds),
        sec_per_image: exportSecPerImage,
        title: title.trim() || undefined,
      });
      setExportResult(res);
    } catch (e: any) {
      console.warn('[Studio] createStudioExport failed', e);
      setFormError(e?.message || String(e));
    } finally {
      setExporting(false);
    }
  };

  // ---------- 标记元数据 ----------

  const phaseLabel = (phase?: string) => {
    switch (phase) {
      case 'planning':
        return t('studioPhasePlanning');
      case 'shooting':
        return t('studioPhaseShooting');
      case 'exporting':
        return t('studioPhaseExporting');
      case 'finished':
        return t('studioPhaseFinished');
      default:
        return '—';
    }
  };

  const shotStatusMeta = (status: StudioShotProgress['status']) => {
    switch (status) {
      case 'running':
        return {
          icon: <Loader2 className="w-4 h-4 text-brand-500 animate-spin" />,
          text: t('studioShotRunning'),
          cls: 'text-brand-500',
        };
      case 'approved':
        return {
          icon: <CheckCircle className="w-4 h-4 text-emerald-500" />,
          text: t('studioShotApproved'),
          cls: 'text-emerald-500',
        };
      case 'max_rounds_exceeded':
        return {
          icon: <XCircle className="w-4 h-4 text-red-500" />,
          text: t('studioShotMaxRounds'),
          cls: 'text-red-500',
        };
      default:
        return {
          icon: <Clock className="w-4 h-4 text-[#5b6474]" />,
          text: t('studioShotPending'),
          cls: 'text-[#5b6474]',
        };
    }
  };

  const reviewStatusMeta = (status: StudioReviewStatus) => {
    switch (status) {
      case 'approved':
        return { text: t('studioReviewApproved'), cls: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30' };
      case 'rejected':
        return { text: t('studioReviewRejected'), cls: 'bg-red-500/10 text-red-400 border-red-500/30' };
      case 'locked':
        return { text: t('studioReviewLocked'), cls: 'bg-indigo-500/10 text-indigo-400 border-indigo-500/30' };
      default:
        return { text: t('studioReviewPending'), cls: 'bg-[#1c2230] text-[#8b94a7] border-[#2a3342]' };
    }
  };

  const criticMeta = (status: StudioShotOut['critic_status']) => {
    if (status === 'approved') return { text: t('studioCriticPass'), cls: 'text-emerald-400' };
    if (status === 'max_rounds_exceeded') return { text: t('studioCriticFail'), cls: 'text-amber-400' };
    return null;
  };

  const taskStatusMeta = (status: StudioEpisodeTaskOut['status']) => {
    switch (status) {
      case 'running':
        return { text: t('studioStatusRunning'), cls: 'bg-brand-600/15 text-brand-400 border-brand-600/40' };
      case 'done':
        return { text: t('studioStatusDone'), cls: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30' };
      case 'partial':
        return { text: t('studioStatusPartial'), cls: 'bg-amber-500/10 text-amber-400 border-amber-500/30' };
      case 'failed':
        return { text: t('studioStatusFailed'), cls: 'bg-red-500/10 text-red-400 border-red-500/30' };
      default:
        return { text: t('studioStatusError'), cls: 'bg-red-500/10 text-red-400 border-red-500/30' };
    }
  };

  // ---------- 派生数据 ----------

  const running = submitting || task?.status === 'running';

  const countByStatus = (st: StudioReviewStatus) =>
    shots.filter((s) => s.review_status === st).length;
  const pendingCount = countByStatus('pending_review');

  const filteredShots =
    shotFilter === 'all' ? shots : shots.filter((s) => s.review_status === shotFilter);

  /** 按 brief 分组（保持出现顺序），组内按 version 升序。 */
  const shotGroups: { brief: string; shots: StudioShotOut[] }[] = [];
  for (const s of filteredShots) {
    const key = s.brief || s.title || s.asset_id;
    const group = shotGroups.find((g) => g.brief === key);
    if (group) group.shots.push(s);
    else shotGroups.push({ brief: key, shots: [s] });
  }
  for (const g of shotGroups) g.shots.sort((a, b) => a.version - b.version);

  const selectedShot = shots.find((s) => s.asset_id === selectedShotId) || null;

  const shotFilters: { id: ShotFilter; label: string; count: number }[] = [
    { id: 'all', label: t('studioFilterAll'), count: shots.length },
    { id: 'pending_review', label: t('studioReviewPending'), count: pendingCount },
    { id: 'approved', label: t('studioReviewApproved'), count: countByStatus('approved') },
    { id: 'rejected', label: t('studioReviewRejected'), count: countByStatus('rejected') },
    { id: 'locked', label: t('studioReviewLocked'), count: countByStatus('locked') },
  ];

  const stageItems: {
    id: StudioStage;
    icon: React.ReactNode;
    label: string;
    count?: number;
  }[] = [
    { id: 'story', icon: <FileText className="w-4 h-4" />, label: t('studioStageStory') },
    { id: 'cards', icon: <Users className="w-4 h-4" />, label: t('studioStageCards'), count: cards.length },
    { id: 'shots', icon: <Film className="w-4 h-4" />, label: t('studioStageShots'), count: shots.length },
    { id: 'episode', icon: <MonitorPlay className="w-4 h-4" />, label: t('studioStageEpisode') },
  ];

  /** 单个镜头卡片（审片阶段网格用）。 */
  const renderShotCard = (s: StudioShotOut) => {
    const rsMeta = reviewStatusMeta(s.review_status);
    const cMeta = criticMeta(s.critic_status);
    const locked = s.review_status === 'locked';
    const busy = reviewingId === s.asset_id || regeneratingId === s.asset_id;
    const selected = selectedShotId === s.asset_id;
    return (
      <div
        key={s.asset_id}
        data-testid={`studio-shot-card-${s.asset_id}`}
        onClick={() => setSelectedShotId(s.asset_id)}
        className={`flex flex-col gap-2 bg-[#11151d] border rounded-xl px-4 py-3 cursor-pointer transition-all hover:border-brand-600/40 ${
          selected ? 'border-brand-600/60 ring-1 ring-brand-600/30' : 'border-[#232b38]'
        }`}
      >
        <div className="flex items-center gap-3">
          {s.url && (
            <img
              src={s.url}
              alt={s.title || s.brief}
              className="w-16 h-16 rounded-lg object-cover flex-shrink-0 bg-black/30"
            />
          )}
          <div className="min-w-0 flex-1">
            <div className="text-sm font-bold text-[#e6eaf2] truncate">{s.title || s.brief}</div>
            <div className="flex items-center flex-wrap gap-2 mt-1">
              <span className="text-xs text-[#5b6474] font-mono">
                {t('studioShotVersion')
                  .replace('{x}', String(s.version))
                  .replace('{y}', String(s.versions))}
              </span>
              {cMeta && <span className={`text-xs font-bold ${cMeta.cls}`}>{cMeta.text}</span>}
              <span
                data-testid={`studio-review-status-${s.asset_id}`}
                className={`text-xs font-bold px-2 py-0.5 rounded-full border ${rsMeta.cls}`}
              >
                {locked && <Lock className="inline w-3 h-3 mr-1 -mt-0.5" />}
                {rsMeta.text}
              </span>
            </div>
            {s.review_note && (
              <div className="text-xs text-[#8b94a7] mt-1 truncate">{s.review_note}</div>
            )}
          </div>
        </div>

        <div className="flex items-center flex-wrap gap-2" onClick={(e) => e.stopPropagation()}>
          {locked ? (
            <button
              data-testid={`studio-review-unlock-${s.asset_id}`}
              disabled={busy}
              onClick={() => handleReview(s, 'unlock')}
              className={`${actionBtnCls} bg-transparent border border-indigo-500/30 text-indigo-400 hover:bg-indigo-500/10`}
            >
              <LockOpen className="w-3.5 h-3.5" />
              {t('studioReviewUnlock')}
            </button>
          ) : (
            <>
              <button
                data-testid={`studio-review-approve-${s.asset_id}`}
                disabled={busy}
                onClick={() => handleReview(s, 'approve')}
                className={`${actionBtnCls} bg-emerald-600 text-white hover:bg-emerald-500`}
              >
                {t('studioReviewApprove')}
              </button>
              <button
                data-testid={`studio-review-reject-${s.asset_id}`}
                disabled={busy}
                onClick={() => handleReview(s, 'reject')}
                className={`${actionBtnCls} bg-transparent border border-red-500/30 text-red-400 hover:bg-red-500/10`}
              >
                {t('studioReviewReject')}
              </button>
              <button
                data-testid={`studio-review-lock-${s.asset_id}`}
                disabled={busy}
                onClick={() => handleReview(s, 'lock')}
                className={`${actionBtnCls} bg-transparent border border-indigo-500/30 text-indigo-400 hover:bg-indigo-500/10`}
              >
                <Lock className="w-3.5 h-3.5" />
                {t('studioReviewLock')}
              </button>
            </>
          )}
          <button
            data-testid={`studio-regen-${s.asset_id}`}
            disabled={busy || regeneratingId !== null}
            onClick={() => handleRegenerate(s)}
            className={`${actionBtnCls} bg-transparent border border-[#2a3342] text-[#e6eaf2] hover:border-brand-600/50`}
          >
            {regeneratingId === s.asset_id ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                {t('studioRegenerating')}
              </>
            ) : (
              <>
                <RefreshCw className="w-3.5 h-3.5" />
                {t('studioRegenerate')}
              </>
            )}
          </button>
        </div>
      </div>
    );
  };

  // ---------- 渲染 ----------

  return (
    <div
      className="fixed inset-0 z-50 bg-[#0b0e14] text-[#e6eaf2] flex flex-col"
      data-testid="studio-panel"
    >
      {/* 顶栏：返回 / 项目选择 / 任务状态徽章 / 生成整集 */}
      <header className="flex items-center gap-3 px-5 h-14 border-b border-[#232b38] bg-[#11151d] flex-shrink-0">
        <button
          onClick={onClose}
          data-testid="studio-back"
          className="p-2 hover:bg-white/5 rounded-lg text-[#8b94a7] hover:text-[#e6eaf2] transition-all flex items-center gap-1.5"
        >
          <ArrowLeft className="w-5 h-5" />
          <span className="text-sm font-medium">{t('studioBack')}</span>
        </button>
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 bg-brand-600 rounded-lg flex items-center justify-center shadow-lg shadow-brand-600/30">
            <Clapperboard className="w-4 h-4 text-white" />
          </div>
          <h1 className="text-base font-bold tracking-tight">{t('studioTitle')}</h1>
        </div>
        <div className="w-px h-6 bg-[#232b38]" />
        <div className="min-w-[160px] max-w-[240px]">
          {projects.length > 0 ? (
            <select
              data-testid="studio-project-select"
              className={`${inputCls} !py-1.5 !rounded-lg`}
              value={selectedProjectId}
              onChange={(e) => setSelectedProjectId(e.target.value)}
            >
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          ) : (
            <input
              data-testid="studio-project-input"
              className={`${inputCls} !py-1.5 !rounded-lg`}
              value={selectedProjectId}
              placeholder={t('studioProjectPlaceholder')}
              onChange={(e) => setSelectedProjectId(e.target.value)}
            />
          )}
        </div>
        {task && (
          <span
            data-testid="studio-task-status"
            className={`text-xs font-bold px-2.5 py-1 rounded-full border ${taskStatusMeta(task.status).cls}`}
          >
            {taskStatusMeta(task.status).text}
          </span>
        )}
        <div className="flex-1" />
        <button
          data-testid="studio-generate-button"
          onClick={handleGenerate}
          disabled={running}
          className={`px-5 py-2 rounded-xl text-sm font-bold flex items-center gap-2 transition-all ${
            running
              ? 'bg-white/5 text-[#5b6474] cursor-not-allowed'
              : 'bg-brand-600 text-white shadow-lg shadow-brand-600/30 hover:bg-brand-500'
          }`}
        >
          {running ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              {t('studioGenerating')}
            </>
          ) : (
            <>
              <Clapperboard className="w-4 h-4" />
              {t('studioGenerate')}
            </>
          )}
        </button>
      </header>

      <div className="flex flex-1 min-h-0">
        {/* 左侧阶段导航 */}
        <nav className="w-52 flex-shrink-0 border-r border-[#232b38] bg-[#11151d] p-3 flex flex-col gap-1">
          {stageItems.map((item) => (
            <button
              key={item.id}
              data-testid={`studio-stage-${item.id}`}
              onClick={() => setStage(item.id)}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all ${
                stage === item.id
                  ? 'bg-brand-600/15 text-brand-400 border border-brand-600/30'
                  : 'text-[#8b94a7] hover:bg-white/5 hover:text-[#e6eaf2] border border-transparent'
              }`}
            >
              {item.icon}
              <span className="flex-1 text-left">{item.label}</span>
              {item.count !== undefined && item.count > 0 && (
                <span className="text-[10px] font-mono font-bold px-1.5 py-0.5 rounded-full bg-white/5 text-[#8b94a7]">
                  {item.count}
                </span>
              )}
              {item.id === 'shots' && pendingCount > 0 && (
                <span
                  data-testid="studio-pending-badge"
                  className="text-[10px] font-mono font-bold px-1.5 py-0.5 rounded-full bg-amber-500/15 text-amber-400"
                >
                  {pendingCount}
                </span>
              )}
            </button>
          ))}
        </nav>

        {/* 中央工作区 */}
        <main className="flex-1 min-w-0 overflow-y-auto p-6">
          {formError && (
            <div
              data-testid="studio-form-error"
              className="max-w-3xl mx-auto mb-4 flex items-center gap-2 text-sm text-red-400 bg-red-500/10 border border-red-500/30 rounded-xl px-4 py-2.5"
            >
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              {formError}
            </div>
          )}

          {/* 故事阶段 */}
          {stage === 'story' && (
            <div className="max-w-3xl mx-auto flex flex-col gap-5">
              <section className={`${panelCls} p-6 flex flex-col gap-4`}>
                <div>
                  <label className={labelCls}>{t('studioStory')}</label>
                  <textarea
                    data-testid="studio-story-input"
                    className={`${inputCls} min-h-[220px] resize-y font-mono leading-relaxed`}
                    value={storyText}
                    placeholder={t('studioStoryPlaceholder')}
                    onChange={(e) => setStoryText(e.target.value)}
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className={labelCls}>{t('studioEpisodeTitle')}</label>
                    <input
                      data-testid="studio-title-input"
                      className={inputCls}
                      value={title}
                      placeholder={t('studioEpisodeTitlePlaceholder')}
                      onChange={(e) => setTitle(e.target.value)}
                    />
                  </div>
                  <div>
                    <label className={labelCls}>{t('studioMaxShots')}</label>
                    <input
                      data-testid="studio-max-shots"
                      type="number"
                      min={1}
                      max={30}
                      className={inputCls}
                      value={maxShots}
                      onChange={(e) => setMaxShots(Math.max(1, Number(e.target.value) || 1))}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className={labelCls}>{t('studioImageProvider')}</label>
                    <select
                      data-testid="studio-image-provider"
                      className={inputCls}
                      value={imageProviderId}
                      onChange={(e) => {
                        setImageProviderId(e.target.value);
                        setImageModel('');
                      }}
                    >
                      <option value="">{t('studioSelectProvider')}</option>
                      {imageProviders.map((p) => (
                        <option key={p.provider_id} value={p.provider_id}>
                          {p.name || p.provider_id}
                        </option>
                      ))}
                    </select>
                    {imageProviders.length === 0 && (
                      <p className="text-xs text-amber-400 mt-1.5">{t('studioNoImageProviders')}</p>
                    )}
                  </div>
                  <div>
                    <label className={labelCls}>{t('studioImageModel')}</label>
                    <select
                      data-testid="studio-image-model"
                      className={inputCls}
                      value={imageModel}
                      onChange={(e) => setImageModel(e.target.value)}
                    >
                      <option value="">{t('studioSelectModel')}</option>
                      {(selectedImageProvider?.image_models || []).map((m) => (
                        <option key={m} value={m}>
                          {m}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className={labelCls}>{t('studioLlmProvider')}</label>
                    <select
                      data-testid="studio-llm-provider"
                      className={inputCls}
                      value={llmProviderId}
                      onChange={(e) => {
                        setLlmProviderId(e.target.value);
                        setLlmModelId('');
                      }}
                    >
                      <option value="">{t('studioAutoSelect')}</option>
                      {llmProviders.map((p) => (
                        <option key={p.provider_id} value={p.provider_id}>
                          {p.name || p.provider_id}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className={labelCls}>{t('studioLlmModel')}</label>
                    <select
                      data-testid="studio-llm-model"
                      className={inputCls}
                      value={llmModelId}
                      onChange={(e) => setLlmModelId(e.target.value)}
                    >
                      <option value="">{t('studioAutoSelect')}</option>
                      {(selectedLlmProvider?.chat_models || []).map((m) => (
                        <option key={m} value={m}>
                          {m}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div>
                  <label className={labelCls}>{t('studioCharacterCards')}</label>
                  {cards.length === 0 ? (
                    <p className="text-xs text-[#5b6474]">{t('studioNoCharacterCards')}</p>
                  ) : (
                    <div className="flex flex-wrap gap-2" data-testid="studio-card-list">
                      {cards.map((c) => (
                        <label
                          key={c.card_id}
                          className={`flex items-center gap-2 border rounded-xl px-3 py-2 cursor-pointer transition-all ${
                            selectedCardIds.has(c.card_id)
                              ? 'border-brand-600/50 bg-brand-600/10'
                              : 'border-[#2a3342] bg-[#0d1117] hover:border-brand-600/30'
                          }`}
                        >
                          <input
                            type="checkbox"
                            data-testid={`studio-card-${c.card_id}`}
                            checked={selectedCardIds.has(c.card_id)}
                            onChange={() => toggleCard(c.card_id)}
                            className="accent-brand-600 w-4 h-4"
                          />
                          {c.url && (
                            <img src={c.url} alt={c.name} className="w-6 h-6 rounded-md object-cover" />
                          )}
                          <span className="text-sm font-bold text-[#e6eaf2]">{c.name}</span>
                        </label>
                      ))}
                    </div>
                  )}
                </div>
              </section>
            </div>
          )}

          {/* 角色卡阶段 */}
          {stage === 'cards' && (
            <div className="max-w-4xl mx-auto flex flex-col gap-4">
              {cards.length > 0 && (
                <div className="grid grid-cols-2 md:grid-cols-3 gap-4" data-testid="studio-card-grid">
                  {cards.map((c) => (
                    <div key={c.card_id} className={`${panelCls} p-4 flex flex-col gap-2`}>
                      {c.url && (
                        <img
                          src={c.url}
                          alt={c.name}
                          className="w-full aspect-square rounded-xl object-cover bg-black/30"
                        />
                      )}
                      <div className="text-sm font-bold text-[#e6eaf2] truncate">{c.name}</div>
                      {c.identity?.face_anchor && (
                        <div className="text-xs text-[#8b94a7] line-clamp-2">
                          {c.identity.face_anchor}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
              <p className="text-xs text-[#5b6474]">{t('studioCardsApiHint')}</p>
            </div>
          )}

          {/* 镜头审片阶段 */}
          {stage === 'shots' && (
            <div
              className="max-w-4xl mx-auto flex flex-col gap-4"
              data-testid="studio-review-board"
            >
              <div className="flex items-center flex-wrap gap-2">
                {shotFilters.map((f) => (
                  <button
                    key={f.id}
                    data-testid={`studio-filter-${f.id}`}
                    onClick={() => setShotFilter(f.id)}
                    className={`px-3 py-1.5 rounded-full text-xs font-bold border transition-all ${
                      shotFilter === f.id
                        ? 'bg-brand-600/15 text-brand-400 border-brand-600/40'
                        : 'text-[#8b94a7] border-[#2a3342] hover:border-brand-600/30'
                    }`}
                  >
                    {f.label}
                    <span className="ml-1.5 font-mono opacity-70">{f.count}</span>
                  </button>
                ))}
                <div className="flex-1" />
                {shotsLoading && <Loader2 className="w-4 h-4 text-brand-500 animate-spin" />}
                <button
                  data-testid="studio-approve-all"
                  onClick={handleApproveAll}
                  disabled={approvingAll || pendingCount === 0}
                  className="px-4 py-1.5 rounded-full text-xs font-bold bg-emerald-600 text-white hover:bg-emerald-500 transition-all disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5"
                >
                  {approvingAll ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <CheckCheck className="w-3.5 h-3.5" />
                  )}
                  {t('studioApproveAll')}
                </button>
              </div>

              {!shotsLoading && shotGroups.length === 0 && (
                <p className="text-xs text-[#5b6474]">{t('studioNoShots')}</p>
              )}

              {shotGroups.map((g, gi) => (
                <div key={g.brief} data-testid={`studio-shot-group-${gi}`} className="flex flex-col gap-2">
                  <div className="text-xs font-bold text-[#8b94a7] truncate">{g.brief}</div>
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-2">
                    {g.shots.map((s) => renderShotCard(s))}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* 成片阶段 */}
          {stage === 'episode' && (
            <div className="max-w-3xl mx-auto flex flex-col gap-5">
              {/* 当前任务成片结果（无任务历史接口，只显示当前任务） */}
              {task && (task.status === 'done' || task.status === 'partial') && task.result ? (
                <section className={`${panelCls} p-6 flex flex-col gap-3`}>
                  <div className="flex items-center gap-2 text-sm font-bold text-emerald-400">
                    <CheckCircle className="w-4 h-4" />
                    {t('studioResultReady')}
                  </div>
                  {task.status === 'partial' && (
                    <p className="text-xs text-amber-400">{t('studioPartialNote')}</p>
                  )}
                  <video
                    data-testid="studio-video"
                    controls
                    src={task.result.url}
                    className="w-full rounded-xl bg-black"
                  />
                  <a
                    data-testid="studio-download"
                    href={task.result.url}
                    download
                    className="inline-flex items-center gap-2 self-start px-4 py-2 rounded-xl bg-brand-600 text-white text-sm font-bold shadow-lg shadow-brand-600/30 hover:bg-brand-500 transition-all"
                  >
                    <Download className="w-4 h-4" />
                    {t('studioDownload')}
                  </a>

                  {/* 每镜头状态列表（trace 数据） */}
                  <div className="flex flex-col gap-2 pt-3 border-t border-[#232b38]">
                    {(task.progress?.shots || []).map((s, i) => {
                      const meta = shotStatusMeta(s.status);
                      return (
                        <div
                          key={`${i}-${s.title}`}
                          className="flex items-center gap-3 bg-[#11151d] border border-[#232b38] rounded-xl px-4 py-2.5"
                        >
                          {meta.icon}
                          <span className="flex-1 text-sm text-[#e6eaf2] truncate">{s.title}</span>
                          <span className="text-xs text-[#5b6474] font-mono">
                            {t('studioRounds').replace('{n}', String(s.rounds))}
                          </span>
                          <span className={`text-xs font-bold ${meta.cls}`}>{meta.text}</span>
                        </div>
                      );
                    })}
                  </div>
                </section>
              ) : (
                <p className="text-xs text-[#5b6474]">{t('studioNoEpisode')}</p>
              )}

              {/* 导出选中镜头 */}
              <section className={`${panelCls} p-6 flex flex-col gap-4`}>
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-bold text-[#e6eaf2]">{t('studioExportSelected')}</h3>
                  <div className="flex items-center gap-2">
                    <label className="text-xs text-[#8b94a7]">{t('studioSecPerImage')}</label>
                    <input
                      data-testid="studio-export-sec"
                      type="number"
                      min={1}
                      max={10}
                      className={`${inputCls} !w-20 !py-1.5 !rounded-lg`}
                      value={exportSecPerImage}
                      onChange={(e) =>
                        setExportSecPerImage(Math.max(1, Number(e.target.value) || 1))
                      }
                    />
                  </div>
                </div>

                {shots.length === 0 ? (
                  <p className="text-xs text-[#5b6474]">{t('studioNoShots')}</p>
                ) : (
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-2" data-testid="studio-export-list">
                    {shots.map((s) => (
                      <label
                        key={s.asset_id}
                        className={`flex items-center gap-2 border rounded-xl px-3 py-2 cursor-pointer transition-all ${
                          exportSelIds.has(s.asset_id)
                            ? 'border-brand-600/50 bg-brand-600/10'
                            : 'border-[#2a3342] bg-[#0d1117] hover:border-brand-600/30'
                        }`}
                      >
                        <input
                          type="checkbox"
                          data-testid={`studio-export-check-${s.asset_id}`}
                          checked={exportSelIds.has(s.asset_id)}
                          onChange={() => toggleExportSel(s.asset_id)}
                          className="accent-brand-600 w-4 h-4"
                        />
                        {s.url && (
                          <img
                            src={s.url}
                            alt={s.title || s.brief}
                            className="w-10 h-10 rounded-lg object-cover flex-shrink-0 bg-black/30"
                          />
                        )}
                        <div className="min-w-0">
                          <div className="text-xs font-bold text-[#e6eaf2] truncate">
                            {s.title || s.brief}
                          </div>
                          <div className="text-[10px] text-[#5b6474] font-mono">
                            {t('studioShotVersion')
                              .replace('{x}', String(s.version))
                              .replace('{y}', String(s.versions))}
                          </div>
                        </div>
                      </label>
                    ))}
                  </div>
                )}

                <button
                  data-testid="studio-export-selected"
                  onClick={handleExport}
                  disabled={exporting || exportSelIds.size === 0}
                  className="px-5 py-2.5 rounded-xl text-sm font-bold bg-brand-600 text-white shadow-lg shadow-brand-600/30 hover:bg-brand-500 transition-all disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2 self-start"
                >
                  {exporting ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      {t('studioExporting')}
                    </>
                  ) : (
                    <>
                      <Download className="w-4 h-4" />
                      {t('studioExportSelected')}
                    </>
                  )}
                </button>

                {exportResult && (
                  <div className="flex flex-col gap-3 pt-3 border-t border-[#232b38]">
                    <div className="flex items-center gap-2 text-sm font-bold text-emerald-400">
                      <CheckCircle className="w-4 h-4" />
                      {t('studioResultReady')}
                    </div>
                    <video
                      data-testid="studio-export-video"
                      controls
                      src={exportResult.url}
                      className="w-full rounded-xl bg-black"
                    />
                    <a
                      data-testid="studio-export-download"
                      href={exportResult.url}
                      download
                      className="inline-flex items-center gap-2 self-start px-4 py-2 rounded-xl bg-brand-600 text-white text-sm font-bold shadow-lg shadow-brand-600/30 hover:bg-brand-500 transition-all"
                    >
                      <Download className="w-4 h-4" />
                      {t('studioDownload')}
                    </a>
                  </div>
                )}
              </section>
            </div>
          )}
        </main>

        {/* 右侧检查器（可折叠） */}
        {inspectorOpen ? (
          <aside
            data-testid="studio-inspector"
            className="w-80 flex-shrink-0 border-l border-[#232b38] bg-[#11151d] overflow-y-auto p-4 flex flex-col gap-4"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-bold text-[#8b94a7] uppercase tracking-wider">
                {t('studioInspector')}
              </h3>
              <button
                data-testid="studio-inspector-toggle"
                onClick={() => setInspectorOpen(false)}
                className="p-1.5 hover:bg-white/5 rounded-lg text-[#8b94a7] hover:text-[#e6eaf2] transition-all"
              >
                <PanelRightClose className="w-4 h-4" />
              </button>
            </div>

            {selectedShot ? (
              <div data-testid="studio-inspector-shot" className="flex flex-col gap-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-sm font-bold text-[#e6eaf2] truncate">
                    {selectedShot.title || selectedShot.brief}
                  </div>
                  <button
                    data-testid="studio-inspector-clear"
                    onClick={() => setSelectedShotId(null)}
                    className="p-1 hover:bg-white/5 rounded-lg text-[#8b94a7] hover:text-[#e6eaf2] transition-all flex-shrink-0"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
                {selectedShot.url && (
                  <img
                    src={selectedShot.url}
                    alt={selectedShot.title || selectedShot.brief}
                    className="w-full rounded-xl object-cover bg-black/30"
                  />
                )}
                <div className="flex items-center flex-wrap gap-2">
                  <span className="text-xs text-[#5b6474] font-mono">
                    {t('studioShotVersion')
                      .replace('{x}', String(selectedShot.version))
                      .replace('{y}', String(selectedShot.versions))}
                  </span>
                  {criticMeta(selectedShot.critic_status) && (
                    <span className={`text-xs font-bold ${criticMeta(selectedShot.critic_status)!.cls}`}>
                      {criticMeta(selectedShot.critic_status)!.text}
                    </span>
                  )}
                  <span
                    className={`text-xs font-bold px-2 py-0.5 rounded-full border ${reviewStatusMeta(selectedShot.review_status).cls}`}
                  >
                    {reviewStatusMeta(selectedShot.review_status).text}
                  </span>
                </div>
                {selectedShot.review_note && (
                  <div className="text-xs text-[#8b94a7]">{selectedShot.review_note}</div>
                )}
                <div>
                  <div className={labelCls}>{t('studioStageStory')}</div>
                  <div className="text-xs text-[#e6eaf2] bg-[#0d1117] border border-[#2a3342] rounded-xl px-3 py-2">
                    {selectedShot.brief}
                  </div>
                </div>
                <div>
                  <div className={labelCls}>{t('studioPromptLabel')}</div>
                  <pre className="text-xs text-[#8b94a7] bg-[#0d1117] border border-[#2a3342] rounded-xl px-3 py-2 whitespace-pre-wrap break-words font-mono max-h-48 overflow-y-auto">
                    {selectedShot.prompt}
                  </pre>
                </div>
              </div>
            ) : task ? (
              <div data-testid="studio-progress" className="flex flex-col gap-3">
                <h4 className="text-xs font-bold text-[#8b94a7] uppercase tracking-wider">
                  {t('studioTaskProgress')}
                </h4>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-[#8b94a7] font-bold">{t('studioPhase')}:</span>
                  <span className="font-bold text-[#e6eaf2]">{phaseLabel(task.progress?.phase)}</span>
                </div>
                <div className="text-sm text-[#8b94a7] font-mono">
                  {t('studioShotCounter')
                    .replace('{current}', String(task.progress?.current_shot ?? 0))
                    .replace('{total}', String(task.progress?.total_shots ?? 0))}
                </div>

                {task.status === 'running' && (
                  <div className="h-1.5 bg-white/5 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-brand-600 rounded-full transition-all duration-500"
                      style={{
                        width: `${
                          task.progress?.total_shots
                            ? Math.round((task.progress.current_shot / task.progress.total_shots) * 100)
                            : 5
                        }%`,
                      }}
                    />
                  </div>
                )}

                <div className="flex flex-col gap-2">
                  {(task.progress?.shots || []).map((s, i) => {
                    const meta = shotStatusMeta(s.status);
                    return (
                      <div
                        key={`${i}-${s.title}`}
                        data-testid={`studio-shot-${i}`}
                        className="flex items-center gap-3 bg-[#0d1117] border border-[#232b38] rounded-xl px-3 py-2"
                      >
                        {meta.icon}
                        <span className="flex-1 text-sm text-[#e6eaf2] truncate">{s.title}</span>
                        <span className={`text-xs font-bold ${meta.cls}`}>{meta.text}</span>
                      </div>
                    );
                  })}
                </div>

                {(task.status === 'failed' || task.status === 'error') && (
                  <div
                    data-testid="studio-task-error"
                    className="flex items-center gap-2 text-sm text-red-400 bg-red-500/10 border border-red-500/30 rounded-xl px-4 py-2.5"
                  >
                    <AlertCircle className="w-4 h-4 flex-shrink-0" />
                    <span>
                      {t('studioFailed')}
                      {task.error ? `: ${task.error}` : ''}
                    </span>
                  </div>
                )}
              </div>
            ) : (
              <p className="text-xs text-[#5b6474]">{t('studioSelectShotHint')}</p>
            )}
          </aside>
        ) : (
          <button
            data-testid="studio-inspector-toggle"
            onClick={() => setInspectorOpen(true)}
            className="w-10 flex-shrink-0 border-l border-[#232b38] bg-[#11151d] flex items-start justify-center pt-4 text-[#8b94a7] hover:text-[#e6eaf2] transition-all"
          >
            <PanelRightOpen className="w-4 h-4" />
          </button>
        )}
      </div>
    </div>
  );
};

export default StudioPanel;
