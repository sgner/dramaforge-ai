import React, { useState, useEffect } from 'react';
import { X, Save, RotateCw, Loader2, Edit2, Eye, Sparkles, Plus, Trash2, User, Shield, AlertTriangle, Check } from 'lucide-react';
import { BigShot, Character } from '../types';
import { filterPrompt, FilterResult } from '../services/sensitiveWordFilter';
import { SensitiveFilterReport } from './SensitiveFilterReport';
import { validateVideoPrompt, validateStoryboardPrompt, PromptValidationResult } from '../utils/promptValidator';
import { validateColorManagement, ColorValidationResult } from '../utils/colorValidator';

export const BigShotDetailModal = ({
  shot,
  allCharacters,
  onClose,
  onRegenerateStoryboard,
  onReoptimizePrompt,
  onReoptimizeSoraPrompt,
  onSave,
  isManualMode,
  initialIsEditing,
  t
}: {
  shot: BigShot;
  allCharacters: Character[];
  onClose: () => void;
  onRegenerateStoryboard: () => void;
  onReoptimizePrompt: () => void;
  onReoptimizeSoraPrompt: () => void;
  onSave: (updates: Partial<BigShot>) => void;
  isManualMode: boolean;
  initialIsEditing?: boolean;
  t: any;
}) => {
  const [editData, setEditData] = useState({ ...shot });
  const [isClosing, setIsClosing] = useState(false);
  const [isEditing, setIsEditing] = useState(initialIsEditing || false);
  const [filterResult, setFilterResult] = useState<FilterResult | null>(null);
  const [filterTarget, setFilterTarget] = useState<'storyboard' | 'video' | null>(null);
  const [videoValidation, setVideoValidation] = useState<PromptValidationResult | null>(null);
  const [colorValidation, setColorValidation] = useState<ColorValidationResult | null>(null);

  useEffect(() => {
    setEditData({ ...shot });
  }, [shot]);

  const handleClose = () => {
    setIsClosing(true);
    setTimeout(onClose, 250);
  };

  const handleSave = () => {
    onSave(editData);
    setIsEditing(false);
  };

  const addCharacterToShot = (name: string) => {
    if (!editData.charactersInvolved.includes(name)) {
      setEditData({ ...editData, charactersInvolved: [...editData.charactersInvolved, name] });
    }
  };

  const removeCharacterFromShot = (name: string) => {
    setEditData({ ...editData, charactersInvolved: editData.charactersInvolved.filter(n => n !== name) });
  };

  const isFailed = shot.generationStatus?.toLowerCase().includes('failed');
  const isStoryboardFailed = !shot.storyboardImageUrl && isFailed;
  const isGenerating = shot.generationStatus && !shot.videoUrl && !shot.generationStatus.toLowerCase().includes('failed') && shot.generationStatus !== 'Idle' && shot.generationStatus !== 'Completed';

  const getCharacterByName = (name: string) => allCharacters.find(c => c.name === name);
  const availableCharacters = allCharacters.filter(c => !editData.charactersInvolved.includes(c.name));

  const handleFilterProceed = (filteredText: string) => {
    setEditData({ ...editData, storyboardPrompt: filteredText });
    setFilterResult(null);
    setFilterTarget(null);
  };

  const inputFocus = (e: React.FocusEvent<HTMLTextAreaElement>) => {
    e.target.style.borderColor = 'rgba(110,107,242,0.5)';
    e.target.style.boxShadow = '0 0 0 3px rgba(110,107,242,0.20)';
  };
  const inputBlur = (e: React.FocusEvent<HTMLTextAreaElement>) => {
    e.target.style.borderColor = 'transparent';
    e.target.style.boxShadow = 'none';
  };

  return (
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center transition-opacity duration-200 ${isClosing ? 'opacity-0' : 'opacity-100'}`}
      style={{ background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(12px)' }}
    >
      <div
        className={`w-full h-full flex flex-col overflow-hidden transition-all duration-300 ${isClosing ? 'scale-95 opacity-0' : 'scale-100 opacity-100 animate-scale-in'}`}
        style={{ background: '#0A0A0B', border: '1px solid rgba(255,255,255,0.07)' }}
      >

        {/* Header */}
        <div
          className="flex items-center justify-between px-6 py-4"
          style={{ borderBottom: '1px solid rgba(255,255,255,0.07)' }}
        >
          <div className="flex items-center gap-3">
            <div className="w-2 h-2 rounded-full bg-[#6E6BF2]"></div>
            <div>
              <h2 className="text-[15px] font-semibold text-[#F5F5F7] tracking-tight">{t('shotDetail') || 'Shot Detail'}</h2>
              <div className="flex items-center gap-2 mt-0.5">
                <div className={`h-1 w-1 rounded-full ${isEditing ? 'bg-[#817FF5]' : 'bg-white/30'}`}></div>
                <span className="text-[10px] font-mono uppercase tracking-wider text-white/40">
                  {isEditing ? (t('editMode') || 'Edit Mode') : (t('previewMode') || 'Preview')}
                </span>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {isManualMode && (
              <button
                onClick={() => setIsEditing(!isEditing)}
                className="px-3 py-1.5 rounded-full text-xs font-medium flex items-center gap-2 transition-all"
                style={isEditing
                  ? { background: 'rgba(110,107,242,0.14)', border: '1px solid rgba(110,107,242,0.35)', color: '#A5A3F8' }
                  : { background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.07)', color: 'rgba(255,255,255,0.55)' }
                }
              >
                {isEditing ? <><Eye className="w-3.5 h-3.5" /> {t('preview') || 'Preview'}</> : <><Edit2 className="w-3.5 h-3.5" /> {t('edit')}</>}
              </button>
            )}
            <button
              onClick={handleClose}
              className="p-2 rounded-full text-white/45 hover:text-[#F5F5F7] transition-all hover:rotate-90 duration-300"
              style={{ background: 'rgba(255,255,255,0.06)' }}
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto custom-scrollbar">
          <div className="flex flex-col lg:flex-row min-h-0">

            {/* Left - Visual Canvas */}
            <div
              className="lg:w-[45%] p-6 flex flex-col justify-center"
              style={{ borderRight: '1px solid rgba(255,255,255,0.05)' }}
            >
              <div className="space-y-5">
                {/* Storyboard */}
                <div>
                  <div className="flex items-center gap-2 mb-3">
                    <span className="text-[10px] font-mono uppercase tracking-wider text-white/35 font-medium">
                      {t('storyboard') || 'Storyboard'}
                    </span>
                  </div>
                  <div
                    className="aspect-video rounded-xl overflow-hidden relative group"
                    style={{ background: '#131316', border: '1px solid rgba(255,255,255,0.07)' }}
                  >
                    {shot.storyboardImageUrl ? (
                      <>
                        <img src={shot.storyboardImageUrl} className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-[1.02]" alt="Storyboard" />
                        <div className="absolute inset-0 pointer-events-none" style={{ background: 'linear-gradient(180deg, transparent 60%, rgba(0,0,0,0.5) 100%)' }}></div>
                      </>
                    ) : (
                      <div className="w-full h-full flex flex-col items-center justify-center">
                        {isGenerating ? (
                          <div className="flex flex-col items-center">
                            <Loader2 className="w-8 h-8 animate-spin text-[#817FF5]/60 mb-3" />
                            <span className="text-[10px] font-mono uppercase tracking-wider text-white/35">{shot.generationStatus}</span>
                          </div>
                        ) : (
                          <span className="text-white/30 text-xs">{t('noStoryboard') || 'No storyboard generated'}</span>
                        )}
                      </div>
                    )}
                    {isStoryboardFailed && (
                      <div className="absolute inset-0 flex items-center justify-center" style={{ background: 'rgba(242,97,97,0.12)', backdropFilter: 'blur(4px)' }}>
                        <button
                          onClick={onRegenerateStoryboard}
                          className="px-4 py-2 rounded-full text-sm font-medium flex items-center gap-2 transition-all text-white"
                          style={{ background: '#F26161', border: '1px solid rgba(242,97,97,0.4)' }}
                        >
                          <RotateCw className="w-4 h-4" /> {t('retryStoryboard') || 'Retry'}
                        </button>
                      </div>
                    )}
                  </div>
                </div>

                {/* Video */}
                {shot.videoUrl && (
                  <div>
                    <div className="flex items-center gap-2 mb-3">
                      <span className="text-[10px] font-mono uppercase tracking-wider text-white/35 font-medium">
                        {t('videoPreview') || 'Video'}
                      </span>
                    </div>
                    <div
                      className="aspect-video rounded-xl overflow-hidden"
                      style={{ background: '#131316', border: '1px solid rgba(255,255,255,0.07)' }}
                    >
                      <video src={shot.videoUrl} controls className="w-full h-full" />
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Right - Editorial Content */}
            <div className="lg:w-[55%] p-6 space-y-6 overflow-y-auto custom-scrollbar">

              {/* Characters */}
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <span className="text-[10px] font-mono uppercase tracking-wider text-white/35 font-medium">
                    {t('charsInvolved') || 'Characters'}
                  </span>
                </div>
                <div className="flex flex-wrap gap-2">
                  {editData.charactersInvolved.map((name, i) => {
                    const char = getCharacterByName(name);
                    return (
                      <div
                        key={i}
                        className="group/char flex items-center gap-2.5 pl-1.5 pr-3 py-1.5 rounded-lg transition-all"
                        style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.07)' }}
                      >
                        <div
                          className="w-8 h-8 rounded-md overflow-hidden flex-shrink-0"
                          style={{ background: '#1A1A1F' }}
                        >
                          {char?.threeViewImg ? (
                            <img src={char.threeViewImg} alt={char.name} className="w-full h-full object-cover" />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center text-white/30">
                              <User className="w-3.5 h-3.5" />
                            </div>
                          )}
                        </div>
                        <div className="min-w-0">
                          <div className="text-xs font-medium text-[#F5F5F7]">{name}</div>
                          {char?.visualFeatures && (
                            <div className="text-[10px] text-white/40 line-clamp-1 max-w-[120px]">{char.visualFeatures}</div>
                          )}
                        </div>
                        {isEditing && (
                          <button
                            onClick={() => removeCharacterFromShot(name)}
                            className="p-0.5 rounded-full text-white/30 hover:text-[#F26161] opacity-0 group-hover/char:opacity-100 transition-all"
                            title={t('removeCharacter') || 'Remove'}
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        )}
                      </div>
                    );
                  })}
                  {editData.charactersInvolved.length === 0 && (
                    <div className="text-white/30 text-xs">{t('noCharacters') || 'No characters assigned'}</div>
                  )}
                  {isEditing && availableCharacters.length > 0 && (
                    <div className="relative">
                      <select
                        onChange={(e) => { if (e.target.value) addCharacterToShot(e.target.value); e.target.value = ''; }}
                        className="appearance-none cursor-pointer pl-3 pr-8 py-2 rounded-lg text-xs text-[#A5A3F8] focus:outline-none transition-all"
                        style={{ background: 'rgba(110,107,242,0.10)', border: '1px dashed rgba(110,107,242,0.35)' }}
                        defaultValue=""
                      >
                        <option value="" disabled>+ {t('addCharacter') || 'Add'}</option>
                        {availableCharacters.map(c => (
                          <option key={c.name} value={c.name}>{c.name}</option>
                        ))}
                      </select>
                      <Plus className="absolute right-2 top-1/2 -translate-y-1/2 w-3 h-3 text-[#817FF5]/60 pointer-events-none" />
                    </div>
                  )}
                </div>
              </div>

              {/* Shot Description */}
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <span className="text-[10px] font-mono uppercase tracking-wider text-white/35 font-medium">
                    {t('shotDescription') || 'Description'}
                  </span>
                </div>
                {isEditing ? (
                  <textarea
                    value={editData.shotDescription}
                    onChange={(e) => setEditData({ ...editData, shotDescription: e.target.value })}
                    className="w-full h-28 rounded-lg p-3 text-sm text-[#F5F5F7] resize-none focus:outline-none transition-all placeholder:text-white/30"
                    style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid transparent' }}
                    onFocus={inputFocus}
                    onBlur={inputBlur}
                    placeholder={t('shotDescriptionPlaceholder') || 'Describe the shot...'}
                  />
                ) : (
                  <div
                    className="rounded-lg p-3 text-sm text-white/55 leading-relaxed"
                    style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.05)' }}
                  >
                    {editData.shotDescription || <span className="text-white/30">{t('noDescription') || 'No description'}</span>}
                  </div>
                )}
              </div>

              {/* Dialogues */}
              {editData.includedDialogues.length > 0 && (
                <div>
                  <div className="flex items-center gap-2 mb-3">
                    <span className="text-[10px] font-mono uppercase tracking-wider text-white/35 font-medium">
                      {t('dialogues') || 'Dialogues'}
                    </span>
                  </div>
                  <div className="space-y-2">
                    {editData.includedDialogues.map((line, i) => (
                      <div key={i} className="flex items-start gap-3">
                        <span className="text-[10px] font-mono text-white/30 mt-1 shrink-0">{String(i + 1).padStart(2, '0')}</span>
                        <p className="text-sm text-white/55 leading-relaxed">"{line}"</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Storyboard Prompt */}
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <span className="text-[10px] font-mono uppercase tracking-wider text-white/35 font-medium">
                    {t('storyboardPrompt') || 'Storyboard Prompt'}
                  </span>
                </div>
                {isEditing ? (
                  <div className="space-y-2">
                    <textarea
                      value={editData.storyboardPrompt || ''}
                      onChange={(e) => setEditData({ ...editData, storyboardPrompt: e.target.value })}
                      className="w-full h-28 rounded-lg p-3 text-xs text-[#F5F5F7] font-mono resize-none focus:outline-none transition-all placeholder:text-white/30"
                      style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid transparent' }}
                      onFocus={inputFocus}
                      onBlur={inputBlur}
                      placeholder={t('storyboardPromptPlaceholder') || 'Edit the storyboard prompt...'}
                    />
                    <button
                      onClick={onReoptimizePrompt}
                      className="w-full py-2 rounded-full text-xs font-medium flex items-center justify-center gap-2 transition-all text-[#A5A3F8]"
                      style={{ background: 'rgba(110,107,242,0.10)', border: '1px solid rgba(110,107,242,0.25)' }}
                    >
                      <Sparkles className="w-3.5 h-3.5" /> {t('reoptimizePrompt') || 'AI Optimize'}
                    </button>
                  </div>
                ) : (
                  <div
                    className="rounded-lg p-3 text-xs text-white/55 font-mono leading-relaxed max-h-36 overflow-y-auto custom-scrollbar"
                    style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.05)' }}
                  >
                    {editData.storyboardPrompt || <span className="text-white/30">{t('noPrompt') || 'No prompt'}</span>}
                  </div>
                )}
              </div>

              {/* Video Prompt */}
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <span className="text-[10px] font-mono uppercase tracking-wider text-white/35 font-medium">
                    {t('soraPrompt') || 'Video Prompt'}
                  </span>
                </div>
                {isEditing ? (
                  <div className="space-y-2">
                    <textarea
                      value={editData.soraPrompt || ''}
                      onChange={(e) => setEditData({ ...editData, soraPrompt: e.target.value })}
                      className="w-full h-28 rounded-lg p-3 text-xs text-[#F5F5F7] font-mono resize-none focus:outline-none transition-all placeholder:text-white/30"
                      style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid transparent' }}
                      onFocus={inputFocus}
                      onBlur={inputBlur}
                      placeholder={t('soraPromptPlaceholder') || 'Edit the video prompt...'}
                    />
                    <button
                      onClick={onReoptimizeSoraPrompt}
                      className="w-full py-2 rounded-full text-xs font-medium flex items-center justify-center gap-2 transition-all text-[#A5A3F8]"
                      style={{ background: 'rgba(110,107,242,0.10)', border: '1px solid rgba(110,107,242,0.25)' }}
                    >
                      <Sparkles className="w-3.5 h-3.5" /> {t('reoptimizeVideoPrompt') || 'AI Optimize'}
                    </button>
                    {editData.soraPrompt && (
                      <button
                        onClick={() => {
                          const result = validateVideoPrompt(editData.soraPrompt || '');
                          setVideoValidation(result);
                        }}
                        className="w-full py-2 rounded-full text-xs font-medium flex items-center justify-center gap-2 transition-all text-[#F5B544]"
                        style={{ background: 'rgba(245,181,68,0.10)', border: '1px solid rgba(245,181,68,0.25)' }}
                      >
                        <Shield className="w-3.5 h-3.5" /> {t('validatePrompt') || 'Validate Prompt'}
                      </button>
                    )}
                    {editData.soraPrompt && (
                      <button
                        onClick={() => {
                          const genre = (window as any).__dramaForgeGenre || '仙侠';
                          const result = validateColorManagement([{ id: shot.id, soraPrompt: editData.soraPrompt }], genre);
                          setColorValidation(result);
                        }}
                        className="w-full py-2 rounded-full text-xs font-medium flex items-center justify-center gap-2 transition-all text-purple-300"
                        style={{ background: 'rgba(168,85,247,0.10)', border: '1px solid rgba(168,85,247,0.25)' }}
                      >
                        <Eye className="w-3.5 h-3.5" /> {t('validateColor') || 'Validate Color'}
                      </button>
                    )}
                    {videoValidation && (
                      <div
                        className="rounded-lg p-3 space-y-1.5"
                        style={{ background: 'rgba(255,255,255,0.03)', border: `1px solid ${videoValidation.valid ? 'rgba(62,207,142,0.25)' : 'rgba(242,97,97,0.25)'}` }}
                      >
                        <div className="flex items-center gap-2 text-[10px] font-medium uppercase tracking-wider">
                          {videoValidation.valid ? (
                            <span className="text-[#3ECF8E] flex items-center gap-1"><Check className="w-3 h-3" /> {videoValidation.warningCount} warnings</span>
                          ) : (
                            <span className="text-[#F26161] flex items-center gap-1"><X className="w-3 h-3" /> {videoValidation.errorCount} errors, {videoValidation.warningCount} warnings</span>
                          )}
                        </div>
                        {videoValidation.issues.slice(0, 5).map((issue, idx) => (
                          <div key={idx} className="flex items-start gap-2 text-[10px]">
                            <AlertTriangle className={`w-3 h-3 mt-0.5 shrink-0 ${issue.severity === 'error' ? 'text-[#F26161]' : 'text-[#F5B544]'}`} />
                            <span className={issue.severity === 'error' ? 'text-[#F26161]/80' : 'text-[#F5B544]/80'}>{issue.message}</span>
                          </div>
                        ))}
                        {videoValidation.issues.length > 5 && (
                          <div className="text-[10px] text-white/30">+{videoValidation.issues.length - 5} more issues</div>
                        )}
                      </div>
                    )}
                    {colorValidation && (
                      <div
                        className="rounded-lg p-3 space-y-1.5"
                        style={{ background: 'rgba(255,255,255,0.03)', border: `1px solid ${colorValidation.valid ? 'rgba(62,207,142,0.25)' : 'rgba(242,97,97,0.25)'}` }}
                      >
                        <div className="flex items-center gap-2 text-[10px] font-medium uppercase tracking-wider">
                          {colorValidation.valid ? (
                            <span className="text-[#3ECF8E] flex items-center gap-1"><Check className="w-3 h-3" /> Color OK ({colorValidation.warningCount} warnings)</span>
                          ) : (
                            <span className="text-[#F26161] flex items-center gap-1"><X className="w-3 h-3" /> Color {colorValidation.errorCount} errors, {colorValidation.warningCount} warnings</span>
                          )}
                        </div>
                        {colorValidation.issues.slice(0, 5).map((issue, idx) => (
                          <div key={idx} className="flex items-start gap-2 text-[10px]">
                            <AlertTriangle className={`w-3 h-3 mt-0.5 shrink-0 ${issue.severity === 'error' ? 'text-[#F26161]' : 'text-[#F5B544]'}`} />
                            <span className={issue.severity === 'error' ? 'text-[#F26161]/80' : 'text-[#F5B544]/80'}>{issue.message}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ) : (
                  <div
                    className="rounded-lg p-3 text-xs text-white/55 font-mono leading-relaxed max-h-36 overflow-y-auto custom-scrollbar"
                    style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.05)' }}
                  >
                    {editData.soraPrompt || <span className="text-white/30">{t('noPrompt') || 'No prompt'}</span>}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        {isEditing && (
          <div
            className="flex justify-end gap-3 px-6 py-4"
            style={{ borderTop: '1px solid rgba(255,255,255,0.07)' }}
          >
            <button
              onClick={() => { setEditData({ ...shot }); setIsEditing(false); }}
              className="px-4 py-2 rounded-full text-sm font-medium transition-all text-white/60 hover:text-[#F5F5F7]"
              style={{ background: '#1A1A1F', border: '1px solid rgba(255,255,255,0.07)' }}
            >
              {t('cancel')}
            </button>
            <button
              onClick={handleSave}
              className="px-5 py-2 rounded-full text-sm font-semibold flex items-center gap-2 transition-all hover:bg-[#817FF5] text-white"
              style={{ background: '#6E6BF2', boxShadow: '0 4px 14px rgba(110,107,242,0.30)' }}
            >
              <Save className="w-4 h-4" /> {t('save') || 'Save Changes'}
            </button>
          </div>
        )}
      </div>
      {filterResult && (
        <SensitiveFilterReport
          result={filterResult}
          onClose={() => { setFilterResult(null); setFilterTarget(null); }}
          onProceed={handleFilterProceed}
          t={t}
        />
      )}
    </div>
  );
};
