
export enum TaskStatus {
  IDLE = 'IDLE',
  PREPROCESSING = 'PREPROCESSING',
  SCRIPT_GENERATION = 'SCRIPT_GENERATION',
  CHARACTER_DESIGN = 'CHARACTER_DESIGN',
  STORYBOARDING = 'STORYBOARDING',
  PROMPT_OPTIMIZATION = 'PROMPT_OPTIMIZATION',
  VIDEO_GENERATION = 'VIDEO_GENERATION',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
  CANCELLED = 'CANCELLED'
}

export enum ArtStyle {
  ANIMATION = 'Animation (2D)',
  REALISTIC = 'Cinematic Realistic',
  CYBERPUNK = 'Cyberpunk',
  WATERCOLOR = 'Watercolor',
  PIXAR = '3D Cartoon'
}

export type Language = 'en' | 'zh' | 'ja' | 'ko';
export type TaskMode = 'auto' | 'manual';

export type ProviderType = 'official' | 'custom' | 'relay';
export type ProviderCategory = 'llm' | 'image' | 'video';
export type ApiFormat = 'gemini' | 'openai' | 'openai-image' | 'openai-video' | 'custom';

export interface Provider {
  id: string;
  name: string;
  type: ProviderType;
  category: ProviderCategory;
  apiKey: string;
  baseUrl: string;
  enabled: boolean;
}

export interface ModelConfig {
  id: string;
  providerId: string;
  modelName: string;
  displayName: string;
  apiPath: string;
  apiFormat: ApiFormat;
  customHeaders: string;
  customBodyTemplate: string;
  customResponsePath: string;
  pollApiPath: string;
  enabled: boolean;
}

export type StepType = 
  | 'preprocessing'
  | 'scriptGeneration'
  | 'characterDesign'
  | 'storyboarding'
  | 'promptOptimization'
  | 'videoGeneration';

export interface StepModelBinding {
  step: StepType;
  modelId: string;
}

export interface ApiConfig {
  providers: Provider[];
  models: ModelConfig[];
  stepBindings: StepModelBinding[];
}

export const DEFAULT_PROVIDERS: Provider[] = [
  {
    id: 'google-gemini',
    name: 'Google Gemini',
    type: 'official',
    category: 'llm',
    apiKey: '',
    baseUrl: 'https://generativelanguage.googleapis.com',
    enabled: true
  },
  {
    id: 'nanobanana',
    name: 'Nanobanana',
    type: 'official',
    category: 'image',
    apiKey: '',
    baseUrl: 'https://api.nanobanana.com',
    enabled: true
  },
  {
    id: 'sora',
    name: 'Sora',
    type: 'official',
    category: 'video',
    apiKey: '',
    baseUrl: 'https://api.sora.com',
    enabled: true
  }
];

export const DEFAULT_MODELS: ModelConfig[] = [
  {
    id: 'gemini-3-pro',
    providerId: 'google-gemini',
    modelName: 'gemini-3-pro-preview',
    displayName: 'Gemini 3 Pro',
    apiPath: '/v1beta/models/{model}:generateContent',
    apiFormat: 'gemini',
    customHeaders: '',
    customBodyTemplate: '',
    customResponsePath: '',
    pollApiPath: '',
    enabled: true
  },
  {
    id: 'nano-banana',
    providerId: 'nanobanana',
    modelName: 'nano-banana',
    displayName: 'Nano Banana',
    apiPath: '/v1/images/generations',
    apiFormat: 'openai-image',
    customHeaders: '',
    customBodyTemplate: '',
    customResponsePath: '',
    pollApiPath: '',
    enabled: true
  },
  {
    id: 'sora-2',
    providerId: 'sora',
    modelName: 'sora-2',
    displayName: 'Sora 2',
    apiPath: '/v2/videos/generations',
    apiFormat: 'openai-video',
    customHeaders: '',
    customBodyTemplate: '',
    customResponsePath: '',
    pollApiPath: '',
    enabled: true
  }
];

export const DEFAULT_STEP_BINDINGS: StepModelBinding[] = [
  { step: 'preprocessing', modelId: 'gemini-3-pro' },
  { step: 'scriptGeneration', modelId: 'gemini-3-pro' },
  { step: 'characterDesign', modelId: 'nano-banana' },
  { step: 'storyboarding', modelId: 'nano-banana' },
  { step: 'promptOptimization', modelId: 'gemini-3-pro' },
  { step: 'videoGeneration', modelId: 'sora-2' }
];

export const STEP_LABELS: Record<StepType, string> = {
  preprocessing: 'Preprocessing',
  scriptGeneration: 'Script Generation',
  characterDesign: 'Character Design',
  storyboarding: 'Storyboarding',
  promptOptimization: 'Prompt Optimization',
  videoGeneration: 'Video Generation'
};

export function createDefaultApiConfig(): ApiConfig {
  return {
    providers: DEFAULT_PROVIDERS.map(p => ({ ...p })),
    models: DEFAULT_MODELS.map(m => ({ ...m })),
    stepBindings: DEFAULT_STEP_BINDINGS.map(b => ({ ...b }))
  };
}

export function getProviderForModel(config: ApiConfig, modelId: string): Provider | undefined {
  const model = config.models.find(m => m.id === modelId);
  if (!model) return undefined;
  return config.providers.find(p => p.id === model.providerId);
}

export function getModelForStep(config: ApiConfig, step: StepType): ModelConfig | undefined {
  const binding = config.stepBindings.find(b => b.step === step);
  if (!binding) return undefined;
  return config.models.find(m => m.id === binding.modelId);
}

export function getProviderForStep(config: ApiConfig, step: StepType): Provider | undefined {
  const model = getModelForStep(config, step);
  if (!model) return undefined;
  return getProviderForModel(config, model.id);
}

export interface Character {
  name: string;
  visualFeatures: string;
  clothing: string;
  voice: string;
  threeViewImg?: string; // URL of the generated design sheet
  referenceImage?: string; // URL/Blob of user uploaded reference
  generationStatus?: string; // Status for individual regeneration
}

export interface ScriptScene {
  location: string;
  time: string;
  environment: string;
  dialogue: {
    speaker: string;
    line: string;
    action: string;
    emotion: string;
  }[];
}

export interface BigShot {
  id: string;
  includedDialogues: string[];
  environmentAnchor?: string;
  
  // New Fields for 6-Grid Logic
  storyboardPrompt: string; // The description of the 6 panels
  storyboardImageUrl?: string; // The generated 6-grid image URL
  charactersInvolved: string[]; // List of character names present in this shot
  
  soraPrompt: string;
  soraPromptOptimized?: string;
  videoUrl?: string;
  generationStatus?: string; // To show realtime progress (e.g. "processing", "50%")
  
  // Tree/Parallel Logic
  parentId?: string | null; // ID of the parent shot (null for root)
  childrenIds?: string[]; // IDs of shots that follow this one
  order?: number; // Sort order
}

export interface ProcessedSegment {
  id: string;
  name: string;
  content: string;
  index: number;
}

export interface DramaTask {
  id: string;
  name: string;
  style: ArtStyle;
  language: Language;
  mode: TaskMode; 
  sourceType: 'novel' | 'idea'; // New field to distinguish input type
  coverImage?: string;
  createdAt: number;
  
  status: TaskStatus;
  stepStatus: 'idle' | 'processing' | 'completed'; // Track step completion for manual mode
  
  progress: number; // 0-100
  error?: string; // Error message
  failedStep?: TaskStatus; // The step where it failed
  
  // Data
  rawNovelText: string; // Stores either the novel or the expanded story
  originalIdea?: string; // Stores the initial idea if sourceType is 'idea'
  
  // Segmentation for long texts
  segments?: ProcessedSegment[];

  scriptAnalysis?: {
    corePlot: string;
    mood: string;
  };
  characters: Character[];
  script?: ScriptScene[];
  bigShots: BigShot[];
}

export interface GenerationStep {
  id: string;
  label: string;
  status: 'pending' | 'loading' | 'success' | 'error';
}
