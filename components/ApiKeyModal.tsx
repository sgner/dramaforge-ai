import React, { useState, useEffect } from 'react';
import {
  ApiConfig, Provider, ModelConfig, StepModelBinding,
  ProviderType, ProviderCategory, StepType, ApiFormat,
  DEFAULT_PROVIDERS, DEFAULT_MODELS, DEFAULT_STEP_BINDINGS
} from '../types';
import { Key, Save, X, Plus, Trash2, Server, Cpu, Workflow, ChevronDown, ChevronRight, Settings, Globe, Building2, Repeat } from 'lucide-react';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onSave: (config: ApiConfig) => void;
  initialConfig: ApiConfig;
  t: (key: string) => string;
}

type TabType = 'providers' | 'models' | 'steps';

const PROVIDER_TYPE_LABELS: Record<ProviderType, { label: string; icon: React.ReactNode; color: string }> = {
  official: { label: 'Official', icon: <Globe className="w-3.5 h-3.5" />, color: 'text-green-400 bg-green-400/10 border-green-400/30' },
  custom: { label: 'Custom', icon: <Building2 className="w-3.5 h-3.5" />, color: 'text-blue-400 bg-blue-400/10 border-blue-400/30' },
  relay: { label: 'Relay', icon: <Repeat className="w-3.5 h-3.5" />, color: 'text-purple-400 bg-purple-400/10 border-purple-400/30' }
};

const CATEGORY_LABELS: Record<ProviderCategory, { label: string; color: string }> = {
  llm: { label: 'LLM', color: 'text-brand-400' },
  image: { label: 'Image', color: 'text-yellow-400' },
  video: { label: 'Video', color: 'text-blue-400' }
};

export const ApiKeyModal: React.FC<Props> = ({ isOpen, onClose, onSave, initialConfig, t }) => {
  const [config, setConfig] = useState<ApiConfig>(initialConfig);
  const [activeTab, setActiveTab] = useState<TabType>('providers');
  const [expandedProvider, setExpandedProvider] = useState<string | null>(null);
  const [expandedModel, setExpandedModel] = useState<string | null>(null);

  useEffect(() => {
    setConfig(initialConfig);
  }, [initialConfig]);

  if (!isOpen) return null;

  const generateId = () => `custom_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  const updateProvider = (id: string, updates: Partial<Provider>) => {
    setConfig(prev => ({
      ...prev,
      providers: prev.providers.map(p => p.id === id ? { ...p, ...updates } : p)
    }));
  };

  const addProvider = () => {
    const newProvider: Provider = {
      id: generateId(),
      name: 'New Provider',
      type: 'custom',
      category: 'llm',
      apiKey: '',
      baseUrl: '',
      enabled: true
    };
    setConfig(prev => ({ ...prev, providers: [...prev.providers, newProvider] }));
    setExpandedProvider(newProvider.id);
  };

  const removeProvider = (id: string) => {
    const modelsToRemove = config.models.filter(m => m.providerId === id).map(m => m.id);
    setConfig(prev => ({
      providers: prev.providers.filter(p => p.id !== id),
      models: prev.models.filter(m => m.providerId !== id),
      stepBindings: prev.stepBindings.filter(b => !modelsToRemove.includes(b.modelId))
    }));
  };

  const updateModel = (id: string, updates: Partial<ModelConfig>) => {
    setConfig(prev => ({
      ...prev,
      models: prev.models.map(m => m.id === id ? { ...m, ...updates } : m)
    }));
  };

  const addModel = (providerId: string) => {
    const provider = config.providers.find(p => p.id === providerId);
    let defaultApiPath = '';
    let defaultApiFormat: ApiFormat = 'openai';
    if (provider?.category === 'llm') {
      defaultApiPath = '/v1/chat/completions';
      defaultApiFormat = provider.type === 'official' && provider.id === 'google-gemini' ? 'gemini' : 'openai';
    } else if (provider?.category === 'image') {
      defaultApiPath = '/v1/images/generations';
      defaultApiFormat = 'openai-image';
    } else if (provider?.category === 'video') {
      defaultApiPath = '/v2/videos/generations';
      defaultApiFormat = 'openai-video';
    }
    const newModel: ModelConfig = {
      id: generateId(),
      providerId,
      modelName: '',
      displayName: 'New Model',
      apiPath: defaultApiPath,
      apiFormat: defaultApiFormat,
      customHeaders: '',
      customBodyTemplate: '',
      customResponsePath: '',
      pollApiPath: '',
      enabled: true
    };
    setConfig(prev => ({ ...prev, models: [...prev.models, newModel] }));
    setExpandedModel(newModel.id);
  };

  const removeModel = (id: string) => {
    setConfig(prev => ({
      models: prev.models.filter(m => m.id !== id),
      stepBindings: prev.stepBindings.filter(b => b.modelId !== id)
    }));
  };

  const updateStepBinding = (step: StepType, modelId: string) => {
    setConfig(prev => ({
      ...prev,
      stepBindings: prev.stepBindings.map(b => b.step === step ? { ...b, modelId } : b)
    }));
  };

  const getModelsForCategory = (category: ProviderCategory) => {
    return config.models.filter(m => {
      const provider = config.providers.find(p => p.id === m.providerId);
      return provider && provider.category === category && m.enabled;
    });
  };

  const getModelsForProvider = (providerId: string) => {
    return config.models.filter(m => m.providerId === providerId);
  };

  const tabs: { key: TabType; label: string; icon: React.ReactNode }[] = [
    { key: 'providers', label: t('providers') || 'Providers', icon: <Server className="w-4 h-4" /> },
    { key: 'models', label: t('models') || 'Models', icon: <Cpu className="w-4 h-4" /> },
    { key: 'steps', label: t('stepBindings') || 'Step Bindings', icon: <Workflow className="w-4 h-4" /> }
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
      <div className="bg-brand-900 border border-brand-700 rounded-xl shadow-2xl w-full max-w-3xl text-white overflow-hidden">
        <div className="p-6 border-b border-brand-800 flex justify-between items-center bg-brand-800/50">
          <div className="flex items-center gap-2">
            <Key className="w-5 h-5 text-brand-400" />
            <h2 className="text-xl font-bold">{t('apiConfig')}</h2>
          </div>
          <button onClick={onClose} className="p-1 hover:bg-white/10 rounded-full transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex border-b border-brand-800">
          {tabs.map(tab => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`flex-1 flex items-center justify-center gap-2 px-4 py-3 text-sm font-medium transition-colors ${
                activeTab === tab.key
                  ? 'text-brand-400 border-b-2 border-brand-400 bg-brand-400/5'
                  : 'text-gray-400 hover:text-gray-300 hover:bg-white/5'
              }`}
            >
              {tab.icon}
              {tab.label}
            </button>
          ))}
        </div>

        <div className="p-6 max-h-[65vh] overflow-y-auto">
          {activeTab === 'providers' && (
            <div className="space-y-3">
              {config.providers.map(provider => {
                const isExpanded = expandedProvider === provider.id;
                const typeInfo = PROVIDER_TYPE_LABELS[provider.type];
                const catInfo = CATEGORY_LABELS[provider.category];
                const providerModels = getModelsForProvider(provider.id);

                return (
                  <div key={provider.id} className="border border-brand-700/50 rounded-lg overflow-hidden">
                    <button
                      onClick={() => setExpandedProvider(isExpanded ? null : provider.id)}
                      className="w-full flex items-center justify-between p-4 hover:bg-white/5 transition-colors"
                    >
                      <div className="flex items-center gap-3">
                        {isExpanded ? <ChevronDown className="w-4 h-4 text-gray-400" /> : <ChevronRight className="w-4 h-4 text-gray-400" />}
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{provider.name}</span>
                          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs border ${typeInfo.color}`}>
                            {typeInfo.icon}
                            {typeInfo.label}
                          </span>
                          <span className={`text-xs font-medium ${catInfo.color}`}>
                            {catInfo.label}
                          </span>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className={`text-xs ${provider.apiKey ? 'text-green-400' : 'text-red-400'}`}>
                          {provider.apiKey ? '●' : '○'} {provider.apiKey ? t('configured') || 'Configured' : t('notConfigured') || 'Not Configured'}
                        </span>
                        <span className="text-xs text-gray-500">({providerModels.length} {t('models') || 'models'})</span>
                      </div>
                    </button>

                    {isExpanded && (
                      <div className="p-4 pt-0 space-y-4 border-t border-brand-700/30">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-4">
                          <div>
                            <label className="block text-xs text-gray-400 mb-1">{t('providerName') || 'Provider Name'}</label>
                            <input
                              type="text"
                              value={provider.name}
                              onChange={(e) => updateProvider(provider.id, { name: e.target.value })}
                              className="w-full bg-black/30 border border-brand-700 rounded px-3 py-2 text-sm focus:border-brand-500 outline-none transition-colors"
                            />
                          </div>
                          <div>
                            <label className="block text-xs text-gray-400 mb-1">{t('providerType') || 'Provider Type'}</label>
                            <select
                              value={provider.type}
                              onChange={(e) => updateProvider(provider.id, { type: e.target.value as ProviderType })}
                              className="w-full bg-black/30 border border-brand-700 rounded px-3 py-2 text-sm focus:border-brand-500 outline-none transition-colors"
                            >
                              <option value="official">Official</option>
                              <option value="custom">Custom</option>
                              <option value="relay">Relay / Proxy</option>
                            </select>
                          </div>
                          <div>
                            <label className="block text-xs text-gray-400 mb-1">{t('providerCategory') || 'Category'}</label>
                            <select
                              value={provider.category}
                              onChange={(e) => updateProvider(provider.id, { category: e.target.value as ProviderCategory })}
                              className="w-full bg-black/30 border border-brand-700 rounded px-3 py-2 text-sm focus:border-brand-500 outline-none transition-colors"
                            >
                              <option value="llm">LLM (Language Model)</option>
                              <option value="image">Image Generation</option>
                              <option value="video">Video Generation</option>
                            </select>
                          </div>
                          <div className="flex items-end">
                            <label className="flex items-center gap-2 cursor-pointer">
                              <input
                                type="checkbox"
                                checked={provider.enabled}
                                onChange={(e) => updateProvider(provider.id, { enabled: e.target.checked })}
                                className="w-4 h-4 rounded border-brand-600 bg-brand-800 text-brand-500 focus:ring-brand-500"
                              />
                              <span className="text-sm text-gray-300">{t('enabled') || 'Enabled'}</span>
                            </label>
                          </div>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          <div>
                            <label className="block text-xs text-gray-400 mb-1">{t('apiKey') || 'API Key'}</label>
                            <input
                              type="password"
                              value={provider.apiKey}
                              onChange={(e) => updateProvider(provider.id, { apiKey: e.target.value })}
                              placeholder="sk-..."
                              className="w-full bg-black/30 border border-brand-700 rounded px-3 py-2 text-sm focus:border-brand-500 outline-none transition-colors"
                            />
                          </div>
                          <div>
                            <label className="block text-xs text-gray-400 mb-1">{t('baseUrl') || 'Base URL'}</label>
                            <input
                              type="text"
                              value={provider.baseUrl}
                              onChange={(e) => updateProvider(provider.id, { baseUrl: e.target.value })}
                              placeholder="https://api.example.com"
                              className="w-full bg-black/30 border border-brand-700 rounded px-3 py-2 text-sm focus:border-brand-500 outline-none transition-colors"
                            />
                          </div>
                        </div>

                        <div className="space-y-2">
                          <div className="flex items-center justify-between">
                            <span className="text-xs text-gray-400 uppercase tracking-wider font-semibold">{t('models') || 'Models'}</span>
                            <button
                              onClick={() => addModel(provider.id)}
                              className="flex items-center gap-1 text-xs text-brand-400 hover:text-brand-300 transition-colors"
                            >
                              <Plus className="w-3 h-3" />
                              {t('addModel') || 'Add Model'}
                            </button>
                          </div>
                          {providerModels.length === 0 && (
                            <p className="text-xs text-gray-500 italic py-2">{t('noModels') || 'No models configured for this provider'}</p>
                          )}
                          {providerModels.map(model => {
                            const isModelExpanded = expandedModel === model.id;
                            return (
                              <div key={model.id} className="bg-black/20 border border-brand-700/30 rounded-md overflow-hidden">
                                <button
                                  onClick={() => setExpandedModel(isModelExpanded ? null : model.id)}
                                  className="w-full flex items-center justify-between p-3 hover:bg-white/5 transition-colors"
                                >
                                  <div className="flex items-center gap-2">
                                    {isModelExpanded ? <ChevronDown className="w-3 h-3 text-gray-400" /> : <ChevronRight className="w-3 h-3 text-gray-400" />}
                                    <span className="text-sm">{model.displayName}</span>
                                    <span className="text-xs text-gray-500">({model.modelName})</span>
                                  </div>
                                  <button
                                    onClick={(e) => { e.stopPropagation(); removeModel(model.id); }}
                                    className="p-1 text-red-400 hover:text-red-300 hover:bg-red-400/10 rounded transition-colors"
                                  >
                                    <Trash2 className="w-3 h-3" />
                                  </button>
                                </button>
                                {isModelExpanded && (
                                  <div className="p-3 pt-0 space-y-3">
                                    <div className="grid grid-cols-2 gap-3">
                                      <div>
                                        <label className="block text-xs text-gray-500 mb-1">{t('displayName') || 'Display Name'}</label>
                                        <input
                                          type="text"
                                          value={model.displayName}
                                          onChange={(e) => updateModel(model.id, { displayName: e.target.value })}
                                          className="w-full bg-black/30 border border-brand-700/50 rounded px-2 py-1.5 text-xs focus:border-brand-500 outline-none transition-colors"
                                        />
                                      </div>
                                      <div>
                                        <label className="block text-xs text-gray-500 mb-1">{t('modelName') || 'Model ID / Name'}</label>
                                        <input
                                          type="text"
                                          value={model.modelName}
                                          onChange={(e) => updateModel(model.id, { modelName: e.target.value })}
                                          placeholder="e.g. gpt-4o, gemini-2.0-flash"
                                          className="w-full bg-black/30 border border-brand-700/50 rounded px-2 py-1.5 text-xs focus:border-brand-500 outline-none transition-colors"
                                        />
                                      </div>
                                    </div>
                                    <div>
                                      <label className="block text-xs text-gray-500 mb-1">{t('apiPath') || 'API Path'}</label>
                                      <input
                                        type="text"
                                        value={model.apiPath}
                                        onChange={(e) => updateModel(model.id, { apiPath: e.target.value })}
                                        placeholder="e.g. /v1/chat/completions, /v1beta/models/{model}:generateContent"
                                        className="w-full bg-black/30 border border-brand-700/50 rounded px-2 py-1.5 text-xs focus:border-brand-500 outline-none transition-colors font-mono"
                                      />
                                      <p className="text-[10px] text-gray-600 mt-1">{t('apiPathHint') || 'Use {model} as placeholder for model name. Full URL = Base URL + API Path'}</p>
                                    </div>
                                    <div>
                                      <label className="block text-xs text-gray-500 mb-1">{t('apiFormat') || 'API Format'}</label>
                                      <select
                                        value={model.apiFormat || 'openai'}
                                        onChange={(e) => updateModel(model.id, { apiFormat: e.target.value as ApiFormat })}
                                        className="w-full bg-black/30 border border-brand-700/50 rounded px-2 py-1.5 text-xs focus:border-brand-500 outline-none transition-colors"
                                      >
                                        <option value="gemini">Gemini</option>
                                        <option value="openai">OpenAI (Chat Completions)</option>
                                        <option value="openai-image">OpenAI (Image)</option>
                                        <option value="openai-video">OpenAI (Video)</option>
                                        <option value="custom">{t('customFormat') || 'Custom'}</option>
                                      </select>
                                      <p className="text-[10px] text-gray-600 mt-1">{t('apiFormatHint') || 'Select the request/response protocol format for this model'}</p>
                                    </div>
                                    {model.apiFormat === 'custom' && (
                                      <div className="space-y-3 p-3 bg-black/30 border border-brand-700/30 rounded-lg">
                                        <p className="text-[10px] text-brand-400 font-medium">{t('customFormatDesc') || 'Configure custom request headers, body template and response extraction path. Use {{placeholder}} syntax for variables.'}</p>
                                        <div>
                                          <label className="block text-xs text-gray-500 mb-1">{t('customHeaders') || 'Custom Headers (JSON)'}</label>
                                          <textarea
                                            value={model.customHeaders || ''}
                                            onChange={(e) => updateModel(model.id, { customHeaders: e.target.value })}
                                            placeholder={'{\n  "Authorization": "Bearer {{apiKey}}",\n  "Content-Type": "application/json"\n}'}
                                            rows={4}
                                            className="w-full bg-black/30 border border-brand-700/50 rounded px-2 py-1.5 text-xs focus:border-brand-500 outline-none transition-colors font-mono resize-y"
                                          />
                                        </div>
                                        <div>
                                          <label className="block text-xs text-gray-500 mb-1">{t('customBodyTemplate') || 'Request Body Template (JSON)'}</label>
                                          <textarea
                                            value={model.customBodyTemplate || ''}
                                            onChange={(e) => updateModel(model.id, { customBodyTemplate: e.target.value })}
                                            placeholder={'{\n  "model": "{{model}}",\n  "messages": [\n    {"role": "system", "content": "{{systemInstruction}}"},\n    {"role": "user", "content": "{{prompt}}"}\n  ],\n  "temperature": {{temperature}}\n}'}
                                            rows={8}
                                            className="w-full bg-black/30 border border-brand-700/50 rounded px-2 py-1.5 text-xs focus:border-brand-500 outline-none transition-colors font-mono resize-y"
                                          />
                                          <p className="text-[10px] text-gray-600 mt-1">{t('customBodyHint') || 'Available: {{model}}, {{apiKey}}, {{baseUrl}}, {{prompt}}, {{systemInstruction}}, {{temperature}}, {{maxOutputTokens}}, {{responseMimeType}}'}</p>
                                        </div>
                                        <div>
                                          <label className="block text-xs text-gray-500 mb-1">{t('customResponsePath') || 'Response Text Path'}</label>
                                          <input
                                            type="text"
                                            value={model.customResponsePath || ''}
                                            onChange={(e) => updateModel(model.id, { customResponsePath: e.target.value })}
                                            placeholder="e.g. data.result.text, choices.0.message.content"
                                            className="w-full bg-black/30 border border-brand-700/50 rounded px-2 py-1.5 text-xs focus:border-brand-500 outline-none transition-colors font-mono"
                                          />
                                          <p className="text-[10px] text-gray-600 mt-1">{t('customResponsePathHint') || 'Dot-notation path to extract text from JSON response. e.g. choices.0.message.content'}</p>
                                        </div>
                                        {(() => {
                                          const prov = config.providers.find(p => p.id === model.providerId);
                                          return prov?.category === 'video';
                                        })() && (
                                          <div>
                                            <label className="block text-xs text-gray-500 mb-1">{t('pollApiPath') || 'Poll API Path'}</label>
                                            <input
                                              type="text"
                                              value={model.pollApiPath || ''}
                                              onChange={(e) => updateModel(model.id, { pollApiPath: e.target.value })}
                                              placeholder="e.g. /api/v3/contents/generations/tasks/{taskId}"
                                              className="w-full bg-black/30 border border-brand-700/50 rounded px-2 py-1.5 text-xs focus:border-brand-500 outline-none transition-colors font-mono"
                                            />
                                            <p className="text-[10px] text-gray-600 mt-1">{t('pollApiPathHint') || 'Path for polling video task status. Use {taskId} as placeholder. Defaults to apiPath + /taskId'}</p>
                                          </div>
                                        )}
                                      </div>
                                    )}
                                    <label className="flex items-center gap-2 cursor-pointer">
                                      <input
                                        type="checkbox"
                                        checked={model.enabled}
                                        onChange={(e) => updateModel(model.id, { enabled: e.target.checked })}
                                        className="w-3 h-3 rounded border-brand-600 bg-brand-800 text-brand-500 focus:ring-brand-500"
                                      />
                                      <span className="text-xs text-gray-300">{t('enabled') || 'Enabled'}</span>
                                    </label>
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>

                        <div className="flex justify-end pt-2">
                          <button
                            onClick={() => removeProvider(provider.id)}
                            className="flex items-center gap-1 text-xs text-red-400 hover:text-red-300 hover:bg-red-400/10 px-3 py-1.5 rounded transition-colors"
                          >
                            <Trash2 className="w-3 h-3" />
                            {t('removeProvider') || 'Remove Provider'}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}

              <button
                onClick={addProvider}
                className="w-full flex items-center justify-center gap-2 p-3 border-2 border-dashed border-brand-700/50 rounded-lg text-brand-400 hover:text-brand-300 hover:border-brand-600/50 transition-colors"
              >
                <Plus className="w-4 h-4" />
                {t('addProvider') || 'Add Provider'}
              </button>
            </div>
          )}

          {activeTab === 'models' && (
            <div className="space-y-3">
              {(['llm', 'image', 'video'] as ProviderCategory[]).map(category => {
                const catInfo = CATEGORY_LABELS[category];
                const categoryModels = config.models.filter(m => {
                  const provider = config.providers.find(p => p.id === m.providerId);
                  return provider && provider.category === category;
                });

                if (categoryModels.length === 0) return null;

                return (
                  <div key={category} className="space-y-2">
                    <h3 className={`text-sm font-semibold uppercase tracking-wider ${catInfo.color}`}>
                      {catInfo.label} {t('models') || 'Models'}
                    </h3>
                    {categoryModels.map(model => {
                      const provider = config.providers.find(p => p.id === model.providerId);
                      const isExpanded = expandedModel === model.id;
                      return (
                        <div key={model.id} className="bg-black/20 border border-brand-700/30 rounded-md overflow-hidden">
                          <button
                            onClick={() => setExpandedModel(isExpanded ? null : model.id)}
                            className="w-full flex items-center justify-between p-3 hover:bg-white/5 transition-colors"
                          >
                            <div className="flex items-center gap-2">
                              {isExpanded ? <ChevronDown className="w-3 h-3 text-gray-400" /> : <ChevronRight className="w-3 h-3 text-gray-400" />}
                              <span className="text-sm font-medium">{model.displayName}</span>
                              <span className="text-xs text-gray-500">({model.modelName})</span>
                              <span className="text-xs text-gray-600">- {provider?.name}</span>
                            </div>
                            <span className={`text-xs ${model.enabled ? 'text-green-400' : 'text-gray-500'}`}>
                              {model.enabled ? t('enabled') || 'Enabled' : t('disabled') || 'Disabled'}
                            </span>
                          </button>
                          {isExpanded && (
                            <div className="p-3 pt-0 space-y-3">
                              <div className="grid grid-cols-2 gap-3">
                                <div>
                                  <label className="block text-xs text-gray-500 mb-1">{t('displayName') || 'Display Name'}</label>
                                  <input
                                    type="text"
                                    value={model.displayName}
                                    onChange={(e) => updateModel(model.id, { displayName: e.target.value })}
                                    className="w-full bg-black/30 border border-brand-700/50 rounded px-2 py-1.5 text-xs focus:border-brand-500 outline-none transition-colors"
                                  />
                                </div>
                                <div>
                                  <label className="block text-xs text-gray-500 mb-1">{t('modelName') || 'Model ID / Name'}</label>
                                  <input
                                    type="text"
                                    value={model.modelName}
                                    onChange={(e) => updateModel(model.id, { modelName: e.target.value })}
                                    className="w-full bg-black/30 border border-brand-700/50 rounded px-2 py-1.5 text-xs focus:border-brand-500 outline-none transition-colors"
                                  />
                                </div>
                              </div>
                              <div>
                                <label className="block text-xs text-gray-500 mb-1">{t('belongsTo') || 'Belongs to Provider'}</label>
                                <select
                                  value={model.providerId}
                                  onChange={(e) => updateModel(model.id, { providerId: e.target.value })}
                                  className="w-full bg-black/30 border border-brand-700/50 rounded px-2 py-1.5 text-xs focus:border-brand-500 outline-none transition-colors"
                                >
                                  {config.providers.filter(p => p.category === category).map(p => (
                                    <option key={p.id} value={p.id}>{p.name}</option>
                                  ))}
                                </select>
                              </div>
                              <label className="flex items-center gap-2 cursor-pointer">
                                <input
                                  type="checkbox"
                                  checked={model.enabled}
                                  onChange={(e) => updateModel(model.id, { enabled: e.target.checked })}
                                  className="w-3 h-3 rounded border-brand-600 bg-brand-800 text-brand-500 focus:ring-brand-500"
                                />
                                <span className="text-xs text-gray-300">{t('enabled') || 'Enabled'}</span>
                              </label>
                              <div className="flex justify-end">
                                <button
                                  onClick={() => removeModel(model.id)}
                                  className="flex items-center gap-1 text-xs text-red-400 hover:text-red-300 hover:bg-red-400/10 px-2 py-1 rounded transition-colors"
                                >
                                  <Trash2 className="w-3 h-3" />
                                  {t('removeModel') || 'Remove Model'}
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          )}

          {activeTab === 'steps' && (
            <div className="space-y-4">
              <p className="text-xs text-gray-400">{t('stepBindingDesc') || 'Assign which model to use for each generation step.'}</p>
              {config.stepBindings.map(binding => {
                const stepLabel = t(`step_${binding.step}`) || binding.step;
                const currentModel = config.models.find(m => m.id === binding.modelId);
                const currentProvider = currentModel ? config.providers.find(p => p.id === currentModel.providerId) : undefined;

                let availableModels: ModelConfig[] = [];
                if (['preprocessing', 'scriptGeneration', 'promptOptimization'].includes(binding.step)) {
                  availableModels = getModelsForCategory('llm');
                } else if (['characterDesign', 'storyboarding'].includes(binding.step)) {
                  availableModels = getModelsForCategory('image');
                } else if (binding.step === 'videoGeneration') {
                  availableModels = getModelsForCategory('video');
                }

                return (
                  <div key={binding.step} className="flex items-center gap-4 p-3 bg-black/20 border border-brand-700/30 rounded-lg">
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium">{stepLabel}</div>
                      {currentModel && currentProvider && (
                        <div className="text-xs text-gray-500 mt-0.5">
                          {currentProvider.name} / {currentModel.displayName}
                        </div>
                      )}
                    </div>
                    <select
                      value={binding.modelId}
                      onChange={(e) => updateStepBinding(binding.step, e.target.value)}
                      className="bg-black/30 border border-brand-700 rounded px-3 py-2 text-sm focus:border-brand-500 outline-none transition-colors max-w-xs"
                    >
                      {availableModels.length === 0 && (
                        <option value="">{t('noModelsAvailable') || 'No models available'}</option>
                      )}
                      {availableModels.map(model => {
                        const provider = config.providers.find(p => p.id === model.providerId);
                        return (
                          <option key={model.id} value={model.id}>
                            {provider?.name} - {model.displayName} ({model.modelName})
                          </option>
                        );
                      })}
                    </select>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="p-6 border-t border-brand-800 bg-brand-900 flex justify-between">
          <button
            onClick={() => {
              setConfig({
                providers: DEFAULT_PROVIDERS.map(p => ({ ...p })),
                models: DEFAULT_MODELS.map(m => ({ ...m })),
                stepBindings: DEFAULT_STEP_BINDINGS.map(b => ({ ...b }))
              });
            }}
            className="flex items-center gap-2 text-gray-400 hover:text-gray-300 px-4 py-2 rounded-lg transition-colors"
          >
            <Settings className="w-4 h-4" />
            {t('resetToDefault') || 'Reset to Default'}
          </button>
          <button
            onClick={() => onSave(config)}
            className="flex items-center gap-2 bg-brand-600 hover:bg-brand-500 text-white px-6 py-2 rounded-lg font-medium transition-colors"
          >
            <Save className="w-4 h-4" />
            {t('saveConfig')}
          </button>
        </div>
      </div>
    </div>
  );
};
