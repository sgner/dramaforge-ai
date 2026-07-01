import React, { useEffect, useState, useCallback } from 'react';
import { RotateCw } from 'lucide-react';
import { api, type AgentTaskOut } from '@/services/apiClient';
import './agent.css';

export interface TaskListProps {
  projectId: string;
  onSelect: (taskId: string) => void;
  selectedId?: string | null;
}

export const TaskList: React.FC<TaskListProps> = ({ projectId, onSelect, selectedId }) => {
  const [tasks, setTasks] = useState<AgentTaskOut[] | null>(null);

  const load = useCallback(async () => {
    const data = await api.listAgentTasks(projectId);
    setTasks(data);
  }, [projectId]);

  useEffect(() => {
    load();
  }, [load]);

  if (tasks === null) {
    return (
      <div data-testid="task-list-loading" className="task-list-loading">
        loading…
      </div>
    );
  }
  if (tasks.length === 0) {
    return (
      <div className="task-list" data-testid="task-list">
        <div className="task-list-empty" data-testid="task-list-empty">
          还没有任务
        </div>
        <button
          data-testid="task-list-refresh"
          className="task-list-refresh"
          onClick={load}
          style={{ alignSelf: 'flex-start' }}
        >
          <RotateCw size={11} /> 刷新
        </button>
      </div>
    );
  }
  return (
    <div className="task-list" data-testid="task-list">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '2px 4px 6px' }}>
        <span style={{ fontSize: 10, color: 'var(--muted)', fontWeight: 700, letterSpacing: 0.3, textTransform: 'uppercase' }}>
          {tasks.length} 个任务
        </span>
        <button data-testid="task-list-refresh" className="task-list-refresh" onClick={load}>
          <RotateCw size={11} /> 刷新
        </button>
      </div>
      {tasks.map((t) => (
        <div
          key={t.id}
          data-testid={`task-list-row-${t.id}`}
          onClick={() => onSelect(t.id)}
          className={`task-list-row ${selectedId === t.id ? 'active' : ''}`}
        >
          <span
            data-testid={`task-list-status-${t.status}`}
            className={`task-list-status ${t.status}`}
            title={t.status}
          />
          <span className="task-list-goal">{t.user_goal || '(空目标)'}</span>
        </div>
      ))}
    </div>
  );
};

export default TaskList;
