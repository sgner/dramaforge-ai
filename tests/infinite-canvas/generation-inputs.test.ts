import { describe, expect, it } from 'vitest';
import { connectedImageUrls } from '../../components/infinite-canvas/use-canvas-store';
import type { CanvasNode, Connection } from '../../components/infinite-canvas/types';

const image = (id: string, url: string): CanvasNode => ({ id, type: 'image', x: 0, y: 0, w: 200, url });

describe('generation node inputs', () => {
  it('collects every connected image in connection order', () => {
    const nodes = [image('scene', 'scene.png'), image('character', 'character.png'), image('prop', 'prop.png')];
    const connections: Connection[] = [
      { id: 'c2', from: 'character', to: 'shot' },
      { id: 'c1', from: 'scene', to: 'shot' },
      { id: 'c3', from: 'prop', to: 'shot' },
    ];
    expect(connectedImageUrls(nodes, connections, 'shot')).toEqual(['character.png', 'scene.png', 'prop.png']);
  });

  it('ignores missing and empty image sources', () => {
    const nodes = [image('scene', ''), { ...image('prop', 'prop.png'), type: 'prompt' as const }];
    expect(connectedImageUrls(nodes, [{ id: 'c', from: 'scene', to: 'shot' }], 'shot')).toEqual([]);
  });
});
