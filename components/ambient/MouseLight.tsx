/**
 * MouseLight.tsx — 跟随光标的柔光（screen 混合，lerp 平滑，绝不刺眼）
 */
import { useEffect, useRef } from 'react';

export function MouseLight() {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    let x = window.innerWidth / 2, y = window.innerHeight / 3;
    let tx = x, ty = y, raf = 0;
    const onMove = (e: PointerEvent) => { tx = e.clientX; ty = e.clientY; };
    const loop = () => {
      x += (tx - x) * 0.10;
      y += (ty - y) * 0.10;
      if (ref.current) ref.current.style.transform = `translate3d(${x - 320}px, ${y - 320}px, 0)`;
      raf = requestAnimationFrame(loop);
    };
    window.addEventListener('pointermove', onMove, { passive: true });
    raf = requestAnimationFrame(loop);
    return () => { window.removeEventListener('pointermove', onMove); cancelAnimationFrame(raf); };
  }, []);

  return (
    <div
      ref={ref}
      aria-hidden
      className="pointer-events-none fixed left-0 top-0 z-[5] h-[640px] w-[640px] rounded-full"
      style={{
        background: 'radial-gradient(circle, rgba(129,127,245,0.075) 0%, rgba(129,127,245,0.03) 38%, transparent 68%)',
        mixBlendMode: 'screen',
      }}
    />
  );
}
