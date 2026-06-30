import React, { useCallback, useEffect, useRef } from 'react';
import { Search, Pencil, Download, Copy, RefreshCw, Trash2, FileText, Cpu, Sparkles } from 'lucide-react';
import { useI18n } from '../../i18n';

interface ImageNodeMenuProps {
  open: boolean;
  x: number;
  y: number;
  nodeId: string;
  nodeUrl?: string;
  nodeName?: string;
  /** 资产元数据：提示词 */
  nodePrompt?: string;
  /** 资产元数据：供应商名称 */
  nodeProviderName?: string;
  /** 资产元数据：模型 ID */
  nodeModelId?: string;
  /** 资产元数据：资产类型 */
  nodeAssetKind?: string;
  onClose: () => void;
  onPreview?: () => void;
  onReplace?: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
}

export const ImageNodeMenu: React.FC<ImageNodeMenuProps> = React.memo(
  ({
    open,
    x,
    y,
    nodeId,
    nodeUrl,
    nodeName,
    nodePrompt,
    nodeProviderName,
    nodeModelId,
    nodeAssetKind,
    onClose,
    onPreview,
    onReplace,
    onEdit,
    onDelete,
  }) => {
    const { t } = useI18n();
    const menuRef = useRef<HTMLDivElement>(null);

    const handleClickOutside = useCallback(
      (e: MouseEvent) => {
        if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
          onClose();
        }
      },
      [onClose]
    );

    useEffect(() => {
      if (open) {
        setTimeout(() => document.addEventListener('mousedown', handleClickOutside), 0);
        return () => document.removeEventListener('mousedown', handleClickOutside);
      }
    }, [open, handleClickOutside]);

    const handleDownload = useCallback(() => {
      if (!nodeUrl) return;
      const a = document.createElement('a');
      a.href = nodeUrl;
      a.download = nodeName || 'image.png';
      a.click();
      onClose();
    }, [nodeUrl, nodeName, onClose]);

    const handleCopyUrl = useCallback(() => {
      if (!nodeUrl) return;
      navigator.clipboard?.writeText(nodeUrl);
      onClose();
    }, [nodeUrl, onClose]);

    const handleCopyPrompt = useCallback(() => {
      if (!nodePrompt) return;
      navigator.clipboard?.writeText(nodePrompt);
      onClose();
    }, [nodePrompt, onClose]);

    if (!open) return null;

    const hasMeta = !!(nodePrompt || nodeProviderName || nodeModelId || nodeAssetKind);

    return (
      <div
        ref={menuRef}
        className="create-menu open"
        style={{ left: x, top: y, minWidth: 220 }}
      >
        {/* 资产元数据展示 */}
        {hasMeta && (
          <div className="image-menu-meta">
            {nodeAssetKind && (
              <div className="image-menu-meta-row image-menu-meta-kind">
                <Sparkles size={12} />
                <span>{t('canvasAssetKind_' + nodeAssetKind) || nodeAssetKind}</span>
              </div>
            )}
            {nodeProviderName && (
              <div className="image-menu-meta-row" title={nodeProviderName}>
                <FileText size={12} />
                <span className="image-menu-meta-label">{t('canvasAssetMetaProvider')}:</span>
                <span className="image-menu-meta-value">{nodeProviderName}</span>
              </div>
            )}
            {nodeModelId && (
              <div className="image-menu-meta-row" title={nodeModelId}>
                <Cpu size={12} />
                <span className="image-menu-meta-label">{t('canvasAssetMetaModel')}:</span>
                <span className="image-menu-meta-value">{nodeModelId}</span>
              </div>
            )}
            {nodePrompt && (
              <div
                className="image-menu-meta-prompt"
                title={nodePrompt}
                onClick={handleCopyPrompt}
              >
                {nodePrompt.length > 100 ? nodePrompt.slice(0, 100) + '...' : nodePrompt}
              </div>
            )}
          </div>
        )}

        {hasMeta && <div className="menu-divider" />}

        {onPreview && (
          <button className="menu-btn" onClick={() => { onPreview(); onClose(); }}>
            <Search size={14} /> {t('canvasImageMenuPreview')}
          </button>
        )}
        {onEdit && (
          <button className="menu-btn" onClick={() => { onEdit(); onClose(); }}>
            <Pencil size={14} /> {t('canvasImageMenuEdit')}
          </button>
        )}
        <button className="menu-btn" onClick={handleDownload}>
          <Download size={14} /> {t('canvasImageMenuDownload')}
        </button>
        <button className="menu-btn" onClick={handleCopyUrl}>
          <Copy size={14} /> {t('canvasImageMenuCopyUrl')}
        </button>
        {onReplace && (
          <button className="menu-btn" onClick={() => { onReplace(); onClose(); }}>
            <RefreshCw size={14} /> {t('canvasImageMenuReplace')}
          </button>
        )}
        {nodePrompt && (
          <button className="menu-btn" onClick={handleCopyPrompt}>
            <Copy size={14} /> {t('canvasImageMenuCopyPrompt')}
          </button>
        )}
        {onDelete && (
          <>
            <div className="menu-divider" />
            <button
              className="menu-btn"
              style={{ color: '#dc2626' }}
              onClick={() => { onDelete(); onClose(); }}
            >
              <Trash2 size={14} /> {t('canvasImageMenuDelete')}
            </button>
          </>
        )}
      </div>
    );
  }
);

ImageNodeMenu.displayName = 'ImageNodeMenu';
