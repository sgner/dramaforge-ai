import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Sparkles, RefreshCw } from 'lucide-react';
import { useAgentStore, type AgentStatus } from './use-agent-store';
import { AskUserResponse } from './ask-user-response';
import { ErrorRecoveryCard } from './error-recovery-card';
import { retryNow } from './agent-stream-manager';

export interface AgentPetPosition { x: number; y: number }
export interface AgentPetSize { width: number; height: number }
export const AGENT_PET_SIZE: AgentPetSize = { width: 96, height: 112 };

export function truncatePetText(value: unknown, maxLength = 180): string {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  return text.length > maxLength ? `${text.slice(0, maxLength)}…` : text;
}

export function agentPetStorageKey(projectId: string) {
  return `agent-pet-position:${projectId}`;
}

export function loadAgentPetPosition(projectId: string): AgentPetPosition | null {
  try {
    const value = JSON.parse(localStorage.getItem(agentPetStorageKey(projectId)) || 'null');
    return value && Number.isFinite(value.x) && Number.isFinite(value.y)
      ? { x: Number(value.x), y: Number(value.y) }
      : null;
  } catch {
    return null;
  }
}

export function clampPetPosition(position: AgentPetPosition, container: AgentPetSize, pet: AgentPetSize = AGENT_PET_SIZE): AgentPetPosition {
  return {
    x: Math.min(Math.max(0, position.x), Math.max(0, container.width - pet.width)),
    y: Math.min(Math.max(0, position.y), Math.max(0, container.height - pet.height)),
  };
}

export function defaultPetPosition(container: AgentPetSize): AgentPetPosition {
  return clampPetPosition({
    x: (container.width - AGENT_PET_SIZE.width) / 2,
    y: (container.height - AGENT_PET_SIZE.height) / 2,
  }, container);
}

export interface AgentPetControllerProps {
  projectId: string;
  containerRef: React.RefObject<HTMLDivElement | null>;
  goal?: string;
  submitting?: boolean;
  error?: string | null;
  onGoalChange?: (value: string) => void;
  onSubmit?: () => void;
  thoughtOpen?: boolean;
  onToggleThought?: () => void;
  toolDrawerOpen?: boolean;
  onToggleTools?: () => void;
  onFitView?: () => void;
  onRelayout?: () => void;
}

export const AgentPetController: React.FC<AgentPetControllerProps> = ({
  projectId, containerRef, goal = '', submitting = false, error = null,
  onGoalChange, onSubmit, thoughtOpen = false, onToggleThought,
  toolDrawerOpen = false, onToggleTools, onFitView, onRelayout,
}) => {
  const status = useAgentStore((s) => s.status);
  const pendingQuestion = useAgentStore((s) => s.pendingQuestion);
  const pendingErrorRecovery = useAgentStore((s) => s.pendingErrorRecovery);
  const taskId = useAgentStore((s) => s.taskId);
  const thoughts = useAgentStore((s) => s.thoughts);
  const actions = useAgentStore((s) => s.actions);
  const observations = useAgentStore((s) => s.observations);
  const plan = useAgentStore((s) => s.plan);
  const artifacts = useAgentStore((s) => s.artifacts);
  const streamingText = useAgentStore((s) => s.streamingText);
  const continueConversation = useAgentStore((s) => s.continueConversation);
  // SSE 连接状态：当 connectionStatus !== 'connected' 时显示提示横幅 + 重试按钮
  const connectionStatus = useAgentStore((s) => s.connectionStatus);
  const connectionDetail = useAgentStore((s) => s.connectionDetail);
  // 实时活动状态：与 ActivityIndicator 共享同一个字段。把它从画布顶部 chip
  // 移到这里，让用户在看桌宠的同时知道 agent 当前具体在做什么
  // （"正在优化提示词"/"正在生成媒体…" 等）。状态文本优先取 activity，
  // 没有 activity 时再回退到 status 枚举文本。
  const currentActivity = useAgentStore((s) => s.currentActivity);
  const [position, setPosition] = useState<AgentPetPosition | null>(null);
  const [panelOpen, setPanelOpen] = useState(true);
  const [followUpMessage, setFollowUpMessage] = useState('');
  const [continueSubmitting, setContinueSubmitting] = useState(false);
  const petRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{ pointerId: number; offsetX: number; offsetY: number } | null>(null);

  const measure = useCallback(() => {
    const container = containerRef.current;
    if (!container) {
      const width = Math.max(320, window.innerWidth || 1024);
      const height = Math.max(240, window.innerHeight || 720);
      const saved = loadAgentPetPosition(projectId);
      setPosition(clampPetPosition(saved || defaultPetPosition({ width, height }), { width, height }));
      return;
    }
    const rect = container.getBoundingClientRect();
    const saved = loadAgentPetPosition(projectId);
    const next = clampPetPosition(saved || defaultPetPosition({ width: rect.width, height: rect.height }), { width: rect.width, height: rect.height });
    setPosition(next);
    try { localStorage.setItem(agentPetStorageKey(projectId), JSON.stringify(next)); } catch { /* storage can be unavailable */ }
  }, [containerRef, projectId]);

  useLayoutEffect(() => { measure(); }, [measure]);

  useEffect(() => {
    if (pendingErrorRecovery) setPanelOpen(true);
  }, [pendingErrorRecovery]);

  useEffect(() => {
    const onResize = () => measure();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [measure]);

  useEffect(() => {
    const move = (event: PointerEvent) => {
      const drag = dragRef.current;
      const container = containerRef.current;
      if (!drag || !container || event.pointerId !== drag.pointerId) return;
      const rect = container.getBoundingClientRect();
      const next = clampPetPosition({ x: event.clientX - rect.left - drag.offsetX, y: event.clientY - rect.top - drag.offsetY }, { width: rect.width, height: rect.height });
      setPosition(next);
      try { localStorage.setItem(agentPetStorageKey(projectId), JSON.stringify(next)); } catch { /* storage can be unavailable */ }
    };
    const up = (event: PointerEvent) => {
      if (dragRef.current?.pointerId === event.pointerId) dragRef.current = null;
    };
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', up);
    return () => {
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', up);
    };
  }, [containerRef, projectId]);

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!position) return;
    event.preventDefault();
    event.stopPropagation();
    const rect = event.currentTarget.getBoundingClientRect();
    dragRef.current = { pointerId: event.pointerId, offsetX: event.clientX - rect.left, offsetY: event.clientY - rect.top };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };

  if (!position) return null;

  const statusText: Record<AgentStatus, string> = {
    idle: '准备好了', running: '正在思考', paused: pendingQuestion ? '等你回复' : '已暂停', done: '任务完成', failed: '需要重试', cancelled: '已停止',
  };
  // 实时 activity 优先于 status 文本：agent 思考时也可以显示具体动作
  // （如"正在生成媒体…"），让桌宠状态栏同时承担"我正在做什么"的反馈。
  // 已结束的 status（done/failed/cancelled/paused）保持原文本，避免覆盖终态提示。
  const petStatusText = (() => {
    if (currentActivity && status === 'running') return currentActivity;
    return statusText[status];
  })();
  // 桌宠标签只有 ~96px 宽，活动文本（如"正在生成角色图：林尘"）
  // 容易撑出。截断到 12 个字符，hover 时通过 title 显示完整文本。
  const petLabelText = truncatePetText(petStatusText, 12);
  const petLabelTitle = petStatusText && petStatusText.length > 12 ? petStatusText : undefined;

  const latestThought = thoughts[thoughts.length - 1]?.payload?.text;
  const allArtifacts = Object.values(artifacts).flat();
  const latestMedia = allArtifacts
    .filter((item: any) => item && (item.prompt || item.model_id || item.modelId))
    .slice(-1)[0] as any;
  // 最近一次生成引用的资产（reference_asset_ids → 名字 + 角色 + 来源状态），
  // 让用户能核对"这次生成参考了谁、用的是原图还是标准化图"。
  const REF_KIND_LABELS: Record<string, string> = {
    character: '角色', prop: '道具', scene: '场景', shot: '分镜', storyboard: '分镜',
  };
  const latestMediaRefIds: string[] = (latestMedia?.extra?.reference_asset_ids || latestMedia?.reference_asset_ids || []) as string[];
  const latestMediaRefLabels = latestMediaRefIds
    .map((id) => {
      const asset = allArtifacts.find((a: any) => a?.id === id) as any;
      if (!asset?.name) return null;
      const bits: string[] = [];
      const kindLabel = REF_KIND_LABELS[asset.asset_kind] || asset.asset_kind;
      if (kindLabel) bits.push(kindLabel);
      bits.push(asset.source_asset_id ? '标准化' : '原始');
      return `${asset.name}（${bits.join('·')}）`;
    })
    .filter(Boolean);
  const togglePanel = (event: React.MouseEvent) => {
    event.stopPropagation();
    setPanelOpen((open) => !open);
  };

  return (
    <div
      data-testid="agent-pet-controller"
      className="agent-pet-controller"
      style={{ left: position.x, top: position.y }}
      onMouseDown={(event) => event.stopPropagation()}
    >
      {panelOpen && <div data-testid="agent-pet-panel" className="agent-pet-panel" onMouseDown={(event) => event.stopPropagation()} onClick={(event) => event.stopPropagation()}>
        <div className="agent-pet-panel-status"><span className={`agent-pet-status-dot ${status}`} />{petStatusText}</div>
        {/* SSE 连接状态横幅：断线 / 重连时让用户知道 agent 的实时反馈可能丢失
            并提供"手动重连"出口（重连预算耗尽后由用户主动重置 retryCount）。 */}
        {connectionStatus !== 'connected' && taskId && (
          <div
            data-testid={`agent-pet-connection-${connectionStatus}`}
            className={`agent-pet-connection agent-pet-connection-${connectionStatus}`}
            role="status"
            aria-live="polite"
          >
            <span className="agent-pet-connection-dot" />
            <span className="agent-pet-connection-text">
              {connectionStatus === 'reconnecting' ? '正在重连…' : '连接已断开'}
              {connectionDetail ? ` · ${connectionDetail}` : ''}
            </span>
            <button
              type="button"
              data-testid="agent-pet-connection-retry"
              className="agent-pet-connection-retry"
              onClick={() => retryNow()}
              title="手动重试连接"
            >
              <RefreshCw size={12} /> 重连
            </button>
          </div>
        )}
        <div className="agent-pet-panel-stats">
          <span>思考 {thoughts.length}</span><span>动作 {actions.length}</span><span>观察 {observations.length}</span><span>计划 {plan.length}</span>
        </div>
        {latestThought && <div className="agent-pet-panel-thought">{truncatePetText(latestThought, 140)}</div>}
        {streamingText && <div data-testid="agent-pet-streaming" className="agent-pet-panel-thought">{truncatePetText(streamingText, 180)}</div>}
        {latestMedia && <div data-testid="agent-pet-media" className="agent-pet-media">
          <div className="agent-pet-media-head">生成提示词</div>
          {latestMedia.prompt && <div data-testid="agent-pet-media-prompt" className="agent-pet-media-prompt" title="点击查看完整提示词">{truncatePetText(latestMedia.prompt, 180)}</div>}
          {(latestMedia.provider_name || latestMedia.provider_id || latestMedia.providerId || latestMedia.model_id || latestMedia.modelId) && <div data-testid="agent-pet-media-model" className="agent-pet-media-model">
            {latestMedia.provider_name || latestMedia.provider_id || latestMedia.providerId || ''}{(latestMedia.model_id || latestMedia.modelId) ? ` · ${latestMedia.model_id || latestMedia.modelId}` : ''}
          </div>}
          {latestMediaRefLabels.length > 0 && <div data-testid="agent-pet-media-refs" className="agent-pet-media-refs">
            参考：{latestMediaRefLabels.join('、')}
          </div>}
        </div>}
        {onGoalChange && onSubmit && <div className="agent-pet-goal">
          <input
            data-testid="agent-mode-input"
            value={goal}
            onChange={(event) => onGoalChange(event.target.value)}
            onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); onSubmit(); } }}
            placeholder="描述目标，例如：做一个 30 秒的短片"
          />
          <button data-testid="agent-mode-submit" type="button" onClick={onSubmit} disabled={submitting || !goal.trim()}>
            {submitting ? '创建中…' : '创建任务'}
          </button>
        </div>}
        {error && <div data-testid="agent-pet-error" className="agent-pet-panel-error">{error}</div>}
        {pendingErrorRecovery && <ErrorRecoveryCard />}
        {status === 'done' && taskId && (
          <div className="agent-pet-continue" data-testid="agent-pet-continue">
            <div className="agent-pet-continue-label">任务已完成 · 追加需求继续对话</div>
            <textarea
              data-testid="agent-pet-continue-input"
              className="agent-pet-continue-input"
              value={followUpMessage}
              onChange={(e) => setFollowUpMessage(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  const submit = async () => {
                    const msg = followUpMessage.trim();
                    if (!msg || continueSubmitting) return;
                    setContinueSubmitting(true);
                    try {
                      await continueConversation(msg);
                      setFollowUpMessage('');
                    } catch (err) {
                      // 错误由 store/SSE 处理，此处只恢复按钮
                    } finally {
                      setContinueSubmitting(false);
                    }
                  };
                  submit();
                }
              }}
              placeholder="例如：再生成一个反派角色 / 把场景改成夜晚"
              rows={2}
              disabled={continueSubmitting}
            />
            <button
              data-testid="agent-pet-continue-submit"
              type="button"
              className="agent-pet-continue-btn"
              disabled={continueSubmitting || !followUpMessage.trim()}
              onClick={async () => {
                const msg = followUpMessage.trim();
                if (!msg || continueSubmitting) return;
                setContinueSubmitting(true);
                try {
                  await continueConversation(msg);
                  setFollowUpMessage('');
                } catch {
                  /* 错误由 store/SSE 处理 */
                } finally {
                  setContinueSubmitting(false);
                }
              }}
            >
              {continueSubmitting ? '发送中…' : '继续对话'}
            </button>
          </div>
        )}
        <div className="agent-pet-panel-actions">
          {onToggleThought && <button data-testid="agent-mode-thought-toggle" type="button" className={thoughtOpen ? 'active' : ''} onClick={onToggleThought}>思考流</button>}
          {onToggleTools && <button data-testid="agent-mode-tool-drawer-toggle" type="button" className={toolDrawerOpen ? 'active' : ''} onClick={onToggleTools}>工具</button>}
          {onFitView && <button data-testid="agent-mode-fit-view" type="button" onClick={onFitView}>适应视图</button>}
          {onRelayout && <button data-testid="agent-mode-relayout" type="button" onClick={onRelayout}>整理节点</button>}
        </div>
        {pendingQuestion && taskId && <div data-testid="agent-pet-question" className="agent-pet-question"><AskUserResponse /></div>}
      </div>}
      <div
        ref={petRef}
        data-testid="agent-pet"
        className={`agent-pet ${status}`}
        role="button"
        tabIndex={0}
        aria-label="Agent 桌面宠物，拖动以移动"
        onPointerDown={onPointerDown}
        onClick={togglePanel}
        onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') event.preventDefault(); }}
      >
        <div className="agent-pet-glow" />
        <img data-testid="agent-pet-mascot" className="agent-pet-mascot" src="/agent/agent-pet-penguin.png" alt="" draggable={false} />
        <div className="agent-pet-label" title={petLabelTitle}><Sparkles size={11} /> {petLabelText}</div>
        <div data-testid="agent-pet-handle" className="agent-pet-handle">拖动</div>
      </div>
    </div>
  );
};
