import { describe, expect, it, beforeEach } from 'vitest';
import { useCanvasStore } from '@/components/infinite-canvas/use-canvas-store';

describe('agent asset projection', () => {
  beforeEach(() => {
    useCanvasStore.getState().clearAgentNodes();
  });

  it('lays assets out in columns and creates functional storyboard reference edges', () => {
    useCanvasStore.getState().addAgentNodes({
      userGoal: 'test',
      plan: [],
      actions: [],
      observations: [],
      pendingQuestion: null,
      artifacts: {
        character: [{ id: 'character-1', name: '林尘', url: 'https://cdn.test/character.png' }],
        scene: [{ id: 'scene-1', name: '古堡大厅', url: 'https://cdn.test/scene.png' }],
        storyboard: [{
          id: 'storyboard-1',
          name: '镜头 1',
          url: 'https://cdn.test/storyboard.png',
          extra: { reference_asset_ids: ['character-1', 'scene-1'] },
        }],
      },
    });

    const state = useCanvasStore.getState();
    const character = state.nodes.find((node) => node._assetKind === 'character');
    const scene = state.nodes.find((node) => node._assetKind === 'scene');
    const storyboard = state.nodes.find((node) => node._assetKind === 'storyboard');

    expect(character).toBeDefined();
    expect(scene).toBeDefined();
    expect(storyboard).toBeDefined();
    expect(new Set([character!.x, scene!.x, storyboard!.x]).size).toBeGreaterThan(1);
    expect(state.connections).toEqual(expect.arrayContaining([
      expect.objectContaining({ from: character!.id, to: storyboard!.id }),
      expect.objectContaining({ from: scene!.id, to: storyboard!.id }),
    ]));
  });
});
