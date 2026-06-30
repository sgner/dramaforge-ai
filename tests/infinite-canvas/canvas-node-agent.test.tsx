/**
 * TDD: CanvasNodeComponent — agent_node 类型渲染。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CanvasNodeComponent } from '@/components/infinite-canvas/CanvasNode';
import { useCanvasStore } from '@/components/infinite-canvas/use-canvas-store';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

describe('<CanvasNodeComponent type=agent_node />', () => {
  beforeEach(() => {
    useCanvasStore.setState({ nodes: [], connections: [], nodeOverrides: {}, selected: new Set() });
  });

  it('renders goal badge with target icon', () => {
    render(
      <CanvasNodeComponent
        node={{
          id: 'a',
          type: 'agent_node',
          x: 0,
          y: 0,
          w: 280,
          h: 200,
          _agentTaskType: 'goal',
          _agentStatus: 'pending',
          _agentLabel: '做一个雨夜短片',
          _agentPayload: { text: '做一个雨夜短片' },
        } as any}
        onDragStart={vi.fn()}
        onResizeStart={vi.fn()}
        onPortMouseDown={vi.fn()}
      />,
    );
    const badge = screen.getByTestId('task-graph-node-badge-goal');
    expect(badge.textContent).toContain('目标');
    expect(screen.getByTestId('task-graph-node-label')).toHaveTextContent('做一个雨夜短片');
  });

  it('renders running status badge', () => {
    render(
      <CanvasNodeComponent
        node={{
          id: 'a',
          type: 'agent_node',
          x: 0,
          y: 0,
          w: 280,
          h: 200,
          _agentTaskType: 'action',
          _agentStatus: 'running',
          _agentLabel: 't1',
          _agentPayload: {},
        } as any}
        onDragStart={vi.fn()}
        onResizeStart={vi.fn()}
        onPortMouseDown={vi.fn()}
      />,
    );
    expect(screen.getByTestId('task-graph-node-status-running')).toBeInTheDocument();
  });

  it('renders plan steps as ol list', () => {
    render(
      <CanvasNodeComponent
        node={{
          id: 'a',
          type: 'agent_node',
          x: 0,
          y: 0,
          w: 280,
          h: 200,
          _agentTaskType: 'plan',
          _agentStatus: 'success',
          _agentLabel: '计划',
          _agentPayload: { plan: [{ tool: 'a' }, { tool: 'b' }, { tool: 'c' }] },
        } as any}
        onDragStart={vi.fn()}
        onResizeStart={vi.fn()}
        onPortMouseDown={vi.fn()}
      />,
    );
    expect(screen.getByTestId('task-graph-node-plan-step-0')).toBeInTheDocument();
    expect(screen.getByTestId('task-graph-node-plan-step-2')).toBeInTheDocument();
  });

  it('renders question highlight when taskType is question', () => {
    render(
      <CanvasNodeComponent
        node={{
          id: 'a',
          type: 'agent_node',
          x: 0,
          y: 0,
          w: 280,
          h: 200,
          _agentTaskType: 'question',
          _agentStatus: 'running',
          _agentLabel: '等待用户回答',
          _agentPayload: {},
        } as any}
        onDragStart={vi.fn()}
        onResizeStart={vi.fn()}
        onPortMouseDown={vi.fn()}
      />,
    );
    expect(screen.getByTestId('task-graph-node-question')).toBeInTheDocument();
  });

  it('renders image artifact when payload.kind=image and url present', () => {
    render(
      <CanvasNodeComponent
        node={{
          id: 'a',
          type: 'agent_node',
          x: 0,
          y: 0,
          w: 280,
          h: 200,
          _agentTaskType: 'artifact',
          _agentStatus: 'success',
          _agentLabel: 'Alice',
          _agentPayload: { kind: 'image', url: 'http://x/a.png' },
        } as any}
        onDragStart={vi.fn()}
        onResizeStart={vi.fn()}
        onPortMouseDown={vi.fn()}
      />,
    );
    const img = screen.getByRole('img');
    expect(img).toHaveAttribute('src', 'http://x/a.png');
  });

  it('renders text snippet when payload.kind=text', () => {
    render(
      <CanvasNodeComponent
        node={{
          id: 'a',
          type: 'agent_node',
          x: 0,
          y: 0,
          w: 280,
          h: 200,
          _agentTaskType: 'artifact',
          _agentStatus: 'success',
          _agentLabel: 'script',
          _agentPayload: { kind: 'text', snippet: 'Some script content' },
        } as any}
        onDragStart={vi.fn()}
        onResizeStart={vi.fn()}
        onPortMouseDown={vi.fn()}
      />,
    );
    const snippet = screen.getByTestId('task-graph-node-text-snippet');
    expect(snippet).toHaveTextContent('Some script content');
  });
});
