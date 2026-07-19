import React, { Suspense, lazy, useState, useEffect, useCallback, useRef } from 'react';
import { Film, Globe, Settings, ArrowLeft, RotateCw, RefreshCw, Loader2, AlertTriangle, PlayCircle, SkipForward, XOctagon, Sparkles, BookOpen, XCircle, CheckCircle, AlertCircle, Info, Shield, ChevronDown, PanelLeftClose, PanelLeftOpen, ChevronRight, Users, Clapperboard, Terminal, ChevronUp, UserPlus, User } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { NewTaskModal } from './components/NewTaskModal';
import { EditCharacterModal } from './components/EditCharacterModal';
import { ImageLightbox } from './components/ImageLightbox';

import { ConfirmModal } from './components/ConfirmModal';
import { BigShotDetailModal } from './components/BigShotDetailModal';
// 懒加载：InfiniteCanvas 是首屏最大体积（CanvasNode / CanvasLinks / Engine / ComposerPanel / MiniMap 全套），
// 用 React.lazy 拆出，首屏只渲染占位，缩短首屏 transform 瀑布。
const InfiniteCanvas = lazy(() => import('./components/infinite-canvas').then((m) => ({ default: m.InfiniteCanvas })));
// ApiSettingsModal 同属 infinite-canvas/，但被 App 层 settings 按钮触发；也按需加载避免拉全套画布代码。
// 关键：必须 eager import — 懒加载会导致首页点击"设置"按钮时 chunk 还在下载，
// <Suspense fallback={null}> 渲染 null，React 后续派发原始 click 事件到 backdrop 时
// 模态被立即关闭，用户体验是"按钮没反应"。
import { ApiSettingsModal } from './components/infinite-canvas/ApiSettingsModal';
import { useCanvasStore, migrateLocalProvidersToBackendForce, getLocalProvidersSnapshot } from './components/infinite-canvas/use-canvas-store';
import { TaskAssetRef } from './components/infinite-canvas/types';
import { syncProvidersToBackend } from './services/providerSync';
import { AssetCheckReport } from './components/AssetCheckReport';
import { TitleEndCardEditor } from './components/TitleEndCardEditor';
import { runAssetCheck, AssetCheckResult } from './utils/assetChecker';
import { ProjectList } from './components/ProjectList';
import { DramaTask, TaskStatus, ArtStyle, BigShot, Character, Language, TaskMode, ApiConfig, ProcessedSegment, createDefaultApiConfig, normalizeModelBindings, LOGICAL_STEPS } from './types';
import { storageService } from './services/storageService';
import { useTaskExecutor } from './hooks/useTaskExecutor';
import { useTaskActions } from './hooks/useTaskActions';
import { I18nProvider, useI18n } from './i18n';
import { subscribeToast, ToastType } from './utils/toast';
// 懒加载：AgentMode 引入 ThoughtStream / TaskList / ToolPalette / AgentPetController / PromptLibraryPanel
// 等十几个子模块，agent-stream-manager 也会立即在模块层订阅 store 并启动 SSE manager。
// 这些都是"按需"功能（用户点击进入 agent 模式才需要），首屏不应当加载。
// 注意：useAgentStore 仍需顶层引入（用于 App 层读取 status 决定是否显示 background banner）。
const AgentMode = lazy(() => import('./agent/agent-mode').then((m) => ({ default: m.AgentMode })));
import { useAgentStore } from './agent/use-agent-store';
import { retryNow } from './agent/agent-stream-manager';
import { api } from './services/apiClient';
// 全局 Agent 横幅（background banner + SSE connection banner）样式。
// 必须从 App 顶层引入，否则在 lazy-loaded agent-mode 未触发时样式未注入，
// 会导致用户首次进入项目列表就看不到断线提示。
import './global-agent-banners.css';

const STORAGE_KEY_LANG = 'dramaforge_language';
// ⚠️ dramaforge_tasks / dramaforge_tasks_backup 全部已迁移到后端（/api/drama-tasks），
// 切浏览器不会丢。stepBindings 是后端 key-value（/api/user-preferences），
// localStorage 只作为后端不可用时的兜底。
const STORAGE_KEY_MODEL_BINDINGS = 'dramaforge_model_bindings';
const STORAGE_KEY_API_CONFIG_LEGACY = 'dramaforge_apiconfig';
// canvas 主 apiConfig localStorage key — 兜底恢复用（与 use-canvas-store 一致）。
const STORAGE_KEY_API_CONFIG_CANVAS = 'dramaforge-canvas-api-config';

// LOGICAL_STEPS 已收敛到 types.ts 单一事实源（见 import），此处不再重复定义。

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
  const [toasts, setToasts] = useState<{ id: number; type: ToastType; message: string; exiting?: boolean }[]>([]);
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
  const canvasContainerRef = useRef<HTMLDivElement>(null);

  const addToast = useCallback((type: ToastType, message: string) => {
    const id = ++toastIdRef.current;
    setToasts(prev => [...prev, { id, type, message }]);
    setTimeout(() => {
      setToasts(prev => prev.map(t => t.id === id ? { ...t, exiting: true } : t));
      setTimeout(() => {
        setToasts(prev => prev.filter(t => t.id !== id));
      }, 300);
    }, 3000);
  }, []);

  // 订阅全局 toast 事件总线（utils/toast.ts）：
  // hooks / 画布组件 / services 纯模块拿不到 addToast，统一通过事件总线发提示。
  useEffect(() => subscribeToast(addToast), [addToast]);

  // 点击 Canvas 工具栏的 Agent 按钮时：先确保有 activeTask，再进入 AgentMode。
  const handleEnterAgentMode = useCallback(() => {
    // 优先使用已有的 activeTaskId
    if (activeTaskId) {
      setAgentMode(true);
      return;
    }
    // 否则用第一个 task 或新建一个
    setTasks((prev) => {
      let targetId: string;
      if (prev.length > 0) {
        targetId = prev[0].id;
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
        prev = [newTask, ...prev];
        targetId = newTask.id;
      }
      setActiveTaskId(targetId);
      setAgentMode(true);
      return prev;
    });
  }, [activeTaskId]);

  const handleToggleAgentMode = useCallback(() => {
    if (agentMode) {
      window.dispatchEvent(new CustomEvent('agent-mode-exit'));
      return;
    }
    handleEnterAgentMode();
  }, [agentMode, handleEnterAgentMode]);

  // URL ?agent=1 启动时自动进入（等待 tasks 加载完，再决定用现有任务还是新建）
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (new URLSearchParams(window.location.search).get('agent') === '1') {
      // 等 storageService 异步加载 tasks（首屏 useEffect）跑完，再触发
      const timer = setTimeout(() => {
        handleEnterAgentMode();
      }, 50);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [handleEnterAgentMode]);

  // 监听 AgentMode 派发的退出事件
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onExit = () => {
      setAgentMode(false);
      // 不清 activeTask 和 taskId：用户应当可以重新进入 agent 模式查看进度
    };
    // LLM 错误时一键跳到 API 设置：先退 agent 模式，再打开 API 设置弹窗
    const onExitAndOpenSettings = () => {
      setAgentMode(false);
      setIsSettingsOpen(true);
    };
    window.addEventListener('agent-mode-exit', onExit as EventListener);
    window.addEventListener(
      'agent-mode-exit-and-open-settings',
      onExitAndOpenSettings as EventListener,
    );
    return () => {
      window.removeEventListener('agent-mode-exit', onExit as EventListener);
      window.removeEventListener(
        'agent-mode-exit-and-open-settings',
        onExitAndOpenSettings as EventListener,
      );
    };
  }, []);

  // ApiSettingsModal 已改为 eager import（见文件顶部），
  // 不再需要预加载 useEffect — 那只是治标不治本。

  const activeTask = tasks.find(t => t.id === activeTaskId);

  // 监听 agent 后台任务：useAgentStore 暴露 taskId / projectId / status
  // 关键：banner 只在 agent 任务属于当前 active task（画布项目）时才显示，
  //       避免在别的项目上误显"agent 在后台运行"提示。
  const agentTaskId = useAgentStore((s) => s.taskId);
  const agentProjectId = useAgentStore((s) => s.projectId);
  const agentStatus = useAgentStore((s) => s.status);
  const connectionStatus = useAgentStore((s) => s.connectionStatus);
  const connectionDetail = useAgentStore((s) => s.connectionDetail);
  const reconnectAttempt = useAgentStore((s) => s.reconnectAttempt);
  const showBackgroundBanner =
    !agentMode &&
    activeTask &&
    agentTaskId &&
    // agent 任务必须属于当前画布项目（不是任意 activeTask，而是它所代表的 projectId）
    activeTask.id === agentProjectId &&
    (agentStatus === 'running' || agentStatus === 'paused' || agentStatus === 'pending');

  // 全局 SSE 连接横幅：只要有 agent task 且连接非"connected"，就显示在页面顶部。
  // 之前只放在 agent pet 里，退出 agent 模式后用户看不到断线状态。
  // 设计：仅在 store.taskId 存在时显示（避免空状态误显），不依赖 activeTask 切换。
  const showSseBanner = !!agentTaskId && connectionStatus !== 'connected';
  const handleSseRetry = useCallback(() => {
    retryNow();
  }, []);

  const triggerCelebration = useCallback((x: number, y: number) => {
    const id = Date.now();
    setCelebration({ x, y, id });
    setTimeout(() => setCelebration(null), 1500);
  }, []);

  useEffect(() => {
    // 首屏：用单个 GET /api/bootstrap 合并 listDramaTasks + listProviders +
    // getUserPreference('model_bindings') 三个请求，减少 RTT（3 → 1）。
    // 失败时回落到 localStorage（任务兜底 + 老 API 配置迁移），逻辑与原
    // 三请求版完全一致。
    let cancelled = false;
    const applyLoadedApiConfig = (config: ApiConfig) => {
      setApiConfig(config);
      useCanvasStore.getState().setApiConfig(config);
    };

    /**
     * 把后端 ProviderOut[]（api_key 脱敏）转换成前端 Provider 形态。
     * 与 bootstrap.py 的 mask_key=True 输出保持一致：has_key=true 时
     * apiKey 字段清空（避免把脱敏值写回 DB）。
     */
    const mapBackendProvidersToFrontend = (rows: any[]): any[] => (rows || []).map((r) => ({
      id: r.provider_id,
      name: r.name || r.provider_id,
      baseUrl: r.base_url || '',
      protocol: r.protocol || 'openai',
      enabled: r.enabled !== false,
      apiKey: r.has_key ? '' : (r.api_key || ''),
      hasKey: r.has_key || false,
      keyPreview: r.key_preview || '',
      extraConfig: r.extra_config || {},
      defaultModel: r.default_model || '',
      chatModels: r.chat_models || [],
      imageModels: r.image_models || [],
      videoModels: r.video_models || [],
    }));

    /**
     * 把 localStorage 中的 Provider[] 转成前端形态（保留明文 apiKey，因为这就是真源）。
     * 仅用于"后端空 + localStorage 有"的兜底场景。
     */
    const mapLocalProvidersToFrontend = (rows: any[]): any[] => (rows || [])
      .filter((p) => p && p.id && p.baseUrl && p.apiKey)
      .map((p) => ({
        id: String(p.id),
        name: p.name || String(p.id),
        baseUrl: String(p.baseUrl),
        protocol: p.protocol || 'openai',
        enabled: p.enabled !== false,
        apiKey: String(p.apiKey),
        hasKey: true,
        keyPreview: '',
        defaultModel: p.defaultModel || '',
        chatModels: p.chatModels || [],
        imageModels: p.imageModels || [],
        videoModels: p.videoModels || [],
      }));

    /**
     * 把 localStorage 中的 provider（带 apiKey）按 id 合并进 backend providers 列表。
     * - 后端已有同 id：用后端数据（has_key=true 时 apiKey 由后端保留原值）
     * - 后端没有但 localStorage 有：补入（保留 localStorage 的明文 apiKey）
     * 这样后端如果因任何原因丢了一两条 provider，localStorage 还能补回来。
     */
    const mergeProviders = (backendRows: any[], localRows: any[]): any[] => {
      const out: any[] = [...backendRows];
      const backendIds = new Set(out.map((p) => p.id));
      for (const lp of localRows) {
        if (!backendIds.has(lp.id)) {
          out.push(lp);
        }
      }
      return out;
    };

    api.bootstrap()
      .then(async (boot) => {
        if (cancelled) return;

        // ── 1) tasks ──────────────────────────────────────────────
        // 后端有数据 → 直接用；后端为空 → 尝试从 localStorage 迁移。
        if (boot.tasks && boot.tasks.length > 0) {
          const tasksFromBackend: DramaTask[] = boot.tasks.map((r) => {
            const { id, name, ...rest } = (r.data || {}) as DramaTask & { id?: string; name?: string };
            return { ...(rest as DramaTask), id: r.id, name: r.name || name || 'Untitled' };
          });
          setTasks(tasksFromBackend);
        } else {
          const legacyRaw = localStorage.getItem('dramaforge_tasks');
          if (legacyRaw) {
            try {
              const legacyTasks: DramaTask[] = JSON.parse(legacyRaw).tasks || JSON.parse(legacyRaw);
              if (Array.isArray(legacyTasks) && legacyTasks.length > 0) {
                for (const t of legacyTasks) {
                  try {
                    await api.upsertDramaTask(t.id, { name: t.name, data: t as any });
                  } catch (e) {
                    console.warn('[App] migrate legacy task failed', t.id, e);
                  }
                }
                if (!cancelled) {
                  setTasks(legacyTasks);
                  try { localStorage.removeItem('dramaforge_tasks'); } catch {}
                  try {
                    for (let i = localStorage.length - 1; i >= 0; i--) {
                      const k = localStorage.key(i);
                      if (k && (k.startsWith('dramaforge_tasks_backup') || k === 'dramaforge_tasks_autobackup')) {
                        localStorage.removeItem(k);
                      }
                    }
                  } catch {}
                  console.info(`[App] migrated ${legacyTasks.length} legacy tasks from localStorage to backend`);
                }
              } else {
                setTasks([]);
              }
            } catch (e) {
              console.warn('[App] parse legacy localStorage tasks failed', e);
              setTasks([]);
            }
          } else {
            setTasks([]);
          }
        }

        // ── 2) providers + model_bindings ────────────────────────
        // 兜底链路：
        //   1) 后端 bootstrap 拿 providers
        //   2) 后端为空 + localStorage 有 key → 强制迁移 + 重新拉取
        //   3) 重新拉取仍空 → 用 localStorage 数据补一份（保证用户至少看到）
        // 这样即使 backend DB 因任何原因丢数据，localStorage 兜底 + 重推能恢复。
        let backendProviders = mapBackendProvidersToFrontend(boot.providers || []);

        if (backendProviders.length === 0) {
          // 拿 localStorage 兜底数据
          const localSnapshot = getLocalProvidersSnapshot();
          const localWithKey = localSnapshot.filter(
            (p: any) => p && p.id && p.baseUrl && p.apiKey,
          );
          if (localWithKey.length > 0) {
            try {
              // 强制推 localStorage → DB（忽略 hasMigrated 标志）
              const mig = await migrateLocalProvidersToBackendForce();
              if (mig.synced > 0) {
                // eslint-disable-next-line no-console
                console.info(
                  `[App] force-migrated ${mig.synced} providers from localStorage → DB (failed=${mig.failed.length})`,
                );
                // 重新拉取 backend（拿 has_key=true 的真状态）
                try {
                  const fresh = await api.listProviders();
                  backendProviders = mapBackendProvidersToFrontend(fresh);
                } catch (e) {
                  console.warn('[App] re-list providers after migration failed', e);
                }
              }
            } catch (e) {
              console.warn('[App] force-migrate failed', e);
            }
            // 不管推送成功与否，都把 localStorage 数据 merge 进列表
            // （后端已存在的 id 用 backend 版本，缺失的用 localStorage 补）
            const localMapped = mapLocalProvidersToFrontend(localSnapshot);
            backendProviders = mergeProviders(backendProviders, localMapped);
          }
        }

        // model_bindings：后端是主存，localStorage 兜底
        let bindings: any[] | null = null;
        if (Array.isArray(boot.modelBindings)) {
          bindings = boot.modelBindings;
        } else {
          try {
            const raw = localStorage.getItem(STORAGE_KEY_MODEL_BINDINGS);
            if (raw) bindings = JSON.parse(raw);
          } catch {}
        }
        applyLoadedApiConfig(normalizeModelBindings({ providers: backendProviders, modelBindings: bindings || [] }));
      })
      .catch((e) => {
        if (cancelled) return;
        console.error('[App] bootstrap failed, falling back to localStorage', e);
        // 后端不可用：tasks 兜底用 localStorage
        const savedTasks = storageService.loadTasks();
        if (savedTasks && savedTasks.length > 0) {
          setTasks(savedTasks);
        } else {
          const backupTasks = storageService.loadFromBackup();
          if (backupTasks && backupTasks.length > 0) {
            setTasks(backupTasks);
          }
        }
        // 后端不可用时回落到 localStorage — 优先读新 key（canvas 主 apiConfig），
        // 读不到再回落老 key（含 geminiKey / 旧格式自动迁移）。
        const savedConfigCanvas = localStorage.getItem(STORAGE_KEY_API_CONFIG_CANVAS);
        const savedConfigLegacy = localStorage.getItem(STORAGE_KEY_API_CONFIG_LEGACY);
        let localBindings: any[] = [];
        try {
          const rawBindings = localStorage.getItem(STORAGE_KEY_MODEL_BINDINGS);
          if (rawBindings) localBindings = JSON.parse(rawBindings);
        } catch {}
        const savedConfig = savedConfigCanvas || savedConfigLegacy;
        if (savedConfig) {
          try {
            const parsed = JSON.parse(savedConfig);
            if (parsed.providers && (parsed.modelBindings || parsed.stepBindings)) {
              // 关键：dramaforge_model_bindings 是 handleSaveConfig 显式写入的最新值，
              // dramaforge-canvas-api-config 是 store subscriber 自动写入的（可能滞后或被前一会话污染）。
              // 后端不可用时，modelBindings 必须以 dramaforge_model_bindings 为准，
              // 否则用户配置会在重启后丢失（或被陈旧数据覆盖）。
              const mergedConfig = localBindings.length > 0
                ? { ...parsed, modelBindings: localBindings }
                : parsed;
              applyLoadedApiConfig(normalizeModelBindings(mergedConfig));
            } else if (parsed.geminiKey !== undefined) {
              const migrated = createDefaultApiConfig();
              const geminiProvider = migrated.providers.find((p: any) => p.id === 'google-gemini');
              const nanoProvider = migrated.providers.find((p: any) => p.id === 'nanobanana');
              const soraProvider = migrated.providers.find((p: any) => p.id === 'sora');
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
              applyLoadedApiConfig(migrated);
            } else {
              applyLoadedApiConfig(normalizeModelBindings({
                ...createDefaultApiConfig(),
                modelBindings: localBindings,
              }));
            }
          } catch (e) {
            console.error('Failed to parse saved api config', e);
          }
        } else {
          applyLoadedApiConfig(normalizeModelBindings({
            ...createDefaultApiConfig(),
            modelBindings: localBindings,
          }));
        }
      })
      .finally(() => {
        // 标记后端加载完成（不论成功/失败/迁移）；prevTaskIdsRef 那个 effect
        // 看到 tasksLoadedFromBackendRef.current=false 会初始化 lastSyncedRef。
        if (!cancelled) tasksLoadedFromBackendRef.current = true;
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // 用 ref 跟踪 tasks 状态（避免 effect 重入 + 启动后第一次不重写回后端）
  const tasksRef = useRef<DramaTask[]>(tasks);
  useEffect(() => { tasksRef.current = tasks; }, [tasks]);
  // 后端已加载完成标记：首屏 listDramaTasks 完成后才允许写后端
  const tasksLoadedFromBackendRef = useRef(false);
  // 已删除的 taskIds（用于触发 DELETE /api/drama-tasks/{id}）
  const deletedTaskIdsRef = useRef<Set<string>>(new Set());
  // 跟踪上一次后端同步过的 taskId → JSON（避免无效 PUT）
  const lastSyncedRef = useRef<Map<string, string>>(new Map());

  const saveTasksTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    // 没从后端加载完之前不写（避免刚 setTasks 回来又被原样回写）
    if (!tasksLoadedFromBackendRef.current) return;
    if (saveTasksTimerRef.current) clearTimeout(saveTasksTimerRef.current);
    saveTasksTimerRef.current = setTimeout(() => {
      const cur = tasksRef.current;
      // 1) 处理删除（deletedTaskIdsRef 里的需要 DELETE）
      for (const id of Array.from(deletedTaskIdsRef.current)) {
        if (cur.some((t) => t.id === id)) {
          // 任务又回来了 → 不删
          deletedTaskIdsRef.current.delete(id);
          continue;
        }
        api.deleteDramaTask(id).catch((e) => {
          console.warn(`[App] deleteDramaTask ${id} failed`, e);
        });
        lastSyncedRef.current.delete(id);
        deletedTaskIdsRef.current.delete(id);
      }
      // 2) 处理新增/更新（PUT 整段 data）
      for (const t of cur) {
        const json = JSON.stringify(t);
        if (lastSyncedRef.current.get(t.id) === json) continue;
        api.upsertDramaTask(t.id, { name: t.name, data: t as any })
          .then(() => {
            lastSyncedRef.current.set(t.id, json);
          })
          .catch((e) => {
            console.warn(`[App] upsertDramaTask ${t.id} failed`, e);
          });
      }
      // 3) 兜底：localStorage 备份（后端挂了时还能恢复）
      try { storageService.saveTasks(cur); } catch {}
    }, 500);
    return () => {
      if (saveTasksTimerRef.current) clearTimeout(saveTasksTimerRef.current);
    };
  }, [tasks]);

  // 监听 setTasks 的 diff，把被移除的 taskId 加到 deletedTaskIdsRef。
  // 实现：维护一个 prev tasks id 集合，每次 setTasks 时对比。
  const prevTaskIdsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!tasksLoadedFromBackendRef.current) {
      // 第一次 tasks 变更就是从后端加载完的那次：初始化 prevTaskIdsRef
      prevTaskIdsRef.current = new Set(tasks.map((t) => t.id));
      // 同步 lastSyncedRef（这样加载回来的数据不会被立刻重写）
      for (const t of tasks) {
        lastSyncedRef.current.set(t.id, JSON.stringify(t));
      }
      tasksLoadedFromBackendRef.current = true;
      return;
    }
    const curIds = new Set(tasks.map((t) => t.id));
    for (const id of prevTaskIdsRef.current) {
      if (!curIds.has(id)) {
        deletedTaskIdsRef.current.add(id);
      }
    }
    prevTaskIdsRef.current = curIds;
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

  const handleSaveConfig = async (newConfig: ApiConfig) => {
    // 1) stepBindings 写后端（key-value 偏好表）— 后端是主存，localStorage 兜底
    try {
      localStorage.setItem(STORAGE_KEY_MODEL_BINDINGS, JSON.stringify(newConfig.modelBindings || []));
    } catch {}
    await api.setUserPreference('model_bindings', newConfig.modelBindings || []);
    // 2) providers 走后端（不再写整个 localStorage，避免 key 漂移）。
    //    syncProvidersToBackend 只 upsert，不 delete —— 详见 services/providerSync.ts
    //    头注：auto-delete 在 race condition 下会把后端 DB 的 provider 清空。
    //    删除只能走 modal 顶部的 🗑 按钮（已显式调 api.deleteProvider）。
    const prev = apiConfig.providers;
    const next = newConfig.providers;
    setApiConfig(newConfig);
    useCanvasStore.getState().setApiConfig(newConfig);
    setIsSettingsOpen(false);
    // 异步 fire-and-forget；失败由 syncProvidersToBackend 内部 console.warn，
    // UI 不阻塞。
    void syncProvidersToBackend(prev, next);
  };

  const updateTask = useCallback((taskId: string, updates: Partial<DramaTask>) => {
    setTasks(prev => prev.map(t => t.id === taskId ? { ...t, ...updates } : t));
  }, []);

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
    if (activeTask?.mode === 'auto' && activeTask.stepStatus === 'completed') {
      const idx = LOGICAL_STEPS.indexOf(activeTask.status);
      // 守卫：COMPLETED/FAILED/CANCELLED/IDLE 等非流水线状态 indexOf 返回 -1，
      // 此时不得回退到第一步重新执行（取消任务后 500ms 自动重启的根因）。
      if (idx === -1) return;
      const next = LOGICAL_STEPS[idx + 1];
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

      <>
      {/* Agent 后台运行提示横幅 — 退出 agent 模式后仍能看到任务在跑 */}
      {showBackgroundBanner && (
        <div
          data-testid="agent-background-banner"
          className="agent-background-banner"
          onClick={handleEnterAgentMode}
          title="点击重新进入 Agent 模式"
        >
          <span className="agent-background-banner-dot" />
          <span className="agent-background-banner-text">
            Agent 正在后台运行 ({agentStatus === 'paused' ? '已暂停' : '思考中…'})
          </span>
          <span className="agent-background-banner-action">点击查看</span>
        </div>
      )}

      {/* 全局 SSE 连接状态横幅 — 任何页面下都能看到断线/重连状态。
          触发条件：store.taskId 存在 && connectionStatus !== 'connected'。
          之前该状态只在 agent pet 面板里，退出 agent 模式或 pet 被收起后用户完全感知不到。 */}
      {showSseBanner && (
        <div
          data-testid={`global-sse-banner-${connectionStatus}`}
          className={`global-sse-banner global-sse-banner-${connectionStatus}`}
          role="status"
          aria-live="polite"
        >
          <span className="global-sse-banner-dot" />
          <span className="global-sse-banner-text">
            {connectionStatus === 'reconnecting'
              ? `Agent 实时连接中断，正在重连（${reconnectAttempt}/8）`
              : 'Agent 实时连接已断开'}
            {connectionDetail ? ` · ${connectionDetail}` : ''}
          </span>
          <button
            type="button"
            data-testid="global-sse-banner-retry"
            className="global-sse-banner-retry"
            onClick={handleSseRetry}
            title="手动重试连接"
          >
            <RefreshCw className="w-3.5 h-3.5" /> 重连
          </button>
        </div>
      )}
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
          <div ref={canvasContainerRef} className="app-canvas-shell" style={{ position: 'relative', width: '100%', height: '100%' }}>
          <Suspense fallback={null}>
          <InfiniteCanvas
            projectId={activeTask.id}
            onBack={() => setActiveTaskId(null)}
            onAgentMode={handleToggleAgentMode}
            agentModeActive={agentMode}
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
          {agentMode && activeTask && (
            <Suspense fallback={null}>
              <AgentMode
                projectId={activeTask.id}
                canvasContainerRef={canvasContainerRef}
              />
            </Suspense>
          )}
          </Suspense>
          </div>
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
                 <p className="whitespace-pre-wrap text-[#374151] text-sm leading-relaxed">
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
                toast.type === 'success' ? 'border border-emerald-500/20' : toast.type === 'error' ? 'border border-red-500/20' : toast.type === 'warning' ? 'border border-amber-500/20' : 'border border-brand-500/20'
              }`}
            >
              {toast.type === 'success' && <CheckCircle className="w-5 h-5 text-emerald-600 flex-shrink-0" />}
              {toast.type === 'error' && <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0" />}
              {toast.type === 'warning' && <AlertTriangle className="w-5 h-5 text-amber-600 flex-shrink-0" />}
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
    </div>
  );
}
