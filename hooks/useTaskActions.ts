import React, { useCallback, useRef } from 'react';
import { DramaTask, TaskStatus, ArtStyle, BigShot, Character, Language, TaskMode, ApiConfig, getProviderForStep, getModelForStep } from '../types';
import { continueStory, optimizeSoraPrompt, generateEpisodeSummary } from '../services/llmClient';
import { generateCharacterDesign, generateStoryboardImage } from '../services/mediaService';
import { storageService } from '../services/storageService';
import { api } from '../services/apiClient';
import { translations } from '../locales';
import { toast } from '../utils/toast';

export const useTaskActions = (
  tasks: DramaTask[],
  setTasks: React.Dispatch<React.SetStateAction<DramaTask[]>>,
  activeTaskId: string | null,
  setActiveTaskId: (id: string | null) => void,
  apiConfig: ApiConfig,
  updateTask: (taskId: string, updates: Partial<DramaTask>) => void,
  executeTaskStep: (taskId: string, targetStatus?: TaskStatus, taskOverrides?: Partial<DramaTask>) => Promise<void>,
  setConfirmModal: (modal: { isOpen: boolean; title: string; message: string; onConfirm: () => void; }) => void,
  setIsNewTaskModalOpen: (open: boolean) => void,
  lang: Language,
  t: (key: string) => string,
  setIsExpandingStory: (v: boolean) => void,
  setIsEditingSourceText: (v: boolean) => void,
  tempSourceText: string,
  uploadingCharName: string | null,
  setUploadingCharName: (v: string | null) => void,
  updateBigShotStatus: (taskId: string, shotId: string, statusText: string | undefined) => void
) => {
  const charFileInputRef = useRef<HTMLInputElement>(null);

  const activeTask = tasks.find(t => t.id === activeTaskId);

  const handleSaveSourceText = useCallback(() => {
    if (activeTask) {
      updateTask(activeTask.id, { rawNovelText: tempSourceText });
      setIsEditingSourceText(false);
    }
  }, [activeTask, tempSourceText, updateTask, setIsEditingSourceText]);

  const handleContinueStory = useCallback(async () => {
    if (!activeTask || !activeTask.rawNovelText) return;
    setIsExpandingStory(true);
    try {
        const llmProvider = getProviderForStep(apiConfig, 'preprocessing')!;
        const llmModel = getModelForStep(apiConfig, 'preprocessing')!;
        let newText = '';
        for await (const chunk of continueStory(llmProvider, llmModel, activeTask.rawNovelText)) {
            newText += chunk;
            updateTask(activeTask.id, { rawNovelText: activeTask.rawNovelText + "\n\n" + newText });
        }
    } catch (e) {
        console.error(e);
        toast.error("Failed to expand story");
    } finally {
        setIsExpandingStory(false);
    }
  }, [activeTask, apiConfig, updateTask, setIsExpandingStory]);

  const handleRewriteStory = useCallback(() => {
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
  }, [activeTask, t, setConfirmModal, executeTaskStep]);

  const deleteTask = useCallback((taskId: string) => {
    setConfirmModal({
        isOpen: true,
        title: translations[lang].deleteProject || "Delete Project",
        message: translations[lang].confirmDeleteProject || "Are you sure?",
        onConfirm: () => {
            setTasks(prev => prev.filter(t => t.id !== taskId));
            if (activeTaskId === taskId) setActiveTaskId(null);
        }
    });
  }, [lang, activeTaskId, setTasks, setActiveTaskId, setConfirmModal]);

  const exportProject = useCallback((taskId: string) => {
    const task = tasks.find(t => t.id === taskId);
    if (!task) return;
    storageService.exportToFile([task], `dramaforge_${task.name}_${Date.now()}.json`);
  }, [tasks]);

  const exportAllProjects = useCallback(() => {
    storageService.exportToFile(tasks, `dramaforge_all_projects_${Date.now()}.json`);
  }, [tasks]);

  const handleImportProject = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    
    try {
      const importedTasks = await storageService.importFromFile(file);
      
      const tasksWithNewIds = importedTasks.map((task: DramaTask) => ({
        ...task,
        id: `imported_${Date.now()}_${Math.random().toString(36).slice(2)}`
      }));
      
      setTasks(prev => [...prev, ...tasksWithNewIds]);
      toast.success(`${tasksWithNewIds.length} ${t('projectsImported') || "projects imported successfully!"}`);
    } catch (error) {
      console.error("Import failed:", error);
      toast.error(t('importFailed') || "Failed to import project");
    }
    
    if (event.target) {
      event.target.value = '';
    }
  }, [setTasks, t]);

  const createTask = useCallback((name: string, style: ArtStyle, language: Language, content: string, mode: TaskMode, sourceType: 'novel' | 'idea') => {
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
      const overrides: Partial<DramaTask> = {
        rawNovelText: sourceType === 'novel' ? content : '',
        originalIdea: sourceType === 'idea' ? content : undefined,
      };
      setTimeout(() => executeTaskStep(newTask.id, TaskStatus.PREPROCESSING, overrides), 100);
    }
  }, [setTasks, setIsNewTaskModalOpen, executeTaskStep]);

  const handleAddCharacter = useCallback(() => {
     if (!activeTask) return;
     const newChar: Character = {
         name: `New Character ${activeTask.characters.length + 1}`,
         visualFeatures: "Description here...",
         clothing: "Clothing here...",
         voice: "Voice description..."
     };
     updateTask(activeTask.id, { characters: [...activeTask.characters, newChar] });
  }, [activeTask, updateTask]);

  const handleDeleteCharacter = useCallback((charName: string) => {
     if (!activeTask) return;
     setConfirmModal({
         isOpen: true,
         title: t('delete'),
         message: t('confirmDelete'),
         onConfirm: () => {
             updateTask(activeTask.id, { characters: activeTask.characters.filter(c => c.name !== charName) });
         }
     });
  }, [activeTask, t, setConfirmModal, updateTask]);

  const handleUploadReferenceTrigger = useCallback((charName: string) => {
      setUploadingCharName(charName);
      charFileInputRef.current?.click();
  }, []);

  const handleRefFileChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file && uploadingCharName && activeTask) {
          try {
              // 上传到后端拿真实 URL（/files/xxx），不能用浏览器本地 blob: URL：
              // 后端下载不到 blob URL（参考图静默失效），且刷新后 blob 死链。
              const { url } = await api.uploadImage(file);
              updateTask(activeTask.id, {
                  characters: activeTask.characters.map(c => c.name === uploadingCharName ? { ...c, referenceImage: url } : c)
              });
          } catch (err) {
              // 上传失败：不写入死链，保留原参考图
              console.error('Failed to upload reference image:', err);
              toast.error(t('uploadReferenceFailed') || 'Failed to upload reference image');
          } finally {
              setUploadingCharName(null);
              if (charFileInputRef.current) charFileInputRef.current.value = '';
          }
      }
  }, [uploadingCharName, activeTask, updateTask, t]);

  const handleAddShot = useCallback(() => {
      if (!activeTask) return;
      const newShot: BigShot = {
          id: `shot_${Date.now()}`,
          includedDialogues: ["New dialogue..."],
          storyboardPrompt: "Describe scene here...",
          soraPrompt: "Sora prompt here...",
          charactersInvolved: []
      };
      updateTask(activeTask.id, { bigShots: [...activeTask.bigShots, newShot] });
  }, [activeTask, updateTask]);

  const handleDeleteShot = useCallback((shotId: string) => {
      if (!activeTask) return;
      setConfirmModal({
          isOpen: true,
          title: t('delete'),
          message: t('confirmDelete'),
          onConfirm: () => {
              updateTask(activeTask.id, { bigShots: activeTask.bigShots.filter(s => s.id !== shotId) });
          }
      });
  }, [activeTask, t, setConfirmModal, updateTask]);

  const regenerateSingleCharacter = useCallback(async (taskId: string, charName: string) => {
    const task = tasks.find(t => t.id === taskId);
    if (!task) return;
    updateTask(taskId, { characters: task.characters.map(c => c.name === charName ? { ...c, generationStatus: 'Regenerating...' } : c) });
    try {
      const imageProvider = getProviderForStep(apiConfig, 'characterDesign')!;
      const imageModel = getModelForStep(apiConfig, 'characterDesign')!;
      const imgUrl = await generateCharacterDesign(
          task.characters.find(c => c.name === charName)!, 
          task.style, 
          task.language,
          imageProvider,
          imageModel
      );
      updateTask(taskId, { characters: task.characters.map(c => c.name === charName ? { ...c, threeViewImg: imgUrl, generationStatus: undefined } : c) });
    } catch (e: any) {
        console.error(e);
        updateTask(taskId, { characters: task.characters.map(c => c.name === charName ? { ...c, generationStatus: undefined } : c) });
        toast.error("Failed to regenerate character: " + e.message);
    }
  }, [tasks, apiConfig, updateTask]);

  const regenerateSingleShot = useCallback(async (taskId: string, shotId: string) => {
    const task = tasks.find(t => t.id === taskId);
    if (!task) return;
    const shot = task.bigShots.find(s => s.id === shotId);
    if (!shot) return;
    updateBigShotStatus(taskId, shotId, "Generating Storyboard...");
    try {
        const imageProvider = getProviderForStep(apiConfig, 'storyboarding')!;
        const imageModel = getModelForStep(apiConfig, 'storyboarding')!;
        const involvedCharacters = task.characters.filter(c => shot.charactersInvolved?.some(name => name.toLowerCase().includes(c.name.toLowerCase())));
        const characterContext = involvedCharacters.map(c => `${c.name}: ${c.visualFeatures}`).join('; ');
        const img = await generateStoryboardImage(
            shot.storyboardPrompt, 
            task.style, 
            task.language, 
            characterContext, 
            involvedCharacters.map(c => c.threeViewImg).filter(Boolean) as string[],
            imageProvider,
            imageModel
        );
        updateTask(taskId, { bigShots: task.bigShots.map(s => s.id === shotId ? { ...s, storyboardImageUrl: img, generationStatus: undefined } : s) });
    } catch (e: any) {
        console.error(e);
        updateBigShotStatus(taskId, shotId, "Regeneration Failed");
        setTimeout(() => updateBigShotStatus(taskId, shotId, undefined), 3000);
    }
  }, [tasks, apiConfig, updateTask, updateBigShotStatus]);

  const regenerateSinglePrompt = useCallback(async (taskId: string, shotId: string) => {
    const task = tasks.find(t => t.id === taskId);
    if (!task) return;
    const shot = task.bigShots.find(s => s.id === shotId);
    if (!shot) return;
    
    const originalPrompt = shot.soraPromptOriginal || shot.soraPrompt || "Scene";
    
    updateBigShotStatus(taskId, shotId, "Optimizing Prompt...");
    try {
        const llmProvider = getProviderForStep(apiConfig, 'promptOptimization')!;
        const llmModel = getModelForStep(apiConfig, 'promptOptimization')!;
        let optimized = '';
        for await (const chunk of optimizeSoraPrompt(
            llmProvider, 
            llmModel,
            originalPrompt, 
            task.style, 
            task.language,
            task.visualSignature,
            undefined,
            task.characters
        )) {
            optimized += chunk;
            updateBigShotStatus(taskId, shotId, "Optimizing: " + optimized.slice(-50) + "...");
        }
        updateTask(taskId, { 
            bigShots: task.bigShots.map(s => s.id === shotId ? { 
                ...s, 
                soraPromptOriginal: s.soraPromptOriginal || s.soraPrompt,
                soraPrompt: optimized,
                soraPromptOptimized: optimized, 
                generationStatus: undefined 
            } : s) 
        });
    } catch (e: any) {
        console.error(e);
        updateBigShotStatus(taskId, shotId, "Prompt Optimization Failed: " + (e.message || "Unknown error"));
    }
  }, [tasks, apiConfig, updateTask, updateBigShotStatus]);

  const handleGenerateEpisodeSummary = useCallback(async (targetTaskId?: string) => {
    const task = targetTaskId ? tasks.find(t => t.id === targetTaskId) : activeTask;
    if (!task || !task.previousEpisodeId) return;
    const prevTask = tasks.find(t => t.id === task.previousEpisodeId);
    if (!prevTask) return;

    updateTask(task.id, { stepStatus: 'processing' });
    try {
      const llmProvider = getProviderForStep(apiConfig, 'preprocessing')!;
      const llmModel = getModelForStep(apiConfig, 'preprocessing')!;
      let summary = '';
      const analysisStr = prevTask.scriptAnalysis ? JSON.stringify(prevTask.scriptAnalysis) : '';
      for await (const chunk of generateEpisodeSummary(llmProvider, llmModel, prevTask.rawNovelText, analysisStr)) {
        summary += chunk;
      }
      updateTask(task.id, {
        episodeSummary: summary,
        inheritedCharacters: prevTask.characters.filter(c => !!c.threeViewImg),
        inheritedProps: prevTask.props,
        inheritedSceneAssets: prevTask.sceneAssets,
        stepStatus: 'idle',
      });
    } catch (e: any) {
      console.error(e);
      updateTask(task.id, { stepStatus: 'idle' });
    }
  }, [activeTask, tasks, apiConfig, updateTask]);

  const handleInheritFromPreviousEpisode = useCallback((targetTaskId?: string) => {
    const task = targetTaskId ? tasks.find(t => t.id === targetTaskId) : activeTask;
    if (!task || !task.inheritedCharacters) return;
    const existingNames = task.characters.map(c => c.name.toLowerCase());
    const newChars = task.inheritedCharacters.filter(
      c => !existingNames.includes(c.name.toLowerCase())
    );
    if (newChars.length > 0) {
      updateTask(task.id, {
        characters: [...task.characters, ...newChars],
      });
    }
  }, [activeTask, tasks, updateTask]);

  const handleCreateNextEpisode = useCallback(() => {
    if (!activeTask) return;
    const newTask: DramaTask = {
      id: crypto.randomUUID(),
      name: activeTask.name + ' - Episode ' + (tasks.filter(t => t.previousEpisodeId === activeTask.id || t.id === activeTask.id).length + 1),
      style: activeTask.style,
      language: activeTask.language,
      mode: activeTask.mode,
      sourceType: 'idea',
      createdAt: Date.now(),
      previousEpisodeId: activeTask.id,
      visualSignature: activeTask.visualSignature,
      inheritedCharacters: activeTask.characters.filter(c => !!c.threeViewImg),
      inheritedProps: activeTask.props,
      inheritedSceneAssets: activeTask.sceneAssets,
      status: TaskStatus.IDLE,
      stepStatus: 'idle',
      progress: 0,
      rawNovelText: '',
      characters: [],
      bigShots: [],
    };
    setTasks(prev => [newTask, ...prev]);
    setActiveTaskId(newTask.id);
  }, [activeTask, tasks, setTasks, setActiveTaskId]);

  return {
    charFileInputRef,
    uploadingCharName,
    handleSaveSourceText,
    handleContinueStory,
    handleRewriteStory,
    deleteTask,
    exportProject,
    exportAllProjects,
    handleImportProject,
    createTask,
    handleAddCharacter,
    handleDeleteCharacter,
    handleUploadReferenceTrigger,
    handleRefFileChange,
    handleAddShot,
    handleDeleteShot,
    regenerateSingleCharacter,
    regenerateSingleShot,
    regenerateSinglePrompt,
    handleGenerateEpisodeSummary,
    handleInheritFromPreviousEpisode,
    handleCreateNextEpisode
  };
};
