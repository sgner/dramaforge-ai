/**
 * ThoughtStream — 侧栏流式展示 agent 的 thoughts/actions/observations。
 *
 * 设计：3 个分区按时间顺序堆叠，最新的 thought 顶部高亮；
 * 通过 data-testid 暴露给测试。
 *
 * 支持两种模式：
 * 1. 默认（侧栏）：直接渲染 ThoughtStreamBody
 * 2. floating 模式：右上角浮层，open 控制显隐，onClose 处理关闭
 */
import React from 'react';
import { X } from 'lucide-react';
import { useAgentStore, AgentEventLike } from './use-agent-store';
import './agent.css';

function fmtPayload(ev: AgentEventLike): string {
  const p = ev.payload || {};
  // Spec B: 工具失败恢复事件格式化
  if (ev.type === 'tool_retrying') return `🔄 重试中 (第 ${p.attempt}/${p.max_retries} 次): ${p.error}`;
  if (ev.type === 'tool_fallback_model') return `↩ 已切换到备选模型: ${p.to_model}`;
  if (typeof p.text === 'string') return p.text;
  if (typeof p.tool === 'string') {
    const params = p.params ? JSON.stringify(p.params) : '';
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

  const latestThought = thoughts[thoughts.length - 1];
  const isEmpty = thoughts.length === 0 && actions.length === 0 && observations.length === 0;

  return (
    <div
      data-testid="thought-stream"
      className="thought-stream-body"
      style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}
    >
      {/* 状态指示器 */}
      {status === 'running' && (
        <div
          data-testid="thought-stream-running"
          className="thought-stream-status"
        >
          <span className="thought-stream-dot" />
          agent 正在工作…
        </div>
      )}
      {status === 'failed' && (
        <div
          data-testid="thought-stream-failed"
          className="thought-stream-status failed"
        >
          <span className="thought-stream-dot" style={{ background: 'var(--danger)', animation: 'none' }} />
          任务失败
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

      {/* 最新 thought 高亮 */}
      {latestThought && (
        <div
          data-testid="thought-stream-latest"
          className="thought-stream-latest"
        >
          <div className="thought-stream-latest-label">最近的思考</div>
          <div className="thought-stream-latest-text">{fmtPayload(latestThought)}</div>
        </div>
      )}

      {/* 完整 stream（按时间倒序展开） */}
      {!isEmpty && (
        <>
          <Section title="思考" testId="thought-stream-thoughts" items={thoughts} />
          <Section title="动作" testId="thought-stream-actions" items={actions} />
          <Section title="观察" testId="thought-stream-observations" items={observations} />
        </>
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
        {items.map((ev, i) => (
          <div key={i} className="thought-stream-item">
            {fmtPayload(ev)}
          </div>
        ))}
      </div>
    </div>
  );
};
