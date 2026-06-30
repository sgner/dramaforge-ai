/**
 * TDD: types.ts 应包含 'agent_node' 与 7 列布局常量。
 */
import { describe, it, expect } from 'vitest';
import {
  AGENT_COL_X,
  AGENT_NODE_W,
  AGENT_NODE_H,
  AGENT_ROW_GAP,
  AGENT_TYPE_META,
  DEFAULT_NODE_SIZES,
} from '@/components/infinite-canvas/types';

describe('agent_node types & layout', () => {
  it('AGENT_COL_X covers 7 task types with strict 320 px stride', () => {
    expect(AGENT_COL_X.goal).toBe(0);
    expect(AGENT_COL_X.plan).toBe(320);
    expect(AGENT_COL_X.action).toBe(640);
    expect(AGENT_COL_X.observation).toBe(960);
    expect(AGENT_COL_X.artifact).toBe(1280);
    expect(AGENT_COL_X.question).toBe(1600);
    expect(AGENT_COL_X.done).toBe(1920);
  });

  it('AGENT_NODE_W is 280 and AGENT_NODE_H is 200', () => {
    expect(AGENT_NODE_W).toBe(280);
    expect(AGENT_NODE_H).toBe(200);
  });

  it('AGENT_ROW_GAP is 40', () => {
    expect(AGENT_ROW_GAP).toBe(40);
  });

  it('AGENT_TYPE_META has 7 entries with label/color/icon', () => {
    expect(Object.keys(AGENT_TYPE_META)).toHaveLength(7);
    for (const k of Object.keys(AGENT_TYPE_META)) {
      const m = (AGENT_TYPE_META as any)[k];
      expect(m).toHaveProperty('label');
      expect(m).toHaveProperty('color');
      expect(m).toHaveProperty('icon');
    }
  });

  it('DEFAULT_NODE_SIZES has agent_node entry', () => {
    expect(DEFAULT_NODE_SIZES.agent_node).toBeDefined();
    expect(DEFAULT_NODE_SIZES.agent_node.w).toBe(280);
  });
});
