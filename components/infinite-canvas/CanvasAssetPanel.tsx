import React, { useCallback, useMemo, useState } from 'react';
import { AlertCircle, BookOpen, Clapperboard, FileText, Loader2, Library, Mountain, Package, RefreshCw, Theater, Trash2, User, X } from 'lucide-react';
import { useCanvasStore } from './use-canvas-store';
import { TaskAssetKind } from './types';
import { useI18n } from '../../i18n';
import { api as apiClient, uploadImageWithPreview } from '../../services/apiClient';

interface AssetItem {
  id: string;
  name: string;
  url: string;
  kind?: 'image' | 'video' | 'audio' | 'template' | 'text';
  tags?: string[];
  assetKind?: TaskAssetKind;
  prompt?: string;
  providerName?: string;
  modelId?: string;
  generating?: boolean;
  failed?: boolean;
  error?: string;
  status?: string;
  version?: number;
  sourceAssetId?: string;
  derivedFrom?: string[];
  referenceRole?: string;
  promptSource?: string;
  promptOptimized?: string;
  inspectionStatus?: string;
}

interface AssetCategory {
  id: string;
  name: string;
  icon: React.ReactNode;
}

interface CanvasAssetPanelProps {
  open: boolean;
  onClose: () => void;
  onAddToCanvas?: (item: AssetItem) => void;
}

const ASSET_CATEGORIES: AssetCategory[] = [
  { id: 'all', name: 'canvasPanelAssetsAll', icon: <Package size={14} /> },
  { id: 'novel', name: 'canvasPanelAssetsNovel', icon: <BookOpen size={14} /> },
  { id: 'script', name: 'canvasPanelAssetsScript', icon: <FileText size={14} /> },
  { id: 'character', name: 'canvasPanelAssetsCharacter', icon: <User size={14} /> },
  { id: 'scene', name: 'canvasPanelAssetsScene', icon: <Mountain size={14} /> },
  { id: 'storyboard', name: 'canvasPanelAssetsStoryboard', icon: <Clapperboard size={14} /> },
  { id: 'prop', name: 'canvasPanelAssetsProp', icon: <Theater size={14} /> },
];

const KIND_LABEL: Record<TaskAssetKind, string> = {
  character: 'canvasPanelAssetsCharacter',
  scene: 'canvasPanelAssetsScene',
  storyboard: 'canvasPanelAssetsStoryboard',
  prop: 'canvasPanelAssetsProp',
  novel: 'canvasPanelAssetsNovel',
  script: 'canvasPanelAssetsScript',
};

const TEXT_KINDS: TaskAssetKind[] = ['novel', 'script'];

export const CanvasAssetPanel: React.FC<CanvasAssetPanelProps> = ({ open, onClose, onAddToCanvas }) => {
  const { t } = useI18n();
  const [category, setCategory] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [localAssets, setLocalAssets] = useState<AssetItem[]>([]);

  const taskAssets = useCanvasStore((s) => s.taskAssets);
  const retryFailedAsset = useCanvasStore((s) => s.retryFailedAsset);
  const setTaskAssets = useCanvasStore((s) => s.setTaskAssets);
  const openTextReader = useCanvasStore((s) => s.openTextReader);

  const allItems = useMemo<AssetItem[]>(() => {
    const taskItems: AssetItem[] = taskAssets.map((a) => ({
      id: a.id,
      name: a.name,
      url: a.url,
      kind: TEXT_KINDS.includes(a.kind) ? 'text' : 'image',
      assetKind: a.kind,
      tags: a.tags || [t(KIND_LABEL[a.kind])],
      prompt: a.prompt,
      providerName: a.providerName,
      modelId: a.modelId,
      generating: a.generating,
      failed: a.failed,
      error: a.error,
      status: a.status,
      version: a.version,
      sourceAssetId: a.sourceAssetId,
      derivedFrom: a.derivedFrom,
      referenceRole: a.referenceRole,
      promptSource: a.promptSource,
      promptOptimized: a.promptOptimized,
      inspectionStatus: a.inspectionStatus,
    }));
    return [...taskItems, ...localAssets];
  }, [taskAssets, localAssets, t]);

  const filteredItems = useMemo(() => {
    let items = allItems;
    if (category !== 'all') items = items.filter((i) => i.assetKind === category);
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      items = items.filter(
        (i) =>
          i.name.toLowerCase().includes(q) ||
          i.tags?.some((tag) => tag.toLowerCase().includes(q)) ||
          i.prompt?.toLowerCase().includes(q),
      );
    }
    return items;
  }, [allItems, category, searchQuery]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const files = [...e.dataTransfer.files].filter((f) => f.type.startsWith('image/'));
    files.forEach((file) => {
      const id = `asset_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      // blob: URL 仅即时预览；上传到后端后替换为 /files/ 真实 URL（图生图后端要取图片内容）
      const url = uploadImageWithPreview(file, (backendUrl) => {
        setLocalAssets((prev) => prev.map((a) => (a.id === id ? { ...a, url: backendUrl } : a)));
      });
      setLocalAssets((prev) => [
        ...prev,
        {
          id,
          name: file.name,
          url,
          kind: 'image',
        },
      ]);
    });
  }, []);

  const handleDragStart = useCallback((item: AssetItem, e: React.DragEvent) => {
    e.dataTransfer.setData('application/json', JSON.stringify(item));
    e.dataTransfer.effectAllowed = 'copy';
  }, []);

  const handleAddToCanvas = useCallback((item: AssetItem) => {
    onAddToCanvas?.(item);
  }, [onAddToCanvas]);

  const renderTextCard = (item: AssetItem, textBody?: string) => {
    const Icon = item.assetKind === 'novel' ? BookOpen : FileText;
    // 优先用调用方传入的 textBody（已经是 latestAsset.body 提取结果），
    // 没有时不再回退到 item.prompt（避免把输入文本误显示为正文）。
    const body = textBody ?? '';
    const charCount = body.length;
    const empty = !item.generating && !body;
    return (
      <div className="canvas-asset-text-card">
        <div className="canvas-asset-text-head">
          <Icon size={14} />
          <span className="canvas-asset-text-name">{item.name}</span>
          {item.generating && <Loader2 size={12} className="animate-spin" />}
        </div>
        <div className="canvas-asset-text-preview">
          {item.generating
            ? t('canvasPanelAssetGenerating')
            : empty
              ? t('canvasPanelAssetTextEmpty') || '（正文未加载，点击打开阅读器重试）'
              : body.slice(0, 200) + (body.length > 200 ? '...' : '')}
        </div>
        <div className="canvas-asset-text-meta">
          {body && <span>{t('canvasPanelAssetChars').replace('{0}', String(charCount))}</span>}
        </div>
      </div>
    );
  };

  const renderImageMeta = (item: AssetItem) => {
    const derivedFromLabel = item.derivedFrom?.length ? item.derivedFrom.join(', ') : '';
    if (!item.providerName && !item.modelId && !item.prompt && !item.status && !item.referenceRole && !item.sourceAssetId && !derivedFromLabel) return null;
    return (
      <div className="canvas-asset-img-meta">
        <span className="asset-meta-item asset-meta-name" title={item.name}>{item.name}</span>
        {item.status && <span className="asset-meta-item" title={item.status}>{item.status}</span>}
        {typeof item.version === 'number' && <span className="asset-meta-item" title={`v${item.version}`}>v{item.version}</span>}
        {item.referenceRole && <span className="asset-meta-item" title={item.referenceRole}>{item.referenceRole}</span>}
        {item.sourceAssetId && <span className="asset-meta-item" title={item.sourceAssetId}>{item.sourceAssetId}</span>}
        {derivedFromLabel && !item.sourceAssetId && <span className="asset-meta-item" title={derivedFromLabel}>{derivedFromLabel}</span>}
        {item.providerName && <span className="asset-meta-item" title={item.providerName}>{item.providerName}</span>}
        {item.modelId && <span className="asset-meta-item" title={item.modelId}>{item.modelId}</span>}
      </div>
    );
  };

  const renderFailedCard = (item: AssetItem) => {
    const isRetrying = !!item.generating;
    return (
      <div className="canvas-asset-failed">
        <div className="canvas-asset-failed-head">
          <AlertCircle size={14} className="canvas-asset-failed-icon" />
          <span className="canvas-asset-failed-title">{t('canvasPanelAssetFailedTitle')}</span>
        </div>
        {item.prompt && (
          <div className="canvas-asset-failed-row" title={item.prompt}>
            <span className="canvas-asset-failed-label">{t('canvasPanelAssetFailedPrompt')}</span>
            <span className="canvas-asset-failed-prompt">{item.prompt}</span>
          </div>
        )}
        {item.error && (
          <div className="canvas-asset-failed-row" title={item.error}>
            <span className="canvas-asset-failed-label">{t('canvasPanelAssetFailedError')}</span>
            <span className="canvas-asset-failed-err">{item.error}</span>
          </div>
        )}
        <div className="canvas-asset-failed-actions">
          <button
            type="button"
            className="canvas-asset-failed-retry"
            disabled={isRetrying}
            onClick={(e) => {
              e.stopPropagation();
              if (!isRetrying) void retryFailedAsset(item.id);
            }}
            title={t('canvasPanelAssetFailedRetry')}
          >
            {isRetrying ? <Loader2 size={12} className="spin" /> : <RefreshCw size={12} />}
            <span>{isRetrying ? t('canvasPanelAssetFailedRetrying') : t('canvasPanelAssetFailedRetry')}</span>
          </button>
          <button
            type="button"
            className="canvas-asset-failed-remove"
            onClick={(e) => {
              e.stopPropagation();
              void apiClient.deleteAsset(item.id);
              setTaskAssets(taskAssets.filter((a) => a.id !== item.id));
            }}
            title={t('canvasPanelAssetFailedRemove')}
          >
            <Trash2 size={12} />
          </button>
        </div>
      </div>
    );
  };

  return (
    <aside className={`canvas-asset-panel${open ? ' open' : ''}`}>
      <div className="canvas-asset-head">
        <strong>
          <span><Library size={14} /></span>
          <span>{t('canvasAssetPanelLibrary')}</span>
          <span className="asset-kind-badge">{t('canvasAssetPanelTaskAssets')}</span>
        </strong>
        <button type="button" className="canvas-asset-icon-btn" onClick={onClose} title={t('canvasApiSettingsClose')}><X size={14} /></button>
      </div>

      <div className="asset-search-row">
        <input
          className="asset-search-input"
          type="text"
          placeholder={t('canvasPanelAssetsSearch')}
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
      </div>

      <div className="asset-category-tabs">
        {ASSET_CATEGORIES.map((cat) => (
          <button
            key={cat.id}
            type="button"
            className={`asset-cat-tab${category === cat.id ? ' active' : ''}`}
            onClick={() => setCategory(cat.id)}
          >
            {cat.icon} {t(cat.name)}
          </button>
        ))}
      </div>

      <div className="canvas-asset-row">
        <span className="canvas-asset-count">
          {t('canvasAssetPanelTotal').replace('{0}', String(allItems.length))}
        </span>
      </div>

      <div
        className="canvas-asset-drop"
        onDrop={handleDrop}
        onDragOver={(e) => {
          e.preventDefault();
          e.dataTransfer.dropEffect = 'copy';
        }}
      >
        {t('canvasAssetPanelDropHint')}
      </div>

      <div className="canvas-asset-grid">
        {filteredItems.length ? filteredItems.map((item) => {
          if (item.failed) {
            return (
              <div key={item.id} className="canvas-asset-item canvas-asset-item-failed" title={item.name}>
                {renderFailedCard(item)}
              </div>
            );
          }

          if (item.kind === 'text') {
            const latestAsset = taskAssets.find(a => a.id === item.id);
            // 文本资产正文优先取 latestAsset.body；不要回退到 item.prompt（那是输入文本，不是正文）
            const textBody = latestAsset?.body || '';
            return (
              <div
                key={item.id}
                className={`canvas-asset-item canvas-asset-item-text${item.generating ? ' is-generating' : ''}`}
                draggable
                onDragStart={(e) => handleDragStart(item, e)}
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  if (latestAsset) {
                    openTextReader(latestAsset);
                  }
                }}
                onClick={() => {
                  if (latestAsset) {
                    openTextReader(latestAsset);
                  }
                }}
                title={`${item.name}（点击打开阅读器）`}
              >
                {renderTextCard(item, textBody)}
              </div>
            );
          }

          return (
            <div
              key={item.id}
              className="canvas-asset-item"
              draggable
              onDragStart={(e) => handleDragStart(item, e)}
              onDoubleClick={() => handleAddToCanvas(item)}
              title={item.name}
            >
              {item.url ? <img src={item.url} alt={item.name} draggable={false} /> : <div className="canvas-asset-empty" style={{ minHeight: 80 }}>{item.name}</div>}
              {renderImageMeta(item)}
              {item.tags && item.tags.length > 0 && (
                <div className="asset-item-tags">
                  {item.tags.slice(0, 2).map((tag) => (
                    <span key={tag} className="asset-tag">{tag}</span>
                  ))}
                </div>
              )}
            </div>
          );
        }) : (
          <div className="canvas-asset-empty">
            {t('canvasPanelAssetsEmpty')}
            <br />
            {t('canvasPanelAssetsEmptyHint')}
          </div>
        )}
      </div>
    </aside>
  );
};

CanvasAssetPanel.displayName = 'CanvasAssetPanel';
