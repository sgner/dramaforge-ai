import { describe, expect, it } from 'vitest';
import { formatVisualSignatureColors } from '@/components/infinite-canvas/CanvasNode';

describe('script visual signature colorIds', () => {
  it('renders legacy string colors without undefined fields', () => {
    expect(formatVisualSignatureColors(['冷蓝霓虹', '暗红']))
      .toBe('冷蓝霓虹 / 暗红');
  });

  it('renders structured colors and tolerates incomplete entries', () => {
    expect(formatVisualSignatureColors([
      { entity: '现实', hue: '#8B7355' },
      { entity: '危险' },
      null,
      '冷青',
    ])).toBe('现实: #8B7355 / 危险 / 冷青');
  });
});
