
import React, { useState, useRef } from 'react';
import { ArtStyle, Language, TaskMode } from '../types';
import { Upload, FileText, CheckCircle2, AlertCircle, Globe, Zap, Hand, Sparkles, Book } from 'lucide-react';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onCreate: (name: string, style: ArtStyle, language: Language, content: string, mode: TaskMode, sourceType: 'novel' | 'idea') => void;
  hasApiKey: boolean;
  onOpenSettings: () => void;
  t: (key: string) => string;
}

export const NewTaskModal: React.FC<Props> = ({ isOpen, onClose, onCreate, hasApiKey, onOpenSettings, t }) => {
  const [name, setName] = useState('');
  const [style, setStyle] = useState<ArtStyle>(ArtStyle.REALISTIC);
  const [language, setLanguage] = useState<Language>('zh');
  const [mode, setMode] = useState<TaskMode>('manual');
  const [sourceType, setSourceType] = useState<'novel' | 'idea'>('novel');
  const [content, setContent] = useState('');
  const [inputMode, setInputMode] = useState<'text' | 'file'>('text');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [fileNames, setFileNames] = useState<string[]>([]);

  if (!isOpen) return null;

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      const names: string[] = [];
      const contents: string[] = [];
      
      // Process all selected files
      for (let i = 0; i < files.length; i++) {
        names.push(files[i].name);
        const text = await files[i].text();
        // Add a delimiter to separate files in the raw content if multiple
        if (files.length > 1) {
            contents.push(`\n\n====FILE_START: ${files[i].name}====\n${text}\n====FILE_END====\n`);
        } else {
            contents.push(text);
        }
      }
      
      setFileNames(names);
      setContent(contents.join('\n'));
    }
  };

  const handleSubmit = () => {
    if (!name || !content) return;
    onCreate(name, style, language, content, mode, sourceType);
  };

  if (!hasApiKey) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
        <div className="bg-brand-900 border border-brand-700 rounded-xl p-8 max-w-md text-center">
          <AlertCircle className="w-12 h-12 text-yellow-500 mx-auto mb-4" />
          <h2 className="text-xl font-bold text-white mb-2">{t('configRequired')}</h2>
          <p className="text-gray-400 mb-6">{t('configRequiredDesc')}</p>
          <div className="flex justify-center gap-3">
            <button onClick={onClose} className="px-4 py-2 text-gray-400 hover:text-white">{t('cancel')}</button>
            <button onClick={() => { onClose(); onOpenSettings(); }} className="px-4 py-2 bg-brand-600 hover:bg-brand-500 text-white rounded-lg">{t('configureNow')}</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-in fade-in duration-200">
      <div className="bg-brand-900 border border-brand-700 rounded-xl shadow-2xl w-full max-w-3xl text-white flex flex-col max-h-[90vh]">
        <div className="p-6 border-b border-brand-800 bg-brand-800/20">
          <h2 className="text-2xl font-bold">{t('createTaskTitle')}</h2>
          <p className="text-gray-400 text-sm mt-1">{t('createTaskDesc')}</p>
        </div>

        <div className="p-6 overflow-y-auto space-y-6 flex-1">
          {/* Step 1: Basics */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">{t('projectName')}</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t('projectPlaceholder')}
                className="w-full bg-black/30 border border-brand-700 rounded-lg px-4 py-3 focus:border-brand-500 outline-none"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">{t('visualStyle')}</label>
              <select
                value={style}
                onChange={(e) => setStyle(e.target.value as ArtStyle)}
                className="w-full bg-black/30 border border-brand-700 rounded-lg px-4 py-3 focus:border-brand-500 outline-none text-gray-200"
              >
                {Object.values(ArtStyle).map((s) => (
                  <option key={s} value={s}>{t(s)}</option>
                ))}
              </select>
            </div>
          </div>
          
          {/* Language Selection */}
          <div>
             <label className="block text-sm font-medium text-gray-300 mb-2 flex items-center gap-2">
               <Globe className="w-4 h-4 text-brand-400" /> Target Language
             </label>
             <div className="grid grid-cols-4 gap-4">
               {[
                 { id: 'zh', label: '中文 (Chinese)' },
                 { id: 'en', label: 'English' },
                 { id: 'ja', label: '日本語 (Japanese)' },
                 { id: 'ko', label: '한국어 (Korean)' }
               ].map((langOption) => (
                 <button
                   key={langOption.id}
                   onClick={() => setLanguage(langOption.id as Language)}
                   className={`px-4 py-2 rounded-lg text-sm border transition-all ${
                     language === langOption.id 
                       ? 'bg-brand-600 border-brand-500 text-white shadow-[0_0_10px_rgba(139,92,246,0.3)]' 
                       : 'bg-black/20 border-gray-700 text-gray-400 hover:border-brand-600'
                   }`}
                 >
                   {langOption.label}
                 </button>
               ))}
             </div>
          </div>

           {/* Mode Selection */}
           <div>
             <label className="block text-sm font-medium text-gray-300 mb-2 flex items-center gap-2">
               {t('mode')}
             </label>
             <div className="grid grid-cols-2 gap-4">
               <div 
                 className={`p-4 rounded-lg border transition-all flex items-start gap-3 opacity-50 cursor-not-allowed bg-gray-900/30 border-gray-800`}
                 title="Auto mode is temporarily disabled"
               >
                 <Zap className="w-5 h-5 mt-0.5 text-gray-600" />
                 <div>
                   <div className="font-bold text-sm text-gray-500">{t('autoMode')}</div>
                   <div className="text-xs text-gray-600 mt-1 leading-relaxed">{t('autoModeDesc')}</div>
                   <div className="text-[10px] text-yellow-500 mt-2 font-medium">⚠️ Temporarily disabled</div>
                 </div>
               </div>

               <div 
                 onClick={() => setMode('manual')}
                 className={`cursor-pointer p-4 rounded-lg border transition-all flex items-start gap-3 ${
                   mode === 'manual'
                     ? 'bg-brand-600/20 border-brand-500 shadow-[0_0_10px_rgba(139,92,246,0.2)]'
                     : 'bg-black/20 border-gray-700 hover:bg-black/40'
                 }`}
               >
                 <Hand className={`w-5 h-5 mt-0.5 ${mode === 'manual' ? 'text-brand-400' : 'text-gray-500'}`} />
                 <div>
                   <div className={`font-bold text-sm ${mode === 'manual' ? 'text-brand-300' : 'text-gray-300'}`}>{t('manualMode')}</div>
                   <div className="text-xs text-gray-500 mt-1 leading-relaxed">{t('manualModeDesc')}</div>
                 </div>
               </div>
             </div>
          </div>

          {/* Source Type Tabs */}
          <div className="border-t border-brand-700 pt-6 mt-2">
              <label className="block text-sm font-medium text-gray-300 mb-4">{t('sourceType')}</label>
              <div className="flex gap-4 mb-4">
                  <button
                    onClick={() => setSourceType('novel')}
                    className={`flex-1 py-3 rounded-lg border flex items-center justify-center gap-2 transition-all ${
                        sourceType === 'novel' 
                        ? 'bg-brand-600/20 border-brand-500 text-white shadow-lg shadow-brand-900' 
                        : 'bg-black/20 border-gray-700 text-gray-500 hover:bg-black/40'
                    }`}
                  >
                      <Book className="w-5 h-5" />
                      {t('fromNovel')}
                  </button>
                  <button
                    onClick={() => setSourceType('idea')}
                    className={`flex-1 py-3 rounded-lg border flex items-center justify-center gap-2 transition-all ${
                        sourceType === 'idea' 
                        ? 'bg-pink-600/20 border-pink-500 text-white shadow-lg shadow-pink-900' 
                        : 'bg-black/20 border-gray-700 text-gray-500 hover:bg-black/40'
                    }`}
                  >
                      <Sparkles className="w-5 h-5" />
                      {t('fromIdea')}
                  </button>
              </div>

              {sourceType === 'novel' ? (
                  <div>
                    <div className="flex gap-4 mb-4">
                      <button
                        onClick={() => setInputMode('text')}
                        className={`flex-1 py-2 rounded text-xs border flex items-center justify-center gap-2 ${inputMode === 'text' ? 'bg-brand-600/20 border-brand-500 text-brand-300' : 'bg-black/20 border-gray-800 text-gray-500 hover:bg-black/40'}`}
                      >
                        <FileText className="w-3 h-3" /> {t('directText')}
                      </button>
                      <button
                        onClick={() => setInputMode('file')}
                        className={`flex-1 py-2 rounded text-xs border flex items-center justify-center gap-2 ${inputMode === 'file' ? 'bg-brand-600/20 border-brand-500 text-brand-300' : 'bg-black/20 border-gray-800 text-gray-500 hover:bg-black/40'}`}
                      >
                        <Upload className="w-3 h-3" /> {t('uploadFile')}
                      </button>
                    </div>

                    {inputMode === 'text' ? (
                      <textarea
                        value={content}
                        onChange={(e) => setContent(e.target.value)}
                        placeholder={t('pastePlaceholder')}
                        className="w-full h-40 bg-black/30 border border-brand-700 rounded-lg px-4 py-3 focus:border-brand-500 outline-none resize-none font-mono text-sm"
                      />
                    ) : (
                      <div 
                        onClick={() => fileInputRef.current?.click()}
                        className="w-full h-40 border-2 border-dashed border-brand-700 hover:border-brand-500 rounded-lg flex flex-col items-center justify-center cursor-pointer bg-black/20 transition-colors"
                      >
                        <input 
                          type="file" 
                          ref={fileInputRef} 
                          onChange={handleFileChange} 
                          className="hidden" 
                          accept=".txt,.md"
                          multiple
                        />
                        <Upload className="w-8 h-8 text-brand-600 mb-2" />
                        <p className="text-gray-300 font-medium text-sm px-4 text-center line-clamp-2">
                           {fileNames.length > 0 ? `${fileNames.length} files selected: ${fileNames.join(', ')}` : t('uploadPlaceholder')}
                        </p>
                      </div>
                    )}
                  </div>
              ) : (
                  <div>
                      <textarea
                        value={content}
                        onChange={(e) => setContent(e.target.value)}
                        placeholder={t('ideaPlaceholder')}
                        className="w-full h-40 bg-pink-900/10 border border-pink-700/50 rounded-lg px-4 py-3 focus:border-pink-500 outline-none resize-none font-sans text-sm"
                      />
                      <p className="text-xs text-pink-400/60 mt-2">{t('ideaTip')}</p>
                  </div>
              )}
          </div>
        </div>

        <div className="p-6 border-t border-brand-800 flex justify-end gap-3 bg-brand-900">
          <button onClick={onClose} className="px-6 py-2 text-gray-400 hover:text-white transition-colors">{t('cancel')}</button>
          <button
            disabled={!name || !content}
            onClick={handleSubmit}
            className={`px-6 py-2 rounded-lg font-medium flex items-center gap-2 ${!name || !content ? 'bg-gray-700 text-gray-500 cursor-not-allowed' : 'bg-brand-600 hover:bg-brand-500 text-white'}`}
          >
            <CheckCircle2 className="w-4 h-4" />
            {t('createTask')}
          </button>
        </div>
      </div>
    </div>
  );
};
