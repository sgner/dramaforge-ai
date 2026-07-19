import React, { useCallback, useState, useEffect } from 'react';
import { Trash2, Palette, FileText, Pencil } from 'lucide-react';
import { CanvasInfo } from './types';
import { uid } from './types';
import { useI18n } from '../../i18n';
import { api } from '../../services/apiClient';
import { toast } from '../../utils/toast';

// 项目列表走 FastAPI + SQLite（数据本身在 DB）。
// 用户偏好（trash 列表 / 当前画布 id / 画布 emoji）也走 FastAPI user_preferences。
// 唯一保留在 localStorage 的是首屏"立即可用"缓存，避免首屏闪烁。
const CURRENT_CANVAS_KEY = 'dramaforge-current-canvas-id';
const DELETED_CANVAS_IDS_KEY = 'dramaforge-deleted-canvas-ids';
const CANVAS_EMOJI_KEY = 'dramaforge-canvas-emoji';
const PREF_KEY_DELETED = 'deleted_canvas_ids';
const PREF_KEY_CURRENT = 'current_canvas_id';
const PREF_KEY_EMOJI = 'canvas_emoji';

interface BackendProject {
  id: string;
  name: string;
  created_at: string;
  updated_at: string;
  viewport: { x: number; y: number; scale: number };
  /** 后端在 listProjects 时不返回 node_count（避免 N+1），前端用 0 占位 */
  node_count?: number;
}

function loadDeletedIds(): Set<string> {
  try {
    const raw = localStorage.getItem(DELETED_CANVAS_IDS_KEY);
    if (!raw) return new Set();
    return new Set(JSON.parse(raw));
  } catch {
    return new Set();
  }
}

function saveDeletedIdsLocal(ids: Set<string>) {
  try {
    localStorage.setItem(DELETED_CANVAS_IDS_KEY, JSON.stringify(Array.from(ids)));
  } catch {}
}

function loadCurrentCanvasId(): string | null {
  try {
    return localStorage.getItem(CURRENT_CANVAS_KEY);
  } catch {
    return null;
  }
}

function saveCurrentCanvasIdLocal(id: string) {
  try {
    localStorage.setItem(CURRENT_CANVAS_KEY, id);
  } catch {}
}

function loadEmojiMap(): Record<string, string> {
  try {
    const raw = localStorage.getItem(CANVAS_EMOJI_KEY);
    if (!raw) return {};
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function saveEmojiMapLocal(map: Record<string, string>) {
  try {
    localStorage.setItem(CANVAS_EMOJI_KEY, JSON.stringify(map));
  } catch {}
}

const EMOJIS = ['📄', '🎨', '🎬', '📸', '🖼', '✨', '🌟', '💡', '🎭', '🔮', '📐', '🎪'];

interface CanvasGateProps {
  onOpenCanvas: (id: string) => void;
  onNewCanvas: () => void;
}

export const CanvasGate: React.FC<CanvasGateProps> = React.memo(({ onOpenCanvas, onNewCanvas }) => {
  const { t } = useI18n();
  // 数据源：后端 /api/projects（不再用 localStorage 存项目列表）
  const [canvases, setCanvases] = useState<CanvasInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [trashMode, setTrashMode] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [emojiPickerId, setEmojiPickerId] = useState<string | null>(null);
  // 软删除（trash）的 id 集合，存 localStorage（id 而非数据，丢了只是恢复时多显示已删除项）
  const [deletedIds, setDeletedIds] = useState<Set<string>>(loadDeletedIds);

  // 1) 挂载时从后端拉项目列表 + 用户偏好
  useEffect(() => {
    let mounted = true;
    setLoading(true);
    Promise.all([
      api.listProjects(),
      // 3 个偏好的批量读：deleted / current / emoji
      api.getUserPreference(PREF_KEY_DELETED).catch(() => ({ value: null })),
      api.getUserPreference(PREF_KEY_EMOJI).catch(() => ({ value: null })),
    ])
      .then(([rows, deletedPref, emojiPref]) => {
        if (!mounted) return;
        const list: CanvasInfo[] = (rows || []).map((p) => ({
          id: p.id,
          title: p.name,
          emoji: '',
          updatedAt: new Date(p.updated_at).getTime(),
          nodeCount: p.node_count ?? 0,
        }));
        setCanvases(list);
        // 偏好：deleted ids
        if (Array.isArray(deletedPref?.value)) {
          const ids = new Set<string>(deletedPref.value);
          setDeletedIds(ids);
          saveDeletedIdsLocal(ids);
        }
        // 偏好：emoji map
        if (emojiPref?.value && typeof emojiPref.value === 'object') {
          const map = emojiPref.value as Record<string, string>;
          setCanvases(prev => prev.map(c => ({ ...c, emoji: map[c.id] || c.emoji })));
          saveEmojiMapLocal(map);
        }
        setLoadError(null);
      })
      .catch((e) => {
        if (!mounted) return;
        console.error('[CanvasGate] load failed', e);
        setLoadError(e?.message || 'failed to load projects');
        setCanvases([]);
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, []);

  // 软删除 id 同步：localStorage 兜底 + 后端主存
  useEffect(() => {
    saveDeletedIdsLocal(deletedIds);
    api.setUserPreference(PREF_KEY_DELETED, Array.from(deletedIds))
      .catch((e) => console.warn('[CanvasGate] setUserPreference(deleted) failed', e));
  }, [deletedIds]);

  const activeCanvases = canvases.filter(c => !deletedIds.has(c.id) && !trashMode);
  const deletedCanvases = canvases.filter(c => deletedIds.has(c.id));

  const handleCreate = useCallback(async () => {
    try {
      const created = await api.createProjectWithId(uid('cv'), t('canvasGateSmartCanvas') || 'Untitled');
      const newCanvas: CanvasInfo = {
        id: created.id,
        title: created.name,
        emoji: '',
        updatedAt: new Date(created.updated_at).getTime(),
        nodeCount: 0,
      };
      setCanvases(prev => [newCanvas, ...prev]);
      // 如果这个 id 在 deletedIds 里（之前被软删过），从软删集合里移除
      setDeletedIds(prev => {
        if (!prev.has(newCanvas.id)) return prev;
        const next = new Set(prev);
        next.delete(newCanvas.id);
        return next;
      });
      saveCurrentCanvasIdLocal(newCanvas.id);
      api.setUserPreference(PREF_KEY_CURRENT, newCanvas.id)
        .catch((e) => console.warn('[CanvasGate] setUserPreference(current) failed', e));
      onNewCanvas();
    } catch (e: any) {
      console.error('[CanvasGate] createProject failed', e);
      toast.error('创建项目失败：' + (e?.message || 'unknown error'));
    }
  }, [onNewCanvas, t]);

  const handleOpen = useCallback((id: string) => {
    saveCurrentCanvasId(id);
    onOpenCanvas(id);
  }, [onOpenCanvas]);

  // 软删除：数据仍保留在后端（listProjects 还能查到），只在本地记录"已删除"
  // 这样切浏览器后再次拉取，trash 列表里仍能看到
  const handleDelete = useCallback((id: string) => {
    setDeletedIds(prev => {
      const next = new Set(prev);
      next.add(id);
      return next;
    });
    setDeleteConfirmId(null);
  }, []);

  const handleRestore = useCallback((id: string) => {
    setDeletedIds(prev => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }, []);

  // 永久删除：调用后端硬删 API（不可恢复）
  const handlePermanentDelete = useCallback(async (id: string) => {
    try {
      await api.deleteProject(id);
      setCanvases(prev => prev.filter(c => c.id !== id));
      setDeletedIds(prev => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    } catch (e: any) {
      console.error('[CanvasGate] deleteProject failed', e);
      toast.error('永久删除失败：' + (e?.message || 'unknown error'));
    }
  }, []);

  const handleTitleEdit = useCallback(async (id: string, title: string) => {
    // 乐观更新：先改本地 state，再调 API
    setCanvases(prev => prev.map(c =>
      c.id === id ? { ...c, title, updatedAt: Date.now() } : c
    ));
    setEditingId(null);
    try {
      await api.updateProject(id, { name: title });
    } catch (e: any) {
      console.error('[CanvasGate] updateProject (rename) failed', e);
    }
  }, []);

  const handleEmojiChange = useCallback((id: string, emoji: string) => {
    // emoji map 走 user_preferences[canvas_emoji]（id → emoji 映射）
    // localStorage 作为首屏快速缓存（避免闪烁）
    let nextMap: Record<string, string> = {};
    try {
      const raw = localStorage.getItem(CANVAS_EMOJI_KEY) || '{}';
      nextMap = JSON.parse(raw) as Record<string, string>;
    } catch {}
    nextMap[id] = emoji;
    saveEmojiMapLocal(nextMap);
    api.setUserPreference(PREF_KEY_EMOJI, nextMap)
      .catch((e) => console.warn('[CanvasGate] setUserPreference(emoji) failed', e));
    setCanvases(prev => prev.map(c =>
      c.id === id ? { ...c, emoji, updatedAt: Date.now() } : c
    ));
    setEmojiPickerId(null);
  }, []);

  // 挂载时把 localStorage 里的 emoji map 合并到 canvases state
  useEffect(() => {
    try {
      const raw = localStorage.getItem('dramaforge-canvas-emoji');
      if (!raw) return;
      const map = JSON.parse(raw) as Record<string, string>;
      setCanvases(prev => prev.map(c => ({ ...c, emoji: map[c.id] || c.emoji })));
    } catch {}
  }, [canvases.length === 0]);

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
            <button
              className="gate-create-btn"
              onClick={() => handleCreate('classic')}
              disabled={loading || !!loadError}
              data-testid="canvas-gate-create"
            >
              + {t('canvasGateInfiniteCanvas')}
            </button>
            <button
              className="gate-create-btn smart"
              onClick={() => handleCreate('smart')}
              disabled={loading || !!loadError}
              data-testid="canvas-gate-create-smart"
            >
              + {t('canvasGateSmartCanvas')}
            </button>
          </div>
        )}

        <div className="gate-canvas-list">
          {loading && (
            <div className="gate-empty" data-testid="canvas-gate-loading">从后端加载项目列表…</div>
          )}
          {!loading && loadError && (
            <div className="gate-empty" data-testid="canvas-gate-error" style={{ color: 'var(--danger, #dc2626)' }}>
              ⚠ 后端加载失败：{loadError}
              <br />
              <span style={{ fontSize: 11, color: 'var(--muted)' }}>
                请确认 FastAPI 后端在 8765 端口运行（python -m uvicorn app.main:app --port 8765）
              </span>
            </div>
          )}
          {!loading && !loadError && displayList.length === 0 && (
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
