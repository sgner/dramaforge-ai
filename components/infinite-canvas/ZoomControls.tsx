import React, { useCallback } from 'react';
import { useCanvasStore } from './use-canvas-store';

export const ZoomControls: React.FC = React.memo(() => {
  const viewport = useCanvasStore((s) => s.viewport);
  const setViewport = useCanvasStore((s) => s.setViewport);

  const zoomIn = useCallback(() => {
    setViewport({ ...viewport, scale: Math.min(8, viewport.scale * 1.2) });
  }, [viewport, setViewport]);

  const zoomOut = useCallback(() => {
    setViewport({ ...viewport, scale: Math.max(0.12, viewport.scale / 1.2) });
  }, [viewport, setViewport]);

  const resetZoom = useCallback(() => {
    setViewport({ ...viewport, scale: 1 });
  }, [viewport, setViewport]);

  const percent = Math.round(viewport.scale * 100);

  return (
    <div className="zoom-controls">
      <button className="zoom-btn" onClick={zoomOut} title="Zoom Out">
        −
      </button>
      <span className="zoom-percent" onClick={resetZoom} style={{ cursor: 'pointer' }}>
        {percent}%
      </span>
      <button className="zoom-btn" onClick={zoomIn} title="Zoom In">
        +
      </button>
    </div>
  );
});

ZoomControls.displayName = 'ZoomControls';
