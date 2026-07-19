/**
 * StudioPanel — 短剧工作室：输入故事 → 选角色卡（可选）→ 生成整集 →
 * 轮询展示每个镜头的 agent 进度 → 播放/下载成片 MP4。
 *
 * 后端契约（见 services/apiClient.ts 的 Studio 类型）：
 *   POST /api/studio/episodes        → 202 { task_id }
 *   GET  /api/studio/episodes/{id}   → { status, progress, result, error }
 *   GET  /api/studio/character-cards → 角色卡列表
 * 轮询间隔 3s，status !== 'running' 或组件卸载/重新生成时停止。
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle,
  Clapperboard,
  Clock,
  Download,
  Loader2,
  Lock,
  LockOpen,
  RefreshCw,
  XCircle,
} from 'lucide-react';
import {
  api,
  ProviderOut,
  StudioCharacterCardOut,
  StudioEpisodeTaskOut,
  StudioReviewAction,
  StudioReviewStatus,
  StudioShotOut,
  StudioShotProgress,
} from '../services/apiClient';
import { useI18n } from '../i18n';

const POLL_INTERVAL_MS = 3000;

interface StudioPanelProps {
  /** 当前项目 id（有画布上下文时传入）。 */
  projectId?: string | null;
  /** 可选项目列表（项目选择下拉）；为空时退化为手输 project id。 */
  projects?: { id: string; name: string }[];
  onClose: () => void;
}

const inputCls =
  'w-full bg-[#f8fafc] border border-[#e8edf3] rounded-xl px-4 py-2.5 text-sm text-[#111827] ' +
  'focus:outline-none focus:border-brand-600/50 focus:ring-1 focus:ring-brand-600/20 transition-all placeholder:text-[#94a3b8]';
const labelCls = 'block text-xs font-bold text-[#64748b] mb-1.5 uppercase tracking-wider';

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

  // 项目切换时重新拉角色卡，并清空已选
  useEffect(() => {
    setSelectedCardIds(new Set());
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
            // 整集生成结束后刷新审片台镜头列表
            void refreshShots();
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

  const reviewStatusMeta = (status: StudioReviewStatus) => {
    switch (status) {
      case 'approved':
        return { text: t('studioReviewApproved'), cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' };
      case 'rejected':
        return { text: t('studioReviewRejected'), cls: 'bg-red-50 text-red-600 border-red-200' };
      case 'locked':
        return { text: t('studioReviewLocked'), cls: 'bg-indigo-50 text-indigo-700 border-indigo-200' };
      default:
        return { text: t('studioReviewPending'), cls: 'bg-[#f1f5f9] text-[#64748b] border-[#e2e8f0]' };
    }
  };

  const criticMeta = (status: StudioShotOut['critic_status']) => {
    if (status === 'approved')
      return { text: t('studioCriticPass'), cls: 'text-emerald-600' };
    if (status === 'max_rounds_exceeded')
      return { text: t('studioCriticFail'), cls: 'text-amber-600' };
    return null;
  };

  /** 按 brief 分组（保持出现顺序），组内按 version 升序。 */
  const shotGroups: { brief: string; shots: StudioShotOut[] }[] = [];
  for (const s of shots) {
    const key = s.brief || s.title || s.asset_id;
    const group = shotGroups.find((g) => g.brief === key);
    if (group) group.shots.push(s);
    else shotGroups.push({ brief: key, shots: [s] });
  }
  for (const g of shotGroups) g.shots.sort((a, b) => a.version - b.version);

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
          icon: <Loader2 className="w-4 h-4 text-brand-600 animate-spin" />,
          text: t('studioShotRunning'),
          cls: 'text-brand-600',
        };
      case 'approved':
        return {
          icon: <CheckCircle className="w-4 h-4 text-emerald-600" />,
          text: t('studioShotApproved'),
          cls: 'text-emerald-600',
        };
      case 'max_rounds_exceeded':
        return {
          icon: <XCircle className="w-4 h-4 text-red-600" />,
          text: t('studioShotMaxRounds'),
          cls: 'text-red-600',
        };
      default:
        return {
          icon: <Clock className="w-4 h-4 text-[#94a3b8]" />,
          text: t('studioShotPending'),
          cls: 'text-[#94a3b8]',
        };
    }
  };

  const running = submitting || task?.status === 'running';

  return (
    <div className="fixed inset-0 z-50 bg-[#f8fafc] overflow-y-auto" data-testid="studio-panel">
      {/* 顶栏 */}
      <header className="sticky top-0 z-10 glass border-b border-[#e8edf3]">
        <div className="px-6 h-16 flex items-center gap-3">
          <button
            onClick={onClose}
            data-testid="studio-back"
            className="p-2 hover:bg-black/5 rounded-lg text-[#64748b] hover:text-[#111827] transition-all flex items-center gap-1.5"
          >
            <ArrowLeft className="w-5 h-5" />
            <span className="text-sm font-medium">{t('studioBack')}</span>
          </button>
          <div className="flex items-center gap-2">
            <div className="w-9 h-9 bg-brand-600 rounded-xl flex items-center justify-center shadow-lg shadow-brand-600/20">
              <Clapperboard className="w-5 h-5 text-white" />
            </div>
            <h1 className="text-lg font-bold text-[#111827] tracking-tight">{t('studioTitle')}</h1>
          </div>
        </div>
      </header>

      <div className="max-w-3xl mx-auto p-6 flex flex-col gap-6">
        {/* 生成表单 */}
        <section className="bg-white border border-[#e8edf3] rounded-2xl p-6 shadow-sm flex flex-col gap-4">
          {/* 项目 */}
          <div>
            <label className={labelCls}>{t('studioProject')}</label>
            {projects.length > 0 ? (
              <select
                data-testid="studio-project-select"
                className={inputCls}
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
                className={inputCls}
                value={selectedProjectId}
                placeholder={t('studioProjectPlaceholder')}
                onChange={(e) => setSelectedProjectId(e.target.value)}
              />
            )}
          </div>

          {/* 故事文本 */}
          <div>
            <label className={labelCls}>{t('studioStory')}</label>
            <textarea
              data-testid="studio-story-input"
              className={`${inputCls} min-h-[140px] resize-y`}
              value={storyText}
              placeholder={t('studioStoryPlaceholder')}
              onChange={(e) => setStoryText(e.target.value)}
            />
          </div>

          {/* 标题 + 镜头数 */}
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

          {/* 图像供应商/模型 */}
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
                <p className="text-xs text-amber-600 mt-1.5">{t('studioNoImageProviders')}</p>
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

          {/* LLM 供应商/模型（可选） */}
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

          {/* 角色卡多选 */}
          <div>
            <label className={labelCls}>{t('studioCharacterCards')}</label>
            {cards.length === 0 ? (
              <p className="text-xs text-[#94a3b8]">{t('studioNoCharacterCards')}</p>
            ) : (
              <div className="flex flex-col gap-2" data-testid="studio-card-list">
                {cards.map((c) => (
                  <label
                    key={c.card_id}
                    className="flex items-center gap-3 bg-[#f8fafc] border border-[#e8edf3] rounded-xl px-4 py-2.5 cursor-pointer hover:border-brand-600/40 transition-all"
                  >
                    <input
                      type="checkbox"
                      data-testid={`studio-card-${c.card_id}`}
                      checked={selectedCardIds.has(c.card_id)}
                      onChange={() => toggleCard(c.card_id)}
                      className="accent-brand-600 w-4 h-4"
                    />
                    {c.url && (
                      <img src={c.url} alt={c.name} className="w-8 h-8 rounded-lg object-cover" />
                    )}
                    <div className="min-w-0">
                      <div className="text-sm font-bold text-[#111827] truncate">{c.name}</div>
                      {c.identity?.face_anchor && (
                        <div className="text-xs text-[#64748b] truncate">
                          {c.identity.face_anchor}
                        </div>
                      )}
                    </div>
                  </label>
                ))}
              </div>
            )}
          </div>

          {formError && (
            <div
              data-testid="studio-form-error"
              className="flex items-center gap-2 text-sm text-red-600 bg-red-50 border border-red-200 rounded-xl px-4 py-2.5"
            >
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              {formError}
            </div>
          )}

          <button
            data-testid="studio-generate-button"
            onClick={handleGenerate}
            disabled={running}
            className={`px-5 py-3 rounded-xl text-sm font-bold flex items-center justify-center gap-2 transition-all ${
              running
                ? 'bg-black/[0.04] text-[#94a3b8] cursor-not-allowed'
                : 'bg-brand-600 text-white shadow-lg shadow-brand-600/20 hover:shadow-brand-600/30'
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
        </section>

        {/* 进度 */}
        {task && (
          <section
            data-testid="studio-progress"
            className="bg-white border border-[#e8edf3] rounded-2xl p-6 shadow-sm flex flex-col gap-4"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm">
                <span className="text-[#64748b] font-bold">{t('studioPhase')}:</span>
                <span className="font-bold text-[#111827]">{phaseLabel(task.progress?.phase)}</span>
              </div>
              <span className="text-sm text-[#64748b] font-mono">
                {t('studioShotCounter')
                  .replace('{current}', String(task.progress?.current_shot ?? 0))
                  .replace('{total}', String(task.progress?.total_shots ?? 0))}
              </span>
            </div>

            {task.status === 'running' && (
              <div className="h-1.5 bg-black/[0.04] rounded-full overflow-hidden">
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
                    className="flex items-center gap-3 bg-[#f8fafc] border border-[#e8edf3] rounded-xl px-4 py-2.5"
                  >
                    {meta.icon}
                    <span className="flex-1 text-sm text-[#111827] truncate">{s.title}</span>
                    <span className="text-xs text-[#94a3b8] font-mono">
                      {t('studioRounds').replace('{n}', String(s.rounds))}
                    </span>
                    <span className={`text-xs font-bold ${meta.cls}`}>{meta.text}</span>
                  </div>
                );
              })}
            </div>

            {/* 结果：done / partial */}
            {(task.status === 'done' || task.status === 'partial') && task.result && (
              <div className="flex flex-col gap-3 pt-2 border-t border-[#e8edf3]">
                <div className="flex items-center gap-2 text-sm font-bold text-emerald-600">
                  <CheckCircle className="w-4 h-4" />
                  {t('studioResultReady')}
                </div>
                {task.status === 'partial' && (
                  <p className="text-xs text-amber-600">{t('studioPartialNote')}</p>
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
                  className="inline-flex items-center gap-2 self-start px-4 py-2 rounded-xl bg-brand-600 text-white text-sm font-bold shadow-lg shadow-brand-600/20 hover:shadow-brand-600/30 transition-all"
                >
                  <Download className="w-4 h-4" />
                  {t('studioDownload')}
                </a>
              </div>
            )}

            {/* 失败 */}
            {(task.status === 'failed' || task.status === 'error') && (
              <div
                data-testid="studio-task-error"
                className="flex items-center gap-2 text-sm text-red-600 bg-red-50 border border-red-200 rounded-xl px-4 py-2.5"
              >
                <AlertCircle className="w-4 h-4 flex-shrink-0" />
                <span>
                  {t('studioFailed')}
                  {task.error ? `: ${task.error}` : ''}
                </span>
              </div>
            )}
          </section>
        )}

        {/* 审片台：项目全部镜头，人工审核 + 单镜头重生成 */}
        <section
          data-testid="studio-review-board"
          className="bg-white border border-[#e8edf3] rounded-2xl p-6 shadow-sm flex flex-col gap-4"
        >
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold text-[#111827] uppercase tracking-wider">
              {t('studioReviewBoard')}
            </h2>
            {shotsLoading && <Loader2 className="w-4 h-4 text-brand-600 animate-spin" />}
          </div>

          {!shotsLoading && shotGroups.length === 0 && (
            <p className="text-xs text-[#94a3b8]">{t('studioNoShots')}</p>
          )}

          {shotGroups.map((g, gi) => (
            <div key={g.brief} data-testid={`studio-shot-group-${gi}`} className="flex flex-col gap-2">
              <div className="text-xs font-bold text-[#64748b] truncate">{g.brief}</div>
              {g.shots.map((s) => {
                const rsMeta = reviewStatusMeta(s.review_status);
                const cMeta = criticMeta(s.critic_status);
                const locked = s.review_status === 'locked';
                const busy = reviewingId === s.asset_id || regeneratingId === s.asset_id;
                return (
                  <div
                    key={s.asset_id}
                    data-testid={`studio-shot-card-${s.asset_id}`}
                    className="flex flex-col gap-2 bg-[#f8fafc] border border-[#e8edf3] rounded-xl px-4 py-3"
                  >
                    <div className="flex items-center gap-3">
                      {s.url && (
                        <img
                          src={s.url}
                          alt={s.title || g.brief}
                          className="w-16 h-16 rounded-lg object-cover flex-shrink-0 bg-black/5"
                        />
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-bold text-[#111827] truncate">
                          {s.title || s.brief}
                        </div>
                        <div className="flex items-center flex-wrap gap-2 mt-1">
                          <span className="text-xs text-[#94a3b8] font-mono">
                            {t('studioShotVersion')
                              .replace('{x}', String(s.version))
                              .replace('{y}', String(s.versions))}
                          </span>
                          {cMeta && (
                            <span className={`text-xs font-bold ${cMeta.cls}`}>{cMeta.text}</span>
                          )}
                          <span
                            data-testid={`studio-review-status-${s.asset_id}`}
                            className={`text-xs font-bold px-2 py-0.5 rounded-full border ${rsMeta.cls}`}
                          >
                            {locked && <Lock className="inline w-3 h-3 mr-1 -mt-0.5" />}
                            {rsMeta.text}
                          </span>
                        </div>
                        {s.review_note && (
                          <div className="text-xs text-[#64748b] mt-1 truncate">
                            {s.review_note}
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center flex-wrap gap-2">
                      {locked ? (
                        <button
                          data-testid={`studio-review-unlock-${s.asset_id}`}
                          disabled={busy}
                          onClick={() => handleReview(s, 'unlock')}
                          className="px-3 py-1.5 rounded-lg text-xs font-bold bg-white border border-indigo-200 text-indigo-700 hover:bg-indigo-50 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1"
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
                            className="px-3 py-1.5 rounded-lg text-xs font-bold bg-emerald-600 text-white hover:bg-emerald-500 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            {t('studioReviewApprove')}
                          </button>
                          <button
                            data-testid={`studio-review-reject-${s.asset_id}`}
                            disabled={busy}
                            onClick={() => handleReview(s, 'reject')}
                            className="px-3 py-1.5 rounded-lg text-xs font-bold bg-white border border-red-200 text-red-600 hover:bg-red-50 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            {t('studioReviewReject')}
                          </button>
                          <button
                            data-testid={`studio-review-lock-${s.asset_id}`}
                            disabled={busy}
                            onClick={() => handleReview(s, 'lock')}
                            className="px-3 py-1.5 rounded-lg text-xs font-bold bg-white border border-indigo-200 text-indigo-700 hover:bg-indigo-50 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1"
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
                        className="px-3 py-1.5 rounded-lg text-xs font-bold bg-white border border-[#e8edf3] text-[#111827] hover:border-brand-600/40 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1"
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
              })}
            </div>
          ))}
        </section>
      </div>
    </div>
  );
};

export default StudioPanel;
