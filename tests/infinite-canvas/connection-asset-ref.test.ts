import { describe, it, expect, beforeEach } from 'vitest';
import { useCanvasStore } from '@/components/infinite-canvas/use-canvas-store';
import type { CanvasNode } from '@/components/infinite-canvas/types';

/**
 * 验证创建连线时自动从源节点提取 asset_id 填入 data.asset_ref。
 * 后端 collect_canvas_references() 从连线 data 中提取 asset_ref 收集资产引用关系。
 */
describe('addConnection asset_ref auto-fill', () => {
  beforeEach(() => {
    useCanvasStore.setState({
      projectId: 'p1',
      nodes: [],
      connections: [],
      nodeOverrides: {},
      taskAssets: [],
    });
  });

  it('fills data.asset_ref / role / from_asset_kind when source node is an asset node', () => {
    const assetNode: CanvasNode = {
      id: 'char-1', type: 'image', x: 0, y: 0, w: 260, _assetKind: 'character',
    } as any;
    const targetNode: CanvasNode = {
      id: 'shot-1', type: 'image', x: 300, y: 0, w: 260,
    } as any;
    useCanvasStore.setState({ nodes: [assetNode, targetNode] });

    useCanvasStore.getState().addConnection('char-1', 'shot-1');

    const conns = useCanvasStore.getState().connections;
    expect(conns).toHaveLength(1);
    expect(conns[0]).toMatchObject({
      from: 'char-1',
      to: 'shot-1',
      data: {
        asset_ref: 'char-1',
        role: 'reference',
        from_asset_kind: 'character',
      },
    });
  });

  it('leaves data as empty object when source node is not an asset node', () => {
    // pipeline 节点没有 _assetKind，不应填充 asset_ref
    const pipelineNode: CanvasNode = {
      id: 'pipe-1', type: 'pipeline', x: 0, y: 0, w: 360,
    } as any;
    const targetNode: CanvasNode = {
      id: 'shot-1', type: 'image', x: 400, y: 0, w: 260,
    } as any;
    useCanvasStore.setState({ nodes: [pipelineNode, targetNode] });

    useCanvasStore.getState().addConnection('pipe-1', 'shot-1');

    const conns = useCanvasStore.getState().connections;
    expect(conns).toHaveLength(1);
    expect(conns[0].data).toEqual({});
    // 确保不会误写 asset_ref
    expect(conns[0].data?.asset_ref).toBeUndefined();
  });

  it('fills asset_ref for various asset kinds (scene/prop/storyboard)', () => {
    const sceneNode: CanvasNode = {
      id: 'scene-1', type: 'image', x: 0, y: 0, w: 260, _assetKind: 'scene',
    } as any;
    const targetNode: CanvasNode = {
      id: 'shot-1', type: 'image', x: 300, y: 0, w: 260,
    } as any;
    useCanvasStore.setState({ nodes: [sceneNode, targetNode] });

    useCanvasStore.getState().addConnection('scene-1', 'shot-1');

    const conn = useCanvasStore.getState().connections[0];
    expect(conn.data).toEqual({
      asset_ref: 'scene-1',
      role: 'reference',
      from_asset_kind: 'scene',
    });
  });

  it('still dedupes connections with the same from/to', () => {
    const assetNode: CanvasNode = {
      id: 'char-1', type: 'image', x: 0, y: 0, w: 260, _assetKind: 'character',
    } as any;
    const targetNode: CanvasNode = {
      id: 'shot-1', type: 'image', x: 300, y: 0, w: 260,
    } as any;
    useCanvasStore.setState({ nodes: [assetNode, targetNode] });

    useCanvasStore.getState().addConnection('char-1', 'shot-1');
    useCanvasStore.getState().addConnection('char-1', 'shot-1');

    expect(useCanvasStore.getState().connections).toHaveLength(1);
  });

  it('does not create self-loops or connections with empty endpoints', () => {
    const assetNode: CanvasNode = {
      id: 'char-1', type: 'image', x: 0, y: 0, w: 260, _assetKind: 'character',
    } as any;
    useCanvasStore.setState({ nodes: [assetNode] });

    useCanvasStore.getState().addConnection('char-1', 'char-1');
    useCanvasStore.getState().addConnection('', 'char-1');
    useCanvasStore.getState().addConnection('char-1', '');

    expect(useCanvasStore.getState().connections).toHaveLength(0);
  });

  it('uses node id as asset_ref (node id IS asset id in this codebase)', () => {
    // 节点 id 即资产 id（见 rebuildTaskAssetsFromNodes / addAssetNodeToGroup），
    // 因此 asset_ref 应等于源节点 id，而非某个单独的 assetId 字段。
    const assetNode: CanvasNode = {
      id: 'prop-42', type: 'image', x: 0, y: 0, w: 260, _assetKind: 'prop',
    } as any;
    const targetNode: CanvasNode = {
      id: 'shot-1', type: 'image', x: 300, y: 0, w: 260,
    } as any;
    useCanvasStore.setState({ nodes: [assetNode, targetNode] });

    useCanvasStore.getState().addConnection('prop-42', 'shot-1');

    const conn = useCanvasStore.getState().connections[0];
    expect(conn.data?.asset_ref).toBe('prop-42');
  });
});
