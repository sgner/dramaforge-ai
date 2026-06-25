import React, { useCallback, useState } from 'react';
import { Menu, X, Undo2, Scissors, Maximize, Frame, Library, Settings, Moon, Sun } from 'lucide-react';
import { useCanvasStore } from './use-canvas-store';
import { CanvasTheme } from './types';
import { useI18n } from '../../i18n';

interface ToolbarProps {
  onUndo: () => void;
  onFitView: () => void;
  knifeMode: boolean;
  onToggleKnife: () => void;
  onOpenApiSettings?: () => void;
  onBack?: () => void;
}

export const CanvasToolbar: React.FC<ToolbarProps> = React.memo(
  ({ onUndo, onFitView, knifeMode, onToggleKnife, onOpenApiSettings, onBack }) => {
    const { t } = useI18n();
    const theme = useCanvasStore((s) => s.theme);
    const setTheme = useCanvasStore((s) => s.setTheme);
    const undoStack = useCanvasStore((s) => s.undoStack);
    const selected = useCanvasStore((s) => s.selected);
    const nodes = useCanvasStore((s) => s.nodes);
    const groupSelectedNodes = useCanvasStore((s) => s.groupSelectedNodes);
    const toggleAssetPanel = useCanvasStore((s) => s.toggleAssetPanel);
    const assetPanelOpen = useCanvasStore((s) => s.assetPanelOpen);
    const [collapsed, setCollapsed] = useState(false);

    const toggleTheme = useCallback(() => {
      setTheme(theme === 'light' ? 'dark' : 'light');
    }, [theme, setTheme]);

    const toggleCollapsed = useCallback(() => {
      setCollapsed((c) => !c);
    }, []);

    const canGroup = [...selected].some((id) => {
      const n = nodes.find((node) => node.id === id);
      return n && (n.type === 'image' || n.type === 'prompt');
    });

    return (
      <div className="canvas-topbar">
        <div className="canvas-panel canvas-nav">
          {onBack && (
            <button className="nav-back-btn" type="button" title={t('canvasToolbarBack')} onClick={onBack}>
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6"/></svg>
            </button>
          )}
          <div className="canvas-nav-meta">
            <div className="current-canvas-title">{t('canvasGateSmartCanvas')}</div>
          </div>
        </div>

        <div
          className={`canvas-panel canvas-toolbar toolbar ${collapsed ? 'collapsed' : ''}`}
        >
          <div className="toolbar-fixed">
            <button className="tool-btn" onClick={toggleCollapsed}>
              {collapsed ? <Menu size={14} /> : <X size={14} />}
            </button>
          </div>
          <div className="toolbar-items">
            <button
              className="tool-btn"
              onClick={onUndo}
              disabled={!undoStack.length}
              title={t('canvasToolbarUndo')}
            >
              <Undo2 size={14} /> {t('canvasToolbarUndo').split(' (')[0]}
            </button>
            <button
              className={`tool-btn ${knifeMode ? 'active' : ''}`}
              onClick={onToggleKnife}
              title={t('canvasToolbarKnife')}
            >
              <Scissors size={14} /> Knife
            </button>
            <button
              className="tool-btn"
              onClick={onFitView}
              title={`${t('canvasToolbarFitView')} (F)`}
            >
              <Maximize size={14} /> {t('canvasToolbarFitView')}
            </button>
            <button
              className="tool-btn"
              onClick={() => groupSelectedNodes()}
              disabled={!canGroup}
              title={t('canvasToolbarMergeGroup')}
            >
              <Frame size={14} /> {t('canvasToolbarGroup')}
            </button>
            <button
              className={`tool-btn ${assetPanelOpen ? 'active' : ''}`}
              onClick={() => toggleAssetPanel()}
              title={`${t('canvasToolbarAssets')} (A)`}
            >
              <Library size={14} /> {t('canvasToolbarAssets')}
            </button>
            {onOpenApiSettings && (
              <button
                className="tool-btn"
                onClick={onOpenApiSettings}
                title={t('canvasToolbarApiSettings')}
              >
                <Settings size={14} /> API
              </button>
            )}
            <button
              className={`tool-btn theme-toggle ${theme === 'dark' ? 'active' : ''}`}
              onClick={toggleTheme}
              title={t('canvasToolbarTheme')}
            >
              {theme === 'light' ? <Moon size={14} /> : <Sun size={14} />}
            </button>
          </div>
        </div>
      </div>
    );
  }
);

CanvasToolbar.displayName = 'CanvasToolbar';
