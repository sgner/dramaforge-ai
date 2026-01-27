
import axios from 'axios';
import { SCRIPT_SYSTEM_PROMPT, SORA_OPTIMIZATION_PROMPT, NOVEL_EXPANSION_PROMPT, NOVEL_PREPROCESS_PROMPT, CONTINUE_STORY_PROMPT } from "../constants";

// Helper to construct request config
const getAxiosConfig = (baseUrl: string | undefined, apiKey: string, model: string) => {
  const cleanKey = apiKey ? apiKey.trim() : '';
  const cleanBaseUrl = baseUrl ? baseUrl.trim() : '';
  const isCustomBase = cleanBaseUrl.length > 0;
  
  // Default to Google Official
  const host = isCustomBase ? cleanBaseUrl.replace(/\/+$/, '') : 'https://generativelanguage.googleapis.com';
  
  // Path construction - assumes standard Gemini API path structure
  const path = `/v1beta/models/${model}:generateContent`;
  
  let url = `${host}${path}`;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json'
  };

  // Check for non-ASCII characters in key to prevent setRequestHeader error
  const hasNonAscii = /[^\x00-\x7F]/.test(cleanKey);

  // Auth Logic:
  if (isCustomBase && !hasNonAscii) {
    // Use Bearer token if custom base (often proxies), assuming standard ASCII key
    headers['Authorization'] = `Bearer ${cleanKey}`;
  } else {
    // Official API or Key with unsafe characters -> use URL Query Param (encoded)
    const separator = url.includes('?') ? '&' : '?';
    url = `${url}${separator}key=${encodeURIComponent(cleanKey)}`;
  }

  return { url, headers };
};

export const expandIdeaToStory = async (
  apiKey: string,
  idea: string,
  baseUrl?: string,
  language: string = 'zh',
  signal?: AbortSignal
) => {
  // Use pro model for creative writing
  const model = "gemini-3-pro-preview";
  const { url, headers } = getAxiosConfig(baseUrl, apiKey, model);
    const langMap: Record<string, string> = {
    'zh': 'Chinese (Simplified)',
    'en': 'English',
    'ja': 'Japanese',
    'ko': 'Korean'
  };
  const targetLang = langMap[language] || 'English';
  const requestBody = {
    contents: [{
      role: "user",
      parts: [{ text: idea }]
    }],
    systemInstruction: {
      parts: [{ text: `targetlang:${targetLang}\n${NOVEL_EXPANSION_PROMPT}` }]
    },
    generationConfig: {
      temperature: 0.85, // High creativity for expansion
      maxOutputTokens: 8192
    }
  };

  try {
    const { data } = await axios.post(url, requestBody, { headers, signal });
    return data.candidates?.[0]?.content?.parts?.[0]?.text || "";
  } catch (err: any) {
    if (axios.isCancel(err)) throw err;
    console.error("Gemini API Error (Expansion):", err.response?.data || err.message);
    throw err;
  }
};

export const preprocessNovel = async (
  apiKey: string,
  rawText: string,
  baseUrl?: string,
  language: string = 'zh',
  signal?: AbortSignal
) => {
  // Use pro model for long context handling
  const model = "gemini-3-pro-preview";
  const { url, headers } = getAxiosConfig(baseUrl, apiKey, model);

  const requestBody = {
    contents: [{
      role: "user",
      parts: [{ text: rawText }]
    }],
    systemInstruction: {
      parts: [{ text: NOVEL_PREPROCESS_PROMPT }]
    },
    generationConfig: {
      temperature: 0.1, // Very low creativity for strict formatting
      maxOutputTokens: 8192
    }
  };

  try {
    const { data } = await axios.post(url, requestBody, { headers, signal });
    return data.candidates?.[0]?.content?.parts?.[0]?.text || rawText;
  } catch (err: any) {
    if (axios.isCancel(err)) throw err;
    console.error("Gemini API Error (Preprocess):", err.response?.data || err.message);
    throw err;
  }
};

export const continueStory = async (
  apiKey: string,
  currentText: string,
  baseUrl?: string,
  signal?: AbortSignal
) => {
  const model = "gemini-3-pro-preview";
  const { url, headers } = getAxiosConfig(baseUrl, apiKey, model);

  const context = currentText.slice(-15000); // Last ~15k chars context

  const requestBody = {
    contents: [{
      role: "user",
      parts: [{ text: context }]
    }],
    systemInstruction: {
      parts: [{ text: CONTINUE_STORY_PROMPT }]
    },
    generationConfig: {
      temperature: 0.7
    }
  };

  try {
    const { data } = await axios.post(url, requestBody, { headers, signal });
    return data.candidates?.[0]?.content?.parts?.[0]?.text || "";
  } catch (err: any) {
    if (axios.isCancel(err)) throw err;
    console.error("Gemini API Error (Continue):", err.response?.data || err.message);
    throw err;
  }
};

export const generateScriptFromNovel = async (
  apiKey: string,
  novelText: string,
  style: string,
  baseUrl?: string,
  language: string = 'zh',
  signal?: AbortSignal
) => {
  // STRICT REQUIREMENT: Use gemini-3-pro-preview
  const model = "gemini-3-pro-preview"; 
  const { url, headers } = getAxiosConfig(baseUrl, apiKey, model);

  // Map language codes to readable names for the prompt
  const langMap: Record<string, string> = {
    'zh': 'Chinese (Simplified)',
    'en': 'English',
    'ja': 'Japanese',
    'ko': 'Korean'
  };
  const targetLang = langMap[language] || 'Chinese';

  const requestBody = {
    contents: [{
      role: "user",
      parts: [{ text: novelText }]
    }],
    systemInstruction: {
      parts: [{ text: SCRIPT_SYSTEM_PROMPT + `\n\nIMPORTANT CONFIGURATION:\n1. TARGET LANGUAGE: All output (character names, descriptions, script dialogue, analysis) MUST be in ${targetLang}.\n2. VISUAL STYLE: The storyboard descriptions and character visual features MUST reflect the style "${style}".` }]
    },
    generationConfig: {
      responseMimeType: "application/json",
      temperature: 0.7
    }
  };

  try {
    // Explicitly using axios as requested
    const { data } = await axios.post(url, requestBody, { headers, signal });

    const candidate = data.candidates?.[0];
    if (!candidate) throw new Error("No candidates returned from API");

    const contentText = candidate.content?.parts?.[0]?.text;
    if (!contentText) throw new Error("No text content in response");

    // Clean up potential markdown code blocks
    const cleanJson = contentText.replace(/^```json\s*/, '').replace(/\s*```$/, '');
    return JSON.parse(cleanJson);
  } catch (err: any) {
    if (axios.isCancel(err)) throw err;
    console.error("Gemini API Error (Script):", err.response?.data || err.message);
    throw err;
  }
};

export const optimizeSoraPrompt = async (
  apiKey: string,
  originalPrompt: string,
  style: string,
  baseUrl?: string,
  language: string = 'en',
  signal?: AbortSignal
) => {
  const model = "gemini-3-pro-preview";
  const { url, headers } = getAxiosConfig(baseUrl, apiKey, model);

  // Map language codes to readable names for the prompt
  const langMap: Record<string, string> = {
    'zh': 'Chinese (Simplified)',
    'en': 'English',
    'ja': 'Japanese',
    'ko': 'Korean'
  };
  const targetLang = langMap[language] || 'English';

  const requestBody = {
    contents: [{
      role: "user",
      parts: [{ text: `Original Prompt: ${originalPrompt}` }]
    }],
    systemInstruction: {
      // Append language and style instruction
      parts: [{ text: SORA_OPTIMIZATION_PROMPT + `\n\nIMPORTANT CONFIGURATION:\n1. TARGET LANGUAGE: The structured output (Action, Subject, Scene, etc.) MUST be written in ${targetLang}.\n2. VISUAL STYLE: The prompt descriptions MUST reflect the style "${style}".` }]
    }
  };

  try {
    const { data } = await axios.post(url, requestBody, { headers, signal });
    return data.candidates?.[0]?.content?.parts?.[0]?.text || "";
  } catch (err: any) {
    if (axios.isCancel(err)) throw err;
    console.error("Gemini API Error (Optimize):", err.response?.data || err.message);
    return originalPrompt;
  }
};
