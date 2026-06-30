import React from 'react';
import { motion } from 'framer-motion';
import { TaskStatus } from '../types';

const LOGICAL_STEPS = [
  TaskStatus.PREPROCESSING,
  TaskStatus.SCRIPT_GENERATION,
  TaskStatus.CHARACTER_DESIGN,
  TaskStatus.PROP_DESIGN,
  TaskStatus.SCENE_DESIGN,
  TaskStatus.STORYBOARDING,
  TaskStatus.PROMPT_OPTIMIZATION,
  TaskStatus.COMPLETED
];

export const StepProgress = ({ status, stepStatus, progress, sourceType, t }: {
  status: TaskStatus;
  stepStatus: string;
  progress: number;
  sourceType?: 'novel' | 'idea';
  t: any;
}) => {
  const getStepLabelKey = (step: TaskStatus, srcType?: 'novel' | 'idea') => {
    if (step === TaskStatus.PREPROCESSING) return srcType === 'idea' ? 'step_expansion' : 'step_structuring';
    return step;
  };

  const currentStepIndex = LOGICAL_STEPS.indexOf(status);

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1], delay: 0.1 }}
    >
      <div className="flex items-center gap-2 mb-3">
        <span className="text-[#94a3b8] text-[10px] font-mono uppercase tracking-wider font-medium">{t('stepProgress')}</span>
        <div className="flex-1 h-px" style={{ background: 'rgba(17,24,39,0.06)' }} />
        <motion.span
          key={progress}
          initial={{ scale: 1.2, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          className="text-brand-400 font-mono text-[10px] font-medium"
        >
          {progress}%
        </motion.span>
      </div>

      <div className="flex items-center gap-1">
        {LOGICAL_STEPS.map((step, idx) => {
          const isCompleted = currentStepIndex > idx || status === TaskStatus.COMPLETED;
          const isCurrent = status === step;
          const isProcessing = isCurrent && stepStatus === 'processing';

          return (
            <React.Fragment key={step}>
              <motion.div
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: idx * 0.03, duration: 0.3 }}
                className="group relative flex items-center justify-center"
                title={t(getStepLabelKey(step, sourceType))}
              >
                <motion.div
                  className={`rounded-full transition-all duration-500 flex items-center justify-center ${
                    isCompleted
                      ? 'w-6 h-6'
                      : isCurrent
                        ? 'w-7 h-7'
                        : 'w-5 h-5'
                  }`}
                  style={
                    isCompleted
                      ? { background: 'rgba(17,24,39,0.08)', border: '1px solid rgba(17,24,39,0.3)' }
                      : isCurrent
                        ? { background: 'rgba(17,24,39,0.06)', border: '1px solid rgba(17,24,39,0.25)' }
                        : { background: 'rgba(17,24,39,0.03)', border: '1px solid rgba(17,24,39,0.08)' }
                  }
                  animate={isProcessing ? { scale: [1, 1.1, 1] } : {}}
                  transition={isProcessing ? { repeat: Infinity, duration: 2, ease: 'easeInOut' } : {}}
                >
                  {isCompleted ? (
                    <motion.div
                      initial={{ scale: 0 }}
                      animate={{ scale: 1 }}
                      className="w-2 h-2 rounded-full"
                      style={{ background: '#374151' }}
                    />
                  ) : isProcessing ? (
                    <motion.div
                      className="w-2 h-2 rounded-full"
                      style={{ background: 'rgba(55,65,81,0.6)' }}
                      animate={{ scale: [0.6, 1, 0.6], opacity: [0.4, 1, 0.4] }}
                      transition={{ repeat: Infinity, duration: 1.5 }}
                    />
                  ) : isCurrent ? (
                    <div className="w-1.5 h-1.5 rounded-full" style={{ background: 'rgba(55,65,81,0.5)' }} />
                  ) : null}
                </motion.div>

                {isCurrent && (
                  <motion.div
                    className="absolute -inset-2 rounded-full border border-brand-400/15"
                    animate={{ scale: [1, 1.15, 1], opacity: [0.3, 0.6, 0.3] }}
                    transition={{ repeat: Infinity, duration: 2 }}
                  />
                )}

                <div className="absolute -bottom-5 left-1/2 -translate-x-1/2 whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-50">
                  <span className="text-[9px] font-mono uppercase tracking-wider text-brand-400 px-1.5 py-0.5 rounded" style={{ background: 'rgba(255,255,255,0.95)', border: '1px solid #e8edf3' }}>
                    {t(getStepLabelKey(step, sourceType))}
                  </span>
                </div>
              </motion.div>

              {idx < LOGICAL_STEPS.length - 1 && (
                <div className="flex-1 h-px min-w-[4px]" style={{
                  background: isCompleted
                    ? 'rgba(17,24,39,0.25)'
                    : 'rgba(17,24,39,0.08)'
                }} />
              )}
            </React.Fragment>
          );
        })}
      </div>
    </motion.div>
  );
};
