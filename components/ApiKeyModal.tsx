import React, { useState, useEffect } from 'react';
import { ApiConfig } from '../types';
import { Key, Save, X } from 'lucide-react';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onSave: (config: ApiConfig) => void;
  initialConfig: ApiConfig;
  t: (key: string) => string;
}

export const ApiKeyModal: React.FC<Props> = ({ isOpen, onClose, onSave, initialConfig, t }) => {
  const [config, setConfig] = useState<ApiConfig>(initialConfig);

  useEffect(() => {
    setConfig(initialConfig);
  }, [initialConfig]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
      <div className="bg-brand-900 border border-brand-700 rounded-xl shadow-2xl w-full max-w-2xl text-white overflow-hidden">
        <div className="p-6 border-b border-brand-800 flex justify-between items-center bg-brand-800/50">
          <div className="flex items-center gap-2">
            <Key className="w-5 h-5 text-brand-400" />
            <h2 className="text-xl font-bold">{t('apiConfig')}</h2>
          </div>
          <button onClick={onClose} className="p-1 hover:bg-white/10 rounded-full transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-6 max-h-[70vh] overflow-y-auto">
          {/* Gemini */}
          <div className="space-y-3">
            <h3 className="text-brand-400 font-semibold text-sm uppercase tracking-wider">{t('geminiApi')}</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs text-gray-400 mb-1">{t('apiKey')}</label>
                <input
                  type="password"
                  value={config.geminiKey}
                  onChange={(e) => setConfig({ ...config, geminiKey: e.target.value })}
                  placeholder="AIzaSy..."
                  className="w-full bg-black/30 border border-brand-700 rounded px-3 py-2 text-sm focus:border-brand-500 outline-none transition-colors"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1">{t('baseUrl')}</label>
                <input
                  type="text"
                  value={config.geminiBaseUrl || ''}
                  onChange={(e) => setConfig({ ...config, geminiBaseUrl: e.target.value })}
                  placeholder="https://generativelanguage.googleapis.com"
                  className="w-full bg-black/30 border border-brand-700 rounded px-3 py-2 text-sm focus:border-brand-500 outline-none transition-colors"
                />
              </div>
            </div>
          </div>

          {/* Nanobanana */}
          <div className="space-y-3">
            <h3 className="text-yellow-500 font-semibold text-sm uppercase tracking-wider">{t('nanoApi')}</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs text-gray-400 mb-1">{t('apiKey')}</label>
                <input
                  type="password"
                  value={config.nanobananaKey}
                  onChange={(e) => setConfig({ ...config, nanobananaKey: e.target.value })}
                  className="w-full bg-black/30 border border-brand-700 rounded px-3 py-2 text-sm focus:border-brand-500 outline-none transition-colors"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1">{t('baseUrl')}</label>
                <input
                  type="text"
                  value={config.nanobananaBaseUrl || ''}
                  onChange={(e) => setConfig({ ...config, nanobananaBaseUrl: e.target.value })}
                  className="w-full bg-black/30 border border-brand-700 rounded px-3 py-2 text-sm focus:border-brand-500 outline-none transition-colors"
                />
              </div>
            </div>
          </div>

          {/* Sora 2 */}
          <div className="space-y-3">
            <h3 className="text-blue-500 font-semibold text-sm uppercase tracking-wider">{t('soraApi')}</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs text-gray-400 mb-1">{t('apiKey')}</label>
                <input
                  type="password"
                  value={config.soraKey}
                  onChange={(e) => setConfig({ ...config, soraKey: e.target.value })}
                  className="w-full bg-black/30 border border-brand-700 rounded px-3 py-2 text-sm focus:border-brand-500 outline-none transition-colors"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1">{t('baseUrl')}</label>
                <input
                  type="text"
                  value={config.soraBaseUrl || ''}
                  onChange={(e) => setConfig({ ...config, soraBaseUrl: e.target.value })}
                  className="w-full bg-black/30 border border-brand-700 rounded px-3 py-2 text-sm focus:border-brand-500 outline-none transition-colors"
                />
              </div>
            </div>
          </div>
        </div>

        <div className="p-6 border-t border-brand-800 bg-brand-900 flex justify-end">
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