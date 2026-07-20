/**
 * TiltCard.tsx — 轻微 3D 倾斜 + 悬浮抬升的卡片容器（Framer Motion）
 * 倾斜上限 ±4°，弹簧回位；尊重 prefers-reduced-motion。
 */
import { useRef, type PropsWithChildren, type MouseEvent } from 'react';
import { motion, useMotionValue, useSpring, useTransform } from 'framer-motion';

interface TiltCardProps extends PropsWithChildren {
  className?: string;
  onClick?: () => void;
}

export function TiltCard({ children, className, onClick }: TiltCardProps) {
  const ref = useRef<HTMLDivElement>(null);
  const px = useMotionValue(0.5);
  const py = useMotionValue(0.5);
  const sx = useSpring(px, { stiffness: 260, damping: 24, mass: 0.6 });
  const sy = useSpring(py, { stiffness: 260, damping: 24, mass: 0.6 });
  const rotateX = useTransform(sy, [0, 1], [3.5, -3.5]);
  const rotateY = useTransform(sx, [0, 1], [-3.5, 3.5]);

  const handleMove = (e: MouseEvent<HTMLDivElement>) => {
    const rect = ref.current?.getBoundingClientRect();
    if (!rect) return;
    px.set((e.clientX - rect.left) / rect.width);
    py.set((e.clientY - rect.top) / rect.height);
  };
  const reset = () => { px.set(0.5); py.set(0.5); };

  return (
    <motion.div
      ref={ref}
      className={className}
      onClick={onClick}
      onMouseMove={handleMove}
      onMouseLeave={reset}
      style={{ rotateX, rotateY, transformPerspective: 900, transformStyle: 'preserve-3d' }}
      whileHover={{ y: -4 }}
      transition={{ type: 'spring', stiffness: 300, damping: 26 }}
    >
      {children}
    </motion.div>
  );
}
