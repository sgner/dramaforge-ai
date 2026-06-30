import React from 'react';
import { Code, Terminal, PenTool, Save, ArrowRight, RefreshCw, Loader2, LayoutDashboard, Globe, MessageSquare, Zap, Lock } from 'lucide-react';
import { motion } from 'framer-motion';
import { DramaTask } from '../types';
import { renderLogPrefix } from '../utils/helpers';
import { RhythmChart } from './RhythmChart';

const sectionVariants = {
  hidden: { opacity: 0, x: -12 },
  visible: { opacity: 1, x: 0, transition: { duration: 0.3, ease: [0.16, 1, 0.3, 1] } }
};

export const IntermediateDataPanel = ({
  task,
  isEditingSourceText,
  tempSourceText,
  isExpandingStory,
  onEditSourceText,
  onSaveSourceText,
  onTempSourceTextChange,
  onContinueStory,
  onRewriteStory,
  t
}: {
  task: DramaTask;
  isEditingSourceText: boolean;
  tempSourceText: string;
  isExpandingStory: boolean;
  onEditSourceText: () => void;
  onSaveSourceText: () => void;
  onTempSourceTextChange: (text: string) => void;
  onContinueStory: () => void;
  onRewriteStory: () => void;
  t: any;
}) => {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1], delay: 0.15 }}
      className="mt-8 pt-6"
      style={{ borderTop: '1px solid rgba(17,24,39,0.04)' }}
    >
      <div className="flex items-center gap-2.5 mb-4">
        <div className="p-1.5 rounded-lg" style={{ background: 'rgba(17,24,39,0.04)', border: '1px solid rgba(17,24,39,0.08)' }}>
          <LayoutDashboard className="w-3.5 h-3.5 text-brand-400" />
        </div>
        <h3 className="text-sm font-semibold text-[#111827]">{t('intermediateData')}</h3>
      </div>

      <div
        className="flex flex-col lg:flex-row h-[700px] rounded-2xl overflow-hidden"
        style={{
          background: '#ffffff',
          border: '1px solid #e8edf3',
        }}
      >
        <div className="flex-1 flex flex-col border-b lg:border-b-0 lg:border-r min-w-0" style={{ borderColor: 'rgba(17,24,39,0.06)' }}>
          <div className="flex items-center h-10 px-4 gap-2" style={{ background: 'rgba(17,24,39,0.02)', borderBottom: '1px solid rgba(17,24,39,0.06)' }}>
            <Code className="w-3.5 h-3.5 text-brand-400" />
            <span className="text-[10px] font-medium uppercase tracking-wider text-[#94a3b8] font-mono">Raw JSON State</span>
          </div>
          <div className="flex-1 overflow-hidden relative">
            <pre className="absolute inset-0 p-4 text-[10px] font-mono text-[#94a3b8] overflow-auto custom-scrollbar leading-relaxed">
              {JSON.stringify(task, null, 2)}
            </pre>
          </div>
        </div>

        <div className="flex-1 flex flex-col min-w-0">
          <div className="flex items-center h-10 px-4 gap-2" style={{ background: 'rgba(17,24,39,0.02)', borderBottom: '1px solid rgba(17,24,39,0.06)' }}>
            <Terminal className="w-3.5 h-3.5 text-brand-400" />
            <span className="text-[10px] font-medium uppercase tracking-wider text-[#94a3b8] font-mono">Process Log</span>
          </div>
          <div className="flex-1 overflow-y-auto p-4 custom-scrollbar font-mono text-xs space-y-6 text-[#64748b]">
            <motion.div
              variants={sectionVariants}
              initial="hidden"
              animate="visible"
              className="flex gap-2"
            >
              <span className="text-[#94a3b8]">[{new Date(task.createdAt).toLocaleTimeString()}]</span>
              <span className="text-emerald-600/80">Task Initialized: "{task.name}" ({task.mode})</span>
            </motion.div>

            {task.rawNovelText && (
              <motion.div variants={sectionVariants} initial="hidden" animate="visible">
                {renderLogPrefix("Gemini", `Text Processing (${task.sourceType})`)}
                {task.mode === 'manual' && task.sourceType === 'idea' && (
                  <div className="ml-2 mb-2 flex gap-2 justify-end">
                    {!isEditingSourceText ? (
                      <motion.button
                        onClick={onEditSourceText}
                        disabled={isExpandingStory}
                        whileHover={{ scale: 1.04, y: -1 }}
                        whileTap={{ scale: 0.96 }}
                        className="flex items-center gap-1 px-2 py-0.5 text-brand-400 rounded-lg text-[10px] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        style={{ background: 'rgba(17,24,39,0.04)', border: '1px solid rgba(17,24,39,0.08)' }}
                      >
                        <PenTool className="w-3 h-3" /> Edit
                      </motion.button>
                    ) : (
                      <motion.button
                        onClick={onSaveSourceText}
                        whileHover={{ scale: 1.04, y: -1 }}
                        whileTap={{ scale: 0.96 }}
                        className="flex items-center gap-1 px-2 py-0.5 text-emerald-600 rounded-lg text-[10px] transition-colors"
                        style={{ background: 'rgba(22,163,74,0.08)', border: '1px solid rgba(22,163,74,0.15)' }}
                      >
                        <Save className="w-3 h-3" /> Save
                      </motion.button>
                    )}
                  </div>
                )}
                <div className="ml-2">
                  {isEditingSourceText ? (
                    <textarea
                      value={tempSourceText}
                      onChange={(e) => onTempSourceTextChange(e.target.value)}
                      className="w-full h-96 rounded-lg p-3 text-[#111827] font-mono text-xs focus:outline-none transition-colors resize-none"
                      style={{ background: '#f8fafc', border: '1px solid rgba(17,24,39,0.15)' }}
                    />
                  ) : (
                    <div className="p-3 rounded-lg text-[#64748b] whitespace-pre-wrap" style={{ background: '#f8fafc', border: '1px solid rgba(17,24,39,0.04)' }}>
                      {task.rawNovelText}
                    </div>
                  )}
                  {task.mode === 'manual' && task.sourceType === 'idea' && !isEditingSourceText && (
                    <div className="mt-3 flex gap-3">
                      <motion.button
                        onClick={onContinueStory}
                        disabled={isExpandingStory}
                        whileHover={{ scale: 1.03, y: -1 }}
                        whileTap={{ scale: 0.97 }}
                        className="flex items-center gap-2 px-3 py-1.5 text-brand-300 rounded-lg text-xs transition-colors disabled:opacity-50"
                        style={{ background: 'rgba(17,24,39,0.04)', border: '1px solid rgba(17,24,39,0.08)' }}
                      >
                        {isExpandingStory ? <Loader2 className="w-3 h-3 animate-spin" /> : <ArrowRight className="w-3 h-3" />}
                        {isExpandingStory ? 'Expanding...' : 'Continue Writing'}
                      </motion.button>
                      <motion.button
                        onClick={onRewriteStory}
                        disabled={isExpandingStory}
                        whileHover={{ scale: 1.03, y: -1 }}
                        whileTap={{ scale: 0.97 }}
                        className="flex items-center gap-2 px-3 py-1.5 text-red-600 rounded-lg text-xs transition-colors disabled:opacity-50"
                        style={{ background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.15)' }}
                      >
                        <RefreshCw className="w-3 h-3" /> Rewrite
                      </motion.button>
                    </div>
                  )}
                </div>
              </motion.div>
            )}

            {task.scriptAnalysis && (
              <motion.div variants={sectionVariants} initial="hidden" animate="visible">
                {renderLogPrefix("Gemini", "Script Analysis & Structuring")}
                <div className="ml-2 space-y-2">
                  <div className="text-brand-400/80">{'>>>'} Generating Core Plot...</div>
                  <div className="pl-2 text-[#64748b]" style={{ borderLeft: '2px solid rgba(17,24,39,0.2)' }}>{task.scriptAnalysis.corePlot}</div>
                  <div className="text-brand-400/80">{'>>>'} Analyzing Mood...</div>
                  <div className="pl-2 text-[#64748b]" style={{ borderLeft: '2px solid rgba(17,24,39,0.2)' }}>{task.scriptAnalysis.mood}</div>
                </div>
              </motion.div>
            )}

            {task.characters.length > 0 && (
              <motion.div variants={sectionVariants} initial="hidden" animate="visible">
                {renderLogPrefix("NanoBanana", "Character Definitions & Prompts")}
                <div className="ml-2 space-y-2">
                  {task.characters.map((char, i) => (
                    <div key={i} className="p-2 rounded-lg" style={{ background: '#f8fafc', border: '1px solid rgba(17,24,39,0.04)' }}>
                      <div className="text-emerald-600/80 font-medium">$ generate_character --name "{char.name}"</div>
                      <div className="mt-1 text-[#94a3b8]">Visual Features: <span className="text-[#64748b]">{char.visualFeatures}</span></div>
                      <div className="text-[#94a3b8]">Clothing: <span className="text-[#64748b]">{char.clothing}</span></div>
                      {char.threeViewImg && <div className="text-brand-400/80 text-[10px] mt-1">{'>>>'} Image generated successfully</div>}
                    </div>
                  ))}
                </div>
              </motion.div>
            )}

            {task.bigShots.length > 0 && (
              <motion.div variants={sectionVariants} initial="hidden" animate="visible">
                {renderLogPrefix("NanoBanana / Sora", "Storyboard & Video Prompts")}
                <div className="ml-2 space-y-3">
                  {task.bigShots.map((shot, i) => (
                    <div key={shot.id} className="pl-3 py-1" style={{ borderLeft: '1px solid rgba(17,24,39,0.15)' }}>
                      <div className="text-brand-400/80 font-medium mb-1">Sequence #{i + 1} [ID: {shot.id.substring(0, 8)}]</div>
                      <div className="text-[#94a3b8] mb-1">{'>>>'} NanoBanana Prompt:</div>
                      <div className="p-2 rounded-lg text-[#94a3b8] text-[10px] mb-2 break-words whitespace-pre-wrap" style={{ background: '#f8fafc' }}>{shot.storyboardPrompt}</div>
                      {shot.storyboardImageUrl && <div className="text-brand-400/80 text-[10px] mb-2">{'>>>'} Storyboard Image generated</div>}
                      {(shot.soraPromptOptimized || shot.soraPrompt) && (
                        <>
                          <div className="text-[#94a3b8] mb-1">{'>>>'} Sora 2.0 Prompt (Optimized):</div>
                          <div className="p-2 rounded-lg text-emerald-600/70 text-[10px] break-words whitespace-pre-wrap" style={{ background: '#f8fafc' }}>{shot.soraPromptOptimized || shot.soraPrompt}</div>
                        </>
                      )}
                      {shot.videoUrl && <div className="text-emerald-600/80 text-[10px] mt-1">{'>>>'} Video generation completed</div>}
                    </div>
                  ))}
                </div>
              </motion.div>
            )}

            {task.worldAnchors && task.worldAnchors.length > 0 && (
              <motion.div variants={sectionVariants} initial="hidden" animate="visible">
                <div className="flex items-center gap-1.5 mb-2">
                  <Globe className="w-3.5 h-3.5 text-blue-600" />
                  <span className="text-blue-600/80 font-medium text-xs">World Anchors</span>
                </div>
                <div className="ml-2 space-y-1.5">
                  {task.worldAnchors.map((anchor) => (
                    <div key={anchor.slot} className="flex items-center gap-2 p-2 rounded-lg" style={{ background: '#f8fafc', border: '1px solid rgba(59,130,246,0.15)' }}>
                      <span className="text-[10px] font-mono text-blue-600/70 shrink-0">Slot {anchor.slot}</span>
                      <span className="text-[10px] text-blue-500/70 shrink-0">[{anchor.category}]</span>
                      <span className="text-[10px] text-[#64748b]">{anchor.content}</span>
                      {anchor.locked && <Lock className="w-2.5 h-2.5 text-red-600/60 shrink-0" />}
                    </div>
                  ))}
                </div>
              </motion.div>
            )}

            {task.dialogueList && task.dialogueList.length > 0 && (
              <motion.div variants={sectionVariants} initial="hidden" animate="visible">
                <div className="flex items-center gap-1.5 mb-2">
                  <MessageSquare className="w-3.5 h-3.5 text-emerald-600" />
                  <span className="text-emerald-600/80 font-medium text-xs">Dialogue List ({task.dialogueList.length} lines)</span>
                </div>
                <div className="ml-2 space-y-1">
                  {task.dialogueList.map((dl) => (
                    <div key={dl.index} className="flex items-start gap-2 p-1.5 rounded-lg" style={{ background: '#f8fafc', border: '1px solid rgba(22,163,74,0.12)' }}>
                      <span className="text-[10px] font-mono text-emerald-600/60 shrink-0">{String(dl.index).padStart(2, '0')}</span>
                      <span className="text-[10px] text-emerald-600/80 shrink-0">{dl.speaker}:</span>
                      <span className="text-[10px] text-[#64748b] italic">"{dl.line}"</span>
                      <span className="text-[8px] text-[#94a3b8] shrink-0">{dl.wordCount}字</span>
                    </div>
                  ))}
                </div>
              </motion.div>
            )}

            {task.vfxBudget && task.vfxBudget.items.length > 0 && (
              <motion.div variants={sectionVariants} initial="hidden" animate="visible">
                <div className="flex items-center gap-1.5 mb-2">
                  <Zap className="w-3.5 h-3.5 text-yellow-600" />
                  <span className="text-yellow-600/80 font-medium text-xs">VFX Budget (Total: {task.vfxBudget.totalEstimatedHours}h)</span>
                </div>
                <div className="ml-2 space-y-1">
                  {task.vfxBudget.items.map((item, idx) => {
                    const levelColors: Record<string, string> = { S: 'text-red-600 bg-red-500/10', A: 'text-orange-600 bg-orange-500/10', B: 'text-yellow-600 bg-yellow-500/10', C: 'text-green-600 bg-green-500/10' };
                    return (
                      <div key={idx} className="flex items-center gap-2 p-1.5 rounded-lg" style={{ background: '#f8fafc', border: '1px solid rgba(234,179,8,0.12)' }}>
                        <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${levelColors[item.level] || levelColors.C}`}>{item.level}</span>
                        <span className="text-[10px] text-[#64748b] flex-1">{item.description}</span>
                        <span className="text-[10px] text-yellow-600/70 shrink-0">×{item.workloadMultiplier}</span>
                        <span className="text-[10px] text-yellow-600/80 shrink-0">{item.estimatedHours}h</span>
                      </div>
                    );
                  })}
                  <div className="flex items-center gap-3 mt-2 text-[10px]">
                    {Object.entries(task.vfxBudget.levelDistribution).map(([level, count]) => (
                      count > 0 && <span key={level} className="text-[#94a3b8]">{level}: {count}</span>
                    ))}
                  </div>
                </div>
              </motion.div>
            )}

            {task.rhythmAnalysis && (
              <motion.div variants={sectionVariants} initial="hidden" animate="visible">
                <RhythmChart rhythmAnalysis={task.rhythmAnalysis} t={t} />
              </motion.div>
            )}

            <div className="flex gap-2 mt-4 animate-pulse ml-2">
              <span className="w-2 h-4 bg-brand-500/50 block"></span>
            </div>
          </div>
        </div>
      </div>
    </motion.div>
  );
};
