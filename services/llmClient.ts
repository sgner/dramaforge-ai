import { SCRIPT_SYSTEM_PROMPT, SORA_OPTIMIZATION_PROMPT, NOVEL_EXPANSION_PROMPT, NOVEL_PREPROCESS_PROMPT, CONTINUE_STORY_PROMPT, EPISODE_SUMMARY_PROMPT } from "../constants";
import { Provider, ModelConfig, VisualSignature } from '../types';
import { buildLlmStreamRequest, consumeStream, parseIncrementalJson, extractLlmText, IncrementalScriptResult } from './apiAdapter';
import { api } from './apiClient';

const LANG_MAP: Record<string, string> = {
  'zh': 'Chinese (Simplified)',
  'en': 'English',
  'ja': 'Japanese',
  'ko': 'Korean'
};

interface LlmCallParams {
  prompt: string;
  systemInstruction?: string;
  temperature?: number;
  maxOutputTokens?: number;
  responseMimeType?: string;
}

const detectBodyFormat = (body: any): string => {
  if (body.contents && body.messages) return 'hybrid';
  if (body.contents) return 'gemini';
  if (body.messages) return 'openai';
  return 'unknown';
};

const classifyError = (errorData: any): { needsGemini: boolean; needsOpenai: boolean; needsNoStream: boolean } => {
  const msg = (errorData.error?.message || errorData.message || '').toLowerCase();
  const code = (errorData.error?.code || errorData.code || '').toLowerCase();

  return {
    needsGemini: msg.includes('contents is required') || code.includes('invalid_gemini'),
    needsOpenai: msg.includes('messages is required') || code.includes('invalid_openai') || msg.includes('模型名称不能为空') || msg.includes('model name'),
    needsNoStream: false
  };
};

const startStream = async (
  provider: Provider,
  model: ModelConfig,
  params: LlmCallParams,
  signal?: AbortSignal
): Promise<Response> => {
  const req = buildLlmStreamRequest(provider, model, params);

  console.log('[LLM]', {
    url: req.url,
    provider: provider.id,
    model: model.modelName,
    format: model.apiFormat,
    bodyFormat: detectBodyFormat(req.body),
    bodyKeys: Object.keys(req.body),
    stream: req.body.stream,
  });

  let response = await fetch(req.url, {
    method: 'POST',
    headers: req.headers,
    body: JSON.stringify(req.body),
    signal
  });

  if (response.status === 400) {
    const errorText = await response.clone().text();
    console.warn('[LLM] 400:', errorText);

    let errorData: any = {};
    try { errorData = JSON.parse(errorText); } catch {}

    const { needsGemini, needsOpenai } = classifyError(errorData);
    const currentFormat = detectBodyFormat(req.body);

    if (needsGemini && currentFormat === 'openai') {
      console.warn('[LLM] Retrying with Gemini format...');
      const retryReq = buildLlmStreamRequest(provider, { ...model, apiFormat: 'gemini' as const }, params);
      response = await fetch(retryReq.url, {
        method: 'POST',
        headers: retryReq.headers,
        body: JSON.stringify(retryReq.body),
        signal
      });
    } else if (needsOpenai && currentFormat === 'gemini') {
      console.warn('[LLM] Retrying with OpenAI format...');
      const retryReq = buildLlmStreamRequest(provider, { ...model, apiFormat: 'openai' as const }, params);
      response = await fetch(retryReq.url, {
        method: 'POST',
        headers: retryReq.headers,
        body: JSON.stringify(retryReq.body),
        signal
      });
    } else if (req.body.stream) {
      console.warn('[LLM] Retrying without stream...');
      response = await fetch(req.url, {
        method: 'POST',
        headers: req.headers,
        body: JSON.stringify({ ...req.body, stream: false }),
        signal
      });
    }
  }

  if (!response.ok) {
    const errorText = await response.text();
    console.error('[LLM Error]', response.status, errorText);
    let errorMessage = `LLM API Error (${response.status})`;
    try {
      const errorJson = JSON.parse(errorText);
      errorMessage = errorJson.error?.message || errorJson.message || errorMessage;
    } catch {
      errorMessage = errorText || errorMessage;
    }
    throw new Error(errorMessage);
  }

  const contentType = response.headers.get('content-type') || '';
  const isSSE = contentType.includes('text/event-stream') || req.body.stream === true;

  if (!isSSE) {
    const text = await response.text();
    let content = '';
    try {
      const json = JSON.parse(text);
      content = extractLlmText(model, json);
    } catch {
      content = text;
    }
    return new Response(
      new ReadableStream({
        start(controller) {
          const encoder = new TextEncoder();
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`));
          controller.enqueue(encoder.encode('data: [DONE]\n\n'));
          controller.close();
        }
      }),
      { headers: new Headers({ 'content-type': 'text/event-stream' }) }
    );
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

export const generateEpisodeSummary = async function* (
  provider: Provider,
  model: ModelConfig,
  novelText: string,
  scriptAnalysis: string,
  signal?: AbortSignal
): AsyncGenerator<string> {
  const context = novelText.slice(-12000);
  const analysis = scriptAnalysis || 'No analysis available';
  const response = await startStream(provider, model, {
    prompt: `[PREVIOUS EPISODE STORY]\n${context}\n\n[SCRIPT ANALYSIS]\n${analysis}`,
    systemInstruction: EPISODE_SUMMARY_PROMPT,
    temperature: 0.5
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
      const currentLens = [
        parsed.visualSignature ? 1 : 0,
        parsed.sequences?.length || 0,
        parsed.characters?.length || 0,
        parsed.props?.length || 0,
        parsed.script?.length || 0,
        parsed.bigShots?.length || 0,
        parsed.soundDesign ? 1 : 0,
        parsed.rhythmAnalysis ? 1 : 0
      ].join(',');
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
  visualSignature?: VisualSignature,
  signal?: AbortSignal,
  characters?: { name: string; gender?: string }[]
): AsyncGenerator<string> {
  const targetLang = LANG_MAP[language] || 'English';
  let vsContext = '';
  if (visualSignature) {
    vsContext = `\n\n[VISUAL SIGNATURE — INHERIT THIS]\n${JSON.stringify(visualSignature, null, 2)}`;
  }
  let charContext = '';
  if (characters && characters.length > 0) {
    const charLines = characters.map(c => `- ${c.name}${c.gender ? ` (${c.gender})` : ''}`).join('\n');
    charContext = `\n\n[CHARACTER GENDER REFERENCE — USE IN DIALOGUE]\nWhen generating Dialogue lines, you MUST prefix each line with the speaker's name and gender tag like: "Dialogue: {CharacterName}({Gender}): {line}". This ensures the video generation model uses the correct voice gender.\n${charLines}`;
  }
  const response = await startStream(provider, model, {
    prompt: `Original Prompt: ${originalPrompt}${vsContext}${charContext}`,
    systemInstruction: SORA_OPTIMIZATION_PROMPT + `\n\nIMPORTANT CONFIGURATION:\n1. TARGET LANGUAGE: The structured output (Action, Subject, Scene, etc.) MUST be written in ${targetLang}.\n2. VISUAL STYLE: The prompt descriptions MUST reflect the style "${style}".${visualSignature ? '\n3. VISUAL SIGNATURE: You MUST inherit the Visual Signature provided in the prompt.' : ''}${characters && characters.length > 0 ? '\n4. CHARACTER GENDER: When writing Dialogue, prefix with "CharacterName(Gender):" to ensure correct voice gender in video generation.' : ''}`
  }, signal);

  yield* consumeStream(response, model);
};

/**
 * 后端代理版提示词优化：与 optimizeSoraPrompt 相同的 system instruction，
 * 但调用走后端 /api/llm/generate（api_key 只存后端 DB）。
 * 解决前端直连时 store 里 apiKey 为空（列表脱敏后清空）或 localStorage
 * 过期值导致上游 401"无效的令牌"的问题。
 */
export const optimizeSoraPromptViaBackend = async (
  providerId: string,
  modelName: string,
  originalPrompt: string,
  style: string,
  language: string = 'en',
  visualSignature?: VisualSignature,
  characters?: { name: string; gender?: string }[],
): Promise<string> => {
  const targetLang = LANG_MAP[language] || 'English';
  let vsContext = '';
  if (visualSignature) {
    vsContext = `\n\n[VISUAL SIGNATURE — INHERIT THIS]\n${JSON.stringify(visualSignature, null, 2)}`;
  }
  let charContext = '';
  if (characters && characters.length > 0) {
    const charLines = characters.map(c => `- ${c.name}${c.gender ? ` (${c.gender})` : ''}`).join('\n');
    charContext = `\n\n[CHARACTER GENDER REFERENCE — USE IN DIALOGUE]\nWhen generating Dialogue lines, you MUST prefix each line with the speaker's name and gender tag like: "Dialogue: {CharacterName}({Gender}): {line}". This ensures the video generation model uses the correct voice gender.\n${charLines}`;
  }
  const { text } = await api.generateText({
    provider_id: providerId,
    model: modelName,
    prompt: `Original Prompt: ${originalPrompt}${vsContext}${charContext}`,
    system_instruction: SORA_OPTIMIZATION_PROMPT + `\n\nIMPORTANT CONFIGURATION:\n1. TARGET LANGUAGE: The structured output (Action, Subject, Scene, etc.) MUST be written in ${targetLang}.\n2. VISUAL STYLE: The prompt descriptions MUST reflect the style "${style}".${visualSignature ? '\n3. VISUAL SIGNATURE: You MUST inherit the Visual Signature provided in the prompt.' : ''}${characters && characters.length > 0 ? '\n4. CHARACTER GENDER: When writing Dialogue, prefix with "CharacterName(Gender):" to ensure correct voice gender in video generation.' : ''}`,
  });
  return text;
};
