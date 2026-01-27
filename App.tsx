

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Settings, Plus, LayoutGrid, BookOpen, Film, Image as ImageIcon, Video, ArrowLeft, RotateCw, Loader2, Globe, AlertTriangle, CheckCircle, Circle, XCircle, Code, ChevronDown, ChevronUp, Maximize2, List, GitFork, MoveUp, MoveDown, Play, FileImage, User, AlignLeft, XOctagon, PlayCircle, SkipForward, Edit2, Trash2, Save, Square, CheckSquare, Download, Sparkles, Wand2, UploadCloud, Book, Lightbulb, Terminal, Layers, Eye, LayoutDashboard, FileText, PenTool, RefreshCw, ArrowRight, UserPlus, ImagePlus, FilePlus } from 'lucide-react';
import axios from 'axios';
import { NewTaskModal } from './components/NewTaskModal';
import { EditCharacterModal } from './components/EditCharacterModal';
import { TaskCard } from './components/TaskCard';
import { ImageLightbox } from './components/ImageLightbox';
import { ConfirmModal } from './components/ConfirmModal';
import { ApiKeyModal } from './components/ApiKeyModal';
import { DramaTask, TaskStatus, ArtStyle, ScriptScene, BigShot, Character, Language, TaskMode, ApiConfig, ProcessedSegment } from './types';
import { generateScriptFromNovel, optimizeSoraPrompt, expandIdeaToStory, continueStory, preprocessNovel } from './services/geminiService';
import { generateCharacterDesign, generateStoryboardImage, generateSoraVideo } from './services/mediaService';
import { translations } from './locales';
import { BELL_SOUND_BASE64, ERROR_SOUND_BASE64 } from './constants';

const STORAGE_KEY_TASKS = 'dramaforge_tasks';
const STORAGE_KEY_LANG = 'dramaforge_language';
const STORAGE_KEY_API_CONFIG = 'dramaforge_apiconfig';

const LOGICAL_STEPS = [
  TaskStatus.PREPROCESSING,
  TaskStatus.SCRIPT_GENERATION,
  TaskStatus.CHARACTER_DESIGN,
  TaskStatus.STORYBOARDING,
  TaskStatus.PROMPT_OPTIMIZATION,
  TaskStatus.VIDEO_GENERATION,
  TaskStatus.COMPLETED
];

const downloadMedia = async (url: string, filename: string) => {
  try {
    const response = await fetch(url);
    const blob = await response.blob();
    const blobUrl = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = blobUrl;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.URL.revokeObjectURL(blobUrl);
  } catch (e) {
    console.error("Download failed", e);
    window.open(url, '_blank');
  }
};

const playSuccessSound = () => {
    try {
        const audio = new Audio(BELL_SOUND_BASE64);
        audio.volume = 0.5;
        audio.play().catch(e => console.warn("Audio autoplay blocked", e));
    } catch (e) {
        console.warn("Audio playback failed", e);
    }
};

const playErrorSound = () => {
    try {
        const audio = new Audio(ERROR_SOUND_BASE64);
        audio.volume = 0.5;
        audio.play().catch(e => console.warn("Audio autoplay blocked", e));
    } catch (e) {
        console.warn("Audio playback failed", e);
    }
};

const renderLogPrefix = (service: string, text: string) => {
  let colorClass = "text-gray-400";
  let bgClass = "bg-gray-800";
  
  if (service === "Gemini") {
    colorClass = "text-purple-300";
    bgClass = "bg-purple-900/40 border-purple-700/50";
  } else if (service === "NanoBanana") {
    colorClass = "text-yellow-300";
    bgClass = "bg-yellow-900/40 border-yellow-700/50";
  } else if (service === "Sora" || service.includes("Sora")) {
    colorClass = "text-sky-300";
    bgClass = "bg-sky-900/40 border-sky-700/50";
  }

  return (
    <div className="flex items-center gap-3 mb-2">
      <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider border ${bgClass} ${colorClass}`}>
        {service}
      </span>
      <span className="font-bold text-gray-300 text-sm">{text}</span>
    </div>
  );
};

// Helper to parse progress from status string
const getProgressFromStatus = (status?: string): number => {
    if (!status) return 0;
    const match = status.match(/(\d+)%/);
    return match ? parseInt(match[1]) : 0;
};

const BigShotDetailModal = ({ 
  shot, 
  allCharacters,
  onClose, 
  onRegenerateStoryboard,
  onGenerateVideo,
  onSave,
  isManualMode,
  initialIsEditing = false,
  t 
}: { 
  shot: BigShot; 
  allCharacters: Character[];
  onClose: () => void; 
  onRegenerateStoryboard: () => void;
  onGenerateVideo: () => void;
  onSave: (updates: Partial<BigShot>) => void;
  isManualMode: boolean;
  initialIsEditing?: boolean;
  t: any 
}) => {
  const [zoomImage, setZoomImage] = useState<string | null>(null);
  const [isEditing, setIsEditing] = useState(initialIsEditing);
  const [editState, setEditState] = useState<{
      storyboardPrompt: string;
      soraPrompt: string;
      charactersInvolved: string[];
  }>({
      storyboardPrompt: shot.storyboardPrompt,
      soraPrompt: shot.soraPromptOptimized || shot.soraPrompt,
      charactersInvolved: shot.charactersInvolved || []
  });

  // Loading states derived from generationStatus
  const isRegenerating = shot.generationStatus?.includes("Generating Storyboard") || shot.generationStatus?.includes("Redrawing");
  const isGeneratingVideo = shot.generationStatus?.includes("Starting") || shot.generationStatus?.includes("Processing") || (shot.generationStatus && !isRegenerating && shot.generationStatus !== "Completed" && !shot.generationStatus.includes("Failed"));
  const isVideoFailed = shot.storyboardImageUrl && !shot.videoUrl && shot.generationStatus?.toLowerCase().includes('failed');
  const isStoryboardFailed = !shot.storyboardImageUrl && shot.generationStatus?.toLowerCase().includes('failed');
  const progressPercent = getProgressFromStatus(shot.generationStatus);

  useEffect(() => {
     setEditState({
        storyboardPrompt: shot.storyboardPrompt,
        soraPrompt: shot.soraPromptOptimized || shot.soraPrompt,
        charactersInvolved: shot.charactersInvolved || []
     });
  }, [shot]);

  const handleSave = () => {
      onSave({
          storyboardPrompt: editState.storyboardPrompt,
          soraPromptOptimized: editState.soraPrompt,
          charactersInvolved: editState.charactersInvolved
      });
      setIsEditing(false);
  };

  const toggleChar = (charName: string) => {
      setEditState(prev => {
          // Robust fuzzy matching for toggle
          const existingIndex = prev.charactersInvolved.findIndex(involvedName => {
              const n1 = (involvedName || "").toLowerCase().trim();
              const n2 = (charName || "").toLowerCase().trim();
              return n1 && n2 && (n1 === n2 || n1.includes(n2) || n2.includes(n1));
          });

          if (existingIndex >= 0) {
              const newInvolved = [...prev.charactersInvolved];
              newInvolved.splice(existingIndex, 1);
              return { ...prev, charactersInvolved: newInvolved };
          } else {
              return { ...prev, charactersInvolved: [...prev.charactersInvolved, charName] };
          }
      });
  };

  if (!shot) return null;
  
  const involvedCharsData = allCharacters.filter(c => 
    shot.charactersInvolved?.some(name => {
      const n1 = (name || "").toLowerCase().trim();
      const n2 = (c.name || "").toLowerCase().trim();
      return n1 && n2 && (n1.includes(n2) || n2.includes(n1));
    })
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 backdrop-blur-md p-4 animate-in fade-in duration-200">
      <div className="bg-[#1a103c]/95 border border-white/10 rounded-2xl w-full max-w-6xl h-[90vh] flex flex-col shadow-2xl overflow-hidden backdrop-blur-xl">
        <div className="flex items-center justify-between p-4 border-b border-white/5 bg-[#130b2e]/50">
          <div className="flex-1">
            <h3 className="text-xl font-bold text-white flex items-center gap-2">
              <span className="text-brand-400">#{shot.id.slice(-4)}</span> {t('sequence')}
              {shot.videoUrl && <span className="bg-green-500/20 text-green-400 border border-green-500/30 text-[10px] px-2 py-0.5 rounded-full uppercase font-bold tracking-wider">{t('videoReady')}</span>}
            </h3>
            <div className="mt-1">
                {isGeneratingVideo ? (
                    <div className="flex items-center gap-3 w-full max-w-sm">
                        <div className="flex-1 h-1.5 bg-gray-700 rounded-full overflow-hidden">
                            <div 
                                className="h-full bg-gradient-to-r from-brand-500 to-purple-400 animate-pulse" 
                                style={{ width: `${Math.max(5, progressPercent)}%` }}
                            ></div>
                        </div>
                        <span className="text-xs font-mono text-brand-300 whitespace-nowrap">
                            {shot.generationStatus}
                        </span>
                    </div>
                ) : (
                    <p className="text-xs text-gray-400">{shot.generationStatus || t('idle')}</p>
                )}
            </div>
          </div>
          <div className="flex items-center gap-3">
             {isManualMode && !isEditing && (
                 <button onClick={() => setIsEditing(true)} className="flex items-center gap-2 px-3 py-1.5 bg-blue-600/20 text-blue-400 hover:bg-blue-600/30 rounded-lg text-sm transition-colors border border-blue-600/30">
                     <Edit2 className="w-4 h-4" /> {t('edit')}
                 </button>
             )}
             {isEditing && (
                 <>
                    <button onClick={() => setIsEditing(false)} className="px-3 py-1.5 text-gray-400 hover:text-white text-sm">{t('cancel')}</button>
                    <button onClick={handleSave} className="flex items-center gap-2 px-3 py-1.5 bg-green-600 hover:bg-green-500 text-white rounded-lg text-sm transition-colors shadow-lg shadow-green-900/50">
                        <Save className="w-4 h-4" /> {t('save')}
                    </button>
                 </>
             )}
             <button onClick={onClose} className="p-2 hover:bg-white/10 rounded-full transition-colors ml-2">
                <XCircle className="w-6 h-6 text-gray-400" />
             </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-6 grid grid-cols-1 lg:grid-cols-12 gap-8">
          <div className="lg:col-span-5 space-y-6">
            <div className="space-y-2">
              <div className="flex justify-between items-center">
                  <h4 className="text-sm font-semibold text-brand-300 uppercase tracking-wider flex items-center gap-2">
                    <ImageIcon className="w-4 h-4" /> 6-Grid Storyboard
                  </h4>
                  <div className="flex gap-2">
                      {shot.storyboardImageUrl && (
                          <button 
                             onClick={() => downloadMedia(shot.storyboardImageUrl!, `storyboard_${shot.id}.png`)}
                             className="p-1 hover:bg-white/10 rounded text-brand-300 transition-colors"
                          >
                             <Download className="w-4 h-4" />
                          </button>
                      )}
                      <button 
                        onClick={onRegenerateStoryboard}
                        disabled={isRegenerating || isEditing}
                        className="flex items-center gap-1.5 px-2 py-1 bg-brand-600/20 hover:bg-brand-600/40 text-brand-300 rounded text-xs border border-brand-500/30 transition-all disabled:opacity-50"
                      >
                        <RotateCw className={`w-3 h-3 ${isRegenerating ? 'animate-spin' : ''}`} />
                        {isRegenerating ? 'Redrawing...' : 'Redraw'}
                      </button>
                  </div>
              </div>
              <div className="relative aspect-video bg-black rounded-xl overflow-hidden border border-white/10 group shadow-lg">
                {shot.storyboardImageUrl ? (
                  <img src={shot.storyboardImageUrl} className="w-full h-full object-contain" alt="Storyboard" />
                ) : isStoryboardFailed ? (
                  <div className="w-full h-full flex flex-col items-center justify-center text-gray-600 bg-red-900/20">
                    <AlertTriangle className="w-12 h-12 mb-2 text-red-500" />
                    <span className="text-sm text-red-400 font-bold mb-2">Storyboard Generation Failed</span>
                    <span className="text-xs text-red-300 max-w-[200px] line-clamp-2">{shot.generationStatus}</span>
                  </div>
                ) : (
                  <div className="w-full h-full flex flex-col items-center justify-center text-gray-600">
                    <FileImage className="w-12 h-12 mb-2 opacity-50" />
                    <span>No Storyboard Generated</span>
                  </div>
                )}
                {(shot.storyboardImageUrl || isRegenerating) && (
                  <div className={`absolute inset-0 bg-black/60 flex items-center justify-center transition-opacity ${isRegenerating ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}>
                    {isRegenerating ? (
                       <div className="flex flex-col items-center gap-2">
                          <Loader2 className="w-8 h-8 animate-spin text-brand-500" />
                          <span className="text-xs text-white">Generating Storyboard...</span>
                       </div>
                    ) : (
                      <button onClick={() => setZoomImage(shot.storyboardImageUrl!)} className="bg-white/20 hover:bg-white/30 p-3 rounded-full backdrop-blur">
                        <Maximize2 className="w-6 h-6 text-white" />
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>

            <div className="space-y-2">
               <div className="flex justify-between items-center">
                  <h4 className="text-sm font-semibold text-green-400 uppercase tracking-wider flex items-center gap-2">
                    <Video className="w-4 h-4" /> Final Video
                  </h4>
                  <div className="flex gap-2">
                      {shot.videoUrl && (
                          <button 
                             onClick={() => downloadMedia(shot.videoUrl!, `video_${shot.id}.mp4`)}
                             className="p-1 hover:bg-white/10 rounded text-green-400"
                          >
                             <Download className="w-4 h-4" />
                          </button>
                      )}
                      {shot.storyboardImageUrl && (
                          <button 
                            onClick={onGenerateVideo}
                            disabled={isGeneratingVideo || isEditing}
                            className={`flex items-center gap-1.5 px-2 py-1 rounded text-xs border transition-all ${
                                isVideoFailed
                                ? 'bg-red-600/20 hover:bg-red-600/40 text-red-400 border-red-500/30'
                                : 'bg-green-600/20 hover:bg-green-600/40 text-green-400 border-green-500/30'
                            }`}
                          >
                             {isGeneratingVideo ? <Loader2 className="w-3 h-3 animate-spin" /> : isVideoFailed ? <RotateCw className="w-3 h-3" /> : <PlayCircle className="w-3 h-3" />}
                             {isGeneratingVideo ? 'Processing...' : isVideoFailed ? 'Retry' : t('generateVideo')}
                          </button>
                      )}
                  </div>
              </div>
               <div className="relative aspect-video bg-black rounded-xl overflow-hidden border border-white/10 shadow-lg">
                {shot.videoUrl ? (
                  <video src={shot.videoUrl} controls className="w-full h-full" poster={shot.storyboardImageUrl} />
                ) : (
                  <div className="w-full h-full flex flex-col items-center justify-center text-gray-600 bg-gray-900/50">
                    {isVideoFailed ? (
                       <div className="flex flex-col items-center justify-center p-6 text-center">
                           <AlertTriangle className="w-8 h-8 text-red-500 mb-2" />
                           <span className="text-sm text-red-400 font-bold mb-2">Generation Failed</span>
                           <span className="text-xs text-red-300 mb-4 max-w-[200px] line-clamp-2">{shot.generationStatus}</span>
                           <button onClick={onGenerateVideo} className="flex items-center gap-2 px-4 py-2 bg-red-600 hover:bg-red-500 text-white rounded-lg text-xs font-bold transition-all">
                              <RotateCw className="w-3 h-3" /> Retry Generation
                           </button>
                       </div>
                    ) : isGeneratingVideo ? (
                       <div className="flex flex-col items-center justify-center w-full p-4">
                         <div className="relative mb-3">
                             <div className="absolute inset-0 bg-brand-500 blur-xl opacity-20 animate-pulse"></div>
                             <Loader2 className="w-10 h-10 animate-spin text-brand-500 relative z-10" />
                         </div>
                         <div className="w-2/3 h-1.5 bg-gray-800 rounded-full overflow-hidden mb-2">
                             <div className="h-full bg-brand-500 animate-pulse" style={{ width: `${Math.max(10, progressPercent)}%` }}></div>
                         </div>
                         <span className="text-sm text-center px-4 font-mono text-brand-200">{shot.generationStatus || 'Starting...'}</span>
                       </div>
                    ) : (
                       <span className="text-sm opacity-50">Video not generated yet</span>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="lg:col-span-7 space-y-6">
             <div className="bg-white/5 p-4 rounded-xl border border-white/5">
               <h4 className="text-xs font-bold text-yellow-500 mb-3 flex items-center gap-2 uppercase tracking-wide">
                 <User className="w-4 h-4" /> {t('charsInvolved')}
               </h4>
               
               {isEditing ? (
                   <div className="grid grid-cols-1 gap-2 max-h-60 overflow-y-auto p-1 custom-scrollbar">
                       {allCharacters.map(c => {
                           // Robust fuzzy matching for selection state
                           const isSelected = editState.charactersInvolved.some(involvedName => {
                               const n1 = (involvedName || "").toLowerCase().trim();
                               const n2 = (c.name || "").toLowerCase().trim();
                               return n1 && n2 && (n1 === n2 || n1.includes(n2) || n2.includes(n1));
                           });
                           
                           return (
                               <div 
                                 key={c.name} 
                                 onClick={() => toggleChar(c.name)}
                                 className={`cursor-pointer p-2 rounded-lg border transition-all flex items-start gap-3 group ${isSelected ? 'bg-brand-600/20 border-brand-500' : 'bg-black/30 border-gray-800 opacity-60'}`}
                               >
                                   <div className={`mt-1 flex-shrink-0 ${isSelected ? 'text-brand-400' : 'text-gray-600'}`}>
                                       {isSelected ? <CheckSquare className="w-5 h-5" /> : <Square className="w-5 h-5" />}
                                   </div>
                                   <div className="w-12 h-12 bg-gray-800 rounded-md overflow-hidden flex-shrink-0 border border-gray-700">
                                       {c.threeViewImg ? (
                                           <img src={c.threeViewImg} alt={c.name} className="w-full h-full object-cover" />
                                       ) : (
                                           <div className="w-full h-full flex items-center justify-center text-xs text-gray-500"><User className="w-5 h-5"/></div>
                                       )}
                                   </div>
                                   <div className="flex-1 min-w-0">
                                       <div className={`text-sm font-bold ${isSelected ? 'text-brand-200' : 'text-gray-400'}`}>{c.name}</div>
                                       <div className="text-xs text-gray-500 line-clamp-2 mt-0.5">{c.visualFeatures}</div>
                                   </div>
                               </div>
                           )
                       })}
                   </div>
               ) : (
                   involvedCharsData.length > 0 ? (
                     <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                       {involvedCharsData.map((char) => (
                         <div key={char.name} className="flex gap-3 bg-black/40 p-2 rounded-lg border border-gray-800">
                           <div 
                             className="w-16 h-20 bg-gray-800 rounded overflow-hidden flex-shrink-0 cursor-zoom-in"
                             onClick={() => char.threeViewImg && setZoomImage(char.threeViewImg)}
                           >
                             {char.threeViewImg ? (
                               <img src={char.threeViewImg} alt={char.name} className="w-full h-full object-cover" />
                             ) : (
                               <div className="w-full h-full flex items-center justify-center text-xs text-gray-500">No Img</div>
                             )}
                           </div>
                           <div className="flex-1 overflow-hidden">
                             <div className="font-bold text-gray-200 text-sm">{char.name}</div>
                             <div className="text-[10px] text-gray-400 mt-1 line-clamp-2">{char.visualFeatures}</div>
                           </div>
                         </div>
                       ))}
                     </div>
                   ) : (
                     <div className="text-sm text-gray-500 italic p-2">No characters identified.</div>
                   )
               )}
             </div>

             {!isEditing && (
                 <div className="bg-white/5 p-4 rounded-xl border border-white/5">
                   <h4 className="text-xs font-bold text-gray-500 mb-2 flex items-center gap-2 uppercase tracking-wide">
                     <AlignLeft className="w-4 h-4" /> DIALOGUE & ACTION
                   </h4>
                   <div className="space-y-2 max-h-40 overflow-y-auto pr-2 custom-scrollbar">
                     {shot.includedDialogues.map((line, i) => (
                       <div key={i} className="text-sm text-gray-300 border-l-2 border-brand-600 pl-3 py-1 bg-white/5 rounded-r">{line}</div>
                     ))}
                   </div>
                 </div>
             )}

             <div className="grid grid-cols-1 gap-6">
                <div className="space-y-2">
                    <h4 className="text-xs font-bold text-gray-500 uppercase">{t('storyboardPrompt')}</h4>
                    {isEditing ? (
                        <textarea 
                           value={editState.storyboardPrompt}
                           onChange={(e) => setEditState({...editState, storyboardPrompt: e.target.value})}
                           className="w-full h-32 bg-black/50 border border-brand-500 rounded-lg p-3 text-sm font-mono text-gray-200 focus:outline-none"
                        />
                    ) : (
                        <div className="bg-black/50 p-3 rounded-lg border border-gray-800 text-xs font-mono text-gray-400 h-24 overflow-y-auto custom-scrollbar">
                          {shot.storyboardPrompt}
                        </div>
                    )}
                </div>
                <div className="space-y-2">
                    <h4 className="text-xs font-bold text-gray-500 uppercase">{t('soraPrompt')}</h4>
                     {isEditing ? (
                        <textarea 
                           value={editState.soraPrompt}
                           onChange={(e) => setEditState({...editState, soraPrompt: e.target.value})}
                           className="w-full h-32 bg-black/50 border border-brand-500 rounded-lg p-3 text-sm font-mono text-gray-200 focus:outline-none"
                        />
                    ) : (
                        <div className="bg-black/50 p-3 rounded-lg border border-gray-800 text-xs font-mono text-brand-200/80 h-24 overflow-y-auto custom-scrollbar">
                          {shot.soraPromptOptimized || shot.soraPrompt}
                        </div>
                    )}
                </div>
             </div>
          </div>
        </div>
      </div>
      {zoomImage && (
        <ImageLightbox src={zoomImage} onClose={() => setZoomImage(null)} />
      )}
    </div>
  );
};

export default function App() {
  const [tasks, setTasks] = useState<DramaTask[]>([]);
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
  const [isNewTaskModalOpen, setIsNewTaskModalOpen] = useState(false);
  const [lang, setLang] = useState<Language>('zh');
  const [confirmModal, setConfirmModal] = useState<{ isOpen: boolean; title: string; message: string; onConfirm: () => void; }>({ isOpen: false, title: '', message: '', onConfirm: () => {} });
  const [editingCharacter, setEditingCharacter] = useState<Character | null>(null);
  const [isExpandingStory, setIsExpandingStory] = useState(false);
  const abortControllers = useRef<Record<string, AbortController>>({});
  const [lightboxImage, setLightboxImage] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'list' | 'tree'>('list');
  const [selectedShotConfig, setSelectedShotConfig] = useState<{ id: string; initialEdit: boolean } | null>(null);
  
  // Log Interaction State
  const [isEditingSourceText, setIsEditingSourceText] = useState(false);
  const [tempSourceText, setTempSourceText] = useState('');
  
  // Character Ref Upload State
  const charFileInputRef = useRef<HTMLInputElement>(null);
  const [uploadingCharName, setUploadingCharName] = useState<string | null>(null);

  // Segment View Modal
  const [viewingSegment, setViewingSegment] = useState<ProcessedSegment | null>(null);

  const [apiConfig, setApiConfig] = useState<ApiConfig>({
    geminiKey: '',
    geminiBaseUrl: '',
    nanobananaKey: '',
    nanobananaBaseUrl: '',
    soraKey: '',
    soraBaseUrl: ''
  });
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  const t = useCallback((key: string) => {
    return translations[lang][key] || key;
  }, [lang]);

  useEffect(() => {
    const savedTasks = localStorage.getItem(STORAGE_KEY_TASKS);
    if (savedTasks) setTasks(JSON.parse(savedTasks));
    const savedLang = localStorage.getItem(STORAGE_KEY_LANG);
    if (savedLang) setLang(savedLang as Language);
    
    const savedConfig = localStorage.getItem(STORAGE_KEY_API_CONFIG);
    if (savedConfig) {
        try {
            setApiConfig(JSON.parse(savedConfig));
        } catch (e) {
            console.error("Failed to parse saved api config", e);
        }
    }
  }, []);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY_TASKS, JSON.stringify(tasks));
  }, [tasks]);

  const handleSaveConfig = (newConfig: ApiConfig) => {
    setApiConfig(newConfig);
    localStorage.setItem(STORAGE_KEY_API_CONFIG, JSON.stringify(newConfig));
    setIsSettingsOpen(false);
  };

  const updateTask = (taskId: string, updates: Partial<DramaTask>) => {
    setTasks(prev => prev.map(t => t.id === taskId ? { ...t, ...updates } : t));
  };

  // Sync temp text when task changes
  const activeTask = tasks.find(t => t.id === activeTaskId);
  useEffect(() => {
    if (activeTask) {
      setTempSourceText(activeTask.rawNovelText);
    }
  }, [activeTask?.rawNovelText]);

  const handleSaveSourceText = () => {
    if (activeTask) {
      updateTask(activeTask.id, { rawNovelText: tempSourceText });
      setIsEditingSourceText(false);
    }
  };

  const handleContinueStory = async () => {
    if (!activeTask || !activeTask.rawNovelText) return;
    setIsExpandingStory(true);
    try {
        const newText = await continueStory(apiConfig.geminiKey, activeTask.rawNovelText, apiConfig.geminiBaseUrl);
        const updatedText = activeTask.rawNovelText + "\n\n" + newText;
        updateTask(activeTask.id, { rawNovelText: updatedText });
    } catch (e) {
        console.error(e);
        alert("Failed to expand story");
    } finally {
        setIsExpandingStory(false);
    }
  };

  const handleRewriteStory = () => {
    if (activeTask) {
      setConfirmModal({
        isOpen: true,
        title: t('delete'),
        message: t('confirmDelete'),
        onConfirm: () => {
           executeTaskStep(activeTask.id, TaskStatus.PREPROCESSING);
        }
      });
    }
  };

  const deleteTask = (taskId: string) => {
    setConfirmModal({
        isOpen: true,
        title: translations[lang].deleteProject || "Delete Project",
        message: translations[lang].confirmDeleteProject || "Are you sure?",
        onConfirm: () => {
            setTasks(prev => prev.filter(t => t.id !== taskId));
            if (activeTaskId === taskId) setActiveTaskId(null);
        }
    });
  };

  const changeLanguage = (newLang: Language) => {
    setLang(newLang);
    localStorage.setItem(STORAGE_KEY_LANG, newLang);
  };

  const cancelTask = (taskId: string) => {
    if (abortControllers.current[taskId]) {
      abortControllers.current[taskId].abort();
      delete abortControllers.current[taskId];
    }
    updateTask(taskId, { status: TaskStatus.CANCELLED, stepStatus: 'completed' }); 
  };

  const createTask = (name: string, style: ArtStyle, language: Language, content: string, mode: TaskMode, sourceType: 'novel' | 'idea') => {
    const newTask: DramaTask = {
      id: crypto.randomUUID(),
      name,
      style,
      language,
      mode,
      sourceType,
      createdAt: Date.now(),
      status: TaskStatus.IDLE,
      stepStatus: 'idle',
      progress: 0,
      rawNovelText: sourceType === 'novel' ? content : '',
      originalIdea: sourceType === 'idea' ? content : undefined,
      characters: [],
      bigShots: []
    };
    setTasks(prev => [newTask, ...prev]);
    setIsNewTaskModalOpen(false);
    if (mode === 'auto') {
      setTimeout(() => executeTaskStep(newTask.id, TaskStatus.PREPROCESSING), 100);
    }
  };

  // --- Character Management ---
  const handleAddCharacter = () => {
     if (!activeTask) return;
     const newChar: Character = {
         name: `New Character ${activeTask.characters.length + 1}`,
         visualFeatures: "Description here...",
         clothing: "Clothing here...",
         voice: "Voice description..."
     };
     updateTask(activeTask.id, { characters: [...activeTask.characters, newChar] });
  };

  const handleDeleteCharacter = (charName: string) => {
     if (!activeTask) return;
     setConfirmModal({
         isOpen: true,
         title: t('delete'),
         message: t('confirmDelete'),
         onConfirm: () => {
             updateTask(activeTask.id, { characters: activeTask.characters.filter(c => c.name !== charName) });
         }
     });
  };

  const handleUploadReferenceTrigger = (charName: string) => {
      setUploadingCharName(charName);
      charFileInputRef.current?.click();
  };

  const handleRefFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file && uploadingCharName && activeTask) {
          const url = URL.createObjectURL(file);
          updateTask(activeTask.id, { 
              characters: activeTask.characters.map(c => c.name === uploadingCharName ? { ...c, referenceImage: url } : c)
          });
          setUploadingCharName(null);
          // Reset file input
          if (charFileInputRef.current) charFileInputRef.current.value = '';
      }
  };

  // --- Sequence Management ---
  const handleAddShot = () => {
      if (!activeTask) return;
      const newShot: BigShot = {
          id: `shot_${Date.now()}`,
          includedDialogues: ["New dialogue..."],
          storyboardPrompt: "Describe scene here...",
          soraPrompt: "Sora prompt here...",
          charactersInvolved: []
      };
      updateTask(activeTask.id, { bigShots: [...activeTask.bigShots, newShot] });
  };

  const handleDeleteShot = (shotId: string) => {
      if (!activeTask) return;
      setConfirmModal({
          isOpen: true,
          title: t('delete'),
          message: t('confirmDelete'),
          onConfirm: () => {
              updateTask(activeTask.id, { bigShots: activeTask.bigShots.filter(s => s.id !== shotId) });
          }
      });
  };

  const regenerateSingleCharacter = async (taskId: string, charName: string) => {
    const task = tasks.find(t => t.id === taskId);
    if (!task) return;
    updateTask(taskId, { characters: task.characters.map(c => c.name === charName ? { ...c, generationStatus: 'Regenerating...' } : c) });
    try {
      const imgUrl = await generateCharacterDesign(
          task.characters.find(c => c.name === charName)!, 
          task.style, 
          task.language,
          apiConfig.nanobananaKey,
          apiConfig.nanobananaBaseUrl
      );
      updateTask(taskId, { characters: task.characters.map(c => c.name === charName ? { ...c, threeViewImg: imgUrl, generationStatus: undefined } : c) });
    } catch (e: any) {
        console.error(e);
        updateTask(taskId, { characters: task.characters.map(c => c.name === charName ? { ...c, generationStatus: undefined } : c) });
        alert("Failed to regenerate character: " + e.message);
    }
  };

  const updateBigShotStatus = (taskId: string, shotId: string, statusText: string | undefined) => {
     setTasks(prev => prev.map(t => t.id === taskId ? { ...t, bigShots: t.bigShots.map(s => s.id === shotId ? { ...s, generationStatus: statusText } : s) } : t));
  };

  const regenerateSingleShot = async (taskId: string, shotId: string) => {
    const task = tasks.find(t => t.id === taskId);
    if (!task) return;
    const shot = task.bigShots.find(s => s.id === shotId);
    if (!shot) return;
    updateBigShotStatus(taskId, shotId, "Generating Storyboard...");
    try {
        const involvedCharacters = task.characters.filter(c => shot.charactersInvolved?.some(name => name.toLowerCase().includes(c.name.toLowerCase())));
        const characterContext = involvedCharacters.map(c => `${c.name}: ${c.visualFeatures}`).join('; ');
        const img = await generateStoryboardImage(
            shot.storyboardPrompt, 
            task.style, 
            task.language, 
            characterContext, 
            involvedCharacters.map(c => c.threeViewImg).filter(Boolean) as string[],
            apiConfig.nanobananaKey,
            apiConfig.nanobananaBaseUrl
        );
        updateTask(taskId, { bigShots: task.bigShots.map(s => s.id === shotId ? { ...s, storyboardImageUrl: img, generationStatus: undefined } : s) });
    } catch (e: any) {
        console.error(e);
        updateBigShotStatus(taskId, shotId, "Regeneration Failed");
        setTimeout(() => updateBigShotStatus(taskId, shotId, undefined), 3000);
    }
  };

  const regenerateSingleVideo = async (taskId: string, shotId: string) => {
     const task = tasks.find(t => t.id === taskId);
     if (!task) return;
     const shot = task.bigShots.find(s => s.id === shotId);
     if (!shot) return;
     updateBigShotStatus(taskId, shotId, "Starting Video Gen...");
     try {
         const video = await generateSoraVideo(
             shot.soraPromptOptimized || shot.soraPrompt, 
             task.style, 
             task.language, 
             apiConfig.soraKey,
             apiConfig.soraBaseUrl,
             shot.storyboardImageUrl, 
             (status) => updateBigShotStatus(taskId, shot.id, status)
         );
         updateTask(taskId, { bigShots: task.bigShots.map(s => s.id === shotId ? { ...s, videoUrl: video, generationStatus: "Completed" } : s) });
     } catch (e: any) {
         console.error(e);
         updateBigShotStatus(taskId, shotId, "Video Failed: " + (e.message || "Error"));
     }
  };

  const executeTaskStep = async (taskId: string, targetStatus?: TaskStatus) => {
    let task = tasks.find(t => t.id === taskId);
    if (!task) return;
    let stepToRun = targetStatus || task.status;
    if (stepToRun === TaskStatus.IDLE) stepToRun = TaskStatus.PREPROCESSING;
    updateTask(taskId, { status: stepToRun, stepStatus: 'processing', error: undefined, failedStep: undefined });
    if (abortControllers.current[taskId]) abortControllers.current[taskId].abort();
    const controller = new AbortController();
    abortControllers.current[taskId] = controller;
    const signal = controller.signal;

    try {
        switch (stepToRun) {
            case TaskStatus.PREPROCESSING: {
                let processedText = task.rawNovelText;
                let segments: ProcessedSegment[] = [];

                if (task.sourceType === 'idea' && task.originalIdea) {
                    // For ideas, we still use AI to expand it first
                    processedText = await expandIdeaToStory(apiConfig.geminiKey, task.originalIdea, apiConfig.geminiBaseUrl, task.language, signal);
                } 
                
                const TEXT_SEGMENT_THRESHOLD = 20000;
                
                const fileSplitPattern = /====FILE_START: (.*?)====([\s\S]*?)====FILE_END====/g;
                let match;
                let hasFileMarkers = false;
                
                while ((match = fileSplitPattern.exec(processedText)) !== null) {
                    hasFileMarkers = true;
                    segments.push({
                        id: `seg_${Date.now()}_${segments.length}`,
                        name: match[1], // Filename
                        content: match[2].trim(),
                        index: segments.length
                    });
                }

                if (!hasFileMarkers) {
                    // Single text processing
                    if (processedText.length >= TEXT_SEGMENT_THRESHOLD) {
                        const chunkSize = 15000;
                        const overlap = 500;
                        let startIndex = 0;
                        let chunkIndex = 0;
                        
                        while (startIndex < processedText.length) {
                            const endIndex = Math.min(startIndex + chunkSize, processedText.length);
                            segments.push({
                                id: `seg_${Date.now()}_${chunkIndex}`,
                                name: `Batch ${chunkIndex + 1} (${startIndex}-${endIndex})`,
                                content: processedText.substring(startIndex, endIndex),
                                index: chunkIndex
                            });
                            startIndex += (chunkSize - overlap);
                            chunkIndex++;
                        }
                    } else {
                        segments.push({
                            id: `seg_${Date.now()}_0`,
                            name: "Full Text",
                            content: processedText,
                            index: 0
                        });
                    }
                }

                updateTask(taskId, { 
                    rawNovelText: processedText, 
                    segments: segments,
                    progress: 15, 
                    stepStatus: 'completed' 
                });
                break;
            }
            case TaskStatus.SCRIPT_GENERATION: {
                const geminiOutput = await generateScriptFromNovel(apiConfig.geminiKey, task.rawNovelText, task.style, apiConfig.geminiBaseUrl, task.language, signal);
                const initializedBigShots: BigShot[] = geminiOutput.bigShots.map((shot: any, idx: number) => ({
                    ...shot,
                    id: `shot_${Date.now()}_${idx}_${Math.random().toString(36).slice(2)}`,
                }));
                updateTask(taskId, { scriptAnalysis: geminiOutput.analysis, characters: geminiOutput.characters, script: geminiOutput.script, bigShots: initializedBigShots, progress: 40, stepStatus: 'completed' });
                break;
            }
            case TaskStatus.CHARACTER_DESIGN: {
                // Batch processing for characters
                const BATCH_SIZE = 3;
                let currentCharacters = [...task.characters];
                // Filter indices that need generation
                const indicesToGenerate = currentCharacters
                    .map((c, idx) => (!c.threeViewImg ? idx : -1))
                    .filter(idx => idx !== -1);
                
                let failedCount = 0;
                let successCount = 0;
                
                for (let i = 0; i < indicesToGenerate.length; i += BATCH_SIZE) {
                    if (signal.aborted) break;
                    
                    const batchIndices = indicesToGenerate.slice(i, i + BATCH_SIZE);
                    
                    // Mark batch as generating
                    setTasks(prev => {
                        const t = prev.find(p => p.id === taskId);
                        if (!t) return prev;
                        const newChars = [...t.characters];
                        batchIndices.forEach(idx => {
                           newChars[idx] = { ...newChars[idx], generationStatus: 'Generating...' };
                        });
                        return prev.map(p => p.id === taskId ? { ...p, characters: newChars } : p);
                    });

                    // Execute batch concurrently
                    await Promise.all(batchIndices.map(async (charIndex) => {
                        try {
                             // Get latest state
                             const charToGen = currentCharacters[charIndex];
                             const imgUrl = await generateCharacterDesign(charToGen, task.style, task.language, apiConfig.nanobananaKey, apiConfig.nanobananaBaseUrl, signal);
                             
                             // Update specific character in global state immediately
                             setTasks(prev => {
                                const t = prev.find(p => p.id === taskId);
                                if (!t) return prev;
                                const newChars = [...t.characters];
                                newChars[charIndex] = { ...newChars[charIndex], threeViewImg: imgUrl, generationStatus: undefined };
                                // Update local ref for next iterations if needed (though we rely on indices)
                                currentCharacters = newChars;
                                return prev.map(p => p.id === taskId ? { ...p, characters: newChars } : p);
                             });
                             successCount++;
                        } catch (e: any) {
                             console.error(`Character ${charIndex} failed`, e);
                             failedCount++;
                             setTasks(prev => {
                                const t = prev.find(p => p.id === taskId);
                                if (!t) return prev;
                                const newChars = [...t.characters];
                                newChars[charIndex] = { ...newChars[charIndex], generationStatus: undefined }; // Reset status on fail
                                return prev.map(p => p.id === taskId ? { ...p, characters: newChars } : p);
                             });
                        }
                    }));
                }
                
                // Check if all characters failed
                if (indicesToGenerate.length > 0 && failedCount === indicesToGenerate.length) {
                    throw new Error(`Character design failed: All ${failedCount} characters failed to generate`);
                }
                
                // Log partial failures
                if (failedCount > 0) {
                    console.warn(`Character design completed with ${successCount} successes and ${failedCount} failures`);
                }
                
                updateTask(taskId, { progress: 60, stepStatus: 'completed' });
                break;
            }
            case TaskStatus.STORYBOARDING: {
                // Batch processing for storyboards
                const BATCH_SIZE = 3;
                let currentBigShots = [...task.bigShots];
                const indicesToGenerate = currentBigShots
                    .map((s, idx) => (!s.storyboardImageUrl ? idx : -1))
                    .filter(idx => idx !== -1);
                
                let failedCount = 0;
                let successCount = 0;
                
                for (let i = 0; i < indicesToGenerate.length; i += BATCH_SIZE) {
                     if (signal.aborted) break;
                     const batchIndices = indicesToGenerate.slice(i, i + BATCH_SIZE);

                     // Mark batch generating
                     setTasks(prev => {
                        const t = prev.find(p => p.id === taskId);
                        if (!t) return prev;
                        const newShots = [...t.bigShots];
                        batchIndices.forEach(idx => {
                            newShots[idx] = { ...newShots[idx], generationStatus: 'Generating Storyboard...' };
                        });
                        return prev.map(p => p.id === taskId ? { ...p, bigShots: newShots } : p);
                     });

                     await Promise.all(batchIndices.map(async (shotIndex) => {
                        try {
                            const shot = currentBigShots[shotIndex];
                            const involvedCharacters = task.characters.filter(c => shot.charactersInvolved?.some(name => name.toLowerCase().includes(c.name.toLowerCase())));
                            const context = involvedCharacters.map(c => `${c.name}: ${c.visualFeatures}`).join('; ');
                            
                            const img = await generateStoryboardImage(shot.storyboardPrompt, task.style, task.language, context, involvedCharacters.map(c => c.threeViewImg).filter(Boolean) as string[], apiConfig.nanobananaKey, apiConfig.nanobananaBaseUrl, signal);
                            
                            setTasks(prev => {
                                const t = prev.find(p => p.id === taskId);
                                if (!t) return prev;
                                const newShots = [...t.bigShots];
                                newShots[shotIndex] = { ...newShots[shotIndex], storyboardImageUrl: img, generationStatus: undefined };
                                currentBigShots = newShots;
                                return prev.map(p => p.id === taskId ? { ...p, bigShots: newShots, coverImage: shotIndex === 0 ? img : p.coverImage } : p);
                            });
                            successCount++;
                        } catch (e: any) {
                            console.error(`Storyboard ${shotIndex} failed`, e);
                            failedCount++;
                            setTasks(prev => {
                                const t = prev.find(p => p.id === taskId);
                                if (!t) return prev;
                                const newShots = [...t.bigShots];
                                newShots[shotIndex] = { ...newShots[shotIndex], generationStatus: 'Failed' };
                                return prev.map(p => p.id === taskId ? { ...p, bigShots: newShots } : p);
                            });
                        }
                     }));
                }
                
                // Check if all storyboards failed
                if (indicesToGenerate.length > 0 && failedCount === indicesToGenerate.length) {
                    throw new Error(`Storyboard generation failed: All ${failedCount} storyboards failed to generate`);
                }
                
                // Log partial failures
                if (failedCount > 0) {
                    console.warn(`Storyboard generation completed with ${successCount} successes and ${failedCount} failures`);
                }
                
                updateTask(taskId, { progress: 80, stepStatus: 'completed' });
                break;
            }
            case TaskStatus.PROMPT_OPTIMIZATION: {
                // Typically fast, but can be batched too
                const BATCH_SIZE = 5;
                let currentBigShots = [...task.bigShots];
                const indicesToGenerate = currentBigShots.map((s, idx) => (!s.soraPromptOptimized ? idx : -1)).filter(idx => idx !== -1);
                
                let failedCount = 0;
                let successCount = 0;

                for (let i = 0; i < indicesToGenerate.length; i += BATCH_SIZE) {
                    if (signal.aborted) break;
                    const batchIndices = indicesToGenerate.slice(i, i + BATCH_SIZE);
                    
                    await Promise.all(batchIndices.map(async (shotIndex) => {
                         try {
                             const shot = currentBigShots[shotIndex];
                             const optimized = await optimizeSoraPrompt(apiConfig.geminiKey, shot.soraPrompt || "Scene", task.style, apiConfig.geminiBaseUrl, task.language, signal);
                             
                             setTasks(prev => {
                                 const t = prev.find(p => p.id === taskId);
                                 if (!t) return prev;
                                 const newShots = [...t.bigShots];
                                 newShots[shotIndex] = { ...newShots[shotIndex], soraPromptOptimized: optimized };
                                 currentBigShots = newShots;
                                 return prev.map(p => p.id === taskId ? { ...p, bigShots: newShots } : p);
                             });
                             successCount++;
                         } catch (e: any) {
                             console.error(`Prompt optimization for shot ${shotIndex} failed`, e);
                             failedCount++;
                         }
                    }));
                }
                
                // Check if all prompt optimizations failed
                if (indicesToGenerate.length > 0 && failedCount === indicesToGenerate.length) {
                    throw new Error(`Prompt optimization failed: All ${failedCount} prompts failed to optimize`);
                }
                
                // Log partial failures
                if (failedCount > 0) {
                    console.warn(`Prompt optimization completed with ${successCount} successes and ${failedCount} failures`);
                }
                
                updateTask(taskId, { progress: 90, stepStatus: 'completed' });
                break;
            }
            case TaskStatus.VIDEO_GENERATION: {
                // Batch processing for videos
                const BATCH_SIZE = 3;
                let currentBigShots = [...task.bigShots];
                const indicesToGenerate = currentBigShots.map((s, idx) => (!s.videoUrl ? idx : -1)).filter(idx => idx !== -1);
                
                let failedCount = 0;
                let successCount = 0;

                for (let i = 0; i < indicesToGenerate.length; i += BATCH_SIZE) {
                    if (signal.aborted) break;
                    const batchIndices = indicesToGenerate.slice(i, i + BATCH_SIZE);
                    
                    // Mark batch as starting
                    setTasks(prev => {
                        const t = prev.find(p => p.id === taskId);
                        if (!t) return prev;
                        const newShots = [...t.bigShots];
                        batchIndices.forEach(idx => {
                            newShots[idx] = { ...newShots[idx], generationStatus: 'Starting...' };
                        });
                        return prev.map(p => p.id === taskId ? { ...p, bigShots: newShots } : p);
                    });

                    await Promise.all(batchIndices.map(async (shotIndex) => {
                        try {
                            const shot = currentBigShots[shotIndex];
                            
                            const videoUrl = await generateSoraVideo(
                                shot.soraPromptOptimized || shot.soraPrompt, 
                                task.style, 
                                task.language, 
                                apiConfig.soraKey,
                                apiConfig.soraBaseUrl, 
                                shot.storyboardImageUrl, 
                                (status) => updateBigShotStatus(taskId, shot.id, status), 
                                signal
                            );

                            setTasks(prev => {
                                const t = prev.find(p => p.id === taskId);
                                if (!t) return prev;
                                const newShots = [...t.bigShots];
                                newShots[shotIndex] = { ...newShots[shotIndex], videoUrl: videoUrl, generationStatus: "Completed" };
                                currentBigShots = newShots;
                                return prev.map(p => p.id === taskId ? { ...p, bigShots: newShots } : p);
                            });
                            successCount++;
                        } catch (e: any) {
                            console.error(`Video ${shotIndex} failed`, e);
                            failedCount++;
                             setTasks(prev => {
                                const t = prev.find(p => p.id === taskId);
                                if (!t) return prev;
                                const newShots = [...t.bigShots];
                                newShots[shotIndex] = { 
                                    ...newShots[shotIndex], 
                                    generationStatus: 'Failed: ' + (e.message || "Unknown error") 
                                };
                                return prev.map(p => p.id === taskId ? { ...p, bigShots: newShots } : p);
                            });
                        }
                    }));
                }
                
                // Check if all videos failed
                if (indicesToGenerate.length > 0 && failedCount === indicesToGenerate.length) {
                    throw new Error(`Video generation failed: All ${failedCount} videos failed to generate`);
                }
                
                // Log partial failures
                if (failedCount > 0) {
                    console.warn(`Video generation completed with ${successCount} successes and ${failedCount} failures`);
                }
                
                updateTask(taskId, { progress: 100, status: TaskStatus.COMPLETED, stepStatus: 'completed' });
                break;
            }
        }
        
        // Play notification sound if in manual mode
        if (task.mode === 'manual') {
            playSuccessSound();
        }

    } catch (e: any) {
        if (axios.isCancel(e)) return;
        updateTask(taskId, { status: TaskStatus.FAILED, failedStep: stepToRun, error: e.message || "Unknown error", stepStatus: 'idle' });
        playErrorSound();
    }
  };

  const proceedToNextStep = (taskId: string) => {
      const task = tasks.find(t => t.id === taskId);
      if (!task) return;
      const next = LOGICAL_STEPS[LOGICAL_STEPS.indexOf(task.status) + 1];
      if (next) executeTaskStep(taskId, next);
  };

  useEffect(() => {
    tasks.forEach(task => {
        if (task.mode === 'auto' && task.status !== TaskStatus.COMPLETED && task.status !== TaskStatus.FAILED && task.status !== TaskStatus.CANCELLED && task.stepStatus === 'completed') {
             const next = LOGICAL_STEPS[LOGICAL_STEPS.indexOf(task.status) + 1];
             if (next) setTimeout(() => executeTaskStep(task.id, next), 800);
        }
    });
  }, [tasks]);

  // Reactive derived state for the detail modal to ensure immediate UI updates
  const currentShotInTask = activeTask?.bigShots.find(s => s.id === selectedShotConfig?.id);

  const getStepLabelKey = (step: TaskStatus, sourceType?: 'novel' | 'idea') => {
      if (step === TaskStatus.PREPROCESSING) return sourceType === 'idea' ? 'step_expansion' : 'step_structuring';
      return step;
  };

  return (
    <div className="min-h-screen bg-[#0f0f13] text-gray-200 font-sans selection:bg-brand-500/30 overflow-x-hidden">
      {/* Hidden file input for character ref upload */}
      <input 
        type="file" 
        accept="image/*" 
        ref={charFileInputRef} 
        onChange={handleRefFileChange} 
        className="hidden" 
      />

      <div className="fixed inset-0 z-0 pointer-events-none">
          <div className="absolute top-0 left-1/4 w-[500px] h-[500px] bg-brand-900/20 rounded-full blur-[120px] mix-blend-screen animate-pulse-slow"></div>
          <div className="absolute bottom-0 right-1/4 w-[500px] h-[500px] bg-blue-900/10 rounded-full blur-[120px] mix-blend-screen"></div>
      </div>

      <header className="sticky top-0 z-40 bg-[#0f0f13]/80 backdrop-blur-md border-b border-white/5 shadow-lg">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3 cursor-pointer group" onClick={() => setActiveTaskId(null)}>
            <div className="w-9 h-9 bg-gradient-to-br from-brand-600 to-brand-800 rounded-xl flex items-center justify-center shadow-lg group-hover:scale-105 transition-transform duration-300">
              <Film className="w-5 h-5 text-white" />
            </div>
            <h1 className="text-xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-white to-gray-400 tracking-tight">
              {t('appTitle')}
            </h1>
          </div>
          <div className="flex items-center gap-4">
            <button onClick={() => setIsSettingsOpen(true)} className="p-2 hover:bg-white/5 rounded-full text-gray-400 hover:text-white transition-colors">
              <Settings className="w-5 h-5" />
            </button>
            <div className="relative group z-50">
               <button className="p-2 hover:bg-white/5 rounded-full transition-colors flex items-center gap-1 text-gray-400">
                 <Globe className="w-4 h-4" />
                 <span className="text-xs font-mono uppercase font-bold tracking-wider">{lang}</span>
               </button>
               <div className="absolute right-0 top-full pt-2 w-32 hidden group-hover:block">
                 <div className="bg-[#1a103c] border border-white/10 rounded-lg shadow-xl overflow-hidden backdrop-blur-md">
                   {['zh', 'en', 'ja', 'ko'].map(l => (
                     <button key={l} onClick={() => changeLanguage(l as Language)} className={`w-full text-left px-4 py-2 text-xs hover:bg-brand-600/50 transition-colors ${lang === l ? 'text-brand-400 font-bold' : 'text-gray-400'}`}>
                        {l === 'zh' ? '中文' : l === 'en' ? 'English' : l === 'ja' ? '日本語' : '한국어'}
                     </button>
                   ))}
                 </div>
               </div>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-8 relative z-10">
        {!activeTask ? (
          <div>
             <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-10 gap-4">
              <div>
                <h2 className="text-3xl font-bold text-white mb-2 tracking-tight">{t('myProjects')}</h2>
                <p className="text-gray-400 text-sm">{t('myProjectsDesc')}</p>
              </div>
              <button onClick={() => setIsNewTaskModalOpen(true)} className="group relative inline-flex items-center gap-2 px-6 py-3 bg-gradient-to-r from-brand-600 to-brand-500 hover:from-brand-500 hover:to-brand-400 text-white rounded-xl font-medium transition-all shadow-lg hover:-translate-y-0.5">
                <Plus className="w-5 h-5 group-hover:rotate-90 transition-transform duration-300" />
                <span>{t('newProject')}</span>
              </button>
            </div>
            {tasks.length === 0 ? (
              <div onClick={() => setIsNewTaskModalOpen(true)} className="border border-dashed border-gray-800 rounded-3xl bg-white/5 hover:bg-white/[0.07] transition-colors p-12 flex flex-col items-center justify-center cursor-pointer group">
                  <div className="w-20 h-20 bg-gradient-to-br from-gray-800 to-black rounded-full flex items-center justify-center mb-6 group-hover:scale-110 transition-transform duration-300 shadow-2xl">
                      <Wand2 className="w-10 h-10 text-brand-400" />
                  </div>
                  <h3 className="text-2xl font-bold text-white mb-2">{t('noProjects')}</h3>
                  <p className="text-gray-400 max-w-md text-center">{t('noProjectsDesc')}</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 animate-in fade-in duration-500">
                {tasks.map(task => <TaskCard key={task.id} task={task} onClick={() => setActiveTaskId(task.id)} onDelete={() => deleteTask(task.id)} t={t} />)}
              </div>
            )}
          </div>
        ) : (
          <div className="animate-in fade-in slide-in-from-bottom-4 duration-500 pb-20">
            <div className="flex items-center justify-between mb-8 sticky top-20 z-30 bg-[#0f0f13]/90 backdrop-blur-xl py-4 border-b border-white/5 rounded-b-xl px-2">
              <div className="flex items-center gap-4">
                <button onClick={() => setActiveTaskId(null)} className="p-2 hover:bg-white/10 rounded-full transition-colors group">
                  <ArrowLeft className="w-5 h-5 group-hover:-translate-x-1 transition-transform" />
                </button>
                <div>
                  <h2 className="text-2xl font-bold text-white flex items-center gap-3">
                    {activeTask.name}
                    <span className={`text-[10px] uppercase px-2 py-0.5 rounded border tracking-wider font-bold ${activeTask.mode === 'manual' ? 'bg-purple-500/20 text-purple-200 border-purple-500/30' : 'bg-blue-500/20 text-blue-200 border-blue-500/30'}`}>
                      {t(activeTask.mode === 'manual' ? 'manualMode' : 'autoMode')}
                    </span>
                  </h2>
                  <div className="flex items-center gap-3 text-xs text-gray-400 mt-1">
                    <span className="px-2 py-0.5 rounded border bg-brand-900/50 border-brand-700 text-brand-300">
                      {t(getStepLabelKey(activeTask.status, activeTask.sourceType))}
                    </span>
                    <span className="flex items-center gap-1"><Sparkles className="w-3 h-3" /> {t(activeTask.sourceType === 'novel' ? 'fromNovel' : 'fromIdea')}</span>
                  </div>
                </div>
              </div>
              <div className="flex gap-3">
                {activeTask.mode === 'manual' && activeTask.status === TaskStatus.IDLE && (
                   <button onClick={() => executeTaskStep(activeTask.id)} className="px-6 py-2 bg-gradient-to-r from-brand-600 to-brand-500 text-white rounded-lg font-medium flex items-center gap-2 shadow-lg">
                        <PlayCircle className="w-5 h-5" /> Start Task
                    </button>
                )}
                {activeTask.mode === 'manual' && activeTask.status === TaskStatus.FAILED && (
                    <>
                        <div className="flex-1 bg-red-900/20 border border-red-600/30 rounded-lg p-3">
                            <div className="flex items-center gap-2 text-red-400 mb-1">
                                <AlertTriangle className="w-4 h-4" />
                                <span className="font-bold text-sm">{t('stepFailed')}</span>
                            </div>
                            <p className="text-red-300/80 text-xs">{activeTask.error}</p>
                        </div>
                        <button onClick={() => executeTaskStep(activeTask.id, activeTask.failedStep)} className="px-6 py-2 bg-red-600 hover:bg-red-500 text-white rounded-lg font-medium flex items-center gap-2 shadow-lg shadow-red-900/20">
                            <RotateCw className="w-5 h-5" /> {t('retryStep')}
                        </button>
                    </>
                )}
                {activeTask.mode === 'manual' && activeTask.stepStatus === 'completed' && activeTask.status !== TaskStatus.COMPLETED && activeTask.status !== TaskStatus.FAILED && (
                    <>
                        <button onClick={() => executeTaskStep(activeTask.id, activeTask.status)} className="px-4 py-2 bg-gray-800 text-white border border-gray-600 rounded-lg hover:bg-gray-700 flex items-center gap-2 transition-colors">
                            <RotateCw className="w-4 h-4" /> {t('regenerateStep')}
                        </button>
                        <button onClick={() => proceedToNextStep(activeTask.id)} className="px-4 py-2 bg-green-600 text-white border border-green-500 rounded-lg hover:bg-green-500 flex items-center gap-2 shadow-lg shadow-green-900/20">
                            <SkipForward className="w-4 h-4" /> {t('nextStep')}
                        </button>
                    </>
                )}
                {activeTask.stepStatus === 'processing' && (
                  <button onClick={() => cancelTask(activeTask.id)} className="px-4 py-2 bg-red-600/20 text-red-400 border border-red-600/50 rounded-lg hover:bg-red-600/30 flex items-center gap-2 transition-colors">
                    <XOctagon className="w-4 h-4" /> {t('cancelTask')}
                  </button>
                )}
              </div>
            </div>

            <div className="mb-10">
               <div className="flex justify-between mb-4">
                  <h3 className="text-gray-400 text-xs font-bold uppercase tracking-wider">{t('stepProgress')}</h3>
                  <span className="text-brand-400 font-mono text-xs">{activeTask.progress}%</span>
               </div>
               <div className="relative">
                 {/* Progress Line - Centered Vertically relative to 32px high circles (top-[15px]) */}
                 <div className="absolute top-[15px] left-0 w-full h-0.5 bg-gray-800 -z-10 rounded-full"></div>
                 <div className="absolute top-[15px] left-0 h-0.5 bg-gradient-to-r from-brand-600 to-blue-500 -z-10 transition-all duration-700 rounded-full" style={{ width: `${activeTask.progress}%` }}></div>
                 
                 <div className="flex justify-between">
                   {LOGICAL_STEPS.map((step, idx) => {
                     const isCompleted = LOGICAL_STEPS.indexOf(activeTask.status) > idx || activeTask.status === TaskStatus.COMPLETED;
                     const isCurrent = activeTask.status === step;
                     const isProcessing = isCurrent && activeTask.stepStatus === 'processing';
                     const isStepDone = isCurrent && activeTask.stepStatus === 'completed';

                     return (
                       <div key={step} className="flex flex-col items-center gap-2 group cursor-default">
                         <div className={`w-8 h-8 rounded-full flex items-center justify-center border-2 transition-all duration-300 z-10 ${isCompleted ? 'bg-brand-600 border-brand-600' : isCurrent ? 'bg-black border-brand-500 text-brand-500 shadow-lg' : 'bg-gray-900 border-gray-700 text-gray-700'}`}>
                           {isCompleted ? <CheckCircle className="w-5 h-5" /> : isProcessing ? <Loader2 className="w-4 h-4 animate-spin" /> : isStepDone ? <CheckCircle className="w-5 h-5 text-brand-500" /> : <Circle className="w-4 h-4 fill-current" />}
                         </div>
                         <span className={`text-[10px] font-medium uppercase tracking-tight max-w-[80px] text-center ${isCompleted || isCurrent ? 'text-brand-300' : 'text-gray-600'}`}>{t(getStepLabelKey(step, activeTask.sourceType))}</span>
                       </div>
                     );
                   })}
                 </div>
               </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
              <div className="lg:col-span-4 space-y-6">
                <div className="bg-[#130b2e]/50 border border-white/5 rounded-2xl p-6 backdrop-blur-md">
                  <h3 className="flex items-center gap-2 text-lg font-semibold text-white mb-4"><BookOpen className="w-5 h-5 text-brand-400" /> {t('scriptAnalysis')}</h3>
                  
                  {/* Source Batches Display */}
                  {activeTask.segments && activeTask.segments.length > 1 && (
                     <div className="mb-6">
                        <div className="text-xs font-bold text-gray-500 uppercase mb-2">Source Batches / Segments</div>
                        <div className="space-y-2 max-h-40 overflow-y-auto custom-scrollbar">
                           {activeTask.segments.map((seg) => (
                              <div 
                                 key={seg.id} 
                                 onClick={() => setViewingSegment(seg)}
                                 className="flex items-center justify-between p-2 bg-black/30 rounded border border-gray-800 hover:border-brand-500/50 cursor-pointer transition-colors"
                              >
                                 <span className="text-xs text-gray-300 truncate">{seg.name}</span>
                                 <span className="text-[10px] text-gray-600 font-mono">{seg.content.length} chars</span>
                              </div>
                           ))}
                        </div>
                     </div>
                  )}

                  {activeTask.scriptAnalysis ? (
                    <div className="space-y-4 text-sm text-gray-300">
                      <div className="bg-black/20 p-3 rounded-lg border border-white/5">
                        <span className="text-gray-500 uppercase text-[10px] font-bold block mb-1 tracking-wider">{t('plotSummary')}</span>
                        {activeTask.scriptAnalysis.corePlot}
                      </div>
                      <div className="bg-black/20 p-3 rounded-lg border border-white/5">
                        <span className="text-gray-500 uppercase text-[10px] font-bold block mb-1 tracking-wider">{t('mood')}</span>
                        <span className="inline-block px-2 py-0.5 bg-brand-900/50 text-brand-300 rounded text-xs border border-brand-500/20">{activeTask.scriptAnalysis.mood}</span>
                      </div>
                    </div>
                  ) : (
                    activeTask.status === TaskStatus.SCRIPT_GENERATION ? (
                         <div className="h-32 flex items-center justify-center text-gray-600 animate-pulse bg-black/10 rounded-xl">Analyzing...</div>
                    ) : (
                         <div className="h-24 flex items-center justify-center text-gray-600 bg-black/10 rounded-xl text-xs italic">
                            Analysis pending
                         </div>
                    )
                  )}
                </div>

                <div className="bg-[#130b2e]/50 border border-white/5 rounded-2xl p-6 backdrop-blur-md">
                   <div className="flex items-center justify-between mb-4">
                       <h3 className="flex items-center gap-2 text-lg font-semibold text-white"><ImageIcon className="w-5 h-5 text-yellow-500" /> {t('characters')}</h3>
                       {activeTask.mode === 'manual' && (
                           <button onClick={handleAddCharacter} className="p-1.5 bg-white/5 hover:bg-white/10 rounded text-gray-400 hover:text-white transition-colors" title={t('addCharacter')}>
                               <UserPlus className="w-4 h-4" />
                           </button>
                       )}
                   </div>
                   <div className="space-y-4 h-[250px] overflow-y-auto pr-2 custom-scrollbar">
                     {activeTask.characters.map((char, idx) => (
                       <div key={idx} className="relative group/char flex gap-4 p-3 bg-black/20 rounded-xl border border-white/5 hover:border-brand-500/30 transition-all">
                          <div className="absolute top-2 right-2 flex gap-1 z-10 opacity-0 group-hover/char:opacity-100 transition-opacity">
                             {activeTask.mode === 'manual' && (
                                 <>
                                     {char.threeViewImg && (
                                         <button onClick={() => downloadMedia(char.threeViewImg!, `${char.name}_design.png`)} className="p-1.5 bg-black/50 hover:bg-brand-600 rounded-full text-gray-400 hover:text-white transition-all" title={t('downloadImage')}>
                                            <Download className="w-3 h-3" />
                                         </button>
                                     )}
                                     <button onClick={() => handleUploadReferenceTrigger(char.name)} className="p-1.5 bg-black/50 hover:bg-brand-600 rounded-full text-gray-400 hover:text-white transition-all" title={t('uploadReference')}>
                                        <ImagePlus className="w-3 h-3" />
                                     </button>
                                     <button onClick={() => regenerateSingleCharacter(activeTask.id, char.name)} className="p-1.5 bg-black/50 hover:bg-brand-600 rounded-full text-gray-400 hover:text-white transition-all" title={t('regenerateCharacter')}><RotateCw className="w-3 h-3" /></button>
                                     <button onClick={() => setEditingCharacter(char)} className="p-1.5 bg-black/50 hover:bg-brand-600 rounded-full text-gray-400 hover:text-white transition-all" title={t('editCharacter')}><Edit2 className="w-3 h-3" /></button>
                                     <button onClick={() => handleDeleteCharacter(char.name)} className="p-1.5 bg-black/50 hover:bg-red-600 rounded-full text-gray-400 hover:text-white transition-all" title={t('delete')}><Trash2 className="w-3 h-3" /></button>
                                 </>
                             )}
                          </div>
                          <div className="w-16 h-16 bg-gray-800 rounded-lg overflow-hidden flex-shrink-0 border border-white/10 relative">
                            {char.generationStatus ? (
                              <div className="w-full h-full flex items-center justify-center text-gray-600">
                                <Loader2 className="w-4 h-4 animate-spin text-brand-500" />
                              </div>
                            ) : char.threeViewImg ? (
                              <img 
                                src={char.threeViewImg} 
                                alt={char.name} 
                                className="w-full h-full object-cover cursor-zoom-in" 
                                onClick={() => setLightboxImage(char.threeViewImg!)}
                              />
                            ) : (
                              <div className="w-full h-full flex items-center justify-center text-gray-600">
                                <User className="w-6 h-6" />
                              </div>
                            )}
                            {char.referenceImage && <div className="absolute bottom-0 right-0 w-4 h-4 bg-green-500 rounded-tl flex items-center justify-center" title="Has Reference"><ImagePlus className="w-2 h-2 text-white" /></div>}
                          </div>
                          <div className="flex-1 overflow-hidden">
                            <div className="font-bold text-gray-200 text-sm">{char.name}</div>
                            <div className="text-[10px] text-gray-500 mt-1 line-clamp-2 leading-relaxed">{char.visualFeatures}</div>
                          </div>
                       </div>
                     ))}
                     {activeTask.characters.length === 0 && (
                        <div className="p-8 text-center text-gray-600 italic text-sm border border-dashed border-gray-800 rounded-xl">
                           {t('waitingScript')}
                        </div>
                     )}
                   </div>
                </div>
              </div>

              <div className="lg:col-span-8">
                 <div className="flex items-center justify-between mb-6">
                    <h3 className="flex items-center gap-2 text-xl font-bold text-white"><Video className="w-6 h-6 text-brand-500" /> {t('sequence')}</h3>
                    <div className="flex items-center gap-3">
                        {activeTask.mode === 'manual' && (
                             <button onClick={handleAddShot} className="px-3 py-1.5 bg-white/5 hover:bg-white/10 text-gray-300 rounded-lg text-xs flex items-center gap-1.5 transition-colors border border-white/10">
                                 <Plus className="w-3.5 h-3.5" /> {t('addShot')}
                             </button>
                        )}
                        <div className="flex bg-black/40 p-1 rounded-lg border border-white/5">
                            <button onClick={() => setViewMode('list')} className={`p-1.5 rounded-md transition-all ${viewMode === 'list' ? 'bg-brand-600 text-white shadow-lg' : 'text-gray-500 hover:text-gray-300'}`}><List className="w-4 h-4" /></button>
                            <button onClick={() => setViewMode('tree')} className={`p-1.5 rounded-md transition-all ${viewMode === 'tree' ? 'bg-brand-600 text-white shadow-lg' : 'text-gray-500 hover:text-gray-300'}`}><GitFork className="w-4 h-4" /></button>
                        </div>
                    </div>
                 </div>

                 {viewMode === 'list' ? (
                   // Layout Change: Fixed height 680px for right side
                   <div className="space-y-6 h-[555px] overflow-y-auto pr-2 custom-scrollbar">
                     {activeTask.bigShots.map((shot, idx) => {
                       const isFailed = shot.generationStatus?.toLowerCase().includes('failed');
                       const isStoryboardFailed = !shot.storyboardImageUrl && isFailed;
                       const isVideoFailed = shot.storyboardImageUrl && !shot.videoUrl && isFailed;
                       const isGenerating = shot.generationStatus && !shot.videoUrl && !shot.generationStatus.toLowerCase().includes('failed') && shot.generationStatus !== 'Idle' && shot.generationStatus !== 'Completed';
                       const progress = isGenerating ? getProgressFromStatus(shot.generationStatus) : 0;
                       
                       return (
                         <div 
                           key={shot.id} 
                           className="group relative bg-[#130b2e]/50 border border-white/5 rounded-2xl overflow-hidden hover:border-brand-500/40 transition-all duration-300 hover:shadow-2xl hover:shadow-brand-500/5 cursor-pointer"
                           onClick={() => setSelectedShotConfig({ id: shot.id, initialEdit: false })}
                         >
                            {/* Sequence List Item: Fixed Height Layout */}
                            <div className="flex flex-col md:flex-row">
                               {/* Image Container: Fixed Width 48 (192px) to save space */}
                               <div className="w-full md:w-48 h-40 md:h-auto md:min-h-[160px] bg-black relative overflow-hidden group/thumb flex-shrink-0">
                                 {shot.videoUrl ? (
                                   <video src={shot.videoUrl} className="w-full h-full object-cover opacity-80 group-hover/thumb:opacity-100 transition-opacity" muted loop onMouseEnter={(e) => e.currentTarget.play()} onMouseLeave={(e) => { e.currentTarget.pause(); e.currentTarget.currentTime = 0; }} />
                                 ) : shot.storyboardImageUrl ? (
                                   <img src={shot.storyboardImageUrl} className="w-full h-full object-cover opacity-60 group-hover/thumb:opacity-100 transition-opacity" alt="Storyboard" />
                                 ) : (
                                    <div className="w-full h-full flex flex-col items-center justify-center bg-gray-900/80 relative overflow-hidden group-hover:bg-gray-900 transition-colors">
                                        {shot.generationStatus ? (
                                            <>
                                                <div className="absolute inset-0 grid grid-cols-3 grid-rows-2 gap-0.5 opacity-10">
                                                    {[...Array(6)].map((_, i) => (
                                                        <div key={i} className="bg-brand-400 animate-pulse" style={{ animationDelay: `${i * 150}ms` }}></div>
                                                    ))}
                                                </div>
                                                <div className="relative z-10 flex flex-col items-center">
                                                    <div className="relative mb-3">
                                                        <div className="absolute inset-0 bg-brand-500 blur-xl opacity-20 animate-pulse"></div>
                                                        <Loader2 className="w-8 h-8 animate-spin text-brand-400 relative z-10" />
                                                    </div>
                                                    <span className="text-[10px] uppercase font-bold tracking-widest text-brand-200 animate-pulse px-2 py-1 bg-black/40 rounded border border-brand-500/20 backdrop-blur-sm">
                                                        {shot.generationStatus}
                                                    </span>
                                                </div>
                                            </>
                                        ) : (
                                            <>
                                                <ImageIcon className="w-8 h-8 opacity-20 text-gray-500" />
                                                <span className="text-[10px] uppercase font-bold tracking-widest text-gray-600 mt-2">No Image</span>
                                            </>
                                        )}
                                    </div>
                                 )}
                                 {shot.videoUrl && <div className="absolute top-2 left-2 bg-black/60 backdrop-blur-md p-1 rounded"><PlayCircle className="w-4 h-4 text-green-400" /></div>}
                                 {isFailed && <div className="absolute inset-0 bg-red-900/20 flex items-center justify-center"><AlertTriangle className="w-8 h-8 text-red-500" /></div>}
                               </div>
                               <div className="flex-1 p-6 flex flex-col justify-between min-w-0">
                                  <div className="relative pr-12">
                                    <div className="flex justify-between items-start mb-2">
                                      <div className="text-xs font-mono text-brand-400 font-bold">SEQUENCE #{idx + 1}</div>
                                      <div className={`text-[10px] px-2 py-0.5 rounded border ${shot.videoUrl ? 'bg-green-500/20 text-green-400 border-green-500/30' : isFailed ? 'bg-red-500/20 text-red-400 border-red-500/30' : isGenerating ? 'bg-brand-500/20 text-brand-300 border-brand-500/30 animate-pulse' : 'bg-white/5 text-gray-500 border-white/10'}`}>
                                        {shot.videoUrl ? t('COMPLETED') : isStoryboardFailed ? 'Storyboard Failed' : isVideoFailed ? 'Video Failed' : shot.generationStatus || t('IDLE')}
                                      </div>
                                    </div>
                                    
                                    {isGenerating && (
                                        <div className="mb-3 w-full max-w-[200px] h-1 bg-gray-800 rounded-full overflow-hidden">
                                            <div className="h-full bg-brand-500 animate-pulse transition-all duration-300" style={{ width: `${Math.max(5, progress)}%` }}></div>
                                        </div>
                                    )}

                                    {activeTask.mode === 'manual' && (
                                        <button 
                                            onClick={(e) => { e.stopPropagation(); handleDeleteShot(shot.id); }} 
                                            className="absolute top-1/2 -translate-y-1/2 right-0 p-3 bg-brand-900/80 hover:bg-red-600 text-gray-400 hover:text-white rounded-full opacity-0 group-hover:opacity-100 transition-all shadow-lg z-20 border border-white/10" 
                                            title={t('delete')}
                                        >
                                            <Trash2 className="w-5 h-5" />
                                        </button>
                                    )}
                                    <div className="flex gap-2 flex-wrap mb-4">
                                       {shot.charactersInvolved.map(name => (
                                          <span key={name} className="px-2 py-0.5 bg-yellow-500/10 text-yellow-400 border border-yellow-500/20 rounded-full text-[10px] font-bold">{name}</span>
                                       ))}
                                    </div>
                                    <div className="space-y-1">
                                      {shot.includedDialogues.slice(0, 2).map((line, i) => (
                                        <p key={i} className="text-sm text-gray-400 line-clamp-1 italic break-words break-all">"{line}"</p>
                                      ))}
                                      {shot.includedDialogues.length > 2 && <p className="text-[10px] text-gray-600">+ {shot.includedDialogues.length - 2} more lines</p>}
                                    </div>
                                  </div>
                                  <div className="mt-4 flex justify-between items-center">
                                      <div className="flex gap-2">
                                         <button onClick={(e) => { e.stopPropagation(); setSelectedShotConfig({ id: shot.id, initialEdit: true }); }} className="px-3 py-1.5 bg-brand-600/20 hover:bg-brand-600 text-brand-300 hover:text-white rounded-lg text-xs font-bold transition-all border border-brand-500/20">{t('edit')}</button>
                                         {shot.storyboardImageUrl && !shot.videoUrl && (
                                            <button 
                                                onClick={(e) => { e.stopPropagation(); regenerateSingleVideo(activeTask.id, shot.id); }} 
                                                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all border flex items-center gap-1 ${
                                                    isVideoFailed 
                                                    ? 'bg-red-600/20 hover:bg-red-600 text-red-400 hover:text-white border-red-500/20'
                                                    : 'bg-green-600/20 hover:bg-green-600 text-green-300 hover:text-white border-green-500/20'
                                                }`}
                                            >
                                                {isVideoFailed && <RotateCw className="w-3 h-3" />}
                                                {isVideoFailed ? "Retry" : t('generateVideo')}
                                            </button>
                                         )}
                                         {!shot.storyboardImageUrl && isStoryboardFailed && (
                                            <button 
                                                onClick={(e) => { e.stopPropagation(); regenerateSingleShot(activeTask.id, shot.id); }} 
                                                className="px-3 py-1.5 rounded-lg text-xs font-bold transition-all border flex items-center gap-1 bg-red-600/20 hover:bg-red-600 text-red-400 hover:text-white border-red-500/20"
                                            >
                                                <RotateCw className="w-3 h-3" />
                                                Retry Storyboard
                                            </button>
                                         )}
                                      </div>
                                      <div className="flex items-center gap-1 text-[10px] text-gray-500 group-hover:text-brand-400 transition-colors">
                                        {t('clickToZoom')} <ArrowLeft className="w-3 h-3 rotate-180" />
                                      </div>
                                  </div>
                               </div>
                            </div>
                         </div>
                       );
                     })}
                     {activeTask.bigShots.length === 0 && (
                        <div className="h-full flex flex-col items-center justify-center bg-gradient-to-b from-white/[0.02] to-transparent rounded-3xl border border-white/5">
                            <div className="w-24 h-24 bg-brand-900/20 rounded-full flex items-center justify-center mb-6 animate-pulse-slow">
                                <ImageIcon className="w-10 h-10 text-brand-500/40" />
                            </div>
                            <p className="text-gray-500 font-medium text-sm tracking-wide">{t('waitingScript')}</p>
                            <p className="text-gray-700 text-xs mt-2 max-w-xs text-center">Script generation and analysis must complete before sequences appear.</p>
                        </div>
                     )}
                   </div>
                 ) : (
                   <div className="relative p-12 bg-black/20 rounded-3xl border border-white/5 overflow-x-auto min-h-[600px] custom-scrollbar">
                      {/* Tree View Placeholder - In a real app we would use a layout library or SVG lines */}
                      <div className="flex flex-col items-center gap-12">
                         {activeTask.bigShots.map((shot, idx) => (
                            <div key={shot.id} className="relative flex flex-col items-center">
                               <div 
                                onClick={() => setSelectedShotConfig({ id: shot.id, initialEdit: false })}
                                className={`w-48 p-3 rounded-xl border cursor-pointer transition-all hover:scale-105 ${shot.videoUrl ? 'bg-green-600/20 border-green-500' : 'bg-brand-900/40 border-brand-700'}`}
                               >
                                  <div className="aspect-video bg-black/40 rounded-lg mb-2 overflow-hidden">
                                     {shot.storyboardImageUrl ? <img src={shot.storyboardImageUrl} className="w-full h-full object-cover" /> : <div className="w-full h-full flex items-center justify-center text-[10px] text-gray-700">SHOT {idx+1}</div>}
                                  </div>
                                  <div className="text-[10px] font-bold text-gray-400 line-clamp-1">{shot.includedDialogues[0] || 'No dialogue'}</div>
                               </div>
                               {idx < activeTask.bigShots.length - 1 && <div className="h-12 w-0.5 bg-brand-800/50 mt-2"></div>}
                            </div>
                         ))}
                      </div>
                   </div>
                 )}
              </div>
            </div>

            <div className="mt-8 pt-8 border-t border-white/5 animate-in fade-in slide-in-from-bottom-8 duration-500">
                <div className="flex items-center gap-2 mb-4">
                    <LayoutDashboard className="w-5 h-5 text-brand-400" />
                    <h3 className="text-lg font-bold text-white">{t('intermediateData')}</h3>
                </div>
                
                <div className="flex flex-col lg:flex-row h-[700px] bg-[#0a0a0a] border border-white/5 rounded-xl overflow-hidden backdrop-blur-sm">
                    {/* Left: JSON */}
                    <div className="flex-1 flex flex-col border-b lg:border-b-0 lg:border-r border-white/5 min-w-0">
                         {/* Header */}
                         <div className="flex items-center h-10 px-4 bg-white/[0.02] border-b border-white/5 gap-2">
                            <Code className="w-3.5 h-3.5 text-gray-500" />
                            <span className="text-[10px] font-bold uppercase tracking-wider text-gray-500">Raw JSON State</span>
                         </div>
                         {/* Content */}
                         <div className="flex-1 overflow-hidden relative">
                            <pre className="absolute inset-0 p-4 text-[10px] font-mono text-gray-500 overflow-auto custom-scrollbar leading-relaxed">
                                {JSON.stringify(activeTask, null, 2)}
                            </pre>
                         </div>
                    </div>

                    {/* Right: Log */}
                    <div className="flex-1 flex flex-col min-w-0">
                         {/* Header */}
                         <div className="flex items-center h-10 px-4 bg-white/[0.02] border-b border-white/5 gap-2">
                            <Terminal className="w-3.5 h-3.5 text-gray-500" />
                            <span className="text-[10px] font-bold uppercase tracking-wider text-gray-500">Process Log</span>
                         </div>
                         {/* Content */}
                         <div className="flex-1 overflow-y-auto p-4 custom-scrollbar font-mono text-xs space-y-6 text-gray-400">
                            
                            {/* Log Entry: Start */}
                            <div className="flex gap-2">
                                <span className="text-gray-600">[{new Date(activeTask.createdAt).toLocaleTimeString()}]</span>
                                <span className="text-green-500/80">Task Initialized: "{activeTask.name}" ({activeTask.mode})</span>
                            </div>

                            {/* Log Entry: Source Text */}
                            {activeTask.rawNovelText && (
                                <div className="animate-in fade-in slide-in-from-left-4 duration-300">
                                     {renderLogPrefix("Gemini", `Text Processing (${activeTask.sourceType})`)}
                                     
                                     {activeTask.mode === 'manual' && activeTask.sourceType === 'idea' && (
                                         <div className="ml-2 mb-2 flex gap-2 justify-end">
                                            {!isEditingSourceText ? (
                                                <button 
                                                    onClick={() => setIsEditingSourceText(true)} 
                                                    disabled={isExpandingStory}
                                                    className="flex items-center gap-1 px-2 py-0.5 bg-blue-600/20 hover:bg-blue-600/40 text-blue-400 rounded text-[10px] transition-colors border border-blue-500/20 disabled:opacity-50 disabled:cursor-not-allowed"
                                                >
                                                   <PenTool className="w-3 h-3" /> Edit
                                                </button>
                                            ) : (
                                                <button onClick={handleSaveSourceText} className="flex items-center gap-1 px-2 py-0.5 bg-green-600/20 hover:bg-green-600/40 text-green-400 rounded text-[10px] transition-colors border border-green-500/20">
                                                   <Save className="w-3 h-3" /> Save
                                                </button>
                                            )}
                                         </div>
                                     )}

                                     <div className="ml-2">
                                        {isEditingSourceText ? (
                                            <textarea 
                                                value={tempSourceText}
                                                onChange={(e) => setTempSourceText(e.target.value)}
                                                className="w-full h-96 bg-black/50 border border-brand-500/50 rounded p-3 text-gray-300 font-mono text-xs focus:outline-none"
                                            />
                                        ) : (
                                            <div className="p-3 bg-white/5 rounded border border-white/5 text-gray-400 whitespace-pre-wrap">
                                                {activeTask.rawNovelText}
                                            </div>
                                        )}
                                        
                                        {/* Creative Controls for Manual Mode + Idea */}
                                        {activeTask.mode === 'manual' && activeTask.sourceType === 'idea' && !isEditingSourceText && (
                                            <div className="mt-3 flex gap-3">
                                                <button 
                                                    onClick={handleContinueStory}
                                                    disabled={isExpandingStory}
                                                    className="flex items-center gap-2 px-3 py-1.5 bg-brand-600/20 hover:bg-brand-600/40 text-brand-300 border border-brand-500/30 rounded text-xs transition-colors disabled:opacity-50"
                                                >
                                                    {isExpandingStory ? <Loader2 className="w-3 h-3 animate-spin" /> : <ArrowRight className="w-3 h-3" />}
                                                    {isExpandingStory ? 'Expanding...' : 'Continue Writing'}
                                                </button>
                                                <button 
                                                    onClick={handleRewriteStory}
                                                    disabled={isExpandingStory}
                                                    className="flex items-center gap-2 px-3 py-1.5 bg-red-600/10 hover:bg-red-600/30 text-red-400 border border-red-500/20 rounded text-xs transition-colors disabled:opacity-50"
                                                >
                                                    <RefreshCw className="w-3 h-3" /> Rewrite
                                                </button>
                                            </div>
                                        )}
                                     </div>
                                </div>
                            )}

                            {/* Log Entry: Analysis */}
                            {activeTask.scriptAnalysis && (
                                <div className="animate-in fade-in slide-in-from-left-4 duration-300">
                                     {renderLogPrefix("Gemini", "Script Analysis & Structuring")}
                                     <div className="ml-2 space-y-2">
                                        <div className="text-yellow-600/80">{'>>>'} Generating Core Plot...</div>
                                        <div className="pl-2 border-l-2 border-yellow-600/20 text-gray-500">{activeTask.scriptAnalysis.corePlot}</div>
                                        <div className="text-yellow-600/80">{'>>>'} Analyzing Mood...</div>
                                        <div className="pl-2 border-l-2 border-yellow-600/20 text-gray-500">{activeTask.scriptAnalysis.mood}</div>
                                     </div>
                                </div>
                            )}

                            {/* Log Entry: Characters */}
                            {activeTask.characters.length > 0 && (
                                 <div className="animate-in fade-in slide-in-from-left-4 duration-300">
                                     {renderLogPrefix("NanoBanana", "Character Definitions & Prompts")}
                                     <div className="ml-2 space-y-2">
                                        {activeTask.characters.map((char, i) => (
                                            <div key={i} className="bg-white/5 p-2 rounded border border-white/5">
                                                <div className="text-green-500/80 font-bold">$ generate_character --name "{char.name}"</div>
                                                <div className="mt-1 text-gray-600">Visual Features: <span className="text-gray-400">{char.visualFeatures}</span></div>
                                                <div className="text-gray-600">Clothing: <span className="text-gray-400">{char.clothing}</span></div>
                                                {char.threeViewImg && <div className="text-blue-500/80 text-[10px] mt-1">{'>>>'} Image generated successfully</div>}
                                            </div>
                                        ))}
                                     </div>
                                 </div>
                            )}

                            {/* Log Entry: Shots */}
                            {activeTask.bigShots.length > 0 && (
                                <div className="animate-in fade-in slide-in-from-left-4 duration-300">
                                     {renderLogPrefix("NanoBanana / Sora", "Storyboard & Video Prompts")}
                                     <div className="ml-2 space-y-3">
                                        {activeTask.bigShots.map((shot, i) => (
                                            <div key={shot.id} className="border-l border-brand-500/20 pl-3 py-1">
                                                 <div className="text-purple-400 font-bold mb-1">Sequence #{i+1} [ID: {shot.id.substring(0,8)}]</div>
                                                 
                                                 {/* Storyboard Prompt */}
                                                 <div className="text-gray-600 mb-1">{'>>>'} NanoBanana Prompt:</div>
                                                 <div className="bg-black/40 p-2 rounded text-gray-500 text-[10px] mb-2 break-words whitespace-pre-wrap">
                                                    {shot.storyboardPrompt}
                                                 </div>
                                                 {shot.storyboardImageUrl && <div className="text-blue-500/80 text-[10px] mb-2">{'>>>'} Storyboard Image generated</div>}

                                                 {/* Sora Prompt */}
                                                 {(shot.soraPromptOptimized || shot.soraPrompt) && (
                                                    <>
                                                        <div className="text-gray-600 mb-1">{'>>>'} Sora 2.0 Prompt (Optimized):</div>
                                                        <div className="bg-black/40 p-2 rounded text-green-500/60 text-[10px] break-words whitespace-pre-wrap">
                                                            {shot.soraPromptOptimized || shot.soraPrompt}
                                                        </div>
                                                    </>
                                                 )}
                                                 {shot.videoUrl && <div className="text-green-500/80 text-[10px] mt-1">{'>>>'} Video generation completed</div>}
                                            </div>
                                        ))}
                                     </div>
                                </div>
                            )}
                            
                            {/* End of Log */}
                            <div className="flex gap-2 mt-4 animate-pulse ml-2">
                                <span className="w-2 h-4 bg-brand-500 block"></span>
                            </div>
                         </div>
                    </div>
                </div>
            </div>
          </div>
        )}
      </main>

      {/* Segment Content Modal */}
      {viewingSegment && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 backdrop-blur-sm p-4 animate-in fade-in">
           <div className="bg-brand-900 border border-brand-700 rounded-xl shadow-2xl w-full max-w-2xl h-[80vh] flex flex-col">
              <div className="p-4 border-b border-brand-800 flex justify-between items-center bg-brand-800/50">
                  <div className="flex items-center gap-2">
                    <BookOpen className="w-5 h-5 text-brand-400" />
                    <h2 className="text-lg font-bold">{viewingSegment.name}</h2>
                  </div>
                  <button onClick={() => setViewingSegment(null)} className="p-1 hover:bg-white/10 rounded-full transition-colors">
                    <XCircle className="w-5 h-5" />
                  </button>
              </div>
              <div className="flex-1 p-6 overflow-y-auto">
                 <p className="whitespace-pre-wrap text-gray-300 text-sm leading-relaxed font-serif">
                    {viewingSegment.content}
                 </p>
              </div>
           </div>
        </div>
      )}

      {/* Modals */}
      <NewTaskModal 
        isOpen={isNewTaskModalOpen} 
        onClose={() => setIsNewTaskModalOpen(false)} 
        onCreate={createTask} 
        hasApiKey={!!apiConfig.geminiKey} 
        onOpenSettings={() => setIsSettingsOpen(true)} 
        t={t} 
      />
      
      {activeTask && editingCharacter && (
        <EditCharacterModal 
          isOpen={!!editingCharacter} 
          onClose={() => setEditingCharacter(null)} 
          character={editingCharacter} 
          onSave={(updated, originalName) => {
             // Update character in list
             const updatedCharacters = activeTask.characters.map(c => c.name === originalName ? updated : c);
             
             // Update references in BigShots if name changed
             let updatedBigShots = activeTask.bigShots;
             if (originalName !== updated.name) {
                 updatedBigShots = activeTask.bigShots.map(shot => ({
                     ...shot,
                     charactersInvolved: shot.charactersInvolved.map(name => name === originalName ? updated.name : name)
                 }));
             }

             updateTask(activeTask.id, { 
                 characters: updatedCharacters,
                 bigShots: updatedBigShots
             });
          }}
          t={t}
        />
      )}

      {currentShotInTask && (
        <BigShotDetailModal 
          shot={currentShotInTask}
          allCharacters={activeTask?.characters || []}
          onClose={() => setSelectedShotConfig(null)}
          onRegenerateStoryboard={() => activeTask && regenerateSingleShot(activeTask.id, currentShotInTask.id)}
          onGenerateVideo={() => activeTask && regenerateSingleVideo(activeTask.id, currentShotInTask.id)}
          onSave={(updates) => activeTask && updateTask(activeTask.id, { bigShots: activeTask.bigShots.map(s => s.id === currentShotInTask.id ? { ...s, ...updates } : s) })}
          isManualMode={activeTask?.mode === 'manual'}
          initialIsEditing={selectedShotConfig?.initialEdit}
          t={t}
        />
      )}

      <ConfirmModal 
        isOpen={confirmModal.isOpen} 
        onClose={() => setConfirmModal({ ...confirmModal, isOpen: false })} 
        onConfirm={confirmModal.onConfirm} 
        title={confirmModal.title} 
        message={confirmModal.message} 
      />
      
      <ApiKeyModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        onSave={handleSaveConfig}
        initialConfig={apiConfig}
        t={t}
      />

      {lightboxImage && <ImageLightbox src={lightboxImage} onClose={() => setLightboxImage(null)} />}
    </div>
  );
}
