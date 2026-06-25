import React, { useCallback, useState, useEffect } from 'react';
import { Trash2, Palette, FileText, Pencil } from 'lucide-react';
import { CanvasInfo } from './types';
import { uid } from './types';
import { useI18n } from '../../i18n';

const CANVAS_LIST_KEY = 'dramaforge-canvas-list';
const CURRENT_CANVAS_KEY = 'dramaforge-current-canvas-id';

function loadCanvasList(): CanvasInfo[] {
  try {
    const raw = localStorage.getItem(CANVAS_LIST_KEY);
    if (!raw) return [];
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

function saveCanvasList(list: CanvasInfo[]) {
  try {
    localStorage.setItem(CANVAS_LIST_KEY, JSON.stringify(list));
  } catch {}
}

function loadCurrentCanvasId(): string | null {
  try {
    return localStorage.getItem(CURRENT_CANVAS_KEY);
  } catch {
    return null;
  }
}

function saveCurrentCanvasId(id: string) {
  try {
    localStorage.setItem(CURRENT_CANVAS_KEY, id);
  } catch {}
}

const EMOJIS = ['📄', '🎨', '🎬', '📸', '🖼', '✨', '🌟', '💡', '🎭', '🔮', '📐', '🎪'];

interface CanvasGateProps {
  onOpenCanvas: (id: string) => void;
  onNewCanvas: () => void;
}

export const CanvasGate: React.FC<CanvasGateProps> = React.memo(({ onOpenCanvas, onNewCanvas }) => {
  const { t } = useI18n();
  const [canvases, setCanvases] = useState<CanvasInfo[]>(loadCanvasList);
  const [trashMode, setTrashMode] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [emojiPickerId, setEmojiPickerId] = useState<string | null>(null);

  useEffect(() => {
    saveCanvasList(canvases);
  }, [canvases]);

  const activeCanvases = canvases.filter(c => !c.deleted && !trashMode);
  const deletedCanvases = canvases.filter(c => c.deleted);

  const handleCreate = useCallback(() => {
    const newCanvas: CanvasInfo = {
      id: uid('cv'),
      title: t('canvasGateSmartCanvas'),
      emoji: '',
      updatedAt: Date.now(),
      nodeCount: 0,
    };
    setCanvases(prev => [newCanvas, ...prev]);
    saveCurrentCanvasId(newCanvas.id);
    onNewCanvas();
  }, [onNewCanvas]);

  const handleOpen = useCallback((id: string) => {
    saveCurrentCanvasId(id);
    onOpenCanvas(id);
  }, [onOpenCanvas]);

  const handleDelete = useCallback((id: string) => {
    setCanvases(prev => prev.map(c =>
      c.id === id ? { ...c, deleted: true, updatedAt: Date.now() } : c
    ));
    setDeleteConfirmId(null);
  }, []);

  const handleRestore = useCallback((id: string) => {
    setCanvases(prev => prev.map(c =>
      c.id === id ? { ...c, deleted: false, updatedAt: Date.now() } : c
    ));
  }, []);

  const handlePermanentDelete = useCallback((id: string) => {
    setCanvases(prev => prev.filter(c => c.id !== id));
  }, []);

  const handleTitleEdit = useCallback((id: string, title: string) => {
    setCanvases(prev => prev.map(c =>
      c.id === id ? { ...c, title, updatedAt: Date.now() } : c
    ));
    setEditingId(null);
  }, []);

  const handleEmojiChange = useCallback((id: string, emoji: string) => {
    setCanvases(prev => prev.map(c =>
      c.id === id ? { ...c, emoji, updatedAt: Date.now() } : c
    ));
    setEmojiPickerId(null);
  }, []);

  const displayList = trashMode ? deletedCanvases : activeCanvases;

  return (
    <div className="canvas-gate">
      <div className="gate-panel">
        <div className="gate-head">
          <div className="gate-title">
            {trashMode ? <><Trash2 size={14} /> {t('canvasGateTrashMode')}</> : <><Palette size={14} /> {t('canvasGateCanvasMode')}</>}
          </div>
          <div className="gate-subtitle">
            {trashMode
              ? t('canvasGateDeletedCount').replace('{0}', String(deletedCanvases.length))
              : t('canvasGateActiveCount').replace('{0}', String(activeCanvases.length))
            }
          </div>
        </div>

        {!trashMode && (
          <div className="gate-create-row">
            <button className="gate-create-btn" onClick={() => handleCreate('classic')}>
              + {t('canvasGateInfiniteCanvas')}
            </button>
            <button className="gate-create-btn smart" onClick={() => handleCreate('smart')}>
              + {t('canvasGateSmartCanvas')}
            </button>
          </div>
        )}

        <div className="gate-canvas-list">
          {displayList.length === 0 && (
            <div className="gate-empty">
              {trashMode ? t('canvasGateTrashEmpty') : t('canvasGateEmpty')}
            </div>
          )}
          {displayList.map(canvas => (
            <div
              key={canvas.id}
              className="canvas-item"
              onClick={() => trashMode ? undefined : handleOpen(canvas.id)}
            >
              <div className="canvas-preview-mark">{canvas.emoji || <FileText size={14} />}</div>
              <div className="canvas-card-info">
                {editingId === canvas.id ? (
                  <input
                    className="canvas-card-title-input"
                    value={editTitle}
                    onChange={(e) => setEditTitle(e.target.value)}
                    onBlur={() => handleTitleEdit(canvas.id, editTitle)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleTitleEdit(canvas.id, editTitle);
                      if (e.key === 'Escape') setEditingId(null);
                    }}
                    autoFocus
                    onClick={(e) => e.stopPropagation()}
                  />
                ) : (
                  <div className="canvas-card-title">{canvas.title}</div>
                )}
                <div className="canvas-card-meta">
                  <span className="canvas-kind-chip">{t('canvasGateSmartChip')}</span>
                  <span>{t('canvasGateNodeCount').replace('{0}', String(canvas.nodeCount))}</span>
                  <span>{new Date(canvas.updatedAt).toLocaleDateString()}</span>
                </div>
              </div>
              <div className="canvas-card-actions">
                {!trashMode && (
                  <>
                    <button
                      className="canvas-card-edit"
                      title={t('canvasGateEditTitle')}
                      onClick={(e) => {
                        e.stopPropagation();
                        setEditingId(canvas.id);
                        setEditTitle(canvas.title);
                      }}
                    >
                      <Pencil size={14} />
                    </button>
                    <button
                      className="canvas-card-emoji"
                      title={t('canvasGateSelectIcon')}
                      onClick={(e) => {
                        e.stopPropagation();
                        setEmojiPickerId(emojiPickerId === canvas.id ? null : canvas.id);
                      }}
                    >
                      {canvas.emoji || <FileText size={14} />}
                    </button>
                    {deleteConfirmId === canvas.id ? (
                      <div className="canvas-delete-confirm">
                        <button onClick={(e) => { e.stopPropagation(); handleDelete(canvas.id); }}>{t('canvasGateDelete')}</button>
                        <button onClick={(e) => { e.stopPropagation(); setDeleteConfirmId(null); }}>{t('canvasGateCancel')}</button>
                      </div>
                    ) : (
                      <button
                        className="canvas-delete"
                        title={t('canvasGateDelete')}
                        onClick={(e) => {
                          e.stopPropagation();
                          setDeleteConfirmId(canvas.id);
                        }}
                      >
                        <Trash2 size={14} />
                      </button>
                    )}
                  </>
                )}
                {trashMode && (
                  <>
                    <button
                      className="canvas-restore"
                      onClick={(e) => { e.stopPropagation(); handleRestore(canvas.id); }}
                    >
                      {t('canvasGateRestore')}
                    </button>
                    <button
                      className="canvas-delete"
                      onClick={(e) => { e.stopPropagation(); handlePermanentDelete(canvas.id); }}
                    >
                      {t('canvasGatePermanentDelete')}
                    </button>
                  </>
                )}
              </div>
              {emojiPickerId === canvas.id && (
                <div className="emoji-picker" onClick={(e) => e.stopPropagation()}>
                  {EMOJIS.map(emoji => (
                    <button
                      key={emoji}
                      className="emoji-option"
                      onClick={() => handleEmojiChange(canvas.id, emoji)}
                    >
                      {emoji}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>

        <div className="gate-footer">
          {deletedCanvases.length > 0 && (
            <button
              className="gate-trash-btn"
              onClick={() => setTrashMode(!trashMode)}
            >
              <Trash2 size={14} /> {trashMode ? t('canvasGateBackToList') : t('canvasGateTrashCount').replace('{0}', String(deletedCanvases.length))}
            </button>
          )}
        </div>
      </div>
    </div>
  );
});

CanvasGate.displayName = 'CanvasGate';
