import React, { useState, useRef, useCallback } from 'react';
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

  const coverImage = task.coverImage || 'https://picsum.photos/400/225?grayscale';
  const videoUrl = task.bigShots.find(bs => bs.videoUrl)?.videoUrl;
  const isCompleted = task.status === TaskStatus.COMPLETED;
  const isFailed = task.status === TaskStatus.FAILED;
  const isProcessing = task.status !== TaskStatus.COMPLETED && task.status !== TaskStatus.IDLE && task.status !== TaskStatus.FAILED;

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
      className="relative rounded-[22px] overflow-hidden cursor-pointer transition-all duration-300 border border-white/[0.06] hover:border-white/[0.12] hover:shadow-[0_24px_64px_-20px_rgba(110,107,242,0.35)]"
      style={{ background: 'rgba(255,255,255,0.04)', backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)' }}
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
        ) : (
          <img
            src={coverImage}
            alt={task.name}
            className="w-full h-full object-cover opacity-80 group-hover:opacity-100 group-hover:scale-105 transition-all duration-500"
          />
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
            className="absolute bottom-3 left-3 px-3 py-1.5 bg-[#6E6BF2] hover:bg-[#817FF5] text-white rounded-full z-20 opacity-0 group-hover:opacity-100 translate-y-2 group-hover:translate-y-0 transition-all duration-300 shadow-lg shadow-[#6E6BF2]/30 btn-press flex items-center gap-1.5 text-xs font-semibold"
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
            <div className="bg-[#6E6BF2]/25 backdrop-blur-sm p-3 rounded-full border border-[#817FF5]/40 group-hover:scale-110 transition-transform duration-300">
              <Play className="w-6 h-6 text-[#A5A3F8] fill-[#A5A3F8]" />
            </div>
          </div>
        )}

        {/* Processing overlay */}
        {isProcessing && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-[#0A0A0B]/80 backdrop-blur-sm pointer-events-none">
            <div className="relative mb-3">
              <div className="absolute inset-0 bg-[#6E6BF2] blur-xl opacity-30 animate-pulse"></div>
              <Loader2 className="w-8 h-8 text-[#817FF5] animate-spin relative z-10" />
            </div>
            <span className="text-xs font-medium text-[#A5A3F8] font-mono uppercase tracking-wider processing-dots">{t(task.status)}</span>
          </div>
        )}
      </div>

      {/* Info */}
      <div className="p-4">
        <h3 className="text-sm font-semibold text-[#F5F5F7] truncate group-hover:text-[#A5A3F8] transition-colors duration-300">{task.name}</h3>
        <p className="text-xs text-white/40 mt-1 flex items-center gap-2">
          <Film className="w-3 h-3 text-white/30" /> {t(task.style)}
        </p>

        {/* 进度条：细 3px accent */}
        <div className="mt-3 w-full bg-white/[0.08] rounded-full h-[3px] overflow-hidden">
          <div
            className="h-full bg-[#6E6BF2] transition-all duration-700 rounded-full progress-bar-animated"
            style={{ width: `${task.progress}%` }}
          />
        </div>
        <div className="flex justify-between mt-1.5">
          <span className="text-[10px] text-white/30 font-mono">{new Date(task.createdAt).toLocaleDateString()}</span>
          <span className="text-[10px] text-[#817FF5] font-mono font-semibold">{task.progress}%</span>
        </div>
      </div>
    </div>
    </TiltCard>
  );
};
