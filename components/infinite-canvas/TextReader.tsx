/**
 * TextReader — 通用文本资产阅读器（小说 / 脚本）
 *
 * 核心功能：
 * - 阅读模式：大字号舒适排版（小说衬线、脚本等宽），分章节
 * - 编辑模式：textarea 全屏可编辑
 * - 保存：调用 onSave(body) 持久化
 * - 关闭：调用 onClose
 *
 * 双模切换：read ↔ edit，编辑未保存有脏标记，关闭时提示
 */

import React, { useEffect, useMemo, useState } from 'react';
import { X, Edit3, Save, BookOpen, FileText, Eye, AlertTriangle, RefreshCw } from 'lucide-react';
import { TaskAssetRef, computeTextStats } from './use-canvas-store';

export type TextReaderKind = 'novel' | 'script';

export interface TextReaderProps {
  /** 要阅读/编辑的文本资产 */
  asset: TaskAssetRef;
  /** 打开时初始模式：read | edit */
  initialMode?: 'read' | 'edit';
  /** 保存后回调（持久化由调用方完成） */
  onSave: (body: string) => Promise<void> | void;
  /** 关闭回调 */
  onClose: () => void;
}

type Mode = 'read' | 'edit';

export const TextReader: React.FC<TextReaderProps> = ({ asset, initialMode = 'read', onSave, onClose }) => {
  const isNovel = asset.kind === 'novel';
  const isScript = asset.kind === 'script';
  const KindIcon = isNovel ? BookOpen : FileText;

  const [mode, setMode] = useState<Mode>(initialMode);
  const [body, setBody] = useState<string>(asset.body || '');
  const [savedBody, setSavedBody] = useState<string>(asset.body || '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmingClose, setConfirmingClose] = useState(false);

  const dirty = body !== savedBody;
  const stats = useMemo(() => computeTextStats(body), [body]);

  // 关键修复：脚本（script）头部 stats 优先从结构化 JSON（extra.script）读取。
  // 之前完全依赖 markdown 文本正则计算 chapter/scenes，导致：
  //   - "章" 把 H3 子标题（### 角色 / ### 画面 / ### 对白）误算进去，6 场就有 18 个 H3 + 1 H1 = 19 章
  //   - 实际脚本不分章，"19 章"对用户完全无意义
  // 修复后：脚本不再显示"章"；"场"和"角色"优先用结构化 JSON 计数。
  const structuredScript = useMemo(() => {
    const ext = (asset as any).extra;
    return ext && typeof ext === 'object' && ext.script && typeof ext.script === 'object'
      ? ext.script
      : null;
  }, [asset]);
  // 同步资产切换：每次换 asset 重新读取 body
  useEffect(() => {
    setBody(asset.body || '');
    setSavedBody(asset.body || '');
    setMode(initialMode);
    setError(null);
  }, [asset.id, asset.body]);

  // ESC 关闭 / Ctrl+S 保存
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (confirmingClose) return;
        e.preventDefault();
        handleClose();
      } else if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        if (mode === 'edit' && dirty && !saving) handleSave();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mode, dirty, saving, confirmingClose, body]);

  const handleSave = async () => {
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      await onSave(body);
      setSavedBody(body);
    } catch (e: any) {
      setError(e?.message || '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const handleClose = () => {
    if (dirty && !confirmingClose) {
      setConfirmingClose(true);
      return;
    }
    onClose();
  };

  const handleDiscardAndClose = () => {
    setBody(savedBody);
    onClose();
  };

  return (
    <div
      className="text-reader-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) handleClose();
      }}
      onWheel={(e) => e.stopPropagation()}
      onTouchMove={(e) => e.stopPropagation()}
    >
      <div className="text-reader-panel" onMouseDown={(e) => e.stopPropagation()}>
        {/* Header */}
        <header className="text-reader-header">
          <div className="text-reader-title">
            <KindIcon className="w-5 h-5" />
            <div>
              <div className="text-reader-title-main">{asset.title || asset.name || (isNovel ? '未命名小说' : '未命名脚本')}</div>
              <div className="text-reader-sub">
                {isNovel ? '小说' : '脚本'} ·
                {' '}{stats.words.toLocaleString()} 字 ·
                {isScript
                  ? (
                      // 脚本：优先显示结构化 JSON 统计（场次/角色/道具/分镜），
                      // 不显示"章"（脚本不分章，markdown H3 是子标题不是章）。
                      structuredScript
                        ? (
                            <>
                              {Array.isArray(structuredScript.scenes) && structuredScript.scenes.length > 0
                                ? ` ${structuredScript.scenes.length} 场 ·`
                                : ''}
                              {Array.isArray(structuredScript.characters) && structuredScript.characters.length > 0
                                ? ` ${structuredScript.characters.length} 角色 ·`
                                : ''}
                            </>
                          )
                        : (stats.scenes > 0 ? ` ${stats.scenes} 场 ·` : '')
                    )
                  : (stats.chapters > 0 ? ` ${stats.chapters} 章 ·` : '')}
                {dirty ? ' 未保存' : ' 已保存'}
              </div>
            </div>
          </div>

          <div className="text-reader-actions">
            {mode === 'read' ? (
              <button
                className="text-reader-btn text-reader-btn-primary"
                onClick={() => setMode('edit')}
                title="进入编辑模式（也可按 Ctrl+E）"
              >
                <Edit3 className="w-4 h-4" /> 编辑
              </button>
            ) : (
              <>
                <button
                  className="text-reader-btn"
                  onClick={() => {
                    if (dirty) {
                      setBody(savedBody);
                    } else {
                      setMode('read');
                    }
                  }}
                  disabled={saving}
                  title="放弃修改并返回阅读模式"
                >
                  <Eye className="w-4 h-4" /> 预览
                </button>
                <button
                  className="text-reader-btn text-reader-btn-primary"
                  onClick={handleSave}
                  disabled={!dirty || saving}
                  title="保存（Ctrl+S）"
                >
                  {saving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                  {saving ? '保存中…' : '保存'}
                </button>
              </>
            )}
            <button
              className="text-reader-btn text-reader-btn-icon"
              onClick={handleClose}
              title="关闭（ESC）"
              aria-label="关闭"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </header>

        {error && (
          <div className="text-reader-error">
            <AlertTriangle className="w-4 h-4" />
            {error}
          </div>
        )}

        {/* Body */}
        <div className={`text-reader-body ${isScript ? 'is-script' : 'is-novel'} ${mode}`}>
          {mode === 'read' ? (
            <ReadView body={body} isScript={isScript} />
          ) : (
            <textarea
              className="text-reader-textarea"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder={isNovel ? '在此输入小说正文…' : '在此输入脚本正文…'}
              spellCheck={false}
            />
          )}
        </div>

        {/* Footer */}
        <footer className="text-reader-footer">
          <span className="text-reader-footer-hint">
            {mode === 'read' ? '阅读模式' : '编辑模式'} · Ctrl+S 保存 · ESC 关闭
          </span>
          {dirty && mode === 'edit' && (
            <span className="text-reader-footer-dirty">● 未保存</span>
          )}
        </footer>

        {/* Close confirm dialog */}
        {confirmingClose && (
          <div className="text-reader-confirm-backdrop" onClick={() => setConfirmingClose(false)}>
            <div className="text-reader-confirm" onClick={(e) => e.stopPropagation()}>
              <div className="text-reader-confirm-title">有未保存的修改</div>
              <div className="text-reader-confirm-desc">确定要放弃修改并关闭吗？</div>
              <div className="text-reader-confirm-actions">
                <button className="text-reader-btn" onClick={() => setConfirmingClose(false)}>继续编辑</button>
                <button
                  className="text-reader-btn text-reader-btn-danger"
                  onClick={handleDiscardAndClose}
                >
                  放弃修改
                </button>
                <button
                  className="text-reader-btn text-reader-btn-primary"
                  onClick={async () => {
                    await handleSave();
                    if (!error) onClose();
                  }}
                  disabled={saving}
                >
                  保存并关闭
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

// ============ Read view ============

/**
 * 阅读视图：把 markdown 风格的章节/场景切分成块，按格式排版
 * - 小说：衬线字体、大行距、段间空行
 * - 脚本：等宽字体、场次标题加粗、内嵌提示词
 */
const ReadView: React.FC<{ body: string; isScript: boolean }> = ({ body, isScript }) => {
  if (!body.trim()) {
    return <div className="text-reader-empty">（暂无内容）</div>;
  }

  // 按 #/##/### 标题 + 段落切分
  const blocks = useMemo(() => splitByHeadings(body), [body]);

  return (
    <div className="text-reader-read">
      {blocks.map((b, i) => {
        if (b.type === 'h1') return <h1 key={i} className="text-reader-h1">{b.text}</h1>;
        if (b.type === 'h2') return <h2 key={i} className="text-reader-h2">{b.text}</h2>;
        if (b.type === 'h3') return <h3 key={i} className="text-reader-h3">{b.text}</h3>;
        // 段落
        if (isScript) {
          // 脚本：识别 "角色：台词" 格式
          return <ScriptParagraph key={i} text={b.text} />;
        }
        return <p key={i} className="text-reader-p">{b.text}</p>;
      })}
    </div>
  );
};

const ScriptParagraph: React.FC<{ text: string }> = ({ text }) => {
  // 匹配 "角色名：" 开头的对话行
  const dialogue = /^([^：\n]{1,12})：([\s\S]+)$/m;
  const match = text.match(dialogue);
  if (match) {
    return (
      <div className="text-reader-script-line">
        <div className="text-reader-script-role">{match[1]}</div>
        <div className="text-reader-script-text">{match[2].trim()}</div>
      </div>
    );
  }
  // 动作描写（普通段落）
  return <div className="text-reader-script-action">{text}</div>;
};

type Block = { type: 'h1' | 'h2' | 'h3' | 'p'; text: string };

function splitByHeadings(body: string): Block[] {
  const lines = body.split(/\n/);
  const out: Block[] = [];
  let cur: string[] = [];
  const flush = (type: Block['type']) => {
    const text = cur.join('\n').trim();
    if (text) out.push({ type, text });
    cur = [];
  };
  for (const line of lines) {
    if (/^###\s+/.test(line)) {
      flush('p');
      out.push({ type: 'h3', text: line.replace(/^###\s+/, '').trim() });
    } else if (/^##\s+/.test(line)) {
      flush('p');
      out.push({ type: 'h2', text: line.replace(/^##\s+/, '').trim() });
    } else if (/^#\s+/.test(line)) {
      flush('p');
      out.push({ type: 'h1', text: line.replace(/^#\s+/, '').trim() });
    } else {
      cur.push(line);
    }
  }
  // 剩余
  const text = cur.join('\n').trim();
  if (text) {
    // 拆段（空行分段）
    const paragraphs = text.split(/\n\s*\n/);
    for (const p of paragraphs) {
      const t = p.trim();
      if (t) out.push({ type: 'p', text: t });
    }
  }
  return out;
}
