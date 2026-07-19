import React, { useState, useCallback } from 'react';
import { X, Image as ImageIcon, MessageSquare } from 'lucide-react';
import { useI18n } from '../../i18n';

type TabId = 'images' | 'prompts';

interface AssetManagerModalProps {
  open: boolean;
  onClose: () => void;
}

export const AssetManagerModal: React.FC<AssetManagerModalProps> = ({
  open,
  onClose,
}) => {
  const { t } = useI18n();
  const [activeTab, setActiveTab] = useState<TabId>('images');

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  if (!open) return null;

  return (
    <div
      className="asset-manager-modal open"
      onClick={onClose}
      onWheel={(e) => e.stopPropagation()}
      onTouchMove={(e) => e.stopPropagation()}
    >
      <div
        className="asset-manager-panel"
        onClick={(e) => e.stopPropagation()}
        onDrop={handleDrop}
        onDragOver={(e) => {
          e.preventDefault();
          e.dataTransfer.dropEffect = 'copy';
        }}
      >
        <div className="asset-manager-head">
          <div className="asset-manager-title">{t('canvasAssetMgrTitle')}</div>
          <button
            type="button"
            className="preview-icon-btn"
            onClick={onClose}
            title={t('canvasApiSettingsClose')}
          >
            <X size={14} />
          </button>
        </div>

        <div className="asset-manager-tabs">
          <button
            type="button"
            className={`asset-manager-tab ${activeTab === 'images' ? 'active' : ''}`}
            onClick={() => setActiveTab('images')}
          >
            <ImageIcon size={14} /> {t('canvasAssetMgrTabImages')}
          </button>
          <button
            type="button"
            className={`asset-manager-tab ${activeTab === 'prompts' ? 'active' : ''}`}
            onClick={() => setActiveTab('prompts')}
          >
            <MessageSquare size={14} /> {t('canvasAssetMgrTabPrompts')}
          </button>
        </div>

        <div className="asset-manager-body">
          <div className="asset-manager-side">
            <div className="canvas-asset-drop">{t('canvasAssetMgrDropHint')}</div>
            <div style={{ padding: '8px 0', fontSize: 11, color: 'var(--muted)', fontWeight: 800 }}>
              {t('canvasAssetMgrDefaultLib')}
            </div>
          </div>
          <div className="asset-manager-main">
            {activeTab === 'images' ? (
              <div className="asset-manager-grid">
                <div className="prompt-template-list-empty" style={{ gridColumn: '1 / -1', padding: 60 }}>
                  {t('canvasAssetMgrNoImages')}
                  <br />
                  {t('canvasAssetMgrNoImagesHint')}
                </div>
              </div>
            ) : (
              <div className="prompt-template-list">
                <div className="prompt-template-list-empty" style={{ padding: 60 }}>
                  {t('canvasAssetMgrNoPrompts')}
                  <br />
                  {t('canvasAssetMgrNoPromptsHint')}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

AssetManagerModal.displayName = 'AssetManagerModal';
