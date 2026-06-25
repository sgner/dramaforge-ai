import React from 'react';
import { X, CheckCircle, XCircle, Shield, User, Mountain, Sparkles, Clapperboard, ClipboardList, Check } from 'lucide-react';
import { AssetCheckResult } from '../utils/assetChecker';

export const AssetCheckReport = ({
  result,
  onClose,
  t
}: {
  result: AssetCheckResult;
  onClose: () => void;
  t: (key: string) => string;
}) => {
  const categoryOrder = ['Character', 'Scene', 'Prop', 'Shot'];
  const grouped: Record<string, typeof result.items> = {};
  for (const item of result.items) {
    if (!grouped[item.category]) grouped[item.category] = [];
    grouped[item.category].push(item);
  }

  const catIcons: Record<string, React.ReactNode> = {
    Character: <User className="w-3.5 h-3.5" />,
    Scene: <Mountain className="w-3.5 h-3.5" />,
    Prop: <Sparkles className="w-3.5 h-3.5" />,
    Shot: <Clapperboard className="w-3.5 h-3.5" />
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
              {t('assetCheckReport') || 'Asset Quality Check'}
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

        <div
          className="px-6 py-3 flex items-center gap-4"
          style={{ borderBottom: '1px solid rgba(17,24,39,0.04)' }}
        >
          <div className={`text-sm font-medium flex items-center gap-1.5 ${result.overallPass ? 'text-emerald-600' : 'text-red-600'}`}>
            {result.overallPass ? <Check className="w-4 h-4" /> : <X className="w-4 h-4" />}
            {result.overallPass ? 'ALL PASSED' : `${result.failedChecks} FAILED`}
          </div>
          <div className="text-[10px] text-[#94a3b8]">
            {result.passedChecks}/{result.totalChecks} checks passed
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-5 custom-scrollbar">
          {categoryOrder.filter(c => grouped[c]).map(category => {
            const catItems = grouped[category];
            const catFailed = catItems.filter(i => !i.passed).length;
            return (
              <div key={category}>
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-sm flex items-center text-[#64748b]">{catIcons[category] || <ClipboardList className="w-3.5 h-3.5" />}</span>
                  <span className="text-xs font-medium text-[#111827] uppercase tracking-wider">{category}</span>
                  {catFailed > 0 && <span className="text-[10px] text-red-600/70 ml-auto">{catFailed} issues</span>}
                </div>
                <div className="space-y-1">
                  {catItems.map((item, idx) => (
                    <div
                      key={idx}
                      className="flex items-start gap-2 p-2 rounded-lg"
                      style={{
                        background: item.passed ? 'rgba(34,197,94,0.04)' : 'rgba(239,68,68,0.04)',
                        border: `1px solid ${item.passed ? 'rgba(34,197,94,0.1)' : 'rgba(239,68,68,0.12)'}`
                      }}
                    >
                      {item.passed ? (
                        <CheckCircle className="w-3.5 h-3.5 text-emerald-600/70 mt-0.5 shrink-0" />
                      ) : (
                        <XCircle className="w-3.5 h-3.5 text-red-600/80 mt-0.5 shrink-0" />
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] text-[#111827] font-mono">{item.itemName}</span>
                          <span className={`text-[10px] font-mono ${item.passed ? 'text-emerald-600/60' : 'text-red-600/70'}`}>{item.checkName}</span>
                        </div>
                        {!item.passed && (
                          <div className="text-[10px] text-red-600/60 mt-0.5">{item.detail}</div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>

        <div
          className="flex items-center justify-end gap-3 px-6 py-4"
          style={{ borderTop: '1px solid rgba(17,24,39,0.06)' }}
        >
          <button
            onClick={onClose}
            className="px-5 py-2 rounded-lg text-xs font-medium transition-all hover:-translate-y-0.5 text-white"
            style={{ background: '#111827', boxShadow: '0 4px 12px rgba(17,24,39,0.15)' }}
          >
            {t('close') || 'Close'}
          </button>
        </div>
      </div>
    </div>
  );
};
