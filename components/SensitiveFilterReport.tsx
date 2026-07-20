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
  const zoneLabels: Record<string, { label: string; color: string }> = {
    redZone: { label: 'Red Zone', color: 'text-[#F26161]' },
    yellowZone: { label: 'IP Zone', color: 'text-[#F5B544]' },
    celebrityZone: { label: 'Celebrity Zone', color: 'text-orange-400' },
    ipZone: { label: 'Fictional IP Zone', color: 'text-blue-400' },
  };

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-4 animate-in fade-in duration-200"
      style={{ background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(8px)' }}
    >
      <div
        className="w-full max-w-2xl max-h-[80vh] flex flex-col rounded-2xl overflow-hidden animate-scale-in shadow-2xl shadow-black/60"
        style={{ background: '#131316', border: '1px solid rgba(255,255,255,0.07)' }}
      >
        <div
          className="flex items-center justify-between px-6 py-4"
          style={{ borderBottom: '1px solid rgba(255,255,255,0.07)' }}
        >
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg" style={{ background: 'rgba(110,107,242,0.14)', border: '1px solid rgba(110,107,242,0.30)' }}>
              <Shield className="w-4 h-4 text-[#817FF5]" />
            </div>
            <h3 className="text-[15px] font-semibold text-[#F5F5F7] tracking-tight">
              {t('sensitiveFilterReport') || 'Sensitive Word Filter Report'}
            </h3>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-white/45 hover:text-[#F5F5F7] transition-colors"
            style={{ background: 'rgba(255,255,255,0.06)' }}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-4 custom-scrollbar">
          {result.blocked && (
            <div
              className="rounded-xl p-4"
              style={{ background: 'rgba(242,97,97,0.08)', border: '1px solid rgba(242,97,97,0.25)' }}
            >
              <div className="flex items-center gap-2 mb-2">
                <AlertTriangle className="w-4 h-4 text-[#F26161]" />
                <span className="text-sm font-medium text-[#F26161]">
                  {t('redZoneBlocked') || 'Red Zone words detected — prompt blocked'}
                </span>
              </div>
              <p className="text-xs text-[#F26161]/70">
                {t('redZoneAction') || 'You must modify the script/storyboard before proceeding. These words cannot be auto-replaced.'}
              </p>
              <div className="mt-3 space-y-1">
                {result.blockedMatches.map((m, i) => (
                  <div key={i} className="flex items-center gap-2 text-xs">
                    <span className="px-2 py-0.5 rounded bg-[#F26161]/15 text-[#F26161] font-mono">"{m.original}"</span>
                    <span className="text-[#F26161]/60">— {t('position') || 'pos'} {m.position}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {result.replacedMatches.length > 0 && (
            <div
              className="rounded-xl p-4"
              style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }}
            >
              <div className="flex items-center gap-2 mb-3">
                <ArrowRight className="w-4 h-4 text-white/45" />
                <span className="text-sm font-medium text-white/60">
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
                    const zoneBg = zone === 'celebrityZone'
                      ? 'rgba(249,115,22,0.08)'
                      : zone === 'ipZone'
                        ? 'rgba(96,165,250,0.08)'
                        : 'rgba(245,181,68,0.08)';
                    const zoneBorder = zone === 'celebrityZone'
                      ? 'rgba(249,115,22,0.20)'
                      : zone === 'ipZone'
                        ? 'rgba(96,165,250,0.20)'
                        : 'rgba(245,181,68,0.20)';
                    return (
                      <div
                        key={zone}
                        className="rounded-lg p-3"
                        style={{ background: zoneBg, border: `1px solid ${zoneBorder}` }}
                      >
                        <div className={`text-[10px] font-medium uppercase tracking-wider mb-2 ${style.color}`}>
                          {style.label}
                        </div>
                        <div className="space-y-1">
                          {matches.map((m, i) => (
                            <div key={i} className="flex items-center gap-2 text-xs">
                              <span className="px-2 py-0.5 rounded bg-white/[0.06] text-white/40 font-mono line-through">"{m.original}"</span>
                              <ArrowRight className="w-3 h-3 text-white/30" />
                              <span className="px-2 py-0.5 rounded bg-white/[0.08] text-[#F5F5F7] font-mono">"{m.replacement}"</span>
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
              <Shield className="w-10 h-10 text-[#3ECF8E]/50 mx-auto mb-3" />
              <p className="text-sm text-[#3ECF8E]/80">{t('noSensitiveWords') || 'No sensitive words detected'}</p>
            </div>
          )}
        </div>

        <div
          className="flex items-center justify-end gap-3 px-6 py-4"
          style={{ borderTop: '1px solid rgba(255,255,255,0.07)' }}
        >
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-full text-xs font-medium text-white/60 hover:text-[#F5F5F7] transition-colors"
            style={{ background: '#1A1A1F', border: '1px solid rgba(255,255,255,0.07)' }}
          >
            {t('cancel') || 'Cancel'}
          </button>
          {!result.blocked && (
            <button
              onClick={() => onProceed(result.filteredText)}
              className="px-5 py-2 rounded-full text-xs font-semibold flex items-center gap-2 transition-all hover:bg-[#817FF5] text-white"
              style={{ background: '#6E6BF2', boxShadow: '0 4px 14px rgba(110,107,242,0.30)' }}
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
