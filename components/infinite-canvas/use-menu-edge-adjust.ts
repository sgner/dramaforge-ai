import { RefObject, useLayoutEffect, useState } from 'react';

/**
 * 右键菜单边界保护：
 * - 右侧/下侧越界时自动收回或翻转到点击位置上方
 * - 上下都放不下时选择贴边显示，保证菜单完全可见
 * 直接复用菜单已有的 ref（同时用于点击外部关闭）。
 */
export function useMenuEdgeAdjust(
  open: boolean,
  x: number,
  y: number,
  menuRef: RefObject<HTMLDivElement | null>
) {
  const [pos, setPos] = useState({ left: x, top: y });

  useLayoutEffect(() => {
    if (!open) return;
    const el = menuRef.current;
    if (!el) return;
    const margin = 8;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    let left = x;
    let top = y;
    if (left + w + margin > window.innerWidth) {
      left = Math.max(margin, window.innerWidth - w - margin);
    }
    if (left < margin) left = margin;
    if (top + h + margin > window.innerHeight) {
      // 下方放不下 → 翻到点击位置上方；上方也放不下则贴底边
      top = y - h >= margin ? y - h : Math.max(margin, window.innerHeight - h - margin);
    }
    if (top < margin) top = margin;
    setPos((prev) =>
      Math.abs(prev.left - left) < 1 && Math.abs(prev.top - top) < 1 ? prev : { left, top }
    );
  }, [open, x, y, menuRef]);

  return pos;
}
