import axios from 'axios';
import { Provider, ModelConfig, ApiFormat } from '../types';

export interface LlmRequestParams {
  prompt: string;
  systemInstruction?: string;
  temperature?: number;
  maxOutputTokens?: number;
  responseMimeType?: string;
}

const resolveApiPath = (model: ModelConfig): string => {
  const apiPath = (model.apiPath || '').trim().replace(/`/g, '');
  return apiPath.replace('{model}', model.modelName);
};

const getTemplateContext = (provider: Provider, model: ModelConfig, extra?: Record<string, any>): Record<string, any> => {
  return {
    model: model.modelName,
    apiKey: provider.apiKey ? provider.apiKey.trim() : '',
    baseUrl: provider.baseUrl ? provider.baseUrl.trim().replace(/\/+$/, '') : '',
    ...extra
  };
};

const renderTemplate = (template: string, ctx: Record<string, any>): string => {
  let result = template;

  result = result.replace(/\{\{#if\s+(\w+)\}\}([\s\S]*?)\{\{\/if\}\}/g, (_, key, content) => {
    const val = ctx[key];
    if (val && (!Array.isArray(val) || val.length > 0)) {
      return renderTemplate(content, ctx);
    }
    return '';
  });

  result = result.replace(/\{\{#each\s+(\w+)\}\}([\s\S]*?)\{\{\/each\}\}/g, (_, key, content) => {
    const arr = ctx[key];
    if (!Array.isArray(arr)) return '';
    return arr.map((item: any, index: number) => {
      const itemCtx = { ...ctx, this: item, index, '@index': index };
      return renderTemplate(content, itemCtx).replace(/\{\{this\}\}/g, String(item));
    }).join('');
  });

  result = result.replace(/\{\{(\w+)\}\}/g, (_, key) => {
    const val = ctx[key];
    if (val === undefined) return '';
    if (typeof val === 'object') return JSON.stringify(val);
    return String(val);
  });

  return result;
};

const resolveJsonPath = (data: any, path: string): any => {
  if (!path || !data) return data;
  const segments = path.split('.');
  let current = data;
  for (const seg of segments) {
    if (current === null || current === undefined) return undefined;
    const indexMatch = seg.match(/^(\d+)$/);
    if (indexMatch) {
      current = current[parseInt(indexMatch[1])];
    } else {
      current = current[seg];
    }
  }
  return current;
};

export const buildUrl = (provider: Provider, model: ModelConfig): string => {
  const cleanBaseUrl = provider.baseUrl ? provider.baseUrl.trim().replace(/`/g, '').replace(/\/+$/, '') : '';

  let defaultHost = '';
  if (model.apiFormat === 'gemini') {
    defaultHost = 'https://generativelanguage.googleapis.com';
  } else if (model.apiFormat === 'openai-image') {
    defaultHost = 'https://api.nanobanana.com/v1';
  } else if (model.apiFormat === 'openai-video') {
    defaultHost = 'https://api.sora.com/v1';
  } else {
    defaultHost = 'https://api.openai.com/v1';
  }

  const host = cleanBaseUrl.length > 0 ? cleanBaseUrl : defaultHost;
  const apiPath = resolveApiPath(model);
  return `${host}${apiPath}`;
};

export const buildHeaders = (provider: Provider, model: ModelConfig, extraCtx?: Record<string, any>): Record<string, string> => {
  if (model.apiFormat === 'custom' && model.customHeaders) {
    try {
      const ctx = getTemplateContext(provider, model, extraCtx);
      const rendered = renderTemplate(model.customHeaders, ctx);
      return JSON.parse(rendered);
    } catch (e) {
      console.error('Failed to parse custom headers:', e);
    }
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json'
  };

  const cleanKey = provider.apiKey ? provider.apiKey.trim().replace(/`/g, '') : '';
  if (cleanKey) {
    headers['Authorization'] = `Bearer ${cleanKey}`;
  }

  return headers;
};

export const buildApiKeyQueryParam = (provider: Provider, model: ModelConfig): string => {
  const cleanKey = provider.apiKey ? provider.apiKey.trim().replace(/`/g, '') : '';

  if (model.apiFormat === 'gemini') {
    const apiPath = (model.apiPath || '').toLowerCase();
    const isOfficialGeminiPath = apiPath.includes(':generatecontent') || apiPath.includes(':streamgeneratecontent');
    if (isOfficialGeminiPath && cleanKey) {
      return `key=${encodeURIComponent(cleanKey)}`;
    }
  }

  return '';
};

export const buildLlmRequestBody = (model: ModelConfig, params: LlmRequestParams, provider?: Provider): any => {
  const format = model.apiFormat || 'openai';
  console.log('[buildLlmRequestBody] format:', format, 'prompt length:', params.prompt?.length, 'systemInstruction length:', params.systemInstruction?.length);

  if (format === 'custom' && model.customBodyTemplate) {
    try {
      const ctx: Record<string, any> = {
        prompt: params.prompt,
        systemInstruction: params.systemInstruction || '',
        temperature: params.temperature ?? 0.7,
        maxOutputTokens: params.maxOutputTokens || 4096,
        responseMimeType: params.responseMimeType || 'text/plain',
        ...(provider ? getTemplateContext(provider, model) : {})
      };
      const rendered = renderTemplate(model.customBodyTemplate, ctx);
      return JSON.parse(rendered);
    } catch (e) {
      console.error('Failed to parse custom body template:', e);
      throw new Error('Custom body template is invalid JSON. Please check your template.');
    }
  }

  if (format === 'openai') {
    const messages: any[] = [];
    if (params.systemInstruction) {
      messages.push({ role: 'system', content: params.systemInstruction });
    }
    if (params.responseMimeType === 'application/json') {
      const lastMsg = messages[messages.length - 1];
      if (lastMsg) {
        lastMsg.content += '\n\nYou MUST respond with valid JSON only. Do not include any text outside the JSON structure.';
      } else {
        messages.push({ role: 'system', content: 'You MUST respond with valid JSON only. Do not include any text outside the JSON structure.' });
      }
    }
    messages.push({ role: 'user', content: params.prompt });

    const body: any = {
      model: model.modelName,
      messages,
      temperature: params.temperature ?? 0.7
    };

    if (params.maxOutputTokens) {
      body.max_tokens = params.maxOutputTokens;
    }

    const isOfficialOpenAI = provider?.baseUrl?.includes('api.openai.com');
    if (params.responseMimeType === 'application/json' && isOfficialOpenAI) {
      body.response_format = { type: 'json_object' };
    }

    const modelNameLower = (model.modelName || '').toLowerCase();
    const isGeminiModel = modelNameLower.includes('gemini');
    const isGeminiProxy = isGeminiModel && !(model.apiPath || '').includes(':generateContent');
    if (isGeminiProxy) {
      body.contents = [{
        role: 'user',
        parts: [{ text: params.prompt }]
      }];
      body.generationConfig = { temperature: params.temperature ?? 0.7 };
      if (params.systemInstruction) {
        body.systemInstruction = { parts: [{ text: params.systemInstruction }] };
      }
      if (params.maxOutputTokens) {
        body.generationConfig.maxOutputTokens = params.maxOutputTokens;
      }
      if (params.responseMimeType) {
        body.generationConfig.responseMimeType = params.responseMimeType;
      }
    }

    return body;
  }

  if (format === 'gemini') {
    const body: any = {
      contents: [{
        role: 'user',
        parts: [{ text: params.prompt }]
      }],
      generationConfig: {
        temperature: params.temperature ?? 0.7
      }
    };

    if (params.systemInstruction) {
      body.systemInstruction = {
        parts: [{ text: params.systemInstruction }]
      };
    }

    if (params.maxOutputTokens) {
      body.generationConfig.maxOutputTokens = params.maxOutputTokens;
    }

    if (params.responseMimeType) {
      body.generationConfig.responseMimeType = params.responseMimeType;
    }

    return body;
  }

  return { prompt: params.prompt };
};

export const extractLlmText = (model: ModelConfig, data: any): string => {
  const format = model.apiFormat || 'openai';
  const isOfficialGemini = format === 'gemini' && (model.apiPath || '').includes(':generateContent');

  if (format === 'custom' && model.customResponsePath) {
    const result = resolveJsonPath(data, model.customResponsePath);
    if (typeof result === 'string') return result;
    if (result) return JSON.stringify(result);
    return '';
  }

  if (format === 'openai' || (format === 'gemini' && !isOfficialGemini)) {
    if (data?.choices?.[0]?.message?.content) return data.choices[0].message.content;
    if (data?.candidates?.[0]?.content?.parts?.[0]?.text) return data.candidates[0].content.parts[0].text;
    return '';
  }

  if (format === 'gemini') {
    return data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
  }

  return '';
};

export const buildLlmRequest = (provider: Provider, model: ModelConfig, params: LlmRequestParams) => {
  let url = buildUrl(provider, model);
  const headers = buildHeaders(provider, model, {
    prompt: params.prompt,
    systemInstruction: params.systemInstruction || ''
  });
  const body = buildLlmRequestBody(model, params, provider);

  const keyParam = buildApiKeyQueryParam(provider, model);
  if (keyParam) {
    const separator = url.includes('?') ? '&' : '?';
    url = `${url}${separator}${keyParam}`;
  }

  return { url, headers, body };
};

export const buildImageRequestBody = (model: ModelConfig, prompt: string, options?: {
  size?: string;
  n?: number;
  responseFormat?: string;
  aspectRatio?: string;
}, provider?: Provider): any => {
  const format = model.apiFormat || 'openai-image';

  if (format === 'custom' && model.customBodyTemplate) {
    try {
      const ctx: Record<string, any> = {
        prompt,
        size: options?.size || '1024x1024',
        n: options?.n ?? 1,
        responseFormat: options?.responseFormat || 'url',
        aspectRatio: options?.aspectRatio || '',
        ...(provider ? getTemplateContext(provider, model) : {})
      };
      const rendered = renderTemplate(model.customBodyTemplate, ctx);
      return JSON.parse(rendered);
    } catch (e) {
      console.error('Failed to parse custom body template:', e);
      throw new Error('Custom body template is invalid JSON.');
    }
  }

  if (format === 'openai-image') {
    return {
      model: model.modelName,
      prompt,
      n: options?.n ?? 1,
      size: options?.size || '1024x1024',
      response_format: options?.responseFormat || 'url',
      ...(options?.aspectRatio ? { aspect_ratio: options.aspectRatio } : {})
    };
  }

  return { model: model.modelName, prompt };
};

export const buildVideoRequestBody = (model: ModelConfig, prompt: string, options?: {
  aspectRatio?: string;
  duration?: string;
  hd?: boolean;
  images?: string[];
}, provider?: Provider): any => {
  const format = model.apiFormat || 'openai-video';

  if (format === 'custom' && model.customBodyTemplate) {
    try {
      const ctx: Record<string, any> = {
        prompt,
        aspectRatio: options?.aspectRatio || '16:9',
        duration: options?.duration || '15',
        hd: options?.hd ?? true,
        images: options?.images || [],
        ...(provider ? getTemplateContext(provider, model) : {})
      };
      const rendered = renderTemplate(model.customBodyTemplate, ctx);
      return JSON.parse(rendered);
    } catch (e) {
      console.error('Failed to parse custom body template:', e);
      throw new Error('Custom body template is invalid JSON.');
    }
  }

  if (format === 'openai-video') {
    return {
      prompt,
      model: model.modelName,
      aspect_ratio: options?.aspectRatio || '16:9',
      hd: options?.hd ?? true,
      duration: options?.duration || '15',
      watermark: false,
      private: true,
      images: options?.images || []
    };
  }

  return { model: model.modelName, prompt };
};

export const extractVideoTaskId = (model: ModelConfig, data: any): string | null => {
  if (model.apiFormat === 'custom' && model.customResponsePath) {
    const result = resolveJsonPath(data, model.customResponsePath);
    if (typeof result === 'string') return result;
    return null;
  }

  if (data?.task_id) return data.task_id;
  if (data?.id) return data.id;
  return null;
};

export const buildPollUrl = (provider: Provider, model: ModelConfig, taskId: string): string => {
  const format = model.apiFormat || 'openai-video';

  if (format === 'custom') {
    const cleanBaseUrl = provider.baseUrl ? provider.baseUrl.trim().replace(/\/+$/, '') : '';
    const host = cleanBaseUrl || buildUrl(provider, model).split('/api/')[0] || '';
    const pollPath = model.pollApiPath || model.apiPath || '';
    if (pollPath.includes('{taskId}')) {
      return `${host}${pollPath.replace('{taskId}', taskId)}`;
    }
    const lastSegment = pollPath.split('/').pop();
    if (lastSegment && lastSegment.includes('{')) {
      return `${host}${pollPath.replace(/\{[^}]*\}/g, taskId)}`;
    }
    return `${host}${pollPath}/${taskId}`;
  }

  if (format === 'openai-video') {
    let pollPath = model.apiPath || '/video/generations';
    const lastSegment = pollPath.split('/').pop();
    if (lastSegment && lastSegment.includes('{')) {
      pollPath = pollPath.replace(/\{[^}]*\}/g, taskId);
    } else {
      pollPath = `${pollPath}/${taskId}`;
    }
    const cleanBaseUrl = provider.baseUrl ? provider.baseUrl.trim().replace(/\/+$/, '') : '';
    const isCustomBase = cleanBaseUrl.length > 0 && !cleanBaseUrl.includes('api.openai.com');
    const host = isCustomBase ? cleanBaseUrl : 'https://api.sora.com/v1';
    return `${host}${pollPath}`;
  }

  return buildUrl(provider, model) + `/${taskId}`;
};

export const buildLlmStreamRequest = (provider: Provider, model: ModelConfig, params: LlmRequestParams) => {
  const format = model.apiFormat || 'openai';
  let url = buildUrl(provider, model);
  const headers = buildHeaders(provider, model, {
    prompt: params.prompt,
    systemInstruction: params.systemInstruction || ''
  });

  const isOfficialGemini = format === 'gemini' && (model.apiPath || '').includes(':generateContent');

  if (isOfficialGemini) {
    const keyParam = buildApiKeyQueryParam(provider, model);
    const separator = url.includes('?') ? '&' : '?';
    url = `${url}${separator}alt=sse`;
    if (keyParam) {
      url = `${url}&${keyParam}`;
    }
  } else {
    const keyParam = buildApiKeyQueryParam(provider, model);
    if (keyParam) {
      const separator = url.includes('?') ? '&' : '?';
      url = `${url}${separator}${keyParam}`;
    }
  }

  const streamParams = { ...params };
  const body = buildLlmRequestBody(model, streamParams, provider);

  if (format === 'openai') {
    body.stream = true;
  } else if (format === 'gemini') {
    if (!isOfficialGemini) {
      body.stream = true;
    }
  } else if (format === 'custom') {
    if (typeof body === 'object' && body !== null) {
      body.stream = true;
    }
  }

  if (format === 'gemini' && !isOfficialGemini && model.modelName) {
    body.model = model.modelName;

    const messages: any[] = [];
    if (params.systemInstruction) {
      messages.push({ role: 'system', content: params.systemInstruction });
    }
    messages.push({ role: 'user', content: params.prompt });
    body.messages = messages;
  }

  return { url, headers, body };
};

export const parseStreamChunk = (model: ModelConfig, chunk: string): string => {
  const format = model.apiFormat || 'openai';
  const isOfficialGemini = format === 'gemini' && (model.apiPath || '').includes(':generateContent');

  if (format === 'custom' && model.customResponsePath) {
    try {
      const parsed = JSON.parse(chunk);
      const result = resolveJsonPath(parsed, model.customResponsePath);
      if (typeof result === 'string') return result;
      if (result) return JSON.stringify(result);
    } catch {
    }
    return '';
  }

  if (format === 'openai' || (format === 'gemini' && !isOfficialGemini)) {
    try {
      const parsed = JSON.parse(chunk);
      if (parsed?.choices?.[0]?.delta?.content !== undefined) {
        return parsed.choices[0].delta.content;
      }
      if (parsed?.candidates?.[0]?.content?.parts?.[0]?.text) {
        return parsed.candidates[0].content.parts[0].text;
      }
      return '';
    } catch {
      return '';
    }
  }

  if (format === 'gemini') {
    try {
      const parsed = JSON.parse(chunk);
      return parsed?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    } catch {
      return '';
    }
  }

  return '';
};

export const consumeStream = async function* (
  response: Response,
  model: ModelConfig
): AsyncGenerator<string> {
  const reader = response.body?.getReader();
  if (!reader) return;

  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith(':')) continue;
        if (trimmed === 'data: [DONE]') continue;

        if (trimmed.startsWith('data: ')) {
          const jsonStr = trimmed.slice(6);
          const text = parseStreamChunk(model, jsonStr);
          if (text) yield text;
        }
      }
    }

    if (buffer.trim()) {
      const trimmed = buffer.trim();
      if (trimmed.startsWith('data: ') && trimmed !== 'data: [DONE]') {
        const jsonStr = trimmed.slice(6);
        const text = parseStreamChunk(model, jsonStr);
        if (text) yield text;
      }
    }
  } finally {
    reader.releaseLock();
  }
};

export interface IncrementalScriptResult {
  analysis?: { corePlot: string; mood: string };
  visualSignature?: any;
  sequences?: any[];
  soundDesign?: any;
  rhythmAnalysis?: any;
  characters?: any[];
  props?: any[];
  sceneAssets?: any[];
  script?: any[];
  bigShots?: any[];
  worldAnchors?: any[];
  dialogueList?: any[];
  vfxBudget?: any;
  _rawLength: number;
}

export const parseIncrementalJson = (rawText: string): IncrementalScriptResult | null => {
  let text = rawText.replace(/^```json\s*/, '').replace(/\s*```$/, '').trim();
  if (!text) return null;

  const jsonStart = text.indexOf('{');
  if (jsonStart < 0) return null;
  if (jsonStart > 0) text = text.substring(jsonStart);

  try {
    const parsed = JSON.parse(text);
    return { ...parsed, _rawLength: rawText.length };
  } catch {}

  const stack: string[] = [];
  let inString = false;
  let escapeNext = false;

  interface SafePoint {
    pos: number;
    stackSnapshot: string[];
  }
  const safePoints: SafePoint[] = [];

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    if (escapeNext) {
      escapeNext = false;
      continue;
    }

    if (inString) {
      if (ch === '\\') {
        escapeNext = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
    } else if (ch === '{' || ch === '[') {
      stack.push(ch);
    } else if (ch === '}') {
      if (stack.length > 0 && stack[stack.length - 1] === '{') {
        stack.pop();
        if (stack.length <= 2) {
          safePoints.push({ pos: i, stackSnapshot: [...stack] });
        }
      }
    } else if (ch === ']') {
      if (stack.length > 0 && stack[stack.length - 1] === '[') {
        stack.pop();
        if (stack.length <= 2) {
          safePoints.push({ pos: i, stackSnapshot: [...stack] });
        }
      }
    }
  }

  for (let i = safePoints.length - 1; i >= 0; i--) {
    const point = safePoints[i];
    let repaired = text.substring(0, point.pos + 1);

    repaired = repaired.replace(/,\s*$/, '');

    for (let j = point.stackSnapshot.length - 1; j >= 0; j--) {
      repaired += point.stackSnapshot[j] === '{' ? '}' : ']';
    }

    try {
      const parsed = JSON.parse(repaired);
      return { ...parsed, _rawLength: rawText.length };
    } catch {}
  }

  return null;
};
