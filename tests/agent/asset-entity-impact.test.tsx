import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { CanvasAssetPanel } from '../../components/infinite-canvas/CanvasAssetPanel';
import { useCanvasStore } from '../../components/infinite-canvas/use-canvas-store';
import { api } from '../../services/apiClient';

vi.mock('../../i18n', () => ({
  useI18n: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock('../../services/apiClient', () => ({
  api: {
    identifyAsset: vi.fn(),
    getEntityImpact: vi.fn(),
  },
  uploadImageWithPreview: vi.fn(),
}));

describe('CanvasAssetPanel entity impact (Story Bible)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useCanvasStore.setState({
      projectId: 'p1',
      taskAssets: [],
      nodes: [],
      connections: [],
      nodeOverrides: {},
      theme: 'light',
    } as any);
  });

  it('shows the entity badge only for assets bound to a story entity', () => {
    useCanvasStore.setState({
      taskAssets: [
        { id: 'char-1', kind: 'character', name: '林尘', url: '/c.png', storyEntityId: 'e-1', storyEntityName: '林尘' } as any,
        { id: 'img-1', kind: 'image', name: '散图', url: '/i.png' } as any,
      ],
    } as any);

    render(<CanvasAssetPanel open onClose={() => undefined} />);

    expect(screen.getByTestId('entity-impact-char-1')).toBeInTheDocument();
    expect(screen.queryByTestId('entity-impact-img-1')).toBeNull();
  });

  it('expands impacted shots on badge click', async () => {
    useCanvasStore.setState({
      taskAssets: [
        { id: 'char-1', kind: 'character', name: '林尘', url: '/c.png', storyEntityId: 'e-1', storyEntityName: '林尘' } as any,
      ],
    } as any);
    (api.getEntityImpact as any).mockResolvedValue({
      story_entity_id: 'e-1',
      impacted_shots: 2,
      impact: [
        { asset_id: 's1', title: '雨夜天台对峙', brief: '雨夜天台对峙' },
        { asset_id: 's2', title: '清晨咖啡馆', brief: '清晨咖啡馆' },
      ],
    });

    render(<CanvasAssetPanel open onClose={() => undefined} />);

    fireEvent.click(screen.getByTestId('entity-impact-char-1'));

    await waitFor(() => {
      expect(api.getEntityImpact).toHaveBeenCalledWith('e-1', 'p1');
    });
    const list = await screen.findByTestId('entity-impact-list-char-1');
    expect(list.textContent).toContain('canvasPanelEntityImpactCount');
    expect(list.textContent).toContain('雨夜天台对峙');
    expect(list.textContent).toContain('清晨咖啡馆');
  });

  it('shows the empty state when no shot references the entity', async () => {
    useCanvasStore.setState({
      taskAssets: [
        { id: 'prop-1', kind: 'prop', name: '青铜剑', url: '/p.png', storyEntityId: 'e-2', storyEntityName: '青铜剑' } as any,
      ],
    } as any);
    (api.getEntityImpact as any).mockResolvedValue({
      story_entity_id: 'e-2',
      impacted_shots: 0,
      impact: [],
    });

    render(<CanvasAssetPanel open onClose={() => undefined} />);

    fireEvent.click(screen.getByTestId('entity-impact-prop-1'));

    const list = await screen.findByTestId('entity-impact-list-prop-1');
    expect(list.textContent).toContain('canvasPanelEntityImpactNone');
  });
});
