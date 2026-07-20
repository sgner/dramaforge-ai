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
      style={{ background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(8px)' }}
    >
      <div
        className="rounded-2xl shadow-2xl shadow-black/60 w-full max-w-md p-6 animate-scale-in"
        style={{ background: '#131316', border: '1px solid rgba(255,255,255,0.07)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-4 mb-4">
          <div className="p-3 rounded-xl" style={{ background: 'rgba(242,97,97,0.10)', border: '1px solid rgba(242,97,97,0.25)' }}>
            <AlertTriangle className="w-5 h-5 text-[#F26161]" />
          </div>
          <h3 className="text-[15px] font-semibold text-[#F5F5F7] tracking-tight">{title}</h3>
        </div>
        <p className="text-white/45 mb-6 leading-relaxed text-sm">
          {message}
        </p>
        <div className="flex justify-end gap-3">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-[#1A1A1F] border border-white/[0.07] rounded-full text-white/60 hover:text-[#F5F5F7] transition-colors text-sm font-medium"
          >
            {cancelText}
          </button>
          <button
            onClick={() => { onConfirm(); onClose(); }}
            className="btn-press px-4 py-2 bg-[#F26161] hover:bg-[#f47777] text-white rounded-full font-medium shadow-lg shadow-[#F26161]/20 transition-all text-sm"
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
};
