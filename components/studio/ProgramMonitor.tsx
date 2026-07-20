/**
 * ProgramMonitor — 剪辑台节目监视器：按播放头预览时间线序列。
 *
 * 黑底 16:9 预览区是剪辑台的视觉主角：四周留呼吸空间，rounded-2xl + 内阴影
 * 模拟屏幕纵深；图片 clip 显示 <img>，视频 clip 显示 <video>，
 * clip 切换时 currentTime = playTime - clipStart，play/pause 与序列播放态同步。
 * 传输控制（上一镜头 / 播放暂停 / 下一镜头）+ mm:ss 时间码合并为一条
 * 悬浮玻璃胶囊，居中悬浮在监视器底部内侧。
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
      className="flex-1 min-w-0 flex flex-col outline-none"
    >
      {/* 预览区：监视器为主角，四周留呼吸空间 */}
      <div className="flex-1 min-h-0 flex items-center justify-center px-6 py-6">
        <div className="relative w-full max-w-[720px] aspect-video bg-black rounded-2xl shadow-[inset_0_1px_0_rgba(255,255,255,0.04),inset_0_-24px_48px_rgba(0,0,0,0.6)] overflow-hidden flex items-center justify-center">
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
              <div className="text-[15px] font-semibold text-white/90">
                {t('studioStageTimeline')}
              </div>
              <p className="text-xs text-white/45 max-w-[260px]">{t('studioTlMonitorEmpty')}</p>
            </div>
          )}

          {/* 浮动传输控制条：播放控制 + 时间码合并为一条悬浮玻璃胶囊 */}
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-2 backdrop-blur-xl bg-white/[0.08] rounded-full px-4 py-2">
            <button
              data-testid="studio-prev-btn"
              title={t('studioTlPrevClip')}
              onClick={() => playback.stepClip(-1)}
              disabled={items.length === 0}
              className="w-8 h-8 rounded-full bg-white/[0.08] hover:bg-white/[0.14] text-white/70 hover:text-white/90 flex items-center justify-center transition-all disabled:opacity-30 disabled:cursor-not-allowed"
            >
              <SkipBack className="w-3.5 h-3.5" />
            </button>
            <button
              data-testid="studio-play-btn"
              title={playing ? t('studioTlPause') : t('studioTlPlay')}
              onClick={playback.toggle}
              disabled={items.length === 0}
              className="w-11 h-11 rounded-full bg-[#0A84FF] text-white hover:bg-[#0A84FF]/90 active:scale-[0.98] flex items-center justify-center transition-all disabled:opacity-30 disabled:cursor-not-allowed"
            >
              {playing ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
            </button>
            <button
              data-testid="studio-next-btn"
              title={t('studioTlNextClip')}
              onClick={() => playback.stepClip(1)}
              disabled={items.length === 0}
              className="w-8 h-8 rounded-full bg-white/[0.08] hover:bg-white/[0.14] text-white/70 hover:text-white/90 flex items-center justify-center transition-all disabled:opacity-30 disabled:cursor-not-allowed"
            >
              <SkipForward className="w-3.5 h-3.5" />
            </button>
            <span
              data-testid="studio-timecode"
              className="ml-2 text-xs font-mono text-white/70 tabular-nums"
            >
              {formatSec(playTime)} / {formatSec(total)}
            </span>
          </div>
        </div>
      </div>
    </section>
  );
};
