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
import { api } from '@/services/apiClient';
import { useAgentStore } from '@/agent/use-agent-store';

describe('AskUserResponse', () => {
  beforeEach(() => {
    useAgentStore.getState().reset();
    vi.restoreAllMocks();
  });

  function makePendingQuestion(question: string, options: string[]) {
    useAgentStore.setState({
      taskId: 't-ask-1',
      status: 'paused',
      pendingQuestion: { question, options, context: {} } as any,
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

  it('option button click triggers respond + resume with single click', async () => {
    makePendingQuestion('选一个', ['A', 'B']);
    const respondSpy = vi.spyOn(api, 'respondAgent').mockResolvedValue({ ok: true } as any);
    const resumeSpy = vi.spyOn(api, 'resumeAgent').mockResolvedValue({ ok: true } as any);
    render(<AgentMode projectId="p1" />);

    fireEvent.click(screen.getByTestId('ask-user-option-0'));

    await waitFor(() => {
      expect(respondSpy).toHaveBeenCalledWith('t-ask-1', { response: 'A' });
      expect(resumeSpy).toHaveBeenCalledWith('t-ask-1');
    });
    // 单次点击：只调用 1 次 respond（不是 2 次）
    expect(respondSpy).toHaveBeenCalledTimes(1);
  });

  it('positions popup at bottom-center (left:50% + translateX(-50%)) so ThoughtStream cannot occlude', () => {
    makePendingQuestion('选一个', ['A']);
    render(<AgentMode projectId="p1" />);
    const popup = screen.getByTestId('ask-user-response') as HTMLElement;
    const style = popup.getAttribute('style') || '';
    // 底部居中：用 left:50% + transform:translateX(-50%) 居中，
    // 不再用 right（避免与右下角 ThoughtStream 抽屉重叠被遮挡）
    expect(style).toMatch(/left:\s*50%/);
    expect(style).toMatch(/translateX\(-50%\)/);
    expect(style).not.toMatch(/right:\s*\d+/);
  });
});
