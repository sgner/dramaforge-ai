import { SCRIPT_SYSTEM_PROMPT, SORA_OPTIMIZATION_PROMPT, NOVEL_EXPANSION_PROMPT, NOVEL_PREPROCESS_PROMPT, CONTINUE_STORY_PROMPT } from "../constants";
import { Provider, ModelConfig } from '../types';
import { buildLlmStreamRequest, consumeStream, parseIncrementalJson, IncrementalScriptResult } from './apiAdapter';

const LANG_MAP: Record<string, string> = {
  'zh': 'Chinese (Simplified)',
  'en': 'English',
  'ja': 'Japanese',
  'ko': 'Korean'
};

const startStream = async (provider: Provider, model: ModelConfig, params: {
  prompt: string;
  systemInstruction?: string;
  temperature?: number;
  maxOutputTokens?: number;
  responseMimeType?: string;
}, signal?: AbortSignal) => {
  const { url, headers, body } = buildLlmStreamRequest(provider, model, params);

  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal
  });

  if (!response.ok) {
    const errorText = await response.text();
    let errorMessage = `LLM API Error (${response.status})`;
    try {
      const errorJson = JSON.parse(errorText);
      errorMessage = errorJson.error?.message || errorJson.message || errorMessage;
    } catch {
      errorMessage = errorText || errorMessage;
    }
    throw new Error(errorMessage);
  }

  return response;
};

export const expandIdeaToStory = async function* (
  provider: Provider,
  model: ModelConfig,
  idea: string,
  language: string = 'zh',
  signal?: AbortSignal
): AsyncGenerator<string> {
  const targetLang = LANG_MAP[language] || 'English';
  const response = await startStream(provider, model, {
    prompt: idea,
    systemInstruction: `targetlang:${targetLang}\n${NOVEL_EXPANSION_PROMPT}`,
    temperature: 0.85,
    maxOutputTokens: 8192
  }, signal);

  yield* consumeStream(response, model);
};

export const preprocessNovel = async function* (
  provider: Provider,
  model: ModelConfig,
  rawText: string,
  language: string = 'zh',
  signal?: AbortSignal
): AsyncGenerator<string> {
  const targetLang = LANG_MAP[language] || 'English';
  const response = await startStream(provider, model, {
    prompt: rawText,
    systemInstruction: `targetlang:${targetLang}\n ${NOVEL_PREPROCESS_PROMPT}`,
    temperature: 0.1,
    maxOutputTokens: 8192
  }, signal);

  yield* consumeStream(response, model);
};

export const continueStory = async function* (
  provider: Provider,
  model: ModelConfig,
  currentText: string,
  signal?: AbortSignal
): AsyncGenerator<string> {
  const context = currentText.slice(-15000);
  const response = await startStream(provider, model, {
    prompt: context,
    systemInstruction: CONTINUE_STORY_PROMPT,
    temperature: 0.7
  }, signal);

  yield* consumeStream(response, model);
};

export const generateScriptFromNovel = async function* (
  provider: Provider,
  model: ModelConfig,
  novelText: string,
  style: string,
  language: string = 'zh',
  signal?: AbortSignal
): AsyncGenerator<IncrementalScriptResult> {
  const targetLang = LANG_MAP[language] || 'Chinese';
  const response = await startStream(provider, model, {
    prompt: novelText,
    systemInstruction: SCRIPT_SYSTEM_PROMPT + `\n\nIMPORTANT CONFIGURATION:\n1. TARGET LANGUAGE: All output (character names, descriptions, script dialogue, analysis) MUST be in ${targetLang}.\n2. VISUAL STYLE: The storyboard descriptions and character visual features MUST reflect the style "${style}".`,
    temperature: 0.7,
    responseMimeType: "application/json"
  }, signal);

  let accumulated = '';
  let lastYieldedKeys = '';
  let lastYieldedArrayLens = '';

  for await (const chunk of consumeStream(response, model)) {
    accumulated += chunk;
    const parsed = parseIncrementalJson(accumulated);
    if (parsed) {
      const currentKeys = Object.keys(parsed).filter(k => !k.startsWith('_')).sort().join(',');
      const currentLens = [parsed.characters?.length || 0, parsed.script?.length || 0, parsed.bigShots?.length || 0].join(',');
      if (currentKeys !== lastYieldedKeys || currentLens !== lastYieldedArrayLens) {
        lastYieldedKeys = currentKeys;
        lastYieldedArrayLens = currentLens;
        yield parsed;
      }
    }
  }

  const cleanJson = accumulated.replace(/^```json\s*/, '').replace(/\s*```$/, '');
  try {
    const finalResult = JSON.parse(cleanJson);
    yield { ...finalResult, _rawLength: accumulated.length };
  } catch {
    const lastParsed = parseIncrementalJson(accumulated);
    if (lastParsed) yield lastParsed;
  }
};

export const optimizeSoraPrompt = async function* (
  provider: Provider,
  model: ModelConfig,
  originalPrompt: string,
  style: string,
  language: string = 'en',
  signal?: AbortSignal
): AsyncGenerator<string> {
  const targetLang = LANG_MAP[language] || 'English';
  const response = await startStream(provider, model, {
    prompt: `Original Prompt: ${originalPrompt}`,
    systemInstruction: SORA_OPTIMIZATION_PROMPT + `\n\nIMPORTANT CONFIGURATION:\n1. TARGET LANGUAGE: The structured output (Action, Subject, Scene, etc.) MUST be written in ${targetLang}.\n2. VISUAL STYLE: The prompt descriptions MUST reflect the style "${style}".`
  }, signal);

  yield* consumeStream(response, model);
};
