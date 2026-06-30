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
import { useAgentStore, AgentEventLike } from './use-agent-store';

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
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
        padding: 12,
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
        fontSize: 12,
        height: '100%',
        overflowY: 'auto',
      }}
    >
      {/* 状态指示器 */}
      {status === 'running' && (
        <div
          data-testid="thought-stream-running"
          style={{
            padding: '6px 10px',
            borderRadius: 6,
            background: 'rgba(59,130,246,0.1)',
            color: '#2563eb',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}
        >
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: '50%',
              background: '#2563eb',
              animation: 'pulse 1.5s ease-in-out infinite',
            }}
          />
          agent 正在工作…
        </div>
      )}
      {status === 'failed' && (
        <div
          data-testid="thought-stream-failed"
          style={{
            padding: '6px 10px',
            borderRadius: 6,
            background: 'rgba(239,68,68,0.1)',
            color: '#dc2626',
          }}
        >
          ✗ 任务失败
        </div>
      )}

      {/* 空状态 */}
      {isEmpty && (
        <div
          data-testid="thought-stream-empty"
          style={{ color: '#94a3b8', textAlign: 'center', padding: 24 }}
        >
          等待 agent 开始工作…
        </div>
      )}

      {/* 最新 thought 高亮 */}
      {latestThought && (
        <div
          data-testid="thought-stream-latest"
          style={{
            padding: 10,
            borderRadius: 8,
            background: 'rgba(99,102,241,0.08)',
            border: '1px solid rgba(99,102,241,0.2)',
          }}
        >
          <div style={{ fontSize: 10, color: '#6366f1', marginBottom: 4, textTransform: 'uppercase' }}>
            💭 最近的思考
          </div>
          <div>{fmtPayload(latestThought)}</div>
        </div>
      )}

      {/* 完整 stream（按时间倒序展开） */}
      {!isEmpty && (
        <>
          <Section title="🤔 思考" testId="thought-stream-thoughts" items={thoughts} />
          <Section title="⚡ 动作" testId="thought-stream-actions" items={actions} />
          <Section title="👁 观察" testId="thought-stream-observations" items={observations} />
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
        style={{
          position: 'fixed',
          top: 16,
          right: 16,
          width: 320,
          maxHeight: '60vh',
          background: 'white',
          border: '1px solid #e2e8f0',
          borderRadius: 10,
          boxShadow: '0 4px 16px rgba(0,0,0,0.08)',
          zIndex: 50,
          display: 'flex',
          flexDirection: 'column',
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
          fontSize: 12,
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '6px 10px',
            borderBottom: '1px solid #e2e8f0',
            background: 'rgba(99,102,241,0.06)',
            fontWeight: 600,
          }}
        >
          <span>💭 ThoughtStream</span>
          <button
            data-testid="thought-stream-floating-close"
            type="button"
            aria-label="close"
            onClick={onClose}
            style={{ background: 'none', border: 0, cursor: 'pointer', fontSize: 14, lineHeight: 1 }}
          >
            ✕
          </button>
        </div>
        <div style={{ overflowY: 'auto', flex: 1 }}>
          {/* 复用原 render 内容 */}
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
      <div data-testid={testId} style={{ color: '#94a3b8', fontSize: 11 }}>
        {title} <em>(empty)</em>
      </div>
    );
  }
  return (
    <div data-testid={testId}>
      <div
        style={{
          fontSize: 10,
          color: '#94a3b8',
          textTransform: 'uppercase',
          marginBottom: 6,
          letterSpacing: 0.5,
        }}
      >
        {title} ({items.length})
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {items.map((ev, i) => (
          <div
            key={i}
            style={{
              padding: '4px 8px',
              background: 'rgba(0,0,0,0.03)',
              borderRadius: 4,
              fontSize: 11,
              color: '#334155',
            }}
          >
            {fmtPayload(ev)}
          </div>
        ))}
      </div>
    </div>
  );
};
