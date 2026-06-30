import React, { useEffect, useState, useCallback } from 'react';
import { api, type AgentTaskOut } from '@/services/apiClient';

const STATUS_COLORS: Record<string, string> = {
  idle: '#94a3b8', pending: '#f59e0b', running: '#2563eb',
  paused: '#a855f7', done: '#10b981', failed: '#ef4444',
};

export interface TaskListProps {
  projectId: string;
  onSelect: (taskId: string) => void;
}

export const TaskList: React.FC<TaskListProps> = ({ projectId, onSelect }) => {
  const [tasks, setTasks] = useState<AgentTaskOut[] | null>(null);

  const load = useCallback(async () => {
    const data = await api.listAgentTasks(projectId);
    setTasks(data);
  }, [projectId]);

  useEffect(() => {
    load();
  }, [load]);

  if (tasks === null) {
    return <div data-testid="task-list-loading">loading…</div>;
  }
  if (tasks.length === 0) {
    return (
      <div data-testid="task-list">
        <button data-testid="task-list-refresh" onClick={load}>刷新</button>
        <div data-testid="task-list-empty">还没有任务</div>
      </div>
    );
  }
  return (
    <div data-testid="task-list">
      <button data-testid="task-list-refresh" onClick={load}>刷新</button>
      {tasks.map((t) => (
        <div
          key={t.id}
          data-testid={`task-list-row-${t.id}`}
          onClick={() => onSelect(t.id)}
          style={{ padding: 6, borderBottom: '1px solid #e2e8f0', cursor: 'pointer' }}
        >
          <span
            data-testid={`task-list-status-${t.status}`}
            style={{
              background: STATUS_COLORS[t.status] || '#94a3b8',
              color: 'white', padding: '1px 6px', borderRadius: 3, fontSize: 10, marginRight: 6,
            }}
          >
            {t.status}
          </span>
          {t.user_goal}
        </div>
      ))}
    </div>
  );
};

export default TaskList;
