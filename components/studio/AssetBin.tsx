/**
 * AssetBin — 剪辑台补充素材面板（默认折叠）。
 *
 * 折叠态：一条窄竖栏"补充素材 (N) ▸"（N = 未入轨资产数），点击展开；
 * 展开态：双维度筛选（tab 全部/图片/视频 × 类型 chips，两维取交集，0 数量类型隐藏，
 * 切换 tab 后选中类型无结果自动回落"全部类型"）+ 缩略图列表。
 * 只显示**未入轨**的图片/视频资产：已入轨的从列表消失，从时间线移除后重新出现，
 * 不再全量平铺。点击缩略图把资产追加到时间线末尾（默认 2s/镜头）。
 * 可用性过滤（排除 failed/generating/无 url）由 StudioPanel 侧完成，本组件只做分类展示。
 */
import React, { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, Film, Loader2, PackagePlus } from 'lucide-react';
import { AssetOut } from '../../services/apiClient';
import { useI18n } from '../../i18n';
import {
  ASSET_KIND_CATEGORIES,
  AssetKindCategory,
  assetKindCategory,
  assetKindLabelKey,
  isVideoAsset,
} from './types';

type BinTab = 'all' | 'image' | 'video';
type BinType = 'all' | AssetKindCategory;

interface AssetBinProps {
  /** 可用资产（已排除 failed/generating/无 url）。 */
  assets: AssetOut[];
  loading: boolean;
  /** 已在时间线上的资产 id 集合（用于过滤出未入轨资产）。 */
  addedIds: Set<string>;
  onAdd: (asset: AssetOut) => void;
}

export const AssetBin: React.FC<AssetBinProps> = ({ assets, loading, addedIds, onAdd }) => {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState(false);
  const [tab, setTab] = useState<BinTab>('all');
  const [type, setType] = useState<BinType>('all');

  // 只展示未入轨资产
  const pool = assets.filter((a) => !addedIds.has(a.id));

  // 第一维：图片/视频 tab
  const tabAssets =
    tab === 'all'
      ? pool
      : pool.filter((a) => (tab === 'video' ? isVideoAsset(a) : !isVideoAsset(a)));

  // 各类型在当前 tab 下的数量（chip 角标 + 0 隐藏 + 回落判定共用）
  const countByType = new Map<AssetKindCategory, number>();
  for (const a of tabAssets) {
    const c = assetKindCategory(a);
    countByType.set(c, (countByType.get(c) || 0) + 1);
  }

  // 选中类型在当前 tab 下无结果（切换 tab 或资产变化）→ 自动回落"全部类型"
  useEffect(() => {
    if (type !== 'all' && (countByType.get(type) || 0) === 0) setType('all');
  }, [type, countByType]);

  // 第二维：类型交集
  const visible =
    type === 'all' ? tabAssets : tabAssets.filter((a) => assetKindCategory(a) === type);

  const toggleLabel = t('studioBinToggle').replace('{n}', String(pool.length));

  // 折叠态：窄竖栏展开条
  if (!expanded) {
    return (
      <button
        data-testid="studio-bin-expand"
        title={toggleLabel}
        onClick={() => setExpanded(true)}
        className="w-10 flex-shrink-0 border-r border-white/[0.05] flex flex-col items-center gap-2 py-3 text-white/35 hover:text-white/90 hover:bg-white/[0.04] transition-all"
      >
        <ChevronRight className="w-4 h-4 flex-shrink-0" />
        <span className="text-[10px] font-medium [writing-mode:vertical-rl]">{toggleLabel}</span>
      </button>
    );
  }

  const tabs: { id: BinTab; label: string }[] = [
    { id: 'all', label: t('studioTlBinTabAll') },
    { id: 'image', label: t('studioTlBinTabImage') },
    { id: 'video', label: t('studioTlBinTabVideo') },
  ];

  const typeChips: { id: BinType; label: string; count: number }[] = [
    { id: 'all', label: t('studioBinTypeAll'), count: tabAssets.length },
    ...ASSET_KIND_CATEGORIES.map((c) => ({
      id: c as BinType,
      label: t(assetKindLabelKey(c)),
      count: countByType.get(c) || 0,
    })),
  ];

  return (
    <aside
      className="w-[240px] flex-shrink-0 border-r border-white/[0.05] bg-white/[0.02] flex flex-col min-h-0"
      data-testid="studio-asset-bin"
    >
      <div className="px-3 pt-3 pb-2 text-[11px] font-medium text-white/45 flex items-center gap-2">
        <PackagePlus className="w-3.5 h-3.5 text-[#0A84FF]" />
        <span className="flex-1">{toggleLabel}</span>
        {loading && <Loader2 className="w-3.5 h-3.5 text-[#0A84FF] animate-spin" />}
        <button
          data-testid="studio-bin-collapse"
          title={toggleLabel}
          onClick={() => setExpanded(false)}
          className="p-1 rounded-full text-white/45 hover:bg-white/[0.08] hover:text-white/90 transition-all"
        >
          <ChevronLeft className="w-3.5 h-3.5" />
        </button>
      </div>
      <div className="px-3 pb-2 flex gap-1">
        {tabs.map((tb) => (
          <button
            key={tb.id}
            data-testid={`studio-bin-tab-${tb.id}`}
            onClick={() => setTab(tb.id)}
            className={`px-2.5 py-1 rounded-full text-xs font-medium transition-all ${
              tab === tb.id
                ? 'bg-white/[0.12] text-white'
                : 'text-white/50 hover:text-white/80'
            }`}
          >
            {tb.label}
          </button>
        ))}
      </div>
      <div className="px-3 pb-2 flex flex-wrap gap-1" data-testid="studio-bin-types">
        {typeChips
          .filter((chip) => chip.id === 'all' || chip.count > 0)
          .map((chip) => (
            <button
              key={chip.id}
              data-testid={`studio-bin-type-${chip.id}`}
              onClick={() => setType(chip.id)}
              className={`px-2 py-0.5 rounded-full text-[10px] font-medium transition-all flex items-center gap-1 ${
                type === chip.id
                  ? 'bg-white/[0.12] text-white'
                  : 'text-white/50 hover:text-white/80'
              }`}
            >
              {chip.label}
              <span className="font-mono text-[9px] opacity-70">{chip.count}</span>
            </button>
          ))}
      </div>

      <div className="flex-1 overflow-y-auto px-3 pb-3">
        {!loading && visible.length === 0 ? (
          <div className="flex flex-col items-center text-center gap-3 py-10">
            <div className="w-14 h-14 rounded-2xl bg-white/[0.06] p-4 flex items-center justify-center">
              <PackagePlus className="w-6 h-6 text-white/45" />
            </div>
            <p className="text-xs text-white/45 px-2" data-testid="studio-tl-no-assets">
              {t('studioTlNoAssets')}
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-2" data-testid="studio-tl-asset-grid">
            {visible.map((a) => {
              const category = assetKindCategory(a);
              return (
                <button
                  key={a.id}
                  type="button"
                  data-testid={`studio-tl-asset-${a.id}`}
                  onClick={() => onAdd(a)}
                  title={a.title || a.name}
                  className="relative rounded-xl overflow-hidden transition-all text-left hover:scale-[1.03] hover:shadow-[0_8px_24px_rgba(0,0,0,0.5)]"
                >
                  <img
                    src={a.url!}
                    alt={a.title || a.name}
                    className="w-full aspect-video object-cover bg-black/40"
                  />
                  {/* 资产名：白字压在底部渐变上，一行截断 */}
                  <div className="absolute inset-x-0 bottom-0 px-2 pt-5 pb-1 bg-gradient-to-t from-black/70 to-transparent text-[11px] text-white/60 truncate">
                    {a.title || a.name}
                  </div>
                  {/* 左上角角标行：类型角标在前，视频标识紧随其后 */}
                  <span className="absolute top-1.5 left-1.5 flex items-center gap-1">
                    <span
                      data-testid={`studio-tl-asset-kind-${a.id}`}
                      className="flex items-center px-1.5 py-0.5 rounded-md bg-black/60 text-[10px] font-medium text-white"
                    >
                      {t(assetKindLabelKey(category))}
                    </span>
                    {isVideoAsset(a) && (
                      <span className="flex items-center gap-0.5 px-1.5 py-0.5 rounded-md bg-black/60 text-[10px] font-medium text-white/70">
                        <Film className="w-2.5 h-2.5" />
                        {t('studioTlBinTabVideo')}
                      </span>
                    )}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </aside>
  );
};
