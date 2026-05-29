import axios from 'axios';
import { SCRIPT_SYSTEM_PROMPT, SORA_OPTIMIZATION_PROMPT, NOVEL_EXPANSION_PROMPT, NOVEL_PREPROCESS_PROMPT, CONTINUE_STORY_PROMPT } from "../constants";
import { Provider, ModelConfig } from '../types';
import { buildLlmRequest, extractLlmText } from './apiAdapter';

const LANG_MAP: Record<string, string> = {
  'zh': 'Chinese (Simplified)',
  'en': 'English',
  'ja': 'Japanese',
  'ko': 'Korean'
};

export const expandIdeaToStory = async (
  provider: Provider,
  model: ModelConfig,
  idea: string,
  language: string = 'zh',
  signal?: AbortSignal
) => {
  const targetLang = LANG_MAP[language] || 'English';
  const { url, headers, body } = buildLlmRequest(provider, model, {
    prompt: idea,
    systemInstruction: `targetlang:${targetLang}\n${NOVEL_EXPANSION_PROMPT}`,
    temperature: 0.85,
    maxOutputTokens: 8192
  });

  try {
    const { data } = await axios.post(url, body, { headers, signal });
    return extractLlmText(model, data) || "";
  } catch (err: any) {
    if (axios.isCancel(err)) throw err;
    console.error("LLM API Error (Expansion):", err.response?.data || err.message);
    throw err;
  }
};

export const preprocessNovel = async (
  provider: Provider,
  model: ModelConfig,
  rawText: string,
  language: string = 'zh',
  signal?: AbortSignal
) => {
  const targetLang = LANG_MAP[language] || 'English';
  const { url, headers, body } = buildLlmRequest(provider, model, {
    prompt: rawText,
    systemInstruction: `targetlang:${targetLang}\n ${NOVEL_PREPROCESS_PROMPT}`,
    temperature: 0.1,
    maxOutputTokens: 8192
  });

  try {
    const { data } = await axios.post(url, body, { headers, signal });
    return extractLlmText(model, data) || rawText;
  } catch (err: any) {
    if (axios.isCancel(err)) throw err;
    console.error("LLM API Error (Preprocess):", err.response?.data || err.message);
    throw err;
  }
};

export const continueStory = async (
  provider: Provider,
  model: ModelConfig,
  currentText: string,
  signal?: AbortSignal
) => {
  const context = currentText.slice(-15000);
  const { url, headers, body } = buildLlmRequest(provider, model, {
    prompt: context,
    systemInstruction: CONTINUE_STORY_PROMPT,
    temperature: 0.7
  });

  try {
    const { data } = await axios.post(url, body, { headers, signal });
    return extractLlmText(model, data) || "";
  } catch (err: any) {
    if (axios.isCancel(err)) throw err;
    console.error("LLM API Error (Continue):", err.response?.data || err.message);
    throw err;
  }
};

export const generateScriptFromNovel = async (
  provider: Provider,
  model: ModelConfig,
  novelText: string,
  style: string,
  language: string = 'zh',
  signal?: AbortSignal
) => {
  const targetLang = LANG_MAP[language] || 'Chinese';
  const { url, headers, body } = buildLlmRequest(provider, model, {
    prompt: novelText,
    systemInstruction: SCRIPT_SYSTEM_PROMPT + `\n\nIMPORTANT CONFIGURATION:\n1. TARGET LANGUAGE: All output (character names, descriptions, script dialogue, analysis) MUST be in ${targetLang}.\n2. VISUAL STYLE: The storyboard descriptions and character visual features MUST reflect the style "${style}".`,
    temperature: 0.7,
    responseMimeType: "application/json"
  });

  try {
    const { data } = await axios.post(url, body, { headers, signal });

    const contentText = extractLlmText(model, data);
    if (!contentText) throw new Error("No text content in response");

    const cleanJson = contentText.replace(/^```json\s*/, '').replace(/\s*```$/, '');
    return JSON.parse(cleanJson);
  } catch (err: any) {
    if (axios.isCancel(err)) throw err;
    console.error("LLM API Error (Script):", err.response?.data || err.message);
    throw err;
  }
};

export const optimizeSoraPrompt = async (
  provider: Provider,
  model: ModelConfig,
  originalPrompt: string,
  style: string,
  language: string = 'en',
  signal?: AbortSignal
) => {
  const targetLang = LANG_MAP[language] || 'English';
  const { url, headers, body } = buildLlmRequest(provider, model, {
    prompt: `Original Prompt: ${originalPrompt}`,
    systemInstruction: SORA_OPTIMIZATION_PROMPT + `\n\nIMPORTANT CONFIGURATION:\n1. TARGET LANGUAGE: The structured output (Action, Subject, Scene, etc.) MUST be written in ${targetLang}.\n2. VISUAL STYLE: The prompt descriptions MUST reflect the style "${style}".`
  });

  try {
    const { data } = await axios.post(url, body, { headers, signal });
    return extractLlmText(model, data) || "";
  } catch (err: any) {
    if (axios.isCancel(err)) throw err;
    console.error("LLM API Error (Optimize):", err.response?.data || err.message);
    return originalPrompt;
  }
};
