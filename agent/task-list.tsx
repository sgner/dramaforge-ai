import React, { useEffect, useState, useCallback, useRef } from 'react';
import { RotateCw } from 'lucide-react';
import { api, type AgentTaskOut } from '@/services/apiClient';
import './agent.css';

export interface TaskListProps {
  projectId: string;
  onSelect: (taskId: string) => void;
  selectedId?: string | null;
  /**
   * 父组件传入的"刷新触发器"：每次值变化时，列表会重新拉取。
   * 创建任务、轮询心跳、SSE 任务状态变化时都应递增。
   */
  refreshTrigger?: number;
}

export const TaskList: React.FC<TaskListProps> = ({
  projectId,
  onSelect,
  selectedId,
  refreshTrigger = 0,
}) => {
  const [tasks, setTasks] = useState<AgentTaskOut[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [actionTaskId, setActionTaskId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.listAgentTasks(projectId);
      setTasks(data);
    } catch (e) {
      // 静默失败：保留旧数据
      // eslint-disable-next-line no-console
      console.warn('TaskList: failed to load tasks', e);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  // 初次加载 + 切换 project + 外部 trigger 变化时刷新
  useEffect(() => {
    load();
  }, [load, refreshTrigger]);

  // 自动轮询：只要有 running 的任务就每 3s 拉一次，否则每 8s 轻量轮询兜底
  const hasRunning = !!tasks?.some(t => t.status === 'running' || t.status === 'pending');
  useEffect(() => {
    if (!autoRefresh) return;
    const interval = hasRunning ? 3000 : 8000;
    const t = setInterval(() => load(), interval);
    return () => clearInterval(t);
  }, [autoRefresh, hasRunning, load]);

  // 暴露给父组件的"立即刷新"句柄
  // 用 ref 转发以避免 setState
  const loadRef = useRef(load);
  loadRef.current = load;

  const runAction = async (taskId: string, action: 'resume' | 'stop' | 'retry') => {
    setActionTaskId(taskId);
    try {
      if (action === 'resume') await api.resumeAgent(taskId);
      if (action === 'stop') await api.stopAgent(taskId);
      if (action === 'retry') await api.retryAgent(taskId);
      await loadRef.current();
    } catch (e) {
      console.warn(`TaskList: failed to ${action} task`, e);
    } finally {
      setActionTaskId(null);
    }
  };

  const headerBar = (
    <div className="task-list-head" data-testid="task-list-head">
      <span className="task-list-head-title">
        {tasks === null ? '加载中…' : `${tasks.length} 个任务`}
      </span>
      <button
        data-testid="task-list-refresh"
        className={`task-list-refresh ${loading ? 'is-loading' : ''}`}
        onClick={() => load()}
        title="刷新任务列表"
      >
        <RotateCw size={11} /> 刷新
      </button>
    </div>
  );

  if (tasks === null) {
    return (
      <div className="task-list" data-testid="task-list">
        {headerBar}
        <div className="task-list-empty" data-testid="task-list-loading">
          loading…
        </div>
      </div>
    );
  }
  if (tasks.length === 0) {
    return (
      <div className="task-list" data-testid="task-list">
        {headerBar}
        <div className="task-list-empty" data-testid="task-list-empty">
          还没有任务
          <div className="task-list-empty-hint">在右侧输入目标后点击「创建任务」</div>
        </div>
      </div>
    );
  }
  return (
    <div className="task-list" data-testid="task-list">
      {headerBar}
      <div className="task-list-rows">
        {tasks.map((t) => (
          <div
            key={t.id}
            data-testid={`task-list-row-${t.id}`}
            onClick={() => onSelect(t.id)}
            className={`task-list-row ${selectedId === t.id ? 'active' : ''}`}
            title={t.user_goal || '(空目标)'}
          >
            <span
              data-testid={`task-list-status-${t.status}`}
              className={`task-list-status ${t.status}`}
              title={t.status}
            />
            <span className="task-list-goal">{t.user_goal || '(空目标)'}</span>
            <span className="task-list-time">
              {formatRelative(t.updated_at || t.created_at)}
            </span>
            <span className="task-list-actions" onClick={(e) => e.stopPropagation()}>
              {t.status === 'paused' && (
                <button type="button" data-testid={`task-list-resume-${t.id}`} className="tool-btn task-list-action"
                  disabled={actionTaskId === t.id} onClick={() => void runAction(t.id, 'resume')}>继续</button>
              )}
              {(t.status === 'pending' || t.status === 'running') && (
                <button type="button" data-testid={`task-list-stop-${t.id}`} className="tool-btn task-list-action"
                  disabled={actionTaskId === t.id} onClick={() => void runAction(t.id, 'stop')}>停止</button>
              )}
              {t.status === 'failed' && (
                <button type="button" data-testid={`task-list-retry-${t.id}`} className="tool-btn task-list-action"
                  disabled={actionTaskId === t.id} onClick={() => void runAction(t.id, 'retry')}>重试</button>
              )}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
};

function formatRelative(ts?: number | string): string {
  if (!ts) return '';
  const t = typeof ts === 'string' ? Date.parse(ts) : ts;
  if (Number.isNaN(t)) return '';
  const diff = Date.now() - t;
  if (diff < 60_000) return '刚刚';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}分钟前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}小时前`;
  return `${Math.floor(diff / 86_400_000)}天前`;
}

export default TaskList;
