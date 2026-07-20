import React, { useCallback, useRef, useState } from 'react';
import { Loader2, Play, Check, X, Square, RotateCcw, BookOpen, FileText, Sparkles, Wand2, Save, Edit3, Eye, User, Mountain, Clapperboard, Theater } from 'lucide-react';
import { CanvasNode, NodeType } from './types';
import { useCanvasStore } from './use-canvas-store';
import { estimatedNodeRect } from './engine';
import { useI18n } from '../../i18n';
import { getProviderForStep, getModelForStep, Provider as AIProvider } from '../../types';
import { continueStory } from '../../services/llmClient';
import { uploadImageWithPreview } from '../../services/apiClient';
import { toast } from '../../utils/toast';

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
    const isPrompt = node.type === 'prompt' || node.type === 'promptGroup';
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
  if (node.type === 'prompt' || node.type === 'promptGroup') {
    return <PromptNodeBody node={node} onOpenTemplate={onOpenTemplate} />;
  }
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

/* ===== 媒体自适应：图片/视频加载完成后，按实际宽高比调整节点高度 =====
 * 触发时机：img onLoad / video onLoadedMetadata
 * 公式：newH = wrap宽度 × (媒体高/媒体宽) + chrome（节点其余部分高度，实测）
 * 注意：world 容器用的是 CSS transform: scale()，不影响布局——
 * offsetWidth/scrollHeight 返回的就是世界坐标单位，绝不能再除以 viewport.scale，
 * 否则缩放 < 1 时高度会被放大 1/scale 倍（agent 模式自动缩放下 Composer 浮窗被推得很远）。
 * 同时把宽高比 (_imgAspect) 与 chrome (_imgChrome) 存到节点上，供 resize 保比例使用。
 */
function useMediaAutoFit(node: CanvasNode) {
  const updateNode = useCanvasStore((s) => s.updateNode);
  const lastFitRef = useRef<{ url: string; w: number; h: number } | null>(null);

  const fitMedia = useCallback(
    (mediaEl: HTMLElement, naturalW: number, naturalH: number) => {
      if (!naturalW || !naturalH || !node.url) return;
      const wrapEl = mediaEl.closest('.image-wrap') as HTMLElement | null;
      const bodyEl = mediaEl.closest('.node-body') as HTMLElement | null;
      if (!wrapEl || !bodyEl) return;
      const wrapW = wrapEl.offsetWidth;
      if (wrapW <= 0) return;
      // chrome = body 内容高度 - 媒体 wrap 高度（asset meta 面板、错误条等）。
      // 注意：必须测 .node-body（高度 auto，恒等于内容高度），不能测 .image-node——
      // 节点被 style height 固定后其 scrollHeight 返回的是盒子高度而非内容高度，
      // 一旦 node.h 因故偏大（如历史持久化数据），错误高度会自我延续、永远纠正不回来。
      // 另：world 容器是 CSS transform: scale()，不影响布局，offsetWidth/scrollHeight
      // 本身就是世界坐标单位，绝不能再除以 viewport.scale。
      const extra = Math.max(0, bodyEl.offsetHeight - wrapEl.offsetHeight);
      let newH = wrapW * (naturalH / naturalW) + extra;
      newH = Math.min(1200, Math.max(96, newH));
      // 防重复：同 url + 同宽度 + 同计算结果则跳过
      const last = lastFitRef.current;
      if (last && last.url === node.url && Math.abs(last.w - node.w) < 1 && Math.abs(last.h - newH) < 1) return;
      // 与当前高度差 < 4px 也跳过，避免无效 setState
      if (node.h != null && Math.abs(node.h - newH) < 4) return;
      lastFitRef.current = { url: node.url, w: node.w, h: newH };
      updateNode(node.id, {
        h: newH,
        _imgAspect: naturalH / naturalW,
        _imgChrome: extra,
      } as Partial<CanvasNode>);
    },
    [node.id, node.url, node.w, node.h, updateNode]
  );

  // ref 回调：挂载时媒体若已就绪（缓存命中、HMR 复用等不再触发 onLoad 的场景），
  // 立即重新测量一次——这是历史遗留的过大 node.h 能自我校正的关键路径。
  const mediaRef = useCallback(
    (el: HTMLImageElement | HTMLVideoElement | null) => {
      if (!el) return;
      if (el instanceof HTMLImageElement) {
        if (el.complete && el.naturalWidth > 0) fitMedia(el, el.naturalWidth, el.naturalHeight);
      } else if (el.readyState >= 1) {
        fitMedia(el, el.videoWidth, el.videoHeight);
      }
    },
    [fitMedia]
  );

  return { fitMedia, mediaRef };
}

/* ===== Image Node (上传/图片节点) - 参考项目 smart-image ===== */
const ImageNodeBody: React.FC<{ node: CanvasNode }> = React.memo(({ node }) => {
  const { t } = useI18n();
  const updateNode = useCanvasStore((s) => s.updateNode);
  const retryFailedAsset = useCanvasStore((s) => s.retryFailedAsset);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { fitMedia, mediaRef } = useMediaAutoFit(node);

  const handleFileSelect = useCallback(
    (files: FileList | null) => {
      if (!files || !files.length) return;
      const file = files[0];
      const mediaKind = file.type.startsWith('video/') ? 'video' : file.type.startsWith('audio/') ? 'audio' : 'image';
      if (mediaKind === 'image') {
        // blob: URL 仅用于即时预览；后台上传到后端后替换为 /files/ 真实 URL，
        // 否则图生图时后端取不到图片内容，上游会 400"至少需要一张图片"。
        const url = uploadImageWithPreview(file, (backendUrl) => {
          updateNode(node.id, { url: backendUrl });
        });
        updateNode(node.id, { url, name: file.name, mediaKind });
      } else {
        const url = URL.createObjectURL(file);
        updateNode(node.id, { url, name: file.name, mediaKind });
      }
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
              <video src={node.url} muted preload="metadata" playsInline className="node-img" ref={mediaRef}
                onLoadedMetadata={(e) => fitMedia(e.currentTarget, e.currentTarget.videoWidth, e.currentTarget.videoHeight)} />
            ) : mediaKind === 'audio' ? (
              <div className="media-audio-card">
                <div className="media-card-icon">
                  <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>
                </div>
                <div className="media-card-title">{node.name || 'Audio'}</div>
                <audio src={node.url} controls preload="metadata" />
              </div>
            ) : (
              <img src={node.url} alt="" draggable={false} className="node-img" ref={mediaRef}
                onLoad={(e) => fitMedia(e.currentTarget, e.currentTarget.naturalWidth, e.currentTarget.naturalHeight)} />
            )}
            <button className="mini-x image-replace" type="button" title={t('canvasNodeReplaceImage')}
              onClick={(e) => { e.stopPropagation(); fileInputRef.current?.click(); }}>
              <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12a9 9 0 1 1-2.64-6.36"/><path d="M21 3v6h-6"/></svg>
            </button>
            <button className="mini-x image-delete" type="button" title={t('canvasNodeDeleteImage')} data-image-index="0"
              onClick={(e) => { e.stopPropagation(); updateNode(node.id, { url: '', name: '', mediaKind: 'image' }); }}>
              <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>
            </button>
            {/* 重新选择图片：有图状态下也能唤起文件选择器（空状态的 input 不渲染） */}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*,video/*,audio/*"
              style={{ display: 'none' }}
              onClick={(e) => { e.currentTarget.value = ''; }}
              onChange={(e) => handleFileSelect(e.target.files)}
            />
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
  const { fitMedia, mediaRef } = useMediaAutoFit(node);

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
          <video src={node.url} controls preload="metadata" className="node-img" ref={mediaRef}
            onLoadedMetadata={(e) => fitMedia(e.currentTarget, e.currentTarget.videoWidth, e.currentTarget.videoHeight)} />
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
  const taskAssets = useCanvasStore((s) => s.taskAssets);
  const openTextReader = useCanvasStore((s) => s.openTextReader);
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState((node.text as string) || '');
  const [aiRunning, setAiRunning] = useState(false);
  const [aiMode, setAiMode] = useState<'continue' | 'rewrite' | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const text = (node.text as string) || '';

  // 关联的资产（如果有 _assetId，优先从资产读取 body）
  const linkedAssetId = (node._assetId as string) || '';
  const linkedAsset = linkedAssetId ? taskAssets.find(a => a.id === linkedAssetId) : undefined;
  const body = linkedAsset?.body ?? text;
  const charCount = body.length;
  const isGenerating = (node._assetProviderName as string) || (node._assetModelId as string);

  const handleOpenReader = useCallback(() => {
    if (linkedAsset) {
      openTextReader(linkedAsset);
    } else if (text) {
      // 旧数据没有资产关联：用 text 临时构造虚拟资产
      openTextReader({
        id: node.id,
        kind: 'novel',
        title: (node.title as string) || '',
        name: (node.title as string) || '',
        url: '',
        body: text,
      });
    }
  }, [linkedAsset, text, node.id, node.title, openTextReader]);

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
        toast.warning(t('canvasNovelNoProvider'));
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
        <div
          className="novel-node-content"
          onClick={(e) => {
            e.stopPropagation();
            handleOpenReader();
          }}
          title="点击打开阅读器（拖动节点可移动）"
        >
          {body || (
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
              className="novel-node-btn novel-node-btn-primary"
              type="button"
              onMouseDown={(e) => e.stopPropagation()}
              onClick={handleOpenReader}
              disabled={aiRunning}
              title="打开阅读器查看/编辑完整正文"
            >
              <BookOpen size={12} /> 阅读
            </button>
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
export const formatVisualSignatureColors = (colors: unknown[]): string => (
  colors
    .map((color) => {
      if (typeof color === 'string') return color.trim();
      if (!color || typeof color !== 'object') return '';
      const item = color as Record<string, unknown>;
      const entity = String(item.entity ?? item.name ?? '').trim();
      const hue = String(item.hue ?? item.color ?? '').trim();
      return entity && hue ? `${entity}: ${hue}` : entity || hue;
    })
    .filter(Boolean)
    .join(' / ')
);

const ScriptNodeBody: React.FC<{ node: CanvasNode }> = React.memo(({ node }) => {
  const { t } = useI18n();
  const taskAssets = useCanvasStore((s) => s.taskAssets);
  const openTextReader = useCanvasStore((s) => s.openTextReader);
  const [activeTab, setActiveTab] = useState<'overview' | 'characters' | 'props' | 'scenes' | 'shots' | 'raw'>('overview');

  // 关联的资产（如果有 _assetId，优先从资产读取 body；否则回退到 node.text）
  const linkedAssetId = (node._assetId as string) || '';
  const linkedAsset = linkedAssetId ? taskAssets.find(a => a.id === linkedAssetId) : undefined;
  const text = (linkedAsset?.body ?? (node.text as string)) || '';
  const charCount = text.length;

  const handleOpenReader = useCallback(() => {
    if (linkedAsset) {
      openTextReader(linkedAsset);
    } else if (text) {
      openTextReader({
        id: node.id,
        kind: 'script',
        title: (node.title as string) || '',
        name: (node.title as string) || '',
        url: '',
        body: text,
      });
    }
  }, [linkedAsset, text, node.id, node.title, openTextReader]);

  // 解析 JSON 数据
  // 关键：优先从后端写入的 extra.script 读综合 JSON（角色/道具/场景/分镜/视觉签名），
  // 失败时回退到 text（markdown）的 JSON.parse 兼容老数据。
  // 之前 _build_script_asset_payload 只在 extra 存 markdown body，ScriptNodeBody 拿到
  // markdown → JSON.parse 失败 → 角色/道具/场景/分镜 tabs 全空。
  const parseScript = (): any => {
    const extraScript = linkedAsset?.extra?.script;
    if (extraScript && typeof extraScript === 'object') {
      return extraScript;
    }
    try {
      return JSON.parse(text);
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

  const handleBodyClick = useCallback((e: React.MouseEvent) => {
    if (!text) return;
    const target = e.target as HTMLElement;
    if (target.closest('button, a, input, textarea, select, .script-node-tab, .script-node-list-item, .script-node-section, .script-node-stat, pre')) return;
    e.stopPropagation();
    handleOpenReader();
  }, [text, handleOpenReader]);

  return (
    <div
      className="script-node-body"
      onClick={handleBodyClick}
      title={text ? t('canvasScriptClickToOpenReader') || '点击打开阅读器' : ''}
      style={text ? { cursor: 'pointer' } : undefined}
    >
      {/* 标题栏 */}
      <div className="script-node-head">
        <div className="script-node-title">
          <FileText size={14} />
          <span>{node.title || t('canvasPipelineAssetScript')}</span>
        </div>
        <div className="script-node-count">
          {t('canvasPanelAssetChars').replace('{0}', String(charCount))}
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
                      <span>{formatVisualSignatureColors(visualSignature.colorIds)}</span>
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

const AgentNodeBody: React.FC<{ node: CanvasNode }> = React.memo(({ node }) => {
  const taskType = (node._agentTaskType as string) || 'goal';
  const status = (node._agentStatus as string) || 'pending';
  const label = (node._agentLabel as string) || '';
  const payload = (node._agentPayload as Record<string, any>) || {};
  const meta = { label: taskType, icon: '•' };
  const isArtifact = taskType === 'artifact';
  const isPlan = taskType === 'plan';
  const isQuestion = taskType === 'question';
  const isImage = isArtifact && payload.kind === 'image' && typeof payload.url === 'string';
  const isText = isArtifact && payload.kind === 'text' && typeof payload.snippet === 'string';
  // 资产分类画廊：addAgentNodes 把同类资产打包成一个节点，payload.kind='category'
  const isCategory = isArtifact && payload.kind === 'category' && Array.isArray(payload.items);
  const categoryItems: any[] = isCategory ? payload.items : [];
  // 4 个缩略图格子（2x2），超出显示 +N more
  const thumbs = categoryItems.slice(0, 4);
  const moreCount = Math.max(0, categoryItems.length - thumbs.length);

  // 分类图标（与 kindLabel 同步）：character=👤, prop=🎁, scene=🏞, storyboard=🎬, novel=📖, script=📜
  const kindIcons: Record<string, string> = {
    character: '👤', prop: '🎁', scene: '🏞', storyboard: '🎬', novel: '📖', script: '📜',
  };
  const categoryIcon = isCategory && payload.asset_kind
    ? kindIcons[String(payload.asset_kind)] || '◆'
    : null;

  // 严格黑白灰：左边框细线 + 节点 type icon，去掉一切彩色
  return (
    <div
      data-testid="agent-node-body"
      style={{
        minWidth: 0,
        width: '100%',
        height: '100%',
        boxSizing: 'border-box',
        background: 'var(--bg, #ffffff)',
        border: '1px solid var(--line, rgba(0,0,0,0.12))',
        borderLeft: '2px solid var(--text, #0f172a)',
        borderRadius: 8,
        padding: '8px 10px',
        fontFamily: 'ui-sans-serif, system-ui, sans-serif',
        fontSize: 12,
        color: 'var(--text, #0f172a)',
        boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 6,
        }}
      >
        <span
          data-testid={`task-graph-node-badge-${taskType}`}
          style={{
            fontSize: 10,
            color: 'var(--muted, #475569)',
            fontWeight: 500,
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
            letterSpacing: 0.2,
          }}
        >
          <span style={{ fontSize: 11 }}>{categoryIcon || meta.icon}</span>
          {isCategory ? String(payload.asset_kind || meta.label) : meta.label}
        </span>
        <AgentStatusBadge status={status} />
      </div>
      <div
        data-testid="task-graph-node-label"
        style={{
          fontWeight: 600,
          color: 'var(--text, #0f172a)',
          fontSize: 12,
          lineHeight: 1.3,
          wordBreak: 'break-word',
          display: '-webkit-box',
          WebkitLineClamp: 2,
          WebkitBoxOrient: 'vertical',
          overflow: 'hidden',
        }}
      >
        {label || '—'}
      </div>
      {isImage && (
        <img
          src={payload.url}
          alt={label}
          style={{ width: '100%', height: 56, objectFit: 'cover', borderRadius: 4, marginTop: 2, display: 'block', background: 'var(--soft, rgba(0,0,0,0.04))' }}
        />
      )}
      {isCategory && (
        <div
          data-testid="task-graph-node-category-grid"
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gridTemplateRows: '1fr 1fr',
            gap: 3,
            flex: 1,
            minHeight: 0,
            marginTop: 2,
          }}
        >
          {thumbs.map((it: any, i: number) => {
            const url = typeof it?.url === 'string' ? it.url : null;
            const isLastWithMore = i === thumbs.length - 1 && moreCount > 0;
            return (
              <div
                key={(it?.id as string) || i}
                data-testid={`task-graph-node-category-thumb-${i}`}
                style={{
                  position: 'relative',
                  background: 'var(--soft, rgba(0,0,0,0.04))',
                  borderRadius: 4,
                  overflow: 'hidden',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  minHeight: 0,
                  color: 'var(--muted, #94a3b8)',
                  fontSize: 9,
                }}
              >
                {url ? (
                  <img
                    src={url}
                    alt={it?.name || ''}
                    style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                    onError={(e) => {
                      // 缩略图加载失败 → 用 emoji 图标占位，避免空白
                      (e.currentTarget as HTMLImageElement).style.display = 'none';
                    }}
                  />
                ) : (
                  <span style={{ fontSize: 14, opacity: 0.55 }}>
                    {categoryIcon || (it?.kind === 'text' ? '📄' : '◆')}
                  </span>
                )}
                {isLastWithMore && (
                  <span
                    data-testid="task-graph-node-category-more"
                    style={{
                      position: 'absolute',
                      inset: 0,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      background: 'rgba(15, 23, 42, 0.55)',
                      color: '#fff',
                      fontSize: 11,
                      fontWeight: 600,
                    }}
                  >
                    +{moreCount}
                  </span>
                )}
              </div>
            );
          })}
          {/* 缩略图不足 4 个时补空格保持 2x2 形状 */}
          {Array.from({ length: Math.max(0, 4 - thumbs.length) }).map((_, i) => (
            <div
              key={`empty-${i}`}
              data-testid={`task-graph-node-category-empty-${i}`}
              style={{
                background: 'var(--soft, rgba(0,0,0,0.02))',
                borderRadius: 4,
                border: '1px dashed var(--line, rgba(0,0,0,0.08))',
              }}
            />
          ))}
        </div>
      )}
      {isText && (
        <div
          data-testid="task-graph-node-text-snippet"
          style={{
            fontSize: 10,
            color: 'var(--muted, #475569)',
            background: 'var(--soft, rgba(0,0,0,0.04))',
            padding: 4,
            borderRadius: 4,
            maxHeight: 60,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            lineHeight: 1.35,
          }}
        >
          {String(payload.snippet).slice(0, 140)}
        </div>
      )}
      {isPlan && Array.isArray(payload.plan) && (
        <ol style={{ margin: 0, paddingLeft: 16, fontSize: 10, color: 'var(--text, #334155)', lineHeight: 1.4 }}>
          {payload.plan.slice(0, 6).map((step: any, i: number) => (
            <li key={i} data-testid={`task-graph-node-plan-step-${i}`} style={{ marginBottom: 1 }}>
              <code style={{ fontSize: 9, color: 'var(--muted, #475569)' }}>{step.tool || step.name || `step ${i + 1}`}</code>
            </li>
          ))}
        </ol>
      )}
      {isQuestion && (
        <div
          data-testid="task-graph-node-question"
          style={{
            fontSize: 10,
            color: 'var(--muted, #475569)',
            background: 'var(--soft, rgba(0,0,0,0.04))',
            padding: 4,
            borderRadius: 4,
            border: '1px dashed var(--line, rgba(0,0,0,0.2))',
            marginTop: 2,
          }}
        >
          等待用户回答
        </div>
      )}
      {isQuestion && Array.isArray(payload.options) && payload.options.length > 0 && (
        <div data-testid="agent-node-question-options" style={{ fontSize: 9, color: 'var(--muted, #475569)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {payload.options.slice(0, 4).map((option: any) => typeof option === 'string' ? option : (option?.label || option?.value || '')).filter(Boolean).join(' · ')}
        </div>
      )}
    </div>
  );
});
AgentNodeBody.displayName = 'AgentNodeBody';

const AgentStatusBadge: React.FC<{ status: string }> = ({ status }) => {
  const testId = `task-graph-node-status-${status}`;
  // 严格黑白灰系：无颜色，仅用文字 + 边框粗细区分
  const cfg =
    status === 'running' ? { label: '运行中', emphasis: 'strong' as const } :
    status === 'success' ? { label: '完成', emphasis: 'normal' as const } :
    status === 'failed' ? { label: '失败', emphasis: 'strong' as const } :
    status === 'pending' ? { label: '等待', emphasis: 'soft' as const } :
    { label: status, emphasis: 'soft' as const };
  const emphasisStyle: React.CSSProperties = cfg.emphasis === 'strong'
    ? { fontWeight: 700, color: 'var(--text, #0f172a)' }
    : cfg.emphasis === 'soft'
    ? { fontWeight: 500, color: 'var(--muted, #94a3b8)' }
    : { fontWeight: 500, color: 'var(--muted, #475569)' };
  return (
    <span
      data-testid={testId}
      style={{
        fontSize: 9,
        ...emphasisStyle,
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        fontFamily: 'ui-monospace, monospace',
        textTransform: 'lowercase',
        letterSpacing: 0.2,
      }}
    >
      {cfg.label}
    </span>
  );
};
AgentStatusBadge.displayName = 'AgentStatusBadge';
