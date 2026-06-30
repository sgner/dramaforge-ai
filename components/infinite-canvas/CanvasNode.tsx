import React, { useCallback, useRef, useState } from 'react';
import { Loader2, Play, Check, X, Square, RotateCcw, BookOpen, FileText, Sparkles, Wand2, Save, Edit3, Eye, User, Mountain, Clapperboard, Theater } from 'lucide-react';
import { CanvasNode, NodeType, TaskType, AGENT_TYPE_META } from './types';
import { useCanvasStore } from './use-canvas-store';
import { estimatedNodeRect } from './engine';
import { useI18n } from '../../i18n';
import { getProviderForStep, getModelForStep, Provider as AIProvider } from '../../types';
import { continueStory } from '../../services/llmClient';

/* ===== 参考项目智能画布节点类型映射 =====
 * 参考项目只有三种节点类型：smart-image, smart-prompt, smart-loop
 * 本项目保留 image/prompt/loop 三种核心类型，其余类型统一映射
 */

interface NodeProps {
  node: CanvasNode;
  onDragStart: (id: string, e: React.MouseEvent) => void;
  onResizeStart: (id: string, e: React.MouseEvent) => void;
  onPortMouseDown: (id: string, kind: 'in' | 'out', e: React.MouseEvent) => void;
  onNodeDoubleClick?: (id: string, e: React.MouseEvent) => void;
  onNodeContextMenu?: (id: string, e: React.MouseEvent) => void;
  onOpenTemplate?: (nodeId: string) => void;
}

export const CanvasNodeComponent: React.FC<NodeProps> = React.memo(
  ({ node, onDragStart, onResizeStart, onPortMouseDown, onNodeDoubleClick, onNodeContextMenu, onOpenTemplate }) => {
    const { t } = useI18n();
    const selected = useCanvasStore((s) => s.selected.has(node.id));
    const updateNode = useCanvasStore((s) => s.updateNode);
    const removeNodes = useCanvasStore((s) => s.removeNodes);
    const cascadeNodeStatus = useCanvasStore((s) => s.cascadeNodeStatus);
    const rect = estimatedNodeRect(node);
    // 文本类节点（novel/script）总是显示高度，避免内容撑爆节点
    const isTextNode = node.type === 'novel' || node.type === 'script';
    const isSized = isTextNode || (node.h != null && node.h > 0);
    const cascadeStatus = cascadeNodeStatus.get(node.id);

    const style: React.CSSProperties = {
      left: rect.x,
      top: rect.y,
      width: rect.w,
      ...(isSized ? { height: rect.h } : {}),
    };

    const handleDelete = useCallback(
      (e: React.MouseEvent) => {
        e.stopPropagation();
        removeNodes([node.id]);
      },
      [node.id, removeNodes]
    );

    const handleMouseDown = useCallback(
      (e: React.MouseEvent) => {
        // 仅排除真正的交互元素，点击节点任何区域都应选中
        const target = e.target as HTMLElement;
        if (target.closest('.mini-x, .node-delete-btn, input, textarea, select, .node-resize-handle, .node-port, .node-drop, button')) return;
        e.stopPropagation();
        onDragStart(node.id, e);
      },
      [node.id, onDragStart]
    );

    const handleResizeMouseDown = useCallback(
      (e: React.MouseEvent) => {
        e.stopPropagation();
        onResizeStart(node.id, e);
      },
      [node.id, onResizeStart]
    );

    const handlePortInMouseDown = useCallback(
      (e: React.MouseEvent) => {
        e.stopPropagation();
        onPortMouseDown(node.id, 'in', e);
      },
      [node.id, onPortMouseDown]
    );

    const handlePortOutMouseDown = useCallback(
      (e: React.MouseEvent) => {
        e.stopPropagation();
        onPortMouseDown(node.id, 'out', e);
      },
      [node.id, onPortMouseDown]
    );

    const handleDoubleClick = useCallback(
      (e: React.MouseEvent) => {
        e.stopPropagation();
        onNodeDoubleClick?.(node.id, e);
      },
      [node.id, onNodeDoubleClick]
    );

    const handleContextMenu = useCallback(
      (e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        onNodeContextMenu?.(node.id, e);
      },
      [node.id, onNodeContextMenu]
    );

    // ===== 参考项目智能画布节点分类逻辑 =====
    const isPrompt = node.type === 'prompt';
    const isLoop = node.type === 'loop';
    const isGroupType = node.type === 'group';
    const isVideoNode = node.type === 'video';
    const isPipelineNode = node.type === 'pipeline';
    const isNovelNode = node.type === 'novel';
    const isScriptNode = node.type === 'script';
    const isImageNode = !isPrompt && !isLoop && !isGroupType && !isVideoNode && !isPipelineNode && !isNovelNode && !isScriptNode;
    const imgs = (node.images || []) as (string | { url: string; width?: number; height?: number })[];
    const hasImage = isImageNode && (node.url || imgs.length > 0);
    const isEmpty = isImageNode && !node.url && imgs.length === 0 && !node.running && !node._pending?.length;
    const isGroup = isImageNode && imgs.length > 1;

    // 参考项目标题逻辑
    const title = isGroupType ? t('canvasNodeGroup') : isPrompt ? t('canvasNodePrompt') : isLoop ? t('canvasNodeLoop') : isVideoNode ? t('canvasNodeVideo') : isPipelineNode ? t('canvasNodePipeline') : isNovelNode ? t('canvasNodeNovel') : isScriptNode ? t('canvasNodeScript') : (isGroup ? t('canvasNodeGroup') : hasImage ? t('canvasNodeImage') : t('canvasNodeUpload'));

    // 参考项目类名逻辑
    const nodeClass = [
      'image-node',
      isGroupType ? 'group-container-node' : '',
      isVideoNode ? 'video-node' : '',
      isPipelineNode ? 'pipeline-node' : '',
      isNovelNode ? 'novel-node' : '',
      isScriptNode ? 'script-node' : '',
      isEmpty ? 'empty-node' : '',
      isGroup ? 'group-node' : '',
      isPrompt ? 'prompt-smart-node' : '',
      isLoop ? 'loop-smart-node' : '',
      selected ? 'selected' : '',
      node.running ? 'node-running' : '',
      (node._pending?.length || 0) > 0 && !hasImage ? 'node-pending' : '',
    ].filter(Boolean).join(' ');

    // 参考项目hint逻辑
    const hint = isGroupType ? t('canvasHintDragMove') :
      isVideoNode
        ? (node.runStatus === 'running' ? t('canvasHintGenerating') : node.runStatus === 'failed' ? t('canvasHintPipelineFailed') : node.url ? t('canvasHintDragMove') : t('canvasHintVideoNode'))
      : isPipelineNode
        ? (node.runStatus === 'running' ? t('canvasHintPipelineRunning') : node.runStatus === 'failed' ? t('canvasHintPipelineFailed') : node.runStatus === 'done' ? t('canvasHintPipelineDone') : t('canvasHintPipeline'))
      : isNovelNode || isScriptNode
        ? t('canvasHintDragMove')
      : (node._pending?.length || 0) > 0 && !hasImage
      ? t('canvasHintGenerating')
      : isGroup
        ? t('canvasHintDragMove')
        : hasImage
          ? t('canvasHintDragMove')
          : t('canvasHintUpload');

    // 所有节点都显示 resize handle
    const showResize = true;

    return (
      <div
        className={nodeClass}
        style={style}
        data-id={node.id}
        onMouseDown={handleMouseDown}
        onDoubleClick={handleDoubleClick}
        onContextMenu={handleContextMenu}
      >
        {/* 删除按钮 - 右上角（运行时隐藏，避免误操作） */}
        {!node.running && (
          <button className="mini-x node-delete" type="button" title={t('canvasNodeDeleteTitle')} onClick={handleDelete}>
            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
          </button>
        )}

        {/* 运行计时pill */}
        {(node.running || (node._pending?.length || 0) > 0 || node.runFinishedAt) && !isPrompt && (
          <span className={`run-time-pill${!node.running && !(node._pending?.length) ? ' done' : ''}`}>
            {node.runElapsedMs ? `${Math.floor(Number(node.runElapsedMs) / 1000)}s` : '...'}
          </span>
        )}

        {/* node-body */}
        <div className="node-body" onWheel={(e) => e.stopPropagation()}>
          <NodeBody node={node} onOpenTemplate={onOpenTemplate} />
        </div>

        {/* node-hint */}
        <div className="node-hint">{hint}</div>

        {/* cascade status badge */}
        {cascadeStatus && (
          <div className={`cascade-status-badge ${cascadeStatus}`}>
            {cascadeStatus === 'queued' ? <Loader2 size={14} className="animate-spin" /> : cascadeStatus === 'running' ? <Play size={14} /> : cascadeStatus === 'done' ? <Check size={14} /> : <X size={14} />}
          </div>
        )}

        {/* resize handle */}
        {showResize && (
          <div className="node-resize-handle" onMouseDown={handleResizeMouseDown} />
        )}

        {/* ports */}
        <div className="node-port port-in" onMouseDown={handlePortInMouseDown} title={t('canvasNodePortIn')} />
        <div className="node-port port-out" onMouseDown={handlePortOutMouseDown} title={t('canvasNodePortOut')} />
      </div>
    );
  }
);

CanvasNodeComponent.displayName = 'CanvasNodeComponent';

/* ===== NodeBody: 根据节点类型渲染内容 ===== */
const NodeBody: React.FC<{
  node: CanvasNode;
  onOpenTemplate?: (nodeId: string) => void;
}> = React.memo(({ node, onOpenTemplate }) => {
  if (node.type === 'group') return <GroupNodeBody node={node} />;
  if (node.type === 'agent_node') return <AgentNodeBody node={node} />;
  if (node.type === 'prompt') return <PromptNodeBody node={node} onOpenTemplate={onOpenTemplate} />;
  if (node.type === 'loop') return <LoopNodeBody node={node} />;
  if (node.type === 'video') return <VideoNodeBody node={node} />;
  if (node.type === 'pipeline') return <PipelineNodeBody node={node} />;
  if (node.type === 'novel') return <NovelNodeBody node={node} />;
  if (node.type === 'script') return <ScriptNodeBody node={node} />;
  return <ImageNodeBody node={node} />;
});

NodeBody.displayName = 'NodeBody';

/* ===== Group Node (分组容器) ===== */
const GroupNodeBody: React.FC<{ node: CanvasNode }> = React.memo(({ node }) => {
  const { t } = useI18n();
  const count = (node.items || []).length;
  return (
    <div className="group-container-body">
      <div className="group-container-label">
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect width="7" height="7" x="3" y="3" rx="1"/><rect width="7" height="7" x="14" y="3" rx="1"/><rect width="7" height="7" x="14" y="14" rx="1"/><rect width="7" height="7" x="3" y="14" rx="1"/></svg>
        <span>{t('canvasNodeGroup')} ({count})</span>
      </div>
    </div>
  );
});

GroupNodeBody.displayName = 'GroupNodeBody';

/* ===== Image Node (上传/图片节点) - 参考项目 smart-image ===== */
const ImageNodeBody: React.FC<{ node: CanvasNode }> = React.memo(({ node }) => {
  const { t } = useI18n();
  const updateNode = useCanvasStore((s) => s.updateNode);
  const retryFailedAsset = useCanvasStore((s) => s.retryFailedAsset);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = useCallback(
    (files: FileList | null) => {
      if (!files || !files.length) return;
      const file = files[0];
      const url = URL.createObjectURL(file);
      const mediaKind = file.type.startsWith('video/') ? 'video' : file.type.startsWith('audio/') ? 'audio' : 'image';
      updateNode(node.id, { url, name: file.name, mediaKind });
    },
    [node.id, updateNode]
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      handleFileSelect(e.dataTransfer.files);
    },
    [handleFileSelect]
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
  }, []);

  const handleRemoveImage = useCallback(
    (index: number) => {
      const imgs = [...(node.images || [])];
      imgs.splice(index, 1);
      updateNode(node.id, { images: imgs });
    },
    [node.id, node.images, updateNode]
  );

  const imgs = (node.images || []) as (string | { url: string; width?: number; height?: number })[];

  // 资产元数据
  const assetPrompt = (node._assetPrompt as string) || '';
  const assetProviderName = (node._assetProviderName as string) || '';
  const assetModelId = (node._assetModelId as string) || '';
  const assetKind = (node._assetKind as string) || '';
  const hasAssetMeta = !!(assetPrompt || assetProviderName || assetModelId || assetKind);

  // 资产元数据（只读，展示当前生成信息）
  const renderAssetMeta = () => {
    if (!hasAssetMeta) return null;
    return (
      <div className="image-asset-panel">
        <div className="image-asset-panel-row">
          {assetKind && (
            <span className="image-asset-panel-kind">{t('canvasAssetKind_' + assetKind) || assetKind}</span>
          )}
          {assetProviderName && (
            <span className="image-asset-panel-provider" title={assetProviderName}>{assetProviderName}</span>
          )}
          {assetModelId && (
            <span className="image-asset-panel-model" title={assetModelId}>{assetModelId}</span>
          )}
        </div>
        {assetPrompt && (
          <div className="image-asset-panel-prompt" title={assetPrompt}>
            {assetPrompt}
          </div>
        )}
      </div>
    );
  };

  // 失败占位 - 提示词 + 错误 + 重试按钮
  if (node._assetFailed) {
    const errorMsg = (node._assetError as string) || '';
    return (
      <div className="image-failed-cell">
        <div className="image-failed-head">
          <span className="image-failed-icon">⚠</span>
          <span>{t('canvasPanelAssetFailedTitle')}</span>
        </div>
        {node._assetPrompt && (
          <div className="image-failed-prompt" title={node._assetPrompt as string}>
            {node._assetPrompt}
          </div>
        )}
        {errorMsg && (
          <div className="image-failed-err" title={errorMsg}>
            {errorMsg}
          </div>
        )}
        <button
          type="button"
          className="image-failed-retry"
          onClick={(e) => {
            e.stopPropagation();
            void retryFailedAsset(node.id);
          }}
        >
          {t('canvasPanelAssetFailedRetry')}
        </button>
      </div>
    );
  }

  // 有图片内容
  if (node.url || imgs.length > 0) {
    // 单张图片
    if (imgs.length <= 1 && node.url) {
      const mediaKind = (node.mediaKind as string) || 'image';
      return (
        <div>
          <div className="image-wrap" data-image-index="0">
            {mediaKind === 'video' ? (
              <video src={node.url} muted preload="metadata" playsInline className="node-img" />
            ) : mediaKind === 'audio' ? (
              <div className="media-audio-card">
                <div className="media-card-icon">
                  <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>
                </div>
                <div className="media-card-title">{node.name || 'Audio'}</div>
                <audio src={node.url} controls preload="metadata" />
              </div>
            ) : (
              <img src={node.url} alt="" draggable={false} className="node-img" />
            )}
            <button className="mini-x image-delete" type="button" title={t('canvasNodeDeleteImage')} data-image-index="0"
              onClick={(e) => { e.stopPropagation(); updateNode(node.id, { url: '', name: '', mediaKind: 'image' }); }}>
              <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>
            </button>
          </div>
          {renderAssetMeta()}
        </div>
      );
    }

    // 多张图片 - thumb-grid
    if (imgs.length > 1) {
      const cols = Math.min(4, Math.max(2, Math.ceil(Math.sqrt(imgs.length))));
      return (
        <div>
          <div className="thumb-grid" style={{ '--thumb-cols': cols } as React.CSSProperties}>
            {imgs.map((img, i) => {
              const src = typeof img === 'string' ? img : img.url;
              return (
                <div key={i} className="thumb-item" data-image-index={i}>
                  <img src={src} alt="" draggable={false} />
                  <button className="mini-x image-delete" type="button" title={t('canvasNodeDeleteImage')} data-image-index={i}
                    onClick={(e) => { e.stopPropagation(); handleRemoveImage(i); }}>
                    <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>
                  </button>
                </div>
              );
            })}
          </div>
          {renderAssetMeta()}
        </div>
      );
    }
  }

  // pending状态
  if (node._pending && node._pending.length > 0 && !node.url && imgs.length === 0) {
    const count = Math.max(1, node._pending.length);
    if (count <= 1) {
      return <div className="loading-cell single" />;
    }
    const cols = Math.min(4, Math.max(2, Math.ceil(Math.sqrt(count))));
    return (
      <div className="loading-skeleton" style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }}>
        {node._pending.map((p) => (
          <div key={p.id} className="loading-cell" />
        ))}
      </div>
    );
  }

  // 空上传节点 - node-drop
  return (
    <div
      className="node-drop"
      onClick={() => fileInputRef.current?.click()}
      onDrop={handleDrop}
      onDragOver={handleDragOver}
    >
      <span className="upload-node-main">
        <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242"/><path d="M12 12v9"/><path d="m16 16-4-4-4 4"/></svg>
      </span>
      <span className="upload-node-title">{t('canvasNodeUpload')}</span>
      <span className="upload-node-sub">{t('canvasHintUpload')}</span>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*,video/*,audio/*"
        multiple
        style={{ display: 'none' }}
        onChange={(e) => handleFileSelect(e.target.files)}
      />
    </div>
  );
});

ImageNodeBody.displayName = 'ImageNodeBody';

/* ===== Prompt Node (提示词节点) - 参考项目 smart-prompt ===== */
const PromptNodeBody: React.FC<{
  node: CanvasNode;
  onOpenTemplate?: (nodeId: string) => void;
}> = React.memo(({ node, onOpenTemplate }) => {
  const { t } = useI18n();
  const updateNode = useCanvasStore((s) => s.updateNode);
  const apiConfig = useCanvasStore((s) => s.apiConfig);
  const [llmEnabled, setLlmEnabled] = useState(Boolean(node.llmEnabled));
  const [llmSystemEnabled, setLlmSystemEnabled] = useState(Boolean(node.llmSystemEnabled));

  const enabledProviders = apiConfig.providers.filter(p => p.enabled);

  const handleTextChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      updateNode(node.id, { text: e.target.value });
    },
    [node.id, updateNode]
  );

  const handleLlmToggle = useCallback(() => {
    const newVal = !llmEnabled;
    setLlmEnabled(newVal);
    updateNode(node.id, { llmEnabled: newVal } as Partial<CanvasNode>);
  }, [llmEnabled, node.id, updateNode]);

  const handleSystemToggle = useCallback(() => {
    const newVal = !llmSystemEnabled;
    setLlmSystemEnabled(newVal);
    updateNode(node.id, { llmSystemEnabled: newVal } as Partial<CanvasNode>);
  }, [llmSystemEnabled, node.id, updateNode]);

  const handleLlmGenerate = useCallback(() => {
    updateNode(node.id, { runStatus: 'running' } as Partial<CanvasNode>);
    setTimeout(() => {
      updateNode(node.id, { runStatus: 'done' } as Partial<CanvasNode>);
    }, 1000);
  }, [node.id, updateNode]);

  return (
    <div className="prompt-node-card">
      <textarea
        className="prompt-node-text"
        value={node.text || ''}
        onChange={handleTextChange}
        placeholder={t('canvasPromptNodePlaceholder')}
        spellCheck={false}
        onMouseDown={(e) => e.stopPropagation()}
      />
      <div className="prompt-node-tools">
        {onOpenTemplate && (
          <button
            className="prompt-node-pill"
            type="button"
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => { e.stopPropagation(); onOpenTemplate(node.id); }}
            title={t('canvasPromptNodeTemplateLib')}
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20"/></svg>
            <span>{t('canvasPromptNodeTemplateLib')}</span>
          </button>
        )}
        <button
          className={`prompt-node-pill prompt-llm-toggle${llmEnabled ? ' active' : ''}`}
          type="button"
          onMouseDown={(e) => e.stopPropagation()}
          onClick={handleLlmToggle}
          title={t('canvasPromptNodeLlmGenerate')}
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2a4 4 0 0 0-4 4v2H6a2 2 0 0 0-2 2v10h16V10a2 2 0 0 0-2-2h-2V6a4 4 0 0 0-4-4z"/></svg>
          <span>LLM</span>
        </button>
      </div>
      {llmEnabled && (
        <div className="prompt-node-llm">
          <select
            className="prompt-node-control prompt-llm-provider"
            value={(node.llmProvider as string) || 'default'}
            onChange={(e) => { e.stopPropagation(); updateNode(node.id, { llmProvider: e.target.value } as Partial<CanvasNode>); }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <option value="default">{t('canvasComposerDefaultProvider')}</option>
            {enabledProviders.map(p => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
          <select
            className="prompt-node-control prompt-llm-model"
            value={(node.llmModel as string) || 'default'}
            onChange={(e) => { e.stopPropagation(); updateNode(node.id, { llmModel: e.target.value } as Partial<CanvasNode>); }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <option value="default">{t('canvasComposerDefaultModel')}</option>
          </select>
          <button
            className="prompt-node-pill prompt-system-toggle"
            type="button"
            onMouseDown={(e) => e.stopPropagation()}
            onClick={handleSystemToggle}
            style={{ gridColumn: '1 / -1' }}
          >
            <span>System Prompt</span>
            <span>{llmSystemEnabled ? 'ON' : 'OFF'}</span>
          </button>
          {llmSystemEnabled && (
            <textarea
              className="prompt-node-control prompt-llm-system"
              placeholder="System prompt..."
              value={(node.llmSystemPrompt as string) || ''}
              onChange={(e) => { e.stopPropagation(); updateNode(node.id, { llmSystemPrompt: e.target.value } as Partial<CanvasNode>); }}
              onMouseDown={(e) => e.stopPropagation()}
            />
          )}
          <textarea
            className="prompt-node-control prompt-llm-instruction"
            placeholder={t('canvasPromptNodeLlmPlaceholder')}
            value={(node.llmInstruction as string) || ''}
            onChange={(e) => { e.stopPropagation(); updateNode(node.id, { llmInstruction: e.target.value } as Partial<CanvasNode>); }}
            onMouseDown={(e) => e.stopPropagation()}
          />
          <div className="prompt-node-llm-actions">
            <button className="prompt-node-run prompt-node-control" type="button"
              onMouseDown={(e) => e.stopPropagation()} onClick={handleLlmGenerate}>
              <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z"/></svg>
              <span>{t('canvasPromptNodeRun')}</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
});

PromptNodeBody.displayName = 'PromptNodeBody';

/* ===== Loop Node (循环节点) - 参考项目 smart-loop ===== */
const LoopNodeBody: React.FC<{ node: CanvasNode }> = React.memo(({ node }) => {
  const { t } = useI18n();
  const updateNode = useCanvasStore((s) => s.updateNode);
  const nodes = useCanvasStore((s) => s.nodes);
  const connections = useCanvasStore((s) => s.connections);

  const count = Number(node.count || 1);
  const mode = (node.mode as string) || 'serial';
  const imageInput = Boolean(node.imageInput);
  const promptInput = Boolean(node.promptInput);
  const loopStart = Number(node.loopStart || 1);
  const imageBatchSize = Number(node.imageBatchSize || 1);
  const loopText = (node.loopText as string) || '';

  // 查找连接到此循环节点的提示词
  const inputPrompts = connections
    .filter(c => c.to === node.id)
    .map(c => nodes.find(n => n.id === c.from))
    .filter((n): n is CanvasNode => !!n && n.type === 'prompt' && !!n.text);

  const handleCountChange = useCallback(
    (delta: number) => {
      const newCount = Math.max(1, Math.min(100, count + delta));
      updateNode(node.id, { count: newCount });
    },
    [count, node.id, updateNode]
  );

  const handleCountInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const val = Math.max(1, Math.min(100, Number(e.target.value) || 1));
      updateNode(node.id, { count: val });
    },
    [node.id, updateNode]
  );

  const handleModeChange = useCallback(
    (newMode: string) => {
      updateNode(node.id, { mode: newMode });
    },
    [node.id, updateNode]
  );

  const handleToggleImage = useCallback(() => {
    updateNode(node.id, { imageInput: !imageInput });
  }, [imageInput, node.id, updateNode]);

  const handleTogglePrompt = useCallback(() => {
    updateNode(node.id, { promptInput: !promptInput });
  }, [promptInput, node.id, updateNode]);

  const handleTextChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      updateNode(node.id, { loopText: e.target.value });
    },
    [node.id, updateNode]
  );

  return (
    <div className={`loop-smart-card${loopText || inputPrompts.length ? ' has-prompt' : ''}`}>
      {/* 顶部行: 计数 + 并行/串行 */}
      <div className="loop-smart-row loop-smart-top">
        <div className="loop-smart-count">
          <button type="button" onClick={() => handleCountChange(-1)} onMouseDown={e => e.stopPropagation()}>
            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14"/></svg>
          </button>
          <input
            type="number"
            min={1}
            max={100}
            value={count}
            onChange={handleCountInputChange}
            onMouseDown={e => e.stopPropagation()}
          />
          <button type="button" onClick={() => handleCountChange(1)} onMouseDown={e => e.stopPropagation()}>
            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14"/><path d="M12 5v14"/></svg>
          </button>
        </div>
        <div className="loop-smart-seg">
          <button
            type="button"
            className={mode === 'serial' ? 'active' : ''}
            onClick={() => handleModeChange('serial')}
            onMouseDown={e => e.stopPropagation()}
          >
            {t('canvasLoopSerial')}
          </button>
          <button
            type="button"
            className={mode === 'parallel' ? 'active' : ''}
            onClick={() => handleModeChange('parallel')}
            onMouseDown={e => e.stopPropagation()}
          >
            {t('canvasLoopParallel')}
          </button>
        </div>
      </div>

      {/* 切换行: 图片输入 / 提示词输入 */}
      <div className="loop-smart-row">
        <button
          type="button"
          className={`loop-smart-toggle${imageInput ? ' active' : ''}`}
          onClick={handleToggleImage}
          onMouseDown={e => e.stopPropagation()}
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/></svg>
          <span>{t('canvasLoopImageInput')}</span>
        </button>
        <button
          type="button"
          className={`loop-smart-toggle${promptInput ? ' active' : ''}`}
          onClick={handleTogglePrompt}
          onMouseDown={e => e.stopPropagation()}
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/></svg>
          <span>{t('canvasLoopPromptInput')}</span>
        </button>
      </div>

      {/* 提示词面板 */}
      {(promptInput || inputPrompts.length > 0) && (
        <div className="loop-smart-panel prompt-panel">
          {inputPrompts.length > 0 && (
            <div className="loop-smart-prompt-list">
              {inputPrompts.map(p => (
                <div key={p.id} className="loop-smart-prompt-item" title={p.text}>
                  <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/></svg>
                  <span>{(p.text || '').slice(0, 40)}{(p.text || '').length > 40 ? '...' : ''}</span>
                </div>
              ))}
            </div>
          )}
          {promptInput && (
            <textarea
              className="loop-smart-text"
              placeholder={t('canvasLoopPromptPlaceholder')}
              value={loopText}
              onChange={handleTextChange}
              onMouseDown={e => e.stopPropagation()}
            />
          )}
        </div>
      )}

      {/* 底部提示 */}
      <div className="loop-smart-mini">
        <span>×{count}</span>
        <span>{mode === 'parallel' ? t('canvasLoopParallel') : t('canvasLoopSerial')}</span>
      </div>
    </div>
  );
});

LoopNodeBody.displayName = 'LoopNodeBody';

/* ===== Video Node (视频生成节点) ===== */
const VideoNodeBody: React.FC<{ node: CanvasNode }> = React.memo(({ node }) => {
  const { t } = useI18n();
  const updateNode = useCanvasStore((s) => s.updateNode);
  const runVideoGeneration = useCanvasStore((s) => s.runVideoGeneration);
  const apiConfig = useCanvasStore((s) => s.apiConfig);
  const nodes = useCanvasStore((s) => s.nodes);
  const connections = useCanvasStore((s) => s.connections);

  const enabledProviders = apiConfig.providers.filter(p => p.enabled);
  const providerId = (node.videoProviderId as string) || (enabledProviders[0]?.id ?? '');
  // 视频模型从 Provider.videoModels 获取（字符串数组）
  const selectedProviderForVideo = apiConfig.providers.find(p => p.id === providerId);
  const videoModels = selectedProviderForVideo?.videoModels || [];

  // 查找连接到当前节点的输入图片
  const inputImages = connections
    .filter(c => c.to === node.id)
    .map(c => nodes.find(n => n.id === c.from))
    .filter((n): n is NonNullable<typeof n> => !!n && n.type === 'image' && !!n.url);

  const modelId = (node.videoModelId as string) || '';
  const promptText = (node.text as string) || '';
  const isRunning = node.runStatus === 'running';
  const isFailed = node.runStatus === 'failed';

  const handleProviderChange = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    e.stopPropagation();
    updateNode(node.id, { videoProviderId: e.target.value, videoModelId: '' } as Partial<CanvasNode>);
  }, [node.id, updateNode]);

  const handleModelChange = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    e.stopPropagation();
    updateNode(node.id, { videoModelId: e.target.value } as Partial<CanvasNode>);
  }, [node.id, updateNode]);

  const handlePromptChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    e.stopPropagation();
    updateNode(node.id, { text: e.target.value } as Partial<CanvasNode>);
  }, [node.id, updateNode]);

  const handleRun = useCallback(() => {
    if (!providerId || !modelId || !promptText.trim()) return;
    runVideoGeneration(node.id, {
      prompt: promptText,
      providerId,
      modelId,
      inputImageUrls: inputImages.map(img => img.url!),
    });
  }, [node.id, providerId, modelId, promptText, inputImages, runVideoGeneration]);

  // 有视频结果时显示视频
  if (node.url && node.mediaKind === 'video' && !isRunning) {
    return (
      <div className="video-node-body">
        <div className="image-wrap" data-image-index="0">
          <video src={node.url} controls preload="metadata" className="node-img" />
          <button className="mini-x image-delete" type="button" title={t('canvasVideoClear')}
            onClick={(e) => { e.stopPropagation(); updateNode(node.id, { url: '', mediaKind: 'video', runStatus: undefined }); }}>
            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>
          </button>
        </div>
        {isFailed && node.runError && (
          <div className="video-node-error">{node.runError}</div>
        )}
      </div>
    );
  }

  // 生成中
  if (isRunning) {
    return (
      <div className="video-node-body video-node-loading">
        <div className="loading-cell single" />
        <div className="video-node-status">{node.runError || t('canvasHintGenerating')}</div>
      </div>
    );
  }

  // 配置面板
  return (
    <div className="video-node-body video-node-config" onMouseDown={(e) => e.stopPropagation()}>
      {/* 输入图片预览 */}
      {inputImages.length > 0 && (
        <div className="video-input-thumbs">
          {inputImages.slice(0, 4).map((img, i) => (
            <div key={img.id} className="video-input-thumb" title={t('canvasVideoInputThumb').replace('{0}', String(i + 1))}>
              <img src={img.url} alt="" draggable={false} />
            </div>
          ))}
          {inputImages.length > 4 && (
            <div className="video-input-more">+{inputImages.length - 4}</div>
          )}
        </div>
      )}

      {/* 提示词输入 */}
      <textarea
        className="video-node-prompt"
        placeholder={t('canvasVideoPromptPlaceholder')}
        value={promptText}
        onChange={handlePromptChange}
        onMouseDown={(e) => e.stopPropagation()}
        rows={3}
      />

      {/* 供应商和模型选择 */}
      <div className="video-node-controls">
        <select
          className="video-node-select"
          value={providerId}
          onChange={handleProviderChange}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <option value="">{t('canvasVideoSelectProvider')}</option>
          {enabledProviders.map(p => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
        <select
          className="video-node-select"
          value={modelId}
          onChange={handleModelChange}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <option value="">{t('canvasVideoSelectModel')}</option>
          {videoModels.map(m => (
            <option key={m} value={m}>{m}</option>
          ))}
        </select>
      </div>

      {/* 错误提示 */}
      {isFailed && node.runError && (
        <div className="video-node-error">{node.runError}</div>
      )}

      {/* 生成按钮 */}
      <button
        className="video-node-run"
        type="button"
        disabled={!providerId || !modelId || !promptText.trim()}
        onMouseDown={(e) => e.stopPropagation()}
        onClick={handleRun}
      >
        {t('canvasVideoBtnRun')}
      </button>
    </div>
  );
});

VideoNodeBody.displayName = 'VideoNodeBody';

/* ===== Pipeline Node (起始节点 — 小说/想法 → 资产) ===== */
const PipelineNodeBody: React.FC<{ node: CanvasNode }> = React.memo(({ node }) => {
  const { t } = useI18n();
  const updateNode = useCanvasStore((s) => s.updateNode);
  const runPipeline = useCanvasStore((s) => s.runPipeline);
  const stopPipeline = useCanvasStore((s) => s.stopPipeline);
  const toggleAssetPanel = useCanvasStore((s) => s.toggleAssetPanel);
  const setTaskAssets = useCanvasStore((s) => s.setTaskAssets);
  const assetPanelOpen = useCanvasStore((s) => s.assetPanelOpen);

  const PIPELINE_STYLES = [
    { value: 'Animation (2D)', label: t('canvasPipelineStyleAnimation') },
    { value: 'Cinematic Realistic', label: t('canvasPipelineStyleCinematic') },
    { value: 'Cyberpunk', label: t('canvasPipelineStyleCyberpunk') },
    { value: 'Watercolor', label: t('canvasPipelineStyleWatercolor') },
    { value: '3D Cartoon', label: t('canvasPipelineStyle3DCartoon') },
  ];
  const PIPELINE_LANGS = [
    { value: 'zh', label: t('canvasPipelineLangZh') },
    { value: 'en', label: t('canvasPipelineLangEn') },
    { value: 'ja', label: t('canvasPipelineLangJa') },
    { value: 'ko', label: t('canvasPipelineLangKo') },
  ];

  const inputText = (node.text as string) || '';
  const sourceType = (node._sourceType as 'novel' | 'idea') || 'novel';
  const style = (node._style as string) || 'Cinematic Realistic';
  const language = (node._language as string) || 'zh';
  const isRunning = node.runStatus === 'running';
  const isFailed = node.runStatus === 'failed';
  const isDone = node.runStatus === 'done';
  const isStopped = node.runStatus === 'stopped';
  const canResume = isStopped && !!(node._pipelineParams);
  const progress = (node._pipelineProgress as number) || 0;
  const stepName = (node._pipelineStep as string) || '';
  const logs = (node._pipelineLog as string[]) || [];
  const preview = (node._pipelinePreview as string) || '';
  const completedSteps = (node._pipelineCompletedSteps as string[]) || [];

  const handleTextChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    e.stopPropagation();
    updateNode(node.id, { text: e.target.value } as Partial<CanvasNode>);
  }, [node.id, updateNode]);

  const handleSourceChange = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    e.stopPropagation();
    updateNode(node.id, { _sourceType: e.target.value } as Partial<CanvasNode>);
  }, [node.id, updateNode]);

  const handleStyleChange = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    e.stopPropagation();
    updateNode(node.id, { _style: e.target.value } as Partial<CanvasNode>);
  }, [node.id, updateNode]);

  const handleLangChange = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    e.stopPropagation();
    updateNode(node.id, { _language: e.target.value } as Partial<CanvasNode>);
  }, [node.id, updateNode]);

  const handleRun = useCallback(() => {
    if (!inputText.trim()) return;
    // 新运行前清除断点状态
    updateNode(node.id, {
      _pipelineCompletedSteps: [],
      _pipelineStopped: false,
      _pipelineProcessedText: undefined,
      _pipelineScriptResult: undefined,
    } as Partial<CanvasNode>);
    // 清空资产库并打开资产库侧栏
    setTaskAssets([]);
    if (!assetPanelOpen) toggleAssetPanel();
    runPipeline(node.id, {
      inputText,
      sourceType,
      style: style as any,
      language: language as any,
    });
  }, [node.id, inputText, sourceType, style, language, runPipeline, updateNode, setTaskAssets, toggleAssetPanel, assetPanelOpen]);

  const handleStop = useCallback(() => {
    stopPipeline(node.id);
  }, [node.id, stopPipeline]);

  const handleResume = useCallback(() => {
    if (!node._pipelineParams) return;
    // 打开资产库侧栏展示后续生成
    if (!assetPanelOpen) toggleAssetPanel();
    runPipeline(node.id, node._pipelineParams as any);
  }, [node.id, runPipeline, node._pipelineParams, toggleAssetPanel, assetPanelOpen]);

  return (
    <div className="pipeline-node-body" onMouseDown={(e) => e.stopPropagation()}>
      {/* 标题 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', fontWeight: 600, color: 'var(--text)' }}>
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3v18"/><path d="M5 8l7-5 7 5"/><path d="M5 16l7 5 7-5"/></svg>
        <span>{t('canvasPipelineTitle')}</span>
      </div>

      {/* 输入类型选择 */}
      <div style={{ display: 'flex', gap: '6px' }}>
        <select
          className="video-node-select"
          value={sourceType}
          onChange={handleSourceChange}
          onMouseDown={(e) => e.stopPropagation()}
          style={{ flex: 1, fontSize: '11px', padding: '4px 6px' }}
          disabled={isRunning}
        >
          <option value="novel">{t('canvasPipelineInputNovel')}</option>
          <option value="idea">{t('canvasPipelineInputIdea')}</option>
        </select>
        <select
          className="video-node-select"
          value={style}
          onChange={handleStyleChange}
          onMouseDown={(e) => e.stopPropagation()}
          style={{ flex: 1, fontSize: '11px', padding: '4px 6px' }}
          disabled={isRunning}
        >
          {PIPELINE_STYLES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
        <select
          className="video-node-select"
          value={language}
          onChange={handleLangChange}
          onMouseDown={(e) => e.stopPropagation()}
          style={{ flex: 1, fontSize: '11px', padding: '4px 6px' }}
          disabled={isRunning}
        >
          {PIPELINE_LANGS.map(l => <option key={l.value} value={l.value}>{l.label}</option>)}
        </select>
      </div>

      {/* 文本输入 */}
      <textarea
        className="video-node-prompt"
        placeholder={sourceType === 'idea' ? t('canvasPipelinePlaceholderIdea') : t('canvasPipelinePlaceholderNovel')}
        value={inputText}
        onChange={handleTextChange}
        onMouseDown={(e) => e.stopPropagation()}
        rows={5}
        style={{ fontSize: '11px', minHeight: '80px', resize: 'none' }}
        disabled={isRunning}
      />

      {/* 运行中：进度条 + 日志 */}
      {isRunning && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: 'var(--muted)' }}>
            <span>{stepName}</span>
            <span>{progress}%</span>
          </div>
          <div style={{ height: '4px', background: 'var(--line)', borderRadius: '2px', overflow: 'hidden' }}>
            <div style={{ width: `${progress}%`, height: '100%', background: 'var(--accent)', transition: 'width 0.3s' }} />
          </div>
          {preview && (
            <div style={{ fontSize: '10px', color: 'var(--faint)', maxHeight: '30px', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {preview}
            </div>
          )}
        </div>
      )}

      {/* 已停止：显示断点信息 */}
      {isStopped && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <div style={{ fontSize: '11px', color: 'var(--warn, #d97706)', padding: '4px 6px', background: 'rgba(217,119,6,0.08)', borderRadius: '4px', display: 'flex', alignItems: 'center', gap: '4px' }}>
            <Square size={12} /> {t('canvasPipelineStoppedHint')}
          </div>
          {completedSteps.length > 0 && (
            <div style={{ fontSize: '10px', color: 'var(--muted)' }}>
              {t('canvasPipelineCompletedSteps').replace('{0}', String(completedSteps.length))} · {progress}%
            </div>
          )}
          <div style={{ height: '4px', background: 'var(--line)', borderRadius: '2px', overflow: 'hidden' }}>
            <div style={{ width: `${progress}%`, height: '100%', background: 'var(--warn, #d97706)', transition: 'width 0.3s' }} />
          </div>
        </div>
      )}

      {/* 日志 */}
      {logs.length > 0 && (
        <div style={{
          maxHeight: isRunning ? '80px' : '120px',
          overflowY: 'auto',
          fontSize: '10px',
          color: 'var(--muted)',
          background: 'var(--soft)',
          borderRadius: '4px',
          padding: '4px 6px',
          fontFamily: 'monospace',
          lineHeight: '1.4',
        }}>
          {logs.slice(-20).map((l, i) => (
            <div key={i} style={{ marginBottom: '2px' }}>{l}</div>
          ))}
        </div>
      )}

      {/* 错误提示 */}
      {isFailed && node.runError && (
        <div style={{ fontSize: '11px', color: 'var(--danger)', padding: '4px 6px', background: 'rgba(220,38,38,0.08)', borderRadius: '4px' }}>
          {node.runError}
        </div>
      )}

      {/* 完成提示 */}
      {isDone && !isRunning && (
        <div style={{ fontSize: '11px', color: 'var(--success)', padding: '4px 6px', background: 'rgba(22,163,74,0.08)', borderRadius: '4px', display: 'flex', alignItems: 'center', gap: '4px' }}>
          <Check size={12} /> {t('canvasPipelineDone')}
        </div>
      )}

      {/* 按钮组 */}
      <div style={{ display: 'flex', gap: '6px' }}>
        {/* 停止按钮（运行中显示） */}
        {isRunning && (
          <button
            className="video-node-run"
            type="button"
            onMouseDown={(e) => e.stopPropagation()}
            onClick={handleStop}
            style={{
              flex: 1,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '6px',
              background: 'rgba(220,38,38,0.1)',
              color: 'var(--danger)',
              borderColor: 'rgba(220,38,38,0.3)',
            }}
          >
            <Square size={12} /> {t('canvasPipelineBtnStop')}
          </button>
        )}

        {/* 继续按钮（已停止且可恢复时显示） */}
        {canResume && (
          <button
            className="video-node-run"
            type="button"
            onMouseDown={(e) => e.stopPropagation()}
            onClick={handleResume}
            style={{
              flex: 1,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '6px',
              background: 'rgba(22,163,74,0.1)',
              color: 'var(--success)',
              borderColor: 'rgba(22,163,74,0.3)',
            }}
          >
            <RotateCcw size={12} /> {t('canvasPipelineBtnResume')}
          </button>
        )}

        {/* 运行/重做按钮 */}
        {!isRunning && (
          <button
            className="video-node-run"
            type="button"
            disabled={!inputText.trim()}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={handleRun}
            style={{
              flex: 1,
              opacity: !inputText.trim() ? 0.5 : 1,
              cursor: !inputText.trim() ? 'not-allowed' : 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '6px',
            }}
          >
            {isDone ? <RotateCcw size={12} /> : <Play size={12} />}
            {isDone ? t('canvasPipelineBtnRedo') : isStopped ? t('canvasPipelineBtnRestart') : t('canvasPipelineBtnStart')}
          </button>
        )}
      </div>
    </div>
  );
});

PipelineNodeBody.displayName = 'PipelineNodeBody';

/* ===== Novel Node (小说渲染器 — 展示/编辑/续写/重写) ===== */
const NovelNodeBody: React.FC<{ node: CanvasNode }> = React.memo(({ node }) => {
  const { t } = useI18n();
  const updateNode = useCanvasStore((s) => s.updateNode);
  const apiConfig = useCanvasStore((s) => s.apiConfig);
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState((node.text as string) || '');
  const [aiRunning, setAiRunning] = useState(false);
  const [aiMode, setAiMode] = useState<'continue' | 'rewrite' | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const text = (node.text as string) || '';
  const charCount = text.length;
  const isGenerating = (node._assetProviderName as string) || (node._assetModelId as string);

  const handleEdit = useCallback(() => {
    setDraft(text);
    setIsEditing(true);
  }, [text]);

  const handleSave = useCallback(() => {
    updateNode(node.id, { text: draft } as Partial<CanvasNode>);
    setIsEditing(false);
  }, [node.id, draft, updateNode]);

  const handleCancel = useCallback(() => {
    setDraft(text);
    setIsEditing(false);
  }, [text]);

  const handleAIAction = useCallback(
    async (mode: 'continue' | 'rewrite') => {
      const sourceText = isEditing ? draft : text;
      if (!sourceText.trim()) return;

      const provider = getProviderForStep(apiConfig, 'preprocessing');
      const model = getModelForStep(apiConfig, 'preprocessing');
      if (!provider || !model) {
        alert(t('canvasNovelNoProvider'));
        return;
      }

      setAiRunning(true);
      setAiMode(mode);
      const abortController = new AbortController();
      abortRef.current = abortController;

      try {
        let newText = sourceText;
        if (mode === 'continue') {
          // 续写：在原文本后追加
          for await (const chunk of continueStory(provider, model, sourceText, abortController.signal)) {
            newText += chunk;
            updateNode(node.id, { text: newText } as Partial<CanvasNode>);
            if (isEditing) setDraft(newText);
          }
        } else {
          // 重写：使用 prompt 让 LLM 重写（这里我们用一个简单的 prompt）
          for await (const chunk of continueStory(provider, model, `[重写要求：基于以下内容重写]\n${sourceText}\n[重写后]`, abortController.signal)) {
            newText += chunk;
            updateNode(node.id, { text: newText } as Partial<CanvasNode>);
            if (isEditing) setDraft(newText);
          }
        }
      } catch (e: any) {
        if (e.name !== 'AbortError') {
          console.error('AI action failed:', e);
        }
      } finally {
        setAiRunning(false);
        setAiMode(null);
        abortRef.current = null;
      }
    },
    [node.id, text, draft, isEditing, apiConfig, updateNode, t]
  );

  const handleStopAI = useCallback(() => {
    if (abortRef.current) {
      abortRef.current.abort();
    }
  }, []);

  return (
    <div className="novel-node-body">
      {/* 标题栏 */}
      <div className="novel-node-head">
        <div className="novel-node-title">
          <BookOpen size={14} />
          <span>{node.title || t('canvasPipelineAssetNovel')}</span>
        </div>
        <div className="novel-node-count">
          {t('canvasPanelAssetChars').replace('{0}', String(charCount))}
        </div>
      </div>

      {/* 资产元数据 */}
      {(node._assetProviderName || node._assetModelId) && (
        <div className="novel-node-meta">
          {node._assetProviderName && (
            <span className="novel-node-meta-item" title={node._assetProviderName}>
              {node._assetProviderName}
            </span>
          )}
          {node._assetModelId && (
            <span className="novel-node-meta-item" title={node._assetModelId}>
              {node._assetModelId}
            </span>
          )}
        </div>
      )}

      {/* 内容区 */}
      {isEditing ? (
        <textarea
          className="novel-node-textarea"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onMouseDown={(e) => e.stopPropagation()}
          style={{ flex: 1, minHeight: 0 }}
        />
      ) : (
        <div className="novel-node-content">
          {text || (
            <div className="novel-node-empty">
              {t('canvasNovelEmpty')}
            </div>
          )}
        </div>
      )}

      {/* 底部操作栏 */}
      <div className="novel-node-actions">
        {isEditing ? (
          <>
            <button
              className="novel-node-btn"
              type="button"
              onMouseDown={(e) => e.stopPropagation()}
              onClick={handleSave}
            >
              <Save size={12} /> {t('canvasNovelBtnSave')}
            </button>
            <button
              className="novel-node-btn"
              type="button"
              onMouseDown={(e) => e.stopPropagation()}
              onClick={handleCancel}
            >
              <X size={12} /> {t('canvasNovelBtnCancel')}
            </button>
          </>
        ) : (
          <>
            <button
              className="novel-node-btn"
              type="button"
              onMouseDown={(e) => e.stopPropagation()}
              onClick={handleEdit}
              disabled={aiRunning}
            >
              <Edit3 size={12} /> {t('canvasNovelBtnEdit')}
            </button>
            {aiRunning && aiMode === 'continue' ? (
              <button
                className="novel-node-btn novel-node-btn-danger"
                type="button"
                onMouseDown={(e) => e.stopPropagation()}
                onClick={handleStopAI}
              >
                <Square size={12} /> {t('canvasNovelBtnStop')}
              </button>
            ) : (
              <button
                className="novel-node-btn"
                type="button"
                onMouseDown={(e) => e.stopPropagation()}
                onClick={() => handleAIAction('continue')}
                disabled={aiRunning || !text.trim()}
                title={t('canvasNovelBtnContinueHint')}
              >
                <Sparkles size={12} /> {t('canvasNovelBtnContinue')}
              </button>
            )}
            {aiRunning && aiMode === 'rewrite' ? (
              <button
                className="novel-node-btn novel-node-btn-danger"
                type="button"
                onMouseDown={(e) => e.stopPropagation()}
                onClick={handleStopAI}
              >
                <Square size={12} /> {t('canvasNovelBtnStop')}
              </button>
            ) : (
              <button
                className="novel-node-btn"
                type="button"
                onMouseDown={(e) => e.stopPropagation()}
                onClick={() => handleAIAction('rewrite')}
                disabled={aiRunning || !text.trim()}
                title={t('canvasNovelBtnRewriteHint')}
              >
                <Wand2 size={12} /> {t('canvasNovelBtnRewrite')}
              </button>
            )}
          </>
        )}
      </div>

      {/* AI 生成中提示 */}
      {aiRunning && (
        <div className="novel-node-ai-status">
          <Loader2 size={12} className="animate-spin" />
          <span>{aiMode === 'continue' ? t('canvasNovelAIContinuing') : t('canvasNovelAIRewriting')}</span>
        </div>
      )}
    </div>
  );
});

NovelNodeBody.displayName = 'NovelNodeBody';

/* ===== Script Node (脚本分析渲染器 — JSON 预览) ===== */
const ScriptNodeBody: React.FC<{ node: CanvasNode }> = React.memo(({ node }) => {
  const { t } = useI18n();
  const [activeTab, setActiveTab] = useState<'overview' | 'characters' | 'props' | 'scenes' | 'shots' | 'raw'>('overview');

  // 解析 JSON 数据
  const parseScript = (): any => {
    const raw = (node.text as string) || '';
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  };

  const script = parseScript();
  const characters = (script?.characters || []) as any[];
  const props = (script?.props || []) as any[];
  // 优先从顶层 sceneAssets 字段取；否则从 script[] 元素的 sceneAsset 取；
  // 都没有则从 bigShots[].sceneAsset 去重后取。
  const fromScriptElements = ((script?.script || []).filter((s: any) => s.sceneAsset).map((s: any) => s.sceneAsset)) as any[];
  const fromBigShots = (() => {
    const seen = new Set<string>();
    const result: any[] = [];
    for (const shot of (script?.bigShots || [])) {
      const sa = shot?.sceneAsset;
      if (sa && !seen.has(sa.mainStructure || sa.id || JSON.stringify(sa).slice(0, 50))) {
        seen.add(sa.mainStructure || sa.id || JSON.stringify(sa).slice(0, 50));
        result.push(sa);
      }
    }
    return result;
  })();
  const scenes: any[] = (Array.isArray(script?.sceneAssets) && script.sceneAssets.length > 0)
    ? script.sceneAssets
    : (fromScriptElements.length > 0 ? fromScriptElements : fromBigShots);
  const shots = (script?.bigShots || []) as any[];
  const visualSignature = script?.visualSignature as any;

  const counts = {
    characters: characters.length,
    props: props.length,
    scenes: scenes.length,
    shots: shots.length,
  };

  return (
    <div className="script-node-body">
      {/* 标题栏 */}
      <div className="script-node-head">
        <div className="script-node-title">
          <FileText size={14} />
          <span>{node.title || t('canvasPipelineAssetScript')}</span>
        </div>
      </div>

      {/* 资产元数据 */}
      {(node._assetProviderName || node._assetModelId) && (
        <div className="script-node-meta">
          {node._assetProviderName && (
            <span className="script-node-meta-item" title={node._assetProviderName}>
              {node._assetProviderName}
            </span>
          )}
          {node._assetModelId && (
            <span className="script-node-meta-item" title={node._assetModelId}>
              {node._assetModelId}
            </span>
          )}
        </div>
      )}

      {/* 概览卡片 */}
      <div className="script-node-overview">
        <div className="script-node-stat">
          <User size={12} />
          <span>{counts.characters}</span>
          <span className="script-node-stat-label">{t('canvasAssetKind_character')}</span>
        </div>
        <div className="script-node-stat">
          <Theater size={12} />
          <span>{counts.props}</span>
          <span className="script-node-stat-label">{t('canvasAssetKind_prop')}</span>
        </div>
        <div className="script-node-stat">
          <Mountain size={12} />
          <span>{counts.scenes}</span>
          <span className="script-node-stat-label">{t('canvasAssetKind_scene')}</span>
        </div>
        <div className="script-node-stat">
          <Clapperboard size={12} />
          <span>{counts.shots}</span>
          <span className="script-node-stat-label">{t('canvasAssetKind_storyboard')}</span>
        </div>
      </div>

      {/* 标签页 */}
      <div className="script-node-tabs">
        {[
          { id: 'overview', label: t('canvasScriptTabOverview') },
          { id: 'characters', label: t('canvasScriptTabCharacters') + ` (${counts.characters})` },
          { id: 'props', label: t('canvasScriptTabProps') + ` (${counts.props})` },
          { id: 'scenes', label: t('canvasScriptTabScenes') + ` (${counts.scenes})` },
          { id: 'shots', label: t('canvasScriptTabShots') + ` (${counts.shots})` },
          { id: 'raw', label: t('canvasScriptTabRaw') },
        ].map((tab) => (
          <button
            key={tab.id}
            className={`script-node-tab${activeTab === tab.id ? ' active' : ''}`}
            type="button"
            onMouseDown={(e) => e.stopPropagation()}
            onClick={() => setActiveTab(tab.id as any)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* 内容区 */}
      <div className="script-node-content">
        {!script ? (
          <div className="script-node-empty">
            {t('canvasScriptEmpty')}
          </div>
        ) : activeTab === 'overview' ? (
          <div className="script-node-overview-detail">
            {visualSignature && (
              <div className="script-node-section">
                <div className="script-node-section-title">{t('canvasScriptVisualSignature')}</div>
                <div className="script-node-section-content">
                  {visualSignature.medium && (
                    <div className="script-node-vsig-row">
                      <span className="script-node-vsig-label">{t('canvasScriptVsigMedium')}</span>
                      <span>{visualSignature.medium}</span>
                    </div>
                  )}
                  {visualSignature.aspectRatio && (
                    <div className="script-node-vsig-row">
                      <span className="script-node-vsig-label">{t('canvasScriptVsigAspectRatio')}</span>
                      <span>{visualSignature.aspectRatio}</span>
                    </div>
                  )}
                  {Array.isArray(visualSignature.colorIds) && visualSignature.colorIds.length > 0 && (
                    <div className="script-node-vsig-row">
                      <span className="script-node-vsig-label">{t('canvasScriptVsigColorIds')}</span>
                      <span>{visualSignature.colorIds.map((c: any) => `${c.entity}: ${c.hue}`).join(' / ')}</span>
                    </div>
                  )}
                  {visualSignature.coreTheme && (
                    <div className="script-node-vsig-row">
                      <span className="script-node-vsig-label">{t('canvasScriptVsigCoreTheme')}</span>
                      <span>{visualSignature.coreTheme}</span>
                    </div>
                  )}
                </div>
              </div>
            )}
            <div className="script-node-section">
              <div className="script-node-section-title">
                {t('canvasScriptTabCharacters')} ({counts.characters})
              </div>
              <div className="script-node-list">
                {characters.slice(0, 3).map((c, i) => (
                  <div key={i} className="script-node-list-item">
                    <strong>{c.name}</strong>
                    <span>{c.visualFeatures?.slice(0, 80) || ''}</span>
                  </div>
                ))}
                {characters.length > 3 && (
                  <div className="script-node-list-more">+{characters.length - 3}</div>
                )}
              </div>
            </div>
          </div>
        ) : activeTab === 'characters' ? (
          <div className="script-node-list">
            {characters.map((c, i) => (
              <div key={i} className="script-node-list-item">
                <strong>{c.name}</strong>
                <span>{c.visualFeatures || c.description || ''}</span>
              </div>
            ))}
            {characters.length === 0 && (
              <div className="script-node-empty">{t('canvasScriptEmpty')}</div>
            )}
          </div>
        ) : activeTab === 'props' ? (
          <div className="script-node-list">
            {props.map((p, i) => (
              <div key={i} className="script-node-list-item">
                <strong>{p.name}</strong>
                <span>{p.prompt || ''}</span>
              </div>
            ))}
            {props.length === 0 && (
              <div className="script-node-empty">{t('canvasScriptEmpty')}</div>
            )}
          </div>
        ) : activeTab === 'scenes' ? (
          <div className="script-node-list">
            {scenes.map((s, i) => (
              <div key={i} className="script-node-list-item">
                <strong>{s.mainStructure}</strong>
                <span>{s.prompt || ''}</span>
              </div>
            ))}
            {scenes.length === 0 && (
              <div className="script-node-empty">{t('canvasScriptEmpty')}</div>
            )}
          </div>
        ) : activeTab === 'shots' ? (
          <div className="script-node-list">
            {shots.map((s, i) => (
              <div key={i} className="script-node-list-item">
                <strong>{t('canvasPipelineDefaultShotName')} {s.id || i + 1}</strong>
                <span>{s.storyboardPrompt || s.description || ''}</span>
              </div>
            ))}
            {shots.length === 0 && (
              <div className="script-node-empty">{t('canvasScriptEmpty')}</div>
            )}
          </div>
        ) : (
          <pre className="script-node-raw">
            {JSON.stringify(script, null, 2)}
          </pre>
        )}
      </div>
    </div>
  );
});

ScriptNodeBody.displayName = 'ScriptNodeBody';

/* ===== Agent Node (agent 事件节点) ===== */
const STATUS_LABEL_AGENT: Record<string, string> = {
  pending: '○ 等待',
  running: '◐ 执行中',
  success: '● 成功',
  failed: '✕ 失败',
};

const AgentNodeBody: React.FC<{ node: CanvasNode }> = React.memo(({ node }) => {
  const taskType = (node._agentTaskType as TaskType) || 'goal';
  const status = (node._agentStatus as string) || 'pending';
  const label = (node._agentLabel as string) || '';
  const payload = (node._agentPayload as Record<string, any>) || {};
  const meta = AGENT_TYPE_META[taskType] || AGENT_TYPE_META.goal;
  const isArtifact = taskType === 'artifact';
  const isPlan = taskType === 'plan';
  const isQuestion = taskType === 'question';
  const isImage = isArtifact && payload.kind === 'image' && typeof payload.url === 'string';
  const isText = isArtifact && payload.kind === 'text' && typeof payload.snippet === 'string';

  return (
    <div
      data-testid="agent-node-body"
      style={{
        minWidth: 0,
        background: '#ffffff',
        border: `2px solid ${meta.color}`,
        borderRadius: 10,
        padding: 10,
        fontFamily: 'ui-sans-serif, system-ui, sans-serif',
        fontSize: 12,
        boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 6,
        }}
      >
        <span
          data-testid={`task-graph-node-badge-${taskType}`}
          style={{
            fontSize: 10,
            padding: '2px 6px',
            background: meta.color,
            color: 'white',
            borderRadius: 4,
            fontWeight: 600,
            letterSpacing: 0.3,
          }}
        >
          {meta.icon} {meta.label}
        </span>
        <AgentStatusBadge status={status} color={meta.color} />
      </div>
      <div
        data-testid="task-graph-node-label"
        style={{
          fontWeight: 600,
          color: '#0f172a',
          marginBottom: 6,
          wordBreak: 'break-word',
        }}
      >
        {label || '—'}
      </div>
      {isImage && (
        <img
          src={payload.url}
          alt={label}
          style={{ width: '100%', height: 'auto', borderRadius: 6, marginTop: 4, display: 'block' }}
        />
      )}
      {isText && (
        <div
          data-testid="task-graph-node-text-snippet"
          style={{
            fontSize: 11,
            color: '#475569',
            background: 'rgba(0,0,0,0.03)',
            padding: 6,
            borderRadius: 4,
            maxHeight: 80,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {String(payload.snippet).slice(0, 200)}
        </div>
      )}
      {isPlan && Array.isArray(payload.plan) && (
        <ol style={{ margin: 0, paddingLeft: 18, fontSize: 11, color: '#334155' }}>
          {payload.plan.slice(0, 8).map((step: any, i: number) => (
            <li key={i} data-testid={`task-graph-node-plan-step-${i}`} style={{ marginBottom: 2 }}>
              <code style={{ fontSize: 10 }}>{step.tool || step.name || `step ${i + 1}`}</code>
            </li>
          ))}
        </ol>
      )}
      {isQuestion && (
        <div
          data-testid="task-graph-node-question"
          style={{
            fontSize: 11,
            color: '#b45309',
            background: 'rgba(245,158,11,0.08)',
            padding: 6,
            borderRadius: 4,
            border: '1px dashed rgba(245,158,11,0.4)',
            marginTop: 4,
          }}
        >
          ⚠ 等待用户回答
        </div>
      )}
    </div>
  );
});
AgentNodeBody.displayName = 'AgentNodeBody';

const AgentStatusBadge: React.FC<{ status: string; color: string }> = ({ status }) => {
  const testId = `task-graph-node-status-${status}`;
  const bg =
    status === 'running' ? 'rgba(14,165,233,0.15)' :
    status === 'success' ? 'rgba(16,185,129,0.15)' :
    status === 'failed' ? 'rgba(239,68,68,0.15)' :
    'rgba(148,163,184,0.15)';
  const fg =
    status === 'running' ? '#0369a1' :
    status === 'success' ? '#047857' :
    status === 'failed' ? '#b91c1c' :
    '#475569';
  return (
    <span
      data-testid={testId}
      style={{
        fontSize: 9,
        padding: '2px 6px',
        background: bg,
        color: fg,
        borderRadius: 4,
        fontFamily: 'ui-monospace, monospace',
      }}
    >
      {STATUS_LABEL_AGENT[status] || status}
    </span>
  );
};
AgentStatusBadge.displayName = 'AgentStatusBadge';
