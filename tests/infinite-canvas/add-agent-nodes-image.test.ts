/**
 * TDD: addAgentNodes — 把 agent 产出的资产投影到画布，**复用现有 'image' 节点**。
 *
 * 设计原则（与 use-canvas-store.addAgentNodes 同步）：
 *  - 每个 asset 投影为 1 个 'image' 节点（不是再造轮子），
 *    这样用户可以：上传 / 展示 / Image-to-Image 生成 / 右键菜单 / 重试失败
 *  - 每个非空 asset_kind 桶投影为 1 个 'prompt' header（带分类名 + 数量）
 *  - image 节点挂在 header 下，_groupId 指向 header.id
 *  - 同一分类内 image 垂直堆叠；不同分类垂直分段（每段含 header + stack）
 *  - ID 前缀约定：`agent-` 开头，clearAgentNodes / relayoutAgentNodes /
 *    fitAgentView 都按前缀过滤
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { useCanvasStore } from '@/components/infinite-canvas/use-canvas-store';

const projectId = 'p1';

describe('addAgentNodes (reuses image nodes)', () => {
  beforeEach(() => {
    useCanvasStore.setState({
      projectId,
      nodes: [],
      connections: [],
      nodeOverrides: {},
    });
  });

  it('projects each asset as an image node (not custom agent_node)', () => {
    useCanvasStore.getState().addAgentNodes({
      userGoal: '',
      plan: [],
      actions: [],
      observations: [],
      artifacts: {
        character: [
          { id: 'c1', kind: 'image', name: 'Alice', url: 'http://x/1.png' },
          { id: 'c2', kind: 'image', name: 'Bob', url: 'http://x/2.png' },
        ],
        scene: [{ id: 's1', kind: 'image', name: 'Rain', url: 'http://x/s1.png' }],
      },
      pendingQuestion: null,
    });
    const nodes = useCanvasStore.getState().nodes;
    const imageNodes = nodes.filter((n) => n.type === 'image');
    const headerNodes = nodes.filter((n) => n.type === 'prompt');
    // 3 个 image（2 character + 1 scene）
    expect(imageNodes).toHaveLength(3);
    // 2 个 header（角色 + 场景）
    expect(headerNodes).toHaveLength(2);
    // 关键：不再用自定义的 'agent_node' 类型了
    expect(nodes.filter((n) => n.type === 'agent_node')).toHaveLength(0);
  });

  it('image node carries asset metadata: url, name, _assetPrompt, _assetKind, _groupId', () => {
    useCanvasStore.getState().addAgentNodes({
      userGoal: '',
      plan: [],
      actions: [],
      observations: [],
      artifacts: {
        character: [{
          id: 'c1',
          kind: 'image',
          name: 'Alice',
          url: 'http://x/alice.png',
          prompt: 'a girl with long hair',
          provider_id: 'custom-api',
          provider_name: 'Custom API',
          model_id: 'gpt-5.4-mini',
        }],
      },
      pendingQuestion: null,
    });
    const img = useCanvasStore.getState().nodes.find(
      (n) => n.type === 'image' && n.url === 'http://x/alice.png',
    );
    expect(img).toBeDefined();
    expect(img!.name).toBe('Alice');
    expect(img!._assetPrompt).toBe('a girl with long hair');
    expect(img!._assetProviderId).toBe('custom-api');
    expect(img!._assetProviderName).toBe('Custom API');
    expect(img!._assetModelId).toBe('gpt-5.4-mini');
    expect(img!._assetKind).toBe('character');
    expect(img!._groupId).toBe(`agent-cat-character-${projectId}`);
  });

  it('image nodes in same category share _groupId and stack vertically', () => {
    useCanvasStore.getState().addAgentNodes({
      userGoal: '',
      plan: [],
      actions: [],
      observations: [],
      artifacts: {
        character: [
          { id: 'c1', name: 'A', url: 'u1' },
          { id: 'c2', name: 'B', url: 'u2' },
          { id: 'c3', name: 'C', url: 'u3' },
        ],
      },
      pendingQuestion: null,
    });
    const imgs = useCanvasStore
      .getState()
      .nodes.filter((n) => n.type === 'image')
      .sort((a, b) => a.y - b.y);
    expect(imgs[0]._groupId).toBe(imgs[1]._groupId);
    expect(imgs[1]._groupId).toBe(imgs[2]._groupId);
    // 同一分类内垂直堆叠：x 相同，y 递增
    expect(imgs[0].x).toBe(imgs[1].x);
    expect(imgs[0].x).toBe(imgs[2].x);
    expect(imgs[1].y).toBeGreaterThan(imgs[0].y);
    expect(imgs[2].y).toBeGreaterThan(imgs[1].y);
  });

  it('header sits at x=0 (left of image column), image column starts at x=220+32', () => {
    useCanvasStore.getState().addAgentNodes({
      userGoal: '',
      plan: [],
      actions: [],
      observations: [],
      artifacts: { character: [{ id: 'c1', name: 'A', url: 'u' }] } as any,
      pendingQuestion: null,
    });
    const header = useCanvasStore.getState().nodes.find(
      (n) => n.id === `agent-cat-character-${projectId}`,
    );
    const img = useCanvasStore.getState().nodes.find(
      (n) => n.type === 'image' && n._groupId === header!.id,
    );
    expect(header!.x).toBe(0);
    expect(img!.x).toBe(252); // 220 (HEADER_W) + 32 (COL_GAP_X)
  });

  it('multiple categories stack vertically with row gap', () => {
    useCanvasStore.getState().addAgentNodes({
      userGoal: '',
      plan: [],
      actions: [],
      observations: [],
      artifacts: {
        character: [{ id: 'c1', name: 'A', url: 'u' }],
        scene: [{ id: 's1', name: 'Rain', url: 'u' }],
      },
      pendingQuestion: null,
    });
    const characterHeader = useCanvasStore.getState().nodes.find(
      (n) => n.id === `agent-cat-character-${projectId}`,
    );
    const sceneHeader = useCanvasStore.getState().nodes.find(
      (n) => n.id === `agent-cat-scene-${projectId}`,
    );
    // scene header 必须在 character 之下
    expect(sceneHeader!.y).toBeGreaterThan(characterHeader!.y);
    // 间距 >= HEADER_H (80) + ROW_GAP_Y (32) = 112
    expect(sceneHeader!.y - characterHeader!.y).toBeGreaterThanOrEqual(112);
  });

  it('preserves user-drawn non-agent nodes (image / prompt / etc.)', () => {
    useCanvasStore.setState({
      projectId,
      nodes: [
        { id: 'u1', type: 'image', x: 1000, y: 1000, w: 260, h: 178, url: 'u' } as any,
        { id: 'u2', type: 'prompt', x: 2000, y: 1000, w: 310, h: 200, title: 'my prompt' } as any,
      ],
      connections: [],
    });
    useCanvasStore.getState().addAgentNodes({
      userGoal: '',
      plan: [],
      actions: [],
      observations: [],
      artifacts: { character: [{ id: 'c1', name: 'A', url: 'u' }] } as any,
      pendingQuestion: null,
    });
    const nodes = useCanvasStore.getState().nodes;
    expect(nodes.some((n) => n.id === 'u1' && n.x === 1000)).toBe(true);
    expect(nodes.some((n) => n.id === 'u2' && n.x === 2000)).toBe(true);
  });

  it('clears all agent-projected nodes (image + header) on second call with empty artifacts', () => {
    useCanvasStore.getState().addAgentNodes({
      userGoal: '',
      plan: [],
      actions: [],
      observations: [],
      artifacts: { character: [{ id: 'c1' }] } as any,
      pendingQuestion: null,
    });
    expect(useCanvasStore.getState().nodes.filter((n) => n.id.startsWith('agent-')).length).toBeGreaterThan(0);
    useCanvasStore.getState().addAgentNodes({
      userGoal: '',
      plan: [],
      actions: [],
      observations: [],
      artifacts: {},
      pendingQuestion: null,
    });
    expect(useCanvasStore.getState().nodes.filter((n) => n.id.startsWith('agent-'))).toHaveLength(0);
  });

  it('handles assets with bucket keys not in the canonical kind list (fallback)', () => {
    useCanvasStore.getState().addAgentNodes({
      userGoal: '',
      plan: [],
      actions: [],
      observations: [],
      artifacts: {
        storyboards: [{ id: 'b1', name: 'Shot 1', url: 'u' }] as any,
        custom_kind: [{ id: 'x1', name: 'X', url: 'u' }] as any,
      },
      pendingQuestion: null,
    });
    const headers = useCanvasStore.getState().nodes.filter((n) => n.type === 'prompt');
    const headerLabels = headers.map((h) => h.title);
    expect(headerLabels).toContain('storyboards (1)');
    expect(headerLabels).toContain('custom_kind (1)');
  });

  it('does not create any connections between agent nodes (assets have no temporal order)', () => {
    useCanvasStore.getState().addAgentNodes({
      userGoal: '',
      plan: [],
      actions: [],
      observations: [],
      artifacts: {
        character: [{ id: 'c1' }, { id: 'c2' }] as any,
        scene: [{ id: 's1' }] as any,
      },
      pendingQuestion: null,
    });
    expect(useCanvasStore.getState().connections).toHaveLength(0);
  });

  it('records drag offset and re-applies it on subsequent addAgentNodes calls', () => {
    useCanvasStore.getState().addAgentNodes({
      userGoal: '',
      plan: [],
      actions: [],
      observations: [],
      artifacts: { character: [{ id: 'c1', url: 'u' }] } as any,
      pendingQuestion: null,
    });
    const headerId = `agent-cat-character-${projectId}`;
    const before = useCanvasStore.getState().nodes.find((n) => n.id === headerId)!;
    // 模拟用户拖动 header 移动 (50, 30)
    useCanvasStore.getState().recordAgentNodeDrag(headerId, before.x + 50, before.y + 30);
    // 第二次 addAgentNodes 应把 override 应用上去
    useCanvasStore.getState().addAgentNodes({
      userGoal: '',
      plan: [],
      actions: [],
      observations: [],
      artifacts: { character: [{ id: 'c1', url: 'u' }] } as any,
      pendingQuestion: null,
    });
    const after = useCanvasStore.getState().nodes.find((n) => n.id === headerId)!;
    expect(after.x).toBe(before.x + 50);
    expect(after.y).toBe(before.y + 30);
  });

  it('relayout clears all overrides and re-snaps to default grid', () => {
    useCanvasStore.getState().addAgentNodes({
      userGoal: '',
      plan: [],
      actions: [],
      observations: [],
      artifacts: { character: [{ id: 'c1', url: 'u' }] } as any,
      pendingQuestion: null,
    });
    const headerId = `agent-cat-character-${projectId}`;
    useCanvasStore.setState({
      nodeOverrides: { [headerId]: { dx: 999, dy: 999 } },
    });
    useCanvasStore.getState().relayoutAgentNodes();
    const header = useCanvasStore.getState().nodes.find((n) => n.id === headerId)!;
    expect(header.x).toBe(0);
    expect(header.y).toBe(0);
    expect(useCanvasStore.getState().nodeOverrides[headerId]).toBeUndefined();
  });
});
