import React, { useCallback, useRef, useEffect, useMemo } from 'react';
import { useCanvasStore } from './use-canvas-store';
import {
  minimapBounds,
  estimatedNodeRect,
  currentWorldViewRect,
} from './engine';

export const CanvasMiniMap: React.FC = React.memo(() => {
  const boardRef = useRef<HTMLDivElement | null>(null);
  const nodes = useCanvasStore((s) => s.nodes);
  const selected = useCanvasStore((s) => s.selected);
  const viewport = useCanvasStore((s) => s.viewport);
  const setViewport = useCanvasStore((s) => s.setViewport);

  const setBoardRef = useCallback((el: HTMLDivElement | null) => {
    boardRef.current = el;
  }, []);

  const bounds = useMemo(() => {
    const rect = boardRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0, w: 6000, h: 4000 };
    return minimapBounds(nodes, rect, viewport);
  }, [nodes, viewport]);

  const mmW = 172;
  const mmH = 110;
  const scale = Math.min(mmW / bounds.w, mmH / bounds.h);
  const ox = (mmW - bounds.w * scale) / 2;
  const oy = (mmH - bounds.h * scale) / 2;

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      const mmEl = e.currentTarget.getBoundingClientRect();
      const rect = boardRef.current?.getBoundingClientRect();
      if (!rect) return;

      const toWorld = (cx: number, cy: number) => ({
        x: (cx - mmEl.left - ox) / scale + bounds.x,
        y: (cy - mmEl.top - oy) / scale + bounds.y,
      });

      const onMove = (ev: MouseEvent) => {
        const wp = toWorld(ev.clientX, ev.clientY);
        setViewport({
          ...viewport,
          x: rect.width / 2 - wp.x * viewport.scale,
          y: rect.height / 2 - wp.y * viewport.scale,
        });
      };

      onMove(e.nativeEvent);
      window.addEventListener('mousemove', onMove);
      const onUp = () => {
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
      };
      window.addEventListener('mouseup', onUp);
    },
    [bounds, scale, ox, oy, viewport, setViewport]
  );

  const viewRect = useMemo(() => {
    const rect = boardRef.current?.getBoundingClientRect();
    if (!rect) return null;
    return currentWorldViewRect(rect, viewport);
  }, [viewport]);

  const vpStyle: React.CSSProperties = viewRect
    ? {
        left: (viewRect.x - bounds.x) * scale + ox,
        top: (viewRect.y - bounds.y) * scale + oy,
        width: viewRect.w * scale,
        height: viewRect.h * scale,
      }
    : { display: 'none' };

  return (
    <div className="smart-minimap" onMouseDown={handleMouseDown}>
      <div className="smart-minimap-content">
        {nodes.map((n) => {
          const nr = estimatedNodeRect(n);
          return (
            <div
              key={n.id}
              className={`minimap-node ${selected.has(n.id) ? 'selected' : ''}`}
              style={{
                left: (nr.x - bounds.x) * scale + ox,
                top: (nr.y - bounds.y) * scale + oy,
                width: Math.max(2, nr.w * scale),
                height: Math.max(2, nr.h * scale),
              }}
            />
          );
        })}
        <div className="smart-minimap-viewport" style={vpStyle} />
        {!nodes.length && <div className="minimap-empty">NAVIGATE</div>}
      </div>
    </div>
  );
});

CanvasMiniMap.displayName = 'CanvasMiniMap';
