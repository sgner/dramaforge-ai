import React from 'react';
import { BELL_SOUND_BASE64, ERROR_SOUND_BASE64 } from '../constants';

export const downloadMedia = async (url: string, filename: string) => {
  try {
    const response = await fetch(url);
    const blob = await response.blob();
    const blobUrl = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = blobUrl;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.URL.revokeObjectURL(blobUrl);
  } catch (e) {
    console.error("Download failed", e);
    window.open(url, '_blank');
  }
};

export const playSuccessSound = () => {
  try {
    const audio = new Audio(BELL_SOUND_BASE64);
    audio.volume = 0.5;
    audio.play().catch(e => console.warn("Audio autoplay blocked", e));
  } catch (e) {
    console.warn("Audio playback failed", e);
  }
};

export const playErrorSound = () => {
  try {
    const audio = new Audio(ERROR_SOUND_BASE64);
    audio.volume = 0.5;
    audio.play().catch(e => console.warn("Audio autoplay blocked", e));
  } catch (e) {
    console.warn("Audio playback failed", e);
  }
};

export const renderLogPrefix = (service: string, text: string) => {
  let colorClass = "text-[#8a8278]";
  let bgClass = "bg-brand-900/50";
  
  if (service === "Gemini") {
    colorClass = "text-brand-300";
    bgClass = "bg-brand-600/15 border-brand-500/25";
  } else if (service === "NanoBanana") {
    colorClass = "text-accent-300";
    bgClass = "bg-accent-500/15 border-accent-500/25";
  } else if (service === "Sora" || service.includes("Sora")) {
    colorClass = "text-sky-300";
    bgClass = "bg-sky-600/15 border-sky-500/25";
  }

  return (
    <div className="flex items-center gap-3 mb-2">
      <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider border ${bgClass} ${colorClass}`}>
        {service}
      </span>
      <span className="font-bold text-brand-300 text-sm">{text}</span>
    </div>
  );
};

export const getProgressFromStatus = (status?: string): number => {
  if (!status) return 0;
  const match = status.match(/(\d+)%/);
  return match ? parseInt(match[1]) : 0;
};
