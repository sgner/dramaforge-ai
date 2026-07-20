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

  const inputFocus = (e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    e.target.style.borderColor = 'rgba(110,107,242,0.5)';
    e.target.style.boxShadow = '0 0 0 3px rgba(110,107,242,0.20)';
  };
  const inputBlur = (e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    e.target.style.borderColor = 'transparent';
    e.target.style.boxShadow = 'none';
  };

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-4 animate-in fade-in"
      style={{ background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(8px)' }}
    >
      <div
        className="rounded-2xl shadow-2xl shadow-black/60 w-full max-w-lg text-[#F5F5F7] animate-scale-in overflow-hidden"
        style={{ background: '#131316', border: '1px solid rgba(255,255,255,0.07)' }}
      >
        <div
          className="p-5 flex justify-between items-center"
          style={{ borderBottom: '1px solid rgba(255,255,255,0.07)' }}
        >
          <div className="flex items-center gap-3">
            <div
              className="w-8 h-8 rounded-lg flex items-center justify-center"
              style={{ background: 'rgba(110,107,242,0.14)', border: '1px solid rgba(110,107,242,0.30)' }}
            >
              <User className="w-4 h-4 text-[#817FF5]" />
            </div>
            <h2 className="text-[15px] font-semibold tracking-tight">{t('editCharacter')}</h2>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-full transition-colors text-white/45 hover:text-[#F5F5F7] hover:rotate-90 duration-300"
            style={{ background: 'rgba(255,255,255,0.06)' }}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-6 space-y-4">
          <div>
            <label className="block text-[10px] font-mono uppercase tracking-wider text-white/40 mb-2 font-medium">
              {t('name')}
            </label>
            <input
              type="text"
              value={editedChar.name}
              onChange={(e) => setEditedChar({ ...editedChar, name: e.target.value })}
              className="w-full rounded-lg px-4 py-2.5 text-sm text-[#F5F5F7] focus:outline-none transition-all placeholder:text-white/30"
              style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid transparent' }}
              onFocus={inputFocus}
              onBlur={inputBlur}
            />
          </div>
          <div>
            <label className="block text-[10px] font-mono uppercase tracking-wider text-white/40 mb-2 font-medium">
              {t('visualFeatures')}
            </label>
            <textarea
              value={editedChar.visualFeatures}
              onChange={(e) => setEditedChar({ ...editedChar, visualFeatures: e.target.value })}
              className="w-full h-24 rounded-lg px-4 py-2.5 text-sm text-[#F5F5F7] focus:outline-none transition-all resize-none placeholder:text-white/30"
              style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid transparent' }}
              onFocus={inputFocus}
              onBlur={inputBlur}
            />
          </div>
          <div>
            <label className="block text-[10px] font-mono uppercase tracking-wider text-white/40 mb-2 font-medium">
              {t('clothing')}
            </label>
            <textarea
              value={editedChar.clothing}
              onChange={(e) => setEditedChar({ ...editedChar, clothing: e.target.value })}
              className="w-full h-20 rounded-lg px-4 py-2.5 text-sm text-[#F5F5F7] focus:outline-none transition-all resize-none placeholder:text-white/30"
              style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid transparent' }}
              onFocus={inputFocus}
              onBlur={inputBlur}
            />
          </div>
        </div>

        <div
          className="p-4 flex justify-end gap-3"
          style={{ borderTop: '1px solid rgba(255,255,255,0.07)' }}
        >
          <button
            onClick={onClose}
            className="px-5 py-2 text-white/60 hover:text-[#F5F5F7] rounded-full text-sm font-medium transition-all"
            style={{ background: '#1A1A1F', border: '1px solid rgba(255,255,255,0.07)' }}
          >
            {t('cancel')}
          </button>
          <button
            onClick={() => { onSave(editedChar, character.name); onClose(); }}
            className="btn-press flex items-center gap-2 px-5 py-2 rounded-full font-semibold text-sm text-white transition-all hover:bg-[#817FF5]"
            style={{ background: '#6E6BF2', boxShadow: '0 4px 14px rgba(110,107,242,0.30)' }}
          >
            <Save className="w-4 h-4" />
            {t('save')}
          </button>
        </div>
      </div>
    </div>
  );
};
