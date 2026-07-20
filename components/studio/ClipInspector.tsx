/**
 * ClipInspector — 剪辑台 clip 检查器（Runway 图2 右侧 Inspector 形态）。
 *
 * 分区可折叠（默认展开）：12px muted 分区标题 + chevron，区间 white/[0.07] 细分割线。
 * 顶部常驻序列统计（studio-tl-stats）。
 * Transform：Position / Size / Rotation 双列数值输入（展示态，无持久化数据，只读）。
 * 选中 clip：缩略图 / 名称 / 字幕 / 秒数编辑 / 上移 / 下移 / 移除（沿用现有逻辑）。
 * 未选中：序列汇总提示 + 故事线索（可选，智能编排用）+ 成片标题（可选，导出用）+
 * 智能编排 + 导出成片（accent 实心）+ 导出结果视频与下载链接（提示已存入成片库）。
 * Audio：Volume 滑条（视觉占位，无音频数据）。
 */
import React, { useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  CheckCircle,
  ChevronDown,
  Download,
  Loader2,
  Sparkles,
  Volume2,
  X,
} from 'lucide-react';
import { StudioExportOut } from '../../services/apiClient';
import { useI18n } from '../../i18n';
import { TimelineItem } from './types';
import { formatSec } from './timecode';
import { appleActionBtn, appleLabel, studioPrimaryBtn } from './theme';

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
// 检查器小号输入框：填充式（白 6% 底、无边框），focus 蓝紫光环
const fieldCls =
  'w-full bg-white/[0.06] rounded-lg px-2.5 py-1.5 text-xs text-[#F5F5F7] ' +
  'focus:outline-none focus:ring-2 focus:ring-[#6E6BF2]/40 transition-all placeholder:text-white/30';

/** 可折叠分区（默认展开）：12px muted 标题 + chevron。 */
const Section: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => {
  const [open, setOpen] = useState(true);
  return (
    <section className="flex flex-col gap-3 pt-4 border-t border-white/[0.07]">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 text-[12px] font-medium text-white/45 hover:text-white/70 transition-all"
      >
        <ChevronDown
          className={`w-3.5 h-3.5 transition-transform ${open ? '' : '-rotate-90'}`}
        />
        {title}
      </button>
      {open && children}
    </section>
  );
};

/** Transform 数值行：标签 + 双列只读数值输入（展示态，无持久化）。 */
const TransformRow: React.FC<{ label: string; values: number[]; suffix?: string }> = ({
  label,
  values,
  suffix,
}) => (
  <div className="flex items-center gap-2">
    <span className="w-16 flex-shrink-0 text-[11px] text-white/45">{label}</span>
    <div className={`flex-1 grid gap-1.5 ${values.length > 1 ? 'grid-cols-2' : 'grid-cols-1'}`}>
      {values.map((v, i) => (
        <div key={i} className="relative">
          <input
            type="number"
            readOnly
            value={v}
            className={`${fieldCls} !px-2 font-mono text-center text-white/60`}
          />
          {suffix && (
            <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-white/30 pointer-events-none">
              {suffix}
            </span>
          )}
        </div>
      ))}
    </div>
  </div>
);

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
      className="w-[280px] flex-shrink-0 border-l border-white/[0.07] bg-[#0F0F12] overflow-y-auto p-4 flex flex-col gap-5"
    >
      {/* 序列统计（常驻） */}
      <div className="text-xs text-white/45 font-mono" data-testid="studio-tl-stats">
        {t('studioTlStats')
          .replace('{n}', String(items.length))
          .replace('{total}', formatSec(totalSec))}
      </div>

      {/* Transform（展示态分区：Position / Size / Rotation 双列数值） */}
      <Section title={t('studioTlTransform')}>
        <div className="flex flex-col gap-2">
          <TransformRow label={t('studioTlPosition')} values={[0, 0]} />
          <TransformRow label={t('studioTlSize')} values={[1920, 1080]} />
          <TransformRow label={t('studioTlRotation')} values={[0]} suffix="°" />
        </div>
      </Section>

      {item ? (
        /* 选中 clip 区段 */
        <Section title={t('studioTlSelectedClip')}>
          <img
            src={item.asset.url!}
            alt={item.asset.title || item.asset.name}
            className="w-full aspect-video rounded-lg object-cover bg-black/40"
          />
          <div className="text-[13px] font-semibold text-[#F5F5F7] truncate">
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
              className="p-1.5 rounded-lg text-white/45 hover:bg-[#F26161]/10 hover:text-[#F26161] transition-all"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </Section>
      ) : (
        <>
          {/* 序列汇总区段 */}
          <section className="pt-4 border-t border-white/[0.07]">
            {items.length === 0 ? (
              <p className="text-xs text-white/45" data-testid="studio-tl-empty">
                {t('studioTlEmpty')}
              </p>
            ) : (
              <p className="text-xs text-white/45">{t('studioTlNoSelection')}</p>
            )}
          </section>

          {/* 智能编排区段 */}
          <section className="flex flex-col gap-2 pt-4 border-t border-white/[0.07]">
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
          <section className="flex flex-col gap-2 pt-4 border-t border-white/[0.07]">
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
              className={`${actionBtnCls} w-full justify-center py-2.5 ${studioPrimaryBtn}`}
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
            <section className="flex flex-col gap-2 pt-4 border-t border-white/[0.07]">
              <div className="flex items-center gap-2 text-xs font-medium text-[#3ECF8E]">
                <CheckCircle className="w-3.5 h-3.5" />
                {t('studioResultReady')}
              </div>
              <p className="text-[10px] text-[#3ECF8E]/80" data-testid="studio-tl-export-saved">
                {t('studioTlExportSaved')}
              </p>
              <video
                data-testid="studio-tl-video"
                controls
                src={exportResult.url}
                className="w-full rounded-lg bg-black"
              />
              <a
                data-testid="studio-tl-download"
                href={exportResult.url}
                download
                className="inline-flex items-center gap-2 self-start px-3 py-1.5 rounded-full bg-[#6E6BF2] text-white text-xs font-medium hover:bg-[#817FF5] active:scale-[0.98] transition-all"
              >
                <Download className="w-3.5 h-3.5" />
                {t('studioDownload')}
              </a>
            </section>
          )}
        </>
      )}

      {/* Audio（视觉占位分区：Volume 滑条） */}
      <Section title={t('studioTlAudio')}>
        <div className="flex items-center gap-2">
          <Volume2 className="w-3.5 h-3.5 text-white/40 flex-shrink-0" />
          <span className="w-12 flex-shrink-0 text-[11px] text-white/45">
            {t('studioTlVolume')}
          </span>
          <input
            type="range"
            min={0}
            max={100}
            defaultValue={100}
            className="flex-1 accent-[#6E6BF2]"
          />
        </div>
      </Section>
    </aside>
  );
};
