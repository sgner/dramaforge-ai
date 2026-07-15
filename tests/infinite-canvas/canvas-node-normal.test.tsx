import { describe, expect, it, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CanvasNodeComponent } from '@/components/infinite-canvas/CanvasNode';
import { useCanvasStore } from '@/components/infinite-canvas/use-canvas-store';

describe('ordinary canvas nodes', () => {
  beforeEach(() => {
    useCanvasStore.setState({ nodes: [], connections: [], selected: new Set(), nodeOverrides: {} });
  });

  it('renders promptGroup with the same prompt editor as prompt', () => {
    render(
      <CanvasNodeComponent
        node={{ id: 'prompt-group', type: 'promptGroup', x: 0, y: 0, w: 310, text: 'hello' } as any}
        onDragStart={() => {}}
        onResizeStart={() => {}}
        onPortMouseDown={() => {}}
      />,
    );
    expect(screen.getByDisplayValue('hello')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('输入提示词...')).toBeInTheDocument();
  });
});
