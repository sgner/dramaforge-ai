import { beforeEach, describe, expect, it } from 'vitest';
import { useCanvasStore } from '@/components/infinite-canvas/use-canvas-store';

describe('addAgentNodes', () => {
  beforeEach(() => {
    useCanvasStore.setState({ projectId: 'p1', nodes: [], connections: [], nodeOverrides: {} });
  });

  it('projects agent artifacts as ordinary image nodes only', () => {
    useCanvasStore.getState().addAgentNodes({
      artifacts: {
        character: [
          { id: 'c1', kind: 'image', name: 'Alice', url: 'http://x/1.png' },
          { id: 'c2', kind: 'image', name: 'Bob', url: 'http://x/2.png' },
        ],
        scene: [{ id: 's1', kind: 'image', name: 'Rain', url: 'http://x/s1.png' }],
      },
    } as any);

    const nodes = useCanvasStore.getState().nodes;
    expect(nodes).toHaveLength(3);
    expect(nodes.every((node) => node.type === 'image')).toBe(true);
    expect(nodes.some((node) => node.type === 'agent_node')).toBe(false);
  });

  it('does not duplicate assets when the same agent snapshot is replayed', () => {
    const input = { artifacts: { character: [{ id: 'c1', name: 'Alice', url: 'u' }] } };
    useCanvasStore.getState().addAgentNodes(input as any);
    useCanvasStore.getState().addAgentNodes(input as any);

    const nodes = useCanvasStore.getState().nodes;
    expect(nodes).toHaveLength(1);
    expect(new Set(nodes.map((node) => node.id)).size).toBe(1);
  });

  it('keeps normal image node metadata and user-drawn nodes', () => {
    useCanvasStore.setState({
      nodes: [{ id: 'user-image', type: 'image', x: 10, y: 20, w: 260, url: 'user' } as any],
    });
    useCanvasStore.getState().addAgentNodes({
      artifacts: {
        character: [{
          id: 'c1', name: 'Alice', url: 'agent', prompt: 'long hair', provider_id: 'p', model_id: 'm',
        }],
      },
    } as any);

    const nodes = useCanvasStore.getState().nodes;
    const agentImage = nodes.find((node) => node.url === 'agent');
    expect(nodes.find((node) => node.id === 'user-image')).toBeDefined();
    expect(agentImage).toMatchObject({ type: 'image', name: 'Alice', _assetPrompt: 'long hair', _assetKind: 'character' });
  });

  it('removes projected asset nodes without removing normal canvas nodes', () => {
    useCanvasStore.getState().addAgentNodes({ artifacts: { character: [{ id: 'c1', url: 'agent' }] } } as any);
    useCanvasStore.getState().clearAgentNodes();
    expect(useCanvasStore.getState().nodes).toHaveLength(0);
  });
});
