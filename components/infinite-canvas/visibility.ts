export interface CanvasViewport {
  x: number;
  y: number;
  scale: number;
}

export interface CanvasBounds {
  width: number;
  height: number;
}

export function getPaddedWorldRect(
  board: CanvasBounds | null,
  viewport: CanvasViewport,
  padding = 2,
): { x: number; y: number; width: number; height: number } {
  const scale = Math.max(viewport.scale || 1, 0.01);
  if (!board) return { x: -3000, y: -2000, width: 6000, height: 4000 };

  const width = (board.width * padding) / scale;
  const height = (board.height * padding) / scale;
  const extraWidth = (board.width * (padding - 1)) / (2 * scale);
  const extraHeight = (board.height * (padding - 1)) / (2 * scale);
  return {
    x: -viewport.x / scale - extraWidth,
    y: -viewport.y / scale - extraHeight,
    width,
    height,
  };
}
