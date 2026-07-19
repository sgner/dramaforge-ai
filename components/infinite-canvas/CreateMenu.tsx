import React, { useCallback } from 'react';
import { NodeType } from './types';
import { useCanvasStore, createNode } from './use-canvas-store';
import { screenToWorld } from './engine';
import { useI18n } from '../../i18n';

interface CreateMenuProps {
  open: boolean;
  x: number;
  y: number;
  boardRect: DOMRect | null;
  onClose: () => void;
}

/* ===== 参考项目智能画布创建菜单 - 五个选项 ===== */
export const CreateMenu: React.FC<CreateMenuProps> = React.memo(
  ({ open, x, y, boardRect, onClose }) => {
    const { t } = useI18n();
    const addNode = useCanvasStore((s) => s.addNode);
    const viewport = useCanvasStore((s) => s.viewport);

    const MENU_ITEMS: { type: NodeType; label: string; sub: string; icon: React.ReactNode }[] = [
      {
        type: 'pipeline',
        label: t('canvasMenuPipeline'),
        sub: t('canvasMenuPipelineSub'),
        icon: (
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3v18"/><path d="M5 8l7-5 7 5"/><path d="M5 16l7 5 7-5"/></svg>
        ),
      },
      {
        type: 'image',
        label: t('canvasMenuImage'),
        sub: t('canvasMenuImageSub'),
        icon: (
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242"/><path d="M12 12v9"/><path d="m16 16-4-4-4 4"/></svg>
        ),
      },
      {
        type: 'video',
        label: t('canvasMenuVideo'),
        sub: t('canvasMenuVideoSub'),
        icon: (
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m22 8-6 4 6 4V8Z"/><rect width="14" height="12" x="2" y="6" rx="2" ry="2"/></svg>
        ),
      },
      {
        type: 'script',
        label: t('canvasMenuScript'),
        sub: t('canvasMenuScriptSub'),
        icon: (
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="9" x2="15" y1="13" y2="13"/><line x1="9" x2="15" y1="17" y2="17"/></svg>
        ),
      },
      {
        type: 'novel',
        label: t('canvasMenuNovel'),
        sub: t('canvasMenuNovelSub'),
        icon: (
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>
        ),
      },
      {
        type: 'prompt',
        label: t('canvasMenuPrompt'),
        sub: t('canvasMenuPromptSub'),
        icon: (
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/><line x1="16" x2="8" y1="13" y2="13"/><line x1="16" x2="8" y1="17" y2="17"/><line x1="10" x2="8" y1="9" y2="9"/></svg>
        ),
      },
      {
        type: 'loop',
        label: t('canvasMenuLoop'),
        sub: t('canvasMenuLoopSub'),
        icon: (
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect width="8" height="8" x="3" y="3" rx="2"/><path d="M7 11v4a2 2 0 0 0 2 2h4"/><rect width="8" height="8" x="13" y="13" rx="2"/></svg>
        ),
      },
    ];

    const handleAdd = useCallback(
      (type: NodeType) => {
        if (!boardRect) return;
        const wp = screenToWorld(x, y, boardRect, viewport);
        const node = createNode(type, { x: wp.x, y: wp.y });
        addNode(node);
        onClose();
      },
      [x, y, boardRect, viewport, addNode, onClose]
    );

    if (!open) return null;

    return (
      <div
        className="create-menu open"
        style={{ left: x, top: y }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="create-menu-grid">
          {MENU_ITEMS.map((item) => (
            <button
              key={item.type}
              className="create-card"
              onClick={() => handleAdd(item.type)}
            >
              <div className="create-card-icon">{item.icon}</div>
              <div>
                <div className="create-card-title">{item.label}</div>
                <div className="create-card-sub">{item.sub}</div>
              </div>
            </button>
          ))}
        </div>
      </div>
    );
  }
);

CreateMenu.displayName = 'CreateMenu';
