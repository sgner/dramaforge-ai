/**
 * 剪辑台共享类型与资产判定工具。
 */
import { AssetOut } from '../../services/apiClient';

/** 剪辑台时间线条目：资产 + 每镜头秒数 + 可选字幕。 */
export interface TimelineItem {
  asset: AssetOut;
  sec: number;
  caption: string;
}

/** 资产是否为视频类（kind/asset_kind 含 video）。 */
export const isVideoAsset = (a: AssetOut): boolean =>
  `${a.kind || ''} ${a.asset_kind || ''}`.toLowerCase().includes('video');

/** 资产类型分类（asset_kind 约定值；空或未知值兜底为 other）。 */
export type AssetKindCategory = 'character' | 'scene' | 'prop' | 'shot' | 'sequence' | 'other';

export const ASSET_KIND_CATEGORIES: AssetKindCategory[] = [
  'character',
  'scene',
  'prop',
  'shot',
  'sequence',
  'other',
];

/** 资产类型归类：asset_kind 为空或未知值时归入 other。 */
export const assetKindCategory = (a: AssetOut): AssetKindCategory => {
  const k = (a.asset_kind || '').toLowerCase();
  if (k === 'character' || k === 'scene' || k === 'prop' || k === 'shot' || k === 'sequence') {
    return k;
  }
  return 'other';
};

/** 资产类型对应的 i18n key（studioAssetKind{Character|Scene|...}）。 */
export const assetKindLabelKey = (c: AssetKindCategory): string =>
  `studioAssetKind${c[0].toUpperCase()}${c.slice(1)}`;
