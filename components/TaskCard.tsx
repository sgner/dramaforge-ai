import React, { useState } from 'react';
import { DramaTask, TaskStatus } from '../types';
import { Play, Loader2, Film, Trash2 } from 'lucide-react';

interface Props {
  task: DramaTask;
  onClick: () => void;
  onDelete: () => void;
  t: (key: string) => string;
}

export const TaskCard: React.FC<Props> = ({ task, onClick, onDelete, t }) => {
  const [isHovering, setIsHovering] = useState(false);

  // Determine cover image (generated or default)
  const coverImage = task.coverImage || 'https://picsum.photos/400/225?grayscale'; // Fallback
  // Try to find a completed video URL if available
  const videoUrl = task.bigShots.find(bs => bs.videoUrl)?.videoUrl;
  const isCompleted = task.status === TaskStatus.COMPLETED;

  return (
    <div 
      className="group relative bg-brand-800/40 border border-brand-700/50 rounded-xl overflow-hidden cursor-pointer hover:border-brand-500 transition-all duration-300 hover:shadow-lg hover:shadow-brand-500/10"
      onMouseEnter={() => setIsHovering(true)}
      onMouseLeave={() => setIsHovering(false)}
      onClick={onClick}
    >
      {/* Aspect Ratio Container */}
      <div className="aspect-video relative bg-black">
        {isHovering && isCompleted && videoUrl ? (
          <video 
            src={videoUrl} 
            autoPlay 
            muted 
            loop 
            className="w-full h-full object-cover" 
          />
        ) : (
          <img 
            src={coverImage} 
            alt={task.name} 
            className="w-full h-full object-cover opacity-80 group-hover:opacity-100 transition-opacity" 
          />
        )}
        
        {/* Status Overlay */}
        <div className="absolute top-2 right-2 bg-black/60 backdrop-blur-md px-2 py-1 rounded text-xs font-mono border border-white/10 z-10">
          {t(task.status)}
        </div>

        {/* Delete Button (Visible on Hover) */}
        <button 
            onClick={(e) => {
                e.stopPropagation();
                onDelete();
            }}
            className="absolute bottom-2 right-2 p-2 bg-black/60 hover:bg-red-900/80 hover:text-red-400 text-gray-400 backdrop-blur-md rounded-full border border-white/10 z-20 opacity-0 group-hover:opacity-100 transition-opacity"
            title={t('deleteProject')}
        >
            <Trash2 className="w-4 h-4" />
        </button>

        {/* Play Icon Overlay (if completed) */}
        {isCompleted && !isHovering && (
           <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
             <div className="bg-white/20 backdrop-blur-sm p-3 rounded-full">
               <Play className="w-6 h-6 text-white fill-white" />
             </div>
           </div>
        )}
        
        {/* Progress Overlay (if processing) */}
        {task.status !== TaskStatus.COMPLETED && task.status !== TaskStatus.IDLE && task.status !== TaskStatus.FAILED && (
           <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/60 backdrop-blur-sm pointer-events-none">
             <Loader2 className="w-8 h-8 text-brand-400 animate-spin mb-2" />
             <span className="text-xs font-medium text-brand-200">{t(task.status)}</span>
           </div>
        )}
      </div>

      <div className="p-4">
        <h3 className="text-lg font-bold text-white truncate group-hover:text-brand-300 transition-colors">{task.name}</h3>
        <p className="text-xs text-gray-400 mt-1 flex items-center gap-2">
          <Film className="w-3 h-3" /> {t(task.style)}
        </p>
        
        {/* Progress Bar */}
        <div className="mt-3 w-full bg-brand-900 rounded-full h-1.5 overflow-hidden">
          <div 
            className="h-full bg-gradient-to-r from-brand-600 to-brand-400 transition-all duration-500"
            style={{ width: `${task.progress}%` }}
          />
        </div>
        <div className="flex justify-between mt-1">
          <span className="text-[10px] text-gray-500">{new Date(task.createdAt).toLocaleDateString()}</span>
          <span className="text-[10px] text-brand-400">{task.progress}%</span>
        </div>
      </div>
    </div>
  );
};