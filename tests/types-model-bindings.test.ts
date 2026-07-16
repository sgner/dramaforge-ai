import { describe, expect, it } from 'vitest';
import {
  createDefaultApiConfig,
  getBindingForStep,
  normalizeModelBindings,
  type Provider,
} from '@/types';

const provider: Provider = {
  id: 'p1',
  name: 'Provider',
  baseUrl: 'https://example.test/v1',
  protocol: 'openai',
  enabled: true,
  apiKey: '',
  imageModels: ['image-1'],
  chatModels: ['chat-1'],
  videoModels: ['video-1'],
};

describe('capability model bindings', () => {
  it('creates exactly one empty binding for each capability', () => {
    expect(createDefaultApiConfig().modelBindings).toEqual([
      { kind: 'llm', providerId: '', modelId: '' },
      { kind: 'image', providerId: '', modelId: '' },
      { kind: 'video', providerId: '', modelId: '' },
    ]);
  });

  it('does not revive legacy workflow step bindings as capability bindings', () => {
    expect(normalizeModelBindings({
      providers: [provider],
      stepBindings: [
        { step: 'scriptGeneration', providerId: 'p1', modelId: 'chat-1' },
        { step: 'characterDesign', providerId: 'p1', modelId: 'image-1' },
        { step: 'videoGeneration', providerId: 'p1', modelId: 'video-1' },
      ],
    }).modelBindings).toEqual([
      { kind: 'llm', providerId: '', modelId: '' },
      { kind: 'image', providerId: '', modelId: '' },
      { kind: 'video', providerId: '', modelId: '' },
    ]);
  });

  it('maps every workflow step to its capability binding', () => {
    const config = normalizeModelBindings({
      providers: [provider],
      modelBindings: [
        { kind: 'llm', providerId: 'p1', modelId: 'chat-1' },
        { kind: 'image', providerId: 'p1', modelId: 'image-1' },
        { kind: 'video', providerId: 'p1', modelId: 'video-1' },
      ],
    });

    expect(getBindingForStep(config, 'preprocessing')).toEqual({ kind: 'llm', providerId: 'p1', modelId: 'chat-1' });
    expect(getBindingForStep(config, 'storyboarding')).toEqual({ kind: 'image', providerId: 'p1', modelId: 'image-1' });
    expect(getBindingForStep(config, 'videoGeneration')).toEqual({ kind: 'video', providerId: 'p1', modelId: 'video-1' });
  });
});
