import type { CanvasTheme } from './types';

export interface ThemeTokens {
  page: string;
  grid: string;
  panel: string;
  card: string;
  cardSolid: string;
  soft: string;
  soft2: string;
  line: string;
  line2: string;
  text: string;
  muted: string;
  faint: string;
  shadow: string;
  strong: string;
  strongText: string;
}

const lightTokens: ThemeTokens = {
  page: '#f8fafc',
  grid: '#d9e1ea',
  panel: 'rgba(255,255,255,.92)',
  card: 'rgba(255,255,255,.96)',
  cardSolid: '#fff',
  soft: '#f8fafc',
  soft2: '#f1f5f9',
  line: '#e8edf3',
  line2: '#cbd5e1',
  text: '#111827',
  muted: '#64748b',
  faint: '#94a3b8',
  shadow: 'rgba(15,23,42,.08)',
  strong: '#111827',
  strongText: '#fff',
};

const darkTokens: ThemeTokens = {
  page: '#0b1020',
  grid: 'rgba(148,163,184,.16)',
  panel: 'rgba(17,24,39,.9)',
  card: 'rgba(15,23,42,.96)',
  cardSolid: '#111827',
  soft: '#1e293b',
  soft2: '#263449',
  line: '#334155',
  line2: '#64748b',
  text: '#f8fafc',
  muted: '#cbd5e1',
  faint: '#94a3b8',
  shadow: 'rgba(0,0,0,.28)',
  strong: '#f8fafc',
  strongText: '#0f172a',
};

export const themes: Record<CanvasTheme, ThemeTokens> = {
  light: lightTokens,
  dark: darkTokens,
};

export function getTheme(theme: CanvasTheme): ThemeTokens {
  return themes[theme];
}
