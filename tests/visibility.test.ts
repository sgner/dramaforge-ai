import { describe, expect, it } from 'vitest';
import { getPaddedWorldRect } from '../components/infinite-canvas/visibility';

describe('getPaddedWorldRect', () => {
  it('expands the world-space viewport when zoomed out', () => {
    expect(getPaddedWorldRect({ width: 1000, height: 800 }, { x: 0, y: 0, scale: 0.25 })).toEqual({
      x: -2000,
      y: -1600,
      width: 8000,
      height: 6400,
    });
  });
});
