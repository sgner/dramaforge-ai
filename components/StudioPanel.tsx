/**
 * StudioPanel — 专业工作室布局：左侧阶段导航 + 中央工作区。
 *
 * 三台：导演台（director，默认）/ 剪辑台（timeline）/ 成片库（episode）。
 * - 导演台：整理 / 审核 / 补缺本项目资产（components/studio/DirectorDesk.tsx），
 *   "生成设置"行与单镜头重生成都在导演台；一键"送入剪辑台"把匹配到资产的镜头
 *   按脚本序灌入时间线并切到剪辑台。
 * - 剪辑台：AE 式专业剪辑工作区（组件在 components/studio/ 下）：补充素材 bin
 *   （默认折叠，只显示未入轨资产）+ 节目监视器 + clip 检查器 + 时间线 +
 *   全局快捷键（use-timeline-shortcuts）；该阶段无右侧检查器。
 * - 成片库：项目视频类资产（剪辑台导出后由后端登记，刷新可见）。
 * 后端契约见 services/apiClient.ts 的 Studio 类型：
 *   POST /api/assets/rebuild-from-nodes/{projectId} → 画布产物同步为 Asset
 *   GET  /api/drama-tasks/{id}                      → 脚本（data.bigShots）
 *   GET  /api/studio/shots                          → 镜头列表（审片状态）
 *   POST /api/studio/shots/{id}/review              → 人工审核（approve/reject）
 *   POST /api/studio/shots/regenerate               → 单镜头重生成（同步，1~2 分钟）
 *   POST /api/studio/arrange                        → LLM 智能编排时间线（无 LLM 配置 400）
 *   POST /api/studio/export                         → 时间线合成 mp4（登记为项目资产）
 */
import React, { useEffect, useState } from 'react';
import {
  AlertCircle,
  ArrowLeft,
  Clapperboard,
  Download,
  Film,
  Loader2,
  MonitorPlay,
  Scissors,
} from 'lucide-react';
import { api, AssetOut, ProviderOut, StudioExportOut } from '../services/apiClient';
import { useI18n } from '../i18n';
import { TimelineItem } from './studio/types';
import { useSequencePlayback } from './studio/use-sequence-playback';
import { useTimelineShortcuts } from './studio/use-timeline-shortcuts';
import { AssetBin } from './studio/AssetBin';
import { ProgramMonitor } from './studio/ProgramMonitor';
import {
  DEFAULT_PX_PER_SEC,
  MAX_PX_PER_SEC,
  MIN_PX_PER_SEC,
  PX_PER_SEC_STEP,
  TimelineEditor,
} from './studio/TimelineEditor';
import { ClipInspector } from './studio/ClipInspector';
import { DirectorDesk } from './studio/DirectorDesk';
import { appleInput, applePanel } from './studio/theme';

type StudioStage = 'director' | 'timeline' | 'episode';

interface StudioPanelProps {
  /** 当前项目 id（有画布上下文时传入；传了 onProjectChange 则受控）。 */
  projectId?: string | null;
  /** 可选项目列表（项目选择下拉）；为空时退化为手输 project id。 */
  projects?: { id: string; name: string }[];
  onClose: () => void;
  /** 受控阶段（外壳映射：Studio→director / Timeline→timeline / Export→episode）。 */
  activeStage?: StudioStage;
  /** 阶段变化回调（配合 activeStage 受控使用）。 */
  onStageChange?: (stage: StudioStage) => void;
  /** 传了则 projectId 受控，选中变化回调。 */
  onProjectChange?: (projectId: string) => void;
  /** full（默认）：独立全屏覆盖层（自带顶栏 + 阶段 nav）；
   *  embedded：嵌入外壳（隐藏顶栏与阶段 nav、去全屏定位）。 */
  chrome?: 'full' | 'embedded';
}

// Apple HIG 深色工作台配色（与 components/studio/ 共用）
const inputCls = appleInput;
const panelCls = applePanel;

export const StudioPanel: React.FC<StudioPanelProps> = ({
  projectId,
  projects = [],
  onClose,
  activeStage,
  onStageChange,
  onProjectChange,
  chrome = 'full',
}) => {
  const { t } = useI18n();

  // 项目：传了 onProjectChange 则受控（外壳工作区共享），否则内部 state
  const [internalProjectId, setInternalProjectId] = useState(
    projectId || projects[0]?.id || 'studio-demo'
  );
  const selectedProjectId = onProjectChange
    ? projectId || projects[0]?.id || 'studio-demo'
    : internalProjectId;
  const setSelectedProjectId = (id: string) => {
    if (onProjectChange) onProjectChange(id);
    else setInternalProjectId(id);
  };

  const [providers, setProviders] = useState<ProviderOut[]>([]);

  const [formError, setFormError] = useState<string | null>(null);

  // 工作台布局状态（默认导演台：先整理/审核资产，再进剪辑台）；
  // 传了 activeStage 则受控（外壳 view 驱动），否则内部 state
  const [internalStage, setInternalStage] = useState<StudioStage>('director');
  const stage = activeStage ?? internalStage;
  const setStage = (s: StudioStage) => {
    if (activeStage !== undefined) onStageChange?.(s);
    else setInternalStage(s);
  };

  const embedded = chrome === 'embedded';

  // 成片库：项目视频类资产
  const [filmAssets, setFilmAssets] = useState<AssetOut[]>([]);
  const [filmsLoading, setFilmsLoading] = useState(false);

  // 剪辑台：补充素材 + 时间线
  const [tlAssets, setTlAssets] = useState<AssetOut[]>([]);
  const [tlAssetsLoading, setTlAssetsLoading] = useState(false);
  const [timeline, setTimeline] = useState<TimelineItem[]>([]);
  const [arranging, setArranging] = useState(false);
  const [tlExporting, setTlExporting] = useState(false);
  const [tlExportResult, setTlExportResult] = useState<StudioExportOut | null>(null);
  // 智能编排的可选故事线索（story_hint）
  const [storyHint, setStoryHint] = useState('');
  // 导出成片标题（可选）
  const [filmTitle, setFilmTitle] = useState('');
  // 选中的 clip 下标（-1 = 未选中，检查器显示序列汇总）
  const [selectedClipIndex, setSelectedClipIndex] = useState(-1);
  // 时间线缩放（受控，快捷键 +/- 与缩放控件共用）
  const [pxPerSec, setPxPerSec] = useState(DEFAULT_PX_PER_SEC);
  // 序列预览播放（节目监视器 / 时间线 playhead 共用）
  const tlPlayback = useSequencePlayback(timeline);

  // 加载供应商（只保留 enabled；导演台"生成设置"用）
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

  // 项目切换时清空时间线等状态
  useEffect(() => {
    setTimeline([]);
    setTlExportResult(null);
    setSelectedClipIndex(-1);
  }, [selectedProjectId]);

  // 进入剪辑台阶段时拉取项目资产，供补充素材 bin 挑选
  useEffect(() => {
    if (stage !== 'timeline') return;
    const pid = selectedProjectId.trim();
    if (!pid) {
      setTlAssets([]);
      return;
    }
    let cancelled = false;
    setTlAssetsLoading(true);
    api
      .listAssets(pid)
      .then((rows) => {
        if (!cancelled) setTlAssets(rows || []);
      })
      .catch((e) => {
        console.warn('[Studio] listAssets(timeline) failed', e);
        if (!cancelled) setTlAssets([]);
      })
      .finally(() => {
        if (!cancelled) setTlAssetsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [stage, selectedProjectId]);

  // 进入成片库阶段时拉取项目资产，过滤出视频类成片
  useEffect(() => {
    if (stage !== 'episode') return;
    const pid = selectedProjectId.trim();
    if (!pid) {
      setFilmAssets([]);
      return;
    }
    let cancelled = false;
    setFilmsLoading(true);
    api
      .listAssets(pid)
      .then((rows) => {
        if (!cancelled) setFilmAssets(rows || []);
      })
      .catch((e) => {
        console.warn('[Studio] listAssets(films) failed', e);
        if (!cancelled) setFilmAssets([]);
      })
      .finally(() => {
        if (!cancelled) setFilmsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [stage, selectedProjectId]);

  // ---------- 剪辑台（时间线） ----------

  // 可作时间线素材的资产：图片/视频类（kind/asset_kind 含 image/video/character/shot），排除失败/生成中/无 url
  const tlLibraryAssets = tlAssets.filter((a) => {
    if (a.failed || a.generating || !a.url) return false;
    const k = `${a.kind || ''} ${a.asset_kind || ''}`.toLowerCase();
    return (
      k.includes('image') || k.includes('video') || k.includes('character') || k.includes('shot')
    );
  });

  const tlAssetIds = new Set(timeline.map((it) => it.asset.id));
  const tlTotalSec = timeline.reduce((sum, it) => sum + (it.sec || 0), 0);

  /** 点补充素材缩略图：追加到时间线末尾（默认 2 秒/镜头）。 */
  const addToTimeline = (asset: AssetOut) => {
    if (tlAssetIds.has(asset.id)) return;
    setTimeline((prev) => [...prev, { asset, sec: 2, caption: '' }]);
    setTlExportResult(null);
  };

  const moveTlItem = (index: number, dir: -1 | 1) => {
    setTimeline((prev) => {
      const next = [...prev];
      const target = index + dir;
      if (target < 0 || target >= next.length) return prev;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
    // 选中态跟随 clip 移动
    setSelectedClipIndex((sel) =>
      sel === index ? index + dir : sel === index + dir ? index : sel
    );
    setTlExportResult(null);
  };

  const removeTlItem = (index: number) => {
    setTimeline((prev) => prev.filter((_, i) => i !== index));
    // 移除选中 clip 则取消选中，其后 clip 下标前移
    setSelectedClipIndex((sel) => (sel === index ? -1 : sel > index ? sel - 1 : sel));
    setTlExportResult(null);
  };

  const setTlItemSec = (index: number, sec: number) => {
    setTimeline((prev) =>
      prev.map((it, i) => (i === index ? { ...it, sec: Math.max(1, sec || 1) } : it))
    );
    setTlExportResult(null);
  };

  const setTlItemCaption = (index: number, caption: string) => {
    setTimeline((prev) => prev.map((it, i) => (i === index ? { ...it, caption } : it)));
    setTlExportResult(null);
  };

  /** 智能编排：LLM 按故事线索重排时间线并回填 sec/caption（同步接口，无 LLM 配置 400）。 */
  const handleArrange = async () => {
    if (timeline.length < 2 || arranging) return;
    setFormError(null);
    setArranging(true);
    try {
      const res = await api.arrangeStudioAssets({
        project_id: selectedProjectId.trim(),
        asset_ids: timeline.map((it) => it.asset.id),
        story_hint: storyHint.trim() || undefined,
        llm_provider_id: undefined,
        llm_model_id: undefined,
      });
      const byId = new Map<string, AssetOut>(timeline.map((it) => [it.asset.id, it.asset]));
      const next: TimelineItem[] = [];
      for (const item of res.items || []) {
        const asset = byId.get(item.asset_id);
        if (asset) next.push({ asset, sec: item.sec, caption: item.caption || '' });
      }
      if (next.length > 0) setTimeline(next);
      // 编排后顺序变化，清除 clip 选中态
      setSelectedClipIndex(-1);
      setTlExportResult(null);
    } catch (e: any) {
      console.warn('[Studio] arrangeStudioAssets failed', e);
      setFormError(e?.message || String(e));
    } finally {
      setArranging(false);
    }
  };

  /** 从时间线导出成片（逐镜头秒数走 durations；后端登记为项目资产，成片库可见）。 */
  const handleTlExport = async () => {
    if (timeline.length === 0 || tlExporting) return;
    setFormError(null);
    setTlExporting(true);
    try {
      const res = await api.createStudioExport({
        project_id: selectedProjectId.trim(),
        asset_ids: timeline.map((it) => it.asset.id),
        durations: timeline.map((it) => it.sec),
        title: filmTitle.trim() || undefined,
      });
      setTlExportResult(res);
    } catch (e: any) {
      console.warn('[Studio] timeline export failed', e);
      setFormError(e?.message || String(e));
    } finally {
      setTlExporting(false);
    }
  };

  /** 导演台"送入剪辑台"：灌入镜头序列并切到剪辑台阶段。 */
  const handleSendToTimeline = (items: TimelineItem[]) => {
    setTimeline(items);
    setSelectedClipIndex(-1);
    setTlExportResult(null);
    setStage('timeline');
  };

  // 剪辑台全局快捷键（仅剪辑台阶段激活）
  useTimelineShortcuts(stage === 'timeline', {
    playback: tlPlayback,
    selectedIndex: selectedClipIndex,
    onRemove: removeTlItem,
    onMove: moveTlItem,
    onZoom: (dir) =>
      setPxPerSec((v) =>
        Math.min(MAX_PX_PER_SEC, Math.max(MIN_PX_PER_SEC, v + dir * PX_PER_SEC_STEP))
      ),
    onExport: () => void handleTlExport(),
    canExport: timeline.length > 0 && !tlExporting,
  });

  // ---------- 派生数据 ----------

  // 成片库：视频类资产（kind === 'video' 或 asset_kind === 'sequence'），排除失败/生成中/无 url
  const films = filmAssets.filter((a) => {
    if (a.failed || a.generating || !a.url) return false;
    return a.kind === 'video' || a.asset_kind === 'sequence';
  });

  const stageItems: {
    id: StudioStage;
    icon: React.ReactNode;
    label: string;
    count?: number;
  }[] = [
    { id: 'director', icon: <Film className="w-4 h-4" />, label: t('studioStageDirector') },
    { id: 'timeline', icon: <Scissors className="w-4 h-4" />, label: t('studioStageTimeline'), count: timeline.length },
    { id: 'episode', icon: <MonitorPlay className="w-4 h-4" />, label: t('studioStageEpisode') },
  ];

  // ---------- 渲染 ----------

  return (
    <div
      className={
        embedded
          ? 'relative h-full min-h-0 text-white/90 studio-font flex flex-col'
          : 'fixed inset-0 z-50 bg-[radial-gradient(1200px_600px_at_50%_-10%,rgba(64,64,74,0.35),transparent)] bg-black text-white/90 studio-font flex flex-col'
      }
      data-testid="studio-panel"
    >
      {/* 顶栏：返回 / 项目选择（毛玻璃吸顶条）—— embedded 模式由外壳 TopBar 承担，隐藏 */}
      {!embedded && (
      <header className="flex items-center gap-3 px-5 h-14 border-b border-white/[0.05] bg-black/60 backdrop-blur-xl flex-shrink-0">
        <button
          onClick={onClose}
          data-testid="studio-back"
          className="p-2 hover:bg-white/[0.08] rounded-full text-white/55 hover:text-white/90 transition-all flex items-center gap-1.5"
        >
          <ArrowLeft className="w-5 h-5" />
          <span className="text-sm font-medium">{t('studioBack')}</span>
        </button>
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 bg-[#0A84FF] rounded-xl flex items-center justify-center shadow-lg shadow-[#0A84FF]/30">
            <Clapperboard className="w-4 h-4 text-white" />
          </div>
          <h1 className="text-[17px] font-semibold tracking-tight">{t('studioTitle')}</h1>
        </div>
        <div className="w-px h-6 bg-white/[0.08]" />
        <div className="min-w-[160px] max-w-[240px]">
          {projects.length > 0 ? (
            <select
              data-testid="studio-project-select"
              className={`${inputCls} !py-1.5 !rounded-full !bg-white/[0.08]`}
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
              className={`${inputCls} !py-1.5 !rounded-full !bg-white/[0.08]`}
              value={selectedProjectId}
              placeholder={t('studioProjectPlaceholder')}
              onChange={(e) => setSelectedProjectId(e.target.value)}
            />
          )}
        </div>
        <div className="flex-1" />
      </header>
      )}

      <div className="flex flex-1 min-h-0">
        {/* 左侧阶段导航：无边框，选中态 = 蓝色指示条 + 填充圆角块 —— embedded 模式由外壳 Sidebar 承担，隐藏 */}
        {!embedded && (
        <nav className="w-52 flex-shrink-0 border-r border-white/[0.05] p-3 flex flex-col gap-1">
          {stageItems.map((item) => (
            <button
              key={item.id}
              data-testid={`studio-stage-${item.id}`}
              onClick={() => setStage(item.id)}
              className={`flex items-center gap-3.5 px-3 py-3 rounded-xl text-sm font-medium transition-all ${
                stage === item.id
                  ? 'bg-white/[0.08] text-white'
                  : 'text-white/55 hover:bg-white/[0.04] hover:text-white/90'
              }`}
            >
              <span
                className={`w-0.5 h-4 rounded-full flex-shrink-0 ${
                  stage === item.id ? 'bg-[#0A84FF]' : 'bg-transparent'
                }`}
              />
              {item.icon}
              <span className="flex-1 text-left">{item.label}</span>
              {item.count !== undefined && item.count > 0 && (
                <span className="text-[10px] font-mono font-medium px-1.5 py-0.5 rounded-full bg-white/[0.08] text-white/55">
                  {item.count}
                </span>
              )}
            </button>
          ))}
        </nav>
        )}

        {/* 中央工作区（剪辑台阶段为全幅 AE 式布局，无滚动边距） */}
        <main
          className={
            stage === 'timeline'
              ? 'flex-1 min-w-0 min-h-0 flex flex-col'
              : 'flex-1 min-w-0 overflow-y-auto p-6'
          }
        >
          {formError && (
            <div
              data-testid="studio-form-error"
              className="max-w-3xl mx-auto mb-4 flex items-center gap-2 text-sm text-[#FF453A] bg-[#FF453A]/10 border border-[#FF453A]/30 rounded-xl px-4 py-2.5"
            >
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              {formError}
            </div>
          )}

          {/* 导演台阶段：整理 / 审核 / 补缺本项目资产 */}
          {stage === 'director' && (
            <DirectorDesk
              projectId={selectedProjectId.trim()}
              providers={providers}
              onSendToTimeline={handleSendToTimeline}
            />
          )}

          {/* 剪辑台阶段：AE 式布局（补充素材 bin + 节目监视器 + clip 检查器 + 时间线） */}
          {stage === 'timeline' && (
            <div
              className="flex-1 min-h-0 flex flex-col text-white/90"
              data-testid="studio-timeline"
            >
              <div className="flex flex-1 min-h-0">
                <AssetBin
                  assets={tlLibraryAssets}
                  loading={tlAssetsLoading}
                  addedIds={tlAssetIds}
                  onAdd={addToTimeline}
                />
                <ProgramMonitor items={timeline} playback={tlPlayback} />
                <ClipInspector
                  items={timeline}
                  selectedIndex={selectedClipIndex}
                  totalSec={tlTotalSec}
                  arranging={arranging}
                  exporting={tlExporting}
                  exportResult={tlExportResult}
                  storyHint={storyHint}
                  onStoryHintChange={setStoryHint}
                  filmTitle={filmTitle}
                  onFilmTitleChange={setFilmTitle}
                  onSetSec={setTlItemSec}
                  onSetCaption={setTlItemCaption}
                  onMove={moveTlItem}
                  onRemove={removeTlItem}
                  onArrange={handleArrange}
                  onExport={handleTlExport}
                />
              </div>
              <TimelineEditor
                items={timeline}
                playback={tlPlayback}
                selectedIndex={selectedClipIndex}
                onSelect={setSelectedClipIndex}
                onResize={setTlItemSec}
                pxPerSec={pxPerSec}
                onPxPerSecChange={setPxPerSec}
              />
              {/* 快捷键提示条 */}
              <div
                data-testid="studio-tl-shortcut-hint"
                className="flex-shrink-0 border-t border-white/[0.05] px-3 py-1 text-[10px] text-white/35"
              >
                {t('studioTlShortcutHint')}
              </div>
            </div>
          )}

          {/* 成片库阶段：项目视频类资产网格（剪辑台导出后登记入库） */}
          {stage === 'episode' && (
            <div className="max-w-4xl mx-auto flex flex-col gap-6">
              {filmsLoading ? (
                <Loader2 className="w-5 h-5 text-[#0A84FF] animate-spin" />
              ) : films.length === 0 ? (
                <div className="flex flex-col items-center justify-center text-center py-24 gap-4">
                  <div className="w-14 h-14 rounded-2xl bg-white/[0.06] p-4 flex items-center justify-center">
                    <Film className="w-6 h-6 text-white/45" />
                  </div>
                  <div className="text-[15px] font-semibold text-white/90">
                    {t('studioStageEpisode')}
                  </div>
                  <p className="text-xs text-white/45 max-w-[280px]" data-testid="studio-film-empty">
                    {t('studioFilmEmpty')}
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-5" data-testid="studio-film-grid">
                  {films.map((a) => (
                    <div
                      key={a.id}
                      data-testid={`studio-film-${a.id}`}
                      className={`${panelCls} p-3 flex flex-col gap-3`}
                    >
                      <video controls src={a.url!} className="w-full rounded-2xl bg-black" />
                      <div className="flex items-center gap-3 px-1 pb-1">
                        <div className="flex-1 min-w-0 text-sm font-semibold text-white/90 truncate">
                          {a.title || a.name}
                        </div>
                        <a
                          href={a.url!}
                          download
                          className="inline-flex items-center gap-1.5 flex-shrink-0 px-3 py-1.5 rounded-full bg-[#0A84FF] text-white text-xs font-medium hover:bg-[#0A84FF]/90 active:scale-[0.98] transition-all"
                        >
                          <Download className="w-3.5 h-3.5" />
                          {t('studioDownload')}
                        </a>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </main>
      </div>
    </div>
  );
};

export default StudioPanel;
