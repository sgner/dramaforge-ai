/**
 * AgentMode — 顶级 agent 页面，组合输入栏 + TaskList + InfiniteCanvas + 浮层 ThoughtStream + 抽屉 ToolPalette。
 *
 * 数据流：
 *   - 输入目标 → api.startAgent → 拿到 taskId
 *   - useAgentStream(taskId) 订阅 SSE → useAgentStore.applyEvent 投影
 *   - useEffect 订阅 useAgentStore → 调 useCanvasStore.addAgentNodes 投影到画布
 *   - 切 projectId → useCanvasStore.clearAgentNodes
 *   - ThoughtStream 浮层右上，ToolPalette 抽屉右侧（默认关闭）
 *
 * 关键设计：
 *   - 创建任务后自动打开 ThoughtStream，让用户立即看到 agent 进度
 *   - 任务列表用 refreshTrigger 在创建后立刻刷新
 *   - 退出 agent 模式时不断 SSE：保留 useAgentStore.taskId，
 *     App 层可以重新挂回 AgentMode 时继续订阅。
 */
import React, { useEffect, useRef, useState } from 'react';
import { X, RotateCw } from 'lucide-react';
import { useAgentStore } from './use-agent-store';
// useAgentStream 由全局 agent-stream-manager 管理（App 启动时引入），
// 此处不再调用，避免与全局管理器创建重复连接。
import { useAgentTools } from './use-agent-tools';
import { ThoughtStream } from './thought-stream';
import { ToolPalette } from './tool-palette';
import { TaskList } from './task-list';
import { ErrorRecoveryCard } from './error-recovery-card';
import { api } from '@/services/apiClient';
import { InfiniteCanvas } from '@/components/infinite-canvas/InfiniteCanvas';
import { useCanvasStore } from '@/components/infinite-canvas/use-canvas-store';
import './agent.css';

export interface AgentModeProps {
  projectId: string;
}

export const AgentMode: React.FC<AgentModeProps> = ({ projectId }) => {
  const [goal, setGoal] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [thoughtOpen, setThoughtOpen] = useState(false);
  const [toolDrawerOpen, setToolDrawerOpen] = useState(false);
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  // 用户在 Agent 模式顶栏手动选择的 LLM provider/model
  // 空值表示回退到 scriptGeneration 步骤绑定 / stub
  const [selectedProviderId, setSelectedProviderId] = useState<string>('');
  const [selectedModelId, setSelectedModelId] = useState<string>('');
  // LLM provider 列表 — 从后端 DB 拉取（与 ApiSettings 同步的"真"数据源）
  // 而不是从 localStorage 的 apiConfig.providers（可能与 DB 不一致）
  const [dbProviders, setDbProviders] = useState<Array<{
    provider_id: string;
    name: string;
    chat_models: string[];
    default_model: string;
  }>>([]);
  const [dbProvidersLoading, setDbProvidersLoading] = useState(false);

  // 画布容器 ref（用于 fitAgentView 时获取 board 尺寸）
  const canvasContainerRef = useRef<HTMLDivElement | null>(null);

  // 加载 DB 里的 LLM provider 列表
  useEffect(() => {
    let mounted = true;
    setDbProvidersLoading(true);
    api.listLLMProviders()
      .then((rows) => {
        if (!mounted) return;
        const list = (rows || []).map((r) => ({
          provider_id: r.provider_id,
          name: r.provider_id,
          chat_models: r.chat_models || [],
          default_model: r.default_model || '',
        }));
        setDbProviders(list);
        // 自动选第一个 provider（让用户不手动选也能跑真实 LLM，避免无脑走 DevScriptedLLM 假任务）
        if (list.length > 0) {
          setSelectedProviderId(list[0].provider_id);
          setSelectedModelId(list[0].default_model || '');
        }
      })
      .catch(() => {
        if (!mounted) return;
        setDbProviders([]);
      })
      .finally(() => {
        if (mounted) setDbProvidersLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, [projectId]);

  // 优先用 DB 里的 LLM provider 列表（数据源唯一：DB 才是真）
  // 兜底用 localStorage 的 apiConfig.providers
  const apiConfigFallback = useCanvasStore((s) => s.apiConfig);
  const availableProviders = (dbProviders.length > 0
    ? dbProviders.map((p) => ({
        id: p.provider_id,
        name: p.provider_id,
        chatModels: p.chat_models,
      }))
    : apiConfigFallback.providers
        .filter((p) => p.enabled !== false && p.chatModels && p.chatModels.length > 0)
        .map((p) => ({ id: p.id, name: p.name || p.id, chatModels: p.chatModels || [] }))
  );

  const taskId = useAgentStore((s) => s.taskId);
  const setTask = useAgentStore((s) => s.setTask);
  const setStatus = useAgentStore((s) => s.setStatus);
  const thoughts = useAgentStore((s) => s.thoughts);
  const actions = useAgentStore((s) => s.actions);
  const observations = useAgentStore((s) => s.observations);
  const plan = useAgentStore((s) => s.plan);
  const artifacts = useAgentStore((s) => s.artifacts);
  const pendingQuestion = useAgentStore((s) => s.pendingQuestion);
  const status = useAgentStore((s) => s.status);
  const llmMode = useAgentStore((s) => s.llmMode);
  const llmFallbackReason = useAgentStore((s) => s.llmFallbackReason);

  const { tools, isLoading: toolsLoading } = useAgentTools();
  // SSE 由全局 agent-stream-manager 管理：基于 useAgentStore.taskId 自动开关
  // useAgentStream(taskId)  // 不再调用，避免重复连接

  // 跟踪上一次投影到画布的相关切片引用（thoughts/actions/observations/plan/artifacts/pendingQuestion）。
  // 只有这 6 个 slice 的引用变化才需要重跑 project()。
  // 其他 slice（totalCostUsd/totalTokens/error/pendingPlan/taskId/status）变化不触发，避免无意义的
  // addAgentNodes → 内部 setState → saveNodes debounced POST 抖动。
  const lastProjectedRef = useRef<{
    thoughts: unknown;
    actions: unknown;
    observations: unknown;
    plan: unknown;
    artifacts: unknown;
    pendingQuestion: unknown;
  } | null>(null);

  // 投影：useAgentStore 状态变化 → useCanvasStore.addAgentNodes
  useEffect(() => {
    const project = () => {
      const state = useAgentStore.getState();
      const last = lastProjectedRef.current;
      if (
        last &&
        last.thoughts === state.thoughts &&
        last.actions === state.actions &&
        last.observations === state.observations &&
        last.plan === state.plan &&
        last.artifacts === state.artifacts &&
        last.pendingQuestion === state.pendingQuestion
      ) {
        return;
      }
      const userGoal = state.status === 'running' || state.status === 'paused' || state.status === 'done' || state.status === 'failed'
        ? (state.thoughts[0]?.payload?.text as string) || ''
        : '';
      useCanvasStore.getState().addAgentNodes({
        userGoal,
        plan: state.plan,
        actions: state.actions,
        observations: state.observations,
        artifacts: state.artifacts,
        pendingQuestion: state.pendingQuestion,
      });
      lastProjectedRef.current = {
        thoughts: state.thoughts,
        actions: state.actions,
        observations: state.observations,
        plan: state.plan,
        artifacts: state.artifacts,
        pendingQuestion: state.pendingQuestion,
      };
      // 节点更新后自动 fit 视图，让用户一眼看到完整时间线
      // 多次 fit 不会重复触发太多（zustand 内部 setState 节流）
      const container = canvasContainerRef.current;
      if (container) {
        const r = container.getBoundingClientRect();
        // 延后一帧：等 React 完成渲染 + DOM 更新后再 fit
        requestAnimationFrame(() => {
          const cs = useCanvasStore.getState();
          if (cs.nodes.filter((n) => n.type === 'agent_node').length === 0) {
            // 还没有节点：把 viewport 移到 (0, 0) 区域，避免 viewport 停留在 (-1800, -1000)
            cs.resetViewportToAgentOrigin(r.width, r.height);
          } else {
            cs.fitAgentView(r.width, r.height);
          }
        });
      }
    };
    lastProjectedRef.current = null;
    project();
    const unsubscribe = useAgentStore.subscribe(project);
    return () => {
      unsubscribe();
      useCanvasStore.getState().clearAgentNodes();
    };
  }, [projectId]);

  // 组件挂载时：把 viewport 立即移到 agent 节点区域（避免 viewport 默认在 (-1800, -1000) 远离节点）
  useEffect(() => {
    let cancelled = false;
    // 等一帧让 DOM 渲染完
    requestAnimationFrame(() => {
      if (cancelled) return;
      const container = canvasContainerRef.current;
      if (!container) return;
      const r = container.getBoundingClientRect();
      const cs = useCanvasStore.getState();
      if (cs.nodes.filter((n) => n.type === 'agent_node').length === 0) {
        cs.resetViewportToAgentOrigin(r.width, r.height);
      } else {
        cs.fitAgentView(r.width, r.height);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  // 任务状态变化 → 触发 TaskList 刷新
  useEffect(() => {
    if (status === 'done' || status === 'failed') {
      setRefreshTrigger((v) => v + 1);
    }
  }, [status]);

  const onSubmit = async () => {
    if (!goal.trim() || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      // 1) 优先用用户在 Agent 模式顶栏手动选择的 provider/model
      // 2) 否则自动选 DB 里第一个可用的真实 LLM（避免无脑走 DevScriptedLLM 假任务）
      // 3) 都没有 → 走 stub，但提示用户去 API 设置里配 LLM
      let providerId: string | undefined = selectedProviderId;
      let modelId: string | undefined = selectedModelId;
      if (!providerId) {
        if (dbProviders.length > 0) {
          const first = dbProviders[0];
          providerId = first.provider_id;
          modelId = selectedModelId || first.default_model || undefined;
        } else {
          const apiConfig = useCanvasStore.getState().apiConfig;
          const llmBinding = apiConfig.stepBindings.find(
            (b) => b.step === 'scriptGeneration',
          );
          providerId = llmBinding?.providerId || undefined;
          modelId = modelId || llmBinding?.modelId || undefined;
        }
      }
      const t = await api.startAgent(projectId, goal.trim(), {
        providerId,
        modelId,
      });
      setTask(t.id, 'running', projectId);
      setGoal('');
      // 创建后立刻打开 ThoughtStream，让用户立即看到 agent 进度
      setThoughtOpen(true);
      // 触发 TaskList 刷新
      setRefreshTrigger((v) => v + 1);
    } catch (e: any) {
      setError(e?.message || 'failed to start agent');
    } finally {
      setSubmitting(false);
    }
  };

  // 整理节点 / 重排画布视图：让用户一键修复节点乱跑、视图错位
  const onRelayout = () => {
    useCanvasStore.getState().relayoutAgentNodes();
    const container = canvasContainerRef.current;
    if (container) {
      const r = container.getBoundingClientRect();
      requestAnimationFrame(() => {
        useCanvasStore.getState().fitAgentView(r.width, r.height);
      });
    }
  };

  const onRefresh = () => setRefreshTrigger((v) => v + 1);

  // 当前任务的进度提示文字
  const progressHint = (() => {
    if (status === 'running') return `正在思考…(${thoughts.length} 个想法, ${actions.length} 个动作)`;
    if (status === 'paused') return pendingQuestion ? '等待你的回复' : '已暂停';
    if (status === 'done') return '任务完成';
    if (status === 'failed') return '任务失败';
    return '';
  })();

  return (
    <div
      data-testid="agent-mode"
      className="canvas-board"
      style={{ display: 'grid', gridTemplateColumns: '300px 1fr', height: '100vh', position: 'relative' }}
    >
      <aside
        data-testid="agent-mode-left-aside"
        className="agent-aside"
      >
        <div className="agent-aside-head">
          <span className="agent-aside-title">任务</span>
        </div>
        <TaskList
          projectId={projectId}
          refreshTrigger={refreshTrigger}
          onSelect={(id) => {
            setTask(id, 'running', projectId);
            setThoughtOpen(true);
          }}
          selectedId={taskId}
        />
      </aside>
      <main style={{ position: 'relative', overflow: 'hidden', background: 'var(--canvas-bg)' }}>
        <div
          data-testid="agent-mode-input-bar"
          className="canvas-topbar"
          style={{ padding: '10px 14px', zIndex: 40, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}
        >
          {/* LLM provider/model 选择 — 黑白灰样式 */}
          <div className="canvas-panel" style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '2px 6px' }}>
            <span style={{ fontSize: 10, color: 'var(--muted)', fontWeight: 600, marginRight: 4 }}>LLM</span>
            <select
              data-testid="agent-mode-llm-provider"
              value={selectedProviderId}
              onChange={(e) => {
                setSelectedProviderId(e.target.value);
                setSelectedModelId(''); // 切换 provider 后清空 model 选择
              }}
              title={availableProviders.length === 0
                ? '⚠️ DB 里没有 LLM provider 配置 → agent 会用 DevScriptedLLM（假任务）'
                : '选择 LLM 提供商（空 = 使用 scriptGeneration 步骤绑定）'}
              style={{
                height: 26,
                fontSize: 11,
                background: 'var(--bg)',
                color: availableProviders.length === 0 ? 'var(--muted)' : 'var(--text)',
                border: `1px solid ${availableProviders.length === 0 ? 'var(--line-strong)' : 'var(--line)'}`,
                borderRadius: 4,
                padding: '0 4px',
                outline: 'none',
              }}
            >
              <option value="">{dbProvidersLoading ? '加载中…' : '默认（步骤绑定）'}</option>
              {availableProviders.map((p) => (
                <option key={p.id} value={p.id}>{p.name || p.id}</option>
              ))}
            </select>
            {selectedProviderId && (() => {
              const p = availableProviders.find((x) => x.id === selectedProviderId);
              const models = p?.chatModels || [];
              if (!models.length) return null;
              return (
                <select
                  data-testid="agent-mode-llm-model"
                  value={selectedModelId}
                  onChange={(e) => setSelectedModelId(e.target.value)}
                  title="选择 LLM 模型"
                  style={{
                    height: 26,
                    fontSize: 11,
                    background: 'var(--bg)',
                    color: 'var(--text)',
                    border: '1px solid var(--line)',
                    borderRadius: 4,
                    padding: '0 4px',
                    outline: 'none',
                    maxWidth: 160,
                  }}
                >
                  <option value="">默认模型</option>
                  {models.map((m) => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                </select>
              );
            })()}
          </div>
          <div className="canvas-panel" style={{ flex: 1, borderRadius: 999, padding: '4px 6px 4px 14px', display: 'flex', alignItems: 'center', gap: 8 }}>
            <input
              data-testid="agent-mode-input"
              value={goal}
              onChange={(e) => setGoal(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  onSubmit();
                }
              }}
              placeholder="描述目标，例如：做一个 30 秒的雨夜短片"
              style={{ flex: 1, border: 0, outline: 'none', background: 'transparent', color: 'var(--text)', fontSize: 13 }}
            />
            <button
              data-testid="agent-mode-submit"
              onClick={onSubmit}
              disabled={submitting || !goal.trim()}
              className="tool-btn"
              style={{
                height: 28,
                padding: '0 12px',
                background: submitting || !goal.trim() ? 'var(--soft)' : 'var(--text)',
                color: submitting || !goal.trim() ? 'var(--muted)' : 'var(--panel)',
                borderColor: 'var(--text)',
                fontWeight: 700,
              }}
            >
              {submitting ? '创建中…' : '创建任务'}
            </button>
          </div>
          <div className="canvas-panel" style={{ padding: 4, display: 'flex', gap: 4 }}>
            <button
              data-testid="agent-mode-fit-view"
              type="button"
              onClick={() => {
                const container = canvasContainerRef.current;
                if (!container) return;
                const r = container.getBoundingClientRect();
                useCanvasStore.getState().fitAgentView(r.width, r.height);
              }}
              className="tool-btn"
              title="缩放到完整时间线（自动 fit）"
            >
              ⊡
            </button>
            <button
              data-testid="agent-mode-relayout"
              type="button"
              onClick={onRelayout}
              className="tool-btn"
              title="自动整理节点布局并缩放到完整时间线"
            >
              <RotateCw size={14} />
            </button>
            <button
              data-testid="agent-mode-thought-toggle"
              type="button"
              onClick={() => setThoughtOpen((v) => !v)}
              className={`tool-btn ${thoughtOpen ? 'active' : ''}`}
              title="ThoughtStream"
            >
              💭
            </button>
            <button
              data-testid="agent-mode-tool-drawer-toggle"
              type="button"
              onClick={() => setToolDrawerOpen((v) => !v)}
              className={`tool-btn ${toolDrawerOpen ? 'active' : ''}`}
              title="ToolPalette"
            >
              🔧
            </button>
            <button
              data-testid="exit-agent-mode"
              type="button"
              onClick={() => {
                // 通知 App 层退出：保留 taskId 在 store 里，后台继续订阅
                window.dispatchEvent(new CustomEvent('agent-mode-exit'));
              }}
              className="tool-btn"
              title="退出 Agent Mode（任务在后台继续）"
            >
              ← 退出
            </button>
          </div>
        </div>
        {/* 进度提示条 — 让用户在不打开 ThoughtStream 的情况下也能看到 agent 在做什么 */}
        {taskId && progressHint && (
          <div
            data-testid="agent-mode-progress"
            className={`agent-mode-progress ${status}`}
            onClick={() => setThoughtOpen(true)}
          >
            <span className={`agent-mode-progress-dot ${status}`} />
            <span className="agent-mode-progress-text">{progressHint}</span>
            <span className="agent-mode-progress-hint">点击查看详情</span>
          </div>
        )}
        {/* LLM 模式横幅：明示当前 agent 是真实 LLM 还是 Dev 假任务 */}
        {taskId && (
          <div
            data-testid="agent-llm-mode-banner"
            className={`agent-llm-mode-banner ${llmMode || 'pending'}`}
            title={llmFallbackReason || (llmMode === 'real' ? '已连接真实 LLM' : llmMode === 'stub' ? 'DevScriptedLLM 假任务' : '等待 task_started 事件上报 LLM 模式...')}
          >
            {llmMode === 'real' ? (
              <>
                <span className="agent-llm-mode-dot" />
                <span>已连接真实 LLM — 正在调用供应商</span>
              </>
            ) : llmMode === 'stub' ? (
              <>
                <span className="agent-llm-mode-dot" />
                <span>Dev 假任务（DevScriptedLLM）：去 API 设置里配置 LLM key 才会用真模型</span>
              </>
            ) : (
              <>
                <span className="agent-llm-mode-dot" />
                <span>等待后端启动 runtime...</span>
              </>
            )}
          </div>
        )}
        {error && (
          <div
            data-testid="agent-mode-error"
            className="agent-mode-error"
          >
            {error}
          </div>
        )}
        <div ref={canvasContainerRef} data-testid="agent-mode-canvas-container" style={{ position: 'absolute', inset: 0, overflow: 'hidden' }}>
          <style>{`
            [data-testid="agent-mode-canvas-container"] .canvas-root {
              width: 100% !important;
              height: 100% !important;
            }
          `}</style>
          <InfiniteCanvas projectId={projectId} hideToolbar />
          <ErrorRecoveryCard />
        </div>

        {/* 浮层 ThoughtStream */}
        <ThoughtStream floating open={thoughtOpen} onClose={() => setThoughtOpen(false)} />

        {/* 抽屉 ToolPalette */}
        <aside
          data-testid={toolDrawerOpen ? 'agent-mode-tool-drawer-open' : undefined}
          className={`agent-tool-drawer ${toolDrawerOpen ? '' : 'closed'}`}
          aria-hidden={!toolDrawerOpen}
        >
          <div className="agent-tool-drawer-head">
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              🔧 工具面板
            </span>
            <button
              data-testid="agent-mode-tool-drawer-close"
              type="button"
              aria-label="close"
              onClick={() => setToolDrawerOpen(false)}
            >
              <X size={14} />
            </button>
          </div>
          <div className="agent-tool-drawer-body">
            {toolsLoading ? (
              <div className="agent-tool-drawer-loading">loading tools…</div>
            ) : (
              <ToolPalette tools={tools} actions={actions} />
            )}
          </div>
        </aside>
      </main>
    </div>
  );
};

export default AgentMode;
