import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Film, Globe, Settings, ArrowLeft, RotateCw, Loader2, AlertTriangle, PlayCircle, SkipForward, XOctagon, Sparkles, BookOpen, XCircle, CheckCircle, AlertCircle, Info, Shield, ChevronDown, PanelLeftClose, PanelLeftOpen, ChevronRight, Users, Clapperboard, Terminal, ChevronUp, UserPlus, User } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { NewTaskModal } from './components/NewTaskModal';
import { EditCharacterModal } from './components/EditCharacterModal';
import { ImageLightbox } from './components/ImageLightbox';

import { ConfirmModal } from './components/ConfirmModal';
import { ApiSettingsModal } from './components/infinite-canvas/ApiSettingsModal';
import { BigShotDetailModal } from './components/BigShotDetailModal';
import { InfiniteCanvas } from './components/infinite-canvas';
import { useCanvasStore } from './components/infinite-canvas/use-canvas-store';
import { TaskAssetRef } from './components/infinite-canvas/types';
import { AssetCheckReport } from './components/AssetCheckReport';
import { TitleEndCardEditor } from './components/TitleEndCardEditor';
import { runAssetCheck, AssetCheckResult } from './utils/assetChecker';
import { ProjectList } from './components/ProjectList';
import { DramaTask, TaskStatus, ArtStyle, BigShot, Character, Language, TaskMode, ApiConfig, ProcessedSegment, createDefaultApiConfig } from './types';
import { storageService } from './services/storageService';
import { useTaskExecutor } from './hooks/useTaskExecutor';
import { useTaskActions } from './hooks/useTaskActions';
import { I18nProvider, useI18n } from './i18n';
import { AgentMode } from './agent/agent-mode';

const STORAGE_KEY_TASKS = 'dramaforge_tasks';
const STORAGE_KEY_LANG = 'dramaforge_language';
const STORAGE_KEY_API_CONFIG = 'dramaforge_apiconfig';

const LOGICAL_STEPS = [
  TaskStatus.PREPROCESSING,
  TaskStatus.SCRIPT_GENERATION,
  TaskStatus.CHARACTER_DESIGN,
  TaskStatus.STORYBOARDING,
  TaskStatus.PROMPT_OPTIMIZATION,
  TaskStatus.COMPLETED
];

const genId = () => {
  try { return crypto.randomUUID(); } catch { return 'id-' + Math.random().toString(36).slice(2) + Date.now().toString(36); }
};

export default function App() {
  return (
    <I18nProvider>
      <AppContent />
    </I18nProvider>
  );
}

function AppContent() {
  const [tasks, setTasks] = useState<DramaTask[]>([]);
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
  const [isNewTaskModalOpen, setIsNewTaskModalOpen] = useState(false);
  const { lang, setLang, t } = useI18n();
  const [confirmModal, setConfirmModal] = useState<{ isOpen: boolean; title: string; message: string; onConfirm: () => void; }>({ isOpen: false, title: '', message: '', onConfirm: () => {} });
  const [editingCharacter, setEditingCharacter] = useState<Character | null>(null);
  const [isExpandingStory, setIsExpandingStory] = useState(false);
  const [lightboxImage, setLightboxImage] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'list' | 'tree'>('list');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [selectedShotConfig, setSelectedShotConfig] = useState<{ id: string; initialEdit: boolean } | null>(null);
  const [isEditingSourceText, setIsEditingSourceText] = useState(false);
  const [tempSourceText, setTempSourceText] = useState('');
  const [uploadingCharName, setUploadingCharName] = useState<string | null>(null);
  const [importFileInputRef, setImportFileInputRef] = useState<HTMLInputElement | null>(null);
  const [viewingSegment, setViewingSegment] = useState<ProcessedSegment | null>(null);
  const [apiConfig, setApiConfig] = useState<ApiConfig>(createDefaultApiConfig());
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [assetCheckResult, setAssetCheckResult] = useState<AssetCheckResult | null>(null);
  const [isTitleEndCardOpen, setIsTitleEndCardOpen] = useState(false);
  const [toasts, setToasts] = useState<{ id: number; type: 'success' | 'error' | 'info'; message: string; exiting?: boolean }[]>([]);
  const [celebration, setCelebration] = useState<{ x: number; y: number; id: number } | null>(null);
  const [pageKey, setPageKey] = useState(0);
  const [newProjectName, setNewProjectName] = useState('');
  const [isNewProjectModalOpen, setIsNewProjectModalOpen] = useState(false);
  const [agentMode, setAgentMode] = useState(() => {
    if (typeof window === 'undefined') return false;
    return new URLSearchParams(window.location.search).get('agent') === '1';
  });
  const toastIdRef = useRef(0);
  const prevTaskStatuses = useRef<Record<string, TaskStatus>>({});

  const addToast = useCallback((type: 'success' | 'error' | 'info', message: string) => {
    const id = ++toastIdRef.current;
    setToasts(prev => [...prev, { id, type, message }]);
    setTimeout(() => {
      setToasts(prev => prev.map(t => t.id === id ? { ...t, exiting: true } : t));
      setTimeout(() => {
        setToasts(prev => prev.filter(t => t.id !== id));
      }, 300);
    }, 3000);
  }, []);

  // Agent Mode 入口需要 activeTask：URL ?agent=1 时若没有活动任务，自动选/建一个。
  useEffect(() => {
    if (!agentMode) return;
    if (activeTaskId) return;
    let targetId: string;
    if (tasks.length > 0) {
      targetId = tasks[0].id;
    } else {
      const newTask: DramaTask = {
        id: genId(),
        name: 'Agent Demo',
        style: ArtStyle.REALISTIC,
        language: 'zh',
        mode: 'auto',
        sourceType: 'idea',
        createdAt: Date.now(),
        status: TaskStatus.IDLE,
        stepStatus: 'idle',
        progress: 0,
        rawNovelText: '',
        originalIdea: undefined,
        characters: [],
        bigShots: [],
      };
      setTasks(prev => [newTask, ...prev]);
      targetId = newTask.id;
    }
    setActiveTaskId(targetId);
  }, [agentMode, activeTaskId, tasks]);

  const triggerCelebration = useCallback((x: number, y: number) => {
    const id = Date.now();
    setCelebration({ x, y, id });
    setTimeout(() => setCelebration(null), 1500);
  }, []);

  useEffect(() => {
    const savedTasks = storageService.loadTasks();
    if (savedTasks && savedTasks.length > 0) {
      setTasks(savedTasks);
    } else {
      const backupTasks = storageService.loadFromBackup();
      if (backupTasks && backupTasks.length > 0) {
        setTasks(backupTasks);
      }
    }
    const savedConfig = localStorage.getItem(STORAGE_KEY_API_CONFIG);
    if (savedConfig) {
        try {
            const parsed = JSON.parse(savedConfig);
            if (parsed.providers && parsed.models && parsed.stepBindings) {
                setApiConfig(parsed);
            } else if (parsed.geminiKey !== undefined) {
                const migrated = createDefaultApiConfig();
                const geminiProvider = migrated.providers.find(p => p.id === 'google-gemini');
                const nanoProvider = migrated.providers.find(p => p.id === 'nanobanana');
                const soraProvider = migrated.providers.find(p => p.id === 'sora');
                if (geminiProvider) {
                    geminiProvider.apiKey = parsed.geminiKey || '';
                    geminiProvider.baseUrl = parsed.geminiBaseUrl || 'https://generativelanguage.googleapis.com';
                }
                if (nanoProvider) {
                    nanoProvider.apiKey = parsed.nanobananaKey || '';
                    nanoProvider.baseUrl = parsed.nanobananaBaseUrl || 'https://api.nanobanana.com';
                }
                if (soraProvider) {
                    soraProvider.apiKey = parsed.soraKey || '';
                    soraProvider.baseUrl = parsed.soraBaseUrl || 'https://api.sora.com';
                }
                setApiConfig(migrated);
                localStorage.setItem(STORAGE_KEY_API_CONFIG, JSON.stringify(migrated));
            }
        } catch (e) {
            console.error("Failed to parse saved api config", e);
        }
    }
  }, []);

  const saveTasksTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (saveTasksTimerRef.current) clearTimeout(saveTasksTimerRef.current);
    saveTasksTimerRef.current = setTimeout(() => {
      storageService.saveTasks(tasks);
    }, 500);
    return () => {
      if (saveTasksTimerRef.current) clearTimeout(saveTasksTimerRef.current);
    };
  }, [tasks]);

  useEffect(() => {
    tasks.forEach(task => {
      const prevStatus = prevTaskStatuses.current[task.id];
      if (prevStatus && prevStatus !== task.status) {
        if (task.status === TaskStatus.COMPLETED) {
          addToast('success', `${task.name} - ${t('completed') || 'Completed'}!`);
          triggerCelebration(window.innerWidth / 2, window.innerHeight / 2);
        } else if (task.status === TaskStatus.FAILED) {
          addToast('error', `${task.name} - ${t('stepFailed') || 'Failed'}`);
        } else if (prevStatus === TaskStatus.IDLE && task.status !== TaskStatus.IDLE) {
          addToast('info', `${task.name} - ${t(task.status)}`);
        }
      }
      prevTaskStatuses.current[task.id] = task.status;
    });
  }, [tasks, addToast, triggerCelebration, t]);

  const handleSaveConfig = (newConfig: ApiConfig) => {
    setApiConfig(newConfig);
    localStorage.setItem(STORAGE_KEY_API_CONFIG, JSON.stringify(newConfig));
    setIsSettingsOpen(false);
  };

  const updateTask = useCallback((taskId: string, updates: Partial<DramaTask>) => {
    setTasks(prev => prev.map(t => t.id === taskId ? { ...t, ...updates } : t));
  }, []);

  const activeTask = tasks.find(t => t.id === activeTaskId);

  const setTaskAssets = useCanvasStore((s) => s.setTaskAssets);

  // Sync task assets (characters, scenes, storyboards, props) to canvas store
  // 采用合并策略：保留 Pipeline 生成/手动添加的资产，只合并 activeTask 派生的资产
  useEffect(() => {
    // 在 effect 内部读取最新 taskAssets，避免依赖循环
    const currentTaskAssets = useCanvasStore.getState().taskAssets;
    if (!activeTask) {
      // 仅清除 activeTask 派生的资产（id 以 char_/scene_/shot_/prop_ 开头），保留其他
      const kept = currentTaskAssets.filter(a =>
        !a.id.startsWith('char_') && !a.id.startsWith('scene_') &&
        !a.id.startsWith('shot_') && !a.id.startsWith('prop_')
      );
      setTaskAssets(kept);
      return;
    }
    const refs: TaskAssetRef[] = [];
    (activeTask.characters || []).forEach((c) => {
      if (c.threeViewImg) {
        refs.push({ id: `char_${c.name}`, kind: 'character', name: c.name, url: c.threeViewImg, tags: [t('assetTagCharacter')] });
      }
    });
    (activeTask.sceneAssets || []).forEach((s, i) => {
      if (s.imageUrl) {
        refs.push({ id: `scene_${i}`, kind: 'scene', name: s.mainStructure || t('assetDefaultSceneName').replace('{0}', String(i + 1)), url: s.imageUrl, tags: [t('assetTagBackground')] });
      }
    });
    (activeTask.bigShots || []).forEach((b) => {
      if (b.storyboardImageUrl) {
        refs.push({ id: `shot_${b.id}`, kind: 'storyboard', name: t('assetDefaultShotName').replace('{0}', String(b.id)), url: b.storyboardImageUrl, tags: [t('assetTagStoryboard')] });
      }
    });
    (activeTask.props || []).forEach((p) => {
      if (p.imageUrl) {
        refs.push({ id: `prop_${p.id}`, kind: 'prop', name: p.name, url: p.imageUrl, tags: [t('assetTagProp')] });
      }
    });
    // 合并：移除旧的 activeTask 派生资产，保留 Pipeline/手动添加的资产，再加入新的
    const kept = currentTaskAssets.filter(a =>
      !a.id.startsWith('char_') && !a.id.startsWith('scene_') &&
      !a.id.startsWith('shot_') && !a.id.startsWith('prop_')
    );
    setTaskAssets([...kept, ...refs]);
  }, [activeTask, setTaskAssets, t]);

  useEffect(() => {
    if (activeTask) {
      setTempSourceText(activeTask.rawNovelText);
    }
  }, [activeTask?.rawNovelText]);

  const { executeTaskStep, proceedToNextStep, cancelTask, updateBigShotStatus } = useTaskExecutor(tasks, setTasks, apiConfig, updateTask);

  const {
    charFileInputRef,
    handleSaveSourceText,
    handleContinueStory,
    handleRewriteStory,
    deleteTask,
    exportProject,
    exportAllProjects,
    handleImportProject,
    createTask,
    handleAddCharacter,
    handleDeleteCharacter,
    handleUploadReferenceTrigger,
    handleRefFileChange,
    handleAddShot,
    handleDeleteShot,
    regenerateSingleCharacter,
    regenerateSingleShot,
    regenerateSinglePrompt,
    handleGenerateEpisodeSummary,
    handleInheritFromPreviousEpisode,
    handleCreateNextEpisode
  } = useTaskActions(
    tasks, setTasks, activeTaskId, setActiveTaskId, apiConfig, updateTask,
    executeTaskStep, setConfirmModal, setIsNewTaskModalOpen, lang, t,
    setIsExpandingStory, setIsEditingSourceText, tempSourceText,
    uploadingCharName, setUploadingCharName, updateBigShotStatus
  );

  const changeLanguage = (newLang: Language) => {
    setLang(newLang);
  };

  useEffect(() => {
    if (activeTask?.mode === 'auto' && activeTask.status !== TaskStatus.COMPLETED && activeTask.status !== TaskStatus.FAILED && activeTask.stepStatus === 'completed') {
      const next = LOGICAL_STEPS[LOGICAL_STEPS.indexOf(activeTask.status) + 1];
      if (next) {
        setTimeout(() => executeTaskStep(activeTask.id, next), 500);
      }
    }
  }, [activeTask?.stepStatus, activeTask?.status, executeTaskStep]);

  const currentShotInTask = activeTask?.bigShots.find(s => s.id === selectedShotConfig?.id);

  const getStepLabelKey = (step: TaskStatus, sourceType?: 'novel' | 'idea') => {
      if (step === TaskStatus.PREPROCESSING) return sourceType === 'idea' ? 'step_expansion' : 'step_structuring';
      return step;
  };

  return (
    <div className="min-h-screen bg-[#f8fafc] text-[#111827] font-sans selection:bg-brand-600/20 overflow-x-hidden">
      <input type="file" accept="image/*" ref={charFileInputRef} onChange={handleRefFileChange} className="hidden" />

      {agentMode && (
        <div style={{ position: 'fixed', top: 12, right: 16, zIndex: 100, display: 'flex', gap: 8 }}>
          <button
            data-testid="exit-agent-mode"
            onClick={() => { setAgentMode(false); setActiveTaskId(null); }}
            style={{ padding: '6px 12px', borderRadius: 8, border: '1px solid #cbd5e1', background: 'white', cursor: 'pointer', fontSize: 13, boxShadow: '0 2px 8px rgba(0,0,0,0.06)' }}
          >
            ← 退出 Agent Mode
          </button>
        </div>
      )}

      {agentMode && activeTask ? (
        <AgentMode projectId={activeTask.id} />
      ) : (
        <>
      <div className="fixed inset-0 z-0 pointer-events-none">
        <div className="absolute inset-0" style={{ background: 'radial-gradient(ellipse 80% 50% at 50% -20%, rgba(17,24,39,0.03), transparent)' }} />
      </div>

      {!activeTask && (
      <header className="sticky top-0 z-40 glass border-b border-[#e8edf3]">
        <div className="px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3 cursor-pointer group" onClick={() => setActiveTaskId(null)}>
            <div className="w-9 h-9 bg-brand-600 rounded-xl flex items-center justify-center shadow-lg shadow-brand-600/20 group-hover:scale-105 transition-all duration-300">
              <Film className="w-5 h-5 text-white" />
            </div>
            <h1 className="text-lg font-bold gradient-text-animated tracking-tight">
              {t('appTitle')}
            </h1>
          </div>
          <div className="flex items-center gap-2">
            <button
              data-testid="enter-agent-mode"
              onClick={() => {
                let targetId = activeTaskId;
                if (!targetId) {
                  if (tasks.length > 0) {
                    targetId = tasks[0].id;
                  } else {
                    const newTask: DramaTask = {
                      id: genId(),
                      name: 'Agent Demo',
                      style: ArtStyle.REALISTIC,
                      language: 'zh',
                      mode: 'auto',
                      sourceType: 'idea',
                      createdAt: Date.now(),
                      status: TaskStatus.IDLE,
                      stepStatus: 'idle',
                      progress: 0,
                      rawNovelText: '',
                      originalIdea: undefined,
                      characters: [],
                      bigShots: [],
                    };
                    setTasks(prev => [newTask, ...prev]);
                    targetId = newTask.id;
                  }
                  setActiveTaskId(targetId);
                }
                setAgentMode(true);
              }}
              className="px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 bg-gradient-to-r from-indigo-500 to-purple-500 text-white hover:opacity-90 transition-all"
            >
              <Sparkles className="w-4 h-4" />
              Agent Mode
            </button>
            <button onClick={() => setIsSettingsOpen(true)} className="p-2 hover:bg-black/5 rounded-lg text-[#64748b] hover:text-[#111827] transition-all">
              <Settings className="w-5 h-5" />
            </button>
            <div className="relative group z-50">
               <button className="p-2 hover:bg-black/5 rounded-lg transition-colors flex items-center gap-1.5 text-[#64748b] hover:text-[#111827]">
                 <Globe className="w-4 h-4" />
                 <span className="text-xs font-mono uppercase font-bold tracking-wider">{lang}</span>
               </button>
               <div className="absolute right-0 top-full pt-2 w-32 hidden group-hover:block">
                 <div className="glass rounded-xl shadow-xl overflow-hidden">
                   {['zh', 'en', 'ja', 'ko'].map(l => (
                     <button key={l} onClick={() => changeLanguage(l as Language)} className={`w-full text-left px-4 py-2 text-xs hover:bg-brand-600/10 transition-colors ${lang === l ? 'text-brand-600 font-bold' : 'text-[#64748b]'}`}>
                        {l === 'zh' ? '中文' : l === 'en' ? 'English' : l === 'ja' ? '日本語' : '한국어'}
                     </button>
                   ))}
                 </div>
               </div>
            </div>
          </div>
        </div>
      </header>
      )}

      <main className={`relative z-10 ${!activeTask ? 'pt-0 pb-0' : 'fixed inset-0 z-10'}`}>
        {!activeTask ? (
          <div key="project-list" className="page-transition-enter">
          <ProjectList
            tasks={tasks}
            onNewTask={() => {
              setNewProjectName('');
              setIsNewProjectModalOpen(true);
            }}
            onImportProject={handleImportProject}
            onExportAll={exportAllProjects}
            onSelectTask={(id) => { setActiveTaskId(id); setPageKey(k => k + 1); }}
            onDeleteTask={deleteTask}
            onExportTask={exportProject}
            importFileInputRef={importFileInputRef}
            setImportFileInputRef={setImportFileInputRef}
            t={t}
            lang={lang}
          />
          </div>
        ) : (
          <InfiniteCanvas
            projectId={activeTask.id}
            onBack={() => setActiveTaskId(null)}
            onStart={() => executeTaskStep(activeTask.id)}
            onRetry={() => executeTaskStep(activeTask.id, activeTask.failedStep)}
            onNext={() => proceedToNextStep(activeTask.id)}
            onCancel={() => cancelTask(activeTask.id)}
            onRedo={() => executeTaskStep(activeTask.id, activeTask.status)}
            onSelectShot={(id, initialEdit) => setSelectedShotConfig({ id, initialEdit })}
            onDeleteShot={handleDeleteShot}
            onAddShot={handleAddShot}
            onRegenerateShot={regenerateSingleShot}
            onAddCharacter={handleAddCharacter}
            onDeleteCharacter={handleDeleteCharacter}
            onUploadReference={handleUploadReferenceTrigger}
            onRegenerateCharacter={regenerateSingleCharacter}
            onOptimizePrompt={regenerateSinglePrompt}
            onEditCharacter={setEditingCharacter}
            onSetLightboxImage={setLightboxImage}
            onEditSourceText={() => setIsEditingSourceText(true)}
            onSaveSourceText={handleSaveSourceText}
            onContinueStory={handleContinueStory}
            onRewriteStory={handleRewriteStory}
            isEditingSourceText={isEditingSourceText}
            tempSourceText={tempSourceText}
            onTempSourceTextChange={setTempSourceText}
            isExpandingStory={isExpandingStory}
            onAssetCheck={() => setAssetCheckResult(runAssetCheck(activeTask))}
            onTitleEndCard={() => setIsTitleEndCardOpen(true)}
            onOpenSettings={() => setIsSettingsOpen(true)}
            onStartFromNode={(name, style, sourceType, content) => {
              const updates = {
                name,
                style,
                sourceType,
                rawNovelText: sourceType === 'novel' ? content : '',
                originalIdea: sourceType === 'idea' ? content : undefined,
              };
              updateTask(activeTask.id, updates);
              setTimeout(() => executeTaskStep(activeTask.id, TaskStatus.PREPROCESSING, updates), 100);
            }}
            onUpdateTask={(updates) => updateTask(activeTask.id, updates)}
            onGenerateEpisodeSummary={handleGenerateEpisodeSummary}
            onInheritFromPreviousEpisode={handleInheritFromPreviousEpisode}
            onCreateNextEpisode={handleCreateNextEpisode}
            allTasks={tasks}
            onCreateTask={(previousEpisodeId?: string) => {
              const newTask: DramaTask = {
                id: genId(),
                name: previousEpisodeId ? (tasks.find(t => t.id === previousEpisodeId)?.name || 'New Project') + ' - Next Episode' : 'New Project',
                style: previousEpisodeId ? (tasks.find(t => t.id === previousEpisodeId)?.style || ArtStyle.REALISTIC) : ArtStyle.REALISTIC,
                language: 'zh',
                mode: 'auto',
                sourceType: 'idea',
                createdAt: Date.now(),
                previousEpisodeId,
                visualSignature: previousEpisodeId ? tasks.find(t => t.id === previousEpisodeId)?.visualSignature : undefined,
                inheritedCharacters: previousEpisodeId ? tasks.find(t => t.id === previousEpisodeId)?.characters.filter(c => !!c.threeViewImg) : undefined,
                status: TaskStatus.IDLE,
                stepStatus: 'idle',
                progress: 0,
                rawNovelText: '',
                characters: [],
                bigShots: [],
              };
              setTasks(prev => [newTask, ...prev]);
              return newTask.id;
            }}
            onStartTaskFromNode={(taskId, name, style, sourceType, content) => {
              const updates = {
                name,
                style,
                sourceType,
                rawNovelText: sourceType === 'novel' ? content : '',
                originalIdea: sourceType === 'idea' ? content : undefined,
              };
              updateTask(taskId, updates);
              setTimeout(() => executeTaskStep(taskId, TaskStatus.PREPROCESSING, updates), 100);
            }}
          />
        )}
      </main>

      {viewingSegment && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4 animate-fade-in">
           <div className="glass rounded-2xl shadow-2xl w-full max-w-2xl h-[80vh] flex flex-col animate-scale-in">
              <div className="p-4 border-b border-[#e8edf3] flex justify-between items-center">
                  <div className="flex items-center gap-2">
                    <BookOpen className="w-5 h-5 text-brand-400" />
                    <h2 className="text-lg font-bold">{viewingSegment.name}</h2>
                  </div>
                  <button onClick={() => setViewingSegment(null)} className="p-1.5 hover:bg-black/5 rounded-lg transition-colors text-[#64748b] hover:text-[#111827]">
                    <XCircle className="w-5 h-5" />
                  </button>
              </div>
              <div className="flex-1 p-6 overflow-y-auto">
                 <p className="whitespace-pre-wrap text-[#c7d2fe] text-sm leading-relaxed">
                    {viewingSegment.content}
                 </p>
              </div>
           </div>
        </div>
      )}

      {/* New Project Modal */}
      {isNewProjectModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={() => setIsNewProjectModalOpen(false)}>
          <div className="bg-white border border-[#e8edf3] rounded-2xl shadow-2xl w-full max-w-md p-6 animate-scale-in" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-bold text-[#111827] mb-4">{t('newProject')}</h2>
            <input
              value={newProjectName}
              onChange={(e) => setNewProjectName(e.target.value)}
              placeholder={t('projectNamePlaceholder')}
              className="w-full bg-[#f8fafc] border border-[#e8edf3] rounded-xl px-4 py-3 text-sm text-[#111827] focus:outline-none focus:border-brand-600/50 focus:ring-1 focus:ring-brand-600/20 transition-all placeholder:text-[#94a3b8]"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter' && newProjectName.trim()) {
                  const newTask: DramaTask = {
                    id: genId(),
                    name: newProjectName.trim(),
                    style: ArtStyle.REALISTIC,
                    language: 'zh',
                    mode: 'auto',
                    sourceType: 'idea',
                    createdAt: Date.now(),
                    status: TaskStatus.IDLE,
                    stepStatus: 'idle',
                    progress: 0,
                    rawNovelText: '',
                    originalIdea: undefined,
                    characters: [],
                    bigShots: [],
                  };
                  setTasks(prev => [newTask, ...prev]);
                  setActiveTaskId(newTask.id);
                  setPageKey(k => k + 1);
                  setIsNewProjectModalOpen(false);
                }
              }}
            />
            <div className="flex justify-end gap-3 mt-5">
              <button
                onClick={() => setIsNewProjectModalOpen(false)}
                className="px-4 py-2 text-[#64748b] hover:text-[#111827] rounded-lg text-sm font-medium transition-colors"
              >
                {t('cancel')}
              </button>
              <button
                onClick={() => {
                  if (!newProjectName.trim()) return;
                  const newTask: DramaTask = {
                    id: genId(),
                    name: newProjectName.trim(),
                    style: ArtStyle.REALISTIC,
                    language: 'zh',
                    mode: 'auto',
                    sourceType: 'idea',
                    createdAt: Date.now(),
                    status: TaskStatus.IDLE,
                    stepStatus: 'idle',
                    progress: 0,
                    rawNovelText: '',
                    originalIdea: undefined,
                    characters: [],
                    bigShots: [],
                  };
                  setTasks(prev => [newTask, ...prev]);
                  setActiveTaskId(newTask.id);
                  setPageKey(k => k + 1);
                  setIsNewProjectModalOpen(false);
                }}
                disabled={!newProjectName.trim()}
                className={`px-5 py-2 rounded-lg text-sm font-bold flex items-center gap-2 transition-all ${
                  newProjectName.trim()
                    ? 'bg-brand-600 text-white shadow-lg shadow-brand-600/20 hover:shadow-brand-600/30'
                    : 'bg-black/[0.04] text-[#94a3b8] cursor-not-allowed'
                }`}
              >
                {t('createProject')}
              </button>
            </div>
          </div>
        </div>
      )}

      <NewTaskModal
        isOpen={isNewTaskModalOpen}
        onClose={() => setIsNewTaskModalOpen(false)}
        onCreate={createTask}
        hasApiKey={!!apiConfig.providers.some(p => p.apiKey)}
        onOpenSettings={() => setIsSettingsOpen(true)}
        t={t}
      />

      {activeTask && editingCharacter && (
        <EditCharacterModal
          isOpen={!!editingCharacter}
          onClose={() => setEditingCharacter(null)}
          character={editingCharacter}
          onSave={(updated, originalName) => {
             const updatedCharacters = activeTask.characters.map(c => c.name === originalName ? updated : c);
             let updatedBigShots = activeTask.bigShots;
             if (originalName !== updated.name) {
                 updatedBigShots = activeTask.bigShots.map(shot => ({
                     ...shot,
                     charactersInvolved: shot.charactersInvolved.map(name => name === originalName ? updated.name : name)
                 }));
             }
             updateTask(activeTask.id, {
                 characters: updatedCharacters,
                 bigShots: updatedBigShots
             });
          }}
          t={t}
        />
      )}

      {currentShotInTask && (
        <BigShotDetailModal
          shot={currentShotInTask}
          allCharacters={activeTask?.characters || []}
          onClose={() => setSelectedShotConfig(null)}
          onRegenerateStoryboard={() => activeTask && regenerateSingleShot(activeTask.id, currentShotInTask.id)}
          onReoptimizePrompt={() => activeTask && regenerateSinglePrompt(activeTask.id, currentShotInTask.id)}
          onReoptimizeSoraPrompt={() => activeTask && regenerateSinglePrompt(activeTask.id, currentShotInTask.id)}
          onSave={(updates) => activeTask && updateTask(activeTask.id, { bigShots: activeTask.bigShots.map(s => s.id === currentShotInTask.id ? { ...s, ...updates } : s) })}
          isManualMode={activeTask?.mode === 'manual'}
          initialIsEditing={selectedShotConfig?.initialEdit}
          t={t}
        />
      )}

      <ConfirmModal
        isOpen={confirmModal.isOpen}
        onClose={() => setConfirmModal({ ...confirmModal, isOpen: false })}
        onConfirm={confirmModal.onConfirm}
        title={confirmModal.title}
        message={confirmModal.message}
      />

      <ApiSettingsModal
        open={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        config={apiConfig}
        onSave={handleSaveConfig}
      />

      {lightboxImage && <ImageLightbox src={lightboxImage} onClose={() => setLightboxImage(null)} />}

      {toasts.length > 0 && (
        <div className="toast-notification flex flex-col gap-2">
          {toasts.map(toast => (
            <div
              key={toast.id}
              className={`glass rounded-xl px-4 py-3 flex items-center gap-3 min-w-[280px] max-w-[400px] ${toast.exiting ? 'toast-exit' : 'toast-enter'} ${
                toast.type === 'success' ? 'border border-emerald-500/20' : toast.type === 'error' ? 'border border-red-500/20' : 'border border-brand-500/20'
              }`}
            >
              {toast.type === 'success' && <CheckCircle className="w-5 h-5 text-emerald-600 flex-shrink-0" />}
              {toast.type === 'error' && <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0" />}
              {toast.type === 'info' && <Info className="w-5 h-5 text-brand-600 flex-shrink-0" />}
              <span className="text-sm text-[#111827]">{toast.message}</span>
            </div>
          ))}
        </div>
      )}

      {celebration && (
        <div className="celebration-overlay">
          <div
            className="celebration-ring"
            style={{
              left: celebration.x - 30,
              top: celebration.y - 30,
              width: 60,
              height: 60,
            }}
          />
          <div
            className="celebration-ring"
            style={{
              left: celebration.x - 50,
              top: celebration.y - 50,
              width: 100,
              height: 100,
              animationDelay: '0.15s',
            }}
          />
          {[...Array(12)].map((_, i) => {
            const angle = (i / 12) * Math.PI * 2;
            const distance = 60 + Math.random() * 80;
            const dx = Math.cos(angle) * distance;
            const dy = Math.sin(angle) * distance;
            const colors = ['#111827', '#374151', '#16a34a', '#2563eb', '#60a5fa'];
            return (
              <div
                key={`${celebration.id}-${i}`}
                className="celebration-sparkle"
                style={{
                  left: celebration.x + dx,
                  top: celebration.y + dy,
                  backgroundColor: colors[i % colors.length],
                  boxShadow: `0 0 8px ${colors[i % colors.length]}`,
                  animation: `sparkleBurst 0.8s ease-out forwards, celebrationRise 1.2s ease-out forwards`,
                  animationDelay: `${i * 0.03}s`,
                  width: 4 + Math.random() * 4,
                  height: 4 + Math.random() * 4,
                }}
              />
          );
        })}
        </div>
      )}
        </>
      )}
    </div>
  );
}
