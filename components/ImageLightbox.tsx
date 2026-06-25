import React from 'react';
import { X } from 'lucide-react';

interface Props {
  src: string | null;
  onClose: () => void;
  alt?: string;
}

export const ImageLightbox: React.FC<Props> = ({ src, onClose, alt }) => {
  if (!src) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center animate-in fade-in duration-200"
      style={{ background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(8px)' }}
      onClick={onClose}
    >
      <button
        onClick={onClose}
        className="absolute top-6 right-6 p-2.5 rounded-full text-white transition-all hover:rotate-90 duration-300"
        style={{ background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.2)' }}
      >
        <X className="w-6 h-6" />
      </button>

      <img
        src={src}
        alt={alt || "Zoomed image"}
        className="max-w-[90vw] max-h-[90vh] object-contain rounded-xl shadow-2xl animate-scale-in"
        onClick={(e) => e.stopPropagation()}
      />
    </div>
  );
};
