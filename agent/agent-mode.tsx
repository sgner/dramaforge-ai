/**
 * AgentMode — 顶级 agent 页面，组合输入栏 + TaskList + ThoughtStream + ToolPalette。
 *
 * 布局：3 列 grid（左 300px 任务/思考流，右侧 280px 工具面板，中间主区域）。
 * 数据流：
 *   - 输入目标 → api.startAgent → 拿到 taskId
 *   - useAgentStream(taskId) 订阅 SSE → useAgentStore.applyEvent 投影
 *   - ThoughtStream 订阅 store
 *   - useAgentTools 拉取 /api/agent/tools（失败回退 PALETTE_TOOLS）
 */
import React, { useState } from 'react';
import { useAgentStore } from './use-agent-store';
import { useAgentStream } from './use-agent-stream';
import { useAgentTools } from './use-agent-tools';
import { ThoughtStream } from './thought-stream';
import { ToolPalette } from './tool-palette';
import { TaskList } from './task-list';
import { api } from '@/services/apiClient';

export interface AgentModeProps {
  projectId: string;
}

export const AgentMode: React.FC<AgentModeProps> = ({ projectId }) => {
  const [goal, setGoal] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const taskId = useAgentStore((s) => s.taskId);
  const setTask = useAgentStore((s) => s.setTask);
  const { tools, isLoading: toolsLoading } = useAgentTools();
  useAgentStream(taskId);

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
      style={{ display: 'grid', gridTemplateColumns: '300px 1fr 280px', height: '100vh' }}
    >
      <aside style={{ borderRight: '1px solid #e2e8f0', overflowY: 'auto' }}>
        <div style={{ padding: 8 }}>
          <h3>任务</h3>
          <TaskList projectId={projectId} onSelect={(id) => setTask(id, 'running')} />
        </div>
        <div style={{ borderTop: '1px solid #e2e8f0', padding: 8 }}>
          <h3>思考流</h3>
          <ThoughtStream />
        </div>
      </aside>
      <main style={{ padding: 16 }}>
        <div
          data-testid="agent-mode-input-bar"
          style={{ display: 'flex', gap: 8, marginBottom: 12 }}
        >
          <input
            data-testid="agent-mode-input"
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
            placeholder="描述目标，例如：做一个 30 秒的雨夜短片"
            style={{ flex: 1, padding: 8 }}
          />
          <button
            data-testid="agent-mode-submit"
            onClick={onSubmit}
            disabled={submitting || !goal.trim()}
          >
            {submitting ? '创建中…' : '创建任务'}
          </button>
        </div>
        {error && (
          <div data-testid="agent-mode-error" style={{ color: 'red' }}>
            {error}
          </div>
        )}
        <div
          data-testid="agent-mode-canvas-placeholder"
          style={{
            border: '1px dashed #cbd5e1',
            padding: 24,
            textAlign: 'center',
            color: '#64748b',
          }}
        >
          画布：后续接入 InfiniteCanvas
        </div>
      </main>
      <aside style={{ borderLeft: '1px solid #e2e8f0', overflowY: 'auto' }}>
        {toolsLoading ? <div>loading tools…</div> : <ToolPalette tools={tools} />}
      </aside>
    </div>
  );
};

export default AgentMode;
