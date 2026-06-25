import React, { useCallback, useState, useRef, useEffect } from 'react';
import { X, Image as ImageIcon, FileText, RefreshCw, Package } from 'lucide-react';
import { useCanvasStore } from './use-canvas-store';
import { useI18n } from '../../i18n';

// ===== Prompt Presets =====
const PROMPT_PRESETS = [
  { id: 'portrait', labelKey: 'canvasPresetPortrait', text: 'a portrait of a person, detailed face, soft lighting, professional photography' },
  { id: 'landscape', labelKey: 'canvasPresetLandscape', text: 'a beautiful landscape, dramatic sky, golden hour, ultra detailed' },
  { id: 'anime', labelKey: 'canvasPresetAnime', text: 'anime style, vibrant colors, detailed illustration, studio quality' },
  { id: 'product', labelKey: 'canvasPresetProduct', text: 'product photography, white background, studio lighting, high resolution' },
  { id: 'concept', labelKey: 'canvasPresetConcept', text: 'concept art, fantasy, epic composition, digital painting, artstation' },
  { id: 'realistic', labelKey: 'canvasPresetRealistic', text: 'photorealistic, 8k, ultra detailed, DSLR, sharp focus, natural lighting' },
  { id: 'abstract', labelKey: 'canvasPresetAbstract', text: 'abstract art, vibrant colors, flowing shapes, modern art style' },
  { id: 'cinematic', labelKey: 'canvasPresetCinematic', text: 'cinematic shot, dramatic lighting, film grain, anamorphic lens, movie still' },
];

interface PromptPresetPanelProps {
  onSelect: (text: string) => void;
  onClose: () => void;
}

export const PromptPresetPanel: React.FC<PromptPresetPanelProps> = React.memo(({ onSelect, onClose }) => {
  const { t } = useI18n();
  return (
    <div className="preset-panel" onClick={(e) => e.stopPropagation()}>
      <div className="preset-header">
        <span className="preset-title">{t('canvasPresetTitle')}</span>
        <button className="preset-close" type="button" onClick={onClose}><X size={14} /></button>
      </div>
      <div className="preset-grid">
        {PROMPT_PRESETS.map(preset => (
          <button
            key={preset.id}
            className="preset-item"
            type="button"
            onClick={() => { onSelect(preset.text); onClose(); }}
          >
            <div className="preset-label">{t(preset.labelKey)}</div>
            <div className="preset-preview">{preset.text.slice(0, 40)}...</div>
          </button>
        ))}
      </div>
    </div>
  );
});

PromptPresetPanel.displayName = 'PromptPresetPanel';

// ===== Mention Picker =====
interface MentionPickerProps {
  query: string;
  onSelect: (nodeId: string, nodeName: string) => void;
  onClose: () => void;
  position: { top: number; left: number };
}

export const MentionPicker: React.FC<MentionPickerProps> = React.memo(({ query, onSelect, onClose, position }) => {
  const { t } = useI18n();
  const nodes = useCanvasStore((s) => s.nodes);
  const filtered = nodes.filter(n => {
    const name = (n.title || n.name || n.type) as string;
    return name.toLowerCase().includes(query.toLowerCase());
  }).slice(0, 8);

  if (filtered.length === 0) return null;

  return (
    <div
      className="mention-picker"
      style={{ top: position.top, left: position.left }}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="mention-header">{t('canvasMentionTitle')}</div>
      {filtered.map(n => (
        <button
          key={n.id}
          className="mention-item"
          type="button"
          onClick={() => { onSelect(n.id, n.title || n.name || n.type); onClose(); }}
        >
          <span className="mention-icon">
            {n.type === 'image' ? <ImageIcon size={14} /> : n.type === 'prompt' ? <FileText size={14} /> : n.type === 'loop' ? <RefreshCw size={14} /> : <Package size={14} />}
          </span>
          <span className="mention-name">{n.title || n.name || n.type}</span>
          <span className="mention-id">{n.id.slice(0, 6)}</span>
        </button>
      ))}
    </div>
  );
});

MentionPicker.displayName = 'MentionPicker';
