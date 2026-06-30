import React, { useCallback } from 'react';
import { X, Copy } from 'lucide-react';
import { useI18n } from '../../i18n';

interface ErrorModalProps {
  open: boolean;
  title?: string;
  message?: string;
  onClose: () => void;
}

export const ErrorModal: React.FC<ErrorModalProps> = ({
  open,
  title,
  message = '',
  onClose,
}) => {
  const { t } = useI18n();
  const resolvedTitle = title || t('canvasErrorDefault');
  const handleCopy = useCallback(() => {
    if (message) {
      navigator.clipboard.writeText(message).catch(() => {});
    }
  }, [message]);

  if (!open) return null;

  return (
    <div className="error-modal open" onClick={onClose}>
      <div className="error-panel" onClick={(e) => e.stopPropagation()}>
        <div className="error-head">
          <div className="error-title">{resolvedTitle}</div>
          <button
            type="button"
            className="preview-icon-btn"
            onClick={onClose}
            title={t('canvasErrorClose')}
          >
            <X size={14} />
          </button>
        </div>
        <div className="error-message">{message}</div>
        <div className="error-actions">
          <button type="button" className="error-btn" onClick={handleCopy}>
            <Copy size={14} /> {t('canvasLogCopy')}
          </button>
          <button type="button" className="error-btn primary" onClick={onClose}>
            {t('canvasErrorClose')}
          </button>
        </div>
      </div>
    </div>
  );
};

ErrorModal.displayName = 'ErrorModal';
