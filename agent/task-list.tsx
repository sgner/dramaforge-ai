import React, { useEffect, useState, useCallback, useRef } from 'react';
import { RotateCw } from 'lucide-react';
import { api, type AgentTaskOut } from '@/services/apiClient';
import { forceReconnect } from './agent-stream-manager';
import './agent.css';

export interface TaskListProps {
  projectId: string;
  onSelect: (taskId: string, status?: AgentTaskOut['status']) => void;
  selectedId?: string | null;
  /**
   * 父组件传入的"刷新触发器"：每次值变化时，列表会重新拉取。
   * 创建任务、轮询心跳、SSE 任务状态变化时都应递增。
   */
  refreshTrigger?: number;
  /** 重试时使用画布当前步骤绑定，避免历史任务沿用失效模型。 */
  retryProviderId?: string;
  retryModelId?: string;
}

export const TaskList: React.FC<TaskListProps> = ({
  projectId,
  onSelect,
  selectedId,
  refreshTrigger = 0,
  retryProviderId,
  retryModelId,
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

  // 自动轮询：running/pending 任务需要近实时更新（3s）；
  // 其余状态（paused/done/failed/空列表）不会自动变化，降到 30s 轻量兜底，
  // 避免无意义的频繁请求占用数据库连接、与写操作竞争锁。
  const hasRunning = !!tasks?.some(t => t.status === 'running' || t.status === 'pending');
  useEffect(() => {
    if (!autoRefresh) return;
    const interval = hasRunning ? 3000 : 30000;
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
      if (action === 'retry') {
        const config = retryProviderId || retryModelId
          ? { providerId: retryProviderId, modelId: retryModelId }
          : undefined;
        if (config) await api.retryAgent(taskId, config);
        else await api.retryAgent(taskId);
      }
      await loadRef.current();
      // Re-select after resume/retry so the active task store and SSE stream
      // are rebuilt from the server's new lifecycle state. Without this, the
      // list may show a pending retry while ThoughtStream remains failed.
      if (action !== 'stop') onSelect(taskId, action === 'retry' ? 'running' : undefined);
      // 强制重连 SSE：HTTP API 成功后后端会发射 TASK_RESUMED 等事件，
      // 但如果 SSE 已断开（heartbeat timeout 或网络问题），前端收不到。
      // 此时即使 onSelect 触发 setTask，taskId 未变时 subscribe 不会重连，
      // 导致 UI 卡住。forceReconnect 无条件重建连接。
      if (action !== 'stop') forceReconnect();
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
            onClick={() => onSelect(t.id, t.status)}
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
              {t.status === 'paused' && t.pending_response && (
                <button type="button" data-testid={`task-list-resume-${t.id}`} className="tool-btn task-list-action"
                  disabled={actionTaskId === t.id} onClick={() => void runAction(t.id, 'resume')}>继续</button>
              )}
              {t.status === 'paused' && !t.pending_response && (
                <span className="task-list-action task-list-waiting">等待回复</span>
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
