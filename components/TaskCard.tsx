import React, { useState, useRef, useCallback } from 'react';
import { DramaTask, TaskStatus } from '../types';
import { Play, Loader2, Film, Trash2, Download, CheckCircle2, AlertCircle, Clock, Clapperboard } from 'lucide-react';

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
    if (isCompleted) return <CheckCircle2 className="w-3 h-3 text-emerald-600" />;
    if (isFailed) return <AlertCircle className="w-3 h-3 text-red-600" />;
    if (isProcessing) return <Loader2 className="w-3 h-3 text-brand-400 animate-spin" />;
    return <Clock className="w-3 h-3 text-[#94a3b8]" />;
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
    <div
      ref={cardRef}
      className="group relative rounded-2xl overflow-hidden cursor-pointer transition-all duration-300 hover-lift"
      style={{ background: '#ffffff', border: '1px solid #e8edf3' }}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onClick={handleClick}
    >
      {/* Cover */}
      <div className="aspect-video relative bg-[#f8fafc] overflow-hidden">
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
            className="w-full h-full object-cover opacity-50 group-hover:opacity-70 group-hover:scale-105 transition-all duration-500"
          />
        )}

        <div className="absolute inset-0 bg-gradient-to-t from-[#ffffff] via-[#ffffff]/20 to-transparent pointer-events-none" />

        {/* Status badge */}
        <div className="absolute top-3 right-3 glass px-2.5 py-1 rounded-lg text-[10px] font-mono uppercase tracking-wider z-10 text-brand-400 flex items-center gap-1.5">
          <span className={`status-dot ${getStatusDot()}`}></span>
          {getStatusIcon()}
          {t(task.status)}
        </div>

        {/* Action buttons */}
        {onOpenStudio && (
          <button
            onClick={(e) => { e.stopPropagation(); onOpenStudio(); }}
            className="absolute bottom-3 left-3 px-3 py-2 glass rounded-lg z-20 opacity-0 group-hover:opacity-100 translate-y-2 group-hover:translate-y-0 transition-all duration-300 hover:bg-brand-600/30 hover:text-brand-500 text-[#64748b] btn-press flex items-center gap-1.5 text-xs font-medium"
            title={t('goStudio')}
          >
            <Clapperboard className="w-4 h-4" />
            {t('goStudio')}
          </button>
        )}

        <button
          onClick={(e) => { e.stopPropagation(); onDelete(); }}
          className="absolute bottom-3 right-3 p-2 glass rounded-lg z-20 opacity-0 group-hover:opacity-100 translate-y-2 group-hover:translate-y-0 transition-all duration-300 hover:bg-red-600/30 hover:text-red-600 text-[#64748b] btn-press"
          title={t('deleteProject')}
        >
          <Trash2 className="w-4 h-4" />
        </button>

        <button
          onClick={(e) => { e.stopPropagation(); onExport(); }}
          className="absolute bottom-3 right-12 p-2 glass rounded-lg z-20 opacity-0 group-hover:opacity-100 translate-y-2 group-hover:translate-y-0 transition-all duration-300 delay-75 hover:bg-brand-600/30 hover:text-brand-500 text-[#64748b] btn-press"
          title={t('exportProject') || 'Export Project'}
        >
          <Download className="w-4 h-4" />
        </button>

        {/* Play indicator for completed */}
        {isCompleted && !isHovering && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="bg-brand-600/20 backdrop-blur-sm p-3 rounded-full border border-brand-500/30 group-hover:scale-110 transition-transform duration-300">
              <Play className="w-6 h-6 text-brand-400 fill-brand-400" />
            </div>
          </div>
        )}

        {/* Processing overlay */}
        {isProcessing && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-[#f8fafc]/80 backdrop-blur-sm pointer-events-none">
            <div className="relative mb-3">
              <div className="absolute inset-0 bg-brand-600 blur-xl opacity-30 animate-pulse"></div>
              <Loader2 className="w-8 h-8 text-brand-400 animate-spin relative z-10" />
            </div>
            <span className="text-xs font-medium text-brand-400 font-mono uppercase tracking-wider processing-dots">{t(task.status)}</span>
          </div>
        )}
      </div>

      {/* Info */}
      <div className="p-4">
        <h3 className="text-base font-bold text-[#111827] truncate group-hover:text-brand-400 transition-colors duration-300">{task.name}</h3>
        <p className="text-xs text-[#64748b] mt-1 flex items-center gap-2">
          <Film className="w-3 h-3 text-brand-400/60" /> {t(task.style)}
        </p>

        <div className="mt-3 w-full bg-black/[0.04] rounded-full h-1 overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-brand-500 to-accent-500 transition-all duration-700 rounded-full progress-bar-animated"
            style={{ width: `${task.progress}%` }}
          />
        </div>
        <div className="flex justify-between mt-1.5">
          <span className="text-[10px] text-[#94a3b8] font-mono">{new Date(task.createdAt).toLocaleDateString()}</span>
          <span className="text-[10px] text-brand-400 font-mono font-bold">{task.progress}%</span>
        </div>
      </div>
    </div>
  );
};
