
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
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-in fade-in">
      <div className="bg-brand-900 border border-brand-700 rounded-xl shadow-2xl w-full max-w-lg text-white">
        <div className="p-4 border-b border-brand-800 flex justify-between items-center bg-brand-800/50">
          <div className="flex items-center gap-2">
            <User className="w-5 h-5 text-brand-400" />
            <h2 className="text-lg font-bold">{t('editCharacter')}</h2>
          </div>
          <button onClick={onClose} className="p-1 hover:bg-white/10 rounded-full transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-4">
          <div>
            <label className="block text-xs text-gray-400 mb-1 font-bold uppercase">{t('name')}</label>
            <input
              type="text"
              value={editedChar.name}
              onChange={(e) => setEditedChar({ ...editedChar, name: e.target.value })}
              className="w-full bg-black/30 border border-brand-700 rounded px-3 py-2 text-sm text-gray-200 focus:border-brand-500 outline-none transition-colors"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1 font-bold uppercase">{t('visualFeatures')}</label>
            <textarea
              value={editedChar.visualFeatures}
              onChange={(e) => setEditedChar({ ...editedChar, visualFeatures: e.target.value })}
              className="w-full h-24 bg-black/30 border border-brand-700 rounded px-3 py-2 text-sm focus:border-brand-500 outline-none resize-none"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1 font-bold uppercase">{t('clothing')}</label>
            <textarea
              value={editedChar.clothing}
              onChange={(e) => setEditedChar({ ...editedChar, clothing: e.target.value })}
              className="w-full h-20 bg-black/30 border border-brand-700 rounded px-3 py-2 text-sm focus:border-brand-500 outline-none resize-none"
            />
          </div>
        </div>

        <div className="p-4 border-t border-brand-800 flex justify-end gap-3">
          <button onClick={onClose} className="px-4 py-2 text-gray-400 hover:text-white text-sm">{t('cancel')}</button>
          <button
            onClick={() => { onSave(editedChar, character.name); onClose(); }}
            className="flex items-center gap-2 bg-brand-600 hover:bg-brand-500 text-white px-4 py-2 rounded-lg font-medium text-sm transition-colors"
          >
            <Save className="w-4 h-4" />
            {t('save')}
          </button>
        </div>
      </div>
    </div>
  );
};
