import { describe, expect, it } from 'vitest';
import { resolveModelId } from '../agent/model-selection';

describe('resolveModelId', () => {
  it('uses the first configured chat model when the dropdown value is empty', () => {
    expect(resolveModelId('', { chatModels: ['deepseek-v4-flash'] })).toBe('deepseek-v4-flash');
  });

  it('preserves an explicitly selected model', () => {
    expect(resolveModelId('gpt-4o-mini', { chatModels: ['deepseek-v4-flash'] })).toBe('gpt-4o-mini');
  });
});
