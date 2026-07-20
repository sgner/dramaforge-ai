/**
 * AssetBin — 剪辑台补充素材面板（Runway 图2 左侧素材箱形态）。
 *
 * 折叠/展开由 StudioPanel 受控（expanded + onCollapse）：
 * 折叠时本组件不渲染，由左图标栏的 Assets 按钮（studio-bin-expand）唤起；
 * 展开态：顶部搜索框 + 双维度筛选（tab 全部/图片/视频 × 类型 chips，两维取交集，
 * 0 数量类型隐藏，切换 tab 后选中类型无结果自动回落"全部类型"）+ "Recent" 列表。
 * 列表行：44px 圆角缩略图 + 名称 + 类型/视频元信息；只显示**未入轨**的图片/视频资产
 * （已入轨的从列表消失，从时间线移除后重新出现）。点击行把资产追加到时间线末尾（默认 2s/镜头）。
 * 可用性过滤（排除 failed/generating/无 url）由 StudioPanel 侧完成，本组件只做分类展示。
 */
import React, { useEffect, useState } from 'react';
import { ChevronLeft, Film, Loader2, Search } from 'lucide-react';
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
  /** 受控展开态（折叠时本组件不渲染，由左图标栏唤起）。 */
  expanded: boolean;
  onCollapse: () => void;
}

export const AssetBin: React.FC<AssetBinProps> = ({
  assets,
  loading,
  addedIds,
  onAdd,
  expanded,
  onCollapse,
}) => {
  const { t } = useI18n();
  const [tab, setTab] = useState<BinTab>('all');
  const [type, setType] = useState<BinType>('all');
  const [query, setQuery] = useState('');

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
  const typed =
    type === 'all' ? tabAssets : tabAssets.filter((a) => assetKindCategory(a) === type);

  // 搜索框：按名称/标题过滤（空串不过滤）
  const q = query.trim().toLowerCase();
  const visible = q
    ? typed.filter((a) => `${a.title || ''} ${a.name || ''}`.toLowerCase().includes(q))
    : typed;

  // 折叠态：不渲染（左图标栏 Assets 按钮 = studio-bin-expand 负责唤起）
  if (!expanded) return null;

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
      className="w-[240px] flex-shrink-0 border-r border-white/[0.07] bg-[#0F0F12] flex flex-col min-h-0"
      data-testid="studio-asset-bin"
    >
      {/* 搜索框 + 折叠按钮 */}
      <div className="p-2.5 pb-2 flex items-center gap-1.5">
        <div className="relative flex-1 min-w-0">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-white/30 pointer-events-none" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('studioBinSearch')}
            className="w-full bg-white/[0.06] rounded-lg pl-8 pr-2.5 py-1.5 text-xs text-[#F5F5F7] focus:outline-none focus:ring-2 focus:ring-[#6E6BF2]/40 transition-all placeholder:text-white/30"
          />
        </div>
        {loading && <Loader2 className="w-3.5 h-3.5 text-[#6E6BF2] animate-spin flex-shrink-0" />}
        <button
          data-testid="studio-bin-collapse"
          title={t('studioBinToggle').replace('{n}', String(pool.length))}
          onClick={onCollapse}
          className="p-1.5 rounded-md text-white/45 hover:bg-white/[0.08] hover:text-white/90 transition-all flex-shrink-0"
        >
          <ChevronLeft className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* 图片/视频 tab */}
      <div className="px-2.5 pb-2 flex gap-1">
        {tabs.map((tb) => (
          <button
            key={tb.id}
            data-testid={`studio-bin-tab-${tb.id}`}
            onClick={() => setTab(tb.id)}
            className={`px-2.5 py-1 rounded-full text-xs font-medium transition-all ${
              tab === tb.id
                ? 'bg-[rgba(110,107,242,0.14)] text-[#A5A3F8]'
                : 'text-white/50 hover:text-white/80'
            }`}
          >
            {tb.label}
          </button>
        ))}
      </div>

      {/* 类型 chips */}
      <div className="px-2.5 pb-2 flex flex-wrap gap-1" data-testid="studio-bin-types">
        {typeChips
          .filter((chip) => chip.id === 'all' || chip.count > 0)
          .map((chip) => (
            <button
              key={chip.id}
              data-testid={`studio-bin-type-${chip.id}`}
              onClick={() => setType(chip.id)}
              className={`px-2 py-0.5 rounded-full text-[10px] font-medium transition-all flex items-center gap-1 ${
                type === chip.id
                  ? 'bg-[rgba(110,107,242,0.14)] text-[#A5A3F8]'
                  : 'text-white/50 hover:text-white/80'
              }`}
            >
              {chip.label}
              <span className="font-mono text-[9px] opacity-70">{chip.count}</span>
            </button>
          ))}
      </div>

      {/* Recent 列表 */}
      <div className="px-3 pb-1 text-[10px] font-medium uppercase tracking-wider text-white/30">
        {t('studioBinRecent')}
      </div>
      <div className="flex-1 overflow-y-auto px-2 pb-2">
        {!loading && visible.length === 0 ? (
          <div className="flex flex-col items-center text-center gap-3 py-10">
            <div className="w-14 h-14 rounded-2xl bg-white/[0.06] p-4 flex items-center justify-center">
              <Film className="w-6 h-6 text-white/45" />
            </div>
            <p className="text-xs text-white/45 px-2" data-testid="studio-tl-no-assets">
              {t('studioTlNoAssets')}
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-0.5" data-testid="studio-tl-asset-grid">
            {visible.map((a) => {
              const category = assetKindCategory(a);
              return (
                <button
                  key={a.id}
                  type="button"
                  data-testid={`studio-tl-asset-${a.id}`}
                  onClick={() => onAdd(a)}
                  title={a.title || a.name}
                  className="w-full flex items-center gap-2.5 p-1.5 rounded-lg text-left hover:bg-white/[0.05] transition-all group"
                >
                  <img
                    src={a.url!}
                    alt={a.title || a.name}
                    className="w-11 h-11 rounded-md object-cover bg-black/40 flex-shrink-0"
                  />
                  <div className="min-w-0 flex-1 flex flex-col gap-1">
                    <div className="text-xs text-white/85 truncate group-hover:text-white">
                      {a.title || a.name}
                    </div>
                    <div className="flex items-center gap-1">
                      <span
                        data-testid={`studio-tl-asset-kind-${a.id}`}
                        className="flex items-center px-1.5 py-px rounded bg-white/[0.08] text-[9px] font-medium text-white/60"
                      >
                        {t(assetKindLabelKey(category))}
                      </span>
                      {isVideoAsset(a) && (
                        <span className="flex items-center gap-0.5 px-1.5 py-px rounded bg-white/[0.08] text-[9px] font-medium text-white/60">
                          <Film className="w-2.5 h-2.5" />
                          {t('studioTlBinTabVideo')}
                        </span>
                      )}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </aside>
  );
};
