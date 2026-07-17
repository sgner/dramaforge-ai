import React from 'react';
import { api } from '@/services/apiClient';
import { useAgentStore, type PendingQuestion } from './use-agent-store';

type ResponsePayload = {
  response: string | string[];
  custom_text?: string;
  approved?: boolean;
};

type QuestionDraft = {
  answer: string;
  customText: string;
  selected: string[];
};

const questionDrafts = new Map<string, QuestionDraft>();

export const AskUserResponse: React.FC = () => {
  const taskId = useAgentStore((s) => s.taskId);
  const question = useAgentStore((s) => s.pendingQuestion);
  // answered 状态升级到 store，避免 forceReconnect / rehydrate 触发后 useEffect
  // 不重跑导致 answered 被组件 useState 丢失——详见 use-agent-store.ts 注释。
  const answered = useAgentStore((s) => s.pendingQuestionAnswered);
  const markAnswered = useAgentStore((s) => s.markPendingQuestionAnswered);
  const [answer, setAnswer] = React.useState('');
  const [customText, setCustomText] = React.useState('');
  const [selected, setSelected] = React.useState<string[]>([]);
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const questionKey = question
    ? String(question.step_id ?? question.id ?? question.question)
    : null;
  const draftKey = taskId && questionKey ? `${taskId}:${questionKey}` : null;

  React.useEffect(() => {
    const draft = draftKey ? questionDrafts.get(draftKey) : undefined;
    setAnswer(draft?.answer ?? '');
    setCustomText(draft?.customText ?? '');
    setSelected(draft?.selected ?? []);
    setError(null);
    // 注：answered 状态不重置——它属于 store 层面，由 markPendingQuestionAnswered
    // 主动设置，由 reducer 在 question 清空时清零。
  }, [draftKey]);

  if (!taskId || !question) return null;

  const inferredMode = inferSelectionMode(question.question, question.options?.length || 0);
  const mode = question.selection_mode || inferredMode;
  const options = question.options || [];
  const min = question.min_selections ?? (mode === 'multiple' ? inferMinimumSelections(question.question) : 0);
  const max = question.max_selections ?? (mode === 'multiple' ? options.length : 1);
  const hasValidSelection = mode === 'text'
    ? false
    : mode === 'confirm'
      ? selected.length === 1
      : mode === 'multiple'
        ? selected.length >= min && selected.length <= Math.max(1, max)
        : selected.length === 1;
  // 选项只是快捷入口，任何提问都允许用户直接描述答案。
  const canSubmit = !answered && (!!answer.trim() || hasValidSelection);
  // 锁定后只读展示：所有交互（选项 / 输入 / 提交）全部 disabled
  const isLocked = answered;

  const submit = async (event?: React.MouseEvent | React.KeyboardEvent) => {
    event?.preventDefault();
    event?.stopPropagation();
    if (!canSubmit || submitting || answered) return;
    const typedAnswer = answer.trim();
    const response: string | string[] = typedAnswer && !hasValidSelection
      ? typedAnswer
      : mode === 'text' ? typedAnswer : mode === 'multiple' ? selected : selected[0];
    const payload: ResponsePayload = { response };
    if (customText.trim()) payload.custom_text = customText.trim();
    if (typedAnswer && hasValidSelection) payload.custom_text = typedAnswer;
    if (mode === 'confirm' && hasValidSelection) payload.approved = selected[0] === 'approved';
    setSubmitting(true);
    setError(null);
    try {
      await api.respondAgent(taskId, payload);
      await api.resumeAgent(taskId);
      if (draftKey) questionDrafts.delete(draftKey);
      // 标记 answered（store 层），UI 立即变灰锁定，避免 backend resume 期间
      // 用户重复点击。forceReconnect 已移除：rehydrate 会让 answered 丢失，
      // 反而导致 UI 重新可编辑；SSE 健康时 onerror 不会触发，重连逻辑由
      // agent-stream-manager 内部管理。
      markAnswered();
    } catch (cause) {
      console.error('[ask-user] failed to respond', cause);
      setError('发送失败，请重试');
    } finally {
      setSubmitting(false);
    }
  };

  const toggle = (label: string) => {
    if (isLocked) return;
    setError(null);
    setSelected((current) => {
      if (mode !== 'multiple') return current.includes(label) ? [] : [label];
      if (current.includes(label)) return current.filter((value) => value !== label);
      if (current.length >= max) return current;
      return [...current, label];
    });
  };

  return (
    <div
      data-testid="ask-user-response"
      className={`ask-user-response-card${isLocked ? ' is-locked' : ''}`}
      onMouseDown={(e) => e.stopPropagation()}
      aria-busy={submitting || isLocked}
    >
      <div className="ask-user-response-head">
        <span className="ask-user-response-icon">{isLocked ? '✓' : '?'}</span>
        <strong>
          {isLocked
            ? (submitting ? '正在提交…' : '已提交，等待 agent 处理…')
            : 'agent 正在等待你的回复'}
        </strong>
      </div>
      <div data-testid="ask-user-question" className="ask-user-response-question">{questionText(question, options)}</div>
      {options.length > 0 && (
        <div className="ask-user-response-options" role={mode === 'multiple' ? 'group' : 'radiogroup'}>
          {options.map((option, index) => {
            const active = selected.includes(option.label);
            return <button
              key={option.id || index}
              type="button"
              data-testid={`ask-user-option-${index}`}
              className={`tool-btn ask-user-option${active ? ' is-selected' : ''}`}
              aria-pressed={active}
              disabled={submitting || isLocked}
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => { e.preventDefault(); e.stopPropagation(); toggle(option.label); }}
            >{active ? '✓ ' : ''}{option.label}</button>;
          })}
        </div>
      )}
      {question.allow_custom && <input
        data-testid="ask-user-custom-input"
        className="ask-user-response-input"
        value={customText}
        onChange={(e) => {
          if (isLocked) return;
          const value = e.target.value;
          setCustomText(value);
          if (draftKey) questionDrafts.set(draftKey, { answer, customText: value, selected });
        }}
        onMouseDown={(e) => e.stopPropagation()}
        placeholder="补充说明（可选）"
        disabled={submitting || isLocked}
        readOnly={isLocked}
      />}
      <div className="ask-user-response-input-row">
        <input
          data-testid="ask-user-input"
          className="ask-user-response-input"
          value={answer}
          onChange={(e) => {
            if (isLocked) return;
            const value = e.target.value;
            setAnswer(value);
            if (draftKey) questionDrafts.set(draftKey, { answer: value, customText, selected });
          }}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) void submit(e); }}
          onMouseDown={(e) => e.stopPropagation()}
          placeholder={options.length > 0 ? '选择上方选项或直接输入…' : '直接输入…'}
          disabled={submitting || isLocked}
          readOnly={isLocked}
        />
      </div>
      {mode === 'multiple' && <div className="ask-user-selection-hint">已选 {selected.length} 项{max < options.length ? `，最多 ${max} 项` : ''}</div>}
      {error && <div className="ask-user-response-error" role="alert">{error}</div>}
      <button
        data-testid="ask-user-submit"
        type="button"
        className="tool-btn ask-user-submit"
        onMouseDown={(e) => e.stopPropagation()}
        onClick={submit}
        disabled={submitting || isLocked || !canSubmit}
      >{submitting ? '发送中…' : isLocked ? '已提交' : '确认发送'}</button>
    </div>
  );
};

function questionText(question: PendingQuestion, options: PendingQuestion['options']) {
  const raw = String(question.question || '');
  if (!options?.length) return raw;
  const match = raw.match(/[1-9０-９][)）.．、:：]\s*/);
  return match && typeof match.index === 'number' ? raw.slice(0, match.index).trim() : raw;
}

function inferSelectionMode(question: string, optionCount: number): NonNullable<PendingQuestion['selection_mode']> {
  if (!optionCount) return 'text';
  return /(?:至少|最少)选择|可多选|多选/.test(question) ? 'multiple' : 'single';
}

function inferMinimumSelections(question: string): number {
  const match = question.match(/(?:至少|最少)选择[^。！？\n]{0,30}?([一二两三四五六七八九十\d]+)\s*项/);
  if (!match) return 1;
  const value = match[1];
  const chineseNumbers: Record<string, number> = {
    一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5,
    六: 6, 七: 7, 八: 8, 九: 9, 十: 10,
  };
  return chineseNumbers[value] ?? (Number(value) || 1);
}
