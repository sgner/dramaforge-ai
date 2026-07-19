import React from 'react';
import { useAgentStore } from './use-agent-store';

/**
 * ActivityIndicator — 实时活动状态指示器（已废弃）。
 *
 * 历史职责：在画布顶部显示 agent 当前在做什么
 * （"正在优化提示词"/"正在生成角色图：林尘"）。
 *
 * 当前位置：该指示器的 `currentActivity` 字段已合并到桌宠状态栏
 * （AgentPetController.petStatusText），用户在看桌宠的同时即可感知进度。
 * 画布顶部不再单独渲染 chip，避免信息重复。
 *
 * 此组件保留以便后续需要时回退到独立指示器；当前 agent-mode.tsx 不再 import。
 */
export const ActivityIndicator: React.FC = () => {
  const status = useAgentStore((s) => s.status);
  const activity = useAgentStore((s) => s.currentActivity);

  if (!activity) return null;
  if (status === 'paused' || status === 'done' || status === 'failed' || status === 'cancelled' || status === 'idle') {
    return null;
  }

  return (
    <div
      data-testid="agent-activity-indicator"
      className="agent-activity-indicator"
      role="status"
      aria-live="polite"
    >
      <span className="agent-activity-indicator-spinner" aria-hidden="true" />
      <span className="agent-activity-indicator-text">{activity}</span>
    </div>
  );
};
