import React from 'react';
import { Connection, CanvasNode, PortPoint as PP } from './types';
import { useCanvasStore } from './use-canvas-store';
import { portPoint, cubicBezierPath } from './engine';

interface LinksProps {
  nodes: CanvasNode[];
  connections: Connection[];
  tempLink: { x1: number; y1: number; x2: number; y2: number } | null;
  knifeTrail: PP[];
  hoveredLink: string | null;
  onLinkHover: (id: string | null) => void;
  onLinkDelete: (id: string) => void;
}

export const CanvasLinks: React.FC<LinksProps> = React.memo(
  ({
    nodes,
    connections,
    tempLink,
    knifeTrail,
    hoveredLink,
    onLinkHover,
    onLinkDelete,
  }) => {
    const nodeMap = new Map(nodes.map((n) => [n.id, n]));
    const theme = useCanvasStore((s) => s.theme);
    const accentColor = theme === 'dark' ? '#94a3b8' : '#64748b';

    return (
      <svg className="canvas-links" width="6000" height="4000" viewBox="0 0 6000 4000" xmlns="http://www.w3.org/2000/svg">
        {connections.map((c) => {
          const fromNode = nodeMap.get(c.from) as CanvasNode | undefined;
          const toNode = nodeMap.get(c.to) as CanvasNode | undefined;
          if (!fromNode || !toNode) return null;
          const a = portPoint(fromNode, 'out');
          const b = portPoint(toNode, 'in');
          const d = cubicBezierPath(a.x, a.y, b.x, b.y);
          const mx = (a.x + b.x) / 2;
          const my = (a.y + b.y) / 2;

          return (
            <g key={c.id}>
              <path d={d} className="link" />
              {/* 宽命中区域：hover时高亮连线 + 显示切断按钮 */}
              <path
                d={d}
                className="link-hit"
                onMouseEnter={() => onLinkHover(c.id)}
                onMouseLeave={() => onLinkHover(null)}
              />
              {/* 剪刀切断按钮 - 参考项目 conn-cut，始终存在，CSS控制显示 */}
              <g
                className={`conn-cut${hoveredLink === c.id ? ' conn-cut-active' : ''}`}
                transform={`translate(${mx} ${my})`}
                onMouseEnter={() => onLinkHover(c.id)}
                onMouseLeave={() => onLinkHover(null)}
                onClick={(e) => { e.stopPropagation(); onLinkDelete(c.id); }}
              >
                <circle r="10" fill="transparent" />
                <circle r="8" fill="var(--card)" stroke={accentColor} strokeWidth="1.4" />
                <path
                  d="M-3 -3 L3 3 M3 -3 L-3 3"
                  stroke={accentColor}
                  strokeWidth="1.5"
                  strokeLinecap="round"
                />
              </g>
            </g>
          );
        })}
        {tempLink && (
          <path
            d={cubicBezierPath(
              tempLink.x1,
              tempLink.y1,
              tempLink.x2,
              tempLink.y2
            )}
            className="link temp"
          />
        )}
        {knifeTrail.length > 1 && (
          <path
            d={`M ${knifeTrail.map((p) => `${p.x} ${p.y}`).join(' L ')}`}
            className="link knife-trail"
          />
        )}
      </svg>
    );
  }
);

CanvasLinks.displayName = 'CanvasLinks';
