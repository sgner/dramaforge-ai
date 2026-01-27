import axios from 'axios';
import { Character } from '../types';

// Helper to recursively find a URL in a complex JSON response
const findUrlInResponse = (data: any): string | null => {
  if (!data) return null;
  
  // Direct property check
  if (typeof data === 'string' && (data.startsWith('http') || data.startsWith('data:image'))) return data;
  
  // Array check
  if (Array.isArray(data)) {
    for (const item of data) {
      const found = findUrlInResponse(item);
      if (found) return found;
    }
  }
  
  // Object check (Common keys in various AI APIs)
  if (typeof data === 'object') {
    if (data.url) return data.url;
    if (data.image_url) return data.image_url;
    if (data.video_url) return data.video_url;
    if (data.output) return findUrlInResponse(data.output);
    if (data.data) return findUrlInResponse(data.data);
    if (data.artifacts) return findUrlInResponse(data.artifacts);
    if (data.image) return findUrlInResponse(data.image);
    // Some APIs wrap result in 'generations'
    if (data.generations) return findUrlInResponse(data.generations);
  }
  
  return null;
};

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// Helper to convert image URL to Blob for upload
// Fixed: Added cache: 'no-store' to prevent ERR_CACHE_WRITE_FAILURE
const urlToBlob = async (url: string, signal?: AbortSignal): Promise<Blob> => {
  try {
    const response = await fetch(url, { 
      signal,
      cache: 'no-store', // Critical fix for ERR_CACHE_WRITE_FAILURE
      mode: 'cors'
    });
    if (!response.ok) throw new Error(`Failed to fetch image: ${response.statusText}`);
    return await response.blob();
  } catch (error: any) {
    console.warn("Initial image fetch failed, retrying with reload...", url, error);
    try {
        // Retry logic for robustness
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

/**
 * Generates Character Design using Text-to-Image API.
 * Supports Image-to-Image if referenceImage is present in Character object.
 */
export const generateCharacterDesign = async (
  character: Character, 
  style: string,
  language: string,
  apiKey: string,
  baseUrl?: string,
  signal?: AbortSignal
): Promise<string> => {
  if (!apiKey) throw new Error("Nanobanana API Key is missing");

  const host = baseUrl ? baseUrl.replace(/\/+$/, '') : 'https://api.nanobanana.com';
  const langContext = LANG_MAP[language] || language;

  const prompt = `Character Design Sheet (Three Views: Front, Side, Back) for ${character.name}. 
  Visual features: ${character.visualFeatures}. 
  Clothing: ${character.clothing}. 
  Style: ${style}. 
  Cultural Context: ${langContext}.
  High quality, detailed character reference sheet, white background.`;

  try {
    // IMAGE-TO-IMAGE MODE: If user uploaded a reference
    if (character.referenceImage) {
      const url = `${host}/v1/images/edits`;
      const formData = new FormData();
      
      formData.append('model', 'nano-banana');
      formData.append('prompt', prompt);
      formData.append('n', '1');
      formData.append('size', '1024x1024');
      formData.append('response_format', 'url');
      
      // Convert reference URL to blob and append
      const blob = await urlToBlob(character.referenceImage, signal);
      formData.append('image', blob, 'reference.png');

      const { data } = await axios.post(url, formData, {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          // Content-Type set automatically
        },
        signal
      });

      const imageUrl = findUrlInResponse(data);
      if (!imageUrl) throw new Error("No image URL found in Nanobanana response");
      return imageUrl;

    } else {
      // TEXT-TO-IMAGE MODE
      const url = `${host}/v1/images/generations`;
      const { data } = await axios.post(url, {
        model: "nano-banana", 
        prompt: prompt,
        n: 1,
        size: "1024x1024",
        response_format: "url"
      }, {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        signal
      });

      const imageUrl = findUrlInResponse(data);
      if (!imageUrl) throw new Error("No image URL found in Nanobanana response");
      return imageUrl;
    }
  } catch (err: any) {
    if (axios.isCancel(err)) throw err;
    console.error("Nanobanana Error (Char):", err.response?.data || err.message);
    const msg = err.response?.data?.error?.message || err.message;
    throw new Error(`Character generation failed: ${msg}`);
  }
};

/**
 * Generates a Six-Grid Storyboard Image.
 * uses /v1/images/edits when reference images are provided (Image-to-Image / Edit mode).
 */
export const generateStoryboardImage = async (
  description: string, 
  style: string,
  language: string,
  characterContext: string,
  characterImages: string[], // List of image URLs to upload
  apiKey: string,
  baseUrl?: string,
  signal?: AbortSignal
): Promise<string> => {
  if (!apiKey) throw new Error("Nanobanana API Key is missing");

  const host = baseUrl ? baseUrl.replace(/\/+$/, '') : 'https://api.nanobanana.com';
  const langContext = LANG_MAP[language] || language;

  // Optimized prompt structure for 6-grid generation
  const fullPrompt = `
  *** Six-Panel Storyboard Sheet, 2 rows x 3 columns layout, 2x3 grid ***
  Visual Style: ${style}. ${langContext}.
  
  [Panel Content]
  ${description}
  `;
  

  try {
    console.log(fullPrompt)
    // If we have character images, use the EDITS endpoint (multipart/form-data)
    if (characterImages && characterImages.length > 0) {
      const url = `${host}/v1/images/edits`;
      const formData = new FormData();
      
      formData.append('model', 'nano-banana');
      formData.append('prompt', fullPrompt);
      formData.append('image_size', '4K'); // Per snippet
      formData.append('response_format', 'url');
      formData.append('aspect_ratio', ''); // Per snippet

      // Fetch and append all character images
      let appendedCount = 0;
      for (const imgUrl of characterImages) {
        if (signal?.aborted) throw new axios.Cancel('Operation cancelled');
        try {
          const blob = await urlToBlob(imgUrl, signal);
          // The API expects 'image' key for uploads. Multiple appends with same key.
          formData.append('image', blob, `ref_${appendedCount}.png`);
          appendedCount++;
        } catch (e) {
          if (signal?.aborted) throw e;
          // Warning: Consistency impacted if this fails
          console.warn(`[WARNING] Failed to download reference image: ${imgUrl}. Character consistency may be degraded.`);
        }
      }

      if (appendedCount > 0) {
        // Send as FormData
        const { data } = await axios.post(url, formData, {
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            // Axios/Browser automatically sets Content-Type: multipart/form-data with boundary
          },
          signal
        });

        const imageUrl = findUrlInResponse(data);
        if (!imageUrl) throw new Error("No image URL found in Nanobanana response");
        return imageUrl;
      }
      // If no images could be fetched, fall back to text-only below
      console.warn("[WARNING] No character reference images could be loaded. Falling back to text-only generation.");
    }

    // Fallback: Text-only generation using /v1/images/generations
    const url = `${host}/v1/images/generations`;
    const { data } = await axios.post(url, {
      model: "nano-banana",
      prompt: fullPrompt,
      n: 1,
      size: "1024x1024",
      aspect_ratio: "16:9", 
      response_format: "url"
    }, {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      signal
    });

    const imageUrl = findUrlInResponse(data);
    if (!imageUrl) throw new Error("No image URL found in Nanobanana response");
    return imageUrl;

  } catch (err: any) {
    if (axios.isCancel(err)) throw err;
    console.error("Nanobanana Error (Storyboard):", err.response?.data || err.message);
    const msg = err.response?.data?.error?.message || err.message;
    throw new Error(`Storyboard generation failed: ${msg}`);
  }
};

// --- SORA 2 (Video Generation with Polling) ---

const pollSoraTask = async (
  taskId: string, 
  apiKey: string, 
  baseUrl?: string,
  onProgress?: (status: string) => void,
  signal?: AbortSignal
): Promise<string> => {
  const host = baseUrl ? baseUrl.replace(/\/+$/, '') : 'https://api.sora.com';
  // Use v1 endpoint for polling as per request: /v1/videos/{task_id}
  const url = `${host}/v2/videos/generations/${taskId}`;
  
  const MAX_ATTEMPTS = 720; 
  const POLL_INTERVAL = 5000; // 5 seconds

  console.log(`[Sora] Starting polling for Task ID: ${taskId}`);

  for (let i = 0; i < MAX_ATTEMPTS; i++) {
    if (signal?.aborted) throw new axios.Cancel('Polling cancelled');
    await sleep(POLL_INTERVAL);
    if (signal?.aborted) throw new axios.Cancel('Polling cancelled');

    try {
      const response = await axios.get(url, {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        signal
      });

      // Robustly determine the response body. 
      const data = (response.data && (response.data.status || response.data.task_id)) 
                   ? response.data 
                   : response;

      // --- LOGGING PROGRESS ---
      console.log(`[Sora] Poll #${i+1}:`, JSON.stringify(data));
      // ------------------------

      const status = data.status ? data.status.toUpperCase() : 'UNKNOWN';
      const progress = data.progress !== undefined ? data.progress : '';

      // Check for failure: look for status 'failed' and error object
      if (status === 'FAILED' || status === 'FAILURE') {
        // Extract specific message from error object if present
        const errorDetail = 
          data.fail_reason || 
          data.error?.message || 
          data.message || 
          JSON.stringify(data.error) || 
          'Video generation task failed.';
          
        console.error(`[Sora] Task failed details:`, data);
        throw new Error(`FATAL_SORA: ${errorDetail}`);
      }

      // Status & Progress update (Only if not failed)
      if (onProgress) {
        let statusMsg = status;
        if (progress) {
          statusMsg += ` (${progress}%)`;
        }
        onProgress(statusMsg);
      }

      // Check for completion
      // Success format: { "status": "SUCCESS", "data": { "output": "http..." } }
      if (status === 'SUCCESS' || status === 'COMPLETED') {
        // Prioritize structured 'output' in 'data' object based on user provided schema
        let videoUrl = data.data?.output;
        
        // Fallback checks
        if (!videoUrl) videoUrl = data.video_url || data.url;
        if (!videoUrl) videoUrl = findUrlInResponse(data);

        if (videoUrl) {
           console.log(`[Sora] Video URL found: ${videoUrl}`);
           return videoUrl;
        }
        // If completed but no URL found yet (edge case)
        console.warn(`[Sora] Task ${taskId} is completed but 'output' or 'video_url' is missing in response:`, data);
      }
      
    } catch (err: any) {
      if (axios.isCancel(err)) throw err;

      // Handle the fatal error we just threw to ensure it propagates up
      if (err.message && err.message.startsWith('FATAL_SORA:')) {
        throw new Error(err.message.replace('FATAL_SORA: ', ''));
      }

      // For other API errors (e.g. 500, 502), retry unless it's a client error (4xx)
      // Exception: 404 might mean task not found yet (eventual consistency) or wrong ID. 
      if (err.response && err.response.status >= 400 && err.response.status < 500 && err.response.status !== 404) {
        throw err;
      }
      
      console.warn(`[Sora] Polling error (retrying): ${err.message}`);
    }
  }

  throw new Error("Video generation timed out after 1 hour. Please check your dashboard.");
};

export const generateSoraVideo = async (
  optimizedPrompt: string,
  style: string,
  language: string,
  apiKey: string,
  baseUrl?: string,
  storyboardImageUrl?: string,
  onProgress?: (status: string) => void,
  signal?: AbortSignal
): Promise<string> => {
  if (!apiKey) throw new Error("Sora API Key is missing");

  const host = baseUrl ? baseUrl.replace(/\/+$/, '') : 'https://api.sora.com'; 
  // Update to v2 endpoint for generation as per snippet: /v2/videos/generations
  const url = `${host}/v2/videos/generations`;
  const langContext = LANG_MAP[language] || language;

  const finalPrompt = `
  Visual Style: ${style}.
  Cultural Context: ${langContext}.
  ${storyboardImageUrl 
    ? `${optimizedPrompt} \n\n[REFERENCE] Use the attached six-grid storyboard image as a strict visual reference for characters, composition, and timeline.`
    : optimizedPrompt}
  `;

  const requestBody: any = {
    prompt: finalPrompt,
    model: "sora-2",
    aspect_ratio: "16:9",
    hd: true,
    duration: "15", // Changed to 15 to allow for 10-15s prompt range
    watermark: false,
    private: true,
    images: []
  };

  if (storyboardImageUrl) {
    requestBody.images.push(storyboardImageUrl);
  }

  try {
    const response = await axios.post(url, requestBody, {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      signal
    });
    
    // Robustly determine body (same logic as polling)
    const data = (response.data && (response.data.task_id || response.data.id)) 
                 ? response.data 
                 : response;

    console.log(`[Sora] Creation request successful. Response:`, data);

    // Check specifically for task_id as per successful response example
    const taskId = data.task_id;
    
    if (taskId) {
      return await pollSoraTask(taskId, apiKey, baseUrl, onProgress, signal);
    }

    console.warn("Sora response data:", data);
    throw new Error("Response did not contain a task_id.");

  } catch (err: any) {
    if (axios.isCancel(err)) throw err;
    console.error("Sora 2 Error:", err.response?.data || err.message);
    const msg = err.response?.data?.error?.message || err.message;
    throw new Error(`Video generation failed: ${msg}`);
  }
};