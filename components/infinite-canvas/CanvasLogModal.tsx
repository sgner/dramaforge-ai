import React from 'react';
import { X, Check, Circle } from 'lucide-react';
import { useI18n } from '../../i18n';

interface LogEntry {
  id: string;
  time: string;
  message: string;
  status?: 'success' | 'error' | 'pending';
}

interface CanvasLogModalProps {
  open: boolean;
  logs: LogEntry[];
  onClose: () => void;
}

export const CanvasLogModal: React.FC<CanvasLogModalProps> = ({
  open,
  logs,
  onClose,
}) => {
  const { t } = useI18n();
  if (!open) return null;

  return (
    <div className="log-modal open" onClick={onClose}>
      <div className="log-panel" onClick={(e) => e.stopPropagation()}>
        <div className="log-head">
          <div className="log-title">{t('canvasLogTitle')}</div>
          <button
            type="button"
            className="preview-icon-btn"
            onClick={onClose}
            title={t('canvasApiSettingsClose')}
          >
            <X size={14} />
          </button>
        </div>
        <div className="log-list">
          {logs.length ? (
            logs.map((log) => (
              <div key={log.id} className={`log-entry log-${log.status || 'pending'}`}>
                <div className="log-entry-head">
                  <span className="log-entry-time">{log.time}</span>
                  <span className={`log-entry-status ${log.status || ''}`}>
                    {log.status === 'success' ? <Check size={14} /> : log.status === 'error' ? <X size={14} /> : <Circle size={14} />}
                  </span>
                </div>
                <div className="log-entry-message">{log.message}</div>
              </div>
            ))
          ) : (
            <div className="prompt-template-list-empty">{t('canvasLogEmpty')}</div>
          )}
        </div>
      </div>
    </div>
  );
};

CanvasLogModal.displayName = 'CanvasLogModal';
