import React from 'react';
import { AlertTriangle, Shield, ArrowRight, X } from 'lucide-react';
import { FilterResult } from '../services/sensitiveWordFilter';

export const SensitiveFilterReport = ({
  result,
  onClose,
  onProceed,
  t
}: {
  result: FilterResult;
  onClose: () => void;
  onProceed: (filteredText: string) => void;
  t: (key: string) => string;
}) => {
  const zoneLabels: Record<string, { label: string; color: string; bg: string }> = {
    redZone: { label: 'Red Zone', color: 'text-red-600', bg: 'bg-red-500/10 border-red-500/20' },
    yellowZone: { label: 'IP Zone', color: 'text-yellow-600', bg: 'bg-yellow-500/10 border-yellow-500/20' },
    celebrityZone: { label: 'Celebrity Zone', color: 'text-orange-600', bg: 'bg-orange-500/10 border-orange-500/20' },
    ipZone: { label: 'Fictional IP Zone', color: 'text-blue-600', bg: 'bg-blue-500/10 border-blue-500/20' },
  };

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-4 animate-in fade-in duration-200"
      style={{ background: 'rgba(0,0,0,0.4)', backdropFilter: 'blur(8px)' }}
    >
      <div
        className="w-full max-w-2xl max-h-[80vh] flex flex-col rounded-2xl overflow-hidden animate-scale-in"
        style={{ background: '#ffffff', border: '1px solid #e8edf3' }}
      >
        <div
          className="flex items-center justify-between px-6 py-4"
          style={{ borderBottom: '1px solid rgba(17,24,39,0.06)' }}
        >
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg" style={{ background: 'rgba(17,24,39,0.04)', border: '1px solid rgba(17,24,39,0.12)' }}>
              <Shield className="w-4 h-4 text-[#64748b]" />
            </div>
            <h3 className="text-base font-semibold text-[#111827] tracking-tight">
              {t('sensitiveFilterReport') || 'Sensitive Word Filter Report'}
            </h3>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-[#64748b] hover:text-[#111827] transition-colors"
            style={{ background: 'rgba(17,24,39,0.03)' }}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-4 custom-scrollbar">
          {result.blocked && (
            <div
              className="rounded-xl p-4"
              style={{ background: 'rgba(220,38,38,0.06)', border: '1px solid rgba(220,38,38,0.2)' }}
            >
              <div className="flex items-center gap-2 mb-2">
                <AlertTriangle className="w-4 h-4 text-red-600" />
                <span className="text-sm font-medium text-red-600">
                  {t('redZoneBlocked') || 'Red Zone words detected — prompt blocked'}
                </span>
              </div>
              <p className="text-xs text-red-600/70">
                {t('redZoneAction') || 'You must modify the script/storyboard before proceeding. These words cannot be auto-replaced.'}
              </p>
              <div className="mt-3 space-y-1">
                {result.blockedMatches.map((m, i) => (
                  <div key={i} className="flex items-center gap-2 text-xs">
                    <span className="px-2 py-0.5 rounded bg-red-500/15 text-red-600 font-mono">"{m.original}"</span>
                    <span className="text-red-600/60">— {t('position') || 'pos'} {m.position}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {result.replacedMatches.length > 0 && (
            <div
              className="rounded-xl p-4"
              style={{ background: 'rgba(17,24,39,0.03)', border: '1px solid rgba(17,24,39,0.08)' }}
            >
              <div className="flex items-center gap-2 mb-3">
                <ArrowRight className="w-4 h-4 text-[#64748b]" />
                <span className="text-sm font-medium text-[#64748b]">
                  {t('autoReplacements') || 'Auto-replacements applied'}
                </span>
              </div>
              <div className="space-y-2">
                {(() => {
                  const grouped: Record<string, typeof result.replacedMatches> = {};
                  for (const m of result.replacedMatches) {
                    if (!grouped[m.zone]) grouped[m.zone] = [];
                    grouped[m.zone].push(m);
                  }
                  return Object.entries(grouped).map(([zone, matches]) => {
                    const style = zoneLabels[zone] || zoneLabels.yellowZone;
                    return (
                      <div
                        key={zone}
                        className="rounded-lg p-3"
                        style={{
                          background: style.bg.includes('yellow') ? 'rgba(234,179,8,0.05)' : style.bg.includes('orange') ? 'rgba(249,115,22,0.05)' : 'rgba(59,130,246,0.05)',
                          border: `1px solid ${style.bg.split(' ')[1] || 'rgba(17,24,39,0.06)'}`
                        }}
                      >
                        <div className={`text-[10px] font-medium uppercase tracking-wider mb-2 ${style.color}`}>
                          {style.label}
                        </div>
                        <div className="space-y-1">
                          {matches.map((m, i) => (
                            <div key={i} className="flex items-center gap-2 text-xs">
                              <span className="px-2 py-0.5 rounded bg-[#f1f5f9] text-[#64748b] font-mono line-through">"{m.original}"</span>
                              <ArrowRight className="w-3 h-3 text-[#94a3b8]" />
                              <span className="px-2 py-0.5 rounded bg-[#f1f5f9] text-[#111827] font-mono">"{m.replacement}"</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  });
                })()}
              </div>
            </div>
          )}

          {!result.blocked && result.replacedMatches.length === 0 && (
            <div className="text-center py-8">
              <Shield className="w-10 h-10 text-emerald-600/50 mx-auto mb-3" />
              <p className="text-sm text-emerald-600/80">{t('noSensitiveWords') || 'No sensitive words detected'}</p>
            </div>
          )}
        </div>

        <div
          className="flex items-center justify-end gap-3 px-6 py-4"
          style={{ borderTop: '1px solid rgba(17,24,39,0.06)' }}
        >
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg text-xs font-medium text-[#64748b] hover:text-[#111827] transition-colors"
            style={{ background: 'rgba(17,24,39,0.04)', border: '1px solid rgba(17,24,39,0.06)' }}
          >
            {t('cancel') || 'Cancel'}
          </button>
          {!result.blocked && (
            <button
              onClick={() => onProceed(result.filteredText)}
              className="px-5 py-2 rounded-lg text-xs font-medium flex items-center gap-2 transition-all hover:-translate-y-0.5 text-white"
              style={{ background: '#111827', boxShadow: '0 4px 12px rgba(17,24,39,0.15)' }}
            >
              <ArrowRight className="w-3.5 h-3.5" />
              {t('proceedWithFiltered') || 'Proceed with filtered prompt'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
