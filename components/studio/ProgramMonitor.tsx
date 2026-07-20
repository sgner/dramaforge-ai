/**
 * ProgramMonitor — 剪辑台节目监视器：按播放头预览时间线序列。
 *
 * 纯黑视口是剪辑台的视觉主角：四周留呼吸空间，图片 clip 显示 <img>，
 * 视频 clip 显示 <video>，clip 切换时 currentTime = playTime - clipStart，
 * play/pause 与序列播放态同步。
 * 底部内侧悬浮一条 glass 播放胶囊（⏮ ▶ ⏭ + mono 时间码，玻璃拟态）；
 * 带 testid 的走带控制已迁至 TransportBar（监视器与时间线之间的独立一行），
 * 胶囊保留为同一播放模型的可视化副本（无 testid，行为一致）。
 * 空格键播放/暂停由剪辑台全局快捷键（use-timeline-shortcuts）统一处理，本组件不再监听。
 */
import React, { useEffect, useRef } from 'react';
import { Clapperboard, Pause, Play, SkipBack, SkipForward } from 'lucide-react';
import { useI18n } from '../../i18n';
import { isVideoAsset, TimelineItem } from './types';
import { SequencePlayback } from './use-sequence-playback';
import { formatSec } from './timecode';

interface ProgramMonitorProps {
  items: TimelineItem[];
  playback: SequencePlayback;
}

export const ProgramMonitor: React.FC<ProgramMonitorProps> = ({ items, playback }) => {
  const { t } = useI18n();
  const videoRef = useRef<HTMLVideoElement | null>(null);

  const { playTime, playing, currentIndex, clipStart, total } = playback;
  const current = currentIndex >= 0 ? items[currentIndex] : null;
  const currentIsVideo = current ? isVideoAsset(current.asset) : false;

  // clip 切换时对齐视频进度
  useEffect(() => {
    const v = videoRef.current;
    if (!v || !current) return;
    v.currentTime = Math.max(0, playTime - clipStart);
    // 仅在 clip 切换时对齐，避免播放过程中反复 seek
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentIndex, clipStart]);

  // 序列播放态同步到 <video>（jsdom 无真实媒体播放，全部做可选链兜底）
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    if (playing) {
      const p = v.play?.();
      p?.catch?.(() => {});
    } else {
      v.pause?.();
    }
  }, [playing, currentIndex]);

  return (
    <section
      data-testid="studio-monitor"
      className="flex-1 min-w-0 flex flex-col outline-none bg-[#0A0A0B]"
    >
      {/* 预览区：纯黑视口，四周留呼吸空间 */}
      <div className="flex-1 min-h-0 flex items-center justify-center px-6 py-5">
        <div className="relative w-full max-w-[760px] aspect-video bg-black rounded-xl border border-white/[0.07] overflow-hidden flex items-center justify-center">
          {current ? (
            currentIsVideo ? (
              <video
                ref={videoRef}
                src={current.asset.url!}
                muted
                className="w-full h-full object-contain"
                data-testid="studio-monitor-video"
              />
            ) : (
              <img
                src={current.asset.url!}
                alt={current.asset.title || current.asset.name}
                className="w-full h-full object-contain"
              />
            )
          ) : (
            /* 空态：玻璃图标 + 标题 + 副文案 */
            <div className="flex flex-col items-center text-center gap-3 px-6 pb-10">
              <div className="w-14 h-14 rounded-2xl bg-white/[0.06] p-4 flex items-center justify-center">
                <Clapperboard className="w-6 h-6 text-white/45" />
              </div>
              <div className="text-[15px] font-semibold text-[#F5F5F7]">
                {t('studioStageTimeline')}
              </div>
              <p className="text-xs text-white/45 max-w-[260px]">{t('studioTlMonitorEmpty')}</p>
            </div>
          )}

          {/* 浮动播放胶囊：glass 拟态（走带栏的可视化副本，无 testid） */}
          <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex items-center gap-1.5 backdrop-blur-xl bg-black/50 border border-white/[0.1] rounded-full px-3 py-1.5 shadow-[0_8px_24px_rgba(0,0,0,0.45)]">
            <button
              type="button"
              title={t('studioTlPrevClip')}
              onClick={() => playback.stepClip(-1)}
              disabled={items.length === 0}
              className="w-6 h-6 rounded-full text-white/60 hover:bg-white/[0.12] hover:text-white/90 flex items-center justify-center transition-all disabled:opacity-30 disabled:cursor-not-allowed"
            >
              <SkipBack className="w-3 h-3" />
            </button>
            <button
              type="button"
              title={playing ? t('studioTlPause') : t('studioTlPlay')}
              onClick={playback.toggle}
              disabled={items.length === 0}
              className="w-8 h-8 rounded-full bg-[#6E6BF2] text-white hover:bg-[#817FF5] active:scale-[0.98] flex items-center justify-center transition-all disabled:opacity-30 disabled:cursor-not-allowed"
            >
              {playing ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5 ml-px" />}
            </button>
            <button
              type="button"
              title={t('studioTlNextClip')}
              onClick={() => playback.stepClip(1)}
              disabled={items.length === 0}
              className="w-6 h-6 rounded-full text-white/60 hover:bg-white/[0.12] hover:text-white/90 flex items-center justify-center transition-all disabled:opacity-30 disabled:cursor-not-allowed"
            >
              <SkipForward className="w-3 h-3" />
            </button>
            <span className="ml-1 text-[11px] font-mono text-white/65 tabular-nums">
              {formatSec(playTime)} / {formatSec(total)}
            </span>
          </div>
        </div>
      </div>
    </section>
  );
};
