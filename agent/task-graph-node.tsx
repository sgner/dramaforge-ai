/**
 * TaskGraphNode — agent 任务图的自定义节点。
 *
 * 类型：
 * - goal: 用户的原始目标
 * - plan: 计划步骤列表
 * - action: 一次工具调用
 * - observation: 工具执行结果
 * - artifact: 生成的资产（图/视频/音频/文本）
 * - question: 等待用户回答
 * - done: 任务完成
 *
 * 状态：
 * - pending: 等待
 * - running: 执行中（动画）
 * - success: 成功
 * - failed: 失败
 */
import React from 'react';

export type TaskType =
  | 'goal'
  | 'plan'
  | 'action'
  | 'observation'
  | 'artifact'
  | 'question'
  | 'done';

export type TaskStatus = 'pending' | 'running' | 'success' | 'failed';

export interface TaskGraphNodeData {
  taskType: TaskType;
  label: string;
  status: TaskStatus;
  payload?: Record<string, any>;
  [key: string]: any;
}

const TYPE_META: Record<TaskType, { label: string; color: string; icon: string }> = {
  goal: { label: '目标', color: '#6366f1', icon: '🎯' },
  plan: { label: '计划', color: '#8b5cf6', icon: '📋' },
  action: { label: '动作', color: '#0ea5e9', icon: '⚡' },
  observation: { label: '观察', color: '#14b8a6', icon: '👁' },
  artifact: { label: '资产', color: '#ec4899', icon: '🎨' },
  question: { label: '询问', color: '#f59e0b', icon: '❓' },
  done: { label: '完成', color: '#10b981', icon: '✅' },
};

const STATUS_LABEL: Record<TaskStatus, string> = {
  pending: '○ 等待',
  running: '◐ 执行中',
  success: '● 成功',
  failed: '✕ 失败',
};

export interface TaskGraphNodeProps {
  data: TaskGraphNodeData;
}

export const TaskGraphNode: React.FC<TaskGraphNodeProps> = ({ data }) => {
  const meta = TYPE_META[data.taskType] || TYPE_META.goal;
  const payload = data.payload || {};
  const isArtifact = data.taskType === 'artifact';
  const isPlan = data.taskType === 'plan';
  const isQuestion = data.taskType === 'question';
  const isImage = isArtifact && payload.kind === 'image' && typeof payload.url === 'string';
  const isText = isArtifact && payload.kind === 'text' && typeof payload.snippet === 'string';

  return (
    <div
      style={{
        minWidth: 200,
        maxWidth: 280,
        background: '#ffffff',
        border: `2px solid ${meta.color}`,
        borderRadius: 10,
        padding: 10,
        fontFamily: 'ui-sans-serif, system-ui, sans-serif',
        fontSize: 12,
        boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
      }}>
      {/* badge + 状态 */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 6,
        }}
      >
        <span
          data-testid={`task-graph-node-badge-${data.taskType}`}
          style={{
            fontSize: 10,
            padding: '2px 6px',
            background: meta.color,
            color: 'white',
            borderRadius: 4,
            fontWeight: 600,
            letterSpacing: 0.3,
          }}
        >
          {meta.icon} {meta.label}
        </span>
        <StatusBadge status={data.status} color={meta.color} />
      </div>

      {/* 标签 */}
      <div
        data-testid="task-graph-node-label"
        style={{
          fontWeight: 600,
          color: '#0f172a',
          marginBottom: 6,
          wordBreak: 'break-word',
        }}
      >
        {data.label}
      </div>

      {/* 资产图片预览 */}
      {isImage && (
        <img
          src={payload.url}
          alt={data.label}
          style={{
            width: '100%',
            height: 'auto',
            borderRadius: 6,
            marginTop: 4,
            display: 'block',
          }}
        />
      )}

      {/* 资产文本片段 */}
      {isText && (
        <div
          data-testid="task-graph-node-text-snippet"
          style={{
            fontSize: 11,
            color: '#475569',
            background: 'rgba(0,0,0,0.03)',
            padding: 6,
            borderRadius: 4,
            maxHeight: 80,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {String(payload.snippet).slice(0, 200)}
        </div>
      )}

      {/* 计划步骤 */}
      {isPlan && Array.isArray(payload.plan) && (
        <ol style={{ margin: 0, paddingLeft: 18, fontSize: 11, color: '#334155' }}>
          {payload.plan.slice(0, 8).map((step: any, i: number) => (
            <li
              key={i}
              data-testid={`task-graph-node-plan-step-${i}`}
              style={{ marginBottom: 2 }}
            >
              <code style={{ fontSize: 10 }}>{step.tool || step.name || `step ${i + 1}`}</code>
            </li>
          ))}
        </ol>
      )}

      {/* 问题高亮 */}
      {isQuestion && (
        <div
          data-testid="task-graph-node-question"
          style={{
            fontSize: 11,
            color: '#b45309',
            background: 'rgba(245,158,11,0.08)',
            padding: 6,
            borderRadius: 4,
            border: '1px dashed rgba(245,158,11,0.4)',
            marginTop: 4,
          }}
        >
          ⚠ 等待用户回答
        </div>
      )}

    </div>
  );
};

const StatusBadge: React.FC<{ status: TaskStatus; color: string }> = ({ status, color }) => {
  const testId = `task-graph-node-status-${status}`;
  const bg = status === 'running' ? 'rgba(14,165,233,0.15)' :
             status === 'success' ? 'rgba(16,185,129,0.15)' :
             status === 'failed' ? 'rgba(239,68,68,0.15)' :
             'rgba(148,163,184,0.15)';
  const fg = status === 'running' ? '#0369a1' :
             status === 'success' ? '#047857' :
             status === 'failed' ? '#b91c1c' :
             '#475569';
  return (
    <span
      data-testid={testId}
      style={{
        fontSize: 9,
        padding: '2px 6px',
        background: bg,
        color: fg,
        borderRadius: 4,
        fontFamily: 'ui-monospace, monospace',
      }}
    >
      {STATUS_LABEL[status]}
    </span>
  );
};

export default TaskGraphNode;
