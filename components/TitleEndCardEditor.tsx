import React, { useState } from 'react';
import { Film, Save, X } from 'lucide-react';
import { TitleCard, EndCard } from '../types';

const TITLE_STYLES = [
  { value: 'cinematic', label: 'Cinematic' },
  { value: 'minimal', label: 'Minimal' },
  { value: 'typographic', label: 'Typographic' },
  { value: 'brushwork', label: 'Brushwork' },
] as const;

const ANIMATIONS = [
  { value: 'fade_in', label: 'Fade In' },
  { value: 'slide_up', label: 'Slide Up' },
  { value: 'zoom', label: 'Zoom' },
  { value: 'brush_stroke', label: 'Brush Stroke' },
  { value: 'typewriter', label: 'Typewriter' },
] as const;

const END_STYLES = [
  { value: 'scroll', label: 'Scroll' },
  { value: 'static', label: 'Static' },
  { value: 'minimal', label: 'Minimal' },
] as const;

export const TitleEndCardEditor = ({
  titleCard,
  endCard,
  onSaveTitleCard,
  onSaveEndCard,
  onClose,
  t
}: {
  titleCard?: TitleCard;
  endCard?: EndCard;
  onSaveTitleCard: (tc: TitleCard) => void;
  onSaveEndCard: (ec: EndCard) => void;
  onClose: () => void;
  t: (key: string) => string;
}) => {
  const [tc, setTc] = useState<TitleCard>(titleCard || {
    title: '',
    subtitle: '',
    style: 'cinematic',
    duration: 3,
    fontSpec: 'Noto Serif SC Bold 72px',
    colorScheme: '白字+暗底',
    animation: 'fade_in',
  });

  const [ec, setEc] = useState<EndCard>(endCard || {
    credits: [''],
    style: 'scroll',
    duration: 5,
  });

  const inputStyle = {
    background: '#f8fafc',
    border: '1px solid #e8edf3',
  };

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-4 animate-in fade-in duration-200"
      style={{ background: 'rgba(0,0,0,0.4)', backdropFilter: 'blur(8px)' }}
    >
      <div
        className="w-full max-w-xl max-h-[80vh] flex flex-col rounded-2xl overflow-hidden animate-scale-in"
        style={{ background: '#ffffff', border: '1px solid #e8edf3' }}
      >
        <div
          className="flex items-center justify-between px-6 py-4"
          style={{ borderBottom: '1px solid #e8edf3' }}
        >
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg" style={{ background: 'rgba(17,24,39,0.04)', border: '1px solid rgba(17,24,39,0.08)' }}>
              <Film className="w-4 h-4 text-brand-400" />
            </div>
            <h3 className="text-base font-semibold text-[#111827] tracking-tight">Title & End Card</h3>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-[#64748b] hover:text-[#111827] transition-colors"
            style={{ background: 'rgba(17,24,39,0.04)' }}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-6 custom-scrollbar">
          <div>
            <h4 className="text-xs font-medium text-brand-300 uppercase tracking-wider mb-3">Title Card</h4>
            <div className="space-y-3">
              <div>
                <label className="text-[10px] text-[#94a3b8] uppercase">Title</label>
                <input value={tc.title} onChange={e => setTc({ ...tc, title: e.target.value })} className="w-full mt-1 px-3 py-2 rounded-lg text-xs text-[#111827] focus:outline-none transition-all" style={inputStyle} />
              </div>
              <div>
                <label className="text-[10px] text-[#94a3b8] uppercase">Subtitle</label>
                <input value={tc.subtitle || ''} onChange={e => setTc({ ...tc, subtitle: e.target.value })} className="w-full mt-1 px-3 py-2 rounded-lg text-xs text-[#111827] focus:outline-none transition-all" style={inputStyle} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] text-[#94a3b8] uppercase">Style</label>
                  <select value={tc.style} onChange={e => setTc({ ...tc, style: e.target.value as TitleCard['style'] })} className="w-full mt-1 px-3 py-2 rounded-lg text-xs text-[#111827] focus:outline-none transition-all" style={inputStyle}>
                    {TITLE_STYLES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-[10px] text-[#94a3b8] uppercase">Animation</label>
                  <select value={tc.animation} onChange={e => setTc({ ...tc, animation: e.target.value as TitleCard['animation'] })} className="w-full mt-1 px-3 py-2 rounded-lg text-xs text-[#111827] focus:outline-none transition-all" style={inputStyle}>
                    {ANIMATIONS.map(a => <option key={a.value} value={a.value}>{a.label}</option>)}
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] text-[#94a3b8] uppercase">Duration (s)</label>
                  <input type="number" value={tc.duration} onChange={e => setTc({ ...tc, duration: Number(e.target.value) })} min={1} max={10} className="w-full mt-1 px-3 py-2 rounded-lg text-xs text-[#111827] focus:outline-none transition-all" style={inputStyle} />
                </div>
                <div>
                  <label className="text-[10px] text-[#94a3b8] uppercase">Color Scheme</label>
                  <input value={tc.colorScheme} onChange={e => setTc({ ...tc, colorScheme: e.target.value })} className="w-full mt-1 px-3 py-2 rounded-lg text-xs text-[#111827] focus:outline-none transition-all" style={inputStyle} />
                </div>
              </div>
              <div>
                <label className="text-[10px] text-[#94a3b8] uppercase">Font Spec</label>
                <input value={tc.fontSpec} onChange={e => setTc({ ...tc, fontSpec: e.target.value })} className="w-full mt-1 px-3 py-2 rounded-lg text-xs text-[#111827] focus:outline-none transition-all" style={inputStyle} />
              </div>
              <div>
                <label className="text-[10px] text-[#94a3b8] uppercase">Background Prompt</label>
                <textarea value={tc.bgPrompt || ''} onChange={e => setTc({ ...tc, bgPrompt: e.target.value })} rows={2} className="w-full mt-1 px-3 py-2 rounded-lg text-xs text-[#111827] focus:outline-none transition-all resize-none" style={inputStyle} />
              </div>
            </div>
          </div>

          <div className="pt-5" style={{ borderTop: '1px solid #e8edf3' }}>
            <h4 className="text-xs font-medium text-brand-300 uppercase tracking-wider mb-3">End Card</h4>
            <div className="space-y-3">
              <div>
                <label className="text-[10px] text-[#94a3b8] uppercase">Credits (one per line)</label>
                <textarea value={ec.credits.join('\n')} onChange={e => setEc({ ...ec, credits: e.target.value.split('\n') })} rows={4} className="w-full mt-1 px-3 py-2 rounded-lg text-xs text-[#111827] focus:outline-none transition-all resize-none" style={inputStyle} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] text-[#94a3b8] uppercase">Style</label>
                  <select value={ec.style} onChange={e => setEc({ ...ec, style: e.target.value as EndCard['style'] })} className="w-full mt-1 px-3 py-2 rounded-lg text-xs text-[#111827] focus:outline-none transition-all" style={inputStyle}>
                    {END_STYLES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-[10px] text-[#94a3b8] uppercase">Duration (s)</label>
                  <input type="number" value={ec.duration} onChange={e => setEc({ ...ec, duration: Number(e.target.value) })} min={2} max={30} className="w-full mt-1 px-3 py-2 rounded-lg text-xs text-[#111827] focus:outline-none transition-all" style={inputStyle} />
                </div>
              </div>
              <div>
                <label className="text-[10px] text-[#94a3b8] uppercase">Background Prompt</label>
                <textarea value={ec.bgPrompt || ''} onChange={e => setEc({ ...ec, bgPrompt: e.target.value })} rows={2} className="w-full mt-1 px-3 py-2 rounded-lg text-xs text-[#111827] focus:outline-none transition-all resize-none" style={inputStyle} />
              </div>
            </div>
          </div>
        </div>

        <div
          className="flex items-center justify-end gap-3 px-6 py-4"
          style={{ borderTop: '1px solid #e8edf3' }}
        >
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg text-xs font-medium text-[#64748b] hover:text-[#111827] transition-colors"
            style={{ background: 'rgba(17,24,39,0.04)', border: '1px solid rgba(17,24,39,0.06)' }}
          >
            Cancel
          </button>
          <button
            onClick={() => { onSaveTitleCard(tc); onSaveEndCard(ec); onClose(); }}
            className="px-5 py-2 rounded-lg text-xs font-medium transition-all hover:-translate-y-0.5 text-white"
            style={{ background: '#111827', boxShadow: '0 4px 12px rgba(17,24,39,0.2)' }}
          >
            <Save className="w-3.5 h-3.5 inline mr-1" /> Save
          </button>
        </div>
      </div>
    </div>
  );
};
