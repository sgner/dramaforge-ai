import React, { useCallback, useState, useEffect } from 'react';
import { useCanvasStore } from './use-canvas-store';
import { useI18n } from '../../i18n';

interface LightboxProps {
  nodeId: string;
  onClose: () => void;
}

export const LightboxPanel: React.FC<LightboxProps> = React.memo(({ nodeId, onClose }) => {
  const { t } = useI18n();
  const nodes = useCanvasStore((s) => s.nodes);
  const connections = useCanvasStore((s) => s.connections);
  const taskAssets = useCanvasStore((s) => s.taskAssets);
  const [compareMode, setCompareMode] = useState(false);
  const [compareIndex, setCompareIndex] = useState(0);

  const node = nodes.find(n => n.id === nodeId);
  if (!node || node.type !== 'image' || !node.url) {
    return null;
  }

  // Find connected image nodes for comparison
  const connectedImageIds = connections
    .filter(c => c.from === nodeId || c.to === nodeId)
    .map(c => c.from === nodeId ? c.to : c.from);
  const compareImages = nodes.filter(
    n => connectedImageIds.includes(n.id) && n.type === 'image' && n.url
  );
  const allImages = [node, ...compareImages.filter(n => n.id !== node.id)];

  // Find connected prompt / script / novel nodes (它们的文本会作为生成 prompt 传入下一节点)
  const connectedPrompts = connections
    .filter(c => c.to === nodeId)
    .map(c => nodes.find(n => n.id === c.from))
    .filter((n): n is NonNullable<typeof n> => {
      if (!n) return false;
      if (n.type === 'prompt' || n.type === 'promptGroup') return !!n.text;
      if (n.type === 'script' || n.type === 'novel') {
        const assetId = (n._assetId as string) || '';
        const linkedAsset = assetId ? taskAssets.find(a => a.id === assetId) : undefined;
        return !!(linkedAsset?.body ?? n.text);
      }
      return false;
    });

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') onClose();
    if (e.key === 'ArrowLeft' && compareMode) {
      setCompareIndex(prev => (prev - 1 + allImages.length) % allImages.length);
    }
    if (e.key === 'ArrowRight' && compareMode) {
      setCompareIndex(prev => (prev + 1) % allImages.length);
    }
  }, [onClose, compareMode, allImages.length]);

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  const currentImage = compareMode ? allImages[compareIndex] : node;

  return (
    <div className="lightbox-overlay" onClick={onClose}>
      <div className="lightbox-panel" onClick={(e) => e.stopPropagation()}>
        <div className="lightbox-header">
          <div className="lightbox-title">
            {currentImage?.name || t('canvasLightboxPanelTitle')}
          </div>
          <div className="lightbox-actions">
            {allImages.length > 1 && (
              <button
                className={`lightbox-action-btn${compareMode ? ' active' : ''}`}
                type="button"
                onClick={() => { setCompareMode(!compareMode); setCompareIndex(0); }}
              >
                {t('canvasLightboxCompare')}
              </button>
            )}
            <button className="lightbox-action-btn" type="button" onClick={() => {
              if (currentImage?.url) {
                const a = document.createElement('a');
                a.href = currentImage.url;
                a.download = (currentImage.name as string) || 'image.png';
                a.click();
              }
            }}>
              {t('canvasLightboxDownload')}
            </button>
            <button className="lightbox-action-btn" type="button" onClick={onClose}>
              {t('canvasLightboxClose')}
            </button>
          </div>
        </div>

        <div className="lightbox-body">
          <div className="lightbox-main">
            {currentImage?.url && (
              <img src={currentImage.url} alt="" className="lightbox-image" />
            )}
            {compareMode && allImages.length > 1 && (
              <div className="lightbox-nav">
                <button className="lightbox-nav-btn" type="button" onClick={() => setCompareIndex(prev => (prev - 1 + allImages.length) % allImages.length)}>
                  ‹
                </button>
                <span className="lightbox-nav-info">{compareIndex + 1} / {allImages.length}</span>
                <button className="lightbox-nav-btn" type="button" onClick={() => setCompareIndex(prev => (prev + 1) % allImages.length)}>
                  ›
                </button>
              </div>
            )}
          </div>

          <div className="lightbox-sidebar">
            {connectedPrompts.length > 0 && (
              <div className="lightbox-prompts">
                <div className="lightbox-sidebar-title">{t('canvasLightboxPrompt')}</div>
                {connectedPrompts.map(p => (
                  <div key={p.id} className="lightbox-prompt-item">
                    <div className="lightbox-prompt-text">{p.text}</div>
                  </div>
                ))}
              </div>
            )}
            {compareMode && allImages.length > 1 && (
              <div className="lightbox-thumbs">
                <div className="lightbox-sidebar-title">{t('canvasLightboxCompareImages')}</div>
                <div className="lightbox-thumb-grid">
                  {allImages.map((img, idx) => (
                    <div
                      key={img.id}
                      className={`lightbox-thumb${idx === compareIndex ? ' active' : ''}`}
                      onClick={() => setCompareIndex(idx)}
                    >
                      <img src={img.url} alt="" draggable={false} />
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
});

LightboxPanel.displayName = 'LightboxPanel';
