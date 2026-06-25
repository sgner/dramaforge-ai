import { Viewport, CanvasNode, PortPoint } from './types';
import { DEFAULT_NODE_SIZES } from './types';

export function screenToWorld(
  clientX: number,
  clientY: number,
  boardRect: DOMRect,
  viewport: Viewport
): { x: number; y: number } {
  return {
    x: (clientX - boardRect.left - viewport.x) / viewport.scale,
    y: (clientY - boardRect.top - viewport.y) / viewport.scale,
  };
}

export function worldToScreen(
  worldX: number,
  worldY: number,
  boardRect: DOMRect,
  viewport: Viewport
): { x: number; y: number } {
  return {
    x: worldX * viewport.scale + viewport.x + boardRect.left,
    y: worldY * viewport.scale + viewport.y + boardRect.top,
  };
}

export function applyViewportTransform(viewport: Viewport): string {
  return `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.scale})`;
}

export function estimatedNodeRect(n: CanvasNode): {
  x: number;
  y: number;
  w: number;
  h: number;
} {
  const size = DEFAULT_NODE_SIZES[n.type] || { w: 260 };
  return {
    x: n.x || 0,
    y: n.y || 0,
    w: n.w || size.w || 260,
    h: n.h || size.h || 160,
  };
}

export function currentWorldViewRect(
  boardRect: DOMRect,
  viewport: Viewport
): { x: number; y: number; w: number; h: number } {
  const scale = viewport.scale || 1;
  return {
    x: -viewport.x / scale,
    y: -viewport.y / scale,
    w: boardRect.width / scale,
    h: boardRect.height / scale,
  };
}

export function minimapBounds(
  nodes: CanvasNode[],
  boardRect: DOMRect,
  viewport: Viewport
): { x: number; y: number; w: number; h: number } {
  const rects = nodes.map(estimatedNodeRect);
  rects.push(currentWorldViewRect(boardRect, viewport));
  if (!rects.length) return { x: 0, y: 0, w: 1000, h: 700 };
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  rects.forEach((r) => {
    minX = Math.min(minX, r.x);
    minY = Math.min(minY, r.y);
    maxX = Math.max(maxX, r.x + r.w);
    maxY = Math.max(maxY, r.y + r.h);
  });
  const pad = Math.max(
    240,
    Math.max(maxX - minX, maxY - minY) * 0.08
  );
  return {
    x: minX - pad,
    y: minY - pad,
    w: Math.max(1, maxX - minX + pad * 2),
    h: Math.max(1, maxY - minY + pad * 2),
  };
}

export function portPoint(
  node: CanvasNode,
  kind: 'in' | 'out'
): PortPoint {
  const rect = estimatedNodeRect(node);
  if (kind === 'out') {
    return { x: rect.x + rect.w, y: rect.y + rect.h / 2 };
  }
  return { x: rect.x, y: rect.y + rect.h / 2 };
}

export function cubicBezierPath(
  x1: number,
  y1: number,
  x2: number,
  y2: number
): string {
  const dx = Math.max(80, Math.abs(x2 - x1) * 0.45);
  return `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;
}

export function cubicPoint(
  a: PortPoint,
  b: PortPoint,
  t: number
): PortPoint {
  const dx = Math.max(80, Math.abs(b.x - a.x) * 0.45);
  const p1 = { x: a.x + dx, y: a.y };
  const p2 = { x: b.x - dx, y: b.y };
  const u = 1 - t;
  return {
    x:
      u * u * u * a.x +
      3 * u * u * t * p1.x +
      3 * u * t * t * p2.x +
      t * t * t * b.x,
    y:
      u * u * u * a.y +
      3 * u * u * t * p1.y +
      3 * u * t * t * p2.y +
      t * t * t * b.y,
  };
}

export function pointSegmentDistance(
  p: PortPoint,
  a: PortPoint,
  b: PortPoint
): number {
  const dx = b.x - a.x,
    dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (!len2) return Math.hypot(p.x - a.x, p.y - a.y);
  const t = Math.max(
    0,
    Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2)
  );
  return Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t));
}

export function segmentsIntersect(
  a: PortPoint,
  b: PortPoint,
  c: PortPoint,
  d: PortPoint
): boolean {
  const orient = (
    p: PortPoint,
    q: PortPoint,
    r: PortPoint
  ) =>
    (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  const onSeg = (
    p: PortPoint,
    q: PortPoint,
    r: PortPoint
  ) =>
    Math.min(p.x, r.x) <= q.x &&
    q.x <= Math.max(p.x, r.x) &&
    Math.min(p.y, r.y) <= q.y &&
    q.y <= Math.max(p.y, r.y);
  const o1 = orient(a, b, c),
    o2 = orient(a, b, d),
    o3 = orient(c, d, a),
    o4 = orient(c, d, b);
  if (o1 === 0 && onSeg(a, c, b)) return true;
  if (o2 === 0 && onSeg(a, d, b)) return true;
  if (o3 === 0 && onSeg(c, a, d)) return true;
  if (o4 === 0 && onSeg(c, b, d)) return true;
  return o1 > 0 !== o2 > 0 && o3 > 0 !== o4 > 0;
}

export function clampScale(scale: number): number {
  return Math.max(0.12, Math.min(8, scale));
}

export function zoomAtPoint(
  clientX: number,
  clientY: number,
  boardRect: DOMRect,
  viewport: Viewport,
  delta: number
): Viewport {
  const before = screenToWorld(clientX, clientY, boardRect, viewport);
  const newScale = clampScale(viewport.scale * (delta > 0 ? 0.92 : 1.08));
  return {
    scale: newScale,
    x: clientX - boardRect.left - before.x * newScale,
    y: clientY - boardRect.top - before.y * newScale,
  };
}

export function centerViewportOnWorldPoint(
  point: PortPoint,
  boardRect: DOMRect,
  viewport: Viewport
): Viewport {
  return {
    ...viewport,
    x: boardRect.width / 2 - point.x * viewport.scale,
    y: boardRect.height / 2 - point.y * viewport.scale,
  };
}

export function isEditableTarget(target: EventTarget | null): boolean {
  if (!target || !(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return (
    tag === 'INPUT' ||
    tag === 'TEXTAREA' ||
    tag === 'SELECT' ||
    tag === 'OPTION' ||
    target.isContentEditable
  );
}

export function isNodeControl(target: HTMLElement): boolean {
  return !!target.closest(
    'textarea, input, select, option, button, audio, video, [contenteditable="true"], .port, .resize-handle, .output-img-wrap'
  );
}

export function isNodeDragSurface(target: HTMLElement): boolean {
  return (
    !isNodeControl(target) &&
    !target.closest('.port, .resize-handle, .output-img-wrap')
  );
}
