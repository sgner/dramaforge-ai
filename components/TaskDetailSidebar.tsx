import React from 'react';
import { BookOpen, Image as ImageIcon, User, UserPlus, ImagePlus, Download, RotateCw, Edit2, Trash2, Loader2, CheckCircle2, Clapperboard } from 'lucide-react';
import { motion } from 'framer-motion';
import { DramaTask, TaskStatus, Character } from '../types';
import { downloadMedia } from '../utils/helpers';

const ScriptAnalysisPanel = ({ task, t }: { task: DramaTask; t: any }) => (
  <motion.div
    initial={{ opacity: 0, y: 16 }}
    animate={{ opacity: 1, y: 0 }}
    transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
    className="rounded-2xl p-6 relative overflow-hidden"
    style={{
      background: '#ffffff',
      border: '1px solid #e8edf3',
    }}
  >
    <h3 className="flex items-center gap-2.5 text-sm font-semibold text-[#111827] mb-5">
      <div className="p-1.5 rounded-lg" style={{ background: 'rgba(17,24,39,0.04)', border: '1px solid rgba(17,24,39,0.08)' }}>
        <BookOpen className="w-3.5 h-3.5 text-brand-400" />
      </div>
      {t('scriptAnalysis')}
    </h3>
    {task.scriptAnalysis ? (
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <motion.div
          initial={{ opacity: 0, x: -12 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: 0.1, duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
          className="p-4 rounded-xl"
          style={{ background: '#f8fafc', border: '1px solid rgba(17,24,39,0.04)' }}
        >
          <span className="text-[#94a3b8] uppercase text-[9px] font-medium block mb-2 tracking-wider font-mono">{t('plotSummary')}</span>
          <p className="leading-relaxed text-[#64748b] text-xs">{task.scriptAnalysis.corePlot}</p>
        </motion.div>
        <div className="space-y-3">
          <motion.div
            initial={{ opacity: 0, x: 12 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.15, duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
            className="p-4 rounded-xl"
            style={{ background: '#f8fafc', border: '1px solid rgba(17,24,39,0.04)' }}
          >
            <span className="text-[#94a3b8] uppercase text-[9px] font-medium block mb-2 tracking-wider font-mono">{t('mood')}</span>
            <span className="inline-block px-3 py-1.5 text-[10px] rounded-lg" style={{ background: 'rgba(17,24,39,0.04)', border: '1px solid rgba(17,24,39,0.08)', color: '#60a5fa' }}>{task.scriptAnalysis.mood}</span>
          </motion.div>
          {(task.scriptAnalysis as any).keyConflicts && (
            <motion.div
              initial={{ opacity: 0, x: 12 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.2, duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
              className="p-4 rounded-xl"
              style={{ background: '#f8fafc', border: '1px solid rgba(17,24,39,0.04)' }}
            >
              <span className="text-[#94a3b8] uppercase text-[9px] font-medium block mb-2 tracking-wider font-mono">Key Conflicts</span>
              <p className="text-[#64748b] text-xs leading-relaxed">{(task.scriptAnalysis as any).keyConflicts}</p>
            </motion.div>
          )}
        </div>
      </div>
    ) : task.status === TaskStatus.SCRIPT_GENERATION ? (
      <div className="h-28 flex items-center justify-center rounded-xl" style={{ background: '#f8fafc', border: '1px solid rgba(17,24,39,0.04)' }}>
        <div className="flex items-center gap-3">
          <Loader2 className="w-4 h-4 animate-spin text-brand-400" />
          <span className="text-[#94a3b8] text-[10px] font-mono tracking-wider">Analyzing</span>
        </div>
      </div>
    ) : (
      <div className="h-20 flex items-center justify-center rounded-xl text-[#94a3b8] text-xs" style={{ background: 'rgba(17,24,39,0.02)', border: '1px dashed rgba(17,24,39,0.08)' }}>Analysis pending</div>
    )}
  </motion.div>
);

const CharacterCard = ({ char, idx, task, onDeleteCharacter, onUploadReference, onRegenerateCharacter, onEditCharacter, onSetLightboxImage, t }: {
  char: Character;
  idx: number;
  task: DramaTask;
  onDeleteCharacter: (name: string) => void;
  onUploadReference: (name: string) => void;
  onRegenerateCharacter: (taskId: string, charName: string) => void;
  onEditCharacter: (char: Character) => void;
  onSetLightboxImage: (url: string) => void;
  t: any;
}) => {
  const isCharGenerating = !!char.generationStatus;
  const isCharDone = !!char.threeViewImg;

  return (
    <motion.div
      initial={{ opacity: 0, y: 20, scale: 0.95 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ delay: idx * 0.05, duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
      className="group relative rounded-xl overflow-hidden hover-lift"
      style={{
        background: '#ffffff',
        border: '1px solid #e8edf3',
      }}
    >
      <div className="relative aspect-[3/4] overflow-hidden" style={{ background: '#f8fafc' }}>
        {isCharGenerating ? (
          <div className="w-full h-full flex flex-col items-center justify-center">
            <Loader2 className="w-8 h-8 animate-spin text-brand-400/60 mb-3" />
            <span className="text-[9px] uppercase font-mono tracking-wider text-[#94a3b8]">
              Generating
            </span>
          </div>
        ) : isCharDone ? (
          <img
            src={char.threeViewImg}
            alt={char.name}
            className="w-full h-full object-cover opacity-60 group-hover:opacity-100 group-hover:scale-105 transition-all duration-500 cursor-zoom-in"
            onClick={() => onSetLightboxImage(char.threeViewImg!)}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <User className="w-12 h-12 opacity-10 text-[#94a3b8]" />
          </div>
        )}

        {char.referenceImage && (
          <div className="absolute top-2 right-2 px-1.5 py-0.5 rounded-md text-[8px] font-medium bg-emerald-500/15 text-emerald-600 border border-emerald-500/20">
            REF
          </div>
        )}

        {isCharDone && (
          <div className="absolute top-2 left-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 drop-shadow-lg" />
          </div>
        )}

        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent" />

        <div className="absolute bottom-0 left-0 right-0 p-4">
          <h4 className="text-white font-semibold text-sm flex items-center gap-2">
            {char.name}
            {isCharGenerating && <motion.span animate={{ scale: [1, 1.4, 1] }} transition={{ repeat: Infinity, duration: 1.5 }} className="w-1.5 h-1.5 rounded-full bg-brand-400" />}
          </h4>
        </div>
      </div>

      <div className="p-4">
        <p className="text-[10px] text-[#64748b] line-clamp-3 leading-relaxed mb-3">{char.visualFeatures}</p>

        {task.mode === 'manual' && (
          <div className="flex gap-1 flex-wrap">
            {char.threeViewImg && (
              <motion.button
                onClick={() => downloadMedia(char.threeViewImg!, `${char.name}_design.png`)}
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                className="px-2 py-0.5 rounded-md text-[9px] font-medium"
                style={{ background: 'rgba(17,24,39,0.04)', border: '1px solid rgba(17,24,39,0.06)', color: '#64748b' }}
              >
                <Download className="w-2.5 h-2.5 inline mr-0.5" /> Save
              </motion.button>
            )}
            <motion.button
              onClick={() => onUploadReference(char.name)}
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              className="px-2 py-0.5 rounded-md text-[9px] font-medium"
              style={{ background: 'rgba(17,24,39,0.04)', border: '1px solid rgba(17,24,39,0.06)', color: '#64748b' }}
            >
              <ImagePlus className="w-2.5 h-2.5 inline mr-0.5" /> Ref
            </motion.button>
            <motion.button
              onClick={() => onRegenerateCharacter(task.id, char.name)}
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              className="px-2 py-0.5 rounded-md text-[9px] font-medium"
              style={{ background: 'rgba(17,24,39,0.04)', border: '1px solid rgba(17,24,39,0.06)', color: '#64748b' }}
            >
              <RotateCw className="w-2.5 h-2.5 inline mr-0.5" /> Regen
            </motion.button>
            <motion.button
              onClick={() => onEditCharacter(char)}
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              className="px-2 py-0.5 rounded-md text-[9px] font-medium"
              style={{ background: 'rgba(17,24,39,0.04)', border: '1px solid rgba(17,24,39,0.06)', color: '#64748b' }}
            >
              <Edit2 className="w-2.5 h-2.5 inline mr-0.5" /> Edit
            </motion.button>
            <motion.button
              onClick={() => onDeleteCharacter(char.name)}
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              className="px-2 py-0.5 rounded-md text-[9px] font-medium opacity-0 group-hover:opacity-100 transition-opacity"
              style={{ background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.15)', color: 'rgba(220,38,38,0.8)' }}
            >
              <Trash2 className="w-2.5 h-2.5 inline mr-0.5" /> Del
            </motion.button>
          </div>
        )}
      </div>
    </motion.div>
  );
};

export const TaskDetailSidebar = ({
  task,
  onAddCharacter,
  onDeleteCharacter,
  onUploadReference,
  onRegenerateCharacter,
  onEditCharacter,
  onSetLightboxImage,
  t
}: {
  task: DramaTask;
  onAddCharacter: () => void;
  onDeleteCharacter: (name: string) => void;
  onUploadReference: (name: string) => void;
  onRegenerateCharacter: (taskId: string, charName: string) => void;
  onEditCharacter: (char: Character) => void;
  onSetLightboxImage: (url: string) => void;
  t: any;
}) => {
  return (
    <div className="space-y-6">
      <ScriptAnalysisPanel task={task} t={t} />

      <div>
        <div className="flex items-center justify-between mb-4">
          <h3 className="flex items-center gap-2.5 text-sm font-semibold text-[#111827]">
            <div className="p-1.5 rounded-lg" style={{ background: 'rgba(17,24,39,0.04)', border: '1px solid rgba(17,24,39,0.08)' }}>
              <Clapperboard className="w-3.5 h-3.5 text-brand-400" />
            </div>
            {t('characters')}
            <span className="text-[10px] text-[#94a3b8] font-mono">{task.characters.length}</span>
          </h3>
          {task.mode === 'manual' && (
            <motion.button
              onClick={onAddCharacter}
              whileHover={{ scale: 1.05, y: -1 }}
              whileTap={{ scale: 0.95 }}
              className="px-3 py-1.5 rounded-lg text-[10px] font-medium flex items-center gap-1.5"
              style={{
                background: 'rgba(17,24,39,0.04)',
                border: '1px solid rgba(17,24,39,0.08)',
                color: '#374151',
              }}
            >
              <UserPlus className="w-3.5 h-3.5" /> {t('addCharacter')}
            </motion.button>
          )}
        </div>

        {task.characters.length > 0 ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
            {task.characters.map((char, idx) => (
              <CharacterCard
                char={char}
                idx={idx}
                task={task}
                onDeleteCharacter={onDeleteCharacter}
                onUploadReference={onUploadReference}
                onRegenerateCharacter={onRegenerateCharacter}
                onEditCharacter={onEditCharacter}
                onSetLightboxImage={onSetLightboxImage}
                t={t}
              />
            ))}
          </div>
        ) : (
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.4 }}
            className="h-[300px] flex flex-col items-center justify-center rounded-xl"
            style={{
              background: '#ffffff',
              border: '1px solid #e8edf3',
            }}
          >
            <div className="w-16 h-16 rounded-full flex items-center justify-center mb-5" style={{ background: 'rgba(17,24,39,0.04)', border: '1px solid rgba(17,24,39,0.08)' }}>
              <User className="w-7 h-7 text-brand-500/40" />
            </div>
            <p className="text-[#64748b] text-sm">{t('waitingScript')}</p>
            <p className="text-[#94a3b8] text-[10px] mt-2 max-w-[240px] text-center font-mono leading-relaxed">
              Characters will appear after script analysis is complete.
            </p>
          </motion.div>
        )}
      </div>
    </div>
  );
};
