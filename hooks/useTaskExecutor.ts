import React, { useCallback, useRef } from 'react';
import axios from 'axios';
import { DramaTask, TaskStatus, BigShot, Character, Prop, SceneAsset, ProcessedSegment, ApiConfig, getProviderForStep, getModelForStep, getBindingForStep, LOGICAL_STEPS } from '../types';
import { generateScriptFromNovel, optimizeSoraPrompt, expandIdeaToStory, continueStory, preprocessNovel } from '../services/llmClient';
import { generateCharacterDesign, generateStoryboardImage, generatePropImage } from '../services/mediaService';
import { playSuccessSound, playErrorSound } from '../utils/helpers';

// LOGICAL_STEPS 已收敛到 types.ts 单一事实源（8 步，含 PROP_DESIGN/SCENE_DESIGN），此处不再重复定义。

// 视频生成已移至画布手动操作，不再在任务流水线中自动执行

export const useTaskExecutor = (
  tasks: DramaTask[],
  setTasks: React.Dispatch<React.SetStateAction<DramaTask[]>>,
  apiConfig: ApiConfig,
  updateTask: (taskId: string, updates: Partial<DramaTask>) => void
) => {
  const abortControllers = useRef<Record<string, AbortController>>({});
  const tasksRef = useRef(tasks);
  tasksRef.current = tasks;
  const apiConfigRef = useRef(apiConfig);
  apiConfigRef.current = apiConfig;

  const updateBigShotStatus = useCallback((taskId: string, shotId: string, statusText: string | undefined) => {
    setTasks(prev => prev.map(t => t.id === taskId ? { ...t, bigShots: t.bigShots.map(s => s.id === shotId ? { ...s, generationStatus: statusText } : s) } : t));
  }, [setTasks]);

  const cancelTask = useCallback((taskId: string) => {
    if (abortControllers.current[taskId]) {
      abortControllers.current[taskId].abort();
      delete abortControllers.current[taskId];
    }
    updateTask(taskId, { status: TaskStatus.CANCELLED, stepStatus: 'completed' });
  }, [updateTask]);

  const executeTaskStep = useCallback(async (taskId: string, targetStatus?: TaskStatus, taskOverrides?: Partial<DramaTask>) => {
    let task = tasksRef.current.find(t => t.id === taskId);
    if (!task) return;
    if (taskOverrides) {
      task = { ...task, ...taskOverrides };
    }
    let stepToRun = targetStatus || task.status;
    if (stepToRun === TaskStatus.IDLE) stepToRun = TaskStatus.PREPROCESSING;

    console.log('[TaskExecutor] task state:', {
      id: task.id,
      sourceType: task.sourceType,
      originalIdea: task.originalIdea?.slice(0, 100),
      rawNovelText: task.rawNovelText?.slice(0, 100),
      status: task.status,
    });

    const cfg = apiConfigRef.current;
    const TASK_STATUS_TO_STEP: Record<string, string> = {
      PREPROCESSING: 'preprocessing',
      SCRIPT_GENERATION: 'scriptGeneration',
      CHARACTER_DESIGN: 'characterDesign',
      PROP_DESIGN: 'characterDesign',
      SCENE_DESIGN: 'storyboarding',
      STORYBOARDING: 'storyboarding',
      PROMPT_OPTIMIZATION: 'promptOptimization',
    };
    const stepKey = TASK_STATUS_TO_STEP[stepToRun] || '';
    const stepBinding = stepKey ? getBindingForStep(cfg, stepKey as any) : undefined;
    const stepModel = stepKey ? getModelForStep(cfg, stepKey as any) : undefined;
    const stepProvider = stepKey ? getProviderForStep(cfg, stepKey as any) : undefined;
    console.log('[TaskExecutor] Step:', stepToRun, '→ stepKey:', stepKey, {
      stepBinding: stepBinding ? { step: stepBinding.step, modelId: stepBinding.modelId } : null,
      model: stepModel ? { id: stepModel.id, name: stepModel.modelName, format: stepModel.apiFormat, path: stepModel.apiPath, providerId: stepModel.providerId } : null,
      provider: stepProvider ? { id: stepProvider.id, name: stepProvider.name, type: stepProvider.type, baseUrl: stepProvider.baseUrl, hasApiKey: !!stepProvider.apiKey } : null,
      allProviders: cfg.providers.map(p => ({ id: p.id, name: p.name, type: p.type, baseUrl: p.baseUrl, hasApiKey: !!p.apiKey })),
      modelBindings: cfg.modelBindings,
    });
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

                console.log('[PREPROCESSING] sourceType:', task.sourceType, 'originalIdea:', task.originalIdea?.slice(0, 80), 'rawNovelText:', task.rawNovelText?.slice(0, 80));

                if (task.sourceType === 'idea') {
                    if (!task.originalIdea) {
                        throw new Error('sourceType is "idea" but originalIdea is empty. The user input was not saved correctly.');
                    }
                    const llmProvider = getProviderForStep(apiConfigRef.current, 'preprocessing')!;
                    const llmModel = getModelForStep(apiConfigRef.current, 'preprocessing')!;
                    console.log('[PREPROCESSING] Calling expandIdeaToStory, idea length:', task.originalIdea.length);
                    processedText = '';
                    for await (const chunk of expandIdeaToStory(llmProvider, llmModel, task.originalIdea, task.language, signal)) {
                        processedText += chunk;
                        updateTask(taskId, { rawNovelText: processedText });
                    }
                    console.log('[PREPROCESSING] expandIdeaToStory done, result length:', processedText.length);
                } 
                
                const TEXT_SEGMENT_THRESHOLD = 20000;
                
                const fileSplitPattern = /====FILE_START: (.*?)====([\s\S]*?)====FILE_END====/g;
                let match;
                let hasFileMarkers = false;
                
                while ((match = fileSplitPattern.exec(processedText)) !== null) {
                    hasFileMarkers = true;
                    segments.push({
                        id: `seg_${Date.now()}_${segments.length}`,
                        name: match[1],
                        content: match[2].trim(),
                        index: segments.length
                    });
                }

                if (!hasFileMarkers) {
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
                const llmProvider = getProviderForStep(apiConfigRef.current, 'scriptGeneration')!;
                const llmModel = getModelForStep(apiConfigRef.current, 'scriptGeneration')!;
                console.log('[SCRIPT_GENERATION] rawNovelText length:', task.rawNovelText?.length, 'preview:', task.rawNovelText?.slice(0, 80));
                const shotIdMap = new Map<string, string>();
                const propIdMap = new Map<string, string>();
                const sceneIdMap = new Map<string, string>();
                let streamFirstYield = true;
                // 用闭包变量记录 props/scenes 的最终结果，避免流式 yield 时被空数组覆盖
                let finalProps: Prop[] = [];
                let finalScenes: SceneAsset[] = [];
                for await (const partial of generateScriptFromNovel(llmProvider, llmModel, task.rawNovelText, task.style, task.language, signal)) {
                    const initializedBigShots: BigShot[] = (partial.bigShots || []).map((shot: any, idx: number) => {
                        const key = `${shot.id || 'unknown'}_${idx}`;
                        if (!shotIdMap.has(key)) {
                            shotIdMap.set(key, `shot_${Date.now()}_${idx}_${Math.random().toString(36).slice(2)}`);
                        }
                        return { ...shot, id: shotIdMap.get(key)! };
                    });

                    // 从 LLM 输出的 props 提取（带 id 重写） — 保留已有 props 防止流式覆盖
                    const newProps: Prop[] = (partial.props || []).map((p: any, idx: number) => {
                        const key = `${p.id || 'unknown'}_${idx}`;
                        if (!propIdMap.has(key)) {
                            propIdMap.set(key, `prop_${Date.now()}_${idx}_${Math.random().toString(36).slice(2)}`);
                        }
                        // 如果之前已有同名 prop（按 name+ownerCharacter 去重），保留 imageUrl/状态
                        const newId = propIdMap.get(key)!;
                        const existing = finalProps.find(
                            (fp) => fp.name === p.name && (fp.ownerCharacter || '') === (p.ownerCharacter || '')
                        );
                        if (existing) {
                            return { ...p, id: existing.id, imageUrl: existing.imageUrl, generationStatus: existing.generationStatus };
                        }
                        return { ...p, id: newId };
                    });
                    // 合并：保留已有 props 的 imageUrl，仅追加新出现的
                    if (newProps.length > 0) {
                        finalProps = newProps;
                    } else if (streamFirstYield) {
                        // 第一次 yield 时 LLM 可能还没输出 props，保留任务上原有的
                        finalProps = (task.props || []).slice();
                    }

                    // 从 LLM 输出的 script 数组中的 location/environment/time 提取场景资产
                    // 若 LLM 也输出了独立 sceneAsset 数组，优先使用
                    const newScenes: SceneAsset[] = (partial.sceneAssets && partial.sceneAssets.length > 0)
                        ? (partial.sceneAssets || []).map((s: any, idx: number) => {
                            const key = `${s.id || idx}`;
                            if (!sceneIdMap.has(key)) {
                                sceneIdMap.set(key, `scene_${Date.now()}_${idx}_${Math.random().toString(36).slice(2)}`);
                            }
                            return { ...s, id: sceneIdMap.get(key)! };
                        })
                        : (partial.script || []).map((sc: any, idx: number) => {
                            const key = `${sc.location || 'unknown'}_${idx}`;
                            if (!sceneIdMap.has(key)) {
                                sceneIdMap.set(key, `scene_${Date.now()}_${idx}_${Math.random().toString(36).slice(2)}`);
                            }
                            return {
                                worldPositioning: sc.location || '',
                                geography: sc.environment || '',
                                mainStructure: sc.environment || '',
                                extendedSpace: '',
                                naturalAndDistant: '',
                                lightAndColor: '',
                                techSpec: '',
                                qualitySuffix: '真人写实风格，电影画质，影视级真实材质，8K超精细，光影真实自然，物理准确的光照和阴影，材质纹理清晰可触',
                                ambientCharacters: '',
                                time: sc.time || '',
                                location: sc.location || '',
                                prompt: `${sc.location || ''} ${sc.time || ''} ${sc.environment || ''} 白色/浅灰背景，柔和顶光，材质纹理清晰可触，8K超精细，电影级静物摄影`,
                                id: sceneIdMap.get(key)!,
                            } as SceneAsset;
                        });
                    if (newScenes.length > 0) {
                        // 保留已有 sceneAssets 的 imageUrl
                        finalScenes = newScenes.map((s) => {
                            const existing = (task.sceneAssets || []).find(
                                (fs) => (fs.mainStructure || fs.id) === (s.mainStructure || s.id) ||
                                         (fs.location || '') === (s.location || '')
                            );
                            if (existing) {
                                return { ...s, id: existing.id, imageUrl: existing.imageUrl, generationStatus: existing.generationStatus };
                            }
                            return s;
                        });
                    } else if (streamFirstYield) {
                        finalScenes = (task.sceneAssets || []).slice();
                    }

                    updateTask(taskId, {
                        scriptAnalysis: partial.analysis,
                        visualSignature: partial.visualSignature,
                        sequences: partial.sequences,
                        soundDesign: partial.soundDesign,
                        rhythmAnalysis: partial.rhythmAnalysis,
                        worldAnchors: partial.worldAnchors,
                        dialogueList: partial.dialogueList,
                        vfxBudget: partial.vfxBudget,
                        characters: partial.characters || [],
                        props: finalProps,
                        sceneAssets: finalScenes,
                        script: partial.script || [],
                        bigShots: initializedBigShots,
                        progress: 40,
                        stepStatus: 'processing'
                    });
                    streamFirstYield = false;
                }
                updateTask(taskId, { progress: 40, stepStatus: 'completed' });
                break;
            }
            case TaskStatus.CHARACTER_DESIGN: {
                const imageProvider = getProviderForStep(apiConfigRef.current, 'characterDesign')!;
                const imageModel = getModelForStep(apiConfigRef.current, 'characterDesign')!;
                const BATCH_SIZE = 3;
                let currentCharacters = [...task.characters];
                const indicesToGenerate = currentCharacters
                    .map((c, idx) => (!c.threeViewImg ? idx : -1))
                    .filter(idx => idx !== -1);
                
                let failedCount = 0;
                let successCount = 0;
                
                for (let i = 0; i < indicesToGenerate.length; i += BATCH_SIZE) {
                    if (signal.aborted) break;
                    
                    const batchIndices = indicesToGenerate.slice(i, i + BATCH_SIZE);
                    
                    setTasks(prev => {
                        const t = prev.find(p => p.id === taskId);
                        if (!t) return prev;
                        const newChars = [...t.characters];
                        batchIndices.forEach(idx => {
                           newChars[idx] = { ...newChars[idx], generationStatus: 'Generating...' };
                        });
                        return prev.map(p => p.id === taskId ? { ...p, characters: newChars } : p);
                    });

                    await Promise.all(batchIndices.map(async (charIndex) => {
                        try {
                             const charToGen = currentCharacters[charIndex];
                             const imgUrl = await generateCharacterDesign(charToGen, task.style, task.language, imageProvider, imageModel, signal);
                             
                             setTasks(prev => {
                                const t = prev.find(p => p.id === taskId);
                                if (!t) return prev;
                                const newChars = [...t.characters];
                                newChars[charIndex] = { ...newChars[charIndex], threeViewImg: imgUrl, generationStatus: undefined };
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
                                newChars[charIndex] = { ...newChars[charIndex], generationStatus: undefined };
                                return prev.map(p => p.id === taskId ? { ...p, characters: newChars } : p);
                             });
                        }
                    }));
                }
                
                if (indicesToGenerate.length > 0 && failedCount === indicesToGenerate.length) {
                    throw new Error(`Character design failed: All ${failedCount} characters failed to generate`);
                }
                
                if (failedCount > 0) {
                    console.warn(`Character design completed with ${successCount} successes and ${failedCount} failures`);
                }
                
                updateTask(taskId, { progress: 60, stepStatus: 'completed' });
                break;
            }
            case TaskStatus.PROP_DESIGN: {
                const imageProvider = getProviderForStep(apiConfigRef.current, 'characterDesign')!;
                const imageModel = getModelForStep(apiConfigRef.current, 'characterDesign')!;
                const currentProps = task.props || [];
                if (currentProps.length === 0) {
                    updateTask(taskId, { progress: 65, stepStatus: 'completed' });
                    break;
                }
                const BATCH_SIZE = 3;
                const indicesToGenerate = currentProps
                    .map((p, idx) => (!p.imageUrl ? idx : -1))
                    .filter(idx => idx !== -1);

                let failedCount = 0;
                let successCount = 0;

                for (let i = 0; i < indicesToGenerate.length; i += BATCH_SIZE) {
                    if (signal.aborted) break;
                    const batchIndices = indicesToGenerate.slice(i, i + BATCH_SIZE);

                    setTasks(prev => {
                        const t = prev.find(p => p.id === taskId);
                        if (!t) return prev;
                        const newProps = [...(t.props || [])];
                        batchIndices.forEach(idx => {
                            newProps[idx] = { ...newProps[idx], generationStatus: 'Generating...' };
                        });
                        return prev.map(p => p.id === taskId ? { ...p, props: newProps } : p);
                    });

                    await Promise.all(batchIndices.map(async (propIndex) => {
                        try {
                            const prop = currentProps[propIndex];
                            const imgUrl = await generatePropImage(prop.prompt, imageProvider, imageModel, signal);
                            setTasks(prev => {
                                const t = prev.find(p => p.id === taskId);
                                if (!t) return prev;
                                const newProps = [...(t.props || [])];
                                newProps[propIndex] = { ...newProps[propIndex], imageUrl: imgUrl, generationStatus: undefined };
                                return prev.map(p => p.id === taskId ? { ...p, props: newProps } : p);
                            });
                            successCount++;
                        } catch (e: any) {
                            console.error(`Prop ${propIndex} failed`, e);
                            failedCount++;
                            setTasks(prev => {
                                const t = prev.find(p => p.id === taskId);
                                if (!t) return prev;
                                const newProps = [...(t.props || [])];
                                newProps[propIndex] = { ...newProps[propIndex], generationStatus: undefined };
                                return prev.map(p => p.id === taskId ? { ...p, props: newProps } : p);
                            });
                        }
                    }));
                }

                if (indicesToGenerate.length > 0 && failedCount === indicesToGenerate.length) {
                    throw new Error(`Prop design failed: All ${failedCount} props failed to generate`);
                }
                if (failedCount > 0) {
                    console.warn(`Prop design completed with ${successCount} successes and ${failedCount} failures`);
                }
                updateTask(taskId, { progress: 68, stepStatus: 'completed' });
                break;
            }
            case TaskStatus.SCENE_DESIGN: {
                const imageProvider = getProviderForStep(apiConfigRef.current, 'storyboarding')!;
                const imageModel = getModelForStep(apiConfigRef.current, 'storyboarding')!;
                const currentScenes = task.sceneAssets || [];
                if (currentScenes.length === 0) {
                    updateTask(taskId, { progress: 72, stepStatus: 'completed' });
                    break;
                }
                const BATCH_SIZE = 3;
                const indicesToGenerate = currentScenes
                    .map((s, idx) => (!s.imageUrl ? idx : -1))
                    .filter(idx => idx !== -1);

                let failedCount = 0;
                let successCount = 0;

                for (let i = 0; i < indicesToGenerate.length; i += BATCH_SIZE) {
                    if (signal.aborted) break;
                    const batchIndices = indicesToGenerate.slice(i, i + BATCH_SIZE);

                    setTasks(prev => {
                        const t = prev.find(p => p.id === taskId);
                        if (!t) return prev;
                        const newScenes = [...(t.sceneAssets || [])];
                        batchIndices.forEach(idx => {
                            newScenes[idx] = { ...newScenes[idx], generationStatus: 'Generating...' };
                        });
                        return prev.map(p => p.id === taskId ? { ...p, sceneAssets: newScenes } : p);
                    });

                    await Promise.all(batchIndices.map(async (sceneIndex) => {
                        try {
                            const scene = currentScenes[sceneIndex];
                            const imgUrl = await generatePropImage(scene.prompt, imageProvider, imageModel, signal);
                            setTasks(prev => {
                                const t = prev.find(p => p.id === taskId);
                                if (!t) return prev;
                                const newScenes = [...(t.sceneAssets || [])];
                                newScenes[sceneIndex] = { ...newScenes[sceneIndex], imageUrl: imgUrl, generationStatus: undefined };
                                return prev.map(p => p.id === taskId ? { ...p, sceneAssets: newScenes } : p);
                            });
                            successCount++;
                        } catch (e: any) {
                            console.error(`Scene ${sceneIndex} failed`, e);
                            failedCount++;
                            setTasks(prev => {
                                const t = prev.find(p => p.id === taskId);
                                if (!t) return prev;
                                const newScenes = [...(t.sceneAssets || [])];
                                newScenes[sceneIndex] = { ...newScenes[sceneIndex], generationStatus: undefined };
                                return prev.map(p => p.id === taskId ? { ...p, sceneAssets: newScenes } : p);
                            });
                        }
                    }));
                }

                if (indicesToGenerate.length > 0 && failedCount === indicesToGenerate.length) {
                    throw new Error(`Scene design failed: All ${failedCount} scenes failed to generate`);
                }
                if (failedCount > 0) {
                    console.warn(`Scene design completed with ${successCount} successes and ${failedCount} failures`);
                }
                updateTask(taskId, { progress: 75, stepStatus: 'completed' });
                break;
            }
            case TaskStatus.STORYBOARDING: {
                const imageProvider = getProviderForStep(apiConfigRef.current, 'storyboarding')!;
                const imageModel = getModelForStep(apiConfigRef.current, 'storyboarding')!;
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
                            
                            const img = await generateStoryboardImage(shot.storyboardPrompt, task.style, task.language, context, involvedCharacters.map(c => c.threeViewImg).filter(Boolean) as string[], imageProvider, imageModel, signal);
                            
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
                
                if (indicesToGenerate.length > 0 && failedCount === indicesToGenerate.length) {
                    throw new Error(`Storyboard generation failed: All ${failedCount} storyboards failed to generate`);
                }
                
                if (failedCount > 0) {
                    console.warn(`Storyboard generation completed with ${successCount} successes and ${failedCount} failures`);
                }
                
                updateTask(taskId, { progress: 80, stepStatus: 'completed' });
                break;
            }
            case TaskStatus.PROMPT_OPTIMIZATION: {
                const llmProvider = getProviderForStep(apiConfigRef.current, 'promptOptimization')!;
                const llmModel = getModelForStep(apiConfigRef.current, 'promptOptimization')!;
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
                             const originalPrompt = shot.soraPromptOriginal || shot.soraPrompt || "Scene";
                             let optimized = '';
                             for await (const chunk of optimizeSoraPrompt(llmProvider, llmModel, originalPrompt, task.style, task.language, task.visualSignature, signal, task.characters)) {
                                 optimized += chunk;
                             }
                             
                             setTasks(prev => {
                                 const t = prev.find(p => p.id === taskId);
                                 if (!t) return prev;
                                 const newShots = [...t.bigShots];
                                 newShots[shotIndex] = { ...newShots[shotIndex], soraPromptOriginal: newShots[shotIndex].soraPromptOriginal || newShots[shotIndex].soraPrompt, soraPrompt: optimized, soraPromptOptimized: optimized };
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
                
                if (indicesToGenerate.length > 0 && failedCount === indicesToGenerate.length) {
                    throw new Error(`Prompt optimization failed: All ${failedCount} prompts failed to optimize`);
                }
                
                if (failedCount > 0) {
                    console.warn(`Prompt optimization completed with ${successCount} successes and ${failedCount} failures`);
                }
                
                updateTask(taskId, { progress: 100, status: TaskStatus.COMPLETED, stepStatus: 'completed' });
                break;
            }
        }
        
        playSuccessSound();

    } catch (e: any) {
        if (axios.isCancel(e) || e.name === 'AbortError') return;
        updateTask(taskId, { status: TaskStatus.FAILED, failedStep: stepToRun, error: e.message || "Unknown error", stepStatus: 'idle' });
        playErrorSound();
    }
  }, [tasks, apiConfig, updateTask, setTasks, updateBigShotStatus]);

  const proceedToNextStep = useCallback((taskId: string) => {
      const task = tasksRef.current.find(t => t.id === taskId);
      if (!task) return;
      const stepIndex = LOGICAL_STEPS.indexOf(task.status);
      // 守卫：CANCELLED/FAILED/IDLE 等非流水线状态 indexOf 返回 -1，不得回退到第一步重跑
      if (stepIndex === -1) return;
      const next = LOGICAL_STEPS[stepIndex + 1];
      if (next) executeTaskStep(taskId, next);
  }, [tasks, executeTaskStep]);

  return {
    executeTaskStep,
    proceedToNextStep,
    cancelTask,
    updateBigShotStatus
  };
};
