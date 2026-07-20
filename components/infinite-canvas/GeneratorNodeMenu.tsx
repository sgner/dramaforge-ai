import React, { useEffect, useRef } from 'react';
import { Zap, RefreshCw, Copy, Trash2, MessageSquare, Image as ImageIcon, Target, Sparkles } from 'lucide-react';
import { useI18n } from '../../i18n';
import { useMenuEdgeAdjust } from './use-menu-edge-adjust';

interface GeneratorNodeMenuProps {
  open: boolean;
  x: number;
  y: number;
  nodeId: string;
  onClose: () => void;
  onRun?: (nodeId: string) => void;
  onRerun?: (nodeId: string) => void;
  onCopyPrompt?: (nodeId: string) => void;
  onDelete?: (nodeId: string) => void;
  onAddInput?: (nodeId: string, type: string) => void;
  onAddOutput?: (nodeId: string, type: string) => void;
}

export const GeneratorNodeMenu: React.FC<GeneratorNodeMenuProps> = ({
  open,
  x,
  y,
  nodeId,
  onClose,
  onRun,
  onRerun,
  onCopyPrompt,
  onDelete,
  onAddInput,
  onAddOutput,
}) => {
  const { t } = useI18n();
  const menuRef = useRef<HTMLDivElement>(null);
  // 边界保护：越界时收回 / 翻转到点击位置上方
  const menuPos = useMenuEdgeAdjust(open, x, y, menuRef);

  const INPUT_TYPES: { type: string; label: string; icon: React.ReactNode }[] = [
    { type: 'prompt', label: t('canvasGenMenuInputPrompt'), icon: <MessageSquare size={14} /> },
    { type: 'image', label: t('canvasGenMenuInputImage'), icon: <ImageIcon size={14} /> },
  ];

  const OUTPUT_TYPES: { type: string; label: string; icon: React.ReactNode }[] = [
    { type: 'output', label: t('canvasGenMenuOutput'), icon: <Target size={14} /> },
    { type: 'generator', label: t('canvasGenMenuGenerator'), icon: <Sparkles size={14} /> },
  ];

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      ref={menuRef}
      className="create-menu open node-port-menu"
      style={{ left: menuPos.left, top: menuPos.top }}
    >
      <div className="menu-section-title">{t('canvasGenMenuActions')}</div>
      <button
        className="menu-btn"
        onClick={() => {
          onRun?.(nodeId);
          onClose();
        }}
      >
        <Zap size={14} /> {t('canvasGenMenuRun')}
      </button>
      <button
        className="menu-btn"
        onClick={() => {
          onRerun?.(nodeId);
          onClose();
        }}
      >
        <RefreshCw size={14} /> {t('canvasGenMenuRerun')}
      </button>
      <button
        className="menu-btn"
        onClick={() => {
          onCopyPrompt?.(nodeId);
          onClose();
        }}
      >
        <Copy size={14} /> {t('canvasGenMenuCopyPrompt')}
      </button>
      <div className="menu-divider" />
      <div className="menu-section-title">{t('canvasGenMenuAddInput')}</div>
      <div className="node-port-menu-grid">
        {INPUT_TYPES.map((item) => (
          <button
            key={item.type}
            className="menu-btn"
            onClick={() => {
              onAddInput?.(nodeId, item.type);
              onClose();
            }}
          >
            {item.icon} <span>{item.label}</span>
          </button>
        ))}
      </div>
      <div className="menu-section-title">{t('canvasGenMenuAddOutput')}</div>
      <div className="node-port-menu-grid">
        {OUTPUT_TYPES.map((item) => (
          <button
            key={item.type}
            className="menu-btn"
            onClick={() => {
              onAddOutput?.(nodeId, item.type);
              onClose();
            }}
          >
            {item.icon} <span>{item.label}</span>
          </button>
        ))}
      </div>
      <div className="menu-divider" />
      <button
        className="menu-btn"
        style={{ color: '#dc2626' }}
        onClick={() => {
          onDelete?.(nodeId);
          onClose();
        }}
      >
        <Trash2 size={14} /> {t('canvasGenMenuDelete')}
      </button>
    </div>
  );
};

GeneratorNodeMenu.displayName = 'GeneratorNodeMenu';
