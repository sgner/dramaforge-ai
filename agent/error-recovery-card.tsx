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
  const [action, setAction] = useState<'retry' | 'change_model' | 'skip'>('retry');
  const [modelId, setModelId] = useState<string>('');

  useEffect(() => {
    if (pending) {
      setAction('retry');
      setModelId(pending.fallbackModelId || (pending.availableModels[0]?.id ?? ''));
    }
  }, [pending]);

  if (!pending) return null;

  const onConfirm = async () => {
    await api.respondAgent(taskId, {
      response: action,
      recovery_action: action,
      new_model_id: action === 'change_model' ? modelId : null,
    });
  };

  const overlayStyle: React.CSSProperties = {
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
    background: 'rgba(0,0,0,0.3)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 40,
  };

  const cardStyle: React.CSSProperties = {
    background: 'white',
    borderRadius: 12,
    padding: 24,
    minWidth: 360,
    maxWidth: 480,
    boxShadow: '0 8px 32px rgba(0,0,0,0.16)',
    fontFamily: 'ui-sans-serif, system-ui, sans-serif',
    fontSize: 13,
  };

  return (
    <div data-testid="error-recovery-card" style={overlayStyle}>
      <div style={cardStyle}>
        <h3 style={{ margin: '0 0 12px 0', color: '#dc2626' }}>⚠ 工具执行失败</h3>
        <div data-testid="erc-tool" style={{ marginBottom: 6 }}>
          工具: <code style={{ background: '#f1f5f9', padding: '2px 6px', borderRadius: 4 }}>{pending.tool}</code>
        </div>
        <div data-testid="erc-error" style={{ marginBottom: 16, color: '#64748b' }}>
          错误: {pending.error}
        </div>

        <div role="radiogroup" style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
          <label style={{ cursor: 'pointer' }}>
            <input
              type="radio"
              name="erc-action"
              value="retry"
              checked={action === 'retry'}
              onChange={() => setAction('retry')}
              style={{ marginRight: 8 }}
            />
            重试（用相同参数重新执行）
          </label>
          <label style={{ cursor: 'pointer' }}>
            <input
              type="radio"
              name="erc-action"
              value="change_model"
              checked={action === 'change_model'}
              onChange={() => setAction('change_model')}
              style={{ marginRight: 8 }}
            />
            换模型
          </label>
          <label style={{ cursor: 'pointer' }}>
            <input
              type="radio"
              name="erc-action"
              value="skip"
              checked={action === 'skip'}
              onChange={() => setAction('skip')}
              style={{ marginRight: 8 }}
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
              border: '1px solid #cbd5e1',
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

        <button
          data-testid="erc-confirm"
          type="button"
          onClick={onConfirm}
          style={{
            width: '100%',
            padding: '10px 16px',
            borderRadius: 6,
            border: 0,
            background: '#6366f1',
            color: 'white',
            cursor: 'pointer',
            fontSize: 14,
            fontWeight: 600,
          }}
        >
          确认
        </button>
      </div>
    </div>
  );
};
