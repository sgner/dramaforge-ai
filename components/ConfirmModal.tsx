import React from 'react';
import { AlertTriangle } from 'lucide-react';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
}

export const ConfirmModal: React.FC<Props> = ({
  isOpen,
  onClose,
  onConfirm,
  title,
  message,
  confirmText = "Delete",
  cancelText = "Cancel"
}) => {
  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4 animate-in fade-in duration-200"
      style={{ background: 'rgba(0,0,0,0.4)', backdropFilter: 'blur(8px)' }}
    >
      <div
        className="rounded-2xl shadow-2xl w-full max-w-md p-6 animate-scale-in"
        style={{ background: '#ffffff', border: '1px solid #e8edf3' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-4 mb-4">
          <div className="p-3 rounded-xl" style={{ background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)' }}>
            <AlertTriangle className="w-5 h-5 text-red-600" />
          </div>
          <h3 className="text-lg font-semibold text-[#111827] tracking-tight">{title}</h3>
        </div>
        <p className="text-[#64748b] mb-6 leading-relaxed text-sm">
          {message}
        </p>
        <div className="flex justify-end gap-3">
          <button
            onClick={onClose}
            className="px-4 py-2 text-[#64748b] hover:text-[#111827] transition-colors text-sm font-medium"
          >
            {cancelText}
          </button>
          <button
            onClick={() => { onConfirm(); onClose(); }}
            className="btn-press px-4 py-2 bg-red-600 hover:bg-red-500 text-white rounded-lg font-medium shadow-lg shadow-red-900/20 hover:-translate-y-0.5 transition-all text-sm"
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
};
