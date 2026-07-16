import { beforeEach, describe, expect, it } from 'vitest';
import { useCanvasStore } from '@/components/infinite-canvas/use-canvas-store';

describe('addAgentNodes', () => {
  beforeEach(() => {
    useCanvasStore.setState({ projectId: 'p1', nodes: [], connections: [], nodeOverrides: {}, taskAssets: [] });
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

  // ---- taskAssets 同步测试（让 agent 资产出现在资产库侧栏）----

  it('syncs agent artifacts to taskAssets so they appear in the asset library sidebar', () => {
    useCanvasStore.getState().addAgentNodes({
      artifacts: {
        character: [
          { id: 'c1', name: 'Alice', url: 'http://x/1.png', prompt: 'long hair', provider_id: 'pv1', model_id: 'm1' },
          { id: 'c2', name: 'Bob', url: 'http://x/2.png' },
        ],
        scene: [{ id: 's1', name: 'Rain', url: 'http://x/s1.png' }],
      },
    } as any);

    const assets = useCanvasStore.getState().taskAssets;
    // 3 个资产都应进入 taskAssets
    expect(assets).toHaveLength(3);
    // 每个 agent 资产 id 以 'agent-asset-' 开头
    expect(assets.every((a) => a.id.startsWith('agent-asset-'))).toBe(true);
    // 验证 kind / name / url / prompt 正确投影
    const alice = assets.find((a) => a.name === 'Alice');
    expect(alice).toMatchObject({
      kind: 'character',
      url: 'http://x/1.png',
      prompt: 'long hair',
      providerId: 'pv1',
      modelId: 'm1',
    });
    const rain = assets.find((a) => a.name === 'Rain');
    expect(rain).toMatchObject({ kind: 'scene', url: 'http://x/s1.png' });
  });

  it('does not duplicate taskAssets when the same snapshot is replayed', () => {
    const input = {
      artifacts: { character: [{ id: 'c1', name: 'Alice', url: 'http://x/1.png' }] },
    };
    useCanvasStore.getState().addAgentNodes(input as any);
    useCanvasStore.getState().addAgentNodes(input as any);

    const assets = useCanvasStore.getState().taskAssets;
    // 同一 snapshot 重放不应导致 taskAssets 翻倍
    expect(assets).toHaveLength(1);
    expect(assets[0].name).toBe('Alice');
  });

  it('preserves user/pipeline assets while replacing agent assets on replay', () => {
    // 预置一个用户/流水线资产（非 agent-asset- 前缀）
    useCanvasStore.setState({
      taskAssets: [{ id: 'user-asset-1', kind: 'character', name: 'UserChar', url: 'http://user/1.png' }],
    });
    useCanvasStore.getState().addAgentNodes({
      artifacts: { character: [{ id: 'c1', name: 'AgentChar', url: 'http://x/1.png' }] },
    } as any);

    const assets = useCanvasStore.getState().taskAssets;
    // 用户资产保留 + agent 资产新增
    expect(assets).toHaveLength(2);
    expect(assets.find((a) => a.id === 'user-asset-1')).toBeDefined();
    expect(assets.find((a) => a.name === 'AgentChar')).toBeDefined();
  });

  it('clears agent taskAssets on clearAgentNodes while keeping user assets', () => {
    useCanvasStore.setState({
      taskAssets: [{ id: 'user-asset-1', kind: 'character', name: 'UserChar', url: 'http://user/1.png' }],
    });
    useCanvasStore.getState().addAgentNodes({
      artifacts: { character: [{ id: 'c1', name: 'Alice', url: 'http://x/1.png' }] },
    } as any);
    // agent 资产已入库
    expect(useCanvasStore.getState().taskAssets.some((a) => a.id.startsWith('agent-asset-'))).toBe(true);

    useCanvasStore.getState().clearAgentNodes();

    const assets = useCanvasStore.getState().taskAssets;
    // agent 资产被清掉，用户资产保留
    expect(assets.some((a) => a.id.startsWith('agent-asset-'))).toBe(false);
    expect(assets.find((a) => a.id === 'user-asset-1')).toBeDefined();
  });
});
