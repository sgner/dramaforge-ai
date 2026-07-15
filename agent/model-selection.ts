export interface ModelProviderOption {
  defaultModel?: string;
  chatModels?: string[];
}

export function resolveModelId(
  selectedModelId: string | undefined,
  provider: ModelProviderOption | undefined,
): string | undefined {
  const selected = selectedModelId?.trim();
  if (selected) return selected;
  const defaultModel = provider?.defaultModel?.trim();
  if (defaultModel) return defaultModel;
  const firstModel = provider?.chatModels?.find((model) => model.trim());
  return firstModel?.trim() || undefined;
}
