import React, { useCallback, useState, useMemo } from 'react';
import { Package, User, Mountain, Clapperboard, Theater, Library, X, BookOpen, FileText, Loader2, AlertCircle, RefreshCw, Trash2 } from 'lucide-react';
import { useCanvasStore } from './use-canvas-store';
import { TaskAssetKind } from './types';
import { useI18n } from '../../i18n';
import { api as apiClient } from '../../services/apiClient';

interface AssetItem {
  id: string;
  name: string;
  url: string;
  kind?: 'image' | 'video' | 'audio' | 'template' | 'text';
  tags?: string[];
  assetKind?: TaskAssetKind;
  /** 资产元数据：提示词 */
  prompt?: string;
  /** 资产元数据：供应商名称 */
  providerName?: string;
  /** 资产元数据：模型 ID */
  modelId?: string;
  /** 是否正在流式生成中 */
  generating?: boolean;
  /** 是否生成失败 */
  failed?: boolean;
  /** 生成失败的错误信息 */
  error?: string;
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

export const CanvasAssetPanel: React.FC<CanvasAssetPanelProps> = ({
  open,
  onClose,
  onAddToCanvas,
}) => {
  const { t } = useI18n();
  const [category, setCategory] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [localAssets, setLocalAssets] = useState<AssetItem[]>([]);

  const taskAssets = useCanvasStore((s) => s.taskAssets);
  const retryFailedAsset = useCanvasStore((s) => s.retryFailedAsset);
  const setTaskAssets = useCanvasStore((s) => s.setTaskAssets);

  // Merge task assets with locally dropped assets
  const allItems = useMemo<AssetItem[]>(() => {
    const taskItems: AssetItem[] = taskAssets.map((a) => ({
      id: a.id,
      name: a.name,
      url: a.url,
      // 文本资产 url 为空，kind 标记为 text
      kind: TEXT_KINDS.includes(a.kind) ? 'text' : 'image',
      assetKind: a.kind,
      tags: a.tags || [t(KIND_LABEL[a.kind])],
      prompt: a.prompt,
      providerName: a.providerName,
      modelId: a.modelId,
      generating: a.generating,
      failed: a.failed,
      error: a.error,
    }));
    return [...taskItems, ...localAssets];
  }, [taskAssets, localAssets, t]);

  const filteredItems = useMemo(() => {
    let items = allItems;
    if (category !== 'all') {
      items = items.filter((i) => i.assetKind === category);
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      items = items.filter(
        (i) =>
          i.name.toLowerCase().includes(q) ||
          i.tags?.some((t) => t.toLowerCase().includes(q)) ||
          i.prompt?.toLowerCase().includes(q)
      );
    }
    return items;
  }, [allItems, category, searchQuery]);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const files = [...e.dataTransfer.files].filter((f) =>
        f.type.startsWith('image/')
      );
      files.forEach((file) => {
        const url = URL.createObjectURL(file);
        setLocalAssets((prev) => [
          ...prev,
          {
            id: `asset_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
            name: file.name,
            url,
            kind: 'image',
          },
        ]);
      });
    },
    []
  );

  const handleDragStart = useCallback(
    (item: AssetItem, e: React.DragEvent) => {
      e.dataTransfer.setData('application/json', JSON.stringify(item));
      e.dataTransfer.effectAllowed = 'copy';
    },
    []
  );

  const handleAddToCanvas = useCallback(
    (item: AssetItem) => {
      onAddToCanvas?.(item);
    },
    [onAddToCanvas]
  );

  // 文本资产卡片
  const renderTextCard = (item: AssetItem) => {
    const isNovel = item.assetKind === 'novel';
    const Icon = isNovel ? BookOpen : FileText;
    const charCount = item.prompt?.length || 0;
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
            : (item.prompt || '').slice(0, 200) + ((item.prompt?.length || 0) > 200 ? '...' : '')}
        </div>
        <div className="canvas-asset-text-meta">
          {item.prompt && (
            <span>{t('canvasPanelAssetChars').replace('{0}', String(charCount))}</span>
          )}
        </div>
      </div>
    );
  };

  // 图片资产元数据
  const renderImageMeta = (item: AssetItem) => {
    if (!item.providerName && !item.modelId && !item.prompt) return null;
    return (
      <div className="canvas-asset-img-meta">
        {item.providerName && (
          <span className="asset-meta-item" title={item.providerName}>
            {item.providerName}
          </span>
        )}
        {item.modelId && (
          <span className="asset-meta-item" title={item.modelId}>
            {item.modelId}
          </span>
        )}
      </div>
    );
  };

  // 失败资产卡片：保留提示词 + 错误信息 + 重试
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
        {filteredItems.length ? (
          filteredItems.map((item) => {
            // 失败资产卡片：保留提示词 + 错误 + 重试
            if (item.failed) {
              return (
                <div
                  key={item.id}
                  className="canvas-asset-item canvas-asset-item-failed"
                  title={item.name}
                >
                  {renderFailedCard(item)}
                </div>
              );
            }
            // 文本资产使用文本卡片渲染
            if (item.kind === 'text') {
              return (
                <div
                  key={item.id}
                  className={`canvas-asset-item canvas-asset-item-text${item.generating ? ' is-generating' : ''}`}
                  draggable
                  onDragStart={(e) => handleDragStart(item, e)}
                  onDoubleClick={() => handleAddToCanvas(item)}
                  title={item.name}
                >
                  {renderTextCard(item)}
                </div>
              );
            }
            // 图片资产
            return (
              <div
                key={item.id}
                className="canvas-asset-item"
                draggable
                onDragStart={(e) => handleDragStart(item, e)}
                onDoubleClick={() => handleAddToCanvas(item)}
                title={item.name}
              >
                {item.url ? (
                  <img src={item.url} alt={item.name} draggable={false} />
                ) : (
                  <div className="canvas-asset-empty" style={{ minHeight: 80 }}>
                    {item.name}
                  </div>
                )}
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
          })
        ) : (
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
