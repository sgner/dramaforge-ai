import React, { useCallback, useState, useRef, useEffect, useMemo } from 'react';
import { useCanvasStore } from './use-canvas-store';
import { CanvasNode } from './types';
import { estimatedNodeRect } from './engine';
import { useI18n } from '../../i18n';

type EngineType = 'api' | 'volcengine' | 'modelscope' | 'comfyui' | 'rh';
type ApiKindType = 'image' | 'video';

/**
 * Composer 面板 - 完全匹配参考项目智能画布设计
 * 核心逻辑：只在选中 image 类型节点时显示，定位在节点下方
 * 在 world 内部渲染，跟随视口变换
 */
export const ComposerPanel: React.FC = React.memo(() => {
  const { t } = useI18n();
  const nodes = useCanvasStore((s) => s.nodes);
  const selected = useCanvasStore((s) => s.selected);
  const connections = useCanvasStore((s) => s.connections);
  const viewport = useCanvasStore((s) => s.viewport);
  const apiConfig = useCanvasStore((s) => s.apiConfig);
  const taskAssets = useCanvasStore((s) => s.taskAssets);
  const cascadeRunning = useCanvasStore((s) => s.cascadeRunning);
  const startCascadeRun = useCanvasStore((s) => s.startCascadeRun);
  const stopCascadeRun = useCanvasStore((s) => s.stopCascadeRun);
  const updateNode = useCanvasStore((s) => s.updateNode);
  const runVideoGeneration = useCanvasStore((s) => s.runVideoGeneration);

  const [engine, setEngine] = useState<EngineType>('api');
  const [apiKind, setApiKind] = useState<ApiKindType>('image');
  const [providerId, setProviderId] = useState('default');
  const [modelId, setModelId] = useState('default');
  const [ratio, setRatio] = useState('square');
  const [resolution, setResolution] = useState('1k');
  const [promptText, setPromptText] = useState('');
  const [promptH, setPromptH] = useState(124);
  const promptRef = useRef<HTMLDivElement>(null);

  // 找到当前选中的 image 或 video 类型节点（参考项目 selectNode 逻辑）
  const selectedNode = useMemo(() => {
    if (selected.size !== 1) return null;
    const id = [...selected][0];
    const node = nodes.find(n => n.id === id);
    if (!node) return null;
    // image 和 video 类型节点都显示 Composer
    if (node.type !== 'image' && node.type !== 'video') return null;
    return node;
  }, [selected, nodes]);

  // 计算 Composer 的位置：在选中节点下方居中（参考项目 positionComposerForNode）
  const composerPosition = useMemo(() => {
    if (!selectedNode) return null;
    const rect = estimatedNodeRect(selectedNode);
    const gap = 14;
    const cardW = 540;
    return {
      left: rect.x + rect.w / 2 - cardW / 2,
      top: rect.y + rect.h + gap,
      width: cardW,
      gap,
      nodeTop: rect.y,
    };
  }, [selectedNode]);

  // ===== 视口边界保护 =====
  // 节点靠近视口底部时浮窗翻转到节点上方；横向越界时平移收回。
  // 依据节点 DOM 的屏幕位置与上/下剩余空间做决策（而非浮窗自身位置），避免翻转抖动。
  const composerRef = useRef<HTMLDivElement>(null);
  const [edgeAdjust, setEdgeAdjust] = useState<{ flip: boolean; shiftX: number }>({ flip: false, shiftX: 0 });

  // 切换选中节点时复位，让浮窗先回到默认位置再重新测量
  useEffect(() => {
    setEdgeAdjust({ flip: false, shiftX: 0 });
  }, [selectedNode?.id]);

  useEffect(() => {
    const el = composerRef.current;
    if (!el || !selectedNode || !composerPosition) return;
    const margin = 12;
    const scale = viewport.scale || 1;
    const nodeEl = document.querySelector(`.image-node[data-id="${CSS.escape(selectedNode.id)}"]`);
    if (!nodeEl) return;
    const nodeRect = nodeEl.getBoundingClientRect();

    // 垂直方向：下方放不下且上方空间更大 → 翻转
    const hScreen = el.offsetHeight * scale;
    const spaceBelow = window.innerHeight - nodeRect.bottom - margin;
    const spaceAbove = nodeRect.top - margin;
    const flip = spaceBelow < hScreen && spaceAbove > spaceBelow;

    // 水平方向：期望居中位置越界 → 平移收回（屏幕像素换算回世界单位）
    const wScreen = el.offsetWidth * scale;
    const desiredLeft = nodeRect.left + nodeRect.width / 2 - wScreen / 2;
    const maxLeft = window.innerWidth - margin - wScreen;
    const clampedLeft = Math.max(margin, Math.min(desiredLeft, Math.max(margin, maxLeft)));
    const shiftX = (clampedLeft - desiredLeft) / scale;

    setEdgeAdjust((prev) =>
      prev.flip === flip && Math.abs(prev.shiftX - shiftX) < 1 ? prev : { flip, shiftX }
    );
  }, [selectedNode, composerPosition, viewport, promptH, engine, apiKind]);

  // 同步提示词 + 资产元数据：仅在选中节点变化时加载。
  // 注意：依赖不能包含 nodes/taskAssets/connections——生成过程中 updateNode
  // 会频繁改写 nodes，若随之重新水合，会把用户正在输入的新提示词
  // 覆盖回上次运行的 _assetPrompt（"第二次输入被第一次覆盖"问题）。
  useEffect(() => {
    if (selectedNode) {
      // 提示词优先级：用户草稿（promptDraftText/text）> 上次生成记录 _assetPrompt > 连接的输入 prompt / script / novel 节点。
      // 草稿优先于 _assetPrompt：_assetPrompt 是"上一次生成用了什么"的元数据，
      // 用户之后编辑的内容不能被它盖掉。
      const inputPrompt = connections
        .filter(c => c.to === selectedNode.id)
        .map(c => nodes.find(n => n.id === c.from))
        .filter((n): n is NonNullable<typeof n> => !!n && (n.type === 'prompt' || n.type === 'script' || n.type === 'novel'))
        .map((n) => {
          // script/novel 节点优先从 _assetId 关联的资产 body 读取；否则用 node.text
          const assetId = (n._assetId as string) || '';
          const linkedAsset = assetId ? taskAssets.find(a => a.id === assetId) : undefined;
          return linkedAsset?.body ?? (n.text as string) ?? '';
        })
        .filter((s) => !!s)
        .join('\n')
        .trim();
      const prompt = (selectedNode.promptDraftText as string)
        || selectedNode.text
        || (selectedNode._assetPrompt as string)
        || inputPrompt
        || '';
      setPromptText(prompt);
      // 同步到 contentEditable DOM（state 变化不会自动反映到 div 文本）
      if (promptRef.current && promptRef.current.innerText !== prompt) {
        promptRef.current.innerText = prompt;
      }
      // 预填供应商/模型（仅当节点记录了资产元数据时，避免覆盖用户的 default 选择）
      const assetProviderId = selectedNode._assetProviderId as string | undefined;
      const assetModelId = selectedNode._assetModelId as string | undefined;
      if (assetProviderId) {
        const exists = apiConfig.providers.some(p => p.id === assetProviderId);
        if (exists) setProviderId(assetProviderId);
      }
      if (assetModelId) setModelId(assetModelId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedNode?.id]);

  // 保存提示词草稿到节点
  const savePromptDraft = useCallback(() => {
    if (!selectedNode) return;
    updateNode(selectedNode.id, {
      text: promptText,
      promptDraftText: promptText,
    } as Partial<CanvasNode>);
  }, [selectedNode, promptText, updateNode]);

  // 查找连接到当前节点的输入图片（参考项目 visibleReferenceImagesFor）
  const inputImages = useMemo(() => {
    if (!selectedNode) return [];
    return connections
      .filter(c => c.to === selectedNode.id)
      .map(c => nodes.find(n => n.id === c.from))
      .filter((n): n is NonNullable<typeof n> => !!n && n.type === 'image' && !!n.url);
  }, [selectedNode, connections, nodes]);

  // 查找连接到当前节点的输入提示词（参考项目 inputPromptTextFor）
  // 支持 prompt / script / novel 类型节点（script/novel 通过 _assetId 关联的资产 body 读取）
  const inputPromptText = useMemo(() => {
    if (!selectedNode) return '';
    return connections
      .filter(c => c.to === selectedNode.id)
      .map(c => nodes.find(n => n.id === c.from))
      .filter((n): n is NonNullable<typeof n> => !!n && (n.type === 'prompt' || n.type === 'script' || n.type === 'novel'))
      .map((n) => {
        if (n.type === 'script' || n.type === 'novel') {
          const assetId = (n._assetId as string) || '';
          const linkedAsset = assetId ? taskAssets.find(a => a.id === assetId) : undefined;
          return linkedAsset?.body ?? (n.text as string) ?? '';
        }
        return n.text || '';
      })
      .filter((s) => !!s)
      .join('\n')
      .trim();
  }, [selectedNode, connections, nodes, taskAssets]);

  const enabledProviders = apiConfig.providers.filter(p => p.enabled);
  const selectedProvider = enabledProviders.find(p => p.id === providerId);
  // 视频模式显示 videoModels，图片模式显示 chat+imageModels
  const modelsForProvider = selectedProvider
    ? apiKind === 'video'
      ? [...(selectedProvider.videoModels || [])].map(m => typeof m === 'string' ? m : (m as any).id || (m as any).name)
      : [...(selectedProvider.chatModels || []), ...(selectedProvider.imageModels || [])]
    : [];

  // 是否显示一键运行按钮
  const hasLoopNode = useMemo(() => nodes.some(n => n.type === 'loop'), [nodes]);

  const handleCascadeRun = useCallback(() => {
    if (cascadeRunning) {
      stopCascadeRun();
      return;
    }
    const genNodes = nodes.filter(n =>
      n.type === 'loop'
    );
    if (genNodes.length === 0) return;

    const genIds = new Set(genNodes.map(n => n.id));
    const inDegree = new Map<string, number>();
    genNodes.forEach(n => inDegree.set(n.id, 0));
    connections.forEach(c => {
      if (genIds.has(c.from) && genIds.has(c.to)) {
        inDegree.set(c.to, (inDegree.get(c.to) || 0) + 1);
      }
    });

    const queue: string[] = [];
    inDegree.forEach((deg, id) => { if (deg === 0) queue.push(id); });
    const sorted: string[] = [];
    while (queue.length) {
      const id = queue.shift()!;
      sorted.push(id);
      connections.forEach(c => {
        if (c.from === id && genIds.has(c.to)) {
          const newDeg = (inDegree.get(c.to) || 1) - 1;
          inDegree.set(c.to, newDeg);
          if (newDeg === 0) queue.push(c.to);
        }
      });
    }
    genNodes.forEach(n => {
      if (!sorted.includes(n.id)) sorted.push(n.id);
    });
    startCascadeRun(sorted);
  }, [cascadeRunning, nodes, connections, startCascadeRun, stopCascadeRun]);

  // 运行生成（图片或视频）
  const retryFailedAsset = useCanvasStore((s) => s.retryFailedAsset);
  const runImageToImage = useCanvasStore((s) => s.runImageToImage);
  const [runError, setRunError] = useState<string | null>(null);
  const [runBtnShake, setRunBtnShake] = useState(false);
  const handleRun = useCallback(() => {
    if (!selectedNode) return;
    setRunError(null);
    const finalPrompt = promptText || inputPromptText;
    if (apiKind === 'video' || selectedNode.type === 'video') {
      // 视频生成
      if (!finalPrompt.trim()) {
        setRunError(t('canvasComposerErrPromptRequired'));
        setRunBtnShake(true);
        setTimeout(() => setRunBtnShake(false), 500);
        return;
      }
      if (providerId === 'default' && enabledProviders.length === 0) {
        setRunError(t('canvasComposerErrNoProvider'));
        setRunBtnShake(true);
        setTimeout(() => setRunBtnShake(false), 500);
        return;
      }
      runVideoGeneration(selectedNode.id, {
        prompt: finalPrompt,
        providerId: providerId === 'default' ? (enabledProviders[0]?.id ?? '') : providerId,
        modelId: modelId === 'default' ? '' : modelId,
        inputImageUrls: inputImages.map(img => img.url!),
      });
    } else {
      // 图片生成：把 prompt/provider/model 写回节点元数据
      if (!finalPrompt.trim()) {
        setRunError(t('canvasComposerErrPromptRequired'));
        setRunBtnShake(true);
        setTimeout(() => setRunBtnShake(false), 500);
        return;
      }
      const resolvedProviderId = providerId === 'default' ? (enabledProviders[0]?.id ?? '') : providerId;
      const resolvedModelId = modelId === 'default' ? '' : modelId;
      // 先把当前选择持久化到节点
      updateNode(selectedNode.id, {
        _assetPrompt: finalPrompt,
        _assetProviderId: resolvedProviderId,
        _assetProviderName: enabledProviders.find(p => p.id === resolvedProviderId)?.name,
        _assetModelId: resolvedModelId || undefined,
      } as Partial<CanvasNode>);
      if (selectedNode.url) {
        // 图生图：节点已有图片（上传节点/已生成节点）→ 结果输出到右侧新建节点
        const ratioMap: Record<string, string> = {
          square: '1:1', portrait: '2:3', landscape: '3:2',
          portrait43: '3:4', landscape43: '4:3', story: '9:16', wide: '16:9',
        };
        void runImageToImage(selectedNode.id, {
          prompt: finalPrompt,
          providerId: resolvedProviderId,
          modelId: resolvedModelId,
          aspectRatio: ratioMap[ratio],
        });
      } else {
        // 空占位节点 → 原地生成
        void retryFailedAsset(selectedNode.id, finalPrompt);
      }
    }
  }, [selectedNode, apiKind, promptText, inputPromptText, providerId, modelId, ratio, enabledProviders, inputImages, runVideoGeneration, updateNode, retryFailedAsset, runImageToImage, t]);

  // 非选中 image/video 节点 → 不渲染
  if (!selectedNode || !composerPosition) return null;

  // 边界保护：翻转到节点上方 / 横向收回
  const composerTop = edgeAdjust.flip && composerRef.current
    ? composerPosition.nodeTop - composerRef.current.offsetHeight - composerPosition.gap
    : composerPosition.top;

  return (
    <div
      ref={composerRef}
      className="composer open"
      style={{
        left: composerPosition.left + edgeAdjust.shiftX,
        top: composerTop,
        width: composerPosition.width,
      }}
      onPointerDown={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div className="composer-card">
        {/* 头部：引擎选择 + 图片/视频切换 */}
        <div className="composer-head">
          <div className="composer-head-left">
            <select
              className="engine-select"
              value={engine}
              onChange={(e) => setEngine(e.target.value as EngineType)}
              onMouseDown={(e) => e.stopPropagation()}
            >
              <option value="api">{t('canvasComposerEngineApi')}</option>
              <option value="volcengine">{t('canvasComposerEngineVolcengine')}</option>
              <option value="modelscope">{t('canvasComposerEngineModelscope')}</option>
              <option value="comfyui">{t('canvasComposerEngineComfyui')}</option>
              <option value="rh">{t('canvasComposerEngineRh')}</option>
            </select>
            {(engine === 'api' || engine === 'volcengine') && (
              <div className="kind-toggle">
                <button
                  type="button"
                  className={apiKind === 'image' ? 'active' : ''}
                  onMouseDown={(e) => e.stopPropagation()}
                  onClick={() => setApiKind('image')}
                >
                  {t('canvasComposerKindImage')}
                </button>
                <button
                  type="button"
                  className={apiKind === 'video' ? 'active' : ''}
                  onMouseDown={(e) => e.stopPropagation()}
                  onClick={() => setApiKind('video')}
                >
                  {t('canvasComposerKindVideo')}
                </button>
              </div>
            )}
          </div>
        </div>

        {/* 输入图片缩略图行 */}
        <div className={`input-thumbs-row${inputImages.length > 0 ? ' has-items' : ''}`}>
          {inputImages.length > 0 && (
            <div className="input-thumb-list">
              {inputImages.map((img, i) => (
                <div key={img.id} className="input-thumb" title={t('canvasComposerInputThumb').replace('{0}', String(i + 1))}>
                  <img src={img.url} alt="" draggable={false} />
                  <span className="input-thumb-label">{t('canvasComposerInputThumb').replace('{0}', String(i + 1))}</span>
                </div>
              ))}
              {inputImages.length > 1 && (
                <span className="input-thumb-count">{t('canvasComposerInputCount').replace('{0}', String(inputImages.length))}</span>
              )}
            </div>
          )}
        </div>

        {/* 输入提示词预览 */}
        {inputPromptText && (
          <div className="input-prompt-preview has-text">
            <div className="input-prompt-preview-label">{t('canvasComposerUpstreamPrompt')}</div>
            <div className="input-prompt-preview-text">{inputPromptText}</div>
          </div>
        )}

        {/* 提示词输入行 */}
        <div className="prompt-row">
          <div
            ref={promptRef}
            className="prompt-input"
            contentEditable
            suppressContentEditableWarning
            data-placeholder={t('canvasComposerPromptPlaceholder')}
            style={{ '--prompt-h': `${Math.max(60, Math.min(380, promptH))}px` } as React.CSSProperties}
            onMouseDown={(e) => e.stopPropagation()}
            onInput={() => {
              if (promptRef.current) {
                setPromptText(promptRef.current.innerText || '');
              }
            }}
            onBlur={savePromptDraft}
          />
          <button className="composer-template-btn" type="button" title={t('canvasComposerTemplateLib')} onMouseDown={(e) => e.stopPropagation()}>
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="m4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20"/></svg>
          </button>
          <div className="prompt-resize" title={t('canvasComposerResizeHint')} />
        </div>

        {/* 参数行 */}
        <div className="param-row">
          <div className="dynamic-params">
            {engine === 'api' && (
              <>
                <select
                  className="engine-select"
                  value={providerId}
                  onChange={(e) => { setProviderId(e.target.value); setModelId('default'); }}
                  onMouseDown={(e) => e.stopPropagation()}
                >
                  <option value="default">{t('canvasComposerDefaultProvider')}</option>
                  {enabledProviders.map(p => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
                <select
                  className="engine-select"
                  value={modelId}
                  onChange={(e) => setModelId(e.target.value)}
                  onMouseDown={(e) => e.stopPropagation()}
                >
                  <option value="default">{t('canvasComposerDefaultModel')}</option>
                  {modelsForProvider.map(m => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                </select>
              </>
            )}
            <select
              className="engine-select"
              value={ratio}
              onChange={(e) => setRatio(e.target.value)}
              onMouseDown={(e) => e.stopPropagation()}
            >
              <option value="square">1:1</option>
              <option value="portrait">2:3</option>
              <option value="landscape">3:2</option>
              <option value="portrait43">3:4</option>
              <option value="landscape43">4:3</option>
              <option value="story">9:16</option>
              <option value="wide">16:9</option>
            </select>
            <select
              className="engine-select"
              value={resolution}
              onChange={(e) => setResolution(e.target.value)}
              onMouseDown={(e) => e.stopPropagation()}
            >
              <option value="1k">1K</option>
              <option value="2k">2K</option>
              <option value="4k">4K</option>
            </select>
          </div>
        </div>

        {/* 操作按钮 */}
        <div className="composer-actions">
          {hasLoopNode && (
            <button
              className={`run-btn cascade-run-btn${cascadeRunning ? ' running' : ''}`}
              type="button"
              onMouseDown={(e) => e.stopPropagation()}
              onClick={handleCascadeRun}
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect width="8" height="8" x="3" y="3" rx="2"/><path d="M7 11v4a2 2 0 0 0 2 2h4"/><rect width="8" height="8" x="13" y="13" rx="2"/></svg>
              <span>{cascadeRunning ? t('canvasComposerStop') : t('canvasComposerCascadeRun')}</span>
            </button>
          )}
          <button className={`run-btn${runBtnShake ? ' shake' : ''}`} type="button" onMouseDown={(e) => e.stopPropagation()} onClick={handleRun}>
            <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z"/></svg>
            <span>{t('canvasComposerRun')}</span>
          </button>
        </div>
        {runError && (
          <div style={{ marginTop: '6px', fontSize: '11px', color: '#dc2626', padding: '4px 8px', background: 'rgba(220,38,38,0.08)', borderRadius: '4px' }}>
            {runError}
          </div>
        )}
      </div>
    </div>
  );
});

ComposerPanel.displayName = 'ComposerPanel';
