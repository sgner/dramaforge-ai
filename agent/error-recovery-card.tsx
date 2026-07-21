/**
 * ErrorRecoveryCard — 工具失败恢复模态卡（画布中央）。
 *
 * 当 agent 工具调用失败且自动重试耗尽后，后端推送 tool_error 事件，
 * useAgentStore.pendingErrorRecovery 填充后此卡显示。
 * 用户可选：重试 / 换模型 / 跳过。
 */
import React, { useEffect, useState } from 'react';
import { useAgentStore } from './use-agent-store';
import { api } from '@/services/apiClient';

export const ErrorRecoveryCard: React.FC = () => {
  const pending = useAgentStore((s) => s.pendingErrorRecovery);
  const taskId = useAgentStore((s) => s.taskId);
  const clearErrorRecovery = useAgentStore((s) => s.clearErrorRecovery);
  const [action, setAction] = useState<'retry' | 'change_model' | 'skip'>('retry');
  const [modelId, setModelId] = useState<string>('');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    if (pending) {
      setAction('retry');
      setModelId(pending.fallbackModelId || (pending.availableModels[0]?.id ?? ''));
      setSubmitError(null);
    }
  }, [pending]);

  if (!pending) return null;

  const onConfirm = async () => {
    if (!taskId || submitting) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      await api.respondAgent(taskId, {
        response: action,
        recovery_action: action,
        new_model_id: action === 'change_model' ? modelId : null,
      });
      await api.resumeAgent(taskId);
      clearErrorRecovery();
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : '恢复失败，请稍后重试');
    } finally {
      setSubmitting(false);
    }
  };

  const overlayStyle: React.CSSProperties = {
    position: 'relative',
    width: '100%',
    background: 'transparent',
    display: 'block',
    zIndex: 'auto',
    pointerEvents: 'auto',
    padding: 0,
  };

  // 颜色全部走 canvas.css / agent.css 的主题 token（var(--*)），
  // 让卡片在 .theme-dark（暗色）与 :root（浅色）下都正确适配。
  const cardStyle: React.CSSProperties = {
    background: 'var(--panel)',
    color: 'var(--text)',
    border: '1px solid var(--line-strong)',
    borderRadius: 12,
    padding: 12,
    width: '100%',
    boxSizing: 'border-box',
    boxShadow: '0 18px 48px var(--shadow)',
    fontFamily: 'ui-sans-serif, system-ui, sans-serif',
    fontSize: 13,
    pointerEvents: 'auto',
  };

  return (
    <div data-testid="error-recovery-card" role="region" aria-label="工具失败恢复" style={overlayStyle}>
      <div style={cardStyle}>
        <h3 style={{ margin: '0 0 12px 0', color: 'var(--text)', fontSize: 18, fontWeight: 800 }}>⚠ 工具执行失败</h3>
        <div data-testid="erc-tool" style={{ marginBottom: 6 }}>
          工具: <code style={{ background: 'var(--soft-2)', color: 'var(--text)', padding: '2px 6px', borderRadius: 4 }}>{pending.tool}</code>
        </div>
        <div data-testid="erc-error" style={{ marginBottom: 16, color: 'var(--muted)' }}>
          错误: {pending.error}
        </div>

        <div role="radiogroup" style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
          <label style={{ cursor: 'pointer', color: 'var(--text)' }}>
            <input
              type="radio"
              name="erc-action"
              value="retry"
              checked={action === 'retry'}
              onChange={() => setAction('retry')}
              className="agent-error-recovery-radio"
            />
            重试（用相同参数重新执行）
          </label>
          <label style={{ cursor: 'pointer', color: 'var(--text)' }}>
            <input
              type="radio"
              name="erc-action"
              value="change_model"
              checked={action === 'change_model'}
              onChange={() => setAction('change_model')}
              className="agent-error-recovery-radio"
            />
            换模型
          </label>
          <label style={{ cursor: 'pointer', color: 'var(--text)' }}>
            <input
              type="radio"
              name="erc-action"
              value="skip"
              checked={action === 'skip'}
              onChange={() => setAction('skip')}
              className="agent-error-recovery-radio"
            />
            跳过（让 agent 决定如何继续）
          </label>
        </div>

        {action === 'change_model' && (
          <select
            data-testid="erc-model-select"
            value={modelId}
            onChange={(e) => setModelId(e.target.value)}
            style={{
              width: '100%',
              padding: 8,
              borderRadius: 6,
              border: '1px solid var(--line-2)',
              background: 'var(--bg)',
              color: 'var(--text)',
              marginBottom: 16,
              fontSize: 13,
            }}
          >
            {pending.availableModels.length === 0 && (
              <option value="">（无可用模型，请手动输入）</option>
            )}
            {pending.availableModels.map((m) => (
              <option key={m.id} value={m.id}>{m.label}</option>
            ))}
          </select>
        )}

        {submitError && <div role="alert" style={{ marginBottom: 10, color: 'var(--danger)', fontSize: 12, fontWeight: 700 }}>{submitError}</div>}

        <button
          data-testid="erc-confirm"
          type="button"
          onClick={onConfirm}
          disabled={submitting || (action === 'change_model' && !modelId)}
          style={{
            width: '100%',
            padding: '10px 16px',
            borderRadius: 6,
            border: 0,
            background: 'var(--text)',
            color: 'var(--panel)',
            cursor: submitting ? 'wait' : 'pointer',
            fontSize: 14,
            fontWeight: 600,
          }}
        >
          {submitting ? '处理中…' : '确认'}
        </button>
      </div>
    </div>
  );
};
