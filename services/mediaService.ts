import axios from 'axios';
import { Character, Provider, ModelConfig, CHARACTER_CONCEPT_SHEET_LAYOUT, SceneAsset } from '../types';
import {
  buildUrl, buildHeaders, buildApiKeyQueryParam,
  buildImageRequestBody, buildVideoRequestBody,
  extractVideoTaskId, buildPollUrl
} from './apiAdapter';
import { api } from './apiClient';
import { CHARACTER_DESIGN_SHEET_PROMPT } from '../constants';

/**
 * 统一代理标志：true = 通过后端 /api/media/generate/* 调用供应商（api_key 不入前端，安全）；
 *                false = 旧路径，前端直连供应商（保留以做 fallback 调试用）。
 * 默认 true：新架构下所有画布媒体生成都走后端。
 */
const USE_BACKEND_PROXY = true;

const findUrlInResponse = (data: any): string | null => {
  if (!data) return null;
  if (typeof data === 'string' && (data.startsWith('http') || data.startsWith('data:image'))) return data;
  if (Array.isArray(data)) {
    for (const item of data) {
      const found = findUrlInResponse(item);
      if (found) return found;
    }
  }
  if (typeof data === 'object') {
    if (data.url) return data.url;
    if (data.image_url) return data.image_url;
    if (data.video_url) return data.video_url;
    if (data.output) return findUrlInResponse(data.output);
    if (data.data) return findUrlInResponse(data.data);
    if (data.artifacts) return findUrlInResponse(data.artifacts);
    if (data.image) return findUrlInResponse(data.image);
    if (data.generations) return findUrlInResponse(data.generations);
  }
  return null;
};

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const urlToBlob = async (url: string, signal?: AbortSignal): Promise<Blob> => {
  try {
    const response = await fetch(url, { 
      signal,
      cache: 'no-store',
      mode: 'cors'
    });
    if (!response.ok) throw new Error(`Failed to fetch image: ${response.statusText}`);
    return await response.blob();
  } catch (error: any) {
    console.warn("Initial image fetch failed, retrying with reload...", url, error);
    try {
        const response = await fetch(url, { 
            signal,
            cache: 'reload',
            mode: 'cors'
        });
        if (!response.ok) throw new Error(`Retry failed: ${response.statusText}`);
        return await response.blob();
    } catch (retryError) {
        console.warn("Image fetch failed or cancelled, skipping reference image:", url, retryError);
        throw retryError;
    }
  }
};

const LANG_MAP: Record<string, string> = {
  'zh': 'Chinese context',
  'en': 'Western context',
  'ja': 'Japanese context',
  'ko': 'Korean context'
};

// ============ 旧路径辅助（USE_BACKEND_PROXY=false 时使用） ============

const buildFullUrl = (provider: Provider, model: ModelConfig): string => {
  let url = buildUrl(provider, model);
  const keyParam = buildApiKeyQueryParam(provider, model);
  if (keyParam) {
    const separator = url.includes('?') ? '&' : '?';
    url = `${url}${separator}${keyParam}`;
  }
  return url;
};

// ============ 后端代理路径 ============

/**
 * 构建角色设计 prompt
 */
function buildCharacterPrompt(character: Character, style: string): string {
  if (character.faceAnchor && character.hairSystem && character.clothingLayers) {
    const fa = character.faceAnchor;
    const hs = character.hairSystem;
    const cl = character.clothingLayers;
    return `${character.era || ''} ${character.identity || ''} ${character.gender || ''} ${character.ageRange || ''} ${style}。面容：${fa.faceShape}，${fa.eyebrow}，${fa.eyeType}，${fa.noseType}，${fa.lipType}，${fa.boneStructure}，${fa.skinTone}肤${fa.landmarks ? '，' + fa.landmarks : ''}。发式：${hs.lengthAndStyle}，${hs.color}发${hs.headwear ? '，' + hs.headwear : ''}，${hs.bangsDirection}。服装：内层${cl.inner}，外层${cl.outer}，套层${cl.overlay}，腰部${cl.waist}，下身${cl.lower}，足部${cl.feet}。${character.specialState ? '特殊状态：' + character.specialState + '。' : ''}姿态：双手自然下垂，站姿自然，面容平静。${CHARACTER_CONCEPT_SHEET_LAYOUT} 8K超精细，材质纹理清晰可触，纯白底背景`;
  }
  return `${CHARACTER_DESIGN_SHEET_PROMPT}. Character identity: ${character.name}.
Visual features: ${character.visualFeatures}. 
Clothing: ${character.clothing}. 
Style: ${style}. 
High quality, detailed character reference sheet.`;
}

/**
 * 构建分镜图 prompt
 */
function buildStoryboardPrompt(description: string, style: string, language: string, sceneAsset?: SceneAsset): string {
  const langContext = LANG_MAP[language] || language;
  let sceneContext = '';
  if (sceneAsset) {
    sceneContext = `\n[Scene Asset — 7-Layer Structure]\n世界观定位：${sceneAsset.worldPositioning}\n地理位置：${sceneAsset.geography}\n主体建筑：${sceneAsset.mainStructure}\n延伸空间：${sceneAsset.extendedSpace}\n自然远景：${sceneAsset.naturalAndDistant}\n光影色彩：${sceneAsset.lightAndColor}\n技术规格：${sceneAsset.techSpec}\n氛围人物：${sceneAsset.ambientCharacters}\n${sceneAsset.qualitySuffix}`;
  }
  return `
  *** Six-Panel Storyboard Sheet, 2 rows x 3 columns layout, 2x3 grid ***
  Visual Style: ${style}. ${langContext}.
  ${sceneContext}
  [Panel Content]
  ${description}
  `;
}

/**
 * 构建视频 prompt
 */
function buildVideoPrompt(optimizedPrompt: string, style: string, language: string, storyboardImageUrl?: string): string {
  const langContext = LANG_MAP[language] || language;
  return `
  Visual Style: ${style}.
  Cultural Context: ${langContext}.
  ${storyboardImageUrl 
    ? `${optimizedPrompt} \n\n[REFERENCE] Use the attached six-grid storyboard image as a strict visual reference for characters, composition, and timeline.`
    : optimizedPrompt}
  `;
}

// ============ 公开 API ============

export const generateCharacterDesign = async (
  character: Character, 
  style: string,
  language: string,
  provider: Provider,
  model: ModelConfig,
  signal?: AbortSignal
): Promise<string> => {
  const prompt = `${buildCharacterPrompt(character, style)}\n${CHARACTER_DESIGN_SHEET_PROMPT}`;

  if (USE_BACKEND_PROXY) {
    // 后端代理模式：不需要前端持有 apiKey
    const refUrls: string[] = character.referenceImage ? [character.referenceImage] : [];
    const result = await api.generateImage({
      provider_id: provider.id,
      model: model.modelName,
      prompt,
      ref_urls: refUrls,
      aspect_ratio: '1:1',
    });
    return result.url;
  }

  // 旧路径：前端直连供应商
  if (!provider.apiKey) throw new Error("Image provider API Key is missing");

  try {
    if (character.referenceImage) {
      const url = buildFullUrl(provider, model);
      const formData = new FormData();
      
      formData.append('model', model.modelName);
      formData.append('prompt', prompt);
      formData.append('n', '1');
      formData.append('size', '1024x1024');
      formData.append('response_format', 'url');
      
      const blob = await urlToBlob(character.referenceImage, signal);
      formData.append('image', blob, 'reference.png');

      const { data } = await axios.post(url, formData, {
        headers: {
          'Authorization': `Bearer ${provider.apiKey}`,
        },
        signal
      });

      const imageUrl = findUrlInResponse(data);
      if (!imageUrl) throw new Error("No image URL found in response");
      return imageUrl;

    } else {
      const url = buildFullUrl(provider, model);
      const headers = buildHeaders(provider, model);
      const requestBody = buildImageRequestBody(model, prompt, {
        size: '1024x1024',
        n: 1,
        responseFormat: 'url'
      }, provider);

      const { data } = await axios.post(url, requestBody, { headers, signal });

      const imageUrl = findUrlInResponse(data);
      if (!imageUrl) throw new Error("No image URL found in response");
      return imageUrl;
    }
  } catch (err: any) {
    if (axios.isCancel(err)) throw err;
    console.error("Image API Error (Char):", err.response?.data || err.message);
    const msg = err.response?.data?.error?.message || err.message;
    throw new Error(`Character generation failed: ${msg}`);
  }
};

export const generateStoryboardImage = async (
  description: string, 
  style: string,
  language: string,
  characterContext: string,
  characterImages: string[],
  provider: Provider,
  model: ModelConfig,
  signal?: AbortSignal,
  sceneAsset?: SceneAsset,
  aspectRatio?: string
): Promise<string> => {
  const prompt = buildStoryboardPrompt(description, style, language, sceneAsset);

  if (USE_BACKEND_PROXY) {
    // 后端代理模式：将参考图 URL 作为 ref_urls 传递
    const result = await api.generateImage({
      provider_id: provider.id,
      model: model.modelName,
      prompt,
      ref_urls: characterImages || [],
      aspect_ratio: aspectRatio || '16:9',
    });
    return result.url;
  }

  // 旧路径：前端直连供应商
  if (!provider.apiKey) throw new Error("Image provider API Key is missing");
  console.log(characterImages);
  const langContext = LANG_MAP[language] || language;

  try {
    console.log(prompt);
    if (characterImages && characterImages.length > 0) {
      const url = buildFullUrl(provider, model);
      const formData = new FormData();
      
      formData.append('model', model.modelName);
      formData.append('prompt', prompt);
      formData.append('image_size', '4K');
      formData.append('response_format', 'url');
      formData.append('aspect_ratio', aspectRatio || '');

      let appendedCount = 0;
      for (const imgUrl of characterImages) {
        if (signal?.aborted) throw new axios.Cancel('Operation cancelled');
        try {
          const blob = await urlToBlob(imgUrl, signal);
          formData.append('image', blob, `ref_${appendedCount}.png`);
          appendedCount++;
        } catch (e) {
          if (signal?.aborted) throw e;
          console.warn(`[WARNING] Failed to download reference image: ${imgUrl}. Character consistency may be degraded.`);
        }
      }

      if (appendedCount > 0) {
        const { data } = await axios.post(url, formData, {
          headers: {
            'Authorization': `Bearer ${provider.apiKey}`,
          },
          signal
        });

        const imageUrl = findUrlInResponse(data);
        if (!imageUrl) throw new Error("No image URL found in response");
        return imageUrl;
      }
      console.warn("[WARNING] No character reference images could be loaded. Falling back to text-only generation.");
    }

    const url = buildFullUrl(provider, model);
    const headers = buildHeaders(provider, model);
    const requestBody = buildImageRequestBody(model, prompt, {
      size: '1024x1024',
      n: 1,
      responseFormat: 'url',
      aspectRatio: aspectRatio || '16:9'
    }, provider);

    const { data } = await axios.post(url, requestBody, { headers, signal });

    const imageUrl = findUrlInResponse(data);
    if (!imageUrl) throw new Error("No image URL found in response");
    return imageUrl;

  } catch (err: any) {
    if (axios.isCancel(err)) throw err;
    console.error("Image API Error (Storyboard):", err.response?.data || err.message);
    const msg = err.response?.data?.error?.message || err.message;
    throw new Error(`Storyboard generation failed: ${msg}`);
  }
};

const pollSoraTask = async (
  taskId: string, 
  provider: Provider,
  model: ModelConfig,
  onProgress?: (status: string) => void,
  signal?: AbortSignal
): Promise<string> => {
  const pollUrl = buildPollUrl(provider, model, taskId);
  const headers = buildHeaders(provider, model);
  
  const MAX_ATTEMPTS = 720; 
  const POLL_INTERVAL = 5000;

  console.log(`[Video] Starting polling for Task ID: ${taskId}`);

  for (let i = 0; i < MAX_ATTEMPTS; i++) {
    if (signal?.aborted) throw new axios.Cancel('Polling cancelled');
    await sleep(POLL_INTERVAL);
    if (signal?.aborted) throw new axios.Cancel('Polling cancelled');

    try {
      const response = await axios.get(pollUrl, { headers, signal });

      const data = (response.data && (response.data.status || response.data.task_id)) 
                   ? response.data 
                   : response;

      console.log(`[Video] Poll #${i+1}:`, JSON.stringify(data));

      const status = data.status ? data.status.toUpperCase() : 'UNKNOWN';
      const progress = data.progress !== undefined ? data.progress : '';

      if (status === 'FAILED' || status === 'FAILURE') {
        const errorDetail = 
          data.fail_reason || 
          data.error?.message || 
          data.message || 
          JSON.stringify(data.error) || 
          'Video generation task failed.';
          
        console.error(`[Video] Task failed details:`, data);
        throw new Error(`FATAL_VIDEO: ${errorDetail}`);
      }

      if (onProgress) {
        let statusMsg = status;
        if (progress) {
          statusMsg += ` (${progress}%)`;
        }
        onProgress(statusMsg);
      }

      if (status === 'SUCCESS' || status === 'COMPLETED') {
        let videoUrl = data.data?.output;
        
        if (!videoUrl) videoUrl = data.video_url || data.url;
        if (!videoUrl) videoUrl = findUrlInResponse(data);

        if (videoUrl) {
           console.log(`[Video] Video URL found: ${videoUrl}`);
           return videoUrl;
        }
        console.warn(`[Video] Task ${taskId} is completed but 'output' or 'video_url' is missing in response:`, data);
      }
      
    } catch (err: any) {
      if (axios.isCancel(err)) throw err;

      if (err.message && err.message.startsWith('FATAL_VIDEO:')) {
        throw new Error(err.message.replace('FATAL_VIDEO: ', ''));
      }

      if (err.response && err.response.status >= 400 && err.response.status < 500 && err.response.status !== 404) {
        throw err;
      }
      
      console.warn(`[Video] Polling error (retrying): ${err.message}`);
    }
  }

  throw new Error("Video generation timed out after 1 hour. Please check your dashboard.");
};

export const generatePropImage = async (
  propPrompt: string,
  provider: Provider,
  model: ModelConfig,
  signal?: AbortSignal,
  referenceImages: string[] = []
): Promise<string> => {
  const prompt = `Still life product photography, ${propPrompt}`;

  if (USE_BACKEND_PROXY) {
    // 后端代理模式
    const result = await api.generateImage({
      provider_id: provider.id,
      model: model.modelName,
      prompt,
      ref_urls: referenceImages,
      aspect_ratio: '1:1',
    });
    return result.url;
  }

  // 旧路径：前端直连供应商
  if (!provider.apiKey) throw new Error("Image provider API Key is missing");

  try {
    const url = buildFullUrl(provider, model);
    const headers = buildHeaders(provider, model);
    const requestBody = buildImageRequestBody(model, prompt, {
      size: '1024x1024',
      n: 1,
      responseFormat: 'url'
    }, provider);

    const { data } = await axios.post(url, requestBody, { headers, signal });

    const imageUrl = findUrlInResponse(data);
    if (!imageUrl) throw new Error("No image URL found in response");
    return imageUrl;
  } catch (err: any) {
    if (axios.isCancel(err)) throw err;
    console.error("Image API Error (Prop):", err.response?.data || err.message);
    const msg = err.response?.data?.error?.message || err.message;
    throw new Error(`Prop generation failed: ${msg}`);
  }
};

export const generateSoraVideo = async (
  optimizedPrompt: string,
  style: string,
  language: string,
  provider: Provider,
  model: ModelConfig,
  storyboardImageUrl?: string | string[],
  onProgress?: (status: string) => void,
  signal?: AbortSignal
): Promise<string> => {
  const referenceImages = Array.isArray(storyboardImageUrl)
    ? storyboardImageUrl.filter(Boolean)
    : storyboardImageUrl ? [storyboardImageUrl] : [];
  const prompt = buildVideoPrompt(optimizedPrompt, style, language, referenceImages[0]);

  if (USE_BACKEND_PROXY) {
    // 后端代理模式
    const result = await api.generateVideo({
      provider_id: provider.id,
      model: model.modelName,
      prompt,
      ref_urls: referenceImages,
      aspect_ratio: '16:9',
      duration_sec: 15,
    });
    return result.url;
  }

  // 旧路径：前端直连供应商
  if (!provider.apiKey) throw new Error("Video provider API Key is missing");

  const url = buildFullUrl(provider, model);
  const headers = buildHeaders(provider, model);

  const requestBody = buildVideoRequestBody(model, prompt, {
    aspectRatio: '16:9',
    duration: '15',
    hd: true,
    images: referenceImages
  }, provider);

  try {
    const response = await axios.post(url, requestBody, { headers, signal });
    
    const data = (response.data && (response.data.task_id || response.data.id)) 
                 ? response.data 
                 : response;

    console.log(`[Video] Creation request successful. Response:`, data);

    const taskId = extractVideoTaskId(model, data);
    
    if (taskId) {
      return await pollSoraTask(taskId, provider, model, onProgress, signal);
    }

    console.warn("Video API response data:", data);
    throw new Error("Response did not contain a task_id.");

  } catch (err: any) {
    if (axios.isCancel(err)) throw err;
    console.error("Video API Error:", err.response?.data || err.message);
    const msg = err.response?.data?.error?.message || err.message;
    throw new Error(`Video generation failed: ${msg}`);
  }
};
