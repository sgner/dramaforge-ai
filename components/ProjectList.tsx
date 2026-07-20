import React from 'react';
import { Plus, Download, UploadCloud, ArrowRight, Film, Sparkles, Diamond, Frame, Play } from 'lucide-react';
import { DramaTask } from '../types';
import { TaskCard } from './TaskCard';
import { PipelineStream } from './StreamingPreview';

export const ProjectList = ({
  tasks,
  onNewTask,
  onImportProject,
  onExportAll,
  onSelectTask,
  onDeleteTask,
  onExportTask,
  onOpenStudio,
  importFileInputRef,
  setImportFileInputRef,
  t,
  lang
}: {
  tasks: DramaTask[];
  onNewTask: () => void;
  onImportProject: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onExportAll: () => void;
  onSelectTask: (id: string) => void;
  onDeleteTask: (id: string) => void;
  onExportTask: (id: string) => void;
  onOpenStudio: (id: string) => void;
  importFileInputRef: HTMLInputElement | null;
  setImportFileInputRef: (ref: HTMLInputElement | null) => void;
  t: any;
  lang: string;
}) => {
  const hasProjects = tasks.length > 0;

  return (
    <div>
      {hasProjects ? (
        <>
          {/* ─── Compact Hero ─── */}
          <div className="relative overflow-hidden border-b border-[#e8edf3]" style={{ height: '280px' }}>
            <div className="absolute inset-0 overflow-hidden pointer-events-none">
              <div className="absolute inset-0" style={{ background: 'radial-gradient(ellipse 60% 80% at 70% 50%, rgba(17,24,39,0.10), transparent)' }} />
              <div className="absolute right-0 top-0 bottom-0 w-[50%] opacity-30">
                <PipelineStream localeKey={lang} />
              </div>
            </div>

            <div className="relative z-10 flex items-end h-full px-8 lg:px-12 pb-10">
              <div className="flex items-end justify-between w-full">
                <div>
                  <div className="flex items-center gap-2 mb-3">
                    <div className="h-px w-8 bg-gradient-to-r from-brand-500/60 to-transparent"></div>
                    <span className="text-[10px] font-mono uppercase tracking-[0.25em] text-brand-400/70 font-semibold">{t('heroTagline')}</span>
                  </div>
                  <h1 className="text-3xl lg:text-4xl font-bold text-[#111827] leading-tight tracking-tight">
                    {t('heroTitle1')} {t('heroTitle2')} <span className="gradient-text">{t('heroTitleHighlight')}</span>
                  </h1>
                </div>

                <div className="flex items-center gap-2">
                  <input type="file" accept=".json" ref={(ref) => setImportFileInputRef(ref)} onChange={onImportProject} className="hidden" />
                  <button onClick={() => importFileInputRef?.click()} className="px-3 py-2 bg-black/[0.04] hover:bg-black/[0.06] text-[#64748b] hover:text-[#111827] rounded-lg font-medium flex items-center gap-1.5 transition-all text-xs">
                    <UploadCloud className="w-3.5 h-3.5" />
                    <span>{t('importProject') || 'Import'}</span>
                  </button>
                  <button onClick={onExportAll} className="px-3 py-2 bg-black/[0.04] hover:bg-black/[0.06] text-[#64748b] hover:text-[#111827] rounded-lg font-medium flex items-center gap-1.5 transition-all text-xs">
                    <Download className="w-3.5 h-3.5" />
                    <span>{t('exportAll') || 'Export All'}</span>
                  </button>
                  <button onClick={onNewTask} className="group inline-flex items-center gap-2 px-5 py-2.5 bg-brand-600 hover:bg-brand-500 text-white rounded-xl font-semibold transition-all shadow-lg shadow-brand-600/20 hover:shadow-brand-600/30 hover:-translate-y-0.5 btn-press">
                    <Plus className="w-4 h-4 group-hover:rotate-90 transition-transform duration-300" />
                    <span className="text-xs tracking-wide">{t('newProject')}</span>
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* ─── Projects Grid ─── */}
          <div className="relative px-8 lg:px-12 pb-12 pt-8">
            <div className="flex items-center justify-between mb-6">
              <div>
                <h3 className="text-xl font-bold text-[#111827] tracking-tight">{t('workshopTitle')}</h3>
                <p className="text-xs text-[#94a3b8] mt-1" data-testid="projects-workshop-hint">
                  {t('projectsWorkshopHint')}
                </p>
              </div>
              <span className="text-xs font-mono text-[#94a3b8]">{tasks.length} {tasks.length > 1 ? t('projectsCount') : t('projectCount')}</span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
              {tasks.map((task, idx) => (
                <div key={task.id} className="animate-fade-in-up opacity-0" style={{ animationDelay: `${0.1 + idx * 0.08}s` }}>
                  <TaskCard task={task} onClick={() => onSelectTask(task.id)} onDelete={() => onDeleteTask(task.id)} onExport={() => onExportTask(task.id)} onOpenStudio={() => onOpenStudio(task.id)} t={t} />
                </div>
              ))}
            </div>
          </div>
        </>
      ) : (
        <>
          {/* ─── Empty State Hero ─── */}
          <div className="relative overflow-hidden" style={{ height: 'calc(100vh - 4rem)' }}>
            <div className="absolute inset-0 overflow-hidden pointer-events-none">
              <div className="absolute inset-0" style={{ background: 'radial-gradient(ellipse 70% 60% at 70% 50%, rgba(17,24,39,0.12), transparent)' }} />
              <div className="absolute right-0 top-0 bottom-0 w-[55%] opacity-40">
                <PipelineStream localeKey={lang} />
              </div>
            </div>

            <div className="relative z-10 flex flex-col justify-center px-8 lg:px-12 h-full">
              <div className="max-w-xl">
                <div className="flex items-center gap-3 mb-6 animate-fade-in-up opacity-0" style={{ animationDelay: '0.1s' }}>
                  <div className="h-px flex-1 max-w-[60px] bg-gradient-to-r from-brand-500/60 to-transparent"></div>
                  <span className="text-[10px] font-mono uppercase tracking-[0.25em] text-brand-400/70 font-semibold">{t('heroTagline')}</span>
                </div>

                <h1 className="text-5xl lg:text-6xl xl:text-7xl font-bold text-[#111827] leading-[1.05] mb-6 animate-fade-in-up opacity-0 tracking-tight" style={{ animationDelay: '0.2s' }}>
                  {t('heroTitle1')}<br />
                  {t('heroTitle2')} <span className="gradient-text">{t('heroTitleHighlight')}</span>
                </h1>

                <p className="text-[#64748b] text-lg leading-relaxed max-w-md mb-8 animate-fade-in-up opacity-0" style={{ animationDelay: '0.35s' }}>
                  {t('heroDesc')}
                </p>

                <div className="flex flex-wrap gap-2 mb-10 animate-fade-in-up opacity-0" style={{ animationDelay: '0.5s' }}>
                  {[
                    { label: t('featScriptGen'), icon: Sparkles },
                    { label: t('featCharDesign'), icon: Diamond },
                    { label: t('featStoryboard'), icon: Frame },
                    { label: t('featVideoRender'), icon: Play },
                  ].map((feat) => (
                    <div key={feat.label} className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-black/[0.04] border border-[#e8edf3] text-xs text-[#64748b]">
                      <feat.icon className="w-3 h-3 text-brand-400/60" />
                      {feat.label}
                    </div>
                  ))}
                </div>

                <div className="flex items-center gap-3 animate-fade-in-up opacity-0" style={{ animationDelay: '0.65s' }}>
                  <input type="file" accept=".json" ref={(ref) => setImportFileInputRef(ref)} onChange={onImportProject} className="hidden" />
                  <button onClick={() => importFileInputRef?.click()} className="px-4 py-2.5 bg-black/[0.04] hover:bg-black/[0.06] text-[#64748b] hover:text-[#111827] rounded-xl font-medium flex items-center gap-2 transition-all text-sm">
                    <UploadCloud className="w-4 h-4" />
                    <span>{t('importProject') || 'Import'}</span>
                  </button>
                  <button onClick={onExportAll} className="px-4 py-2.5 bg-black/[0.04] hover:bg-black/[0.06] text-[#64748b] hover:text-[#111827] rounded-xl font-medium flex items-center gap-2 transition-all text-sm">
                    <Download className="w-4 h-4" />
                    <span>{t('exportAll') || 'Export All'}</span>
                  </button>
                  <button onClick={onNewTask} className="group inline-flex items-center gap-2.5 px-7 py-3 bg-brand-600 hover:bg-brand-500 text-white rounded-2xl font-semibold transition-all shadow-lg shadow-brand-600/20 hover:shadow-brand-600/30 hover:-translate-y-0.5 btn-press">
                    <Plus className="w-5 h-5 group-hover:rotate-90 transition-transform duration-300" />
                    <span className="tracking-wide text-sm">{t('newProject')}</span>
                    <ArrowRight className="w-4 h-4 opacity-0 group-hover:opacity-100 group-hover:translate-x-1 transition-all" />
                  </button>
                </div>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
};
