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
  // LLM provider 列表 — 从后端统一 provider_configs 表拉取（Task 5 后 /api/llm-providers
  // 返回真实数据，与 ApiSettings 共享同一张表，不再有 media/llm 两套数据源断层）
  // 兜底用 localStorage 的 apiConfig.providers（基本不触发，保留作防御）
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
    api.listProviders()
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

  // 优先用 DB 里的 LLM provider 列表（数据源唯一：统一 provider_configs 表）
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

      // Defensive sync: 如果选中的 provider 还在 localStorage 但已不在 DB，
      // 先把它的 baseUrl / apiKey / models 推回 DB，避免后端 load_llm_configs
      // 拿不到 provider 而回退到 DevScriptedLLM 假任务。
      if (providerId) {
        const inDb = dbProviders.some((p) => p.provider_id === providerId);
        if (!inDb) {
          const local = useCanvasStore.getState().apiConfig.providers.find(
            (p) => p.id === providerId,
          );
          if (local && local.baseUrl) {
            try {
              await api.upsertProvider(providerId, {
                name: local.name || providerId,
                base_url: local.baseUrl,
                api_key: local.apiKey || '',
                default_model: modelId || local.defaultModel || '',
                protocol: local.protocol || 'openai',
                enabled: local.enabled !== false,
                chat_models: local.chatModels || [],
                image_models: local.imageModels || [],
                video_models: local.videoModels || [],
                extra_config: {},
              });
            } catch (e: any) {
              console.warn('[agent-mode] failed to sync provider to DB', e);
            }
          }
        }
      }

      const t = await api.startAgent(projectId, goal.trim(), {
        providerId,
        modelId,
      });
      setTask(t.id, 'running', projectId);
      // 后端在 TASK_STARTED 事件里也会再发一次 llm_mode，但 SSE 推送有几十 ms 延迟，
      // 提前把 store.llmMode 写成 'real'（只要选了 provider/model 就是真实 LLM），
      // 避免 UI 闪一下"等待后端启动 runtime..."。
      if (providerId) {
        useAgentStore.getState().setStatus('running');
        useAgentStore.setState({ llmMode: 'real', llmFallbackReason: null });
      }
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
          onSelect={async (id) => {
            // 1. 切换 task：reset store 到 INITIAL + 写入新 taskId
            //    （setTask 内部已 reset，避免上一个 task 的 thoughts/actions 残留）
            setTask(id, 'running', projectId);
            setThoughtOpen(true);
            // 2. 异步 hydrate：从后端拉 task 的持久化状态（plan/artifacts/status/
            //    成本/pending_response），立即让 UI 显示"非空"内容。
            //    SSE 也会同时连接并重放历史 events（thought/action/observation），
            //    两者互补：hydrate 来自 DB（永久），SSE replay 来自内存（短期）。
            try {
              const snapshot = await api.getAgentTask(id);
              useAgentStore.getState().hydrate({
                user_goal: snapshot.user_goal,
                status: snapshot.status,
                plan: snapshot.plan,
                artifacts: (snapshot.artifacts as any) || {},
                pending_response: snapshot.pending_response,
                total_cost_usd: snapshot.total_cost_usd,
                total_tokens: snapshot.total_tokens,
                llm_provider_id: snapshot.llm_provider_id,
                llm_model_id: snapshot.llm_model_id,
              });
              // 顶栏 goal 输入框：让用户能看到这个 task 当时的目标
              if (typeof snapshot.user_goal === 'string' && snapshot.user_goal) {
                setGoal(snapshot.user_goal);
              }
            } catch (e) {
              // 静默失败：SSE 仍会重放 events，hydrate 缺失不影响最基本显示
              // eslint-disable-next-line no-console
              console.warn('[agent-mode] failed to hydrate task snapshot', e);
            }
          }}
          selectedId={taskId}
        />
      </aside>
      {/*
        main 用 flex column 把 [topbar / llm-banner / progress / canvas] 垂直堆叠。
        之前 topbar 是 position: absolute（继承自 .canvas-topbar），跟 position: relative
        的 LLM banner 在同一个流里互怼，导致组件叠成一坨。
        现在：topbar/banner 都是 flex 子项（position: relative），自然垂直排开；
        canvas 用 flex:1 吃掉剩余空间，不再 absolute inset:0 压住上面那俩。
      */}
      <main
        style={{
          position: 'relative',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          background: 'var(--canvas-bg)',
          minWidth: 0,
        }}
      >
        {/* ===== 输入栏 — 2 行布局：第 1 行 LLM 选择，第 2 行 目标输入 + 视图按钮 ===== */}
        <div
          data-testid="agent-mode-input-bar"
          className="agent-topbar"
          style={{
            padding: '8px 14px 10px',
            zIndex: 40,
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
            position: 'relative',
            flex: '0 0 auto',
          }}
        >
          {/* Row 1: LLM provider / model */}
          <div
            data-testid="agent-mode-llm-row"
            style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}
          >
            <div className="canvas-panel" style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '2px 6px' }}>
              <span style={{ fontSize: 10, color: 'var(--muted)', fontWeight: 600, marginRight: 4 }}>LLM</span>
              <select
                data-testid="agent-mode-llm-provider"
                value={selectedProviderId}
                onChange={(e) => {
                  setSelectedProviderId(e.target.value);
                  setSelectedModelId('');
                }}
                title={availableProviders.length === 0
                  ? '⚠️ DB 里没有 LLM provider 配置 → agent 会用 DevScriptedLLM（假任务）'
                  : '选择 LLM 提供商（空 = 使用 scriptGeneration 步骤绑定）'}
                style={{
                  height: 24,
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
                      height: 24,
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
          </div>

          {/* Row 2: 目标输入 + 视图按钮 + 进度状态 */}
          <div
            data-testid="agent-mode-goal-row"
            style={{ display: 'flex', alignItems: 'center', gap: 6 }}
          >
            <div className="canvas-panel" style={{ flex: 1, borderRadius: 999, padding: '4px 6px 4px 14px', display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
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
                style={{ flex: 1, border: 0, outline: 'none', background: 'transparent', color: 'var(--text)', fontSize: 13, minWidth: 0 }}
              />
              <button
                data-testid="agent-mode-submit"
                onClick={onSubmit}
                disabled={submitting || !goal.trim()}
                className="tool-btn"
                style={{
                  height: 26,
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
            <div className="canvas-panel" style={{ padding: 3, display: 'flex', gap: 3 }}>
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
                style={{ padding: 6 }}
              >
                ⊡
              </button>
              <button
                data-testid="agent-mode-relayout"
                type="button"
                onClick={onRelayout}
                className="tool-btn"
                title="自动整理节点布局并缩放到完整时间线"
                style={{ padding: 6 }}
              >
                <RotateCw size={13} />
              </button>
              <button
                data-testid="agent-mode-thought-toggle"
                type="button"
                onClick={() => setThoughtOpen((v) => !v)}
                className={`tool-btn ${thoughtOpen ? 'active' : ''}`}
                title="ThoughtStream"
                style={{ padding: 6 }}
              >
                💭
              </button>
              <button
                data-testid="agent-mode-tool-drawer-toggle"
                type="button"
                onClick={() => setToolDrawerOpen((v) => !v)}
                className={`tool-btn ${toolDrawerOpen ? 'active' : ''}`}
                title="ToolPalette"
                style={{ padding: 6 }}
              >
                🔧
              </button>
              <button
                data-testid="exit-agent-mode"
                type="button"
                onClick={() => {
                  window.dispatchEvent(new CustomEvent('agent-mode-exit'));
                }}
                className="tool-btn"
                title="退出 Agent Mode（任务在后台继续）"
                style={{ padding: 6 }}
              >
                ←
              </button>
            </div>
          </div>
        </div>

        {/*
          canvas 容器 — flex:1 吃掉 topbar 之后剩余的所有空间。
          进度条 / LLM 横幅 / 错误提示都改成画布内的浮动覆盖层，
          不再占用顶部垂直空间。
        */}
        <div
          ref={canvasContainerRef}
          data-testid="agent-mode-canvas-container"
          style={{ position: 'relative', flex: '1 1 auto', minHeight: 0, overflow: 'hidden' }}
        >
          <style>{`
            [data-testid="agent-mode-canvas-container"] .canvas-root {
              width: 100% !important;
              height: 100% !important;
            }
          `}</style>
          <InfiniteCanvas projectId={projectId} hideToolbar />
          <ErrorRecoveryCard />
          <AskUserResponse />

          {/* 浮动错误提示 — 画布顶部居中 */}
          {error && (
            <div
              data-testid="agent-mode-error"
              className="agent-mode-error"
              style={{
                position: 'absolute',
                top: 10,
                left: '50%',
                transform: 'translateX(-50%)',
                zIndex: 30,
                maxWidth: 'min(480px, calc(100% - 28px))',
              }}
            >
              {error}
            </div>
          )}

          {/* 浮动状态栏 — 画布左下角，合并 LLM 模式 + 进度 */}
          {taskId && (progressHint || llmMode) && (
            <div
              data-testid="agent-mode-progress"
              className={`agent-mode-progress ${status}`}
              onClick={() => setThoughtOpen(true)}
              style={{
                position: 'absolute',
                bottom: 12,
                left: 12,
                zIndex: 30,
                margin: 0,
                alignSelf: 'auto',
              }}
            >
              <span className={`agent-mode-progress-dot ${status}`} />
              {progressHint && (
                <span className="agent-mode-progress-text">{progressHint}</span>
              )}
              {/* LLM 模式指示器 — 内联在进度条里，不再单独占一行 */}
              {llmMode === 'real' && (
                <span className="agent-llm-badge real" title={llmFallbackReason || '已连接真实 LLM'}>LLM</span>
              )}
              {llmMode === 'stub' && (
                <span className="agent-llm-badge stub" title="DevScriptedLLM 假任务">STUB</span>
              )}
              {llmMode === null && (
                <span className="agent-llm-badge pending" title="等待 task_started 事件上报 LLM 模式">…</span>
              )}
              {progressHint && (
                <span className="agent-mode-progress-hint">点击查看详情</span>
              )}
            </div>
          )}
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

/**
 * AskUserResponse — agent 调用 ask_user 时显示输入卡。
 * 让用户输入回复 → 调 respondAgent + resumeAgent，runtime 从 PAUSED 恢复。
 *
 * 设计要点：
 * 1. 防御性去重 question 文本里的编号列表（"1. ... 2. ..."）——
 *    即使 LLM 把选项也写进 question 字段，前端也不会和按钮重复展示。
 * 2. option 按钮 onClick 必须 stopPropagation + preventDefault，
 *    否则会被 InfiniteCanvas 的 board mousedown 当成"开始拖动画布"吃掉，
 *    看起来要按 2 次才能发送。
 * 3. 弹窗定位：右下方、不挡住画布中心的 agent_node 流程。
 */
const AskUserResponse: React.FC = () => {
  const taskId = useAgentStore((s) => s.taskId);
  const pendingQuestion = useAgentStore((s) => s.pendingQuestion);
  const [answer, setAnswer] = React.useState('');
  const [submitting, setSubmitting] = React.useState(false);

  // 切换 pendingQuestion 时清空旧答案
  React.useEffect(() => {
    setAnswer('');
  }, [pendingQuestion?.question]);

  if (!taskId || !pendingQuestion) return null;

  const onSubmit = async (text: string, e?: React.MouseEvent | React.KeyboardEvent) => {
    e?.stopPropagation();
    e?.preventDefault();
    if (!text.trim() || submitting) return;
    setSubmitting(true);
    try {
      // 1. 把用户响应写进 task.pending_response
      await api.respondAgent(taskId, { response: text.trim() });
      // 2. 触发后端从 PAUSED 恢复
      await api.resumeAgent(taskId);
    } catch (e) {
      console.error('[ask-user] failed to respond', e);
    } finally {
      setSubmitting(false);
    }
  };

  // 选项归一化
  const rawOptions = (pendingQuestion as any).options as any[] | undefined;
  const options: string[] = Array.isArray(rawOptions)
    ? rawOptions
        .map((opt: any) => typeof opt === 'string' ? opt : (opt?.label ?? opt?.value ?? ''))
        .filter((s) => s && String(s).trim())
    : [];

  // 防御性去重：如果 question 里也有 "1) ... 2) ..." 这种和 options 重叠的列表，
  // 截到第一个 "1)" / "1." / "1、" 之前，避免和按钮重复展示
  // （覆盖半角 1 / 全角 1、半角 ) / 全角 ） 、半角 . / 全角 。等常见编号形式）
  const questionText = (() => {
    const q = String(pendingQuestion.question || '');
    if (options.length === 0) return q;
    const m = q.match(/[\n\r;；]\s*[1-9１-９][.。)）:：、]\s*/);
    return m && typeof m.index === 'number' ? q.slice(0, m.index).trim() : q;
  })();

  return (
    <div
      data-testid="ask-user-response"
      onMouseDown={(e) => e.stopPropagation()}  // 防止画布把卡内点击当成拖动
      style={{
        position: 'absolute',
        // 底部居中：避免被右下角的 ThoughtStream 抽屉遮挡
        left: '50%',
        bottom: 14,
        transform: 'translateX(-50%)',
        width: 'min(480px, calc(100vw - 28px))',
        maxHeight: 'calc(100vh - 120px)',
        background: 'var(--panel)',
        border: '1px solid var(--line)',
        borderRadius: 10,
        boxShadow: '0 12px 32px rgba(0,0,0,0.18)',
        padding: 12,
        zIndex: 25,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        overflow: 'auto',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ fontSize: 14 }}>❓</span>
        <strong style={{ fontSize: 13 }}>agent 正在等你的回复</strong>
      </div>
      <div
        data-testid="ask-user-question"
        style={{ color: 'var(--text)', fontSize: 13, lineHeight: 1.5, whiteSpace: 'pre-wrap' }}
      >
        {questionText}
      </div>
      {/* 选项按钮（如果有） */}
      {options.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {options.map((opt, i) => (
            <button
              key={i}
              type="button"
              data-testid={`ask-user-option-${i}`}
              onMouseDown={(e) => e.stopPropagation()}  // 防止画布 onMouseDown 抢占点击
              onClick={(e) => onSubmit(opt, e)}
              disabled={submitting}
              className="tool-btn"
              style={{ padding: '5px 10px', fontSize: 12 }}
            >
              {opt}
            </button>
          ))}
        </div>
      )}
      {/* 自由输入 */}
      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <input
          data-testid="ask-user-input"
          value={answer}
          onChange={(e) => setAnswer(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) onSubmit(answer, e);
          }}
          onMouseDown={(e) => e.stopPropagation()}
          placeholder="或直接输入…"
          disabled={submitting}
          style={{
            flex: 1,
            padding: '6px 10px',
            border: '1px solid var(--line)',
            borderRadius: 6,
            background: 'var(--bg)',
            color: 'var(--text)',
            fontSize: 12,
            outline: 'none',
            minWidth: 0,
          }}
        />
        <button
          data-testid="ask-user-submit"
          type="button"
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => onSubmit(answer, e)}
          disabled={submitting || !answer.trim()}
          className="tool-btn"
          style={{
            padding: '6px 12px',
            fontSize: 12,
            background: submitting || !answer.trim() ? 'var(--soft)' : 'var(--text)',
            color: submitting || !answer.trim() ? 'var(--muted)' : 'var(--panel)',
            borderColor: 'var(--text)',
            fontWeight: 700,
          }}
        >
          {submitting ? '发送中…' : '发送'}
        </button>
      </div>
    </div>
  );
};

export default AgentMode;
