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
// 启动全局 SSE manager：原来由 App.tsx 顶层副作用 import 触发，会强制首屏加载整个 agent 子树。
// 现改为 AgentMode 首次挂载时按需 import，避免首屏 transform 瀑布。
async function ensureStreamManagerStarted(): Promise<void> {
  await import('./agent-stream-manager');
}
// useAgentStream 由全局 agent-stream-manager 管理（App 启动时引入），
// 此处不再调用，避免与全局管理器创建重复连接。
import { useAgentTools } from './use-agent-tools';
import { ThoughtStream } from './thought-stream';
import { ToolPalette } from './tool-palette';
import { TaskList } from './task-list';
import { AgentPetController } from './agent-pet-controller';
import { api } from '@/services/apiClient';
import { useCanvasStore } from '@/components/infinite-canvas/use-canvas-store';
import { getBindingForStep } from '@/types';
import { useI18n } from '@/i18n';
import { PromptLibraryPanel } from '../components/PromptLibraryPanel';
import './agent.css';

export interface AgentModeProps {
  projectId: string;
  canvasContainerRef?: React.RefObject<HTMLDivElement | null>;
}

export const AgentMode: React.FC<AgentModeProps> = ({ projectId, canvasContainerRef: externalCanvasContainerRef }) => {
  const { lang } = useI18n();
  const [goal, setGoal] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [thoughtOpen, setThoughtOpen] = useState(false);
  const [toolDrawerOpen, setToolDrawerOpen] = useState(false);
  const [taskDrawerOpen, setTaskDrawerOpen] = useState(true);
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const [promptLibraryOpen, setPromptLibraryOpen] = useState(false);
  // LLM 错误 banner 状态：从 store 读（runtime LLMError 触发），与本地 error 互不干扰。
  // 出现时必须显眼（顶部 banner + 抖动动画），不能让用户误以为 agent 还在跑。
  const llmError = useAgentStore((s) => s.llmError);
  const llmErrorAt = useAgentStore((s) => s.llmErrorAt);
  const clearLlmError = useAgentStore((s) => s.clearLlmError);
  // 任务级错误（task_failed / resume 回滚 / 提交看门狗超时写入的 store.error）。
  // 之前这个字段没有任何 UI 渲染——线上事故里用户提交回复后 resume 失败，
  // 前端把 error 写进 store 却无处展示，UI 卡在"已提交"无限等待。
  const taskError = useAgentStore((s) => s.error);
  const clearTaskError = useAgentStore((s) => s.clearError);
  const pendingQuestion = useAgentStore((s) => s.pendingQuestion);
  // 画布容器 ref（用于 fitAgentView 时获取 board 尺寸）
  const internalCanvasContainerRef = useRef<HTMLDivElement | null>(null);
  const canvasContainerRef = externalCanvasContainerRef || internalCanvasContainerRef;

  // Agent 与普通画布共用同一份 API 配置；脚本生成步骤的绑定决定所用模型。
  const apiConfig = useCanvasStore((s) => s.apiConfig);
  const llmBinding = getBindingForStep(apiConfig, 'scriptGeneration');
  // 兼容旧配置：早期版本只保存了 provider，没有保存 step_bindings。
  // 仍从画布中已配置的 provider 选择模型，避免任务以空 LLM 配置启动后立即失败。
  const selectedProviderId = llmBinding?.providerId || undefined;
  const selectedModelId = llmBinding?.modelId || undefined;

  const taskId = useAgentStore((s) => s.taskId);
  const theme = useCanvasStore((s) => s.theme);
  const setTask = useAgentStore((s) => s.setTask);
  const setStatus = useAgentStore((s) => s.setStatus);
  const actions = useAgentStore((s) => s.actions);
  const status = useAgentStore((s) => s.status);

  const { tools, isLoading: toolsLoading } = useAgentTools();
  // SSE 由全局 agent-stream-manager 管理：基于 useAgentStore.taskId 自动开关
  // useAgentStream(taskId)  // 不再调用，避免重复连接

  // 跟踪上一次投影到画布的相关切片引用（thoughts/actions/observations/plan/artifacts/pendingQuestion）。
  // 只有这 6 个 slice 的引用变化才需要重跑 project()。
  // 其他 slice（totalCostUsd/totalTokens/error/pendingPlan/taskId/status）变化不触发，避免无意义的
  // addAgentNodes → 内部 setState → saveNodes debounced POST 抖动。
  const lastProjectedRef = useRef<{ artifacts: unknown } | null>(null);

  // The Agent store is a process-wide session store, while AgentMode is
  // mounted once per canvas project. Detach the previous project's session
  // before rendering this project's ThoughtStream or question UI.
  useEffect(() => {
    const state = useAgentStore.getState();
    if ((state.taskId || state.projectId) && state.projectId !== projectId) {
      state.reset();
    }
  }, [projectId]);

  // 启动全局 SSE manager：模块级副作用 import 会让首屏 transform 瀑布变深，
  // 改为 AgentMode 首次挂载时按需加载，触发 useAgentStore.subscribe 自动管理连接。
  useEffect(() => {
    void ensureStreamManagerStarted();
  }, []);

  // 投影：useAgentStore 状态变化 → useCanvasStore.addAgentNodes
  useEffect(() => {
    const project = () => {
      const state = useAgentStore.getState();
      const last = lastProjectedRef.current;
      if (
        last &&
        last.artifacts === state.artifacts
      ) {
        return;
      }
      useCanvasStore.getState().addAgentNodes({
        artifacts: state.artifacts,
      });
      lastProjectedRef.current = {
        artifacts: state.artifacts,
      };
      // 节点更新后自动 fit 视图，让用户一眼看到完整时间线
      // 多次 fit 不会重复触发太多（zustand 内部 setState 节流）
      const container = canvasContainerRef.current;
      if (container) {
        const r = container.getBoundingClientRect();
        // 延后一帧：等 React 完成渲染 + DOM 更新后再 fit
        requestAnimationFrame(() => {
          const cs = useCanvasStore.getState();
          if (cs.nodes.length === 0) {
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
      // Agent asset projections are persisted canvas nodes and must remain visible
      // after leaving Agent mode. Thought/action state belongs to ThoughtStream.
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
      if (cs.nodes.length === 0) {
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
      if (!selectedProviderId || !selectedModelId) {
        setError('未配置 LLM 能力绑定，请先在 API 设置中绑定 LLM 平台和模型。');
        return;
      }
      const providerId = selectedProviderId || undefined;
      const modelId = selectedModelId || undefined;

      // Defensive sync: 如果选中的 provider 还在 localStorage 但已不在 DB，
      // 先把它的 baseUrl / apiKey / models 推回 DB，避免后端 load_llm_configs
      // 拿不到 provider 而回退到 DevScriptedLLM 假任务。
      if (providerId) {
        const local = apiConfig.providers.find((p) => p.id === providerId);
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
                // 不传 extra_config：后端保留 DB 原值（自定义覆盖配置不被防御性同步清空）
              });
          } catch (e: any) {
            console.warn('[agent-mode] failed to sync provider to DB', e);
          }
        }
      }

      const t = await api.startAgent(projectId, goal.trim(), {
        providerId,
        modelId,
        language: lang,
      });
      setTask(t.id, 'running', projectId);
      // 后端在 TASK_STARTED 事件里也会再发一次 llm_mode，但 SSE 推送有几十 ms 延迟，
      // 提前把 store.llmMode 写成 'real'（只要画布步骤绑定了 provider 就是真实 LLM），
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
    // Agent 状态不投影到画布；资产布局由 addAgentNodes 统一处理。
    const container = canvasContainerRef.current;
    if (container) {
      const r = container.getBoundingClientRect();
      requestAnimationFrame(() => {
        useCanvasStore.getState().fitAgentView(r.width, r.height);
      });
    }
  };

  const onRefresh = () => setRefreshTrigger((v) => v + 1);
  const onFitView = () => {
    const container = canvasContainerRef.current;
    if (!container) return;
    const r = container.getBoundingClientRect();
    useCanvasStore.getState().fitAgentView(r.width, r.height);
  };

  // 当前任务的进度提示文字
  return (
    <div
      data-testid="agent-mode"
      data-agent-mode="true"
      className={`agent-mode-overlay theme-${theme}`}
      style={{ position: 'absolute', inset: 0, zIndex: 20, pointerEvents: 'none' }}
    >
      <aside
        data-testid="agent-mode-left-aside"
        className={`agent-aside${taskDrawerOpen ? '' : ' closed'}`}
      >
        <div className="agent-aside-head">
          <button
            type="button"
            className="agent-aside-toggle"
            data-testid="agent-mode-task-drawer-toggle"
            aria-label={taskDrawerOpen ? '收起任务栏' : '展开任务栏'}
            onClick={() => setTaskDrawerOpen((open) => !open)}
          >
            {taskDrawerOpen ? '‹' : '›'}
          </button>
          <span className="agent-aside-title">任务</span>
        </div>
        {taskDrawerOpen && <TaskList
          projectId={projectId}
          refreshTrigger={refreshTrigger}
          retryProviderId={selectedProviderId}
          retryModelId={selectedModelId}
          onSelect={async (id, listedStatus) => {
            // 1. 切换 task：reset store 到 INITIAL + 写入新 taskId
            //    （setTask 内部已 reset，避免上一个 task 的 thoughts/actions 残留）
            setThoughtOpen(true);
            // 先切换任务，再异步拉取快照；即使快照请求失败，当前任务也必须可见，
            // 避免 UI 回退到旧任务或表现为“没有选中任务”。
            // Use the list snapshot immediately so a failed/paused task never
            // flashes as "running" while the detail request is in flight.
            setTask(id, (listedStatus || 'running') as any, projectId);
            // 2. 异步 hydrate：并行拉取 task 快照 + 历史步骤（检查点模式）。
            //    - snapshot：plan/artifacts/status/成本/pending_response
            //    - steps：每一步的 thought/action/observation（持久化在 DB）
            //    两者互补：snapshot 恢复"当前状态"，steps 恢复"执行历史"。
            //    SSE 也会重放历史 events，但 SSE buffer 在内存中，后端重启后丢失；
            //    steps 来自 DB（永久），是可靠的检查点。
            try {
              const [snapshot, steps] = await Promise.all([
                api.getAgentTask(id),
                api.listAgentSteps(id),
              ]);
              setTask(id, snapshot.status as any, projectId);
              useAgentStore.getState().hydrate({
                user_goal: snapshot.user_goal,
                status: snapshot.status,
                plan: snapshot.plan,
                artifacts: (snapshot.artifacts as any) || {},
                pending_question: snapshot.pending_question,
                pending_response: snapshot.pending_response,
                task_profile: snapshot.task_profile as any,
                rule_pack_version: snapshot.rule_pack_version,
                total_cost_usd: snapshot.total_cost_usd,
                total_tokens: snapshot.total_tokens,
                llm_provider_id: snapshot.llm_provider_id,
                llm_model_id: snapshot.llm_model_id,
                // 关键：传入 steps 让 hydrate 能在 pending_question 缺失时
                // 从最近 ask_user step 提取真实问题文本（避免提问卡空白）。
                steps,
              });
              // 检查点：从 DB steps 恢复 thoughts/actions/observations 历史。
              // 在 hydrate 之后调用，避免被 setTask 的 reset 清空。
              // SSE 重放的相同 step 事件会被 hasEvent 去重，不会重复。
              useAgentStore.getState().hydrateSteps(steps);
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
        />}
      </aside>
      {/*
        main 用 flex column 把 [topbar / llm-banner / progress / canvas] 垂直堆叠。
        之前 topbar 是 position: absolute（继承自 .canvas-topbar），跟 position: relative
        的 LLM banner 在同一个流里互怼，导致组件叠成一坨。
        现在：topbar/banner 都是 flex 子项（position: relative），自然垂直排开；
        canvas 用 flex:1 吃掉剩余空间，不再 absolute inset:0 压住上面那俩。
      */}
      <main
        data-testid="agent-mode-overlay"
        className="agent-overlay-main"
      >
        {/* ===== 提示词模板库 toggle — 浮动在 topbar 区域，可切换右侧面板 ===== */}
        <button
          data-testid="prompt-library-toggle"
          className={`agent-topbar-btn ${promptLibraryOpen ? 'active' : ''}`}
          onClick={() => setPromptLibraryOpen(v => !v)}
          title="提示词模板库"
          style={{ position: 'absolute', top: 14, right: 14, zIndex: 45 }}
        >
          {/* bookmark icon */}
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M19 21l-7-5-7 5V5a2 2 0 012-2h10a2 2 0 012 2z" />
          </svg>
        </button>

        {/* ===== 输入栏 — 2 行布局：第 1 行 LLM 选择，第 2 行 目标输入 + 视图按钮 ===== */}
        {false && <div
          data-testid="agent-mode-input-bar"
          className="agent-topbar"
          style={{
            padding: '8px 14px 10px',
            zIndex: 40,
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
            position: 'absolute',
            flex: '0 0 auto',
          }}
        >
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
        </div>}

        {/*
          canvas 容器 — flex:1 吃掉 topbar 之后剩余的所有空间。
          进度条 / LLM 横幅 / 错误提示都改成画布内的浮动覆盖层，
          不再占用顶部垂直空间。
        */}
          <div
          data-testid="agent-mode-canvas-container"
          style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}
          >
          {/* LLM 调用错误 banner（runtime LLMError 触发）。
              与本地 error 互不干扰，必须显眼（红色背景 + 抖动动画），
              用户看到"已提交"卡上仍显示旧 ask_user 问题时，
              不会怀疑是 agent 卡住还是 LLM 挂了。 */}
          {llmError && (
            <div
              data-testid="agent-mode-llm-error"
              className="agent-mode-llm-error"
              role="alert"
              style={{
                position: 'absolute',
                top: 10,
                left: '50%',
                transform: 'translateX(-50%)',
                zIndex: 50,
                maxWidth: 'min(640px, calc(100% - 28px))',
                background: '#fff1f0',
                border: '1px solid #ffccc7',
                borderRadius: 8,
                padding: '12px 14px',
                boxShadow: '0 6px 24px rgba(255, 77, 79, 0.15)',
                animation: 'llmErrorPulse 0.6s ease-in-out 2',
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
                color: '#5c0011',
                // 父容器 pointerEvents: 'none' 会让所有子元素继承不可点击，
                // 这里必须显式开启才能让 × / 打开 API 设置 / 标记已查看 按钮响应事件
                pointerEvents: 'auto',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                <span
                  aria-hidden
                  style={{
                    fontSize: 18,
                    lineHeight: '20px',
                    flex: '0 0 auto',
                  }}
                >
                  ⚠
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      fontWeight: 600,
                      fontSize: 13,
                      marginBottom: 4,
                    }}
                  >
                    LLM 调用失败
                    {llmErrorAt &&
                      ` · ${Math.max(1, Math.floor((Date.now() - llmErrorAt) / 1000))}s 前`}
                  </div>
                  <div
                    style={{
                      fontSize: 12,
                      wordBreak: 'break-word',
                      maxHeight: 96,
                      overflow: 'auto',
                      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                    }}
                  >
                    {llmError}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => clearLlmError()}
                  aria-label="关闭"
                  style={{
                    background: 'transparent',
                    border: 0,
                    cursor: 'pointer',
                    fontSize: 16,
                    lineHeight: '16px',
                    color: '#5c0011',
                    padding: 0,
                    flex: '0 0 auto',
                  }}
                >
                  ×
                </button>
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button
                  type="button"
                  data-testid="llm-error-open-settings"
                  onClick={() => {
                    clearLlmError();
                    // 退出 agent 模式到主页，App.tsx 监听该事件后打开 API 设置
                    window.dispatchEvent(new CustomEvent('agent-mode-exit-and-open-settings'));
                  }}
                  style={{
                    background: '#ff4d4f',
                    color: '#fff',
                    border: 0,
                    borderRadius: 4,
                    padding: '6px 12px',
                    cursor: 'pointer',
                    fontSize: 12,
                    fontWeight: 500,
                  }}
                >
                  打开 API 设置
                </button>
                {pendingQuestion ? (
                  <span
                    style={{
                      fontSize: 12,
                      color: '#5c0011',
                      alignSelf: 'center',
                    }}
                  >
                    修复后请在下方问题里重新回答，agent 会自动重试
                  </span>
                ) : (
                  <button
                    type="button"
                    data-testid="llm-error-retry-new"
                    onClick={() => {
                      clearLlmError();
                      // 没有 pending question → 引导用户开新任务
                      setError(
                        'LLM 调用已失败，请先在 API 设置中修复 LLM provider，然后开新任务',
                      );
                    }}
                    style={{
                      background: '#fff',
                      color: '#5c0011',
                      border: '1px solid #ffccc7',
                      borderRadius: 4,
                      padding: '6px 12px',
                      cursor: 'pointer',
                      fontSize: 12,
                    }}
                  >
                    标记已查看
                  </button>
                )}
              </div>
            </div>
          )}

          {/* 任务级错误 banner — store.error（task_failed / resume 回滚 / 看门狗超时）。
              放在 LLM banner 下方（top:64），避免与 llmError / 本地 error 重叠。 */}
          {taskError && (
            <div
              data-testid="agent-mode-task-error"
              className="agent-mode-task-error"
              role="alert"
              style={{
                position: 'absolute',
                top: 64,
                left: '50%',
                transform: 'translateX(-50%)',
                zIndex: 45,
                maxWidth: 'min(640px, calc(100% - 28px))',
                background: '#fffbe6',
                border: '1px solid #ffe58f',
                borderRadius: 8,
                padding: '10px 14px',
                boxShadow: '0 6px 24px rgba(250, 173, 20, 0.15)',
                display: 'flex',
                alignItems: 'flex-start',
                gap: 10,
                color: '#613400',
                fontSize: 12,
                // 父容器 pointerEvents: 'none'，显式开启让关闭按钮可点
                pointerEvents: 'auto',
              }}
            >
              <span aria-hidden style={{ fontSize: 16, lineHeight: '18px', flex: '0 0 auto' }}>⚠</span>
              <div style={{ flex: 1, minWidth: 0, wordBreak: 'break-word' }}>{taskError}</div>
              <button
                type="button"
                data-testid="agent-mode-task-error-dismiss"
                onClick={() => clearTaskError()}
                aria-label="关闭"
                style={{
                  background: 'transparent',
                  border: 0,
                  cursor: 'pointer',
                  fontSize: 16,
                  lineHeight: '16px',
                  color: '#613400',
                  padding: 0,
                  flex: '0 0 auto',
                }}
              >
                ×
              </button>
            </div>
          )}

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
              {/* LLM 模式指示器 — 内联在进度条里，不再单独占一行 */}
        </div>

        {/* 提示词模板库 — 右侧浮层面板，由 topbar toggle 控制 */}
        {promptLibraryOpen && (
          <div style={{ position: 'absolute', top: 0, right: 0, bottom: 0, zIndex: 40 }}>
            <PromptLibraryPanel
              onInsert={(tmpl) => {
                // Insert positive prompt into the goal input
                setGoal(g => g ? `${g}\n\n${tmpl.positive}` : tmpl.positive);
              }}
            />
          </div>
        )}

        <AgentPetController
          projectId={projectId}
          containerRef={canvasContainerRef}
          goal={goal}
          submitting={submitting}
          error={error}
          onGoalChange={setGoal}
          onSubmit={onSubmit}
          thoughtOpen={thoughtOpen}
          onToggleThought={() => setThoughtOpen((v) => !v)}
          toolDrawerOpen={toolDrawerOpen}
          onToggleTools={() => setToolDrawerOpen((v) => !v)}
          onFitView={onFitView}
          onRelayout={onRelayout}
        />

        {/* 浮层 ThoughtStream */}
        <ThoughtStream floating open={thoughtOpen} onClose={() => setThoughtOpen(false)} />

        {/* 实时活动状态已合并到桌宠状态栏（AgentPetController.petStatusText），
            画布顶部不再单独显示 chip，避免与桌宠信息重复。 */}

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
const LegacyAskUserResponse: React.FC = () => {
  const taskId = useAgentStore((s) => s.taskId);
  const pendingQuestion = useAgentStore((s) => s.pendingQuestion);
  const [answer, setAnswer] = React.useState('');
  const [customText, setCustomText] = React.useState('');
  const [selected, setSelected] = React.useState<string[]>([]);
  const [submitting, setSubmitting] = React.useState(false);
  const [submitError, setSubmitError] = React.useState<string | null>(null);

  // 切换 pendingQuestion 时清空旧答案
  React.useEffect(() => {
    setAnswer('');
    setCustomText('');
    setSelected([]);
    setSubmitError(null);
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
