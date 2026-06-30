/**
 * TDD: TaskGraphNode — agent 任务图的自定义节点。
 *
 * 类型：'goal' | 'plan' | 'action' | 'observation' | 'artifact' | 'question' | 'done'
 * 状态：'pending' | 'running' | 'success' | 'failed'
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TaskGraphNode, type TaskGraphNodeData } from '@/agent/task-graph-node';

function makeData(overrides: Partial<TaskGraphNodeData> = {}): TaskGraphNodeData {
  return {
    taskType: 'goal',
    label: '生成一个 30 秒的爱情短片',
    status: 'pending',
    ...overrides,
  };
}

describe('<TaskGraphNode />', () => {
  it('renders the label', () => {
    render(<TaskGraphNode data={makeData({ label: '我的目标' })} />);
    expect(screen.getByText('我的目标')).toBeInTheDocument();
  });

  it('goal taskType shows goal badge', () => {
    render(<TaskGraphNode data={makeData({ taskType: 'goal' })} />);
    expect(screen.getByTestId('task-graph-node-badge-goal')).toBeInTheDocument();
  });

  it('action taskType shows action badge with tool name', () => {
    render(
      <TaskGraphNode
        data={makeData({
          taskType: 'action',
          label: 'parse_user_goal',
          payload: { tool: 'parse_user_goal', params: { goal: 'x' } },
        })}
      />,
    );
    expect(screen.getByTestId('task-graph-node-badge-action')).toBeInTheDocument();
    expect(screen.getByText('parse_user_goal')).toBeInTheDocument();
  });

  it('artifact taskType shows image preview when url provided', () => {
    render(
      <TaskGraphNode
        data={makeData({
          taskType: 'artifact',
          label: '林尘',
          payload: { kind: 'image', url: '/files/abc.png' },
        })}
      />,
    );
    const img = screen.getByRole('img') as HTMLImageElement;
    expect(img).toBeInTheDocument();
    expect(img.src).toContain('/files/abc.png');
  });

  it('artifact taskType shows text payload when no url', () => {
    render(
      <TaskGraphNode
        data={makeData({
          taskType: 'artifact',
          label: '剧本',
          payload: { kind: 'text', snippet: '从前有一个少年...' },
        })}
      />,
    );
    expect(screen.getByText(/从前有一个少年/)).toBeInTheDocument();
  });

  it('running status shows spinner badge', () => {
    render(<TaskGraphNode data={makeData({ status: 'running' })} />);
    expect(screen.getByTestId('task-graph-node-status-running')).toBeInTheDocument();
  });

  it('success status shows check badge', () => {
    render(<TaskGraphNode data={makeData({ status: 'success' })} />);
    expect(screen.getByTestId('task-graph-node-status-success')).toBeInTheDocument();
  });

  it('failed status shows X badge', () => {
    render(<TaskGraphNode data={makeData({ status: 'failed' })} />);
    expect(screen.getByTestId('task-graph-node-status-failed')).toBeInTheDocument();
  });

  it('question taskType highlights as pending input', () => {
    render(
      <TaskGraphNode
        data={makeData({
          taskType: 'question',
          label: '主角是男是女？',
          status: 'pending',
        })}
      />,
    );
    expect(screen.getByTestId('task-graph-node-badge-question')).toBeInTheDocument();
    expect(screen.getByTestId('task-graph-node-question')).toBeInTheDocument();
  });

  it('plan taskType shows step list when provided', () => {
    render(
      <TaskGraphNode
        data={makeData({
          taskType: 'plan',
          label: '执行计划',
          payload: {
            plan: [
              { step: 1, tool: 'generate_script' },
              { step: 2, tool: 'extract_characters' },
            ],
          },
        })}
      />,
    );
    expect(screen.getByTestId('task-graph-node-plan-step-0')).toBeInTheDocument();
    expect(screen.getByTestId('task-graph-node-plan-step-1')).toBeInTheDocument();
  });
});
