import { describe, it, expect, beforeEach } from 'vitest';
import { useCanvasStore } from '@/components/infinite-canvas/use-canvas-store';

describe('clearAgentNodes', () => {
  beforeEach(() => {
    useCanvasStore.setState({ nodes: [], connections: [], nodeOverrides: {} });
  });

  it('removes only nodes with id starting with "agent-", keeps other types and ids', () => {
    // addAgentNodes 现在创建的是 'image' 和 'prompt' 节点，id 都以 'agent-' 开头
    // （旧 'agent_node' 自定义类型已不再被 addAgentNodes 创建，但理论上仍可能存在）
    useCanvasStore.setState({
      nodes: [
        // 用户画的 image 节点（不以 'agent-' 开头）→ 保留
        { id: 'user-image-1', type: 'image', x: 0, y: 0, w: 100 } as any,
        // agent 投影的 image 节点（id 以 'agent-' 开头）→ 删除
        { id: 'agent-asset-character-p1-c1', type: 'image', x: 0, y: 0, w: 260, url: 'u' } as any,
        // agent 投影的 prompt header（id 以 'agent-' 开头）→ 删除
        { id: 'agent-cat-character-p1', type: 'prompt', x: 0, y: 0, w: 220 } as any,
        // 用户画的 prompt 节点 → 保留
        { id: 'user-prompt-1', type: 'prompt', x: 0, y: 0, w: 200 } as any,
        // 兜底：旧的 'agent_node' 自定义类型如果仍残留（有 id 但没 'agent-' 前缀）也保留
        { id: 'legacy-node', type: 'agent_node', x: 0, y: 0, w: 280, _agentTaskType: 'goal' } as any,
      ],
    });
    useCanvasStore.getState().clearAgentNodes();
    const ids = useCanvasStore.getState().nodes.map((n) => n.id).sort();
    // 留下：user-image-1, user-prompt-1, legacy-node（不以 'agent-' 开头）
    expect(ids).toEqual(['legacy-node', 'user-image-1', 'user-prompt-1']);
  });

  it('keeps nodeOverrides intact (does not clear)', () => {
    useCanvasStore.setState({
      nodes: [
        { id: 'agent-cat-character-p1', type: 'prompt', x: 0, y: 0, w: 220 } as any,
      ],
      nodeOverrides: { 'agent-cat-character-p1': { dx: 10, dy: 20 } },
    });
    useCanvasStore.getState().clearAgentNodes();
    expect(useCanvasStore.getState().nodeOverrides).toEqual({
      'agent-cat-character-p1': { dx: 10, dy: 20 },
    });
  });

  it('removes connections attached to projected asset nodes', () => {
    useCanvasStore.setState({
      nodes: [
        { id: 'agent-asset-1', type: 'image', x: 0, y: 0, w: 260 } as any,
        { id: 'user-image-1', type: 'image', x: 300, y: 0, w: 260 } as any,
      ],
      connections: [{ id: 'c1', from: 'agent-asset-1', to: 'user-image-1' }],
    });
    useCanvasStore.getState().clearAgentNodes();
    expect(useCanvasStore.getState().connections).toEqual([]);
  });
});
