
export enum TaskStatus {
  IDLE = 'IDLE',
  PREPROCESSING = 'PREPROCESSING',
  SCRIPT_GENERATION = 'SCRIPT_GENERATION',
  CHARACTER_DESIGN = 'CHARACTER_DESIGN',
  PROP_DESIGN = 'PROP_DESIGN',
  SCENE_DESIGN = 'SCENE_DESIGN',
  STORYBOARDING = 'STORYBOARDING',
  PROMPT_OPTIMIZATION = 'PROMPT_OPTIMIZATION',
  VIDEO_GENERATION = 'VIDEO_GENERATION',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
  CANCELLED = 'CANCELLED'
}

/**
 * 任务流水线步骤顺序（单一事实源）。
 * App.tsx 自动推进、useTaskExecutor.proceedToNextStep、StepProgress 进度条
 * 都必须从这里 import，禁止再各自定义（历史上双定义不一致曾导致
 * auto 模式跳过 PROP_DESIGN/SCENE_DESIGN，且 indexOf 返回 -1 时流程回退到第一步）。
 */
export const LOGICAL_STEPS: TaskStatus[] = [
  TaskStatus.PREPROCESSING,
  TaskStatus.SCRIPT_GENERATION,
  TaskStatus.CHARACTER_DESIGN,
  TaskStatus.PROP_DESIGN,
  TaskStatus.SCENE_DESIGN,
  TaskStatus.STORYBOARDING,
  TaskStatus.PROMPT_OPTIMIZATION,
  TaskStatus.COMPLETED
];

export enum ArtStyle {
  ANIMATION = 'Animation (2D)',
  REALISTIC = 'Cinematic Realistic',
  CYBERPUNK = 'Cyberpunk',
  WATERCOLOR = 'Watercolor',
  PIXAR = '3D Cartoon'
}

export type Language = 'en' | 'zh' | 'ja' | 'ko';
export type TaskMode = 'auto' | 'manual';

export type ProviderProtocol = 'openai' | 'apimart' | 'gemini' | 'runninghub' | 'volcengine' | 'jimeng';

export interface RhAppEntry {
  id: string;
  title: string;
  note?: string;
  enabled: boolean;
  appId: string;
  thumbnail?: string;
  hidden?: boolean;
  fields?: RhWorkflowField[];
  raw?: any;
  updatedAt?: number;
}

export interface RhWorkflowField {
  id: string;
  nodeId: string;
  fieldName: string;
  fieldValue: string;
  fieldType: string;
  label?: string;
  enabled?: boolean;
  sourceFromUpstream?: boolean;
  group?: string;
  note?: string;
  options?: string[];
  random_enabled?: boolean;
  min?: number | string;
  max?: number | string;
  step?: number | string;
  imageOrder?: number;
  required?: boolean;
}

export interface RhWorkflowEntry {
  id: string;
  title: string;
  note?: string;
  enabled: boolean;
  workflowId: string;
  thumbnail?: string;
  hidden?: boolean;
  fields?: RhWorkflowField[];
  workflowJson?: any;
  optionalImageMode?: string;
  raw?: any;
  updatedAt?: number;
}

export interface Provider {
  id: string;
  name: string;
  baseUrl: string;
  protocol: ProviderProtocol;
  enabled: boolean;
  apiKey: string;
  /** Image model IDs */
  imageModels: string[];
  /** Default LLM model for this provider (used by agent LLM pick) */
  defaultModel?: string;
  /** Chat/LLM model IDs */
  chatModels: string[];
  /** Video model IDs */
  videoModels: string[];
  /** Whether API key is saved on backend (read-only, from server) */
  hasKey?: boolean;
  keyPreview?: string;
  /** Per-provider custom overrides (endpoint/payload/async polling etc.), raw JSON */
  extraConfig?: Record<string, any>;
  /** RunningHub wallet API key */
  walletApiKey?: string;
  hasWalletKey?: boolean;
  walletKeyPreview?: string;
  /** Volcengine access key */
  volcengineAccessKeyId?: string;
  volcengineSecretAccessKey?: string;
  hasVolcengineAccessKey?: boolean;
  volcengineAccessKeyPreview?: string;
  hasVolcengineSecretKey?: boolean;
  volcengineSecretKeyPreview?: string;
  volcengineProjectName?: string;
  volcengineRegion?: string;
  /** RunningHub AI apps */
  rhApps?: RhAppEntry[];
  /** RunningHub workflows */
  rhWorkflows?: RhWorkflowEntry[];
}

export type StepType = 
  | 'preprocessing'
  | 'scriptGeneration'
  | 'characterDesign'
  | 'storyboarding'
  | 'promptOptimization'
  | 'videoGeneration';

export type ModelBindingKind = 'llm' | 'image' | 'video';

export interface ModelBinding {
  kind: ModelBindingKind;
  providerId: string;
  modelId: string;
}

/** @deprecated Read-only compatibility shape for configurations saved before capability bindings. */
export interface StepModelBinding {
  step: StepType;
  providerId: string;
  modelId: string;
}

export interface ApiConfig {
  providers: Provider[];
  modelBindings: ModelBinding[];
  /** @deprecated Legacy data is normalized on load and must not be written by new UI code. */
  stepBindings?: StepModelBinding[];
}

/** @deprecated Legacy types kept for service layer compatibility */
export type ProviderType = 'official' | 'custom' | 'relay';
export type ProviderCategory = 'llm' | 'image' | 'video';
export type ApiFormat = 'openai' | 'openai-image' | 'openai-video' | 'gemini' | 'custom';

/** @deprecated Legacy model config - use Provider.imageModels/chatModels/videoModels instead */
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

/** @deprecated Legacy default models */
export const DEFAULT_MODELS: ModelConfig[] = [];

export const DEFAULT_PROVIDERS: Provider[] = [];

export const DEFAULT_MODEL_BINDINGS: ModelBinding[] = [
  { kind: 'llm', providerId: '', modelId: '' },
  { kind: 'image', providerId: '', modelId: '' },
  { kind: 'video', providerId: '', modelId: '' },
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
    providers: DEFAULT_PROVIDERS.map(p => ({ ...p, imageModels: [...p.imageModels], chatModels: [...p.chatModels], videoModels: [...p.videoModels] })),
    modelBindings: DEFAULT_MODEL_BINDINGS.map(b => ({ ...b })),
  };
}

const STEP_TO_BINDING_KIND: Record<StepType, ModelBindingKind> = {
  preprocessing: 'llm',
  scriptGeneration: 'llm',
  promptOptimization: 'llm',
  characterDesign: 'image',
  storyboarding: 'image',
  videoGeneration: 'video',
};

export function normalizeModelBindings(input: Partial<ApiConfig> & { stepBindings?: StepModelBinding[] }): ApiConfig {
  const providers = input.providers || [];
  const providerIds = new Map(
    providers.map(provider => [
      String(provider.id || '').trim().toLowerCase().replace(/[^a-z0-9_-]/g, '-'),
      provider.id,
    ]),
  );
  // Legacy step bindings are intentionally ignored. They must not silently
  // become active capability bindings after the settings model changed.
  const source = Array.isArray(input.modelBindings) ? input.modelBindings : [];
  const byKind = new Map<ModelBindingKind, ModelBinding>();
  source.forEach(binding => {
    if (binding?.kind && !byKind.has(binding.kind)) byKind.set(binding.kind, {
      kind: binding.kind,
      providerId: providerIds.get(String(binding.providerId || '').trim().toLowerCase().replace(/[^a-z0-9_-]/g, '-')) || binding.providerId || '',
      modelId: binding.modelId || '',
    });
  });
  return {
    providers,
    modelBindings: DEFAULT_MODEL_BINDINGS.map(defaultBinding => byKind.get(defaultBinding.kind) || { ...defaultBinding }),
  };
}

export function getBindingForStep(config: ApiConfig, step: StepType): ModelBinding | undefined {
  const normalized = normalizeModelBindings(config);
  return normalized.modelBindings.find(binding => binding.kind === STEP_TO_BINDING_KIND[step]);
}

export function getProviderForStep(config: ApiConfig, step: StepType): Provider | undefined {
  const binding = getBindingForStep(config, step);
  if (!binding) return undefined;
  return config.providers.find(p => p.id === binding.providerId);
}

export function getModelForStep(config: ApiConfig, step: StepType): ModelConfig | undefined {
  const binding = getBindingForStep(config, step);
  if (!binding) return undefined;
  const provider = config.providers.find(p => p.id === binding.providerId);
  if (!provider) return undefined;
  const modelId = binding.modelId;
  // Derive apiFormat from provider protocol
  let apiFormat: ApiFormat = 'openai';
  if (provider.protocol === 'gemini') apiFormat = 'gemini';
  else if (provider.protocol === 'runninghub') apiFormat = 'custom';
  else if (provider.videoModels?.includes(modelId)) apiFormat = 'openai-video';
  else if (provider.imageModels?.includes(modelId)) apiFormat = 'openai-image';
  // Derive apiPath as a relative endpoint path (NOT including baseUrl)
  let apiPath = '/chat/completions';
  if (apiFormat === 'gemini') {
    apiPath = `/v1beta/models/${modelId}:generateContent`;
  } else if (apiFormat === 'openai-image') {
    apiPath = '/images/generations';
  } else if (apiFormat === 'openai-video') {
    apiPath = '/video/generations';
  }
  return {
    id: `${provider.id}::${modelId}`,
    providerId: provider.id,
    modelName: modelId,
    displayName: modelId,
    apiPath,
    apiFormat,
    customHeaders: '',
    customBodyTemplate: '',
    customResponsePath: '',
    pollApiPath: '',
    enabled: provider.enabled,
  };
}

export type PlotRhythm = 'tight' | 'mid' | 'loose';
export type EmotionRhythm = 'light' | 'mid' | 'heavy';
export type VFXLevel = 'S' | 'A' | 'B' | 'C';

export type ShotSize =
  | '极端特写' | '特写' | '近景' | '中近景' | '中景' | '中远景' | '全景' | '远景' | '—';

export type ShotTag = '海报帧' | '伏笔' | '关键' | '重特效' | '长镜' | '音锚' | '特设备';

export interface ColorId {
  entity: string;
  hue: string;
}

export interface VisualSignature {
  medium: string;
  aspectRatio: string;
  colorIds: ColorId[];
  texture: string[];
  coreTheme: string;
  masterDNA: string[];
  genreFormula: {
    opening: string;
    turning: string;
    climax: string;
    closing: string;
  };
}

export interface ShotCard {
  shotNumber: number;
  timecode: string;
  duration: number;
  shotSize: ShotSize;
  cameraMovement: string;
  content: string;
  sound: string;
  tags?: ShotTag[];
  vfxLevel?: VFXLevel;
}

export interface Sequence {
  id: string;
  title: string;
  duration: number;
  plotRhythm: PlotRhythm;
  emotionRhythm: EmotionRhythm;
  dramaticTask: string;
  visualMotif: string;
  hook: string;
  shots: BigShot[];
}

export interface SoundLayer {
  lowFreq: string[];
  midFreq: string[];
  highFreq: string[];
  voice: { character: string; count: number }[];
}

export interface SoundEvent {
  slot: number;
  time: string;
  event: string;
  description: string;
}

export interface SoundDesign {
  layers: SoundLayer;
  events: SoundEvent[];
  uniqueMoment?: {
    type: '最长静默' | '最响一击' | '最远尾音';
    description: string;
  };
}

export interface SequenceRhythm {
  sequenceId: string;
  sequenceTitle: string;
  shotCount: number;
  duration: number;
  asl: number;
  sigma: number;
  rhythmFeature: string;
}

export interface RhythmAnalysis {
  totalShots: number;
  totalDuration: string;
  globalASL: number;
  globalSigma: number;
  genreBenchmark: string;
  pace: '快' | '慢' | '居中';
  sequenceRhythms: SequenceRhythm[];
  diagnostics: string[];
}

export interface WorldAnchor {
  slot: number;
  category: string;
  content: string;
  locked: boolean;
}

export interface DialogueLine {
  index: number;
  speaker: string;
  line: string;
  wordCount: number;
  shotId?: string;
}

export interface VFXItem {
  shotId: string;
  description: string;
  level: VFXLevel;
  workloadMultiplier: number;
  estimatedHours: number;
}

export interface VFXBudget {
  items: VFXItem[];
  totalEstimatedHours: number;
  levelDistribution: Record<VFXLevel, number>;
}

export interface TitleCard {
  title: string;
  subtitle?: string;
  style: 'cinematic' | 'minimal' | 'typographic' | 'brushwork';
  duration: number;
  fontSpec: string;
  colorScheme: string;
  animation: 'fade_in' | 'slide_up' | 'zoom' | 'brush_stroke' | 'typewriter';
  bgPrompt?: string;
  bgImageUrl?: string;
}

export interface EndCard {
  credits: string[];
  style: 'scroll' | 'static' | 'minimal';
  duration: number;
  bgPrompt?: string;
  bgImageUrl?: string;
}

const VFX_LEVEL_MULTIPLIERS: Record<VFXLevel, number> = {
  S: 4.0,
  A: 2.5,
  B: 1.5,
  C: 1.0,
};

export interface FaceAnchor {
  faceShape: string;
  eyebrow: string;
  eyeType: string;
  noseType: string;
  lipType: string;
  boneStructure: string;
  skinTone: string;
  landmarks: string;
}

export interface HairSystem {
  lengthAndStyle: string;
  color: string;
  headwear: string;
  bangsDirection: string;
}

export interface ClothingLayers {
  inner: string;
  outer: string;
  overlay: string;
  waist: string;
  lower: string;
  feet: string;
}

export const CHARACTER_CONCEPT_SHEET_LAYOUT = `1. 主视觉区（上方）白底图：以"正面 + 侧面 + 背面"三个核心视角为主体，直观呈现角色的整体身形、服饰搭配和标志性特征。2. 补充信息区（左侧）白底图：拆分出"面部特写（头部正立, 颈部垂直, 下颌线水平, 头顶到下巴在画面垂直中轴上, 不侧倾, 不仰头, 不低头）"和"配色板"（明确毛发、服饰的色值）。3. 局部细节区（底部）白底图：用小模块单独展示关键部件的设计（配饰、点缀、关键身份识别元素）。4. 半身照比例照（右侧）：生成人物上半身图像，（头部正立, 颈部垂直, 下颌线水平, 头顶到下巴在画面垂直中轴上, 不侧倾, 不仰头, 不低头）。背景统一：纯白底或浅灰摄影棚背景。`;

export interface Character {
  name: string;
  identity?: string;
  ageRange?: string;
  gender?: string;
  era?: string;
  faceAnchor?: FaceAnchor;
  hairSystem?: HairSystem;
  clothingLayers?: ClothingLayers;
  specialState?: string;
  visualFeatures: string;
  clothing: string;
  voice: string;
  threeViewImg?: string;
  referenceImage?: string;
  generationStatus?: string;
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

export interface SceneAsset {
  id?: string;
  worldPositioning: string;
  geography: string;
  mainStructure: string;
  extendedSpace: string;
  naturalAndDistant: string;
  lightAndColor: string;
  techSpec: string;
  qualitySuffix: string;
  ambientCharacters: string;
  // 兼容 script 场景字段
  location?: string;
  time?: string;
  environment?: string;
  prompt?: string;
  imageUrl?: string;
  generationStatus?: string;
}

export interface BigShot {
  id: string;
  includedDialogues: string[];
  environmentAnchor?: string;
  sceneAsset?: SceneAsset;
  
  storyboardPrompt: string;
  storyboardImageUrl?: string;
  charactersInvolved: string[];
  
  soraPrompt: string;
  soraPromptOriginal?: string;
  soraPromptOptimized?: string;
  videoUrl?: string;
  generationStatus?: string;
  
  sequenceId?: string;
  shotCards?: ShotCard[];
  
  parentId?: string | null;
  childrenIds?: string[];
  order?: number;

  subUnitId?: string;
  storyboardShotCount?: number;
  storyboardContentShotCount?: number;
  storyboardReferenceTags?: string[];
  videoReferenceTags?: string[];
  visualStyleBlock?: string;
  storyboardDeclaration?: string;
}

export interface Prop {
  id: string;
  name: string;
  category: 'weapon' | 'artifact' | 'tool' | 'token' | 'vehicle' | 'tech' | 'daily' | 'plotItem';
  ownerCharacter?: string;
  ownerScene?: string;
  plotFunction: string;
  era: string;
  size: string;
  structure: string;
  material: string;
  craftAndWear: string;
  decoration: string;
  functionalDetail: string;
  specialState?: string;
  compositionType: 'fourView' | 'single';
  prompt: string;
  imageUrl?: string;
  generationStatus?: string;
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
  sourceType: 'novel' | 'idea';
  coverImage?: string;
  createdAt: number;
  
  previousEpisodeId?: string;
  episodeSummary?: string;
  inheritedCharacters?: Character[];
  inheritedProps?: Prop[];
  inheritedSceneAssets?: SceneAsset[];
  
  status: TaskStatus;
  stepStatus: 'idle' | 'processing' | 'completed';
  
  progress: number;
  error?: string;
  failedStep?: TaskStatus;
  
  rawNovelText: string;
  originalIdea?: string;
  
  segments?: ProcessedSegment[];

  scriptAnalysis?: {
    corePlot: string;
    mood: string;
  };
  visualSignature?: VisualSignature;
  sequences?: Sequence[];
  soundDesign?: SoundDesign;
  rhythmAnalysis?: RhythmAnalysis;
  characters: Character[];
  props?: Prop[];
  sceneAssets?: SceneAsset[];
  script?: ScriptScene[];
  bigShots: BigShot[];
  worldAnchors?: WorldAnchor[];
  dialogueList?: DialogueLine[];
  vfxBudget?: VFXBudget;
  titleCard?: TitleCard;
  endCard?: EndCard;
  customNodes?: any[];
  customEdges?: any[];
}

export interface GenerationStep {
  id: string;
  label: string;
  status: 'pending' | 'loading' | 'success' | 'error';
}
