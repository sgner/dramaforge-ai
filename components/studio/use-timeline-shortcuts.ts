/**
 * useTimelineShortcuts — 剪辑台全局快捷键（仅剪辑台阶段激活时挂 window keydown）。
 *
 * 目标为 input / textarea / select 或 contentEditable 时忽略，避免抢输入按键。
 *   Space            播放 / 暂停（统一在此处理，ProgramMonitor 不再单独监听，避免双触发）
 *   ← / →            seek ±1s
 *   Shift + ← / →    上一 / 下一镜头
 *   Home / End       跳到开头 / 结尾
 *   Delete / Backspace 移除选中镜头
 *   Ctrl/⌘ + ↑ / ↓   选中镜头上移 / 下移
 *   + / = / -        时间线缩放
 *   Ctrl/⌘ + E       导出成片（canExport 时）
 */
import { useEffect } from 'react';
import { SequencePlayback } from './use-sequence-playback';

export interface TimelineShortcutHandlers {
  playback: SequencePlayback;
  /** 选中 clip 下标（-1 = 未选中）。 */
  selectedIndex: number;
  onRemove: (index: number) => void;
  onMove: (index: number, dir: -1 | 1) => void;
  onZoom: (dir: -1 | 1) => void;
  onExport: () => void;
  /** 时间线非空且未在导出中。 */
  canExport: boolean;
}

/** 焦点在表单控件 / 可编辑区域时不响应快捷键。 */
const isEditableTarget = (el: EventTarget | null): boolean => {
  if (!(el instanceof HTMLElement)) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
};

export function useTimelineShortcuts(active: boolean, h: TimelineShortcutHandlers) {
  // 每 render 重挂：handler 闭包始终拿到最新 state，代价是一次 add/remove
  useEffect(() => {
    if (!active) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (isEditableTarget(e.target)) return;
      const mod = e.ctrlKey || e.metaKey;
      const { playback } = h;

      // Ctrl/⌘ 组合键
      if (mod) {
        if (e.key === 'e' || e.key === 'E') {
          if (h.canExport) {
            e.preventDefault();
            h.onExport();
          }
          return;
        }
        if (e.key === 'ArrowUp' && h.selectedIndex >= 0) {
          e.preventDefault();
          h.onMove(h.selectedIndex, -1);
          return;
        }
        if (e.key === 'ArrowDown' && h.selectedIndex >= 0) {
          e.preventDefault();
          h.onMove(h.selectedIndex, 1);
          return;
        }
        return;
      }

      switch (e.key) {
        case ' ':
          e.preventDefault();
          playback.toggle();
          break;
        case 'ArrowLeft':
          if (e.shiftKey) playback.stepClip(-1);
          else playback.seek(playback.playTime - 1);
          break;
        case 'ArrowRight':
          if (e.shiftKey) playback.stepClip(1);
          else playback.seek(playback.playTime + 1);
          break;
        case 'Home':
          playback.seek(0);
          break;
        case 'End':
          playback.seek(playback.total);
          break;
        case 'Delete':
        case 'Backspace':
          if (h.selectedIndex >= 0) {
            e.preventDefault();
            h.onRemove(h.selectedIndex);
          }
          break;
        case '+':
        case '=':
          h.onZoom(1);
          break;
        case '-':
          h.onZoom(-1);
          break;
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  });
}
