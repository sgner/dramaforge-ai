import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Plus, GitFork, Image as ImageIcon, AlertTriangle, PlayCircle, RotateCw, Loader2, Trash2, ChevronLeft, ChevronRight, LayoutGrid } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { DramaTask, BigShot } from '../types';
import { getProgressFromStatus } from '../utils/helpers';

const ShotCard = ({ shot, idx, task, onSelectShot, onDeleteShot, onRegenerateShot, t }: {
  shot: BigShot;
  idx: number;
  task: DramaTask;
  onSelectShot: (id: string, initialEdit: boolean) => void;
  onDeleteShot: (shotId: string) => void;
  onRegenerateShot: (taskId: string, shotId: string) => void;
  t: any;
}) => {
  const isFailed = shot.generationStatus?.toLowerCase().includes('failed');
  const isStoryboardFailed = !shot.storyboardImageUrl && isFailed;
  const isGenerating = shot.generationStatus && !shot.videoUrl && !shot.generationStatus.toLowerCase().includes('failed') && shot.generationStatus !== 'Idle' && shot.generationStatus !== 'Completed';
  const progress = isGenerating ? getProgressFromStatus(shot.generationStatus) : 0;
  const hasVideo = !!shot.videoUrl;
  const hasImage = !!shot.storyboardImageUrl;

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ delay: idx * 0.04, duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
      className="group relative flex-shrink-0 cursor-pointer"
      style={{ width: 280 }}
      onClick={() => onSelectShot(shot.id, false)}
    >
      <div
        className="relative rounded-xl overflow-hidden h-full transition-all duration-300 hover-lift"
        style={{
          background: '#ffffff',
          border: '1px solid #e8edf3',
        }}
      >
        <div className="relative aspect-[16/10] overflow-hidden" style={{ background: '#f8fafc' }}>
          {hasVideo ? (
            <div className="w-full h-full relative">
              <video
                src={shot.videoUrl}
                className="w-full h-full object-cover opacity-60 group-hover:opacity-100 group-hover:scale-105 transition-all duration-500"
                muted loop
                onMouseEnter={(e) => e.currentTarget.play()}
                onMouseLeave={(e) => { e.currentTarget.pause(); e.currentTarget.currentTime = 0; }}
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent" />
              <div className="absolute top-3 left-3">
                <PlayCircle className="w-5 h-5 text-emerald-600 drop-shadow-lg" />
              </div>
            </div>
          ) : hasImage ? (
            <div className="w-full h-full relative">
              <img
                src={shot.storyboardImageUrl}
                className="w-full h-full object-cover opacity-30 group-hover:opacity-70 group-hover:scale-105 transition-all duration-500"
                alt="Storyboard"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent" />
            </div>
          ) : (
            <div className="w-full h-full flex flex-col items-center justify-center">
              {isGenerating ? (
                <div className="flex flex-col items-center">
                  <Loader2 className="w-6 h-6 animate-spin text-brand-400/60 mb-2" />
                  <span className="text-[9px] uppercase font-mono tracking-wider text-[#94a3b8]">
                    {shot.generationStatus}
                  </span>
                </div>
              ) : (
                <ImageIcon className="w-6 h-6 opacity-10 text-[#94a3b8]" />
              )}
            </div>
          )}

          {isFailed && (
            <div className="absolute inset-0 flex items-center justify-center" style={{ background: 'rgba(220,38,38,0.1)', backdropFilter: 'blur(4px)' }}>
              <AlertTriangle className="w-6 h-6 text-red-600" />
            </div>
          )}

          <div className="absolute bottom-2 left-3 z-10">
            <span className="text-[10px] font-mono text-white/30 uppercase tracking-wider font-medium">
              {String(idx + 1).padStart(2, '0')}
            </span>
          </div>

          {isGenerating && (
            <div className="absolute bottom-0 left-0 right-0 h-0.5 overflow-hidden" style={{ background: 'rgba(0,0,0,0.4)' }}>
              <motion.div
                className="h-full rounded-full"
                style={{ background: 'linear-gradient(90deg, #111827, #374151)' }}
                initial={{ width: 0 }}
                animate={{ width: `${Math.max(5, progress)}%` }}
                transition={{ duration: 0.5, ease: 'easeOut' }}
              />
            </div>
          )}
        </div>

        <div className="p-3.5">
          <div className="flex justify-between items-center mb-2">
            <span className="text-[9px] font-mono text-[#94a3b8] font-medium tracking-wider">
              SEQ #{String(idx + 1).padStart(2, '0')}
            </span>
            <span className={`text-[8px] px-1.5 py-0.5 rounded-md border font-mono font-medium tracking-wider ${
              hasVideo
                ? 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20'
                : isFailed
                  ? 'bg-red-500/10 text-red-600 border-red-500/20'
                  : isGenerating
                    ? 'bg-brand-600/10 text-brand-300 border-brand-500/20'
                    : 'bg-black/[0.02] text-[#94a3b8] border-black/[0.06]'
            }`}>
              {hasVideo ? 'DONE' : isStoryboardFailed ? 'FAIL' : shot.generationStatus || 'IDLE'}
            </span>
          </div>

          {shot.charactersInvolved.length > 0 && (
            <div className="flex gap-1 flex-wrap mb-2">
              {shot.charactersInvolved.map(name => (
                <span
                  key={name}
                  className="px-1.5 py-0.5 text-[8px] font-medium rounded-full"
                  style={{
                    background: 'rgba(17,24,39,0.04)',
                    border: '1px solid rgba(17,24,39,0.06)',
                    color: '#64748b',
                  }}
                >
                  {name}
                </span>
              ))}
            </div>
          )}

          {shot.includedDialogues.length > 0 && (
            <p className="text-[10px] text-[#64748b] line-clamp-1">
              &ldquo;{shot.includedDialogues[0]}&rdquo;
            </p>
          )}

          <div className="flex justify-between items-center mt-2.5 pt-2" style={{ borderTop: '1px solid rgba(17,24,39,0.04)' }}>
            <div className="flex gap-1">
              <motion.button
                onClick={(e) => { e.stopPropagation(); onSelectShot(shot.id, true); }}
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                className="px-2 py-0.5 rounded-md text-[9px] font-medium"
                style={{
                  background: 'rgba(17,24,39,0.04)',
                  border: '1px solid rgba(17,24,39,0.06)',
                  color: '#64748b',
                }}
              >
                {t('edit')}
              </motion.button>
              {!hasImage && isStoryboardFailed && (
                <motion.button
                  onClick={(e) => { e.stopPropagation(); onRegenerateShot(task.id, shot.id); }}
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                  className="px-2 py-0.5 rounded-md text-[9px] font-medium flex items-center gap-0.5 bg-red-500/10 text-red-600 border border-red-500/15"
                >
                  <RotateCw className="w-2.5 h-2.5" /> Retry
                </motion.button>
              )}
            </div>

            {task.mode === 'manual' && (
              <motion.button
                onClick={(e) => { e.stopPropagation(); onDeleteShot(shot.id); }}
                whileHover={{ scale: 1.1 }}
                whileTap={{ scale: 0.9 }}
                className="p-1 rounded-md opacity-0 group-hover:opacity-100 transition-all text-[#94a3b8] hover:text-red-600"
              >
                <Trash2 className="w-3 h-3" />
              </motion.button>
            )}
          </div>
        </div>
      </div>
    </motion.div>
  );
};

const TreeView = ({ task, onSelectShot, t }: {
  task: DramaTask;
  onSelectShot: (id: string, initialEdit: boolean) => void;
  t: any;
}) => (
  <div
    className="relative p-8 rounded-xl overflow-x-auto min-h-[500px] custom-scrollbar"
    style={{
      background: '#ffffff',
      border: '1px solid #e8edf3',
    }}
  >
    <div className="flex flex-col items-center gap-8">
      <AnimatePresence>
        {task.bigShots.map((shot, idx) => (
          <motion.div
            key={shot.id}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: idx * 0.06, duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
            className="relative flex flex-col items-center"
          >
            <motion.div
              onClick={() => onSelectShot(shot.id, false)}
              whileHover={{ scale: 1.04, y: -2 }}
              whileTap={{ scale: 0.98 }}
              className={`w-52 p-3 rounded-xl border cursor-pointer transition-all ${
                shot.videoUrl
                  ? 'bg-emerald-500/5 border-emerald-500/20'
                  : 'bg-black/[0.02] border-black/[0.06]'
              }`}
            >
              <div className="aspect-video rounded-lg mb-2 overflow-hidden" style={{ background: '#f8fafc' }}>
                {shot.storyboardImageUrl ? (
                  <img src={shot.storyboardImageUrl} className="w-full h-full object-cover opacity-70" alt="" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-[9px] text-[#94a3b8] font-mono tracking-wider">
                    SHOT {idx + 1}
                  </div>
                )}
              </div>
              <div className="text-[10px] font-medium text-[#64748b] line-clamp-1">
                {shot.includedDialogues[0] || 'No dialogue'}
              </div>
            </motion.div>
            {idx < task.bigShots.length - 1 && (
              <div className="h-8 w-px mt-2" style={{ background: 'linear-gradient(to bottom, rgba(17,24,39,0.2), transparent)' }} />
            )}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  </div>
);

export const StoryboardList = ({
  task,
  viewMode,
  onViewModeChange,
  onSelectShot,
  onDeleteShot,
  onRegenerateShot,
  onAddShot,
  t
}: {
  task: DramaTask;
  viewMode: 'list' | 'tree';
  onViewModeChange: (mode: 'list' | 'tree') => void;
  onSelectShot: (id: string, initialEdit: boolean) => void;
  onDeleteShot: (shotId: string) => void;
  onRegenerateShot: (taskId: string, shotId: string) => void;
  onAddShot: () => void;
  t: any;
}) => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  const checkScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    setCanScrollLeft(el.scrollLeft > 10);
    setCanScrollRight(el.scrollLeft < el.scrollWidth - el.clientWidth - 10);
  }, []);

  useEffect(() => {
    checkScroll();
    const el = scrollRef.current;
    if (el) {
      el.addEventListener('scroll', checkScroll, { passive: true });
      return () => el.removeEventListener('scroll', checkScroll);
    }
  }, [checkScroll, task.bigShots.length]);

  const scroll = (dir: 'left' | 'right') => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollBy({ left: dir === 'left' ? -400 : 400, behavior: 'smooth' });
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-3">
          {task.mode === 'manual' && (
            <motion.button
              onClick={onAddShot}
              whileHover={{ scale: 1.04, y: -1 }}
              whileTap={{ scale: 0.96 }}
              className="px-3 py-1.5 rounded-lg text-[10px] font-medium flex items-center gap-1.5"
              style={{
                background: 'rgba(17,24,39,0.04)',
                border: '1px solid rgba(17,24,39,0.08)',
                color: '#374151',
              }}
            >
              <Plus className="w-3.5 h-3.5" /> {t('addShot')}
            </motion.button>
          )}

          {viewMode === 'list' && task.bigShots.length > 0 && (
            <div className="flex items-center gap-2">
              <motion.button
                onClick={() => scroll('left')}
                whileHover={{ scale: 1.1 }}
                whileTap={{ scale: 0.9 }}
                className="p-1.5 rounded-lg transition-all"
                style={{
                  background: canScrollLeft ? 'rgba(17,24,39,0.06)' : 'rgba(17,24,39,0.02)',
                  border: '1px solid rgba(17,24,39,0.06)',
                  color: canScrollLeft ? '#374151' : '#94a3b8',
                }}
              >
                <ChevronLeft className="w-4 h-4" />
              </motion.button>
              <motion.button
                onClick={() => scroll('right')}
                whileHover={{ scale: 1.1 }}
                whileTap={{ scale: 0.9 }}
                className="p-1.5 rounded-lg transition-all"
                style={{
                  background: canScrollRight ? 'rgba(17,24,39,0.06)' : 'rgba(17,24,39,0.02)',
                  border: '1px solid rgba(17,24,39,0.06)',
                  color: canScrollRight ? '#374151' : '#94a3b8',
                }}
              >
                <ChevronRight className="w-4 h-4" />
              </motion.button>
            </div>
          )}
        </div>

        <div className="flex p-1 rounded-lg" style={{ background: 'rgba(17,24,39,0.04)', border: '1px solid rgba(17,24,39,0.06)' }}>
          <motion.button
            onClick={() => onViewModeChange('list')}
            whileTap={{ scale: 0.92 }}
            className={`p-1.5 rounded-md transition-all ${
              viewMode === 'list'
                ? 'bg-brand-600 text-white shadow-lg shadow-brand-600/20'
                : 'text-[#94a3b8] hover:text-brand-400'
            }`}
          >
            <LayoutGrid className="w-3.5 h-3.5" />
          </motion.button>
          <motion.button
            onClick={() => onViewModeChange('tree')}
            whileTap={{ scale: 0.92 }}
            className={`p-1.5 rounded-md transition-all ${
              viewMode === 'tree'
                ? 'bg-brand-600 text-white shadow-lg shadow-brand-600/20'
                : 'text-[#94a3b8] hover:text-brand-400'
            }`}
          >
            <GitFork className="w-3.5 h-3.5" />
          </motion.button>
        </div>
      </div>

      <AnimatePresence mode="wait">
        {viewMode === 'list' ? (
          <motion.div
            key="list-view"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
          >
            {task.bigShots.length > 0 ? (
              <div
                ref={scrollRef}
                className="flex gap-4 overflow-x-auto pb-4 custom-scrollbar"
                style={{ scrollSnapType: 'x proximity' }}
              >
                {task.bigShots.map((shot, idx) => (
                  <div key={shot.id} style={{ scrollSnapAlign: 'start' }}>
                    <ShotCard
                      shot={shot}
                      idx={idx}
                      task={task}
                      onSelectShot={onSelectShot}
                      onDeleteShot={onDeleteShot}
                      onRegenerateShot={onRegenerateShot}
                      t={t}
                    />
                  </div>
                ))}
              </div>
            ) : (
              <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.4 }}
                className="h-[400px] flex flex-col items-center justify-center rounded-xl"
                style={{
                  background: '#ffffff',
                  border: '1px solid #e8edf3',
                }}
              >
                <div className="w-16 h-16 rounded-full flex items-center justify-center mb-5" style={{ background: 'rgba(17,24,39,0.04)', border: '1px solid rgba(17,24,39,0.08)' }}>
                  <ImageIcon className="w-7 h-7 text-brand-500/40" />
                </div>
                <p className="text-[#64748b] text-sm">{t('waitingScript')}</p>
                <p className="text-[#94a3b8] text-[10px] mt-2 max-w-[240px] text-center font-mono leading-relaxed">
                  Script generation and analysis must complete before sequences appear.
                </p>
              </motion.div>
            )}
          </motion.div>
        ) : (
          <motion.div
            key="tree-view"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
          >
            <TreeView task={task} onSelectShot={onSelectShot} t={t} />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
