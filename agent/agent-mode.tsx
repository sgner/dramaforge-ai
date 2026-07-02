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
      const userGoal = state.status === 'running' || state.status === 'paused' || state.status === 'done'
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
    };
    lastProjectedRef.current = null;
    project();
    const unsubscribe = useAgentStore.subscribe(project);
    return () => {
      unsubscribe();
      useCanvasStore.getState().clearAgentNodes();
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
      // 从前端 apiConfig 里读 LLM provider 选择（仅 provider_id，不发 key）
      // 优先用 scriptGeneration 步骤的 LLM 绑定（最常走 LLM 的画布步骤）；
      // 没有则静默回退，让后端走 stub。
      const apiConfig = useCanvasStore.getState().apiConfig;
      const llmBinding = apiConfig.stepBindings.find(
        (b) => b.step === 'scriptGeneration'
      );
      const t = await api.startAgent(projectId, goal.trim(), {
        providerId: llmBinding?.providerId || undefined,
        modelId: llmBinding?.modelId || undefined,
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
          style={{ padding: '10px 14px', zIndex: 40 }}
        >
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
        {error && (
          <div
            data-testid="agent-mode-error"
            className="agent-mode-error"
          >
            {error}
          </div>
        )}
        <div data-testid="agent-mode-canvas-container" style={{ position: 'absolute', inset: 0, overflow: 'hidden' }}>
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
