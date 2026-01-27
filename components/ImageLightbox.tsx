import React from 'react';
import { X, ZoomIn } from 'lucide-react';

interface Props {
  src: string | null;
  onClose: () => void;
  alt?: string;
}

export const ImageLightbox: React.FC<Props> = ({ src, onClose, alt }) => {
  if (!src) return null;

  return (
    <div 
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/95 backdrop-blur-sm animate-in fade-in duration-200"
      onClick={onClose}
    >
      <button 
        onClick={onClose}
        className="absolute top-6 right-6 p-2 bg-white/10 hover:bg-white/20 rounded-full text-white transition-colors"
      >
        <X className="w-8 h-8" />
      </button>

      <img 
        src={src} 
        alt={alt || "Zoomed image"} 
        className="max-w-[90vw] max-h-[90vh] object-contain rounded-lg shadow-2xl scale-100 animate-in zoom-in-95 duration-300"
        onClick={(e) => e.stopPropagation()} // Prevent closing when clicking the image
      />
    </div>
  );
};