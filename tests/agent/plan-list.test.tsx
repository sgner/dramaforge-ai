/**
 * TDD: PlanList — 完整计划步骤列表（含状态：pending / in_progress / completed / failed）。
 *
 * 覆盖：
 * 1. 完整渲染所有 plan 步骤（不截断）
 * 2. 状态推断：pending / in_progress / completed / failed
 * 3. 工具多次调用时按 step_number 精确匹配
 * 4. 失败但后续重试成功 → 视为 completed
 * 5. 重试 / 从这步开始 按钮可见性（仅 failed / completed + interactive 状态）
 * 6. 重试 / 从这步开始 回调
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, within, fireEvent } from '@testing-library/react';
import { PlanList } from '@/agent/plan-list';
import { useAgentStore } from '@/agent/use-agent-store';

describe('<PlanList />', () => {
  beforeEach(() => {
    useAgentStore.getState().reset();
  });

  // 工具函数：灌入 actions / observations 到 store
  const addAction = (stepNumber: number, tool: string) => {
    useAgentStore.getState().applyEvent({
      type: 'action',
      payload: { tool, params: {}, step: stepNumber },
      timestamp: stepNumber * 10,
    });
  };
  const addObs = (stepNumber: number, success: boolean, error?: string) => {
    useAgentStore.getState().applyEvent({
      type: 'observation',
      payload: { step: stepNumber, success, error },
      timestamp: stepNumber * 10 + 5,
    });
  };

  it('renders all plan items (no truncation when > 5)', () => {
    const plan = Array.from({ length: 9 }, (_, i) => ({
      description: `第 ${i + 1} 步`,
      tool: `tool_${i + 1}`,
    }));
    const { actions, observations } = useAgentStore.getState();
    render(<PlanList plan={plan} actions={actions} observations={observations} status="running" />);

    // 9 个步骤都必须渲染（没有"还有 N 步"的截断）
    for (let i = 0; i < 9; i++) {
      expect(screen.getByTestId(`plan-list-item-${i}`)).toBeInTheDocument();
    }
    // 没有"还有 N 步"这种占位
    expect(screen.queryByText(/还有 \d+ 步/)).toBeNull();
  });

  it('marks every step as pending when no actions/observations match', () => {
    const plan = [
      { description: '生成剧本', tool: 'generate_script' },
      { description: '生成角色图', tool: 'generate_character_portrait' },
    ];
    const { actions, observations } = useAgentStore.getState();
    render(<PlanList plan={plan} actions={actions} observations={observations} status="running" />);

    expect(screen.getByTestId('plan-list-item-0').getAttribute('data-status')).toBe('pending');
    expect(screen.getByTestId('plan-list-item-1').getAttribute('data-status')).toBe('pending');
  });

  it('marks a step as completed when its action has a successful observation', () => {
    addAction(1, 'generate_script');
    addObs(1, true);

    const plan = [{ description: '生成剧本', tool: 'generate_script' }];
    const { actions, observations } = useAgentStore.getState();
    render(<PlanList plan={plan} actions={actions} observations={observations} status="running" />);

    expect(screen.getByTestId('plan-list-item-0').getAttribute('data-status')).toBe('completed');
  });

  it('marks a step as failed when its action has a failing observation', () => {
    addAction(1, 'generate_script');
    addObs(1, false, 'LLM timeout');

    const plan = [{ description: '生成剧本', tool: 'generate_script' }];
    const { actions, observations } = useAgentStore.getState();
    render(<PlanList plan={plan} actions={actions} observations={observations} status="failed" />);

    const item = screen.getByTestId('plan-list-item-0');
    expect(item.getAttribute('data-status')).toBe('failed');
    // 错误信息也要展示
    expect(within(item).getByText(/LLM timeout/)).toBeInTheDocument();
  });

  it('marks a step as in_progress when its action has no observation yet', () => {
    addAction(1, 'generate_script');
    // 没有 observation

    const plan = [{ description: '生成剧本', tool: 'generate_script' }];
    const { actions, observations } = useAgentStore.getState();
    render(<PlanList plan={plan} actions={actions} observations={observations} status="running" />);

    expect(screen.getByTestId('plan-list-item-0').getAttribute('data-status')).toBe('in_progress');
  });

  it('treats a later successful retry as completed (not failed)', () => {
    // 第一次失败，第二次重试成功
    addAction(1, 'generate_script');
    addObs(1, false, 'transient error');
    addAction(2, 'generate_script');
    addObs(2, true);

    const plan = [{ description: '生成剧本', tool: 'generate_script' }];
    const { actions, observations } = useAgentStore.getState();
    render(<PlanList plan={plan} actions={actions} observations={observations} status="running" />);

    // 计划步骤应该算 completed（最近一次成功）
    expect(screen.getByTestId('plan-list-item-0').getAttribute('data-status')).toBe('completed');
  });

  it('uses step_number to disambiguate when the same tool is called for different plan steps', () => {
    // 步骤 1 (index 0) 用 generate_script，步骤 2 (index 1) 用 generate_character_portrait
    addAction(1, 'generate_script');
    addObs(1, true);  // 步骤 1 完成
    addAction(2, 'generate_character_portrait');
    // 步骤 2 还在 in_progress

    const plan = [
      { description: '生成剧本', tool: 'generate_script' },
      { description: '生成角色图', tool: 'generate_character_portrait' },
    ];
    const { actions, observations } = useAgentStore.getState();
    render(<PlanList plan={plan} actions={actions} observations={observations} status="running" />);

    expect(screen.getByTestId('plan-list-item-0').getAttribute('data-status')).toBe('completed');
    expect(screen.getByTestId('plan-list-item-1').getAttribute('data-status')).toBe('in_progress');
  });

  it('shows summary pills with completed / in_progress / failed counts', () => {
    addAction(1, 'generate_script');
    addObs(1, true);  // completed
    addAction(2, 'generate_character_portrait');
    // in_progress
    addAction(3, 'generate_scene_image');
    addObs(3, false, 'failed');  // failed

    const plan = [
      { description: 'A', tool: 'generate_script' },
      { description: 'B', tool: 'generate_character_portrait' },
      { description: 'C', tool: 'generate_scene_image' },
    ];
    const { actions, observations } = useAgentStore.getState();
    const { container } = render(
      <PlanList plan={plan} actions={actions} observations={observations} status="running" />,
    );

    // 汇总条含 1/3 完成
    expect(container.querySelector('.plan-list-summary-pill.completed')?.textContent).toMatch(/1.*\/.*3/);
    // in_progress 计数 1
    expect(container.querySelector('.plan-list-summary-pill.in-progress')?.textContent).toMatch(/1/);
    // failed 计数 1
    expect(container.querySelector('.plan-list-summary-pill.failed')?.textContent).toMatch(/1/);
  });

  it('does NOT show action buttons when status is running (avoid conflicting with active agent)', () => {
    addAction(1, 'generate_script');
    addObs(1, false, 'failed');

    const plan = [{ description: 'A', tool: 'generate_script' }];
    const { actions, observations } = useAgentStore.getState();
    render(
      <PlanList
        plan={plan}
        actions={actions}
        observations={observations}
        status="running"
        onRetryStep={vi.fn()}
        onResumeFromStep={vi.fn()}
      />,
    );

    expect(screen.queryByTestId('plan-list-retry-0')).toBeNull();
  });

  it('shows retry button on failed step when status is paused', () => {
    addAction(1, 'generate_script');
    addObs(1, false, 'failed');

    const plan = [{ description: 'A', tool: 'generate_script' }];
    const { actions, observations } = useAgentStore.getState();
    const onRetry = vi.fn();
    render(
      <PlanList
        plan={plan}
        actions={actions}
        observations={observations}
        status="paused"
        onRetryStep={onRetry}
      />,
    );

    const btn = screen.getByTestId('plan-list-retry-0');
    expect(btn).toBeInTheDocument();
    fireEvent.click(btn);
    expect(onRetry).toHaveBeenCalledWith(0, expect.objectContaining({ status: 'failed' }));
  });

  it('shows resume-from-here button on completed step when status is done', () => {
    addAction(1, 'generate_script');
    addObs(1, true);

    const plan = [{ description: 'A', tool: 'generate_script' }];
    const { actions, observations } = useAgentStore.getState();
    const onResume = vi.fn();
    render(
      <PlanList
        plan={plan}
        actions={actions}
        observations={observations}
        status="done"
        onResumeFromStep={onResume}
      />,
    );

    const btn = screen.getByTestId('plan-list-resume-0');
    expect(btn).toBeInTheDocument();
    fireEvent.click(btn);
    expect(onResume).toHaveBeenCalledWith(0, expect.objectContaining({ status: 'completed' }));
  });

  it('handles plan items without a tool field as pending', () => {
    const plan = [
      { description: 'no tool here' },  // 没有 tool 字段
      { description: 'with tool', tool: 'x' },
    ];
    const { actions, observations } = useAgentStore.getState();
    render(<PlanList plan={plan} actions={actions} observations={observations} status="running" />);

    expect(screen.getByTestId('plan-list-item-0').getAttribute('data-status')).toBe('pending');
  });
});
