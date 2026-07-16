import { describe, expect, it } from 'vitest';
import { CHARACTER_DESIGN_SHEET_PROMPT } from '../constants';

describe('character design prompt contract', () => {
  it('keeps the canonical role-sheet layout and consistency constraints', () => {
    expect(CHARACTER_DESIGN_SHEET_PROMPT).toContain('left-right split layout');
    expect(CHARACTER_DESIGN_SHEET_PROMPT).toContain('F0EDE8');
    expect(CHARACTER_DESIGN_SHEET_PROMPT).toContain('identical character design');
    expect(CHARACTER_DESIGN_SHEET_PROMPT).toContain('no visible numbers');
  });
});
