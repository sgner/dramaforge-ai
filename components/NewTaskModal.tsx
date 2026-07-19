import React, { useState } from 'react';
import { X, Sparkles, BookOpen, Lightbulb, Wand2, Settings, Film, Clapperboard, Palette, Swords, Rocket } from 'lucide-react';
import { ArtStyle, Language, TaskMode } from '../types';

const STYLE_OPTIONS: { id: ArtStyle; label: string; icon: React.ElementType }[] = [
  { id: ArtStyle.REALISTIC, label: 'Cinematic', icon: Film },
  { id: ArtStyle.ANIMATION, label: 'Animation', icon: Clapperboard },
  { id: ArtStyle.WATERCOLOR, label: 'Watercolor', icon: Palette },
  { id: ArtStyle.CYBERPUNK, label: 'Cyberpunk', icon: Swords },
  { id: ArtStyle.PIXAR, label: '3D Cartoon', icon: Rocket },
];

export const NewTaskModal = ({ isOpen, onClose, onCreate, hasApiKey, onOpenSettings, t }: {
  isOpen: boolean;
  onClose: () => void;
  onCreate: (name: string, style: ArtStyle, language: Language, content: string, mode: TaskMode, sourceType: 'novel' | 'idea') => void;
  hasApiKey: boolean;
  onOpenSettings: () => void;
  t: (key: string) => string;
}) => {
  const [name, setName] = useState('');
  const [sourceType, setSourceType] = useState<'novel' | 'idea'>('idea');
  const [style, setStyle] = useState<ArtStyle>(ArtStyle.REALISTIC);
  const [mode, setMode] = useState<TaskMode>('auto');
  const [content, setContent] = useState('');
  const [isClosing, setIsClosing] = useState(false);

  if (!isOpen) return null;

  const handleClose = () => {
    setIsClosing(true);
    setTimeout(() => {
      setIsClosing(false);
      onClose();
    }, 250);
  };

  const handleSubmit = () => {
    if (!name.trim()) return;
    if (!hasApiKey) {
      onOpenSettings();
      return;
    }
    onCreate(name.trim(), style, 'zh', content, mode, sourceType);
  };

  return (
    <div className={`fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4 transition-opacity duration-300 ${isClosing ? 'opacity-0' : 'opacity-100'}`}>
      <div className={`bg-white border border-[#e8edf3] rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] flex flex-col transition-all duration-300 ${isClosing ? 'scale-95 opacity-0' : 'scale-100 opacity-100 animate-scale-in'}`}>
        {/* Header */}
        <div className="p-5 border-b border-[#e8edf3] flex justify-between items-center">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-brand-600 rounded-xl flex items-center justify-center shadow-lg shadow-brand-600/20">
              <Wand2 className="w-4 h-4 text-white" />
            </div>
            <div>
              <h2 className="text-base font-bold text-[#111827]">{t('newProject')}</h2>
              <p className="text-[10px] font-mono text-[#94a3b8] uppercase tracking-wider">Create a new drama</p>
            </div>
          </div>
          <button onClick={handleClose} className="p-2 hover:bg-black/[0.06] rounded-lg transition-colors text-[#64748b] hover:text-[#111827]">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-6 custom-scrollbar space-y-5">
          {!hasApiKey && (
            <div className="p-4 rounded-xl bg-red-50 border border-red-200 flex items-center gap-3">
              <Settings className="w-5 h-5 text-red-500 shrink-0" />
              <div className="flex-1">
                <p className="text-sm text-red-700 font-medium">{t('noApiKey')}</p>
                <p className="text-xs text-red-500/80 mt-0.5">{t('noApiKeyDesc')}</p>
              </div>
              <button onClick={onOpenSettings} className="px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white rounded-lg text-xs font-medium transition-colors">
                {t('settings')}
              </button>
            </div>
          )}

          {/* Project name */}
          <div>
            <label className="block text-[10px] font-mono uppercase tracking-wider text-[#64748b] mb-2 font-semibold">{t('projectName')}</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('projectNamePlaceholder') || 'Enter your drama title...'}
              className="w-full bg-[#f8fafc] border border-[#e8edf3] rounded-xl px-4 py-3 text-sm text-[#111827] focus:outline-none focus:border-brand-500/50 focus:ring-1 focus:ring-brand-500/20 transition-all placeholder:text-[#94a3b8]"
              autoFocus
            />
          </div>

          {/* Source type */}
          <div>
            <label className="block text-[10px] font-mono uppercase tracking-wider text-[#64748b] mb-3 font-semibold">{t('sourceType')}</label>
            <div className="grid grid-cols-2 gap-3">
              <button
                onClick={() => setSourceType('idea')}
                className={`p-4 rounded-xl text-left transition-all duration-300 ${
                  sourceType === 'idea'
                    ? 'bg-black/[0.04] border-[1.5px] border-slate-900'
                    : 'bg-black/[0.02] border border-[#e8edf3] hover:border-black/[0.12]'
                }`}
              >
                <Lightbulb className={`w-5 h-5 mb-2 transition-colors ${sourceType === 'idea' ? 'text-slate-900' : 'text-[#94a3b8]'}`} />
                <div className={`text-sm font-semibold transition-colors ${sourceType === 'idea' ? 'text-slate-900' : 'text-[#64748b]'}`}>{t('fromIdea')}</div>
                <div className="text-[10px] text-[#94a3b8] mt-1">{t('ideaDesc') || 'Start from a creative concept'}</div>
              </button>
              <button
                onClick={() => setSourceType('novel')}
                className={`p-4 rounded-xl text-left transition-all duration-300 ${
                  sourceType === 'novel'
                    ? 'bg-black/[0.04] border-[1.5px] border-slate-900'
                    : 'bg-black/[0.02] border border-[#e8edf3] hover:border-black/[0.12]'
                }`}
              >
                <BookOpen className={`w-5 h-5 mb-2 transition-colors ${sourceType === 'novel' ? 'text-slate-900' : 'text-[#94a3b8]'}`} />
                <div className={`text-sm font-semibold transition-colors ${sourceType === 'novel' ? 'text-slate-900' : 'text-[#64748b]'}`}>{t('fromNovel')}</div>
                <div className="text-[10px] text-[#94a3b8] mt-1">{t('novelDesc') || 'Adapt from existing text'}</div>
              </button>
            </div>
          </div>

          {/* Content */}
          <div>
            <label className="block text-[10px] font-mono uppercase tracking-wider text-[#64748b] mb-2 font-semibold">
              {sourceType === 'novel' ? t('novelContent') || 'Novel Content' : t('ideaContent') || 'Your Idea'}
            </label>
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder={sourceType === 'novel'
                ? (t('novelPlaceholder') || 'Paste your novel text here...')
                : (t('ideaPlaceholder') || 'Describe your drama idea...')}
              className="w-full h-32 bg-[#f8fafc] border border-[#e8edf3] rounded-xl px-4 py-3 text-sm text-[#111827] focus:outline-none focus:border-brand-500/50 focus:ring-1 focus:ring-brand-500/20 transition-all resize-none placeholder:text-[#94a3b8]"
            />
          </div>

          {/* Visual style */}
          <div>
            <label className="block text-[10px] font-mono uppercase tracking-wider text-[#64748b] mb-3 font-semibold">{t('visualStyle') || 'Visual Style'}</label>
            <div className="grid grid-cols-5 gap-2">
              {STYLE_OPTIONS.map(opt => (
                <button
                  key={opt.id}
                  onClick={() => setStyle(opt.id)}
                  className={`p-3 rounded-xl border text-center transition-all duration-300 ${
                    style === opt.id
                      ? 'bg-brand-600/10 border-brand-500/30 scale-105'
                      : 'bg-black/[0.02] border-[#e8edf3] hover:border-black/[0.12]'
                  }`}
                >
                  <opt.icon className={`w-5 h-5 mx-auto mb-1.5 transition-colors ${style === opt.id ? 'text-brand-400' : 'text-[#94a3b8]'}`} />
                  <div className={`text-[10px] font-semibold transition-colors ${style === opt.id ? 'text-brand-300' : 'text-[#64748b]'}`}>{opt.label}</div>
                </button>
              ))}
            </div>
          </div>

          {/* Creation mode */}
          <div>
            <label className="block text-[10px] font-mono uppercase tracking-wider text-[#64748b] mb-3 font-semibold">{t('creationMode') || 'Creation Mode'}</label>
            <div className="grid grid-cols-2 gap-3">
              <button
                onClick={() => setMode('auto')}
                className={`p-4 rounded-xl border text-left transition-all duration-300 ${
                  mode === 'auto'
                    ? 'bg-brand-600/10 border-brand-500/30'
                    : 'bg-black/[0.02] border-[#e8edf3] hover:border-black/[0.12]'
                }`}
              >
                <Sparkles className={`w-5 h-5 mb-2 transition-colors ${mode === 'auto' ? 'text-brand-400' : 'text-[#94a3b8]'}`} />
                <div className={`text-sm font-semibold transition-colors ${mode === 'auto' ? 'text-brand-300' : 'text-[#64748b]'}`}>{t('autoMode')}</div>
                <div className="text-[10px] text-[#94a3b8] mt-1">{t('autoModeDesc') || 'AI handles all steps'}</div>
              </button>
              <button
                onClick={() => setMode('manual')}
                className={`p-4 rounded-xl border text-left transition-all duration-300 ${
                  mode === 'manual'
                    ? 'bg-accent-600/10 border-accent-500/30'
                    : 'bg-black/[0.02] border-[#e8edf3] hover:border-black/[0.12]'
                }`}
              >
                <Wand2 className={`w-5 h-5 mb-2 transition-colors ${mode === 'manual' ? 'text-accent-400' : 'text-[#94a3b8]'}`} />
                <div className={`text-sm font-semibold transition-colors ${mode === 'manual' ? 'text-accent-300' : 'text-[#64748b]'}`}>{t('manualMode')}</div>
                <div className="text-[10px] text-[#94a3b8] mt-1">{t('manualModeDesc') || 'Review each step manually'}</div>
              </button>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-[#e8edf3] flex justify-end gap-3">
          <button onClick={handleClose} className="px-5 py-2 text-[#64748b] hover:text-[#111827] rounded-lg text-sm font-medium transition-colors">
            {t('cancel')}
          </button>
          <button
            onClick={handleSubmit}
            disabled={!name.trim()}
            className={`btn-press px-6 py-2 rounded-lg text-sm font-semibold flex items-center gap-2 transition-all ${
              name.trim()
                ? 'bg-brand-600 text-white shadow-lg shadow-brand-600/20 hover:shadow-brand-600/30 hover:-translate-y-0.5'
                : 'bg-black/[0.04] text-[#94a3b8] cursor-not-allowed'
            }`}
          >
            <Sparkles className="w-4 h-4" /> {t('createProject') || 'Create'}
          </button>
        </div>
      </div>
    </div>
  );
};
