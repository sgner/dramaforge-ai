import React from 'react';
import { Activity } from 'lucide-react';
import { RhythmAnalysis, SequenceRhythm } from '../types';

export const RhythmChart = ({
  rhythmAnalysis,
  t
}: {
  rhythmAnalysis: RhythmAnalysis;
  t: (key: string) => string;
}) => {
  if (!rhythmAnalysis || !rhythmAnalysis.sequenceRhythms?.length) return null;

  const maxASL = Math.max(...rhythmAnalysis.sequenceRhythms.map(r => r.asl), 1);
  const genreBenchmarkASL = parseBenchmarkASL(rhythmAnalysis.genreBenchmark);

  const getBarColor = (asl: number) => {
    if (genreBenchmarkASL) {
      const ratio = asl / genreBenchmarkASL;
      if (ratio > 1.5 || ratio < 0.5) return 'bg-red-500/60';
      if (ratio > 1.2 || ratio < 0.7) return 'bg-yellow-500/50';
      return 'bg-emerald-500/50';
    }
    return 'bg-brand-500/50';
  };

  const getDiagnosticLabel = (asl: number) => {
    if (genreBenchmarkASL) {
      const ratio = asl / genreBenchmarkASL;
      if (ratio > 1.5) return 'WARN:慢';
      if (ratio < 0.5) return 'WARN:快';
      return 'OK';
    }
    return '';
  };

  const waveLine = generateASCIIWave(rhythmAnalysis.sequenceRhythms);

  return (
    <div
      className="rounded-xl p-5 space-y-4"
      style={{ background: 'rgba(17,24,39,0.02)', border: '1px solid rgba(17,24,39,0.06)' }}
    >
      <div className="flex items-center gap-2">
        <Activity className="w-4 h-4 text-brand-400" />
        <span className="text-xs font-medium text-[#111827] uppercase tracking-wider">
          {t('rhythmAnalysis') || 'Rhythm Analysis'}
        </span>
        <span className="text-[10px] text-[#94a3b8] ml-auto">
          ASL {rhythmAnalysis.globalASL}s | σ {rhythmAnalysis.globalSigma} | {rhythmAnalysis.pace}
        </span>
      </div>

      <div className="rounded-lg p-3" style={{ background: '#f8fafc', border: '1px solid rgba(17,24,39,0.04)' }}>
        <pre className="text-[10px] font-mono text-brand-400/50 leading-tight text-center">{waveLine}</pre>
      </div>

      <div className="space-y-2">
        {rhythmAnalysis.sequenceRhythms.map((seq) => (
          <div key={seq.sequenceId} className="flex items-center gap-3">
            <span className="text-[10px] font-mono text-[#94a3b8] w-24 truncate shrink-0" title={seq.sequenceTitle}>
              {seq.sequenceTitle || seq.sequenceId}
            </span>
            <div className="flex-1 h-4 rounded overflow-hidden relative" style={{ background: 'rgba(17,24,39,0.03)' }}>
              <div
                className={`h-full rounded transition-all duration-500 ${getBarColor(seq.asl)}`}
                style={{ width: `${Math.min((seq.asl / maxASL) * 100, 100)}%` }}
              />
              {genreBenchmarkASL && (
                <div
                  className="absolute top-0 bottom-0 w-px bg-black/30"
                  style={{ left: `${Math.min((genreBenchmarkASL / maxASL) * 100, 100)}%` }}
                  title={`Benchmark: ${genreBenchmarkASL}s`}
                />
              )}
            </div>
            <span className="text-[10px] font-mono text-[#64748b] w-10 text-right shrink-0">
              {seq.asl.toFixed(1)}s
            </span>
            <span className={`text-[9px] font-medium w-12 text-right shrink-0 ${
              getDiagnosticLabel(seq.asl) === 'OK' ? 'text-emerald-600/70' : 'text-yellow-600/70'
            }`}>
              {getDiagnosticLabel(seq.asl)}
            </span>
          </div>
        ))}
      </div>

      {rhythmAnalysis.diagnostics && rhythmAnalysis.diagnostics.length > 0 && (
        <div className="space-y-1 pt-2" style={{ borderTop: '1px solid rgba(17,24,39,0.06)' }}>
          {rhythmAnalysis.diagnostics.map((diag, idx) => (
            <div key={idx} className={`text-[10px] font-mono ${
              diag.startsWith('[OK]') ? 'text-emerald-600/60' :
              diag.startsWith('[WARN]') ? 'text-yellow-600/60' :
              'text-[#94a3b8]'
            }`}>
              {diag}
            </div>
          ))}
        </div>
      )}

      {genreBenchmarkASL && (
        <div className="text-[9px] text-[#94a3b8] text-center">
          Benchmark: {rhythmAnalysis.genreBenchmark} (≈{genreBenchmarkASL}s) | 黑线 = 基准线
        </div>
      )}
    </div>
  );
};

function parseBenchmarkASL(benchmark: string): number | null {
  const match = benchmark?.match(/(\d+)-?(\d+)?\s*s/);
  if (!match) return null;
  const low = parseFloat(match[1]);
  const high = match[2] ? parseFloat(match[2]) : low;
  return (low + high) / 2;
}

function generateASCIIWave(rhythms: SequenceRhythm[]): string {
  if (!rhythms.length) return '';
  const maxASL = Math.max(...rhythms.map(r => r.asl), 1);
  const height = 5;
  const cols = rhythms.length;

  const grid: string[][] = [];
  for (let row = 0; row < height; row++) {
    grid.push(new Array(cols).fill(' '));
  }

  rhythms.forEach((r, col) => {
    const normalizedHeight = Math.round((r.asl / maxASL) * (height - 1));
    const peakRow = height - 1 - normalizedHeight;
    for (let row = peakRow; row < height; row++) {
      if (row === peakRow) {
        grid[row][col] = '▄';
      } else if (row === height - 1) {
        grid[row][col] = '▀';
      } else {
        grid[row][col] = '█';
      }
    }
  });

  return grid.map(row => row.join(' ')).join('\n');
}
