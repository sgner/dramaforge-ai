/**
 * AgentMode — 顶级 agent 页面，组合输入栏 + TaskList + InfiniteCanvas + 浮层 ThoughtStream + 抽屉 ToolPalette。
 *
 * 数据流：
 *   - 输入目标 → api.startAgent → 拿到 taskId
 *   - useAgentStream(taskId) 订阅 SSE → useAgentStore.applyEvent 投影
 *   - useEffect 订阅 useAgentStore → 调 useCanvasStore.addAgentNodes 投影到画布
 *   - 切 projectId → useCanvasStore.clearAgentNodes
 *   - ThoughtStream 浮层右上，ToolPalette 抽屉右侧（默认关闭）
 */
import React, { useEffect, useState } from 'react';
import { useAgentStore } from './use-agent-store';
import { useAgentStream } from './use-agent-stream';
import { useAgentTools } from './use-agent-tools';
import { ThoughtStream } from './thought-stream';
import { ToolPalette } from './tool-palette';
import { TaskList } from './task-list';
import { api } from '@/services/apiClient';
import { InfiniteCanvas } from '@/components/infinite-canvas/InfiniteCanvas';
import { useCanvasStore } from '@/components/infinite-canvas/use-canvas-store';

export interface AgentModeProps {
  projectId: string;
}

export const AgentMode: React.FC<AgentModeProps> = ({ projectId }) => {
  const [goal, setGoal] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [thoughtOpen, setThoughtOpen] = useState(false);
  const [toolDrawerOpen, setToolDrawerOpen] = useState(false);

  const taskId = useAgentStore((s) => s.taskId);
  const setTask = useAgentStore((s) => s.setTask);
  const thoughts = useAgentStore((s) => s.thoughts);
  const actions = useAgentStore((s) => s.actions);
  const observations = useAgentStore((s) => s.observations);
  const plan = useAgentStore((s) => s.plan);
  const artifacts = useAgentStore((s) => s.artifacts);
  const pendingQuestion = useAgentStore((s) => s.pendingQuestion);

  const { tools, isLoading: toolsLoading } = useAgentTools();
  useAgentStream(taskId);

  // 投影：useAgentStore 状态变化 → useCanvasStore.addAgentNodes
  // 用 zustand subscribe（同步回调），确保 setState 后立即投影到画布
  useEffect(() => {
    const project = () => {
      const state = useAgentStore.getState();
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
    };
    // 立即投影一次初始状态
    project();
    // 订阅后续变化（同步触发）
    const unsubscribe = useAgentStore.subscribe(project);
    return () => {
      unsubscribe();
      useCanvasStore.getState().clearAgentNodes();
    };
  }, [projectId]);

  // 切换 projectId 时清理 agent_node
  useEffect(() => {
    useCanvasStore.getState().clearAgentNodes();
    return () => {
      useCanvasStore.getState().clearAgentNodes();
    };
  }, [projectId]);

  const onSubmit = async () => {
    if (!goal.trim() || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const t = await api.startAgent(projectId, goal.trim());
      setTask(t.id, 'running');
      setGoal('');
    } catch (e: any) {
      setError(e?.message || 'failed to start agent');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      data-testid="agent-mode"
      style={{ display: 'grid', gridTemplateColumns: '300px 1fr', height: '100vh', position: 'relative' }}
    >
      <aside
        data-testid="agent-mode-left-aside"
        style={{ borderRight: '1px solid #e2e8f0', overflowY: 'auto' }}
      >
        <div style={{ padding: 8 }}>
          <h3>任务</h3>
          <TaskList projectId={projectId} onSelect={(id) => setTask(id, 'running')} />
        </div>
      </aside>
      <main style={{ position: 'relative', overflow: 'hidden' }}>
        <div
          data-testid="agent-mode-input-bar"
          style={{
            position: 'absolute',
            top: 16,
            left: 16,
            right: 16,
            display: 'flex',
            gap: 8,
            zIndex: 20,
          }}
        >
          <input
            data-testid="agent-mode-input"
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
            placeholder="描述目标，例如：做一个 30 秒的雨夜短片"
            style={{ flex: 1, padding: 8, borderRadius: 6, border: '1px solid #cbd5e1' }}
          />
          <button
            data-testid="agent-mode-submit"
            onClick={onSubmit}
            disabled={submitting || !goal.trim()}
            style={{ padding: '8px 16px', borderRadius: 6, border: 0, background: '#6366f1', color: 'white', cursor: 'pointer' }}
          >
            {submitting ? '创建中…' : '创建任务'}
          </button>
          <button
            data-testid="agent-mode-thought-toggle"
            type="button"
            onClick={() => setThoughtOpen((v) => !v)}
            style={{ padding: '8px 12px', borderRadius: 6, border: '1px solid #cbd5e1', background: 'white', cursor: 'pointer' }}
            title="ThoughtStream"
          >
            💭
          </button>
          <button
            data-testid="agent-mode-tool-drawer-toggle"
            type="button"
            onClick={() => setToolDrawerOpen((v) => !v)}
            style={{ padding: '8px 12px', borderRadius: 6, border: '1px solid #cbd5e1', background: 'white', cursor: 'pointer' }}
            title="ToolPalette"
          >
            🔧
          </button>
        </div>
        {error && (
          <div
            data-testid="agent-mode-error"
            style={{
              position: 'absolute',
              top: 72,
              left: 16,
              color: 'red',
              background: 'rgba(254,226,226,0.95)',
              padding: '6px 10px',
              borderRadius: 6,
              zIndex: 20,
            }}
          >
            {error}
          </div>
        )}
        <div data-testid="agent-mode-canvas-container" style={{ position: 'absolute', inset: 0 }}>
          <InfiniteCanvas projectId={projectId} />
        </div>

        {/* 浮层 ThoughtStream */}
        <ThoughtStream floating open={thoughtOpen} onClose={() => setThoughtOpen(false)} />

        {/* 抽屉 ToolPalette — 始终在 DOM（保持老测试兼容），但通过 data-testid 和位置控制可见性 */}
        <aside
          data-testid={toolDrawerOpen ? 'agent-mode-tool-drawer-open' : undefined}
          style={{
            position: 'absolute',
            top: 72,
            right: toolDrawerOpen ? 16 : -10000,
            width: 280,
            maxHeight: 'calc(100vh - 96px)',
            background: 'white',
            border: '1px solid #e2e8f0',
            borderRadius: 10,
            boxShadow: toolDrawerOpen ? '0 4px 16px rgba(0,0,0,0.08)' : 'none',
            zIndex: 30,
            overflowY: 'auto',
            padding: 8,
            pointerEvents: toolDrawerOpen ? 'auto' : 'none',
          }}
          aria-hidden={!toolDrawerOpen}
        >
          {toolsLoading ? <div>loading tools…</div> : <ToolPalette tools={tools} />}
        </aside>
      </main>
    </div>
  );
};

export default AgentMode;
