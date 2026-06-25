import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  Film, BookOpen, Users, Image, Wand2, Video,
  CheckCircle, Loader2, Camera, MapPin, Palette, Eye,
  Sparkles
} from 'lucide-react';
import { TaskStatus } from '../types';
import { translations } from '../locales';

interface CharacterData {
  name: string;
  nameCn: string;
  identity: string;
  age: string;
  gender: string;
  visual: string;
  clothing: string;
  voice: string;
}

interface ShotData {
  shotNumber: string;
  shotSize: string;
  location: string;
  camera: string;
  content: string;
  sound: string;
  characters: string;
  dialogue?: string;
}

interface ImageGenData {
  title: string;
  items: string[];
}

interface VideoGenData {
  shotLabel: string;
}

interface StreamOutput {
  type: 'thinking' | 'text' | 'json' | 'image' | 'progress' | 'divider' | 'character-card' | 'shot-card' | 'video-render';
  label?: string;
  content: string;
  speed?: number;
  delay?: number;
  characterData?: CharacterData;
  shotData?: ShotData;
  imageGenData?: ImageGenData;
  videoGenData?: VideoGenData;
}

interface StreamStep {
  status: TaskStatus;
  label: string;
  icon: React.ElementType;
  provider: string;
  model: string;
  outputs: StreamOutput[];
}

/* ─── i18n helper for stream content ─── */
export const setStreamLocale = (_locale: Record<string, string>) => {};

function getStreamSteps(localeKey: string = 'en'): StreamStep[] {
  const locale = translations[localeKey as keyof typeof translations] || translations.en;
  const $t = (key: string, fallback: string) => locale[key] || fallback;
  return [
    {
      status: TaskStatus.PREPROCESSING,
      label: $t('streamStepPreprocessing', 'Text Structuring'),
      icon: BookOpen,
      provider: 'Google',
      model: 'Gemini 3 Pro',
      outputs: [
        { type: 'thinking', content: $t('streamThinkingAnalyze', 'Analyzing input text structure...'), delay: 400 },
        { type: 'text', label: $t('streamLabelSourceAnalysis', 'Source Analysis'), content: $t('streamContentSourceAnalysis', 'Detected input type: Novel excerpt\nLanguage: Chinese (Simplified)\nEstimated length: ~2,400 characters\nGenre indicators: Urban fantasy, romance, suspense'), speed: 25 },
        { type: 'divider', content: '' },
        { type: 'thinking', content: $t('streamThinkingDecompose', 'Decomposing narrative structure...'), delay: 600 },
        { type: 'json', label: $t('streamLabelSegmentMap', 'Segment Map'), content: '{\n  "segments": [\n    { "id": "seg_01", "name": "' + $t('streamSegOpening', 'Opening') + '", "range": [1, 480] },\n    { "id": "seg_02", "name": "' + $t('streamSegInciting', 'Inciting Incident') + '", "range": [481, 1120] },\n    { "id": "seg_03", "name": "' + $t('streamSegRising', 'Rising Action') + '", "range": [1121, 1880] },\n    { "id": "seg_04", "name": "' + $t('streamSegClimax', 'Climax Setup') + '", "range": [1881, 2400] }\n  ]\n}', speed: 8 },
        { type: 'progress', content: $t('streamProgressSegComplete', 'Segmentation complete — 4 narrative segments identified'), delay: 300 },
      ]
    },
    {
      status: TaskStatus.SCRIPT_GENERATION,
      label: $t('streamStepScriptGen', 'Script Generation'),
      icon: Film,
      provider: 'Google',
      model: 'Gemini 3 Pro',
      outputs: [
        { type: 'thinking', content: $t('streamThinkingGenerate', 'Generating script analysis from segmented text...'), delay: 500 },
        { type: 'text', label: $t('streamLabelCorePlot', 'Core Plot'), content: $t('streamContentCorePlot', 'A young architect discovers that the buildings she designs are manifesting in a parallel dreamscape, where her creations take on lives of their own. When a mysterious figure from the dream world begins altering her blueprints, she must navigate both realities to prevent catastrophic structural collapses that threaten both worlds.'), speed: 20 },
        { type: 'divider', content: '' },
        { type: 'thinking', content: $t('streamThinkingEmotion', 'Analyzing emotional landscape...'), delay: 400 },
        { type: 'text', label: $t('streamLabelMoodTone', 'Mood & Tone'), content: $t('streamContentMoodTone', 'Primary Mood: Ethereal Tension\nEmotional Arc: Wonder → Unease → Desperation → Transcendence\nVisual Palette: Cool steel blues, warm amber highlights, deep shadow contrasts\nSound Design: Architectural acoustics, resonant bass, crystalline highs'), speed: 22 },
        { type: 'divider', content: '' },
        { type: 'json', label: $t('streamLabelVisualSig', 'Visual Signature'), content: '{\n  "medium": "Cinematic Realistic",\n  "aspectRatio": "16:9",\n  "colorIds": [\n    { "entity": "' + $t('streamEntityDreamscape', 'dreamscape') + '", "hue": "#4A7FB5" },\n    { "entity": "' + $t('streamEntityReality', 'reality') + '", "hue": "#8B7355" },\n    { "entity": "' + $t('streamEntityDanger', 'danger') + '", "hue": "#C44E3F" }\n  ],\n  "coreTheme": "' + $t('streamContentCoreTheme', 'Architecture as living organism') + '"\n}', speed: 6 },
        { type: 'progress', content: $t('streamProgressScriptComplete', 'Script analysis generated — 3 characters, 6 sequences mapped'), delay: 300 },
      ]
    },
    {
      status: TaskStatus.CHARACTER_DESIGN,
      label: $t('streamStepCharDesign', 'Character Design'),
      icon: Users,
      provider: 'Nanobanana',
      model: 'Nano Banana',
      outputs: [
        { type: 'thinking', content: $t('streamThinkingExtract', 'Extracting character definitions from script...'), delay: 500 },
        {
          type: 'character-card',
          label: $t('streamChar1Name', 'Lin Xiaoya'),
          content: 'Streaming character data...',
          speed: 15,
          characterData: {
            name: $t('streamChar1Name', 'Lin Xiaoya'),
            nameCn: $t('streamChar1NameCn', '林晓雅'),
            identity: $t('streamChar1Identity', 'Architect / Dreamwalker'),
            age: '28',
            gender: 'Female',
            visual: $t('streamChar1Visual', 'Sharp angular features, determined jawline, deep-set observant eyes with amber flecks. Shoulder-length black hair often tied in a loose architectural knot.'),
            clothing: $t('streamChar1Clothing', 'Structured blazer over flowing silk blouse, tailored trousers, minimalist leather boots. A silver compass pendant always visible.'),
            voice: $t('streamChar1Voice', 'Measured and clear, with occasional tremors when confronting the unknown.'),
          }
        },
        { type: 'divider', content: '' },
        {
          type: 'character-card',
          label: $t('streamChar2Name', 'Kael'),
          content: 'Streaming character data...',
          speed: 15,
          characterData: {
            name: $t('streamChar2Name', 'Kael'),
            nameCn: $t('streamChar2NameCn', '凯尔'),
            identity: $t('streamChar2Identity', 'Dream Architect / Antagonist'),
            age: 'Ageless',
            gender: 'Male',
            visual: $t('streamChar2Visual', 'Ethereal and unsettling beauty. Asymmetric silver-white hair falling over one eye. Skin has a faint luminescent quality.'),
            clothing: $t('streamChar2Clothing', 'Flowing dark coat that seems to dissolve at edges, revealing geometric patterns underneath. No shoes — feet leave faint glowing prints.'),
            voice: $t('streamChar2Voice', 'Resonant with harmonic overtones, as if multiple voices speak in unison.'),
          }
        },
        { type: 'divider', content: '' },
        { type: 'thinking', content: $t('streamThinkingGenImage', 'Generating character concept sheets via image model...'), delay: 800 },
        {
          type: 'image',
          label: $t('streamChar1ConceptLabel', 'Lin Xiaoya — Concept Sheet'),
          content: '',
          delay: 600,
          imageGenData: {
            title: $t('streamChar1ConceptTitle', 'Lin Xiaoya — 3-View Concept Sheet'),
            items: [
              $t('streamConceptFront', 'Front view rendered'),
              $t('streamConceptSide', 'Side view rendered'),
              $t('streamConceptBack', 'Back view rendered'),
              $t('streamConceptPalette', 'Color palette extracted')
            ],
          }
        },
        {
          type: 'image',
          label: $t('streamChar2ConceptLabel', 'Kael — Concept Sheet'),
          content: '',
          delay: 500,
          imageGenData: {
            title: $t('streamChar2ConceptTitle', 'Kael — 3-View Concept Sheet'),
            items: [
              $t('streamConceptFront', 'Front view rendered'),
              $t('streamConceptSide', 'Side view rendered'),
              $t('streamConceptBack', 'Back view rendered'),
              $t('streamConceptPalette', 'Color palette extracted')
            ],
          }
        },
        { type: 'progress', content: $t('streamProgressCharComplete', 'Character design complete — 2 characters rendered'), delay: 300 },
      ]
    },
    {
      status: TaskStatus.STORYBOARDING,
      label: $t('streamStepStoryboard', 'Storyboarding'),
      icon: Image,
      provider: 'Nanobanana',
      model: 'Nano Banana',
      outputs: [
        { type: 'thinking', content: $t('streamThinkingDecomposeScript', 'Decomposing script into visual sequences...'), delay: 600 },
        {
          type: 'shot-card',
          label: $t('streamShot01Label', 'Shot 01 — Opening'),
          content: 'Streaming shot data...',
          speed: 18,
          shotData: {
            shotNumber: '01',
            shotSize: $t('streamShot01Size', 'Extreme Wide Shot'),
            location: $t('streamShot01Location', 'City skyline, dawn'),
            camera: $t('streamShot01Camera', 'Slow dolly forward'),
            content: $t('streamShot01Content', 'The city awakens as golden light touches steel and glass. Among the towers, one building pulses with a faint blue shimmer — Lin Xiaoya\'s latest design.'),
            sound: $t('streamShot01Sound', 'Urban ambience fades, resonant hum emerges'),
            characters: '—',
          }
        },
        { type: 'divider', content: '' },
        {
          type: 'shot-card',
          label: $t('streamShot02Label', 'Shot 02 — Discovery'),
          content: 'Streaming shot data...',
          speed: 18,
          shotData: {
            shotNumber: '02',
            shotSize: $t('streamShot02Size', 'Medium Close-Up'),
            location: $t('streamShot02Location', 'Lin\'s studio, night'),
            camera: $t('streamShot02Camera', 'Static, shallow depth of field'),
            content: $t('streamShot02Content', 'Lin stares at her blueprint. The lines on paper begin to move, rearranging themselves. Her compass pendant glows warm.'),
            sound: $t('streamShot02Sound', 'Paper rustling, heartbeat bass'),
            characters: $t('streamChar1Name', 'Lin Xiaoya'),
            dialogue: '"' + $t('streamShot02Dialogue', 'This isn\'t what I drew...') + '"',
          }
        },
        { type: 'divider', content: '' },
        {
          type: 'shot-card',
          label: $t('streamShot03Label', 'Shot 03 — The Bleed'),
          content: 'Streaming shot data...',
          speed: 18,
          shotData: {
            shotNumber: '03',
            shotSize: $t('streamShot03Size', 'Wide Shot → Tracking'),
            location: $t('streamShot03Location', 'Dreamscape / Reality split'),
            camera: $t('streamShot03Camera', '180° rotation crossing the divide'),
            content: $t('streamShot03Content', 'The studio dissolves into the dreamscape. Buildings breathe. Kael stands at the center of an impossible structure, reshaping it with gestures.'),
            sound: $t('streamShot03Sound', 'Reality tearing, harmonic chords'),
            characters: $t('streamChar1Name', 'Lin Xiaoya') + ', ' + $t('streamChar2Name', 'Kael'),
            dialogue: $t('streamChar2Name', 'Kael') + ': "' + $t('streamShot03Dialogue', 'Your designs are magnificent. But they need... corrections.') + '"',
          }
        },
        { type: 'divider', content: '' },
        { type: 'thinking', content: $t('streamThinkingRenderFrames', 'Rendering storyboard frames via image model...'), delay: 700 },
        {
          type: 'image',
          label: $t('streamStoryboardFramesLabel', 'Storyboard Frames'),
          content: '',
          delay: 800,
          imageGenData: {
            title: $t('streamStoryboardFramesTitle', 'Storyboard Frame Rendering'),
            items: [
              $t('streamStoryboardItem1', 'Shot 01: City dawn panorama'),
              $t('streamStoryboardItem2', 'Shot 02: Studio blueprints'),
              $t('streamStoryboardItem3', 'Shot 03: Dreamscape confrontation'),
              $t('streamStoryboardItem4', 'Shot 04: Structural collapse'),
              $t('streamStoryboardItem5', 'Shot 05: Climactic convergence'),
              $t('streamStoryboardItem6', 'Shot 06: New dawn resolution')
            ],
          }
        },
        { type: 'progress', content: $t('streamProgressStoryComplete', 'Storyboard complete — 6 shots rendered across 3 sequences'), delay: 300 },
      ]
    },
    {
      status: TaskStatus.PROMPT_OPTIMIZATION,
      label: $t('streamStepPromptOpt', 'Prompt Optimization'),
      icon: Wand2,
      provider: 'Google',
      model: 'Gemini 3 Pro',
      outputs: [
        { type: 'thinking', content: $t('streamThinkingOptimize', 'Optimizing video generation prompts for each shot...'), delay: 400 },
        { type: 'json', label: $t('streamLabelOptimizedPrompt', 'Shot 01 — Optimized Prompt'), content: '{\n  "soraPrompt": "' + $t('streamPrompt01', 'Cinematic extreme wide shot of a modern city skyline at dawn...') + '",\n  "parameters": { "duration": "4s", "resolution": "1080p", "style_weight": 0.85 }\n}', speed: 6 },
        { type: 'divider', content: '' },
        { type: 'json', label: $t('streamLabelOptimizedPrompt', 'Shot 03 — Optimized Prompt'), content: '{\n  "soraPrompt": "' + $t('streamPrompt03', 'A woman standing in an architect\'s studio at night watches her blueprints come alive...') + '",\n  "parameters": { "duration": "6s", "resolution": "1080p", "style_weight": 0.9 }\n}', speed: 6 },
        { type: 'progress', content: $t('streamProgressPromptComplete', 'Prompt optimization complete — 6 shots optimized for video generation'), delay: 300 },
      ]
    },
    {
      status: TaskStatus.VIDEO_GENERATION,
      label: $t('streamStepVideoGen', 'Video Generation'),
      icon: Video,
      provider: 'Sora',
      model: 'Sora 2',
      outputs: [
        { type: 'thinking', content: $t('streamThinkingSubmit', 'Submitting optimized prompts to video generation pipeline...'), delay: 600 },
        { type: 'text', label: $t('streamLabelPipelineStatus', 'Pipeline Status'), content: $t('streamContentPipelineStatus', 'Queue position: 1\nModel: Sora 2 (High Quality)\nTotal shots: 6\nEstimated time: ~3 minutes\n\nInitializing GPU cluster...'), speed: 30 },
        { type: 'divider', content: '' },
        { type: 'video-render', label: 'Shot 01', content: '', delay: 800, videoGenData: { shotLabel: $t('streamVideoShot01', 'Shot 01 — City Dawn') } },
        { type: 'video-render', label: 'Shot 02', content: '', delay: 600, videoGenData: { shotLabel: $t('streamVideoShot02', 'Shot 02 — Studio') } },
        { type: 'video-render', label: 'Shot 03', content: '', delay: 900, videoGenData: { shotLabel: $t('streamVideoShot03', 'Shot 03 — Dreamscape') } },
        { type: 'video-render', label: 'Shot 04', content: '', delay: 700, videoGenData: { shotLabel: $t('streamVideoShot04', 'Shot 04 — Collapse') } },
        { type: 'video-render', label: 'Shot 05', content: '', delay: 800, videoGenData: { shotLabel: $t('streamVideoShot05', 'Shot 05 — Convergence') } },
        { type: 'video-render', label: 'Shot 06', content: '', delay: 500, videoGenData: { shotLabel: $t('streamVideoShot06', 'Shot 06 — Resolution') } },
        { type: 'divider', content: '' },
        { type: 'thinking', content: $t('streamThinkingAssemble', 'Assembling final video sequence...'), delay: 400 },
        { type: 'text', label: $t('streamLabelOutput', 'Output'), content: $t('streamContentOutput', '✓ All 6 shots rendered successfully\n✓ Video sequence assembled\n✓ Audio synced\n✓ Color graded\n\nFinal output: dramaforge_output_2025.mp4\nDuration: 32 seconds\nResolution: 1920×1080\nFrame rate: 24fps'), speed: 20 },
      ]
    },
  ];
}

/* ─── Inline Card Components ─── */

const InlineCharacterCard: React.FC<{ data: CharacterData }> = ({ data }) => {
  const initials = data.name.charAt(0);
  return (
    <div className="my-3 py-2.5 px-3 rounded-xl" style={{ background: 'rgba(17,24,39,0.03)', border: '1px solid rgba(17,24,39,0.06)' }}>
      <div className="flex items-center gap-3 mb-2">
        <div className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0" style={{ background: 'rgba(17,24,39,0.06)', border: '1px solid rgba(17,24,39,0.15)' }}>
          <span className="text-[11px] font-semibold text-brand-300">{initials}</span>
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-[13px] font-semibold text-[#111827]">{data.name}</span>
            <span className="text-[10px] text-[#64748b] font-mono">({data.nameCn})</span>
          </div>
          <span className="text-[10px] font-mono text-brand-400/70">{data.identity}</span>
        </div>
      </div>
      <div className="space-y-1.5 pl-1">
        <div className="flex items-start gap-2">
          <Eye className="w-3 h-3 text-brand-400/60 mt-0.5 flex-shrink-0" />
          <p className="text-[11px] text-[#64748b] leading-relaxed">{data.visual}</p>
        </div>
        <div className="flex items-start gap-2">
          <Palette className="w-3 h-3 text-brand-400/60 mt-0.5 flex-shrink-0" />
          <p className="text-[11px] text-[#64748b] leading-relaxed">{data.clothing}</p>
        </div>
      </div>
    </div>
  );
};

const InlineShotCard: React.FC<{ data: ShotData }> = ({ data }) => {
  return (
    <div className="my-3 py-2.5 px-3 rounded-xl" style={{ background: 'rgba(17,24,39,0.03)', border: '1px solid rgba(17,24,39,0.06)' }}>
      <div className="flex items-center gap-2.5 mb-2">
        <span className="text-[11px] font-mono font-medium text-brand-300">#{data.shotNumber}</span>
        <span className="text-[10px] font-mono text-[#64748b]">{data.shotSize}</span>
      </div>
      <div className="flex items-center gap-3 text-[10px] text-[#94a3b8] mb-1.5">
        <span className="flex items-center gap-1"><MapPin className="w-2.5 h-2.5" />{data.location}</span>
        <span className="flex items-center gap-1"><Camera className="w-2.5 h-2.5" />{data.camera}</span>
      </div>
      <p className="text-[11px] text-[#64748b] leading-relaxed">{data.content}</p>
      {data.dialogue && (
        <div className="mt-1.5 pl-2" style={{ borderLeft: '2px solid rgba(17,24,39,0.3)' }}>
          <span className="text-[11px] text-brand-300/80 italic">{data.dialogue}</span>
        </div>
      )}
    </div>
  );
};

const InlineImageGenCard: React.FC<{ data: ImageGenData }> = ({ data }) => {
  const [visibleItems, setVisibleItems] = useState(0);
  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = [];
    data.items.forEach((_, idx) => {
      timers.push(setTimeout(() => setVisibleItems(prev => prev + 1), 400 + idx * 300));
    });
    return () => timers.forEach(clearTimeout);
  }, [data.items]);

  return (
    <div className="my-3 py-2.5 px-3 rounded-xl" style={{ background: 'rgba(17,24,39,0.03)', border: '1px solid rgba(17,24,39,0.06)' }}>
      <div className="flex items-center gap-2 mb-2">
        <Image className="w-3 h-3 text-emerald-600/70" />
        <span className="text-[10px] font-mono text-emerald-600/80 font-medium uppercase tracking-wider">{data.title}</span>
      </div>
      <div className="w-full h-1 rounded-full overflow-hidden mb-2" style={{ background: 'rgba(17,24,39,0.05)' }}>
        <div className="h-full rounded-full transition-all duration-500"
          style={{ width: `${(visibleItems / data.items.length) * 100}%`, background: 'linear-gradient(90deg, #111827, #374151)' }} />
      </div>
      <div className="space-y-0.5">
        {data.items.map((item, idx) => (
          <div key={idx} className={`flex items-center gap-2 transition-all duration-300 ${idx < visibleItems ? 'opacity-100' : 'opacity-20'}`}>
            {idx < visibleItems ? (
              <CheckCircle className="w-3 h-3 text-emerald-600/70 flex-shrink-0" />
            ) : (
              <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ border: '1px solid rgba(17,24,39,0.1)' }} />
            )}
            <span className={`text-[10px] ${idx < visibleItems ? 'text-emerald-600/70' : 'text-[#94a3b8]'}`}>{item}</span>
          </div>
        ))}
      </div>
    </div>
  );
};

const InlineVideoRenderCard: React.FC<{ data: VideoGenData }> = ({ data }) => {
  const [progress, setProgress] = useState(0);
  useEffect(() => {
    const interval = setInterval(() => {
      setProgress(p => {
        if (p >= 100) { clearInterval(interval); return 100; }
        return p + Math.random() * 15 + 5;
      });
    }, 200);
    return () => clearInterval(interval);
  }, []);

  const isDone = progress >= 100;
  return (
    <div className="my-2 py-2 px-3 rounded-xl" style={{ background: 'rgba(17,24,39,0.03)', border: '1px solid rgba(17,24,39,0.06)' }}>
      <div className="flex items-center justify-between mb-1.5">
        <div className="flex items-center gap-2">
          <Video className="w-3 h-3 text-brand-400/70" />
          <span className="text-[10px] font-mono text-[#64748b]">{data.shotLabel}</span>
        </div>
        {isDone ? (
          <CheckCircle className="w-3 h-3 text-emerald-600/70" />
        ) : (
          <Loader2 className="w-3 h-3 text-brand-400/70 animate-spin" />
        )}
      </div>
      <div className="w-full h-1 rounded-full overflow-hidden" style={{ background: 'rgba(17,24,39,0.05)' }}>
        <div className="h-full rounded-full transition-all duration-300"
          style={{ width: `${Math.min(progress, 100)}%`, background: 'linear-gradient(90deg, #111827, #374151)' }} />
      </div>
    </div>
  );
};

/* ─── Terminal Line Item ─── */

interface TerminalLine {
  id: number;
  type: StreamOutput['type'];
  label?: string;
  content: string;
  characterData?: CharacterData;
  shotData?: ShotData;
  imageGenData?: ImageGenData;
  videoGenData?: VideoGenData;
}

/* ─── Main Export: Background Stream ─── */

export const PipelineStream: React.FC<{ localeKey?: string }> = ({ localeKey }) => {
  const locale = translations[localeKey as keyof typeof translations] || translations.en;
  const $t = (key: string, fallback: string) => locale[key] || fallback;

  const [lines, setLines] = useState<TerminalLine[]>([]);
  const [currentStepIdx, setCurrentStepIdx] = useState(0);
  const [currentOutputIdx, setCurrentOutputIdx] = useState(0);
  const [displayedText, setDisplayedText] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [completedSteps, setCompletedSteps] = useState<number[]>([]);
  const [isDone, setIsDone] = useState(false);
  const [currentLabel, setCurrentLabel] = useState('');

  const lineIdRef = useRef(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const typingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stepTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const addLine = useCallback((line: Omit<TerminalLine, 'id'>) => {
    const id = ++lineIdRef.current;
    setLines(prev => [...prev, { ...line, id }]);
  }, []);

  const reset = useCallback(() => {
    setLines([]);
    setCurrentStepIdx(0);
    setCurrentOutputIdx(0);
    setDisplayedText('');
    setIsTyping(false);
    setCompletedSteps([]);
    setIsDone(false);
    setCurrentLabel('');
    if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
    if (stepTimerRef.current) clearTimeout(stepTimerRef.current);
  }, []);

  useEffect(() => {
    if (!isDone) return;
    const timer = setTimeout(reset, 5000);
    return () => clearTimeout(timer);
  }, [isDone, reset]);

  useEffect(() => {
    reset();
  }, [localeKey, reset]);

  const STREAM_STEPS = useMemo(() => getStreamSteps(localeKey), [localeKey]);

  useEffect(() => {
    const step = STREAM_STEPS[currentStepIdx];
    if (!step) { setIsDone(true); return; }

    if (currentOutputIdx >= step.outputs.length) {
      setCompletedSteps(prev => [...prev, currentStepIdx]);
      if (currentStepIdx < STREAM_STEPS.length - 1) {
        stepTimerRef.current = setTimeout(() => {
          setCurrentStepIdx(prev => prev + 1);
          setCurrentOutputIdx(0);
          setDisplayedText('');
        }, 600);
      } else {
        setIsDone(true);
      }
      return;
    }

    const output = step.outputs[currentOutputIdx];

    if (output.type === 'character-card' && output.characterData) {
      const timer = setTimeout(() => {
        addLine({ type: 'character-card', label: output.label, content: '', characterData: output.characterData });
        setCurrentLabel(`${output.characterData.name} — ${output.characterData.identity}`);
        setCurrentOutputIdx(prev => prev + 1);
      }, output.delay || 400);
      stepTimerRef.current = timer;
      return () => clearTimeout(timer);
    }

    if (output.type === 'shot-card' && output.shotData) {
      const timer = setTimeout(() => {
        addLine({ type: 'shot-card', label: output.label, content: '', shotData: output.shotData });
        setCurrentLabel(`${$t('streamShotPrefix', 'Shot')} #${output.shotData.shotNumber} — ${output.shotData.shotSize}`);
        setCurrentOutputIdx(prev => prev + 1);
      }, output.delay || 400);
      stepTimerRef.current = timer;
      return () => clearTimeout(timer);
    }

    if (output.type === 'image' && output.imageGenData) {
      const timer = setTimeout(() => {
        addLine({ type: 'image', label: output.label, content: '', imageGenData: output.imageGenData });
        setCurrentLabel(output.imageGenData.title);
        setCurrentOutputIdx(prev => prev + 1);
      }, output.delay || 400);
      stepTimerRef.current = timer;
      return () => clearTimeout(timer);
    }

    if (output.type === 'video-render' && output.videoGenData) {
      const timer = setTimeout(() => {
        addLine({ type: 'video-render', label: output.label, content: '', videoGenData: output.videoGenData });
        setCurrentLabel(`${$t('streamRenderingPrefix', 'Rendering')}: ${output.videoGenData.shotLabel}`);
        setCurrentOutputIdx(prev => prev + 1);
      }, output.delay || 400);
      stepTimerRef.current = timer;
      return () => clearTimeout(timer);
    }

    if (output.delay) {
      stepTimerRef.current = setTimeout(() => processOutput(output), output.delay);
    } else {
      processOutput(output);
    }

    return () => {
      if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
      if (stepTimerRef.current) clearTimeout(stepTimerRef.current);
    };
  }, [currentStepIdx, currentOutputIdx, isDone, addLine, STREAM_STEPS]);

  const processOutput = (output: StreamOutput) => {
    if (output.type === 'divider') {
      addLine({ type: 'divider', content: '' });
      setCurrentOutputIdx(prev => prev + 1);
      return;
    }
    if (output.type === 'progress') {
      addLine({ type: 'progress', label: output.label, content: output.content });
      setCurrentLabel(output.content);
      setCurrentOutputIdx(prev => prev + 1);
      return;
    }
    if (output.type === 'thinking') {
      addLine({ type: 'thinking', content: output.content });
      setCurrentLabel(output.content);
      setCurrentOutputIdx(prev => prev + 1);
      return;
    }

    setIsTyping(true);
    const speed = output.speed || 20;
    let charIdx = 0;
    const text = output.content;

    const typeChar = () => {
      if (charIdx < text.length) {
        const chunkSize = text[charIdx] === '\n' ? 1 : Math.min(3, text.length - charIdx);
        const chunk = text.slice(charIdx, charIdx + chunkSize);
        charIdx += chunkSize;
        setDisplayedText(prev => prev + chunk);
        typingTimerRef.current = setTimeout(typeChar, speed + Math.random() * speed * 0.5);
      } else {
        setIsTyping(false);
        addLine({ type: output.type, label: output.label, content: text });
        setCurrentLabel(output.label || '');
        setDisplayedText('');
        setCurrentOutputIdx(prev => prev + 1);
      }
    };

    typeChar();
  };

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [lines, displayedText]);

  const currentStep = STREAM_STEPS[currentStepIdx];
  const overallProgress = isDone ? 100 : Math.round(((completedSteps.length + (isTyping || displayedText ? 0.5 : 0)) / STREAM_STEPS.length) * 100);

  return (
    <div className="w-full h-full flex flex-col">
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-6 py-4 space-y-0.5 font-mono text-[12px]">
        {lines.map(line => {
          if (line.type === 'divider') {
            return <div key={line.id} className="h-px my-3" style={{ background: 'rgba(17,24,39,0.04)' }} />;
          }
          if (line.type === 'thinking') {
            return (
              <div key={line.id} className="flex items-start gap-2 py-0.5">
                <Sparkles className="w-3 h-3 text-brand-400/60 mt-0.5 flex-shrink-0" />
                <span className="text-[#64748b] italic">{line.content}</span>
              </div>
            );
          }
          if (line.type === 'progress') {
            return (
              <div key={line.id} className="flex items-center gap-2 py-1">
                <CheckCircle className="w-3 h-3 text-emerald-600/70 flex-shrink-0" />
                <span className="text-emerald-600/70 text-[11px]">{line.content}</span>
              </div>
            );
          }
          if (line.type === 'text') {
            return (
              <div key={line.id} className="py-0.5">
                {line.label && <span className="text-brand-400/70 font-medium mr-2">[{line.label}]</span>}
                <span className="text-[#64748b] whitespace-pre-wrap">{line.content}</span>
              </div>
            );
          }
          if (line.type === 'json') {
            return (
              <div key={line.id} className="py-0.5">
                {line.label && <span className="text-brand-400/70 font-medium mr-2">[{line.label}]</span>}
                <pre className="text-[#94a3b8] whitespace-pre-wrap text-[11px] leading-relaxed">{line.content}</pre>
              </div>
            );
          }
          if (line.type === 'character-card' && line.characterData) {
            return <InlineCharacterCard key={line.id} data={line.characterData} />;
          }
          if (line.type === 'shot-card' && line.shotData) {
            return <InlineShotCard key={line.id} data={line.shotData} />;
          }
          if (line.type === 'image' && line.imageGenData) {
            return <InlineImageGenCard key={line.id} data={line.imageGenData} />;
          }
          if (line.type === 'video-render' && line.videoGenData) {
            return <InlineVideoRenderCard key={line.id} data={line.videoGenData} />;
          }
          return null;
        })}

        {displayedText && (
          <div className="py-0.5">
            {currentLabel && <span className="text-brand-400/70 font-medium mr-2">[{currentLabel}]</span>}
            <span className="text-[#64748b] whitespace-pre-wrap">{displayedText}</span>
            <span className="inline-block w-1.5 h-3.5 bg-brand-400/70 ml-0.5 animate-pulse align-middle" />
          </div>
        )}

        {isDone && (
          <div className="flex items-center gap-2 py-2 mt-2">
            <CheckCircle className="w-3.5 h-3.5 text-emerald-600/70" />
            <span className="text-emerald-600/70 text-[11px]">{$t('streamPipelineComplete', 'Pipeline complete')}</span>
          </div>
        )}
      </div>

      <div className="px-6 pb-2 pt-1">
        <div className="flex items-center justify-between mb-1.5">
          <div className="flex items-center gap-1">
            {STREAM_STEPS.map((step, idx) => (
              <div key={step.status} className="flex items-center gap-0.5">
                <div className={`w-1.5 h-1.5 rounded-full transition-all duration-500 ${
                  completedSteps.includes(idx)
                    ? 'bg-emerald-600/70'
                    : idx === currentStepIdx && !isDone
                      ? 'bg-brand-400/70'
                      : 'bg-black/10'
                }`} />
              </div>
            ))}
          </div>
          <div className="flex items-center gap-2">
            {currentStep && (
              <span className="text-[9px] font-mono text-[#94a3b8]">{currentStep.provider} · {currentStep.model}</span>
            )}
            <span className="text-[9px] font-mono text-[#94a3b8]">{overallProgress}%</span>
          </div>
        </div>
        <div className="w-full h-px rounded-full overflow-hidden" style={{ background: 'rgba(17,24,39,0.05)' }}>
          <div className="h-full rounded-full transition-all duration-700 ease-out"
            style={{ width: `${overallProgress}%`, background: 'linear-gradient(90deg, #111827, #374151, #111827)' }} />
        </div>
      </div>
    </div>
  );
};

export const PipelineTerminal: React.FC = () => null;
export const StreamingBackground: React.FC = () => null;
