/**
 * ClipInspector — 剪辑台 clip 检查器（替代时间线阶段的全局检查器）。
 *
 * 无面板边框盒，改为分区段布局：11px white/45 区段标签 + 内容，区距 space-y-6，
 * 区间用 white/[0.05] 细分割线。
 * 顶部常驻序列统计（studio-tl-stats）。
 * 选中 clip：缩略图 / 名称 / 字幕 / 秒数编辑 / 上移 / 下移 / 移除。
 * 未选中：序列汇总提示 + 故事线索（可选，智能编排用）+ 成片标题（可选，导出用）+
 * 智能编排（全宽玻璃胶囊）+ 导出成片（全宽蓝色胶囊）+ 导出结果视频与下载链接
 * （导出成功后提示已存入成片库）。
 */
import React from 'react';
import {
  ArrowDown,
  ArrowUp,
  CheckCircle,
  Download,
  Loader2,
  Sparkles,
  X,
} from 'lucide-react';
import { StudioExportOut } from '../../services/apiClient';
import { useI18n } from '../../i18n';
import { TimelineItem } from './types';
import { formatSec } from './timecode';
import { appleActionBtn, appleLabel } from './theme';

interface ClipInspectorProps {
  items: TimelineItem[];
  /** 选中 clip 下标（-1 = 未选中）。 */
  selectedIndex: number;
  totalSec: number;
  arranging: boolean;
  exporting: boolean;
  exportResult: StudioExportOut | null;
  /** 智能编排的可选故事线索。 */
  storyHint: string;
  onStoryHintChange: (v: string) => void;
  /** 导出成片标题（可选）。 */
  filmTitle: string;
  onFilmTitleChange: (v: string) => void;
  onSetSec: (index: number, sec: number) => void;
  onSetCaption: (index: number, caption: string) => void;
  onMove: (index: number, dir: -1 | 1) => void;
  onRemove: (index: number) => void;
  onArrange: () => void;
  onExport: () => void;
}

const actionBtnCls = appleActionBtn;
// 检查器小号输入框：填充式（白 6% 底、无边框），focus 蓝色光环
const fieldCls =
  'w-full bg-white/[0.06] rounded-xl px-2.5 py-1.5 text-xs text-white/90 ' +
  'focus:outline-none focus:ring-2 focus:ring-[#0A84FF]/40 transition-all placeholder:text-white/30';

export const ClipInspector: React.FC<ClipInspectorProps> = ({
  items,
  selectedIndex,
  totalSec,
  arranging,
  exporting,
  exportResult,
  storyHint,
  onStoryHintChange,
  filmTitle,
  onFilmTitleChange,
  onSetSec,
  onSetCaption,
  onMove,
  onRemove,
  onArrange,
  onExport,
}) => {
  const { t } = useI18n();
  const item = selectedIndex >= 0 && selectedIndex < items.length ? items[selectedIndex] : null;

  return (
    <aside
      data-testid="studio-clip-inspector"
      className="w-[280px] flex-shrink-0 border-l border-white/[0.05] bg-white/[0.02] overflow-y-auto p-5 flex flex-col gap-6"
    >
      {/* 序列统计（常驻） */}
      <div className="text-xs text-white/45 font-mono" data-testid="studio-tl-stats">
        {t('studioTlStats')
          .replace('{n}', String(items.length))
          .replace('{total}', formatSec(totalSec))}
      </div>

      {item ? (
        <>
          {/* 选中 clip 区段 */}
          <section className="flex flex-col gap-3 pt-6 border-t border-white/[0.05]">
            <div className="text-[11px] font-medium text-white/45">
              {t('studioTlSelectedClip')}
            </div>
            <img
              src={item.asset.url!}
              alt={item.asset.title || item.asset.name}
              className="w-full aspect-video rounded-xl object-cover bg-black/40"
            />
            <div className="text-[13px] font-semibold text-white/90 truncate">
              {item.asset.title || item.asset.name}
            </div>

            <div>
              <label className={appleLabel}>
                {t('studioTlCaption')}
              </label>
              <input
                data-testid={`studio-tl-caption-${selectedIndex}`}
                className={fieldCls}
                value={item.caption}
                onChange={(e) => onSetCaption(selectedIndex, e.target.value)}
              />
            </div>

            <div>
              <label className={appleLabel}>
                {t('studioTlSec')}
              </label>
              <input
                type="number"
                min={1}
                max={60}
                data-testid={`studio-tl-sec-${selectedIndex}`}
                className={`${fieldCls} !w-20 font-mono text-center`}
                value={item.sec}
                onChange={(e) => onSetSec(selectedIndex, Number(e.target.value))}
              />
            </div>

            <div className="flex items-center gap-1">
              <button
                data-testid={`studio-tl-up-${selectedIndex}`}
                title={t('studioTlMoveUp')}
                onClick={() => onMove(selectedIndex, -1)}
                disabled={selectedIndex === 0}
                className="p-1.5 rounded-lg text-white/45 hover:bg-white/[0.08] hover:text-white/90 transition-all disabled:opacity-30 disabled:cursor-not-allowed"
              >
                <ArrowUp className="w-3.5 h-3.5" />
              </button>
              <button
                data-testid={`studio-tl-down-${selectedIndex}`}
                title={t('studioTlMoveDown')}
                onClick={() => onMove(selectedIndex, 1)}
                disabled={selectedIndex === items.length - 1}
                className="p-1.5 rounded-lg text-white/45 hover:bg-white/[0.08] hover:text-white/90 transition-all disabled:opacity-30 disabled:cursor-not-allowed"
              >
                <ArrowDown className="w-3.5 h-3.5" />
              </button>
              <button
                data-testid={`studio-tl-remove-${selectedIndex}`}
                title={t('studioTlRemove')}
                onClick={() => onRemove(selectedIndex)}
                className="p-1.5 rounded-lg text-white/45 hover:bg-[#FF453A]/10 hover:text-[#FF453A] transition-all"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </section>
        </>
      ) : (
        <>
          {/* 序列汇总区段 */}
          <section className="pt-6 border-t border-white/[0.05]">
            {items.length === 0 ? (
              <p className="text-xs text-white/45" data-testid="studio-tl-empty">
                {t('studioTlEmpty')}
              </p>
            ) : (
              <p className="text-xs text-white/45">{t('studioTlNoSelection')}</p>
            )}
          </section>

          {/* 智能编排区段 */}
          <section className="flex flex-col gap-2 pt-6 border-t border-white/[0.05]">
            <div>
              <label className={appleLabel}>
                {t('studioStoryHint')}
              </label>
              <input
                data-testid="studio-story-hint-input"
                className={fieldCls}
                value={storyHint}
                placeholder={t('studioStoryHintPlaceholder')}
                onChange={(e) => onStoryHintChange(e.target.value)}
              />
            </div>
            <button
              data-testid="studio-arrange-btn"
              onClick={onArrange}
              disabled={arranging || items.length < 2}
              className={`${actionBtnCls} w-full justify-center py-2.5 bg-white/[0.08] text-white/80 hover:bg-white/[0.12]`}
            >
              {arranging ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  {t('studioTlArranging')}
                </>
              ) : (
                <>
                  <Sparkles className="w-3.5 h-3.5" />
                  {t('studioTlArrange')}
                </>
              )}
            </button>
            <p className="text-[10px] text-white/35 -mt-1">{t('studioTlArrangeHint')}</p>
          </section>

          {/* 导出成片区段 */}
          <section className="flex flex-col gap-2 pt-6 border-t border-white/[0.05]">
            <div>
              <label className={appleLabel}>
                {t('studioTlFilmTitle')}
              </label>
              <input
                data-testid="studio-film-title-input"
                className={fieldCls}
                value={filmTitle}
                placeholder={t('studioTlFilmTitlePlaceholder')}
                onChange={(e) => onFilmTitleChange(e.target.value)}
              />
            </div>
            <button
              data-testid="studio-tl-export-btn"
              onClick={onExport}
              disabled={exporting || items.length === 0}
              className={`${actionBtnCls} w-full justify-center py-2.5 bg-[#0A84FF] text-white hover:bg-[#0A84FF]/90`}
            >
              {exporting ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  {t('studioExporting')}
                </>
              ) : (
                <>
                  <Download className="w-3.5 h-3.5" />
                  {t('studioTlExport')}
                </>
              )}
            </button>
            <p className="text-[10px] text-white/35 -mt-1">{t('studioTlExportHint')}</p>
          </section>

          {exportResult && (
            <section className="flex flex-col gap-2 pt-6 border-t border-white/[0.05]">
              <div className="flex items-center gap-2 text-xs font-medium text-[#30D158]">
                <CheckCircle className="w-3.5 h-3.5" />
                {t('studioResultReady')}
              </div>
              <p className="text-[10px] text-[#30D158]/80" data-testid="studio-tl-export-saved">
                {t('studioTlExportSaved')}
              </p>
              <video
                data-testid="studio-tl-video"
                controls
                src={exportResult.url}
                className="w-full rounded-xl bg-black"
              />
              <a
                data-testid="studio-tl-download"
                href={exportResult.url}
                download
                className="inline-flex items-center gap-2 self-start px-3 py-1.5 rounded-full bg-[#0A84FF] text-white text-xs font-medium hover:bg-[#0A84FF]/90 active:scale-[0.98] transition-all"
              >
                <Download className="w-3.5 h-3.5" />
                {t('studioDownload')}
              </a>
            </section>
          )}
        </>
      )}
    </aside>
  );
};
