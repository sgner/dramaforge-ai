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
  XCircle,
} from 'lucide-react';
import {
  api,
  ProviderOut,
  StudioCharacterCardOut,
  StudioEpisodeTaskOut,
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
          if (data.status !== 'running') stopPolling();
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
    [stopPolling]
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
      </div>
    </div>
  );
};

export default StudioPanel;
