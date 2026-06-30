import { describe, it, expect, beforeEach } from 'vitest';
import { useCanvasStore } from '@/components/infinite-canvas/use-canvas-store';

describe('clearAgentNodes', () => {
  beforeEach(() => {
    useCanvasStore.setState({ nodes: [], connections: [], nodeOverrides: {} });
  });

  it('removes only agent_node type, keeps other types', () => {
    useCanvasStore.setState({
      nodes: [
        { id: 'a', type: 'image', x: 0, y: 0, w: 100 } as any,
        { id: 'b', type: 'agent_node', x: 0, y: 0, w: 280, _agentTaskType: 'goal' } as any,
        { id: 'c', type: 'prompt', x: 0, y: 0, w: 200 } as any,
      ],
    });
    useCanvasStore.getState().clearAgentNodes();
    const ids = useCanvasStore.getState().nodes.map((n) => n.id);
    expect(ids).toEqual(['a', 'c']);
  });

  it('keeps nodeOverrides intact (does not clear)', () => {
    useCanvasStore.setState({
      nodes: [{ id: 'a', type: 'agent_node', x: 0, y: 0, w: 280, _agentTaskType: 'goal' } as any],
      nodeOverrides: { a: { dx: 10, dy: 20 } },
    });
    useCanvasStore.getState().clearAgentNodes();
    expect(useCanvasStore.getState().nodeOverrides).toEqual({ a: { dx: 10, dy: 20 } });
  });
});
