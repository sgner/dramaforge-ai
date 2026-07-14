/**
 * TDD: types.ts 应包含 'agent_node' 与横向时间线布局常量。
 */
import { describe, it, expect } from 'vitest';
import {
  AGENT_NODE_W,
  AGENT_NODE_H,
  AGENT_NODE_H_TALL,
  AGENT_ROW_GAP,
  AGENT_COL_GAP,
  AGENT_GRID_COLS,
  AGENT_TYPE_META,
  DEFAULT_NODE_SIZES,
  MAX_AGENT_NODES,
  MAX_AGENT_NODES_PER_TYPE,
} from '@/components/infinite-canvas/types';

describe('agent_node types & layout (horizontal timeline)', () => {
  it('AGENT_NODE_W is 220 and AGENT_NODE_H is 120 (compact, fits 5 in a row)', () => {
    expect(AGENT_NODE_W).toBe(220);
    expect(AGENT_NODE_H).toBe(120);
    // plan/question/artifact 用较高节点
    expect(AGENT_NODE_H_TALL).toBeGreaterThan(AGENT_NODE_H);
  });

  it('AGENT_ROW_GAP and AGENT_COL_GAP give node spacing for readability (>= 32 px)', () => {
    // 节点间距离必须 > 节点自身内容边界，留出空间给端口和连接线
    expect(AGENT_ROW_GAP).toBeGreaterThanOrEqual(32);
    expect(AGENT_COL_GAP).toBeGreaterThanOrEqual(32);
  });

  it('AGENT_GRID_COLS is 5 for horizontal timeline (5 events per row)', () => {
    expect(AGENT_GRID_COLS).toBe(5);
  });

  it('MAX_AGENT_NODES caps total visible to 12 to prevent lag', () => {
    expect(MAX_AGENT_NODES).toBe(12);
    expect(MAX_AGENT_NODES_PER_TYPE).toBe(5);
    expect(MAX_AGENT_NODES).toBeGreaterThanOrEqual(MAX_AGENT_NODES_PER_TYPE);
  });

  it('AGENT_TYPE_META has 7 entries with label/color/icon (no other colors)', () => {
    expect(Object.keys(AGENT_TYPE_META)).toHaveLength(7);
    for (const k of Object.keys(AGENT_TYPE_META)) {
      const m = (AGENT_TYPE_META as any)[k];
      expect(m).toHaveProperty('label');
      expect(m).toHaveProperty('color');
      expect(m).toHaveProperty('icon');
      // 严格黑白灰：所有 color 字段用 var(--text) 走 CSS 变量
      expect(m.color).toMatch(/var\(--text/);
    }
  });

  it('DEFAULT_NODE_SIZES has agent_node entry with new compact width', () => {
    expect(DEFAULT_NODE_SIZES.agent_node).toBeDefined();
    expect(DEFAULT_NODE_SIZES.agent_node.w).toBe(220);
    expect(DEFAULT_NODE_SIZES.agent_node.h).toBe(120);
  });
});
