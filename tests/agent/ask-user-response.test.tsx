/**
 * TDD: AskUserResponse 文本去重 + 单次点击发送
 *
 * 背景：LLM 经常把候选答案列表（"1) ... 2) ..."）也写进 question 字段，
 * 同时 options 数组里又有同样的项。前端必须把 question 文本里的编号列表截掉，
 * 避免和按钮重复展示。
 *
 * 同时 option 按钮的 onClick 必须 stopPropagation，否则会被 InfiniteCanvas
 * 的 board mousedown 当成"开始拖动画布"吃掉，表现为"要点 2 次才能发送"。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { AgentMode } from '@/agent/agent-mode';
import { AskUserResponse } from '@/agent/ask-user-response';
import { api } from '@/services/apiClient';
import { useAgentStore } from '@/agent/use-agent-store';

describe('AskUserResponse', () => {
  beforeEach(() => {
    useAgentStore.getState().reset();
    vi.restoreAllMocks();
  });

  function makePendingQuestion(question: string, options: string[], extra: Record<string, any> = {}) {
    useAgentStore.setState({
      taskId: 't-ask-1',
      projectId: 'p1',
      status: 'paused',
      pendingQuestion: {
        question,
        options: options.map((label, i) => ({ id: `option-${i}`, label })),
        selection_mode: options.length ? 'single' : 'text',
        context: {},
        ...extra,
      } as any,
    });
  }

  it('strips numbered list from question text when options are present', () => {
    makePendingQuestion(
      '你说的"长安"具体是哪个方向？请直接选一个：\n1）片名/项目名 2）题材/世界观关键词 3）故事地点/历史背景 4）其他（请补充一句）',
      ['片名/项目名', '题材/世界观关键词', '故事地点/历史背景', '其他（请补充一句）'],
    );
    render(<AgentMode projectId="p1" />);
    // 截掉后只剩问题本身
    const q = screen.getByTestId('ask-user-question');
    expect(q.textContent).toBe('你说的"长安"具体是哪个方向？请直接选一个：');
    // 4 个选项按钮都还在
    expect(screen.getByTestId('ask-user-option-0')).toBeInTheDocument();
    expect(screen.getByTestId('ask-user-option-1')).toBeInTheDocument();
    expect(screen.getByTestId('ask-user-option-2')).toBeInTheDocument();
    expect(screen.getByTestId('ask-user-option-3')).toBeInTheDocument();
    // 文本里不应再含 "1）" / "2）" 这种编号
    expect(q.textContent).not.toMatch(/[1１][\.\)、]/);
  });

  it('keeps question text unchanged when there are no options', () => {
    const longQ = '请详细描述一下你想做的剧情走向和受众画像。';
    makePendingQuestion(longQ, []);
    render(<AgentMode projectId="p1" />);
    expect(screen.getByTestId('ask-user-question').textContent).toBe(longQ);
  });

  it('preserves a typed draft when the question card remounts during stream replay', async () => {
    makePendingQuestion('请输入补充说明', []);
    const view = render(<AskUserResponse />);

    const input = screen.getByTestId('ask-user-input');
    fireEvent.change(input, { target: { value: '不要清空这段内容' } });

    view.unmount();
    render(<AskUserResponse />);
    useAgentStore.setState({ pendingQuestion: null });
    useAgentStore.setState({
      pendingQuestion: {
        question: '请输入补充说明',
        options: [],
        selection_mode: 'text',
        context: {},
      } as any,
    });

    await waitFor(() => expect(screen.getByTestId('ask-user-input')).toHaveValue('不要清空这段内容'));
  });

  it('single-select requires explicit confirmation before respond + resume', async () => {
    makePendingQuestion('选一个', ['A', 'B']);
    const respondSpy = vi.spyOn(api, 'respondAgent').mockResolvedValue({ ok: true } as any);
    const resumeSpy = vi.spyOn(api, 'resumeAgent').mockResolvedValue({ ok: true } as any);
    render(<AgentMode projectId="p1" />);

    fireEvent.click(screen.getByTestId('ask-user-option-0'));

    expect(respondSpy).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('ask-user-submit'));

    await waitFor(() => {
      expect(respondSpy).toHaveBeenCalledWith('t-ask-1', { response: 'A' });
      expect(resumeSpy).toHaveBeenCalledWith('t-ask-1');
    });
    // 单次点击：只调用 1 次 respond（不是 2 次）
    expect(respondSpy).toHaveBeenCalledTimes(1);
  });

  it('disables all answer controls after a successful response', async () => {
    makePendingQuestion('选择一个', ['A', 'B']);
    const respondSpy = vi.spyOn(api, 'respondAgent').mockResolvedValue({ ok: true } as any);
    vi.spyOn(api, 'resumeAgent').mockResolvedValue({ ok: true } as any);
    render(<AgentMode projectId="p1" />);

    fireEvent.click(screen.getByTestId('ask-user-option-0'));
    fireEvent.click(screen.getByTestId('ask-user-submit'));

    await waitFor(() => expect(respondSpy).toHaveBeenCalledTimes(1));
    expect(screen.getByTestId('ask-user-option-0')).toBeDisabled();
    expect(screen.getByTestId('ask-user-option-1')).toBeDisabled();
    expect(screen.getByTestId('ask-user-input')).toBeDisabled();
    expect(screen.getByTestId('ask-user-submit')).toBeDisabled();
  });

  it('allows free-text answers even when selectable options are present', async () => {
    makePendingQuestion('请描述你想做的短剧', ['现代都市爱情', '古装悬疑']);
    const respondSpy = vi.spyOn(api, 'respondAgent').mockResolvedValue({ ok: true } as any);
    vi.spyOn(api, 'resumeAgent').mockResolvedValue({ ok: true } as any);
    render(<AgentMode projectId="p1" />);

    const input = screen.getByTestId('ask-user-input');
    fireEvent.change(input, { target: { value: '两分钟校园喜剧，三位角色，结尾反转' } });
    expect(screen.getByTestId('ask-user-submit')).not.toBeDisabled();
    fireEvent.click(screen.getByTestId('ask-user-submit'));

    await waitFor(() => {
      expect(respondSpy).toHaveBeenCalledWith('t-ask-1', {
        response: '两分钟校园喜剧，三位角色，结尾反转',
      });
    });
  });

  it('multiple-select submits selected values and custom text together', async () => {
    makePendingQuestion('选择风格', ['古风', '悬疑', '现代'], {
      selection_mode: 'multiple',
      allow_custom: true,
      min_selections: 2,
      max_selections: 2,
    });
    const respondSpy = vi.spyOn(api, 'respondAgent').mockResolvedValue({ ok: true } as any);
    vi.spyOn(api, 'resumeAgent').mockResolvedValue({ ok: true } as any);
    render(<AgentMode projectId="p1" />);

    fireEvent.click(screen.getByTestId('ask-user-option-0'));
    fireEvent.click(screen.getByTestId('ask-user-option-1'));
    fireEvent.change(screen.getByTestId('ask-user-custom-input'), { target: { value: '节奏偏快' } });
    fireEvent.click(screen.getByTestId('ask-user-submit'));

    await waitFor(() => {
      expect(respondSpy).toHaveBeenCalledWith('t-ask-1', {
        response: ['古风', '悬疑'],
        custom_text: '节奏偏快',
      });
    });
  });

  it('infers multiple-select when the question asks for multiple choices', async () => {
    makePendingQuestion('请至少选择题材、时长和风格三项。', ['悬疑', '爱情', '科幻', '喜剧'], {
      selection_mode: undefined,
    });
    const respondSpy = vi.spyOn(api, 'respondAgent').mockResolvedValue({ ok: true } as any);
    vi.spyOn(api, 'resumeAgent').mockResolvedValue({ ok: true } as any);
    render(<AgentMode projectId="p1" />);

    fireEvent.click(screen.getByTestId('ask-user-option-0'));
    fireEvent.click(screen.getByTestId('ask-user-option-1'));
    fireEvent.click(screen.getByTestId('ask-user-option-2'));
    fireEvent.click(screen.getByTestId('ask-user-submit'));

    await waitFor(() => {
      expect(respondSpy).toHaveBeenCalledWith('t-ask-1', {
        response: ['悬疑', '爱情', '科幻'],
      });
    });
  });

  it('blocks multiple-select submit until the minimum selection count is met', () => {
    makePendingQuestion('选择风格', ['古风', '悬疑'], {
      selection_mode: 'multiple',
      min_selections: 1,
    });
    render(<AgentMode projectId="p1" />);
    expect(screen.getByTestId('ask-user-submit')).toBeDisabled();
    fireEvent.click(screen.getByTestId('ask-user-option-0'));
    expect(screen.getByTestId('ask-user-submit')).not.toBeDisabled();
  });

  it('uses the dedicated bottom overlay class so ThoughtStream cannot occlude', () => {
    makePendingQuestion('选一个', ['A']);
    render(<AgentMode projectId="p1" />);
    const popup = screen.getByTestId('ask-user-response') as HTMLElement;
    // 底部居中：用 left:50% + transform:translateX(-50%) 居中，
    // 不再用 right（避免与右下角 ThoughtStream 抽屉重叠被遮挡）
    expect(popup.className).toContain('ask-user-response-card');
    expect(popup.getAttribute('style')).toBeNull();
  });
});
