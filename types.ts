
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

export interface ApiConfig {
  geminiKey: string;
  geminiBaseUrl?: string;
  nanobananaKey: string;
  nanobananaBaseUrl?: string;
  soraKey: string;
  soraBaseUrl?: string;
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
