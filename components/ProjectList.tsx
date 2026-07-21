import React, { useMemo, useState } from 'react';
import { Plus, Download, UploadCloud } from 'lucide-react';
import { DramaTask, TaskStatus } from '../types';
import { TaskCard } from './TaskCard';

type WorkshopTab = 'all' | 'active' | 'done';

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
  searchQuery = '',
  onQuickCreate,
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
  /** 顶栏搜索框的过滤词（客户端名称过滤，纯展示层）。 */
  searchQuery?: string;
  /** 空状态 Suno 式 prompt bar 的快速创建（传入项目名）。 */
  onQuickCreate?: (name: string) => void;
  t: any;
  lang: string;
}) => {
  const [activeTab, setActiveTab] = useState<WorkshopTab>('all');
  const [quickName, setQuickName] = useState('');
  const hasProjects = tasks.length > 0;

  const visibleTasks = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return tasks.filter((task) => {
      if (q && !task.name.toLowerCase().includes(q)) return false;
      if (activeTab === 'active') {
        return task.status !== TaskStatus.IDLE && task.status !== TaskStatus.COMPLETED && task.status !== TaskStatus.FAILED;
      }
      if (activeTab === 'done') {
        return task.status === TaskStatus.COMPLETED;
      }
      return true;
    });
  }, [tasks, searchQuery, activeTab]);

  const tabs: { id: WorkshopTab; label: string }[] = [
    { id: 'all', label: t('tabAll') },
    { id: 'active', label: t('tabInProgress') },
    { id: 'done', label: t('tabCompleted') },
  ];

  if (!hasProjects) {
    /* ─── 空状态：Suno 式沉浸首屏 —— 居中大标题 + prompt bar + 渐变 Create ─── */
    const quickCreate = () => {
      const name = quickName.trim();
      if (!name) return;
      if (onQuickCreate) {
        onQuickCreate(name);
      } else {
        onNewTask();
      }
    };
    return (
      <div className="min-h-[calc(100vh-3.5rem)] flex flex-col items-center justify-center px-8 text-center">
        <input type="file" accept=".json" ref={(ref) => setImportFileInputRef(ref)} onChange={onImportProject} className="hidden" />

        <div className="mb-7 px-4 py-1.5 rounded-full border border-white/[0.10] bg-white/[0.04] backdrop-blur-xl text-[11px] font-medium tracking-[0.22em] uppercase text-white/55 animate-fade-in-up opacity-0" style={{ animationDelay: '0.05s' }}>
          {t('heroTagline')}
        </div>

        <h1 className="text-[52px] md:text-[64px] leading-[1.04] font-semibold tracking-[-0.03em] text-white animate-fade-in-up opacity-0" style={{ animationDelay: '0.15s' }}>
          {t('heroTitle1')}<br />
          {t('heroTitle2')}{' '}<span className="warm-gradient-text">{t('heroTitleHighlight')}</span>
        </h1>

        <p className="mt-6 text-[15px] leading-relaxed text-white/50 max-w-lg animate-fade-in-up opacity-0" style={{ animationDelay: '0.25s' }}>
          {t('heroDesc')}
        </p>

        {/* Suno prompt bar */}
        <div className="mt-11 w-full max-w-xl flex items-center gap-2 rounded-2xl border border-white/[0.10] bg-white/[0.05] backdrop-blur-2xl p-2 pl-5 shadow-[0_24px_64px_-24px_rgba(0,0,0,0.7)] animate-fade-in-up opacity-0" style={{ animationDelay: '0.35s' }}>
          <input
            value={quickName}
            onChange={(e) => setQuickName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') quickCreate(); }}
            placeholder={t('projectNamePlaceholder')}
            autoFocus
            className="flex-1 h-11 bg-transparent text-[15px] text-white placeholder:text-white/35 focus:outline-none"
          />
          <button
            onClick={quickCreate}
            disabled={!quickName.trim()}
            className="cta-primary btn-press h-11 px-6 rounded-xl font-semibold text-sm flex items-center gap-2 flex-shrink-0 disabled:opacity-40 disabled:cursor-not-allowed disabled:shadow-none"
          >
            <Plus className="w-4 h-4" />
            <span>{t('createProject')}</span>
          </button>
        </div>

        <button
          onClick={() => importFileInputRef?.click()}
          className="mt-6 flex items-center gap-1.5 text-[13px] text-white/40 hover:text-white/75 transition-colors animate-fade-in-up opacity-0" style={{ animationDelay: '0.45s' }}
        >
          <UploadCloud className="w-3.5 h-3.5" />
          <span>{t('importProject') || 'Import'}</span>
        </button>
      </div>
    );
  }

  return (
    <div id="project-workshop" className="px-8 lg:px-10 pb-12 pt-8 page-transition-enter">
      {/* ─── 页头：大标题 + tab 下划线 + 右侧动作（brief §3） ─── */}
      <div className="flex items-end justify-between gap-4 mb-2">
        <div>
          <h1 className="text-[32px] font-semibold text-white tracking-[-0.025em] leading-tight">{t('workshopTitle')}</h1>
          <p className="text-[13px] text-white/45 mt-1.5" data-testid="projects-workshop-hint">
            {t('projectsWorkshopHint')}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <input type="file" accept=".json" ref={(ref) => setImportFileInputRef(ref)} onChange={onImportProject} className="hidden" />
          <button
            onClick={() => importFileInputRef?.click()}
            className="px-3.5 py-2 bg-white/[0.045] hover:bg-white/[0.09] border border-white/[0.06] backdrop-blur-xl text-white/60 hover:text-[#F5F5F7] rounded-full font-medium flex items-center gap-1.5 transition-all text-xs"
          >
            <UploadCloud className="w-3.5 h-3.5" />
            <span>{t('importProject') || 'Import'}</span>
          </button>
          <button
            onClick={onExportAll}
            className="px-3.5 py-2 bg-white/[0.045] hover:bg-white/[0.09] border border-white/[0.06] backdrop-blur-xl text-white/60 hover:text-[#F5F5F7] rounded-full font-medium flex items-center gap-1.5 transition-all text-xs"
          >
            <Download className="w-3.5 h-3.5" />
            <span>{t('exportAll') || 'Export All'}</span>
          </button>
          <button
            onClick={onNewTask}
            className="btn-press cta-primary group inline-flex items-center gap-1.5 px-4 py-2 rounded-full font-semibold text-xs"
          >
            <Plus className="w-3.5 h-3.5 group-hover:rotate-90 transition-transform duration-300" />
            <span>{t('newProject')}</span>
          </button>
        </div>
      </div>

      {/* ─── Tab 下划线 ─── */}
      <div className="flex items-center gap-6 border-b border-white/[0.07] mb-6">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`relative pb-2.5 pt-3 text-[13px] transition-colors ${
              activeTab === tab.id ? 'text-[#F5F5F7] font-medium' : 'text-white/40 hover:text-white/70'
            }`}
          >
            {tab.label}
            {activeTab === tab.id && (
              <span className="absolute left-0 right-0 -bottom-px h-[2px] rounded-full warm-gradient-bar" />
            )}
          </button>
        ))}
        <div className="flex-1" />
        <span className="pb-2.5 text-[11px] font-mono text-white/35">
          {visibleTasks.length} {visibleTasks.length > 1 ? t('projectsCount') : t('projectCount')}
        </span>
      </div>

      {/* ─── 项目卡网格 ─── */}
      {visibleTasks.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {visibleTasks.map((task, idx) => (
            <div key={task.id} className="animate-fade-in-up opacity-0" style={{ animationDelay: `${0.05 + idx * 0.06}s` }}>
              <TaskCard task={task} onClick={() => onSelectTask(task.id)} onDelete={() => onDeleteTask(task.id)} onExport={() => onExportTask(task.id)} onOpenStudio={() => onOpenStudio(task.id)} t={t} />
            </div>
          ))}
        </div>
      ) : (
        <div className="py-16 text-center text-sm text-white/35">{t('noProjects')}</div>
      )}
    </div>
  );
};
