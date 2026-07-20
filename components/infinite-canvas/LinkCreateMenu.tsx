import React, { useCallback, useEffect, useRef } from 'react';
import { useCanvasStore } from './use-canvas-store';
import { createNode } from './use-canvas-store';
import { CanvasNode, NodeType } from './types';
import { useI18n } from '../../i18n';
import { useMenuEdgeAdjust } from './use-menu-edge-adjust';

interface LinkCreateMenuProps {
  open: boolean;
  x: number;
  y: number;
  fromId: string;
  kind: 'in' | 'out';
  onClose: () => void;
}

export const LinkCreateMenu: React.FC<LinkCreateMenuProps> = React.memo(
  ({ open, x, y, fromId, kind, onClose }) => {
    const menuRef = useRef<HTMLDivElement>(null);
    // 边界保护：越界时收回 / 翻转到点击位置上方
    const menuPos = useMenuEdgeAdjust(open, x, y, menuRef);
    const addNode = useCanvasStore((s) => s.addNode);
    const addConnection = useCanvasStore((s) => s.addConnection);
    const viewport = useCanvasStore((s) => s.viewport);
    const nodes = useCanvasStore((s) => s.nodes);
    const { t } = useI18n();
    const MENU_ITEMS: { type: NodeType; label: string; sub: string; icon: React.ReactNode }[] = [
      {
        type: 'image',
        label: t('canvasMenuImage'),
        sub: t('canvasMenuImageSub'),
        icon: (
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242"/><path d="M12 12v9"/><path d="m16 16-4-4-4 4"/></svg>
        ),
      },
      {
        type: 'prompt',
        label: t('canvasMenuPrompt'),
        sub: t('canvasMenuPromptSub'),
        icon: (
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/><line x1="16" x2="8" y1="13" y2="13"/><line x1="16" x2="8" y1="17" y2="17"/><line x1="10" x2="8" y1="9" y2="9"/></svg>
        ),
      },
      {
        type: 'loop',
        label: t('canvasMenuLoop'),
        sub: t('canvasMenuLoopSub'),
        icon: (
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect width="8" height="8" x="3" y="3" rx="2"/><path d="M7 11v4a2 2 0 0 0 2 2h4"/><rect width="8" height="8" x="13" y="13" rx="2"/></svg>
        ),
      },
    ];

    const handleClickOutside = useCallback(
      (e: MouseEvent) => {
        if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
          onClose();
        }
      },
      [onClose]
    );

    useEffect(() => {
      if (open) {
        setTimeout(() => document.addEventListener('mousedown', handleClickOutside), 0);
        return () => document.removeEventListener('mousedown', handleClickOutside);
      }
    }, [open, handleClickOutside]);

    const handleCreate = useCallback(
      (type: NodeType) => {
        const fromNode = nodes.find((n) => n.id === fromId);
        if (!fromNode) return;
        const offset = kind === 'out' ? 300 : -300;
        const point = { x: fromNode.x + offset, y: fromNode.y };
        const newNode = createNode(type, point);
        addNode(newNode);
        if (kind === 'out') {
          addConnection(fromId, newNode.id);
        } else {
          addConnection(newNode.id, fromId);
        }
        onClose();
      },
      [fromId, kind, nodes, addNode, addConnection, onClose]
    );

    if (!open) return null;

    return (
      <div
        ref={menuRef}
        className="create-menu open"
        style={{ left: menuPos.left, top: menuPos.top }}
      >
        <div className="menu-section-title">{t('canvasLinkCreate')}</div>
        {MENU_ITEMS.map((item) => (
          <button
            key={item.type}
            className="menu-btn"
            onClick={() => handleCreate(item.type)}
          >
            <span className="menu-btn-icon">{item.icon}</span>
            <span className="menu-btn-text">
              <span className="menu-btn-label">{item.label}</span>
              <span className="menu-btn-sub">{item.sub}</span>
            </span>
          </button>
        ))}
      </div>
    );
  }
);

LinkCreateMenu.displayName = 'LinkCreateMenu';
