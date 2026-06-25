import React, { useCallback, useEffect, useRef, useState } from 'react';
import { X, ChevronLeft, ChevronRight, Download, Archive, MessageSquare } from 'lucide-react';
import { useI18n } from '../../i18n';

interface LightboxImage {
  url: string;
  name?: string;
  width?: number;
  height?: number;
  prompt?: string;
}

interface OutputLightboxProps {
  open: boolean;
  images: LightboxImage[];
  initialIndex?: number;
  onClose: () => void;
}

export const OutputLightbox: React.FC<OutputLightboxProps> = React.memo(
  ({ open, images, initialIndex = 0, onClose }) => {
    const { t } = useI18n();
    const [index, setIndex] = useState(initialIndex);
    const [zoom, setZoom] = useState(1);
    const [pan, setPan] = useState({ x: 0, y: 0 });
    const [isPanning, setIsPanning] = useState(false);
    const [showPrompt, setShowPrompt] = useState(false);
    const panRef = useRef<{ startX: number; startY: number; panX: number; panY: number } | null>(null);

    useEffect(() => {
      setIndex(initialIndex);
      setZoom(1);
      setPan({ x: 0, y: 0 });
    }, [initialIndex, open]);

    const current = images[index];

    const handleKeyDown = useCallback(
      (e: KeyboardEvent) => {
        if (!open) return;
        if (e.key === 'Escape') onClose();
        if (e.key === 'ArrowLeft' && index > 0) {
          setIndex((i) => i - 1);
          setZoom(1);
          setPan({ x: 0, y: 0 });
        }
        if (e.key === 'ArrowRight' && index < images.length - 1) {
          setIndex((i) => i + 1);
          setZoom(1);
          setPan({ x: 0, y: 0 });
        }
      },
      [open, index, images.length, onClose]
    );

    useEffect(() => {
      window.addEventListener('keydown', handleKeyDown);
      return () => window.removeEventListener('keydown', handleKeyDown);
    }, [handleKeyDown]);

    const handleWheel = useCallback(
      (e: React.WheelEvent) => {
        e.preventDefault();
        const newZoom = Math.max(0.25, Math.min(8, zoom * (e.deltaY < 0 ? 1.15 : 1 / 1.15)));
        setZoom(newZoom);
      },
      [zoom]
    );

    const handleMouseDown = useCallback(
      (e: React.MouseEvent) => {
        if (e.button !== 0) return;
        setIsPanning(true);
        panRef.current = { startX: e.clientX, startY: e.clientY, panX: pan.x, panY: pan.y };
      },
      [pan]
    );

    const handleMouseMove = useCallback(
      (e: React.MouseEvent) => {
        if (!isPanning || !panRef.current) return;
        const dx = e.clientX - panRef.current.startX;
        const dy = e.clientY - panRef.current.startY;
        setPan({ x: panRef.current.panX + dx, y: panRef.current.panY + dy });
      },
      [isPanning]
    );

    const handleMouseUp = useCallback(() => {
      setIsPanning(false);
      panRef.current = null;
    }, []);

    const handleDownload = useCallback(() => {
      if (!current) return;
      const a = document.createElement('a');
      a.href = current.url;
      a.download = current.name || 'image.png';
      a.click();
    }, [current]);

    const handleDownloadAll = useCallback(() => {
      images.forEach((img) => {
        const a = document.createElement('a');
        a.href = img.url;
        a.download = img.name || 'image.png';
        a.click();
      });
    }, [images]);

    const handleResetZoom = useCallback(() => {
      setZoom(1);
      setPan({ x: 0, y: 0 });
    }, []);

    if (!open || !current) return null;

    return (
      <div className="output-lightbox open" onClick={onClose}>
        <div className="output-lightbox-shell" onClick={(e) => e.stopPropagation()}>
          <div
            className={`output-preview${isPanning ? ' panning' : ''}`}
            onWheel={handleWheel}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
          >
            <img
              className="output-single-img"
              src={current.url}
              alt={current.name || 'preview'}
              style={{
                transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
                transformOrigin: '0 0',
              }}
              draggable={false}
            />
            <div className="output-preview-bar">
              <div className="output-resolution" onDoubleClick={handleResetZoom} title={t('canvasLightboxResetZoom')}>
                {current.width && current.height
                  ? `${current.width}×${current.height}`
                  : `${Math.round(zoom * 100)}%`}
              </div>
              <div className="output-preview-actions">
                {images.length > 1 && (
                  <>
                    <button
                      className="preview-icon-btn"
                      type="button"
                      title={t('canvasLightboxPrev')}
                      disabled={index === 0}
                      onClick={() => {
                        setIndex((i) => i - 1);
                        setZoom(1);
                        setPan({ x: 0, y: 0 });
                      }}
                    >
                      <ChevronLeft size={14} />
                    </button>
                    <span style={{ color: '#111827', fontSize: '11px', fontWeight: 700, display: 'flex', alignItems: 'center' }}>
                      {index + 1}/{images.length}
                    </span>
                    <button
                      className="preview-icon-btn"
                      type="button"
                      title={t('canvasLightboxNext')}
                      disabled={index === images.length - 1}
                      onClick={() => {
                        setIndex((i) => i + 1);
                        setZoom(1);
                        setPan({ x: 0, y: 0 });
                      }}
                    >
                      <ChevronRight size={14} />
                    </button>
                  </>
                )}
                <button className="preview-icon-btn" type="button" title={t('canvasLightboxDownload')} onClick={handleDownload}>
                  <Download size={14} />
                </button>
                {images.length > 1 && (
                  <button className="preview-icon-btn" type="button" title={t('canvasLightboxDownloadAll')} onClick={handleDownloadAll}>
                    <Archive size={14} />
                  </button>
                )}
                {current.prompt && (
                  <button
                    className="preview-icon-btn"
                    type="button"
                    title={t('canvasLightboxPrompt')}
                    onClick={() => setShowPrompt((s) => !s)}
                  >
                    <MessageSquare size={14} />
                  </button>
                )}
                <button className="preview-icon-btn" type="button" title={t('canvasLightboxClose')} onClick={onClose}>
                  <X size={14} />
                </button>
              </div>
            </div>
          </div>
          {current.prompt && showPrompt && (
            <div className="output-prompt-panel open">
              <div className="output-prompt-text">{current.prompt}</div>
              <div className="output-prompt-actions">
                <button
                  className="preview-text-btn secondary"
                  type="button"
                  onClick={() => navigator.clipboard?.writeText(current.prompt || '')}
                >
                  {t('canvasLightboxCopyPrompt')}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }
);

OutputLightbox.displayName = 'OutputLightbox';
