/**
 * TimelineEditor — 剪辑台时间线：秒刻度标尺 + 红色 playhead + 多轨轨道区（Runway 图2 形态）。
 *
 * 标尺：秒刻度（密度随 pxPerSec），点击/拖动 seek（原生 pointer events）。
 * playhead：红色竖线 + 顶部圆点把手，随 playTime 移动。
 * V1 视频轨：clip 块按资产类型着色（视频 #8B7CF6 / 图像素材 #E8738C），
 *   宽 = sec × pxPerSec，点击选中（再次点击取消，accent 描边），
 *   右缘拖动调时长（步进 0.5s，clamp 1~15s）。
 * A1 音轨（绿 #4CC38A）/ 字幕轨（黄 #E5C77E）：着色占位轨（即将支持）。
 * 顶部缩放控制：pxPerSec 受控（状态在 StudioPanel，供全局快捷键 +/- 共用），默认 24，范围 6~120。
 */
import React, { useRef } from 'react';
import { Film, Image as ImageIcon, Minus, Plus } from 'lucide-react';
import { useI18n } from '../../i18n';
import { isVideoAsset, TimelineItem } from './types';
import { SequencePlayback } from './use-sequence-playback';
import { formatSec } from './timecode';
import { PLAYHEAD_RED, TRACK_COLORS } from './theme';

export const MIN_PX_PER_SEC = 6;
export const MAX_PX_PER_SEC = 120;
export const DEFAULT_PX_PER_SEC = 24;
/** 缩放步进（按钮 / 快捷键共用）。 */
export const PX_PER_SEC_STEP = 6;

/** clip 时长拖动限制。 */
const MIN_CLIP_SEC = 1;
const MAX_CLIP_SEC = 15;

interface TimelineEditorProps {
  items: TimelineItem[];
  playback: SequencePlayback;
  /** 选中 clip 下标（-1 = 未选中）。 */
  selectedIndex: number;
  onSelect: (index: number) => void;
  onResize: (index: number, sec: number) => void;
  /** 受控缩放（px/秒），快捷键 +/- 与缩放控件共用。 */
  pxPerSec: number;
  onPxPerSecChange: (v: number) => void;
}

/** 按 pxPerSec 选刻度步长，保证刻度间距不至于过密。 */
const tickStep = (pxPerSec: number): number => {
  for (const step of [1, 2, 5, 10, 30, 60]) {
    if (step * pxPerSec >= 48) return step;
  }
  return 120;
};

export const TimelineEditor: React.FC<TimelineEditorProps> = ({
  items,
  playback,
  selectedIndex,
  onSelect,
  onResize,
  pxPerSec,
  onPxPerSecChange,
}) => {
  const { t } = useI18n();
  const rulerRef = useRef<HTMLDivElement | null>(null);

  const total = playback.total;
  // 空序列也给一段标尺，方便观察
  const displayTotal = Math.max(total, 10);
  const step = tickStep(pxPerSec);
  const ticks: number[] = [];
  for (let s = 0; s <= displayTotal + 0.001; s += step) ticks.push(s);

  /** 标尺点击/拖动 seek：x 坐标 → 秒。 */
  const seekAt = (clientX: number) => {
    const rect = rulerRef.current?.getBoundingClientRect();
    if (!rect) return;
    playback.seek((clientX - rect.left) / pxPerSec);
  };

  const handleRulerPointerDown = (e: React.PointerEvent) => {
    seekAt(e.clientX);
    const move = (ev: PointerEvent) => seekAt(ev.clientX);
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  /** clip 右缘拖动调时长：步进 0.5s，clamp 1~15s。 */
  const handleResizePointerDown = (e: React.PointerEvent, index: number) => {
    e.stopPropagation();
    const startX = e.clientX;
    const startSec = items[index].sec;
    const move = (ev: PointerEvent) => {
      const deltaSec = (ev.clientX - startX) / pxPerSec;
      const next = Math.round((startSec + deltaSec) * 2) / 2;
      onResize(index, Math.min(MAX_CLIP_SEC, Math.max(MIN_CLIP_SEC, next)));
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const zoomBy = (dir: -1 | 1) =>
    onPxPerSecChange(Math.min(MAX_PX_PER_SEC, Math.max(MIN_PX_PER_SEC, pxPerSec + dir * PX_PER_SEC_STEP)));

  /** 轨道标签：色点 + 名称。 */
  const trackLabel = (color: string, text: string, dim = false) => (
    <span
      className={`flex items-center gap-1.5 text-[10px] font-mono ${
        dim ? 'text-white/30' : 'text-white/50'
      }`}
    >
      <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: color }} />
      {text}
    </span>
  );

  return (
    <div
      className="h-52 flex-shrink-0 border-t border-white/[0.07] bg-[#0A0A0B] flex flex-col"
      data-testid="studio-timeline-editor"
    >
      {/* 缩放控制：右移的玻璃胶囊组 */}
      <div className="flex items-center justify-end px-3 h-9 flex-shrink-0">
        <div className="flex items-center gap-1.5 bg-white/[0.05] border border-white/[0.07] rounded-full px-2.5 py-1">
          <span className="text-[11px] font-medium text-white/45 pr-1">
            {t('studioTlZoom')}
          </span>
          <button
            data-testid="studio-tl-zoom-out"
            title={t('studioTlZoomOut')}
            onClick={() => zoomBy(-1)}
            className="p-1 rounded-full text-white/45 hover:bg-white/[0.08] hover:text-white/90 transition-all"
          >
            <Minus className="w-3 h-3" />
          </button>
          <input
            type="range"
            min={MIN_PX_PER_SEC}
            max={MAX_PX_PER_SEC}
            step={6}
            value={pxPerSec}
            data-testid="studio-tl-zoom"
            title={t('studioTlZoom')}
            onChange={(e) => onPxPerSecChange(Number(e.target.value))}
            className="w-24 accent-[#6E6BF2]"
          />
          <button
            data-testid="studio-tl-zoom-in"
            title={t('studioTlZoomIn')}
            onClick={() => zoomBy(1)}
            className="p-1 rounded-full text-white/45 hover:bg-white/[0.08] hover:text-white/90 transition-all"
          >
            <Plus className="w-3 h-3" />
          </button>
        </div>
      </div>

      <div className="flex-1 min-h-0 flex">
        {/* 轨道标签列：色点 + 小字 mono 标签 */}
        <div className="w-14 flex-shrink-0 flex flex-col items-center border-r border-white/[0.05]">
          <div className="h-6" />
          <div className="h-16 flex items-center">
            {trackLabel(TRACK_COLORS.video, t('studioTlTrackVideo'))}
          </div>
          <div className="h-8 flex items-center">
            {trackLabel(TRACK_COLORS.audio, t('studioTlTrackAudio'), true)}
          </div>
          <div className="h-8 flex items-center">
            {trackLabel(TRACK_COLORS.subtitle, t('studioTlTrackSubtitle'), true)}
          </div>
        </div>

        {/* 标尺 + 轨道（横向滚动） */}
        <div className="flex-1 min-w-0 overflow-x-auto">
          <div className="relative" style={{ width: displayTotal * pxPerSec }}>
            {/* 标尺：主线 white/15，数字 10px white/35 */}
            <div
              ref={rulerRef}
              data-testid="studio-tl-ruler"
              onPointerDown={handleRulerPointerDown}
              className="relative h-6 border-b border-white/[0.07] cursor-pointer select-none"
            >
              {ticks.map((s) => (
                <div
                  key={s}
                  className="absolute top-0 bottom-0 border-l border-white/15"
                  style={{ left: s * pxPerSec }}
                >
                  <span className="absolute top-0.5 left-1 text-[10px] font-mono text-white/35">
                    {formatSec(s)}
                  </span>
                </div>
              ))}
            </div>

            {/* V1 视频轨：clip 块按资产类型着色 */}
            <div
              data-testid="studio-track-v1"
              className="relative h-16 border-b border-white/[0.07] flex items-center px-0.5"
            >
              {items.map((it, i) => {
                const selected = i === selectedIndex;
                const video = isVideoAsset(it.asset);
                const color = video ? TRACK_COLORS.video : TRACK_COLORS.image;
                return (
                  <div
                    key={it.asset.id}
                    data-testid={`studio-tl-clip-${i}`}
                    onClick={() => onSelect(selected ? -1 : i)}
                    className={`relative h-[56px] flex-shrink-0 rounded-md overflow-hidden cursor-pointer border transition-shadow ${
                      selected
                        ? 'ring-2 ring-[#6E6BF2] shadow-[0_0_16px_rgba(110,107,242,0.35)]'
                        : 'hover:brightness-125'
                    }`}
                    style={{
                      width: it.sec * pxPerSec,
                      backgroundColor: `${color}2E`,
                      borderColor: `${color}80`,
                    }}
                  >
                    {/* 左侧色条 */}
                    <div
                      className="absolute left-0 top-0 bottom-0 w-[3px] pointer-events-none"
                      style={{ backgroundColor: color }}
                    />
                    {/* 名称 + 时长/字幕 */}
                    <div className="absolute inset-x-0 top-0 bottom-0 pl-2.5 pr-2 py-1 flex flex-col justify-between pointer-events-none">
                      <div className="flex items-center gap-1 min-w-0">
                        {video ? (
                          <Film className="w-2.5 h-2.5 flex-shrink-0" style={{ color }} />
                        ) : (
                          <ImageIcon className="w-2.5 h-2.5 flex-shrink-0" style={{ color }} />
                        )}
                        <div className="text-[10px] font-medium text-white/90 truncate">
                          {it.asset.title || it.asset.name}
                        </div>
                      </div>
                      <div className="text-[9px] font-mono text-white/55 truncate">
                        {it.sec}s
                        {it.caption && (
                          <span className="ml-1 font-sans text-white/45">{it.caption}</span>
                        )}
                      </div>
                    </div>
                    {/* 右缘拖动手柄 */}
                    <div
                      data-testid={`studio-tl-resize-${i}`}
                      onPointerDown={(e) => handleResizePointerDown(e, i)}
                      className="absolute top-0 right-0 bottom-0 w-2 cursor-ew-resize hover:bg-[#6E6BF2]/40"
                    />
                  </div>
                );
              })}
            </div>

            {/* A1 音轨 / 字幕轨（着色占位）：淡色块 */}
            <div className="h-8 border-b border-white/[0.07] flex items-stretch py-1">
              <div
                data-testid="studio-track-audio"
                className="flex-1 rounded-md border border-[#4CC38A]/25 bg-[#4CC38A]/10 flex items-center justify-center text-[10px] text-[#4CC38A]/70"
              >
                {t('studioTlTrackAudio')} · {t('studioTlComingSoon')}
              </div>
            </div>
            <div className="h-8 border-b border-white/[0.07] flex items-stretch py-1">
              <div
                data-testid="studio-track-subtitle"
                className="flex-1 rounded-md border border-[#E5C77E]/25 bg-[#E5C77E]/10 flex items-center justify-center text-[10px] text-[#E5C77E]/70"
              >
                {t('studioTlTrackSubtitle')} · {t('studioTlComingSoon')}
              </div>
            </div>

            {/* playhead：红细线 + 顶部圆点把手 */}
            <div
              data-testid="studio-playhead"
              className="absolute top-0 bottom-0 w-px pointer-events-none"
              style={{ left: playback.playTime * pxPerSec, backgroundColor: PLAYHEAD_RED }}
            >
              <div
                className="absolute top-0 -left-[4.5px] w-2.5 h-2.5 rounded-full"
                style={{ backgroundColor: PLAYHEAD_RED }}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
