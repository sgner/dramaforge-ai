/**
 * TransportBar — 剪辑台走带栏（监视器与时间线之间的独立一行，图2 底栏形态）。
 *
 * 左侧：上一镜头 / 播放暂停 / 下一镜头 + JetBrains Mono 时间码（mm:ss / mm:ss）；
 * 中部：播放速度（占位视觉，1x）；右侧：Split / Fit / 设置（占位视觉，分割逻辑未接入）。
 * 播放控制 testid（studio-play-prev / studio-play-btn / studio-play-next / studio-timecode）
 * 从节目监视器的浮动胶囊迁到本栏，全应用 DOM 中各出现一次。
 */
import React from 'react';
import {
  ChevronDown,
  Maximize,
  Pause,
  Play,
  Scissors,
  Settings,
  SkipBack,
  SkipForward,
} from 'lucide-react';
import { useI18n } from '../../i18n';
import { SequencePlayback } from './use-sequence-playback';
import { formatSec } from './timecode';

interface TransportBarProps {
  playback: SequencePlayback;
  /** 时间线为空时禁用播放控制。 */
  disabled: boolean;
}

const iconBtnCls =
  'w-7 h-7 rounded-md text-white/55 hover:bg-white/[0.08] hover:text-white/90 ' +
  'flex items-center justify-center transition-all disabled:opacity-30 disabled:cursor-not-allowed';

export const TransportBar: React.FC<TransportBarProps> = ({ playback, disabled }) => {
  const { t } = useI18n();
  const { playTime, playing, total } = playback;

  return (
    <div className="h-11 flex-shrink-0 border-t border-white/[0.07] bg-[#0F0F12] flex items-center gap-1.5 px-3">
      {/* 左：播放控制 + 时间码 */}
      <button
        data-testid="studio-play-prev"
        title={t('studioTlPrevClip')}
        onClick={() => playback.stepClip(-1)}
        disabled={disabled}
        className={iconBtnCls}
      >
        <SkipBack className="w-3.5 h-3.5" />
      </button>
      <button
        data-testid="studio-play-btn"
        title={playing ? t('studioTlPause') : t('studioTlPlay')}
        onClick={playback.toggle}
        disabled={disabled}
        className="w-8 h-8 rounded-full bg-[#6E6BF2] text-white hover:bg-[#817FF5] active:scale-[0.98] flex items-center justify-center transition-all disabled:opacity-30 disabled:cursor-not-allowed"
      >
        {playing ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5 ml-px" />}
      </button>
      <button
        data-testid="studio-play-next"
        title={t('studioTlNextClip')}
        onClick={() => playback.stepClip(1)}
        disabled={disabled}
        className={iconBtnCls}
      >
        <SkipForward className="w-3.5 h-3.5" />
      </button>
      <span
        data-testid="studio-timecode"
        className="ml-2 text-xs font-mono text-white/70 tabular-nums"
      >
        {formatSec(playTime)} / {formatSec(total)}
      </span>

      {/* 中：播放速度（占位视觉） */}
      <div className="flex-1 flex items-center justify-center">
        <button
          type="button"
          title={t('studioTlSpeed')}
          className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-medium text-white/55 hover:bg-white/[0.08] hover:text-white/90 transition-all"
        >
          <span className="text-white/35">{t('studioTlSpeed')}</span>
          <span className="font-mono text-white/80">1x</span>
          <ChevronDown className="w-3 h-3 text-white/35" />
        </button>
      </div>

      {/* 右：Split / Fit / 设置（占位视觉） */}
      <button
        type="button"
        title={t('studioTlSplit')}
        className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-medium text-white/55 hover:bg-white/[0.08] hover:text-white/90 transition-all"
      >
        <Scissors className="w-3.5 h-3.5" />
        {t('studioTlSplit')}
      </button>
      <button type="button" title={t('studioTlFit')} className={iconBtnCls}>
        <Maximize className="w-3.5 h-3.5" />
      </button>
      <button type="button" title={t('studioTlSettings')} className={iconBtnCls}>
        <Settings className="w-3.5 h-3.5" />
      </button>
    </div>
  );
};
