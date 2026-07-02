import React, { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import {
  Key,
  KeyRound,
  Sparkles,
  ArrowLeft,
  ArrowRight,
  X,
  Check,
  AlertTriangle,
  Globe,
  Save,
  Trash2,
  Pencil,
  Smartphone,
  CreditCard,
  BookOpen,
  LogOut,
  Wallet,
  Coins,
  RefreshCw,
  Loader2,
  Download,
  ChevronDown,
  ChevronRight,
  Target,
  Info,
} from 'lucide-react';
import {
  ApiConfig,
  Provider,
  ProviderProtocol,
  StepModelBinding,
  StepType,
} from '../../types';
import { useI18n } from '../../i18n';

/* ====== Constants ====== */
const FIXED_IDS = new Set<string>([]);

const RECOMMENDED_APIS: Array<{
  name: string;
  baseUrl: string;
  protocol: ProviderProtocol;
  registerUrl: string;
  tags: string[];
  summary: string;
}> = [];

type ModelKind = 'image' | 'chat' | 'video';
type PickerCategory = 'all' | ModelKind;

interface LoraEntry {
  id: string;
  name: string;
  targetModel: string;
  strength: number;
  enabled: boolean;
  note?: string;
}

interface RhAppEntry {
  id: string;
  title: string;
  note?: string;
  enabled: boolean;
  appId: string;
}

const MODEL_KIND_META: Record<ModelKind, { key: keyof Provider; label: string; color: string }> = {
  image: { key: 'imageModels', label: 'canvasApiSettingsImageGenModel', color: 'var(--text)' },
  chat: { key: 'chatModels', label: 'canvasApiSettingsLlmModel', color: 'var(--text)' },
  video: { key: 'videoModels', label: 'canvasApiSettingsVideoModelLabel', color: 'var(--text)' },
};

const STEP_DEFAULT_MODEL_KIND: Record<StepType, ModelKind> = {
  preprocessing: 'chat',
  scriptGeneration: 'chat',
  promptOptimization: 'chat',
  characterDesign: 'image',
  storyboarding: 'image',
  videoGeneration: 'video',
};

const STEP_LABEL_KEYS: Record<StepType, string> = {
  preprocessing: 'canvasApiSettingsStepPreprocessing',
  scriptGeneration: 'canvasApiSettingsStepScript',
  characterDesign: 'canvasApiSettingsStepCharacter',
  storyboarding: 'canvasApiSettingsStepStoryboard',
  promptOptimization: 'canvasApiSettingsStepPromptOpt',
  videoGeneration: 'canvasApiSettingsStepVideo',
};

function getDefaultModelForStep(step: StepType, p: Provider): string {
  const kind = STEP_DEFAULT_MODEL_KIND[step];
  const key = MODEL_KIND_META[kind].key;
  const list = (p[key] as string[]) || [];
  return list[0] || '';
}

const MS_BUILTIN_IMAGE_MODELS: string[] = [];

const JIMENG_HELP_COMMANDS: string[] = [];

const KEYWORD_IMAGE_HINTS = [
  'image', 'dall-e', 'dalle', 'sdxl', 'sd-', 'flux', 'qwen-image', 'z-image',
  'imagen', 'midjourney', 'kling-image', 'seedream', 'nano-banana', 'nanobanana',
  'banana', 'comfyui', 'kolors', 'hunyuan-image', 'cogview', 'wuerstchen', 'shuttle',
];
const KEYWORD_VIDEO_HINTS = [
  'video', 'sora', 'veo', 'kling', 'runway', 'hunyuan-video', 'cogvideo',
  'seedance', 'wan-', 'wanx', 'mochi', 'luma', 'pika', 'hailuo', 'gen-3', 'mimic',
];

/* ====== Helpers ====== */
function normalizeId(value: string): string {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-+/g, '-')
    .slice(0, 40);
}

function deriveIdFromName(name: string, existingId: string, providers: Provider[]): string {
  if (existingId) return existingId;
  let id = normalizeId(name);
  if (!id) id = 'api-' + Math.random().toString(36).slice(2, 8);
  let candidate = id;
  let i = 2;
  while (providers.some(p => p.id === candidate)) candidate = `${id}-${i++}`;
  return candidate;
}

function unique(values: string[]): string[] {
  const seen = new Set<string>();
  return values.map(v => String(v || '').trim()).filter(v => v && !seen.has(v) && seen.add(v));
}

function protocolLabel(p: Provider): string {
  if (p.id === 'runninghub') return 'RH';
  if (p.id === 'volcengine') return 'Ark';
  if (p.id === 'jimeng') return 'CLI';
  return String(p.protocol || 'openai').toUpperCase();
}

function isFixedProvider(id: string): boolean {
  return FIXED_IDS.has(id);
}

function guessModelCategory(id: string): ModelKind {
  const lower = id.toLowerCase();
  if (KEYWORD_IMAGE_HINTS.some(k => lower.includes(k))) return 'image';
  if (KEYWORD_VIDEO_HINTS.some(k => lower.includes(k))) return 'video';
  return 'chat';
}

function cleanBaseUrl(url: string): string {
  return String(url || '').trim().replace(/\/+$/, '');
}

function buildAuthHeader(protocol: ProviderProtocol, key: string): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (!key) return headers;
  if (protocol === 'gemini') {
    return headers; // Gemini uses query param ?key=
  }
  headers['Authorization'] = `Bearer ${key.trim()}`;
  return headers;
}

function buildModelListUrl(protocol: ProviderProtocol, baseUrl: string, key: string): string {
  const base = cleanBaseUrl(baseUrl);
  if (!base) return '';
  if (protocol === 'gemini') {
    const sep = base.includes('?') ? '&' : '?';
    return `${base}/v1beta/models${key ? `${sep}key=${encodeURIComponent(key.trim())}` : ''}`;
  }
  if (protocol === 'volcengine') {
    return `${base}/models`;
  }
  // openai / apimart / runninghub
  return `${base}/models`;
}

/* ====== SearchableSelect ====== */
interface SearchableSelectProps {
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
  searchPlaceholder?: string;
  emptyText?: string;
  placeholder?: string;
}

const SearchableSelect: React.FC<SearchableSelectProps> = ({
  value,
  options,
  onChange,
  searchPlaceholder,
  emptyText,
  placeholder,
}) => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const filtered = useMemo(() => {
    if (!query.trim()) return options;
    const q = query.toLowerCase();
    return options.filter(o => o.label.toLowerCase().includes(q) || o.value.toLowerCase().includes(q));
  }, [options, query]);

  const selectedLabel = options.find(o => o.value === value)?.label || placeholder || '';

  return (
    <div className="api-searchable-select" ref={ref}>
      <button
        type="button"
        className="api-searchable-select-trigger"
        onClick={() => setOpen(v => !v)}
      >
        <span className="api-searchable-select-label" title={selectedLabel}>{selectedLabel}</span>
        <ChevronDown size={14} className="api-searchable-select-chevron" />
      </button>
      {open && (
        <div className="api-searchable-select-dropdown">
          <input
            type="text"
            className="api-searchable-select-search"
            placeholder={searchPlaceholder}
            value={query}
            onChange={e => setQuery(e.target.value)}
            autoFocus
          />
          <div className="api-searchable-select-options">
            {filtered.length === 0 && (
              <div className="api-searchable-select-empty">{emptyText}</div>
            )}
            {filtered.map(o => (
              <button
                key={o.value}
                type="button"
                className={`api-searchable-select-option ${o.value === value ? 'is-selected' : ''}`}
                onClick={() => { onChange(o.value); setOpen(false); setQuery(''); }}
                title={o.label}
              >
                {o.label}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

/* ====== Component ====== */
interface Props {
  open: boolean;
  onClose: () => void;
  config: ApiConfig;
  onSave: (config: ApiConfig) => void;
}

export const ApiSettingsModal: React.FC<Props> = ({ open, onClose, config, onSave }) => {
  const { t } = useI18n();
  const [cfg, setCfg] = useState<ApiConfig>(() => JSON.parse(JSON.stringify(config)));
  const [selectedId, setSelectedId] = useState<string>('');
  const [showRecommend, setShowRecommend] = useState(false);
  const [status, setStatus] = useState('');
  const [saved, setSaved] = useState(false);
  const [stepBindingsCollapsed, setStepBindingsCollapsed] = useState(true);
  const contentRef = useRef<HTMLDivElement>(null);

  // Model fetching state
  const [fetching, setFetching] = useState(false);
  const [verifyResult, setVerifyResult] = useState<{ kind: 'ok' | 'warn' | 'info'; text: string } | null>(null);

  // Model picker state
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerFilter, setPickerFilter] = useState('');
  const [pickerCategory, setPickerCategory] = useState<PickerCategory>('all');
  const [fetchedModels, setFetchedModels] = useState<string[]>([]);
  const [pickerState, setPickerState] = useState<{ category: Record<string, ModelKind>; selected: Record<string, boolean> }>({ category: {}, selected: {} });

  // Jimeng CLI state
  const [jimengStatus, setJimengStatus] = useState<'idle' | 'login' | 'logged' | 'error'>('idle');
  const [jimengCredit, setJimengCredit] = useState<string>('');

  // LoRA editing (stored as a side channel via loras ref on provider; we use a simple array)
  const [lorasDraft, setLorasDraft] = useState<Record<string, LoraEntry[]>>({});

  // RunningHub paste-to-add
  const [rhPasteValue, setRhPasteValue] = useState<string>('');

  // Jimeng CLI state
  const [jimengOutput, setJimengOutput] = useState<string>('');
  const [jimengHelpOpen, setJimengHelpOpen] = useState<boolean>(false);
  const [jimengHelpCmd, setJimengHelpCmd] = useState<string>('');
  const [jimengHelpOutput, setJimengHelpOutput] = useState<string>('');

  // Recommend inline open
  const [recommendInlineOpen, setRecommendInlineOpen] = useState<boolean>(false);

  // RunningHub workflow editor state
  const [rhEditorOpen, setRhEditorOpen] = useState<boolean>(false);
  const [rhEditorMode, setRhEditorMode] = useState<'app' | 'workflow'>('workflow');
  const [rhEditorIndex, setRhEditorIndex] = useState<number>(-1);
  const [rhEditorFields, setRhEditorFields] = useState<any[]>([]);
  const [rhEditorTitle, setRhEditorTitle] = useState<string>('');
  const [rhEditorNote, setRhEditorNote] = useState<string>('');
  const [rhEditorLoading, setRhEditorLoading] = useState<boolean>(false);
  const [rhEditorLoadingText, setRhEditorLoadingText] = useState<string>('');
  const [rhEditorError, setRhEditorError] = useState<string>('');
  const [rhEditorActiveNodeId, setRhEditorActiveNodeId] = useState<string>('');
  const [rhEditorExpanded, setRhEditorExpanded] = useState<Record<string, boolean>>({});

  // Sync config from parent
  useEffect(() => {
    setCfg(JSON.parse(JSON.stringify(config)));
  }, [config]);

  // Auto-select first provider
  useEffect(() => {
    if (!selectedId && cfg.providers.length > 0) {
      setSelectedId(cfg.providers[0].id);
    }
  }, [cfg.providers, selectedId]);

  // Lock body scroll while open
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  // Stop wheel/touch/scroll/keyboard events from reaching the canvas behind the modal
  useEffect(() => {
    if (!open) return;
    const stop = (e: Event) => { e.stopPropagation(); };
    const onKey = (e: KeyboardEvent) => {
      // 让 PageUp/PageDown/Arrow 在 modal 内生效，阻止冒泡到画布
      if (['PageUp', 'PageDown', 'ArrowUp', 'ArrowDown', 'Home', 'End', ' '].includes(e.key)) {
        e.stopPropagation();
      }
    };
    const modal = document.querySelector('.api-settings-modal');
    const panel = document.querySelector('.api-settings-panel');
    const targets = [modal, panel].filter(Boolean) as Element[];
    targets.forEach(el => {
      el.addEventListener('wheel', stop, { passive: true } as any);
      el.addEventListener('touchmove', stop, { passive: true } as any);
      el.addEventListener('keydown', onKey as any);
    });
    return () => {
      targets.forEach(el => {
        el.removeEventListener('wheel', stop);
        el.removeEventListener('touchmove', stop);
        el.removeEventListener('keydown', onKey as any);
      });
    };
  }, [open]);

  const provider = useCallback((): Provider | undefined => {
    return cfg.providers.find(p => p.id === selectedId);
  }, [cfg.providers, selectedId]);

  const updateProvider = useCallback((id: string, patch: Partial<Provider>) => {
    setCfg(prev => ({
      ...prev,
      providers: prev.providers.map(p => (p.id === id ? { ...p, ...patch } : p)),
    }));
  }, []);

  const lorasFor = useCallback((providerId: string): LoraEntry[] => {
    return lorasDraft[providerId] || [];
  }, [lorasDraft]);

  const setLorasFor = useCallback((providerId: string, list: LoraEntry[]) => {
    setLorasDraft(prev => ({ ...prev, [providerId]: list }));
  }, []);

  /* ---- Provider CRUD ---- */
  const addProvider = useCallback(() => {
    let id = 'custom-api';
    let index = 2;
    while (cfg.providers.some(p => p.id === id)) id = `custom-api-${index++}`;
    const newP: Provider = {
      id,
      name: 'API',
      baseUrl: '',
      protocol: 'openai',
      enabled: true,
      apiKey: '',
      imageModels: [],
      chatModels: [],
      videoModels: [],
    };
    setCfg(prev => ({ ...prev, providers: [...prev.providers, newP] }));
    setSelectedId(id);
    setShowRecommend(false);
    setStatus(t('canvasApiSettingsStatusCreated'));
  }, [cfg.providers, t]);

  const deleteProvider = useCallback(() => {
    const item = provider();
    if (!item) return;
    if (isFixedProvider(item.id)) { alert(t('canvasApiSettingsAlertDefaultNoDelete')); return; }
    if (cfg.providers.length <= 1) { alert(t('canvasApiSettingsAlertKeepOne')); return; }
    setCfg(prev => ({
      ...prev,
      providers: prev.providers.filter(p => p.id !== item.id),
    }));
    const remaining = cfg.providers.filter(p => p.id !== item.id);
    setSelectedId(remaining[0]?.id || '');
    setStatus(t('canvasApiSettingsStatusDeleted'));
  }, [provider, cfg.providers, t]);

  const selectProvider = useCallback((id: string) => {
    setSelectedId(id);
    setShowRecommend(false);
    setStatus('');
    setVerifyResult(null);
  }, []);

  /* ---- Model CRUD ---- */
  const addModel = useCallback((kind: ModelKind) => {
    const item = provider();
    if (!item) return;
    const key = MODEL_KIND_META[kind].key;
    updateProvider(item.id, { [key]: [...(item[key] as string[]), ''] });
  }, [provider, updateProvider]);

  const updateModel = useCallback((kind: ModelKind, index: number, value: string) => {
    const item = provider();
    if (!item) return;
    const key = MODEL_KIND_META[kind].key;
    const list = [...(item[key] as string[])];
    list[index] = value;
    updateProvider(item.id, { [key]: list });
  }, [provider, updateProvider]);

  const removeModel = useCallback((kind: ModelKind, index: number) => {
    const item = provider();
    if (!item) return;
    const key = MODEL_KIND_META[kind].key;
    const list = [...(item[key] as string[])];
    list.splice(index, 1);
    updateProvider(item.id, { [key]: list });
  }, [provider, updateProvider]);

  /* ---- Model Fetching ---- */
  const fetchUpstreamModels = useCallback(async (): Promise<string[]> => {
    const item = provider();
    if (!item) return [];
    if (item.protocol === 'jimeng') {
      // 即梦 CLI 通过本地命令拉取；前端无后端则用内置列表
      return ['5.0', '4.6', '4.5', '4.1', '4.0', '3.1', '3.0'];
    }
    if (item.protocol === 'runninghub') {
      return item.imageModels.length > 0 ? [...item.imageModels] : ['/openapi/v2/text2image'];
    }
    const url = buildModelListUrl(item.protocol, item.baseUrl, item.apiKey);
    if (!url) throw new Error(t('canvasApiSettingsAlertFillBaseUrl'));
    const headers = buildAuthHeader(item.protocol, item.apiKey);
    const res = await fetch(url, { method: 'GET', headers });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`HTTP ${res.status} · ${text.slice(0, 120)}`);
    }
    const data = await res.json();
    let ids: string[] = [];
    if (Array.isArray(data?.data)) {
      ids = data.data
        .map((m: any) => String(m?.id || m?.name || '').trim())
        .filter(Boolean);
    } else if (Array.isArray(data?.models)) {
      ids = data.models
        .map((m: any) => String(m?.id || m?.name || '').trim())
        .filter(Boolean);
    } else if (Array.isArray(data)) {
      ids = data
        .map((m: any) => typeof m === 'string' ? m : String(m?.id || m?.name || ''))
        .filter(Boolean);
    }
    return unique(ids);
  }, [provider, t]);

  const openModelPicker = useCallback(() => {
    const item = provider();
    if (!item) return;
    if (fetchedModels.length === 0) { alert(t('canvasApiSettingsAlertFetchFirst')); return; }
    const existing = {
      image: new Set(item.imageModels || []),
      chat: new Set(item.chatModels || []),
      video: new Set(item.videoModels || []),
    };
    const allIds = Array.from(new Set([
      ...fetchedModels,
      ...(item.imageModels || []),
      ...(item.chatModels || []),
      ...(item.videoModels || []),
    ])).sort();
    const nextCategory: Record<string, ModelKind> = {};
    const nextSelected: Record<string, boolean> = {};
    allIds.forEach(id => {
      let cat: ModelKind;
      if (existing.image.has(id)) cat = 'image';
      else if (existing.video.has(id)) cat = 'video';
      else if (existing.chat.has(id)) cat = 'chat';
      else cat = guessModelCategory(id);
      nextCategory[id] = cat;
      nextSelected[id] = existing.image.has(id) || existing.chat.has(id) || existing.video.has(id);
    });
    setPickerState({ category: nextCategory, selected: nextSelected });
    setPickerCategory('all');
    setPickerFilter('');
    setPickerOpen(true);
  }, [fetchedModels, provider, t]);

  const togglePickerRow = useCallback((id: string) => {
    setPickerState(prev => ({ ...prev, selected: { ...prev.selected, [id]: !prev.selected[id] } }));
  }, []);

  const applyModelPicker = useCallback(() => {
    const item = provider();
    if (!item) return;
    const image: string[] = [], chat: string[] = [], video: string[] = [];
    Object.entries(pickerState.selected).forEach(([id, sel]) => {
      if (!sel) return;
      const cat = pickerState.category[id] || guessModelCategory(id);
      if (cat === 'image') image.push(id);
      else if (cat === 'video') video.push(id);
      else chat.push(id);
    });
    updateProvider(item.id, { imageModels: image, chatModels: chat, videoModels: video });
    setPickerOpen(false);
    setStatus(t('canvasApiSettingsStatusApplied').replace('{img}', String(image.length)).replace('{chat}', String(chat.length)).replace('{vid}', String(video.length)));
  }, [pickerState, provider, updateProvider, t]);

  const handleFetchModels = useCallback(async () => {
    const item = provider();
    if (!item) return;
    if (item.protocol !== 'jimeng' && !item.baseUrl.trim()) { alert(t('canvasApiSettingsAlertFillBaseUrl')); return; }
    setFetching(true);
    setVerifyResult({ kind: 'info', text: t('canvasApiSettingsVerifyFetchingModels') });
    try {
      const ids = await fetchUpstreamModels();
      setFetchedModels(ids);
      if (ids.length === 0) {
        setVerifyResult({ kind: 'warn', text: t('canvasApiSettingsVerifyNoModelsParsed') });
        return;
      }
      // 自动按关键词分类，全部保存
      const image: string[] = [], chat: string[] = [], video: string[] = [];
      ids.forEach(id => {
        const cat = guessModelCategory(id);
        if (cat === 'image') image.push(id);
        else if (cat === 'video') video.push(id);
        else chat.push(id);
      });
      setCfg(prev => {
        const updatedProviders = prev.providers.map(p =>
          p.id === item.id ? { ...p, imageModels: image, chatModels: chat, videoModels: video } : p
        );
        const currentP = updatedProviders.find(p => p.id === item.id)!;
        return {
          ...prev,
          providers: updatedProviders,
          stepBindings: prev.stepBindings.map(b => {
            const boundP = updatedProviders.find(p => p.id === b.providerId);
            const boundModels = boundP
              ? [...(boundP.chatModels || []), ...(boundP.imageModels || []), ...(boundP.videoModels || [])]
              : [];
            // 自动修复绑定：无模型 / modelId 为空 / 当前模型不在步骤期望分类中
            const expectedKind = STEP_DEFAULT_MODEL_KIND[b.step];
            const expectedKey = MODEL_KIND_META[expectedKind].key;
            const expectedModels = boundP ? ((boundP[expectedKey] as string[]) || []) : [];
            const isMismatch = b.modelId && !expectedModels.includes(b.modelId);
            if (boundModels.length === 0 || !b.modelId || isMismatch) {
              return { ...b, providerId: item.id, modelId: getDefaultModelForStep(b.step, currentP) };
            }
            return b;
          }),
        };
      });
      setStatus(t('canvasApiSettingsStatusAutoAllocated').replace('{img}', String(image.length)).replace('{chat}', String(chat.length)).replace('{vid}', String(video.length)));
      setVerifyResult({ kind: 'ok', text: t('canvasApiSettingsVerifyFetchedOk').replace('{count}', String(ids.length)) });
    } catch (e: any) {
      setVerifyResult({ kind: 'warn', text: t('canvasApiSettingsVerifyFetchFail').replace('{msg}', e?.message || String(e)) });
    } finally {
      setFetching(false);
    }
  }, [provider, fetchUpstreamModels, t]);

  /* ---- Verify Connection ---- */
  const handleVerifyUrl = useCallback(async () => {
    const item = provider();
    if (!item) return;
    if (item.protocol === 'jimeng') {
      setJimengStatus(jimengStatus === 'logged' ? 'logged' : 'login');
      setVerifyResult({ kind: 'info', text: t('canvasApiSettingsVerifyJimengHint') });
      return;
    }
    if (!item.baseUrl.trim()) { alert(t('canvasApiSettingsAlertFillBaseUrl')); return; }
    setFetching(true);
    setVerifyResult({ kind: 'info', text: t('canvasApiSettingsVerifyVerifyingUrl') });
    try {
      const url = buildModelListUrl(item.protocol, item.baseUrl, item.apiKey);
      if (!url) throw new Error(t('canvasApiSettingsErrorCannotBuildVerifyUrl'));
      const res = await fetch(url, { method: 'GET', headers: buildAuthHeader(item.protocol, item.apiKey) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setVerifyResult({ kind: 'ok', text: t('canvasApiSettingsVerifyUrlOk') });
    } catch (e: any) {
      setVerifyResult({ kind: 'warn', text: t('canvasApiSettingsVerifyUrlFail').replace('{msg}', e?.message || String(e)) });
    } finally {
      setFetching(false);
    }
  }, [provider, jimengStatus, t]);

  /* ---- Verify Protocol (auto-detect apimart vs openai) ---- */
  const handleProbeProtocol = useCallback(async () => {
    const item = provider();
    if (!item) return;
    if (item.protocol === 'gemini') { setVerifyResult({ kind: 'info', text: t('canvasApiSettingsVerifyGeminiManual') }); return; }
    if (!item.baseUrl.trim()) { alert(t('canvasApiSettingsAlertFillBaseUrl')); return; }
    setFetching(true);
    setVerifyResult({ kind: 'info', text: t('canvasApiSettingsVerifyDetectingProtocol') });
    try {
      // Try an async task endpoint (apimart-specific) — if 200/202, set apimart; else openai
      const base = cleanBaseUrl(item.baseUrl);
      const tryUrl = `${base}/v1/tasks/test-${Math.random().toString(36).slice(2, 8)}`;
      const res = await fetch(tryUrl, {
        method: 'POST',
        headers: buildAuthHeader(item.protocol, item.apiKey),
        body: JSON.stringify({ model: 'probe', test: true }),
      }).catch(() => null);
      const isAsync = !!(res && (res.status === 200 || res.status === 202 || res.status === 400));
      // 400 is typical apimart (validation); 404 is typical openai
      const isActuallyAsync = res ? (res.status === 200 || res.status === 202 || (res.status === 400 && res.status !== 404)) : false;
      const detected = isActuallyAsync ? 'apimart' : 'openai';
      if (item.protocol !== 'gemini') {
        updateProvider(item.id, { protocol: detected });
      }
      setVerifyResult({ kind: 'ok', text: t('canvasApiSettingsVerifyProtocolSet').replace('{type}', detected === 'apimart' ? t('canvasApiSettingsProtocolApimart') : t('canvasApiSettingsProtocolOpenai')) });
    } catch (e: any) {
      setVerifyResult({ kind: 'warn', text: t('canvasApiSettingsVerifyProtocolFail').replace('{msg}', e?.message || String(e)) });
      if (item.protocol !== 'gemini') updateProvider(item.id, { protocol: 'openai' });
    } finally {
      setFetching(false);
    }
  }, [provider, updateProvider, t]);

  /* ---- Jimeng CLI handlers (with local mock fallback) ---- */
  const handleJimengLogin = useCallback(() => {
    setJimengStatus('login');
    setJimengOutput(t('canvasApiSettingsJimengLoginOutput'));
    setTimeout(() => {
      setJimengStatus('logged');
      setJimengCredit('1280 (Mock)');
    }, 600);
  }, [t]);

  const handleJimengCredit = useCallback(() => {
    setJimengOutput(t('canvasApiSettingsJimengCreditOutput').replace('{credit}', jimengCredit || '1280'));
  }, [jimengCredit, t]);

  const handleJimengLogout = useCallback(() => {
    if (!confirm(t('canvasApiSettingsAlertConfirmLogoutJimeng'))) return;
    setJimengStatus('idle');
    setJimengCredit('');
    setJimengOutput(t('canvasApiSettingsJimengLoggedOut'));
  }, [t]);

  const loadJimengHelp = useCallback(() => {
    const cmd = jimengHelpCmd;
    const HELP_KEYS: Record<string, string> = {
      '': 'canvasApiSettingsJimengHelpOverview',
      'login': 'canvasApiSettingsJimengHelpLogin',
      'logout': 'canvasApiSettingsJimengHelpLogout',
      'user_credit': 'canvasApiSettingsJimengHelpUserCredit',
      'text2image': 'canvasApiSettingsJimengHelpText2Image',
      'image2image': 'canvasApiSettingsJimengHelpImage2Image',
      'image_upscale': 'canvasApiSettingsJimengHelpImageUpscale',
      'text2video': 'canvasApiSettingsJimengHelpText2Video',
      'image2video': 'canvasApiSettingsJimengHelpImage2Video',
      'multimodal2video': 'canvasApiSettingsJimengHelpMultimodal2Video',
      'frames2video': 'canvasApiSettingsJimengHelpFrames2Video',
      'multiframe2video': 'canvasApiSettingsJimengHelpMultiframe2Video',
      'list_task': 'canvasApiSettingsJimengHelpListTask',
      'query_result': 'canvasApiSettingsJimengHelpQueryResult',
    };
    const key = HELP_KEYS[cmd];
    setJimengHelpOutput(key ? t(key) : `dreamina ${cmd}\n\n${t('canvasApiSettingsJimengHelpNotFound')}`);
  }, [jimengHelpCmd, t]);

  /* ---- Step Binding ---- */
  const updateStepBinding = useCallback((step: StepType, providerId: string, modelId: string) => {
    setCfg(prev => ({
      ...prev,
      stepBindings: prev.stepBindings.map(b =>
        b.step === step ? { ...b, providerId, modelId } : b
      ),
    }));
  }, []);

  /* ---- Recommend API ---- */
  const saveRecommendedApi = useCallback((index: number) => {
    const api = RECOMMENDED_APIS[index];
    if (!api) return;
    const input = document.querySelector(`[data-recommend-key="${index}"]`) as HTMLInputElement;
    const key = input?.value?.trim() || '';
    if (api.protocol !== 'jimeng' && !key) { alert(t('canvasApiSettingsAlertEnterApiKey')); return; }

    let item = cfg.providers.find(p => p.name.toLowerCase() === api.name.toLowerCase());
    if (!item) {
      const baseId = normalizeId(api.name) || 'custom-api';
      let id = baseId;
      let suffix = 2;
      while (cfg.providers.some(p => p.id === id)) id = `${baseId}-${suffix++}`;
      item = {
        id,
        name: api.name,
        baseUrl: api.baseUrl,
        protocol: api.protocol,
        enabled: true,
        apiKey: key,
        imageModels: [],
        chatModels: [],
        videoModels: [],
      };
      setCfg(prev => ({ ...prev, providers: [...prev.providers, item!] }));
      setSelectedId(id);
    } else {
      const patch: Partial<Provider> = { protocol: api.protocol };
      if (api.protocol !== 'jimeng' || key) patch.baseUrl = api.baseUrl;
      if (key) patch.apiKey = key;
      updateProvider(item.id, patch);
      setSelectedId(item.id);
    }
    setShowRecommend(false);
    setStatus(t('canvasApiSettingsStatusAdded').replace('{name}', api.name));
  }, [cfg.providers, updateProvider, t]);

  /* ---- LoRA Management (ModelScope) ---- */
  const addLora = useCallback((providerId: string) => {
    const list = lorasFor(providerId);
    const imageModels = cfg.providers.find(p => p.id === providerId)?.imageModels || [];
    const target = MS_BUILTIN_IMAGE_MODELS.find(m => imageModels.includes(m)) || MS_BUILTIN_IMAGE_MODELS[0];
    const entry: LoraEntry = {
      id: `lora-${Math.random().toString(36).slice(2, 8)}`,
      name: 'New LoRA',
      targetModel: target,
      strength: 0.8,
      enabled: true,
    };
    setLorasFor(providerId, [...list, entry]);
  }, [cfg.providers, lorasFor, setLorasFor]);

  const updateLora = useCallback((providerId: string, index: number, patch: Partial<LoraEntry>) => {
    const list = lorasFor(providerId);
    const next = [...list];
    next[index] = { ...next[index], ...patch };
    setLorasFor(providerId, next);
  }, [lorasFor, setLorasFor]);

  const removeLora = useCallback((providerId: string, index: number) => {
    const list = lorasFor(providerId);
    const next = [...list];
    next.splice(index, 1);
    setLorasFor(providerId, next);
  }, [lorasFor, setLorasFor]);

  /* ---- Save ---- */
  const handleSave = useCallback(() => {
    // Normalize providers before saving
    const normalized = {
      ...cfg,
      providers: cfg.providers.map(p => ({
        ...p,
        id: normalizeId(p.id),
        imageModels: unique(p.imageModels),
        chatModels: unique(p.chatModels),
        videoModels: unique(p.videoModels),
      })),
    };
    onSave(normalized);
    setSaved(true);
    setStatus(t('canvasApiSettingsStatusSaved'));
    setTimeout(() => setSaved(false), 2000);
  }, [cfg, onSave, t]);

  /* ---- Key save ---- */
  const saveKeyOnly = useCallback(() => {
    const item = provider();
    if (!item) return;
    handleSave();
  }, [provider, handleSave]);

  const clearKeyOnly = useCallback(() => {
    const item = provider();
    if (!item) return;
    if (!confirm(t('canvasApiSettingsAlertConfirmClearKey'))) return;
    updateProvider(item.id, { apiKey: '', hasKey: false, keyPreview: '' });
    handleSave();
  }, [provider, updateProvider, handleSave, t]);

  /* ---- Render helpers ---- */
  const p = provider();

  const renderProviderList = () => (
    <aside className="api-sidebar">
      <div className="api-side-section-title">{t('canvasApiSettingsProviderList')}</div>
      <div className="api-provider-list">
        {cfg.providers.map(item => {
          const isActive = item.id === selectedId;
          const stateClass = !item.enabled ? 'is-disabled' : (item.hasKey || item.hasWalletKey) ? 'has-key' : 'missing-key';
          const pLabel = protocolLabel(item);
          return (
            <button
              key={item.id}
              className={`api-provider-card ${isActive ? 'active' : ''} ${stateClass}`}
              onClick={() => selectProvider(item.id)}
            >
              <span className="api-provider-mark">
                {item.hasKey ? <Key size={14} /> : <KeyRound size={14} />}
              </span>
              <span className="api-provider-info">
                <div className="api-provider-name">{item.name || item.id}</div>
                <div className="api-provider-meta">{item.baseUrl || t('canvasApiSettingsNotConfiguredUrl')}</div>
              </span>
              <span className="api-provider-side-meta">
                <span className={`api-provider-status-dot ${item.hasKey ? 'on' : ''}`} />
                <span className="api-provider-protocol-pill">{pLabel}</span>
              </span>
            </button>
          );
        })}
      </div>
      <button className="api-add-btn" onClick={addProvider}>{t('canvasApiSettingsAddProviderBtn')}</button>
      <button className="api-recommend-btn" onClick={() => { setShowRecommend(true); setStatus(''); }}><Sparkles size={14} /> {t('canvasApiSettingsRecommendApi')}</button>
    </aside>
  );

  const renderRecommendPanel = () => (
    <div className="api-content">
      <div className="api-content-head">
        <div>
          <div className="api-editor-title">{t('canvasApiSettingsRecommendApi')}</div>
          <div className="api-editor-sub">{t('canvasApiSettingsRecommendApiSub')}</div>
        </div>
        <div className="api-content-actions">
          <button className="api-action-btn" onClick={() => setShowRecommend(false)}><ArrowLeft size={14} /> {t('canvasApiSettingsBack')}</button>
        </div>
      </div>
      <div className="api-recommend-body">
        {RECOMMENDED_APIS.map((api, index) => (
          <section key={api.name} className="api-recommend-card">
            <div className="api-recommend-platform-info">
              <div className="api-recommend-name">
                <span>{api.name}</span>
                <span className="api-recommend-badge">{api.protocol === 'apimart' ? 'APIMart' : 'OpenAI'}</span>
              </div>
              <p className="api-recommend-summary">{api.summary}</p>
              <div className="api-recommend-tags">
                {api.tags.map(tag => (
                  <span key={tag} className="api-recommend-tag">{tag}</span>
                ))}
              </div>
            </div>
            <div className="api-recommend-setup">
              <div className="api-recommend-setup-title">{t('canvasApiSettingsQuickConfig')}</div>
              <div className="api-recommend-quick-stack">
                <div className="api-recommend-guide-source">
                  <div className="api-recommend-source-label">{t('canvasApiSettingsGetKey')}</div>
                  <a
                    className="api-recommend-key-btn"
                    href={api.registerUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <Key size={14} /> {t('canvasApiSettingsGet')}
                  </a>
                </div>
                <div className="api-recommend-flow-arrow"><ArrowRight size={14} /></div>
                <div className="api-recommend-guide-save">
                  <div className="api-recommend-key-field">
                    <span>API Key</span>
                    <input
                      type="password"
                      data-recommend-key={index}
                      placeholder={t('canvasApiSettingsEnterNameApiKey').replace('{name}', api.name)}
                    />
                  </div>
                  <button className="api-recommend-save-btn" onClick={() => saveRecommendedApi(index)}>
                    {t('canvasApiSettingsSave')}
                  </button>
                </div>
              </div>
            </div>
          </section>
        ))}
      </div>
      <div className="api-recommend-note">
        {t('canvasApiSettingsRecommendNote')}
      </div>
    </div>
  );

  const renderModelSection = (kind: ModelKind) => {
    const models = (p?.[MODEL_KIND_META[kind].key] as string[]) || [];
    return (
      <div className="api-model-list">
        {models.length === 0 && <div className="api-model-empty">{t('canvasApiSettingsNoModels')}</div>}
        {models.map((model, index) => (
          <div key={index} className="api-model-row">
            <input
              value={model}
              onChange={e => updateModel(kind, index, e.target.value)}
              placeholder={t('canvasApiSettingsModelIdPlaceholder')}
            />
            <button className="api-icon-btn" onClick={() => removeModel(kind, index)} title={t('canvasApiSettingsDelete')}><X size={14} /></button>
          </div>
        ))}
      </div>
    );
  };

  /* ---- Render provider onboarding (new user guidance) ---- */
  const renderOnboarding = () => {
    if (showRecommend || recommendInlineOpen) return null;
    if (!p) return null;
    const isNewModelScope = p.id === 'modelscope' && !p.hasKey;
    const isNewRunningHub = p.id === 'runninghub' && !p.hasKey && !p.hasWalletKey;
    if (!isNewModelScope && !isNewRunningHub) return null;
    if (isNewModelScope) {
      return (
        <section className="api-provider-onboarding">
          <div className="api-onboarding-head">
            <div>
              <div className="api-onboarding-title">{t('canvasApiSettingsModelscopeTitle')}</div>
              <div className="api-onboarding-desc">{t('canvasApiSettingsModelscopeDesc')}</div>
            </div>
            <span className="api-onboarding-badge">NEW</span>
          </div>
          <div className="api-onboarding-linear-rows">
            <div className="api-onboarding-linear-row">
              <div className="api-onboarding-source-group">
                <div className="api-onboarding-source-label">{t('canvasApiSettingsGetToken')}</div>
                <div className="api-onboarding-key-actions">
                  <a className="api-onboarding-key-btn" href="https://www.modelscope.cn/my/access/token" target="_blank" rel="noopener noreferrer"><Key size={14} /> {t('canvasApiSettingsDomesticToken')}</a>
                  <a className="api-onboarding-key-btn" href="https://www.modelscope.ai/my/access/token" target="_blank" rel="noopener noreferrer"><Globe size={14} /> {t('canvasApiSettingsOverseasToken')}</a>
                </div>
              </div>
              <div className="api-onboarding-flow-arrow"><ArrowRight size={14} /></div>
              <div className="api-onboarding-key-field">
                <span>API Key</span>
                <input
                  type="password"
                  value={p.apiKey}
                  onChange={e => updateProvider(p.id, { apiKey: e.target.value })}
                  placeholder={t('canvasApiSettingsEnterModelscopeToken')}
                />
              </div>
            </div>
          </div>
          <div className="api-onboarding-save-line">
            <button className="api-onboarding-save-btn" onClick={saveKeyOnly}><Check size={14} /> {t('canvasApiSettingsSave')}</button>
          </div>
        </section>
      );
    }
    if (isNewRunningHub) {
      return (
        <section className="api-provider-onboarding">
          <div className="api-onboarding-head">
            <div>
              <div className="api-onboarding-title">{t('canvasApiSettingsRunninghubTitle')}</div>
              <div className="api-onboarding-desc">{t('canvasApiSettingsRunninghubDesc')}</div>
            </div>
            <span className="api-onboarding-badge">NEW</span>
          </div>
          <div className="api-onboarding-linear-rows">
            <div className="api-onboarding-linear-row">
              <div className="api-onboarding-source-group">
                <div className="api-onboarding-source-label">{t('canvasApiSettingsRhCoinKeyRequired')}</div>
                <div className="api-onboarding-key-actions">
                  <a className="api-onboarding-key-btn" href="https://www.runninghub.cn/enterprise-api/consumerApi?inviteCode=rh-v1331" target="_blank" rel="noopener noreferrer"><Coins size={14} /> {t('canvasApiSettingsDomesticKey')}</a>
                  <a className="api-onboarding-key-btn" href="https://www.runninghub.ai/enterprise-api/consumerApi?inviteCode=rh-v1331" target="_blank" rel="noopener noreferrer"><Globe size={14} /> {t('canvasApiSettingsOverseasKey')}</a>
                </div>
              </div>
              <div className="api-onboarding-flow-arrow"><ArrowRight size={14} /></div>
              <div className="api-onboarding-key-field">
                <span>{t('canvasApiSettingsRhCoinApiKeyLabel')}</span>
                <input
                  type="password"
                  value={p.apiKey}
                  onChange={e => updateProvider(p.id, { apiKey: e.target.value })}
                  placeholder={t('canvasApiSettingsEnterRhCoinKey')}
                />
              </div>
            </div>
            <div className="api-onboarding-linear-row">
              <div className="api-onboarding-source-group">
                <div className="api-onboarding-source-label">{t('canvasApiSettingsBalanceKeyOptional')}</div>
                <div className="api-onboarding-key-actions">
                  <a className="api-onboarding-key-btn" href="https://www.runninghub.cn/enterprise-api/sharedApi?inviteCode=rh-v1331" target="_blank" rel="noopener noreferrer"><Wallet size={14} /> {t('canvasApiSettingsDomesticKey')}</a>
                  <a className="api-onboarding-key-btn" href="https://www.runninghub.ai/enterprise-api/sharedApi?inviteCode=rh-v1331" target="_blank" rel="noopener noreferrer"><Globe size={14} /> {t('canvasApiSettingsOverseasKey')}</a>
                </div>
              </div>
              <div className="api-onboarding-flow-arrow"><ArrowRight size={14} /></div>
              <div className="api-onboarding-key-field">
                <span>{t('canvasApiSettingsBalanceApiKeyLabel')}</span>
                <input
                  type="password"
                  value={p.walletApiKey || ''}
                  onChange={e => updateProvider(p.id, { walletApiKey: e.target.value })}
                  placeholder={t('canvasApiSettingsEnterBalanceKey')}
                />
              </div>
            </div>
          </div>
          <div className="api-onboarding-save-line">
            <button className="api-onboarding-save-btn" onClick={saveKeyOnly}><Check size={14} /> {t('canvasApiSettingsSave')}</button>
          </div>
        </section>
      );
    }
    return null;
  };

  /* ---- Render LoRA section ---- */
  const renderLoraSection = () => {
    if (!p || p.id !== 'modelscope') return null;
    const list = lorasFor(p.id);
    return (
      <section className="api-block">
        <div className="api-block-head">
          <div>
            <div className="api-block-title">{t('canvasApiSettingsLoraManagement')}</div>
            <div className="api-block-desc">{t('canvasApiSettingsLoraDesc')}</div>
            <div className="api-hint">
              {t('canvasApiSettingsCnModelLib')}<a href="https://www.modelscope.cn/aigc/models" target="_blank" rel="noopener noreferrer">modelscope.cn/aigc/models</a>
              {t('canvasApiSettingsEnModelLib')}<a href="https://www.modelscope.ai/civision/models" target="_blank" rel="noopener noreferrer">modelscope.ai/civision/models</a>
            </div>
          </div>
          <button className="api-ghost-btn" onClick={() => addLora(p.id)}>+ LoRA</button>
        </div>
        {list.length === 0 && <div className="api-model-empty">{t('canvasApiSettingsNoLora')}</div>}
        <div className="api-lora-list">
          {list.map((entry, index) => (
            <div key={entry.id} className="api-lora-row">
              <div className="api-field-frame">
                <input
                  value={entry.name}
                  onChange={e => updateLora(p.id, index, { name: e.target.value })}
                  placeholder={t('canvasApiSettingsLoraNamePlaceholder')}
                />
              </div>
              <div className="api-field-frame">
                <select
                  value={entry.targetModel}
                  onChange={e => updateLora(p.id, index, { targetModel: e.target.value })}
                >
                  {(p.imageModels || []).length === 0 && MS_BUILTIN_IMAGE_MODELS.map(m => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                  {(p.imageModels || []).map(m => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                </select>
              </div>
              <div className="api-field-frame">
                <input
                  type="number"
                  step="0.05"
                  min="0"
                  max="2"
                  value={entry.strength}
                  onChange={e => updateLora(p.id, index, { strength: parseFloat(e.target.value) || 0 })}
                  placeholder={t('canvasApiSettingsStrengthPlaceholder')}
                />
              </div>
              <label className="api-toggle">
                <input
                  type="checkbox"
                  checked={entry.enabled}
                  onChange={e => updateLora(p.id, index, { enabled: e.target.checked })}
                />
                {t('canvasApiSettingsEnable')}
              </label>
              <button className="api-icon-btn" onClick={() => removeLora(p.id, index)} title={t('canvasApiSettingsDelete')}><X size={14} /></button>
            </div>
          ))}
        </div>
      </section>
    );
  };

  /* ---- Render Jimeng CLI panel ---- */
  const renderJimengPanel = () => {
    if (!p || p.protocol !== 'jimeng') return null;
    const statusText = jimengStatus === 'logged' ? t('canvasApiSettingsJimengStatusLogged') : jimengStatus === 'login' ? t('canvasApiSettingsJimengStatusLogin') : jimengStatus === 'error' ? t('canvasApiSettingsJimengStatusError') : t('canvasApiSettingsJimengStatusIdle');
    return (
      <div className="api-jimeng-panel">
        <div className="api-jimeng-head">
          <div>
            <div className="api-rh-key-title">{t('canvasApiSettingsJimengAccount')}</div>
            <div className="api-rh-key-desc">{t('canvasApiSettingsJimengAccountDesc')}</div>
          </div>
          <span className={`api-jimeng-status-pill is-${jimengStatus}`}>{statusText}</span>
        </div>
        <div className="api-jimeng-actions">
          <button className="api-action-btn api-primary-btn" onClick={handleJimengLogin}><Smartphone size={14} /> {t('canvasApiSettingsQrLogin')}</button>
          <button className="api-action-btn" onClick={handleJimengCredit}><CreditCard size={14} /> {t('canvasApiSettingsQueryCredit')}</button>
          <button className="api-action-btn" onClick={() => setJimengHelpOpen(true)}><BookOpen size={14} /> {t('canvasApiSettingsHelp')}</button>
          <button className="api-action-btn api-danger-btn" onClick={handleJimengLogout}><LogOut size={14} /> {t('canvasApiSettingsLogout')}</button>
        </div>
        {jimengCredit && <div className="api-jimeng-credit"><Wallet size={14} /> {t('canvasApiSettingsCreditBalance')}{jimengCredit}</div>}
        {jimengOutput && <div className="api-jimeng-output">{jimengOutput}</div>}
      </div>
    );
  };

  /* ---- Render RunningHub paste-to-add section ---- */
  const parseRhRef = (value: string): { type: 'app' | 'workflow'; id: string } | null => {
    const text = String(value || '').trim();
    const match = text.match(/\/run\/(ai-app|workflow)\/([0-9A-Za-z_-]+)/i);
    if (match) return { type: match[1].toLowerCase() === 'ai-app' ? 'app' : 'workflow', id: match[2] };
    const numeric = text.match(/^[0-9]{8,}$/);
    if (numeric) return { type: 'workflow', id: text };
    return null;
  };

  const handleRhPasteCreate = () => {
    if (!p || p.id !== 'runninghub') return;
    const parsed = parseRhRef(rhPasteValue);
    if (!parsed) { setStatus(t('canvasApiSettingsStatusRhPastePrompt')); return; }
    const listKey = parsed.type === 'app' ? 'rhApps' : 'rhWorkflows';
    const list = (p[listKey] as any[]) || [];
    if (list.some(e => e.id === parsed.id)) {
      setStatus(t('canvasApiSettingsStatusRhExists'));
      return;
    }
    const typeLabel = parsed.type === 'app' ? t('canvasApiSettingsAiApp') : t('canvasApiSettingsWorkflow');
    const newEntry = {
      id: parsed.id,
      title: `${typeLabel} ${parsed.id.slice(-6)}`,
      note: '',
      enabled: true,
      [parsed.type === 'app' ? 'appId' : 'workflowId']: parsed.id,
    };
    updateProvider(p.id, { [listKey]: [newEntry, ...list] });
    setRhPasteValue('');
    setStatus(t('canvasApiSettingsStatusRhCardCreated').replace('{type}', typeLabel));
  };

  const updateRhEntry = (kind: 'app' | 'workflow', index: number, patch: any) => {
    if (!p || p.id !== 'runninghub') return;
    const listKey = kind === 'app' ? 'rhApps' : 'rhWorkflows';
    const list = [...((p[listKey] as any[]) || [])];
    list[index] = { ...list[index], ...patch };
    updateProvider(p.id, { [listKey]: list });
  };

  const removeRhEntry = (kind: 'app' | 'workflow', index: number) => {
    if (!p || p.id !== 'runninghub') return;
    const listKey = kind === 'app' ? 'rhApps' : 'rhWorkflows';
    const list = [...((p[listKey] as any[]) || [])];
    list.splice(index, 1);
    updateProvider(p.id, { [listKey]: list });
  };

  /* ---- RunningHub workflow editor ---- */
  const openRhEditor = (kind: 'app' | 'workflow', index: number) => {
    if (!p || p.id !== 'runninghub') return;
    const listKey = kind === 'app' ? 'rhApps' : 'rhWorkflows';
    const list = (p[listKey] as any[]) || [];
    const entry = list[index];
    if (!entry) return;
    setRhEditorMode(kind);
    setRhEditorIndex(index);
    setRhEditorTitle(entry.title || '');
    setRhEditorNote(entry.note || '');
    setRhEditorFields(entry.fields || []);
    setRhEditorError('');
    setRhEditorActiveNodeId('');
    setRhEditorExpanded({});
    setRhEditorOpen(true);
  };

  const closeRhEditor = () => {
    setRhEditorOpen(false);
  };

  const refetchRhEditor = async () => {
    if (!p || rhEditorIndex < 0) return;
    const listKey = rhEditorMode === 'app' ? 'rhApps' : 'rhWorkflows';
    const list = (p[listKey] as any[]) || [];
    const entry = list[rhEditorIndex];
    if (!entry) return;
    const id = rhEditorMode === 'app' ? (entry.appId || entry.id) : (entry.workflowId || entry.id);
    if (!id) {
      setRhEditorError(t('canvasApiSettingsErrorRhIdNotFound'));
      return;
    }
    setRhEditorLoading(true);
    setRhEditorError('');
    const typeLabel = rhEditorMode === 'app' ? t('canvasApiSettingsAiApp') : t('canvasApiSettingsWorkflow');
    setRhEditorLoadingText(`${t('canvasApiSettingsRefetch')} ${typeLabel} ${id.slice(-6)}…`);
    try {
      let res: Response;
      if (rhEditorMode === 'app') {
        res = await fetch(`/api/runninghub/app-info?webappId=${encodeURIComponent(id)}`);
      } else {
        res = await fetch('/api/runninghub/workflows/fetch', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ workflowId: id, title: rhEditorTitle || entry.title || id, description: rhEditorNote || entry.note || '' }),
        });
      }
      const data = await res.json();
      if (!res.ok || data.success === false) throw new Error(data.detail || t('canvasApiSettingsErrorRhFetchFailed'));
      let fields: any[] = [];
      if (rhEditorMode === 'app') {
        const fieldList = data?.data?.inputs || data?.data?.fields || data?.inputs || [];
        fields = fieldList.map((f: any, i: number) => ({
          id: f.id || f.nodeId || f.name || `field-${i}`,
          nodeId: f.nodeId || 'app',
          fieldName: f.name || f.fieldName || f.id || `field-${i}`,
          fieldValue: f.value !== undefined ? String(f.value) : (f.fieldValue || ''),
          fieldType: f.type || f.fieldType || 'string',
          label: f.label || f.name || f.fieldName,
          enabled: f.enabled !== false,
          required: !!f.required,
          group: f.group || f.nodeTitle || t('canvasApiSettingsAppParamsGroup'),
          note: f.description || f.note || '',
        }));
      } else {
        fields = (data?.data?.fields || []).map((f: any, i: number) => ({
          id: f.id || `${f.nodeId}-${f.fieldName}-${i}`,
          nodeId: f.nodeId || '',
          fieldName: f.fieldName || f.name || '',
          fieldValue: f.fieldValue !== undefined ? String(f.fieldValue) : '',
          fieldType: f.fieldType || f.type || 'string',
          label: f.label || f.fieldName,
          enabled: f.enabled !== false,
          required: !!f.required,
          group: f.group || f.nodeTitle || `Node #${f.nodeId}`,
          note: f.note || f.description || '',
        }));
      }
      if (fields.length === 0) {
        // 后端无字段时给出占位空列表
        setRhEditorFields([]);
        setRhEditorError(t('canvasApiSettingsErrorRhNoFields'));
      } else {
        setRhEditorFields(fields);
        setRhEditorError('');
      }
    } catch (e: any) {
      setRhEditorError(t('canvasApiSettingsVerifyFetchFail').replace('{msg}', e?.message || String(e)));
    } finally {
      setRhEditorLoading(false);
    }
  };

  const updateRhEditorField = (index: number, patch: any) => {
    setRhEditorFields(prev => {
      const next = [...prev];
      next[index] = { ...next[index], ...patch };
      return next;
    });
  };

  const saveRhEditor = () => {
    if (!p || rhEditorIndex < 0) return;
    const listKey = rhEditorMode === 'app' ? 'rhApps' : 'rhWorkflows';
    const list = [...((p[listKey] as any[]) || [])];
    if (!list[rhEditorIndex]) return;
    list[rhEditorIndex] = {
      ...list[rhEditorIndex],
      title: rhEditorTitle || list[rhEditorIndex].title,
      note: rhEditorNote,
      fields: rhEditorFields,
      updatedAt: Date.now(),
    };
    updateProvider(p.id, { [listKey]: list });
    const typeLabel = rhEditorMode === 'app' ? t('canvasApiSettingsAiApp') : t('canvasApiSettingsWorkflow');
    setStatus(t('canvasApiSettingsStatusRhEditorSaved').replace('{type}', typeLabel));
  };

  const rhEditorGroupedFields = useMemo(() => {
    const groups: Record<string, any[]> = {};
    rhEditorFields.forEach((field, index) => {
      const key = field.group || field.nodeId || t('canvasApiSettingsDefaultGroup');
      if (!groups[key]) groups[key] = [];
      groups[key].push({ field, index });
    });
    return groups;
  }, [rhEditorFields, t]);

  const renderRunningHubSection = () => {
    if (!p || p.id !== 'runninghub') return null;
    const apps = (p.rhApps || []) as any[];
    const workflows = (p.rhWorkflows || []) as any[];
    return (
      <section className="api-block">
        <div className="api-block-head">
          <div>
            <div className="api-block-title">{t('canvasApiSettingsAppWorkflow')}</div>
            <div className="api-block-desc">{t('canvasApiSettingsAppWorkflowDesc')}</div>
          </div>
        </div>
        <div className="api-rh-paste-row">
          <div className="api-field-frame">
            <input
              value={rhPasteValue}
              onChange={e => {
                const val = e.target.value;
                setRhPasteValue(val);
                const parsed = parseRhRef(val);
                if (parsed) setStatus(t('canvasApiSettingsStatusRhPathRecognized'));
              }}
              placeholder={t('canvasApiSettingsPastePathPlaceholder')}
            />
          </div>
          <button className="api-action-btn api-primary-btn" onClick={handleRhPasteCreate}>{t('canvasApiSettingsCreate')}</button>
        </div>
        <div className="api-rh-card-columns">
          <div className="api-rh-card-group">
            <div className="api-rh-group-head">
              <div className="api-rh-group-title">{t('canvasApiSettingsAiApp')}</div>
              <div className="api-rh-group-count">{apps.length}</div>
            </div>
            <div className="api-rh-card-list">
              {apps.length === 0 && <div className="api-rh-card-empty">{t('canvasApiSettingsNoAiApp')}</div>}
              {apps.map((entry, index) => (
                <div key={entry.id} className="api-rh-card">
                  <div className="api-rh-card-head">
                    <input
                      className="api-rh-card-title"
                      value={entry.title || ''}
                      onChange={e => updateRhEntry('app', index, { title: e.target.value })}
                      placeholder={t('canvasApiSettingsTitlePlaceholder')}
                    />
                    <label className="api-toggle">
                      <input
                        type="checkbox"
                        checked={entry.enabled !== false}
                        onChange={e => updateRhEntry('app', index, { enabled: e.target.checked })}
                      />
                      {t('canvasApiSettingsEnable')}
                    </label>
                    <button className="api-icon-btn" onClick={() => openRhEditor('app', index)} title={t('canvasApiSettingsEditParams')}><Pencil size={14} /></button>
                    <button className="api-icon-btn" onClick={() => removeRhEntry('app', index)} title={t('canvasApiSettingsDelete')}><X size={14} /></button>
                  </div>
                  <div className="api-rh-card-path">/run/ai-app/{entry.appId || entry.id}</div>
                  <div className="api-rh-card-meta">
                    {entry.fields && entry.fields.length > 0
                      ? t('canvasApiSettingsConfiguredParams').replace('{count}', String(entry.fields.length))
                      : <>{t('canvasApiSettingsNoParamsPrefix')}<Pencil size={12} />{t('canvasApiSettingsNoParamsSuffix')}</>}
                  </div>
                  <textarea
                    placeholder={t('canvasApiSettingsNoteOptional')}
                    value={entry.note || ''}
                    onChange={e => updateRhEntry('app', index, { note: e.target.value })}
                  />
                </div>
              ))}
            </div>
          </div>
          <div className="api-rh-card-group">
            <div className="api-rh-group-head">
              <div className="api-rh-group-title">{t('canvasApiSettingsWorkflow')}</div>
              <div className="api-rh-group-count">{workflows.length}</div>
            </div>
            <div className="api-rh-card-list">
              {workflows.length === 0 && <div className="api-rh-card-empty">{t('canvasApiSettingsNoWorkflow')}</div>}
              {workflows.map((entry, index) => (
                <div key={entry.id} className="api-rh-card">
                  <div className="api-rh-card-head">
                    <input
                      className="api-rh-card-title"
                      value={entry.title || ''}
                      onChange={e => updateRhEntry('workflow', index, { title: e.target.value })}
                      placeholder={t('canvasApiSettingsTitlePlaceholder')}
                    />
                    <label className="api-toggle">
                      <input
                        type="checkbox"
                        checked={entry.enabled !== false}
                        onChange={e => updateRhEntry('workflow', index, { enabled: e.target.checked })}
                      />
                      {t('canvasApiSettingsEnable')}
                    </label>
                    <button className="api-icon-btn" onClick={() => openRhEditor('workflow', index)} title={t('canvasApiSettingsEditParams')}><Pencil size={14} /></button>
                    <button className="api-icon-btn" onClick={() => removeRhEntry('workflow', index)} title={t('canvasApiSettingsDelete')}><X size={14} /></button>
                  </div>
                  <div className="api-rh-card-path">/run/workflow/{entry.workflowId || entry.id}</div>
                  <div className="api-rh-card-meta">
                    {entry.fields && entry.fields.length > 0
                      ? t('canvasApiSettingsConfiguredParams').replace('{count}', String(entry.fields.length))
                      : <>{t('canvasApiSettingsNoParamsPrefix')}<Pencil size={12} />{t('canvasApiSettingsNoParamsSuffix')}</>}
                  </div>
                  <textarea
                    placeholder={t('canvasApiSettingsNoteOptional')}
                    value={entry.note || ''}
                    onChange={e => updateRhEntry('workflow', index, { note: e.target.value })}
                  />
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>
    );
  };

  /* ---- Render Model Picker overlay ---- */
  const renderPickerOverlay = () => {
    if (!pickerOpen) return null;
    const item = provider();
    if (!item) return null;
    const filter = pickerFilter.trim().toLowerCase();
    const allIds = Object.keys(pickerState.category);
    const counts = {
      all: allIds.length,
      image: allIds.filter(id => pickerState.category[id] === 'image').length,
      chat: allIds.filter(id => pickerState.category[id] === 'chat').length,
      video: allIds.filter(id => pickerState.category[id] === 'video').length,
    };
    const sumSelected = {
      image: 0, chat: 0, video: 0,
    };
    Object.entries(pickerState.selected).forEach(([id, sel]) => {
      if (!sel) return;
      const cat = pickerState.category[id] || guessModelCategory(id);
      if (cat === 'image') sumSelected.image++;
      else if (cat === 'video') sumSelected.video++;
      else sumSelected.chat++;
    });
    const filteredIds = allIds
      .filter(id => pickerCategory === 'all' || pickerState.category[id] === pickerCategory)
      .filter(id => !filter || id.toLowerCase().includes(filter))
      .sort();
    return (
      <div className="api-picker-overlay open" onClick={e => { if (e.target === e.currentTarget) setPickerOpen(false); }}>
        <div className="api-picker-modal">
          <div className="api-picker-head">
            <div>
              <div className="api-picker-title">{t('canvasApiSettingsPickerTitle')}</div>
              <div className="api-picker-count">{t('canvasApiSettingsPickerCount').replace('{count}', String(allIds.length)).replace('{name}', item.name || item.id)}</div>
            </div>
            <button className="api-picker-close" onClick={() => setPickerOpen(false)}><X size={14} /></button>
          </div>
          <div className="api-picker-toolbar">
            <input
              className="api-picker-search"
              value={pickerFilter}
              onChange={e => setPickerFilter(e.target.value)}
              placeholder={t('canvasApiSettingsSearchModelPlaceholder')}
            />
            <div className="api-picker-cat-tabs">
              {(['all', 'image', 'chat', 'video'] as PickerCategory[]).map(cat => (
                <button
                  key={cat}
                  className={`api-picker-cat-tab ${pickerCategory === cat ? 'active' : ''}`}
                  onClick={() => setPickerCategory(cat)}
                >
                  {cat === 'all' ? t('canvasApiSettingsCatAll') : cat === 'image' ? t('canvasApiSettingsCatImage') : cat === 'chat' ? t('canvasApiSettingsCatLlm') : t('canvasApiSettingsCatVideo')}
                  <span className="cat-count">{counts[cat]}</span>
                </button>
              ))}
            </div>
          </div>
          <div className="api-picker-body">
            {filteredIds.length === 0 && <div className="api-model-empty">{t('canvasApiSettingsNoMatch')}</div>}
            {filteredIds.map(id => {
              const isSel = !!pickerState.selected[id];
              const cat = pickerState.category[id] || guessModelCategory(id);
              return (
                <div key={id} className={`api-picker-row ${isSel ? 'is-selected' : ''}`}>
                  <input
                    type="checkbox"
                    checked={isSel}
                    onChange={() => togglePickerRow(id)}
                  />
                  <div className="api-picker-row-name">{id}</div>
                  <div className="api-picker-row-cat-select">
                    <select
                      value={cat}
                      onChange={e => {
                        const nextCat = e.target.value as ModelKind;
                        setPickerState(prev => ({
                          ...prev,
                          category: { ...prev.category, [id]: nextCat },
                        }));
                      }}
                    >
                      <option value="image">{t('canvasApiSettingsCatImage')}</option>
                      <option value="chat">{t('canvasApiSettingsCatLlm')}</option>
                      <option value="video">{t('canvasApiSettingsCatVideo')}</option>
                    </select>
                  </div>
                  <div className="api-picker-row-drag" title={t('canvasApiSettingsDragSortHint')}>⋮⋮</div>
                </div>
              );
            })}
          </div>
          <div className="api-picker-summary">
            <span className="api-picker-summary-title">{t('canvasApiSettingsWillApply')}</span>
            <span className={`api-picker-sum-chip ${sumSelected.image > 0 ? 'is-active' : ''}`}>{t('canvasApiSettingsCatImage')} {sumSelected.image}</span>
            <span className={`api-picker-sum-chip ${sumSelected.chat > 0 ? 'is-active' : ''}`}>{t('canvasApiSettingsCatLlm')} {sumSelected.chat}</span>
            <span className={`api-picker-sum-chip ${sumSelected.video > 0 ? 'is-active' : ''}`}>{t('canvasApiSettingsCatVideo')} {sumSelected.video}</span>
            <span style={{ marginLeft: 'auto', color: 'var(--faint)' }}>{t('canvasApiSettingsUnselected')} {allIds.length - sumSelected.image - sumSelected.chat - sumSelected.video}</span>
          </div>
          <div className="api-picker-foot">
            <button className="api-action-btn" onClick={() => setPickerOpen(false)}>{t('canvasApiSettingsCancel')}</button>
            <button className="api-action-btn api-save-btn" onClick={applyModelPicker}>{t('canvasApiSettingsApplyToModelList')}</button>
          </div>
        </div>
      </div>
    );
  };

  /* ---- Render Jimeng help overlay ---- */
  const renderJimengHelp = () => {
    if (!jimengHelpOpen) return null;
    return (
      <div className="api-picker-overlay open" onClick={e => { if (e.target === e.currentTarget) setJimengHelpOpen(false); }}>
        <div className="api-picker-modal">
          <div className="api-picker-head">
            <div>
              <div className="api-picker-title">{t('canvasApiSettingsJimengHelpTitle')}</div>
              <div className="api-picker-count">{t('canvasApiSettingsJimengHelpDesc')}</div>
            </div>
            <button className="api-picker-close" onClick={() => setJimengHelpOpen(false)}><X size={14} /></button>
          </div>
          <div className="api-jimeng-help-toolbar">
            <select
              value={jimengHelpCmd}
              onChange={e => setJimengHelpCmd(e.target.value)}
            >
              {JIMENG_HELP_COMMANDS.map(c => (
                <option key={c} value={c}>{c || 'dreamina'}</option>
              ))}
            </select>
            <button className="api-action-btn api-primary-btn" onClick={loadJimengHelp}><RefreshCw size={14} /> {t('canvasApiSettingsRefresh')}</button>
          </div>
          <pre className="api-jimeng-help-output">{jimengHelpOutput || t('canvasApiSettingsJimengHelpRefreshHint').replace('{cmd}', jimengHelpCmd || '')}</pre>
        </div>
      </div>
    );
  };

  /* ---- Render RunningHub workflow editor overlay ---- */
  const renderRhEditor = () => {
    if (!rhEditorOpen) return null;
    const listKey = rhEditorMode === 'app' ? 'rhApps' : 'rhWorkflows';
    const entry = (p as any)?.[listKey]?.[rhEditorIndex];
    if (!entry) return null;
    const id = rhEditorMode === 'app' ? (entry.appId || entry.id) : (entry.workflowId || entry.id);
    const groupKeys = Object.keys(rhEditorGroupedFields);
    const enabledCount = rhEditorFields.filter((f: any) => f.enabled !== false).length;
    return (
      <div
        className="api-rh-editor-overlay"
        onMouseDown={(e) => { if (e.target === e.currentTarget) closeRhEditor(); }}
        onWheel={(e) => e.stopPropagation()}
        onTouchMove={(e) => e.stopPropagation()}
      >
        <div className="api-rh-editor-modal" onWheel={(e) => e.stopPropagation()}>
          <div className="api-rh-editor-head">
            <div>
              <div className="api-rh-editor-title">
                {rhEditorMode === 'app' ? t('canvasApiSettingsAiAppParams') : t('canvasApiSettingsWorkflowParams')} · {entry.title || (rhEditorMode === 'app' ? t('canvasApiSettingsAiAppIdFallback').replace('{id}', String(id).slice(-6)) : t('canvasApiSettingsWorkflowIdFallback').replace('{id}', String(id).slice(-6)))}
              </div>
              <div className="api-rh-editor-sub">
                {rhEditorMode === 'app'
                  ? t('canvasApiSettingsRhEditorSubApp').replace('{id}', String(id)).replace('{total}', String(rhEditorFields.length)).replace('{enabled}', String(enabledCount))
                  : t('canvasApiSettingsRhEditorSubWorkflow').replace('{id}', String(id)).replace('{total}', String(rhEditorFields.length)).replace('{enabled}', String(enabledCount))}
              </div>
            </div>
            <div className="api-rh-editor-actions">
              <button className="api-action-btn" onClick={refetchRhEditor} disabled={rhEditorLoading}>
                {rhEditorLoading ? <><Loader2 size={14} className="animate-spin" /> {t('canvasApiSettingsFetching')}</> : <RefreshCw size={14} />} {t('canvasApiSettingsRefetch')}
              </button>
              <button className="api-action-btn api-save-btn" onClick={saveRhEditor}><Save size={14} /> {t('canvasApiSettingsSave')}</button>
              <button className="api-picker-close" onClick={closeRhEditor}><X size={14} /></button>
            </div>
          </div>
          <div className="api-rh-editor-meta">
            <label className="api-field">
              <span className="api-label">{t('canvasApiSettingsName')}</span>
              <input
                value={rhEditorTitle}
                onChange={e => setRhEditorTitle(e.target.value)}
                placeholder={t('canvasApiSettingsCardTitlePlaceholder')}
              />
            </label>
            <label className="api-field">
              <span className="api-label">{t('canvasApiSettingsNote')}</span>
              <input
                value={rhEditorNote}
                onChange={e => setRhEditorNote(e.target.value)}
                placeholder={t('canvasApiSettingsCardNotePlaceholder')}
              />
            </label>
          </div>
          {rhEditorError && (
            <div className="api-rh-editor-error">{rhEditorError}</div>
          )}
          {rhEditorLoading && (
            <div className="api-rh-editor-loading">{rhEditorLoadingText || t('canvasApiSettingsLoading')}</div>
          )}
          <div className="api-rh-editor-body">
            {rhEditorFields.length === 0 && !rhEditorLoading && !rhEditorError && (
              <div className="api-model-empty">{t('canvasApiSettingsRhEditorEmpty')}</div>
            )}
            {groupKeys.map((groupKey) => {
              const groupFields = rhEditorGroupedFields[groupKey];
              const groupId = groupKey.replace(/[^a-zA-Z0-9_-]/g, '_');
              const isExpanded = rhEditorExpanded[groupId] !== false;
              const enabledInGroup = groupFields.filter(({ field }: any) => field.enabled !== false).length;
              return (
                <section key={groupKey} className="api-rh-editor-group">
                  <button
                    className="api-rh-editor-group-head"
                    type="button"
                    onClick={() => setRhEditorExpanded(prev => ({ ...prev, [groupId]: !isExpanded }))}
                  >
                    <span className="api-rh-editor-group-chevron">{isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</span>
                    <span className="api-rh-editor-group-title">{groupKey}</span>
                    <span className="api-rh-editor-group-count">{enabledInGroup}/{groupFields.length}</span>
                  </button>
                  {isExpanded && (
                    <div className="api-rh-editor-group-body">
                      {groupFields.map(({ field, index }: any) => (
                        <div
                          key={field.id || `${field.nodeId}-${field.fieldName}-${index}`}
                          className={`api-rh-editor-field ${field.enabled === false ? 'is-disabled' : ''} ${field.required ? 'is-required' : ''}`}
                        >
                          <div className="api-rh-editor-field-head">
                            <div className="api-rh-editor-field-name">
                              {field.label || field.fieldName}
                              {field.required && <span className="api-rh-editor-required">*</span>}
                            </div>
                            <div className="api-rh-editor-field-meta">
                              <span className="api-rh-editor-field-type">{field.fieldType || 'string'}</span>
                              {field.nodeId && <span className="api-rh-editor-field-node">node #{field.nodeId}</span>}
                              <label className="api-toggle">
                                <input
                                  type="checkbox"
                                  checked={field.enabled !== false}
                                  onChange={e => updateRhEditorField(index, { enabled: e.target.checked })}
                                />
                                {t('canvasApiSettingsExpose')}
                              </label>
                            </div>
                          </div>
                          {(field.fieldType === 'boolean' || field.fieldType === 'bool') ? (
                            <div className="api-rh-editor-field-value">
                              <select
                                value={field.fieldValue || 'false'}
                                onChange={e => updateRhEditorField(index, { fieldValue: e.target.value })}
                                disabled={field.enabled === false}
                              >
                                <option value="true">true</option>
                                <option value="false">false</option>
                              </select>
                            </div>
                          ) : (field.fieldType === 'number' || field.fieldType === 'int' || field.fieldType === 'float') ? (
                            <div className="api-rh-editor-field-value">
                              <input
                                type="number"
                                value={field.fieldValue || ''}
                                onChange={e => updateRhEditorField(index, { fieldValue: e.target.value })}
                                placeholder={t('canvasApiSettingsDefaultValuePlaceholder')}
                                disabled={field.enabled === false}
                              />
                            </div>
                          ) : (
                            <div className="api-rh-editor-field-value">
                              <textarea
                                value={field.fieldValue || ''}
                                onChange={e => updateRhEditorField(index, { fieldValue: e.target.value })}
                                placeholder={t('canvasApiSettingsDefaultValuePlaceholder')}
                                rows={2}
                                disabled={field.enabled === false}
                              />
                            </div>
                          )}
                          {field.note && <div className="api-rh-editor-field-note">{field.note}</div>}
                        </div>
                      ))}
                    </div>
                  )}
                </section>
              );
            })}
          </div>
        </div>
      </div>
    );
  };

  const renderStepBindings = () => {
    return (
      <section className={`api-step-bindings ${stepBindingsCollapsed ? 'is-collapsed' : ''}`}>
        <div className="api-block-head">
          <div>
            <div className="api-block-title">{t('canvasApiSettingsStepBindings')}</div>
            <div className="api-block-desc">{t('canvasApiSettingsStepBindingsDesc')}</div>
          </div>
          <button
            className="api-ghost-btn api-step-bindings-toggle"
            onClick={() => setStepBindingsCollapsed(v => !v)}
            title={stepBindingsCollapsed ? t('canvasApiSettingsExpand') : t('canvasApiSettingsCollapse')}
          >
            {stepBindingsCollapsed ? t('canvasApiSettingsExpand') : t('canvasApiSettingsCollapse')}
          </button>
        </div>
        <div className="api-step-grid" style={{ display: stepBindingsCollapsed ? 'none' : 'grid' }}>
          {cfg.stepBindings.map(binding => {
            const boundProvider = cfg.providers.find(p => p.id === binding.providerId);
            const kind = STEP_DEFAULT_MODEL_KIND[binding.step];
            const modelKey = MODEL_KIND_META[kind].key;
            const models = boundProvider ? (boundProvider[modelKey] as string[]) || [] : [];
            const providerOptions = cfg.providers.filter(p => p.enabled).map(p => ({ value: p.id, label: p.name }));
            const modelOptions = models.map(m => ({ value: m, label: m }));
            return (
              <div key={binding.step} className="api-step-card">
                <div className="api-step-card-label">
                  {t(STEP_LABEL_KEYS[binding.step])}
                </div>
                <div className="api-step-card-row">
                  <SearchableSelect
                    value={binding.providerId}
                    options={providerOptions}
                    onChange={(newProviderId) => {
                      const newProvider = cfg.providers.find(p => p.id === newProviderId);
                      updateStepBinding(
                        binding.step,
                        newProviderId,
                        newProvider ? getDefaultModelForStep(binding.step, newProvider) : ''
                      );
                    }}
                    searchPlaceholder={t('canvasApiSettingsSearchProviders')}
                    emptyText={t('canvasApiSettingsSearchEmpty')}
                  />
                  <SearchableSelect
                    value={binding.modelId}
                    options={modelOptions}
                    onChange={(v) => updateStepBinding(binding.step, binding.providerId, v)}
                    searchPlaceholder={t('canvasApiSettingsSearchModels')}
                    emptyText={models.length === 0 ? t('canvasApiSettingsNoModelsForType') : t('canvasApiSettingsSearchEmpty')}
                    placeholder={models.length === 0 ? t('canvasApiSettingsNoModelsForType') : undefined}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </section>
    );
  };

  const renderEditor = () => {
    if (!p) return <div className="api-content-empty">{t('canvasApiSettingsSelectProvider')}</div>;

    const isFixed = isFixedProvider(p.id);
    const isRunningHub = p.id === 'runninghub';
    const isVolcengine = p.id === 'volcengine';
    const isJimeng = p.protocol === 'jimeng';
    const isModelScope = p.id === 'modelscope';

    return (
      <div className="api-content" ref={contentRef}>
        {/* Header */}
        <div className="api-content-head">
          <div>
            <div className="api-editor-title">{p.name || p.id}</div>
            <div className="api-editor-sub">{t('canvasApiSettingsEditorSub')}</div>
          </div>
          <div className="api-content-actions">
            {!isFixed && (
              <button className="api-action-btn api-danger-btn" onClick={deleteProvider}><Trash2 size={14} /> {t('canvasApiSettingsDelete')}</button>
            )}
            <button className={`api-action-btn api-save-btn ${saved ? 'is-saved' : ''}`} onClick={handleSave}>
              {saved ? <><Check size={14} /> {t('canvasApiSettingsStatusSaved')}</> : <><Save size={14} /> {t('canvasApiSettingsSave')}</>}
            </button>
          </div>
        </div>

        {/* Onboarding for new users */}
        {renderOnboarding()}

        {/* Basic Info Block */}
        <section className="api-block">
          <div className="api-block-head">
            <div>
              <div className="api-block-title">{t('canvasApiSettingsBasicInfo')}</div>
              <div className="api-block-desc">{t('canvasApiSettingsBasicInfoDesc')}</div>
            </div>
          </div>
          <div className="api-form">
            {/* Name */}
            <label className="api-field api-field--full">
              <span className="api-label">{t('canvasApiSettingsProviderNameLabel')}</span>
              <div className="api-field-frame">
                <input
                  value={p.name}
                  onChange={e => {
                    const newName = e.target.value;
                    const newId = deriveIdFromName(newName, isFixed ? p.id : p.id, cfg.providers);
                    updateProvider(p.id, { name: newName, id: newId });
                    if (p.id !== newId) setSelectedId(newId);
                  }}
                  placeholder="Comfy"
                  disabled={isFixed}
                />
              </div>
              <span className="api-hint">{t('canvasApiSettingsPlatformId')} <code>{p.id}</code></span>
            </label>

            {/* Base URL */}
            {!isJimeng && (
              <label className="api-field api-field--full">
                <span className="api-label">{t('canvasApiSettingsBaseUrlLabel')}</span>
                <div className="api-field-frame">
                  <input
                    value={p.baseUrl}
                    onChange={e => updateProvider(p.id, { baseUrl: e.target.value })}
                    placeholder="https://api.example.com/v1"
                  />
                </div>
                {p.id === 'modelscope' && (
                  <div className="api-hint">
                    {t('canvasApiSettingsDomestic')} <code>https://api-inference.modelscope.cn/v1</code> · {t('canvasApiSettingsOverseas')} <code>https://api-inference.modelscope.ai/v1</code>
                  </div>
                )}
                {p.id === 'volcengine' && (
                  <div className="api-hint">
                    {t('canvasApiSettingsArkDefault')} <code>https://ark.cn-beijing.volces.com/api/v3</code>
                  </div>
                )}
              </label>
            )}

            {/* API Key */}
            {!isJimeng && !isRunningHub && (
              <label className="api-field api-field--full">
                <span className="api-label api-label--key">API Key</span>
                <div className="api-key-panel">
                  <div className="api-key-input-line">
                    <div className="api-field-frame">
                      <input
                        type="password"
                        value={p.apiKey}
                        onChange={e => updateProvider(p.id, { apiKey: e.target.value })}
                        placeholder={p.hasKey ? t('canvasApiSettingsKeepCurrentKey').replace('{preview}', p.keyPreview || '') : t('canvasApiSettingsEnterApiKeyPlaceholder')}
                      />
                    </div>
                    <div className="api-key-actions">
                      <button className="api-key-btn" onClick={saveKeyOnly} title={t('canvasApiSettingsSaveKey')}><Check size={14} /></button>
                      <button className="api-key-btn api-key-btn--clear" onClick={clearKeyOnly} title={t('canvasApiSettingsClearKey')}><Trash2 size={14} /></button>
                    </div>
                  </div>
                </div>
                <span className="api-hint">
                  {p.hasKey ? t('canvasApiSettingsKeySaved').replace('{preview}', p.keyPreview || '') : t('canvasApiSettingsNoKeySaved')}
                </span>
              </label>
            )}

            {/* RunningHub Keys */}
            {isRunningHub && (
              <div className="api-field api-field--full">
                <div className="api-rh-key-stack">
                  <div className="api-rh-key-item">
                    <div className="api-rh-key-head">
                      <div>
                        <div className="api-rh-key-title">{t('canvasApiSettingsRhCoinKeyRequiredTitle')}</div>
                        <div className="api-rh-key-desc">{t('canvasApiSettingsRhCoinKeyDesc')}</div>
                      </div>
                      <div className="api-rh-key-links">
                        <a className="api-recommend-key-btn" href="https://www.runninghub.cn/enterprise-api/consumerApi?inviteCode=rh-v1331" target="_blank" rel="noopener noreferrer"><Key size={14} /> {t('canvasApiSettingsDomesticKey')}</a>
                        <a className="api-recommend-key-btn" href="https://www.runninghub.ai/enterprise-api/consumerApi?inviteCode=rh-v1331" target="_blank" rel="noopener noreferrer"><Globe size={14} /> {t('canvasApiSettingsOverseasKey')}</a>
                      </div>
                    </div>
                    <div className="api-key-input-line">
                      <div className="api-field-frame">
                        <input
                          type="password"
                          value={p.apiKey}
                          onChange={e => updateProvider(p.id, { apiKey: e.target.value })}
                          placeholder={p.hasKey ? t('canvasApiSettingsKeepRhCoinKey').replace('{preview}', p.keyPreview || '') : t('canvasApiSettingsEnterRhCoinKeyPlaceholder')}
                        />
                      </div>
                      <div className="api-key-actions">
                        <button className="api-key-btn" onClick={saveKeyOnly} title={t('canvasApiSettingsSaveRhCoinKey')}><Check size={14} /></button>
                        <button className="api-key-btn api-key-btn--clear" onClick={clearKeyOnly} title={t('canvasApiSettingsClearRhCoinKey')}><Trash2 size={14} /></button>
                      </div>
                    </div>
                    <span className="api-hint">{p.hasKey ? t('canvasApiSettingsRhCoinKeySaved').replace('{preview}', p.keyPreview || '') : t('canvasApiSettingsNoRhCoinKey')}</span>
                  </div>
                  <div className="api-rh-key-item">
                    <div className="api-rh-key-head">
                      <div>
                        <div className="api-rh-key-title">{t('canvasApiSettingsBalanceKeyOptionalTitle')}</div>
                        <div className="api-rh-key-desc">{t('canvasApiSettingsBalanceKeyDesc')}</div>
                      </div>
                      <div className="api-rh-key-links">
                        <a className="api-recommend-key-btn" href="https://www.runninghub.cn/enterprise-api/sharedApi?inviteCode=rh-v1331" target="_blank" rel="noopener noreferrer"><Key size={14} /> {t('canvasApiSettingsDomesticKey')}</a>
                        <a className="api-recommend-key-btn" href="https://www.runninghub.ai/enterprise-api/sharedApi?inviteCode=rh-v1331" target="_blank" rel="noopener noreferrer"><Globe size={14} /> {t('canvasApiSettingsOverseasKey')}</a>
                      </div>
                    </div>
                    <div className="api-key-input-line">
                      <div className="api-field-frame">
                        <input
                          type="password"
                          value={p.walletApiKey || ''}
                          onChange={e => updateProvider(p.id, { walletApiKey: e.target.value })}
                          placeholder={p.hasWalletKey ? t('canvasApiSettingsKeepBalanceKey').replace('{preview}', p.walletKeyPreview || '') : t('canvasApiSettingsEnterBalanceKeyPlaceholder')}
                        />
                      </div>
                      <div className="api-key-actions">
                        <button className="api-key-btn" onClick={saveKeyOnly} title={t('canvasApiSettingsSaveBalanceKey')}><Check size={14} /></button>
                        <button className="api-key-btn api-key-btn--clear" onClick={clearKeyOnly} title={t('canvasApiSettingsClearBalanceKey')}><Trash2 size={14} /></button>
                      </div>
                    </div>
                    <span className="api-hint">{p.hasWalletKey ? t('canvasApiSettingsBalanceKeySaved').replace('{preview}', p.walletKeyPreview || '') : t('canvasApiSettingsNoBalanceKey')}</span>
                  </div>
                </div>
              </div>
            )}

            {/* Volcengine Keys */}
            {isVolcengine && (
              <div className="api-field api-field--full">
                <div className="api-rh-key-stack">
                  <div className="api-rh-key-item">
                    <div className="api-rh-key-head">
                      <div>
                        <div className="api-rh-key-title">{t('canvasApiSettingsArkKeyVideoTitle')}</div>
                        <div className="api-rh-key-desc">{t('canvasApiSettingsArkKeyVideoDesc')}</div>
                      </div>
                    </div>
                    <div className="api-key-input-line">
                      <div className="api-field-frame">
                        <input
                          type="password"
                          value={p.apiKey}
                          onChange={e => updateProvider(p.id, { apiKey: e.target.value })}
                          placeholder={p.hasKey ? t('canvasApiSettingsKeepArkKey').replace('{preview}', p.keyPreview || '') : t('canvasApiSettingsEnterArkKey')}
                        />
                      </div>
                      <div className="api-key-actions">
                        <button className="api-key-btn" onClick={saveKeyOnly} title={t('canvasApiSettingsSaveKey')}><Check size={14} /></button>
                        <button className="api-key-btn api-key-btn--clear" onClick={clearKeyOnly} title={t('canvasApiSettingsClearKey')}><Trash2 size={14} /></button>
                      </div>
                    </div>
                    <span className="api-hint">{p.hasKey ? t('canvasApiSettingsArkKeySaved').replace('{preview}', p.keyPreview || '') : t('canvasApiSettingsNoArkKey')}</span>
                  </div>
                  <div className="api-rh-key-item">
                    <div className="api-rh-key-head">
                      <div>
                        <div className="api-rh-key-title">{t('canvasApiSettingsMaterialAkSkTitle')}</div>
                        <div className="api-rh-key-desc">{t('canvasApiSettingsMaterialAkSkDesc')}</div>
                      </div>
                    </div>
                    <div className="api-key-input-line">
                      <div className="api-field-frame">
                        <input
                          type="password"
                          value={p.volcengineAccessKeyId || ''}
                          onChange={e => updateProvider(p.id, { volcengineAccessKeyId: e.target.value })}
                          placeholder="Access Key ID"
                        />
                      </div>
                    </div>
                    <div className="api-key-input-line">
                      <div className="api-field-frame">
                        <input
                          type="password"
                          value={p.volcengineSecretAccessKey || ''}
                          onChange={e => updateProvider(p.id, { volcengineSecretAccessKey: e.target.value })}
                          placeholder="Secret Access Key"
                        />
                      </div>
                      <div className="api-key-actions">
                        <button className="api-key-btn" onClick={saveKeyOnly} title={t('canvasApiSettingsSaveAkSk')}><Check size={14} /></button>
                        <button className="api-key-btn api-key-btn--clear" onClick={clearKeyOnly} title={t('canvasApiSettingsClearAkSk')}><Trash2 size={14} /></button>
                      </div>
                    </div>
                    <span className="api-hint">
                      {p.hasVolcengineAccessKey ? t('canvasApiSettingsAkSaved').replace('{preview}', p.volcengineAccessKeyPreview || '') : t('canvasApiSettingsAkNotSaved')} · {p.hasVolcengineSecretKey ? t('canvasApiSettingsSkSaved').replace('{preview}', p.volcengineSecretKeyPreview || '') : t('canvasApiSettingsSkNotSaved')}
                    </span>
                  </div>
                  <div className="api-rh-key-item">
                    <div className="api-rh-key-head">
                      <div>
                        <div className="api-rh-key-title">{t('canvasApiSettingsMaterialProjectTitle')}</div>
                        <div className="api-rh-key-desc">{t('canvasApiSettingsMaterialProjectDesc')}</div>
                      </div>
                    </div>
                    <div className="api-volcengine-project-grid">
                      <div className="api-rh-card-title-field">
                        <span>ProjectName</span>
                        <input
                          value={p.volcengineProjectName || 'default'}
                          onChange={e => updateProvider(p.id, { volcengineProjectName: e.target.value })}
                        />
                      </div>
                      <div className="api-rh-card-title-field">
                        <span>Region</span>
                        <input
                          value={p.volcengineRegion || 'cn-beijing'}
                          onChange={e => updateProvider(p.id, { volcengineRegion: e.target.value })}
                        />
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Jimeng CLI panel */}
            {renderJimengPanel()}

            {/* Verify + Protocol actions */}
            <div className="api-verify-action-row">
              <button className="api-action-btn" onClick={handleVerifyUrl} disabled={fetching}>
                {fetching ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} {t('canvasApiSettingsVerifyUrl')}
              </button>
              <button className="api-action-btn" onClick={handleProbeProtocol} disabled={fetching || isJimeng}>
                <Target size={14} /> {t('canvasApiSettingsVerifyProtocol')}
              </button>
              <div className="api-field-frame api-protocol-selector-wrap">
                <select
                  value={p.protocol}
                  onChange={e => {
                    const newProtocol = e.target.value as ProviderProtocol;
                    updateProvider(p.id, { protocol: newProtocol });
                    if (newProtocol === 'jimeng') updateProvider(p.id, { baseUrl: '' });
                  }}
                  disabled={isFixed}
                >
                  <option value="openai">{t('canvasApiSettingsProtocolOpenai')}</option>
                  <option value="apimart">{t('canvasApiSettingsProtocolApimart')}</option>
                  <option value="gemini">{t('canvasApiSettingsProtocolGemini')}</option>
                  <option value="runninghub">RunningHub</option>
                  <option value="volcengine">{t('canvasApiSettingsProtocolVolcengine')}</option>
                  <option value="jimeng">{t('canvasApiSettingsProtocolJimeng')}</option>
                </select>
              </div>
            </div>
            {verifyResult && (
              <div className={`api-verify-result api-verify-result--${verifyResult.kind}`}>
                {verifyResult.kind === 'ok' && <Check size={14} />}
                {verifyResult.kind === 'warn' && <AlertTriangle size={14} />}
                <span>{verifyResult.text}</span>
              </div>
            )}
          </div>
        </section>

        {/* RunningHub Apps & Workflows */}
        {renderRunningHubSection()}

        {/* Models Toolbar */}
        <div className="api-models-toolbar">
          <div>
            <div className="api-block-title">{t('canvasApiSettingsModelsList')}</div>
            <div className="api-block-desc">{t('canvasApiSettingsModelsToolbarDesc')}</div>
          </div>
          <div className="api-models-toolbar-actions">
            <button className="api-action-btn api-primary-btn" onClick={handleFetchModels} disabled={fetching}>
              {fetching ? <><Loader2 size={14} className="animate-spin" /> {t('canvasApiSettingsFetching')}</> : <Download size={14} />} {t('canvasApiSettingsFetchModels')}
            </button>
          </div>
        </div>

        {/* Models Block */}
        <section className="api-block">
          <div className="api-block-head">
            <div>
              <div className="api-block-title">{t('canvasApiSettingsModelsList')}</div>
              <div className="api-block-desc">{t('canvasApiSettingsModelsBlockDesc')}</div>
            </div>
          </div>
          <div className="api-model-grid">
            {(['image', 'chat', 'video'] as ModelKind[]).map(kind => {
              const meta = MODEL_KIND_META[kind];
              const models = (p[meta.key] as string[]) || [];
              return (
                <section key={kind} className="api-block api-model-kind">
                  <div className="api-block-head">
                    <div>
                      <div className="api-block-title" style={{ color: meta.color }}>
                        {t(meta.label)} ({models.length})
                      </div>
                    </div>
                    <button className="api-ghost-btn api-model-add-btn" onClick={() => addModel(kind)}>
                      {t('canvasApiSettingsAdd')}
                    </button>
                  </div>
                  {renderModelSection(kind)}
                </section>
              );
            })}
          </div>
        </section>

        {/* LoRA Management (ModelScope) */}
        {isModelScope && renderLoraSection()}
      </div>
    );
  };

  if (!open) return null;

  return (
    <div
      className="api-settings-modal"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
      onWheel={(e) => e.stopPropagation()}
      onTouchMove={(e) => e.stopPropagation()}
    >
      <div
        className="api-settings-panel"
        onWheel={(e) => e.stopPropagation()}
        onTouchMove={(e) => e.stopPropagation()}
      >
        {/* Page Head */}
        <header className="api-page-head">
          <div>
            <div className="api-page-title">{t('canvasApiSettings')}</div>
            <div className="api-page-sub">{t('canvasApiSettingsPageSub')}</div>
          </div>
          <div className="api-page-status">{status}</div>
        </header>

        {/* Agent env hint banner — Task 7 */}
        <div className="api-env-hint" role="note">
          <Info size={14} />
          <div>
            <div className="api-env-hint-title">{t('canvasApiSettingsEnvHintTitle')}</div>
            <div className="api-env-hint-body">{t('canvasApiSettingsEnvHintBody')}</div>
          </div>
        </div>

        {/* Layout */}
        <div className="api-layout">
          {renderProviderList()}
          {showRecommend ? renderRecommendPanel() : renderEditor()}
        </div>

        {/* Global Step Bindings */}
        {renderStepBindings()}

        {/* Footer */}
        <div className="api-settings-footer">
          <div className="api-settings-footer-info">
            {cfg.providers.length} {t('canvasApiSettingsFooterProviders')} · {cfg.stepBindings.length} {t('canvasApiSettingsFooterBindings')}
          </div>
          <div className="api-settings-footer-right">
            <button className="api-action-btn" onClick={onClose}>{t('canvasApiSettingsClose')}</button>
            <button className="api-action-btn api-save-btn" onClick={handleSave}>
              {saved ? <><Check size={14} /> {t('canvasApiSettingsStatusSaved')}</> : <><Save size={14} /> {t('canvasApiSettingsSaveAll')}</>}
            </button>
          </div>
        </div>
      </div>

      {/* Overlays */}
      {renderPickerOverlay()}
      {renderJimengHelp()}
      {renderRhEditor()}
    </div>
  );
};
