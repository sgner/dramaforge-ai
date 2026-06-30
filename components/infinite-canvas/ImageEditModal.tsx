import React, { useState, useCallback, useRef, useEffect } from 'react';
import { Scissors, RefreshCw, Palette, Settings, Theater, Brush, MoveHorizontal, LayoutGrid, X, RotateCcw, RotateCw, FlipHorizontal, FlipVertical } from 'lucide-react';
import { useI18n } from '../../i18n';

type EditMode = 'crop' | 'mask' | 'draw' | 'outpaint' | 'grid' | 'rotate' | 'filter' | 'adjust';

interface ImageEditModalProps {
  open: boolean;
  imageUrl?: string;
  onClose: () => void;
  onApply?: (resultUrl: string) => void;
}

export const ImageEditModal: React.FC<ImageEditModalProps> = ({
  open,
  imageUrl,
  onClose,
  onApply,
}) => {
  const { t } = useI18n();
  const [mode, setMode] = useState<EditMode>('crop');
  const [rotation, setRotation] = useState(0);
  const [flipH, setFlipH] = useState(false);
  const [flipV, setFlipV] = useState(false);
  const [filter, setFilter] = useState('none');
  const [brightness, setBrightness] = useState(100);
  const [contrast, setContrast] = useState(100);
  const [saturation, setSaturation] = useState(100);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const EDIT_MODES: { id: EditMode; labelKey: string; icon: React.ReactNode }[] = [
    { id: 'crop', labelKey: 'canvasImgEditCrop', icon: <Scissors size={14} /> },
    { id: 'rotate', labelKey: 'canvasImgEditRotate', icon: <RefreshCw size={14} /> },
    { id: 'filter', labelKey: 'canvasImgEditFilter', icon: <Palette size={14} /> },
    { id: 'adjust', labelKey: 'canvasImgEditAdjust', icon: <Settings size={14} /> },
    { id: 'mask', labelKey: 'canvasImgEditMask', icon: <Theater size={14} /> },
    { id: 'draw', labelKey: 'canvasImgEditDraw', icon: <Brush size={14} /> },
    { id: 'outpaint', labelKey: 'canvasImgEditOutpaint', icon: <MoveHorizontal size={14} /> },
    { id: 'grid', labelKey: 'canvasImgEditGrid', icon: <LayoutGrid size={14} /> },
  ];

  const FILTERS: { id: string; labelKey: string; css: string }[] = [
    { id: 'none', labelKey: 'canvasImgEditFilterNone', css: '' },
    { id: 'grayscale', labelKey: 'canvasImgEditFilterGrayscale', css: 'grayscale(100%)' },
    { id: 'sepia', labelKey: 'canvasImgEditFilterSepia', css: 'sepia(80%)' },
    { id: 'blur', labelKey: 'canvasImgEditFilterBlur', css: 'blur(2px)' },
    { id: 'brightness', labelKey: 'canvasImgEditFilterBrightness', css: 'brightness(1.3)' },
    { id: 'contrast', labelKey: 'canvasImgEditFilterContrast', css: 'contrast(1.5)' },
    { id: 'saturate', labelKey: 'canvasImgEditFilterSaturate', css: 'saturate(1.8)' },
    { id: 'invert', labelKey: 'canvasImgEditFilterInvert', css: 'invert(100%)' },
    { id: 'hue', labelKey: 'canvasImgEditFilterHue', css: 'hue-rotate(90deg)' },
  ];

  const currentFilter = FILTERS.find(f => f.id === filter);

  const imageStyle: React.CSSProperties = {
    transform: `rotate(${rotation}deg) scaleX(${flipH ? -1 : 1}) scaleY(${flipV ? -1 : 1})`,
    filter: currentFilter?.css || `brightness(${brightness}%) contrast(${contrast}%) saturate(${saturation}%)`,
    transition: 'all .2s ease',
  };

  const handleRotateLeft = useCallback(() => setRotation(prev => prev - 90), []);
  const handleRotateRight = useCallback(() => setRotation(prev => prev + 90), []);
  const handleFlipH = useCallback(() => setFlipH(prev => !prev), []);
  const handleFlipV = useCallback(() => setFlipV(prev => !prev), []);

  const handleReset = useCallback(() => {
    setRotation(0);
    setFlipH(false);
    setFlipV(false);
    setFilter('none');
    setBrightness(100);
    setContrast(100);
    setSaturation(100);
  }, []);

  const handleApply = useCallback(() => {
    if (imageUrl) {
      // Apply transforms via canvas
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        const canvas = canvasRef.current || document.createElement('canvas');
        const isRotated = Math.abs(rotation % 180) === 90;
        canvas.width = isRotated ? img.height : img.width;
        canvas.height = isRotated ? img.width : img.height;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.save();
        ctx.translate(canvas.width / 2, canvas.height / 2);
        ctx.rotate((rotation * Math.PI) / 180);
        ctx.scale(flipH ? -1 : 1, flipV ? -1 : 1);
        ctx.filter = currentFilter?.css || `brightness(${brightness}%) contrast(${contrast}%) saturate(${saturation}%)`;
        ctx.drawImage(img, -img.width / 2, -img.height / 2);
        ctx.restore();

        try {
          const resultUrl = canvas.toDataURL('image/png');
          onApply?.(resultUrl);
        } catch {
          onApply?.(imageUrl);
        }
      };
      img.src = imageUrl;
    }
    onClose();
  }, [imageUrl, rotation, flipH, flipV, currentFilter, brightness, contrast, saturation, onApply, onClose]);

  if (!open) return null;

  return (
    <div className="image-edit-modal open" onClick={onClose}>
      <div className="image-edit-panel" onClick={(e) => e.stopPropagation()}>
        <div className="image-edit-head">
          <div className="image-edit-title">{t('canvasImgEditTitle')}</div>
          <button type="button" className="preview-icon-btn" onClick={onClose} title={t('canvasApiSettingsClose')}><X size={14} /></button>
        </div>

        <div className="image-edit-stage">
          {imageUrl ? (
            <img src={imageUrl} alt="edit" style={imageStyle} />
          ) : (
            <div style={{ color: 'var(--muted)', fontSize: 13, fontWeight: 800 }}>{t('canvasImgEditNoImage')}</div>
          )}
        </div>

        <div className="image-edit-tools">
          {EDIT_MODES.map((m) => (
            <button
              key={m.id}
              type="button"
              className={`image-edit-tool-btn ${mode === m.id ? 'active' : ''}`}
              onClick={() => setMode(m.id)}
            >
              {m.icon} {t(m.labelKey)}
            </button>
          ))}
        </div>

        <div className="image-edit-subtools">
          {mode === 'rotate' && (
            <div className="subtool-row">
              <button className="subtool-btn" type="button" onClick={handleRotateLeft}><RotateCcw size={14} /> {t('canvasImgEditRotateLeft')}</button>
              <button className="subtool-btn" type="button" onClick={handleRotateRight}><RotateCw size={14} /> {t('canvasImgEditRotateRight')}</button>
              <button className="subtool-btn" type="button" onClick={handleFlipH}><FlipHorizontal size={14} /> {t('canvasImgEditFlipH')}</button>
              <button className="subtool-btn" type="button" onClick={handleFlipV}><FlipVertical size={14} /> {t('canvasImgEditFlipV')}</button>
            </div>
          )}
          {mode === 'filter' && (
            <div className="subtool-filter-grid">
              {FILTERS.map(f => (
                <button
                  key={f.id}
                  className={`subtool-filter-btn${filter === f.id ? ' active' : ''}`}
                  type="button"
                  onClick={() => setFilter(f.id)}
                >
                  {t(f.labelKey)}
                </button>
              ))}
            </div>
          )}
          {mode === 'adjust' && (
            <div className="subtool-adjust">
              <div className="adjust-row">
                <label>{t('canvasImgEditBrightness')}</label>
                <input type="range" min="0" max="200" value={brightness} onChange={(e) => setBrightness(Number(e.target.value))} />
                <span>{brightness}%</span>
              </div>
              <div className="adjust-row">
                <label>{t('canvasImgEditContrast')}</label>
                <input type="range" min="0" max="200" value={contrast} onChange={(e) => setContrast(Number(e.target.value))} />
                <span>{contrast}%</span>
              </div>
              <div className="adjust-row">
                <label>{t('canvasImgEditSaturation')}</label>
                <input type="range" min="0" max="200" value={saturation} onChange={(e) => setSaturation(Number(e.target.value))} />
                <span>{saturation}%</span>
              </div>
            </div>
          )}
        </div>

        <div className="image-edit-actions">
          <button type="button" className="error-btn" onClick={handleReset}>{t('canvasImgEditReset')}</button>
          <button type="button" className="error-btn" onClick={onClose}>{t('canvasImgEditCancel')}</button>
          <button type="button" className="error-btn primary" onClick={handleApply}>{t('canvasImgEditApply')}</button>
        </div>

        <canvas ref={canvasRef} style={{ display: 'none' }} />
      </div>
    </div>
  );
};

ImageEditModal.displayName = 'ImageEditModal';
