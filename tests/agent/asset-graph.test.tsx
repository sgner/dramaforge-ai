import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CanvasAssetPanel } from '../../components/infinite-canvas/CanvasAssetPanel';
import { useCanvasStore } from '../../components/infinite-canvas/use-canvas-store';

vi.mock('../../i18n', () => ({
  useI18n: () => ({
    t: (key: string) => key,
  }),
}));

describe('CanvasAssetPanel asset metadata', () => {
  beforeEach(() => {
    useCanvasStore.setState({
      taskAssets: [],
      nodes: [],
      connections: [],
      nodeOverrides: {},
      theme: 'light',
    } as any);
  });

  it('renders source, derived, status, and reference role metadata on asset cards', () => {
    useCanvasStore.setState({
      taskAssets: [{
        id: 'derived-character',
        kind: 'character',
        name: 'Hero',
        url: '/hero.png',
        status: 'ready',
        version: 2,
        sourceAssetId: 'source-character',
        derivedFrom: ['source-character'],
        referenceRole: 'character',
        promptSource: 'raw prompt',
        promptOptimized: 'optimized prompt',
      } as any],
    } as any);

    render(<CanvasAssetPanel open onClose={() => undefined} />);

    expect(screen.getByText('Hero')).toBeInTheDocument();
    expect(screen.getByText(/ready/i)).toBeInTheDocument();
    expect(screen.getByText(/source-character/i)).toBeInTheDocument();
    expect(screen.getAllByText(/character/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/v2/i)).toBeInTheDocument();
  });
});
