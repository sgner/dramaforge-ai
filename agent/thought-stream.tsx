/**
 * ThoughtStream — 侧栏流式展示 agent 的 thoughts/actions/observations。
 *
 * 设计：3 个分区按时间顺序堆叠，最新的 thought 顶部高亮；
 * 通过 data-testid 暴露给测试。
 *
 * 支持两种模式：
 * 1. 默认（侧栏）：直接渲染 ThoughtStreamBody
 * 2. floating 模式：右上角浮层，open 控制显隐，onClose 处理关闭
 *
 * 增强：
 *   - 顶部固定显示最新事件（"实时" 区域），让用户一眼就能看到 agent 当前在做什么
 *   - 区域按时间倒序展开，附数量统计
 *   - 支持 "auto-scroll to top"：新事件总是出现在顶部（最新的事件最显眼）
 */
import React, { useEffect, useRef } from 'react';
import { X, Sparkles, Wrench, Eye, ListTodo } from 'lucide-react';
import { useAgentStore, AgentEventLike } from './use-agent-store';
import './agent.css';

function fmtPayload(ev: AgentEventLike): string {
  const p = ev.payload || {};
  if (ev.type === 'tool_retrying') return `🔄 重试中 (第 ${p.attempt}/${p.max_retries} 次): ${p.error}`;
  if (ev.type === 'tool_fallback_model') return `↩ 已切换到备选模型: ${p.to_model}`;
  if (ev.type === 'plan_ready') return `已生成计划（${Array.isArray(p.plan) ? p.plan.length : 0} 步）`;
  if (ev.type === 'plan_revised') return `已修订计划`;
  if (ev.type === 'artifact_created') return `✨ 资产已生成: ${p.name || p.kind || p.id}`;
  if (ev.type === 'request_user_input') return `❓ ${p.question || 'agent 想要确认一些信息'}`;
  if (ev.type === 'task_done') return `✅ 任务完成`;
  if (ev.type === 'task_failed') return `❌ 任务失败: ${p.error || '未知错误'}`;
  if (ev.type === 'task_paused') return `⏸ 任务已暂停`;
  if (ev.type === 'task_resumed') return `▶ 任务已恢复`;
  if (ev.type === 'cost_update') return `💰 累计消耗 $${Number(p.cost_usd || 0).toFixed(4)} (${p.tokens || 0} tokens)`;
  if (ev.type === 'goal_parsed') return `🎯 已解析目标: ${(p.plan?.[0]?.title) || '生成计划'}`;
  if (typeof p.text === 'string') return p.text;
  if (typeof p.tool === 'string') {
    const params = p.params ? JSON.stringify(p.params).slice(0, 80) : '';
    return `${p.tool}${params ? ' ' + params : ''}`;
  }
  if (p.result !== undefined) {
    const r = p.result;
    if (r && typeof r === 'object' && 'ok' in r) {
      return r.ok ? 'ok' : `error: ${(r as any).error || 'unknown'}`;
    }
    return JSON.stringify(r).slice(0, 200);
  }
  return JSON.stringify(p).slice(0, 200);
}

function eventBadge(ev: AgentEventLike): { icon: React.ReactNode; label: string } {
  switch (ev.type) {
    case 'thought': return { icon: <Sparkles size={10} />, label: '思考' };
    case 'action': return { icon: <Wrench size={10} />, label: '动作' };
    case 'observation': return { icon: <Eye size={10} />, label: '观察' };
    case 'plan_ready':
    case 'plan_revised':
    case 'goal_parsed':
      return { icon: <ListTodo size={10} />, label: '计划' };
    case 'artifact_created': return { icon: <Sparkles size={10} />, label: '资产' };
    case 'request_user_input': return { icon: <ListTodo size={10} />, label: '提问' };
    case 'task_done': return { icon: <Sparkles size={10} />, label: '完成' };
    case 'task_failed': return { icon: <ListTodo size={10} />, label: '失败' };
    default: return { icon: <Sparkles size={10} />, label: ev.type };
  }
}

export interface ThoughtStreamProps {
  floating?: boolean;
  open?: boolean;
  onClose?: () => void;
}

const ThoughtStreamBody: React.FC = () => {
  const thoughts = useAgentStore((s) => s.thoughts);
  const actions = useAgentStore((s) => s.actions);
  const observations = useAgentStore((s) => s.observations);
  const status = useAgentStore((s) => s.status);
  const plan = useAgentStore((s) => s.plan);
  const artifacts = useAgentStore((s) => s.artifacts);
  const pendingQuestion = useAgentStore((s) => s.pendingQuestion);
  const streamingText = useAgentStore((s) => s.streamingText);

  const latestThought = thoughts[thoughts.length - 1];
  const isEmpty = thoughts.length === 0 && actions.length === 0 && observations.length === 0;
  const totalCount = thoughts.length + actions.length + observations.length;

  // 自动滚动到顶部（最新事件在顶部）
  const bodyRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (bodyRef.current) bodyRef.current.scrollTop = 0;
  }, [totalCount]);

  return (
    <div
      ref={bodyRef}
      data-testid="thought-stream"
      className="thought-stream-body"
      style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}
    >
      {/* 状态指示器 */}
      {status === 'running' && (
        <div data-testid="thought-stream-running" className="thought-stream-status">
          <span className="thought-stream-dot" />
          agent 正在工作…
        </div>
      )}
      {status === 'paused' && (
        <div data-testid="thought-stream-paused" className="thought-stream-status paused">
          <span className="thought-stream-dot" style={{ background: 'var(--muted)', animation: 'none' }} />
          {pendingQuestion ? '等待你的回复' : '已暂停'}
        </div>
      )}
      {status === 'done' && (
        <div data-testid="thought-stream-done" className="thought-stream-status done">
          <span className="thought-stream-dot" style={{ background: 'var(--text)', animation: 'none' }} />
          任务完成 · 共 {totalCount} 个事件
        </div>
      )}
      {status === 'failed' && (
        <div data-testid="thought-stream-failed" className="thought-stream-status failed">
          <span className="thought-stream-dot" style={{ background: 'var(--danger)', animation: 'none' }} />
          任务失败
        </div>
      )}

      {/* 实时事件统计条 */}
      {!isEmpty && (
        <div className="thought-stream-stats">
          <span className="thought-stream-stat-pill">
            <Sparkles size={9} /> 思考 {thoughts.length}
          </span>
          <span className="thought-stream-stat-pill">
            <Wrench size={9} /> 动作 {actions.length}
          </span>
          <span className="thought-stream-stat-pill">
            <Eye size={9} /> 观察 {observations.length}
          </span>
          {plan.length > 0 && (
            <span className="thought-stream-stat-pill">
              <ListTodo size={9} /> 计划 {plan.length}
            </span>
          )}
        </div>
      )}

      {/* 最新 thought 高亮 */}
      {latestThought && (
        <div
          data-testid="thought-stream-latest"
          className="thought-stream-latest"
        >
          <div className="thought-stream-latest-label">💡 最新思考</div>
          <div className="thought-stream-latest-text">{fmtPayload(latestThought)}</div>
        </div>
      )}

      {streamingText && (
        <div data-testid="thought-stream-streaming" className="thought-stream-latest observation">
          <div className="thought-stream-latest-label">文本生成中</div>
          <div className="thought-stream-latest-text">{streamingText}</div>
        </div>
      )}

      {/* 最近动作（最新的 1 个） */}
      {actions.length > 0 && (
        <div className="thought-stream-latest action">
          <div className="thought-stream-latest-label">
            <Wrench size={10} /> 最新动作
          </div>
          <div className="thought-stream-latest-text">
            {fmtPayload(actions[actions.length - 1])}
          </div>
        </div>
      )}

      {/* 最近观察（最新的 1 个） */}
      {observations.length > 0 && (
        <div className="thought-stream-latest observation">
          <div className="thought-stream-latest-label">
            <Eye size={10} /> 最新观察
          </div>
          <div className="thought-stream-latest-text">
            {fmtPayload(observations[observations.length - 1])}
          </div>
        </div>
      )}

      {/* 待用户回复 */}
      {pendingQuestion && (
        <div className="thought-stream-latest pending" data-testid="thought-stream-pending-question">
          <div className="thought-stream-latest-label">❓ agent 提问</div>
          <div className="thought-stream-latest-text">{pendingQuestion.question}</div>
        </div>
      )}

      {/* 计划 */}
      {plan.length > 0 && (
        <div className="thought-stream-section">
          <div className="thought-stream-section-head">📋 执行计划 ({plan.length})</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {plan.slice(0, 5).map((step: any, i: number) => (
              <div key={i} className="thought-stream-item plan-step">
                <span className="plan-step-num">{i + 1}</span>
                <span>{step.title || step.name || step.description || JSON.stringify(step).slice(0, 80)}</span>
              </div>
            ))}
            {plan.length > 5 && (
              <div className="thought-stream-item" style={{ color: 'var(--muted)' }}>
                …还有 {plan.length - 5} 步
              </div>
            )}
          </div>
        </div>
      )}

      {/* 资产 */}
      {Object.keys(artifacts).length > 0 && (
        <div className="thought-stream-section">
          <div className="thought-stream-section-head">🎁 资产 ({Object.values(artifacts).flat().length})</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {Object.values(artifacts).flat().slice(0, 5).map((a: any, i: number) => (
              <div key={i} className="thought-stream-item">
                {a.name || a.kind || a.id} {a.asset_kind ? `(${a.asset_kind})` : ''}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 空状态 */}
      {isEmpty && (
        <div
          data-testid="thought-stream-empty"
          className="thought-stream-empty"
        >
          等待 agent 开始工作…
        </div>
      )}

      {/* 完整 stream（按时间倒序展开） — 仅在有数据时显示 */}
      {!isEmpty && (
        <details className="thought-stream-details">
          <summary className="thought-stream-details-summary">展开完整记录 ({totalCount})</summary>
          <Section title="思考" testId="thought-stream-thoughts" items={thoughts} />
          <Section title="动作" testId="thought-stream-actions" items={actions} />
          <Section title="观察" testId="thought-stream-observations" items={observations} />
        </details>
      )}
    </div>
  );
};

export const ThoughtStream: React.FC<ThoughtStreamProps> = ({ floating, open, onClose }) => {
  if (floating) {
    if (!open) return null;
    return (
      <div
        data-testid="thought-stream-floating"
        className="thought-stream-floating"
      >
        <div className="thought-stream-head">
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            💭 ThoughtStream
          </span>
          <button
            data-testid="thought-stream-floating-close"
            type="button"
            aria-label="close"
            onClick={onClose}
          >
            <X size={14} />
          </button>
        </div>
        <div className="thought-stream-body-wrap" style={{ overflowY: 'auto', flex: 1, minHeight: 0 }}>
          <ThoughtStreamBody />
        </div>
      </div>
    );
  }
  return <ThoughtStreamBody />;
};

const Section: React.FC<{
  title: string;
  testId: string;
  items: AgentEventLike[];
}> = ({ title, testId, items }) => {
  if (items.length === 0) {
    return (
      <div data-testid={testId} className="thought-stream-section">
        <div className="thought-stream-section-head">{title} <span style={{ color: 'var(--faint)', textTransform: 'none', fontWeight: 700 }}>(empty)</span></div>
      </div>
    );
  }
  return (
    <div data-testid={testId} className="thought-stream-section">
      <div className="thought-stream-section-head">{title} ({items.length})</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {[...items].reverse().map((ev, i) => {
          const b = eventBadge(ev);
          return (
            <div key={i} className="thought-stream-item">
              <span className="thought-stream-item-badge">{b.icon}</span>
              {fmtPayload(ev)}
            </div>
          );
        })}
      </div>
    </div>
  );
};
