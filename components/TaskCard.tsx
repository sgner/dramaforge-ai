import React, { useState, useRef, useCallback, useMemo } from 'react';
import { DramaTask, TaskStatus } from '../types';
import { Play, Loader2, Film, Trash2, Download, CheckCircle2, AlertCircle, Clock, Clapperboard } from 'lucide-react';
import { TiltCard } from './ambient/TiltCard';

interface Props {
  task: DramaTask;
  onClick: () => void;
  onDelete: () => void;
  onExport: () => void;
  /** 封面左下角"去工作室成片"按钮（hover 显示）。 */
  onOpenStudio?: () => void;
  t: (key: string) => string;
}

export const TaskCard: React.FC<Props> = ({ task, onClick, onDelete, onExport, onOpenStudio, t }) => {
  const [isHovering, setIsHovering] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);

  const videoUrl = task.bigShots.find(bs => bs.videoUrl)?.videoUrl;
  const isCompleted = task.status === TaskStatus.COMPLETED;
  const isFailed = task.status === TaskStatus.FAILED;
  const isProcessing = task.status !== TaskStatus.COMPLETED && task.status !== TaskStatus.IDLE && task.status !== TaskStatus.FAILED;

  /* 无封面项目：按 id 哈希取一张确定性暖色暗渐变 + 首字符，替代随机图床 */
  const placeholder = useMemo(() => {
    const PALETTES: [string, string][] = [
      ['#3A1C08', '#160A04'], // 琥珀棕
      ['#3B0F1E', '#170510'], // 品红暗紫
      ['#2B1226', '#100613'], // 紫罗兰
      ['#40100C', '#180606'], // 余烬红
      ['#1F1B2E', '#0B0A12'], // 冷夜蓝(兜底中性)
    ];
    let h = 0;
    for (let i = 0; i < task.id.length; i++) h = (h * 31 + task.id.charCodeAt(i)) >>> 0;
    const [from, to] = PALETTES[h % PALETTES.length];
    return { from, to, initial: (task.name || '?').trim().charAt(0).toUpperCase() };
  }, [task.id, task.name]);

  const getStatusDot = () => {
    if (isCompleted) return 'status-dot-completed';
    if (isFailed) return 'status-dot-failed';
    if (isProcessing) return 'status-dot-processing';
    return 'status-dot-idle';
  };

  const getStatusIcon = () => {
    if (isCompleted) return <CheckCircle2 className="w-3 h-3 text-[#3ECF8E]" />;
    if (isFailed) return <AlertCircle className="w-3 h-3 text-[#F26161]" />;
    if (isProcessing) return <Loader2 className="w-3 h-3 text-[#817FF5] animate-spin" />;
    return <Clock className="w-3 h-3 text-white/35" />;
  };

  const handleMouseEnter = useCallback(() => {
    setIsHovering(true);
  }, []);

  const handleMouseLeave = useCallback(() => {
    setIsHovering(false);
  }, []);

  const handleClick = useCallback(() => {
    onClick();
  }, [onClick]);

  return (
    <TiltCard className="group relative" onClick={handleClick}>
    <div
      ref={cardRef}
      className="relative rounded-[22px] overflow-hidden cursor-pointer transition-all duration-300 border border-white/[0.06] hover:border-white/[0.12] hover:shadow-[0_24px_64px_-20px_rgba(255,92,57,0.30)]"
      style={{ background: 'rgba(255,255,255,0.04)', backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)', boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.05)' }}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      {/* Cover 16:9 */}
      <div className="aspect-video relative bg-[#0A0A0B] overflow-hidden">
        {isHovering && isCompleted && videoUrl ? (
          <video
            src={videoUrl}
            autoPlay
            muted
            loop
            className="w-full h-full object-cover scale-105 transition-transform duration-500"
          />
        ) : task.coverImage ? (
          <img
            src={task.coverImage}
            alt={task.name}
            className="w-full h-full object-cover opacity-80 group-hover:opacity-100 group-hover:scale-105 transition-all duration-500"
          />
        ) : (
          /* 无封面：暖色暗渐变 + 首字符标记，与背景氛围同色 */
          <div
            className="w-full h-full flex items-center justify-center transition-transform duration-500 group-hover:scale-105"
            style={{ background: `linear-gradient(135deg, ${placeholder.from}, ${placeholder.to})` }}
          >
            <span className="text-[64px] font-bold leading-none text-white/[0.08] select-none tracking-tight">
              {placeholder.initial}
            </span>
            <Film className="absolute bottom-3 left-4 w-4 h-4 text-white/[0.14]" />
          </div>
        )}

        <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent pointer-events-none" />

        {/* Status badge：暗色语义色点 + 文字 */}
        <div className="absolute top-3 right-3 glass px-2.5 py-1 rounded-full text-[10px] font-mono uppercase tracking-wider z-10 text-white/60 flex items-center gap-1.5">
          <span className={`status-dot ${getStatusDot()}`}></span>
          {getStatusIcon()}
          {t(task.status)}
        </div>

        {/* Action buttons */}
        {onOpenStudio && (
          <button
            onClick={(e) => { e.stopPropagation(); onOpenStudio(); }}
            className="absolute bottom-3 left-3 px-3 py-1.5 cta-primary rounded-full z-20 opacity-0 group-hover:opacity-100 translate-y-2 group-hover:translate-y-0 transition-all duration-300 btn-press flex items-center gap-1.5 text-xs font-semibold"
            title={t('goStudio')}
          >
            <Clapperboard className="w-3.5 h-3.5" />
            {t('goStudio')}
          </button>
        )}

        <button
          onClick={(e) => { e.stopPropagation(); onDelete(); }}
          className="absolute bottom-3 right-3 p-2 glass rounded-full z-20 opacity-0 group-hover:opacity-100 translate-y-2 group-hover:translate-y-0 transition-all duration-300 hover:bg-[#F26161]/25 hover:text-[#F26161] text-white/55 btn-press"
          title={t('deleteProject')}
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>

        <button
          onClick={(e) => { e.stopPropagation(); onExport(); }}
          className="absolute bottom-3 right-11 p-2 glass rounded-full z-20 opacity-0 group-hover:opacity-100 translate-y-2 group-hover:translate-y-0 transition-all duration-300 delay-75 hover:bg-[#6E6BF2]/25 hover:text-[#817FF5] text-white/55 btn-press"
          title={t('exportProject') || 'Export Project'}
        >
          <Download className="w-3.5 h-3.5" />
        </button>

        {/* Play indicator for completed */}
        {isCompleted && !isHovering && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="bg-[#FF5C39]/25 backdrop-blur-sm p-3 rounded-full border border-[#FF8A6B]/40 group-hover:scale-110 transition-transform duration-300">
              <Play className="w-6 h-6 text-[#FFB494] fill-[#FFB494]" />
            </div>
          </div>
        )}

        {/* Processing overlay */}
        {isProcessing && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/75 backdrop-blur-sm pointer-events-none">
            <div className="relative mb-3">
              <div className="absolute inset-0 bg-[#FF5C39] blur-xl opacity-30 animate-pulse"></div>
              <Loader2 className="w-8 h-8 text-[#FF8A6B] animate-spin relative z-10" />
            </div>
            <span className="text-xs font-medium text-[#FFB494] font-mono uppercase tracking-wider processing-dots">{t(task.status)}</span>
          </div>
        )}
      </div>

      {/* Info */}
      <div className="p-4">
        <h3 className="text-[15px] font-semibold text-white tracking-[-0.01em] truncate group-hover:text-[#FFB494] transition-colors duration-300">{task.name}</h3>
        <p className="text-xs text-white/40 mt-1 flex items-center gap-2">
          <Film className="w-3 h-3 text-white/30" /> {t(task.style)}
        </p>

        {/* 进度条：细 3px 暖色渐变 */}
        <div className="mt-3 w-full bg-white/[0.08] rounded-full h-[3px] overflow-hidden">
          <div
            className="h-full warm-gradient-bar transition-all duration-700 rounded-full progress-bar-animated"
            style={{ width: `${task.progress}%` }}
          />
        </div>
        <div className="flex justify-between mt-1.5">
          <span className="text-[10px] text-white/30 font-mono">{new Date(task.createdAt).toLocaleDateString()}</span>
          <span className="text-[10px] text-[#FF8A6B] font-mono font-semibold">{task.progress}%</span>
        </div>
      </div>
    </div>
    </TiltCard>
  );
};
