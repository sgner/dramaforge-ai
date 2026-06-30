import React, { useState, useEffect } from 'react';
import { Character } from '../types';
import { User, X, Save } from 'lucide-react';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  character: Character;
  onSave: (updatedChar: Character, originalName: string) => void;
  t: (key: string) => string;
}

export const EditCharacterModal: React.FC<Props> = ({ isOpen, onClose, character, onSave, t }) => {
  const [editedChar, setEditedChar] = useState<Character>(character);

  useEffect(() => {
    setEditedChar(character);
  }, [character]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-4 animate-in fade-in"
      style={{ background: 'rgba(0,0,0,0.4)', backdropFilter: 'blur(8px)' }}
    >
      <div
        className="rounded-2xl shadow-2xl w-full max-w-lg text-[#111827] animate-scale-in overflow-hidden"
        style={{ background: '#ffffff', border: '1px solid #e8edf3' }}
      >
        <div
          className="p-5 flex justify-between items-center"
          style={{ borderBottom: '1px solid #e8edf3' }}
        >
          <div className="flex items-center gap-3">
            <div
              className="w-8 h-8 rounded-lg flex items-center justify-center"
              style={{ background: 'rgba(17,24,39,0.04)', border: '1px solid rgba(17,24,39,0.08)' }}
            >
              <User className="w-4 h-4 text-brand-400" />
            </div>
            <h2 className="text-base font-semibold tracking-tight">{t('editCharacter')}</h2>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-full transition-colors text-[#64748b] hover:text-[#111827] hover:rotate-90 duration-300"
            style={{ background: 'rgba(17,24,39,0.04)' }}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-6 space-y-4">
          <div>
            <label className="block text-[10px] font-mono uppercase tracking-wider text-[#64748b] mb-2 font-medium">
              {t('name')}
            </label>
            <input
              type="text"
              value={editedChar.name}
              onChange={(e) => setEditedChar({ ...editedChar, name: e.target.value })}
              className="w-full rounded-lg px-4 py-2.5 text-sm text-[#111827] focus:outline-none focus:ring-2 transition-all"
              style={{ background: '#f8fafc', border: '1px solid #e8edf3' }}
              onFocus={(e) => { e.target.style.borderColor = 'rgba(17,24,39,0.4)'; e.target.style.boxShadow = '0 0 0 3px rgba(17,24,39,0.08)'; }}
              onBlur={(e) => { e.target.style.borderColor = '#e8edf3'; e.target.style.boxShadow = 'none'; }}
            />
          </div>
          <div>
            <label className="block text-[10px] font-mono uppercase tracking-wider text-[#64748b] mb-2 font-medium">
              {t('visualFeatures')}
            </label>
            <textarea
              value={editedChar.visualFeatures}
              onChange={(e) => setEditedChar({ ...editedChar, visualFeatures: e.target.value })}
              className="w-full h-24 rounded-lg px-4 py-2.5 text-sm text-[#111827] focus:outline-none focus:ring-2 transition-all resize-none"
              style={{ background: '#f8fafc', border: '1px solid #e8edf3' }}
              onFocus={(e) => { e.target.style.borderColor = 'rgba(17,24,39,0.4)'; e.target.style.boxShadow = '0 0 0 3px rgba(17,24,39,0.08)'; }}
              onBlur={(e) => { e.target.style.borderColor = '#e8edf3'; e.target.style.boxShadow = 'none'; }}
            />
          </div>
          <div>
            <label className="block text-[10px] font-mono uppercase tracking-wider text-[#64748b] mb-2 font-medium">
              {t('clothing')}
            </label>
            <textarea
              value={editedChar.clothing}
              onChange={(e) => setEditedChar({ ...editedChar, clothing: e.target.value })}
              className="w-full h-20 rounded-lg px-4 py-2.5 text-sm text-[#111827] focus:outline-none focus:ring-2 transition-all resize-none"
              style={{ background: '#f8fafc', border: '1px solid #e8edf3' }}
              onFocus={(e) => { e.target.style.borderColor = 'rgba(17,24,39,0.4)'; e.target.style.boxShadow = '0 0 0 3px rgba(17,24,39,0.08)'; }}
              onBlur={(e) => { e.target.style.borderColor = '#e8edf3'; e.target.style.boxShadow = 'none'; }}
            />
          </div>
        </div>

        <div
          className="p-4 flex justify-end gap-3"
          style={{ borderTop: '1px solid #e8edf3' }}
        >
          <button
            onClick={onClose}
            className="px-5 py-2 text-[#64748b] hover:text-[#111827] rounded-lg text-sm font-medium transition-all"
            style={{ background: 'rgba(17,24,39,0.04)' }}
          >
            {t('cancel')}
          </button>
          <button
            onClick={() => { onSave(editedChar, character.name); onClose(); }}
            className="btn-press flex items-center gap-2 px-5 py-2 rounded-lg font-medium text-sm text-white transition-all hover:-translate-y-0.5"
            style={{ background: '#111827', boxShadow: '0 4px 12px rgba(17,24,39,0.2)' }}
          >
            <Save className="w-4 h-4" />
            {t('save')}
          </button>
        </div>
      </div>
    </div>
  );
};
