/**
 * DirectorDesk — 工作室导演台：整理 / 审核 / 补缺本项目资产，一键"送入剪辑台"。
 *
 * 数据流（进入阶段 / 切项目 / 点"同步资产"）：
 *   1) rebuild-from-nodes 把画布产物同步为 Asset（静默容错，失败仅 console.warn）；
 *   2) getDramaTask 取脚本 bigShots（按 order 排序，缺失按原数组序）；
 *   3) listAssets + listStudioShots（审片状态 / 初筛状态）；
 *   4) bigShot ↔ Asset / studio shot 按 URL 匹配（videoUrl 优先，storyboardImageUrl 兜底；
 *      同镜头多版本取最高 version）。
 *
 * UI：顶部"生成设置"行（图像供应商 + 模型，单镜头重生成用）+ 汇总条
 * （总数 / 已有视频 / 缺失 / 待审 + "同步资产" + "送入剪辑台"）+ 剧本结构表。
 * 每镜头一行：序号 / 场景 / 出场角色 / 故事板缩略图 / 视频状态徽章 / 审片徽章；
 * 匹配到 shot 资产（asset_kind=="shot"）的行可通过 / 退回 / 重新生成；
 * 有资产但未进审片列表的行标注"素材车间产物"（仅展示）；
 * 缺失 / 已退回的行提示"去素材车间生成"（纯文案，不跳转）。
 *
 * "送入剪辑台"把匹配到 Asset 的镜头按脚本序组成 TimelineItem[]（默认 3s/镜头，
 * caption 取 soraPrompt 截断）经 onSendToTimeline 灌入剪辑台；有缺失镜头时先
 * window.confirm 确认。
 */
import React, { useCallback, useEffect, useState } from 'react';
import { AlertCircle, Clapperboard, Loader2, RefreshCw, Scissors } from 'lucide-react';
import {
  api,
  AssetOut,
  ProviderOut,
  StudioReviewStatus,
  StudioShotOut,
} from '../../services/apiClient';
import { useI18n } from '../../i18n';
import { BigShot } from '../../types';
import { TimelineItem } from './types';
import {
  appleActionBtn,
  appleBadgeNeutral,
  appleBadgeSuccess,
  appleBadgeWarning,
  appleInput,
  appleLabel,
  applePanel,
} from './theme';

/** 送入剪辑台时每个镜头的默认秒数。 */
const DEFAULT_CLIP_SEC = 3;
/** caption 取 soraPrompt 的截断长度。 */
const CAPTION_LEN = 40;

interface DirectorDeskProps {
  /** 当前项目 id（已 trim）。 */
  projectId: string;
  /** enabled 供应商列表（"生成设置"下拉：单镜头重生成用）。 */
  providers: ProviderOut[];
  /** 把整理好的镜头序列灌入剪辑台并切到剪辑台阶段。 */
  onSendToTimeline: (items: TimelineItem[]) => void;
}

/** 一个脚本镜头 + 匹配到的资产 / 审片记录。 */
interface DeskShot {
  shot: BigShot;
  /** 展示序号（1 起，按脚本序）。 */
  index: number;
  /** 按 URL 匹配到的项目资产（null = 素材缺失）。 */
  asset: AssetOut | null;
  /** 匹配到的审片 shot（asset_kind=="shot"，多版本取最新；null = 未进审片列表）。 */
  studioShot: StudioShotOut | null;
}

// 与 StudioPanel 一致的 Apple HIG 深色工作台配色
const inputCls = appleInput;
const labelCls = appleLabel;
const panelCls = applePanel;
const actionBtnCls = appleActionBtn;

/** bigShots 排序：有 order 按 order，缺失按原数组序。 */
const sortBigShots = (list: BigShot[]): BigShot[] =>
  list
    .map((s, i) => ({ s, i }))
    .sort((a, b) => (a.s.order ?? a.i) - (b.s.order ?? b.i))
    .map((x) => x.s);

export const DirectorDesk: React.FC<DirectorDeskProps> = ({
  projectId,
  providers,
  onSendToTimeline,
}) => {
  const { t } = useI18n();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deskShots, setDeskShots] = useState<DeskShot[]>([]);
  // 生成设置：单镜头重生成使用的图像供应商/模型
  const [imageProviderId, setImageProviderId] = useState('');
  const [imageModel, setImageModel] = useState('');
  const [reviewingId, setReviewingId] = useState<string | null>(null);
  const [regeneratingId, setRegeneratingId] = useState<string | null>(null);

  /** 完整加载流程：同步画布产物 → 拉脚本 / 资产 / 审片记录 → URL 匹配。 */
  const load = useCallback(async () => {
    const pid = projectId.trim();
    if (!pid) {
      setDeskShots([]);
      return;
    }
    setLoading(true);
    setError(null);
    // 1) 画布产物 → Asset（静默容错）
    try {
      await api.rebuildAssets(pid);
    } catch (e) {
      console.warn('[DirectorDesk] rebuildAssets failed', e);
    }
    // 2) 脚本（失败显示错误横幅，资产/审片降级为空）
    let bigShots: BigShot[] = [];
    try {
      const task = await api.getDramaTask(pid);
      bigShots = sortBigShots((((task as any)?.data?.bigShots as BigShot[] | undefined) || []));
    } catch (e: any) {
      console.warn('[DirectorDesk] getDramaTask failed', e);
      setError(e?.message || String(e));
    }
    // 3) 资产 + 审片记录（各自容错）
    let assets: AssetOut[] = [];
    try {
      assets = await api.listAssets(pid);
    } catch (e) {
      console.warn('[DirectorDesk] listAssets failed', e);
    }
    let studioShots: StudioShotOut[] = [];
    try {
      studioShots = await api.listStudioShots(pid);
    } catch (e) {
      console.warn('[DirectorDesk] listStudioShots failed', e);
    }

    // 4) 匹配：优先显式关联（asset.extra.bigshot_id），URL 匹配兜底（兼容旧数据）；
    //    URL 匹配成功但缺显式关联时回写 bigshot_id 自愈断链。
    const assetByBigshotId = new Map<string, AssetOut>();
    for (const a of assets) {
      const bigshotId = (a as any).extra?.bigshot_id;
      if (bigshotId && !assetByBigshotId.has(bigshotId)) assetByBigshotId.set(bigshotId, a);
    }
    const assetByUrl = new Map<string, AssetOut>();
    for (const a of assets) {
      if (a.url && !assetByUrl.has(a.url)) assetByUrl.set(a.url, a);
    }
    const shotByUrl = new Map<string, StudioShotOut>();
    for (const s of studioShots) {
      if (!s.url) continue;
      const prev = shotByUrl.get(s.url);
      if (!prev || s.version > prev.version) shotByUrl.set(s.url, s);
    }
    const relinkQueue: AssetOut[] = [];
    const rows: DeskShot[] = bigShots.map((shot, i) => {
      const urls = [shot.videoUrl, shot.storyboardImageUrl].filter(Boolean) as string[];
      let asset: AssetOut | null = assetByBigshotId.get(shot.id) || null;
      let studioShot: StudioShotOut | null = null;
      for (const u of urls) {
        if (!asset) asset = assetByUrl.get(u) || null;
        if (!studioShot) studioShot = shotByUrl.get(u) || null;
      }
      if (asset && !(asset as any).extra?.bigshot_id) relinkQueue.push(asset);
      return { shot, index: i + 1, asset, studioShot };
    });
    setDeskShots(rows);
    setLoading(false);
    // 自愈：把 URL 匹配上的资产回写显式 bigshot_id（fire-and-forget）
    for (const asset of relinkQueue) {
      const shotId = rows.find((r) => r.asset?.id === asset.id)?.shot.id;
      if (!shotId) continue;
      api.updateAsset(asset.id, {
        extra: { ...((asset as any).extra || {}), bigshot_id: shotId },
      } as any).catch((e) => console.warn('[DirectorDesk] relink bigshot_id failed', e));
    }
  }, [projectId]);

  // 进入阶段 / 切项目时加载
  useEffect(() => {
    void load();
  }, [load]);

  const imageProviders = providers.filter((p) => (p.image_models || []).length > 0);
  const selectedImageProvider = imageProviders.find((p) => p.provider_id === imageProviderId);
  // 生成设置未选全：单镜头重生成不可用
  const regenReady = Boolean(imageProviderId && imageModel);

  // 汇总：总数 / 已有视频 / 缺失（未匹配到资产）/ 待审
  const totalCount = deskShots.length;
  const readyCount = deskShots.filter((d) => Boolean(d.shot.videoUrl)).length;
  const missingCount = deskShots.filter((d) => !d.asset).length;
  const pendingCount = deskShots.filter(
    (d) => d.studioShot?.review_status === 'pending_review'
  ).length;

  /** 可送入剪辑台的镜头：匹配到 Asset（即有视频或故事板图）。 */
  const sendable = deskShots.filter((d) => d.asset);

  /** 审核操作：approve/reject；reject 弹备注输入。成功后就地更新。 */
  const handleReview = async (row: DeskShot, action: 'approve' | 'reject') => {
    const s = row.studioShot;
    if (!s) return;
    let note: string | undefined;
    if (action === 'reject') {
      const input = window.prompt(t('studioReviewNotePrompt'));
      if (input === null) return; // 用户取消
      note = input.trim() || undefined;
    }
    setReviewingId(s.asset_id);
    try {
      const res = await api.reviewStudioShot(s.asset_id, action, note);
      setDeskShots((prev) =>
        prev.map((d) =>
          d.studioShot?.asset_id === s.asset_id
            ? {
                ...d,
                studioShot: {
                  ...d.studioShot,
                  review_status: res.review_status,
                  review_note: res.review_note,
                },
              }
            : d
        )
      );
    } catch (e: any) {
      console.warn('[DirectorDesk] reviewStudioShot failed', e);
      setError(e?.message || String(e));
    } finally {
      setReviewingId(null);
    }
  };

  /** 单镜头重生成：同步接口（1~2 分钟），用"生成设置"行已选的图像供应商/模型。 */
  const handleRegenerate = async (row: DeskShot) => {
    const s = row.studioShot;
    if (!s) return;
    if (!imageProviderId || !imageModel) {
      setError(t('studioErrorProviderRequired'));
      return;
    }
    setError(null);
    setRegeneratingId(s.asset_id);
    try {
      await api.regenerateStudioShot({
        project_id: projectId.trim(),
        asset_id: s.asset_id,
        image_provider_id: imageProviderId,
        image_model: imageModel,
        // 新版本继承显式 bigshot 关联，重生成换 URL 也不会断链
        bigshot_id: row.shot.id,
      });
      await load(); // 新版本出现：整体刷新
    } catch (e: any) {
      console.warn('[DirectorDesk] regenerateStudioShot failed', e);
      setError(e?.message || String(e));
    } finally {
      setRegeneratingId(null);
    }
  };

  /** 送入剪辑台：有缺失镜头时先确认；按脚本序灌入 TimelineItem[]。 */
  const handleSend = () => {
    if (sendable.length === 0) return;
    const missing = totalCount - sendable.length;
    if (
      missing > 0 &&
      !window.confirm(t('studioDirSendConfirm').replace('{n}', String(missing)))
    ) {
      return;
    }
    onSendToTimeline(
      sendable.map((d) => ({
        asset: d.asset!,
        sec: DEFAULT_CLIP_SEC,
        caption: (d.shot.soraPrompt || '').slice(0, CAPTION_LEN),
      }))
    );
  };

  // ---------- 标记元数据 ----------

  const videoStatusMeta = (row: DeskShot) => {
    if (row.shot.videoUrl) {
      return { text: t('studioDirVideoReady'), cls: appleBadgeSuccess };
    }
    if (row.shot.generationStatus === 'generating') {
      return { text: t('studioDirVideoGenerating'), cls: appleBadgeWarning };
    }
    return { text: t('studioDirVideoMissing'), cls: appleBadgeNeutral };
  };

  const reviewStatusMeta = (status: StudioReviewStatus) => {
    switch (status) {
      case 'approved':
        return { text: t('studioReviewApproved'), cls: appleBadgeSuccess };
      case 'rejected':
        return { text: t('studioReviewRejected'), cls: 'bg-[#F26161]/15 text-[#F26161] border-[#F26161]/30' };
      case 'locked':
        return { text: t('studioReviewLocked'), cls: 'bg-[#6E6BF2]/15 text-[#6E6BF2] border-[#6E6BF2]/30' };
      default:
        return { text: t('studioReviewPending'), cls: appleBadgeNeutral };
    }
  };

  const criticMeta = (status: StudioShotOut['critic_status']) => {
    if (status === 'approved') return { text: t('studioCriticPass'), cls: 'text-[#3ECF8E]' };
    if (status === 'max_rounds_exceeded') return { text: t('studioCriticFail'), cls: 'text-[#F5B544]' };
    return null;
  };

  // ---------- 渲染 ----------

  const renderRow = (row: DeskShot) => {
    const { shot } = row;
    const vs = videoStatusMeta(row);
    const s = row.studioShot;
    const rsMeta = s ? reviewStatusMeta(s.review_status) : null;
    const cMeta = s ? criticMeta(s.critic_status) : null;
    const busy = s ? reviewingId === s.asset_id || regeneratingId === s.asset_id : false;
    const rejected = s?.review_status === 'rejected';
    return (
      <div
        key={shot.id}
        data-testid={`studio-dir-shot-${shot.id}`}
        className="px-3 py-4 flex items-center gap-4 rounded-lg hover:bg-white/[0.03] transition-colors"
      >
        <span className="text-sm font-mono font-medium text-white/35 w-8 flex-shrink-0">
          #{row.index}
        </span>
        {shot.storyboardImageUrl ? (
          <img
            src={shot.storyboardImageUrl}
            alt=""
            className="w-20 h-12 rounded-lg object-cover flex-shrink-0 bg-black/30"
          />
        ) : (
          <div className="w-20 h-12 rounded-lg bg-white/[0.04] flex-shrink-0" />
        )}
        <div className="min-w-0 flex-1 flex flex-col gap-1">
          <div className="text-sm text-white/90 truncate">
            <span className="text-white/45">{t('studioDirScene')}：</span>
            {shot.sceneAsset?.location || '—'}
            {(shot.charactersInvolved || []).length > 0 && (
              <>
                <span className="mx-2 text-white/15">|</span>
                <span className="text-white/45">{t('studioDirCharacters')}：</span>
                {shot.charactersInvolved.join(', ')}
              </>
            )}
          </div>
          <div className="flex items-center flex-wrap gap-2">
            <span
              data-testid={`studio-dir-video-${shot.id}`}
              className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${vs.cls}`}
            >
              {vs.text}
            </span>
            {rsMeta && (
              <span
                data-testid={`studio-dir-review-${shot.id}`}
                className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${rsMeta.cls}`}
              >
                {rsMeta.text}
              </span>
            )}
            {cMeta && <span className={`text-[10px] font-bold ${cMeta.cls}`}>{cMeta.text}</span>}
            {!s && row.asset && (
              <span data-testid={`studio-dir-workshop-${shot.id}`} className="text-[10px] text-white/35">
                {t('studioDirWorkshopProduct')}
              </span>
            )}
            {(!row.asset || rejected) && (
              <span
                data-testid={`studio-dir-go-workshop-${shot.id}`}
                className="text-[10px] text-[#F5B544]/90"
              >
                {t('studioDirGoWorkshop')}
              </span>
            )}
          </div>
        </div>
        {s && (
          <div className="flex items-center gap-2 flex-shrink-0">
            <button
              data-testid={`studio-dir-approve-${shot.id}`}
              disabled={busy}
              onClick={() => handleReview(row, 'approve')}
              className={`${actionBtnCls} bg-[#3ECF8E]/15 text-[#3ECF8E] hover:bg-[#3ECF8E]/25`}
            >
              {t('studioReviewApprove')}
            </button>
            <button
              data-testid={`studio-dir-reject-${shot.id}`}
              disabled={busy}
              onClick={() => handleReview(row, 'reject')}
              className={`${actionBtnCls} bg-transparent border border-[#F26161]/30 text-[#F26161] hover:bg-[#F26161]/10`}
            >
              {t('studioReviewReject')}
            </button>
            <button
              data-testid={`studio-dir-regen-${shot.id}`}
              disabled={busy || regeneratingId !== null || !regenReady}
              title={regenReady ? undefined : t('studioGenSettingsHint')}
              onClick={() => handleRegenerate(row)}
              className={`${actionBtnCls} bg-white/[0.08] text-white/80 hover:bg-white/[0.12]`}
            >
              {regeneratingId === s.asset_id ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  {t('studioRegenerating')}
                </>
              ) : (
                <>
                  <RefreshCw className="w-3.5 h-3.5" />
                  {t('studioRegenerate')}
                </>
              )}
            </button>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="max-w-5xl mx-auto flex flex-col gap-6" data-testid="studio-director-desk">
      {/* 生成设置：单镜头重生成使用的图像供应商/模型 */}
      <section
        className={`${panelCls} px-4 py-3 flex flex-wrap items-end gap-3`}
        data-testid="studio-gen-settings"
      >
        <span className="text-[11px] font-medium text-white/45 pb-2">
          {t('studioGenSettings')}
        </span>
        <div className="w-44">
          <label className={labelCls}>{t('studioImageProvider')}</label>
          <select
            data-testid="studio-image-provider"
            className={`${inputCls} !py-1.5 !rounded-lg`}
            value={imageProviderId}
            onChange={(e) => {
              setImageProviderId(e.target.value);
              setImageModel('');
            }}
          >
            <option value="">{t('studioSelectProvider')}</option>
            {imageProviders.map((p) => (
              <option key={p.provider_id} value={p.provider_id}>
                {p.name || p.provider_id}
              </option>
            ))}
          </select>
        </div>
        <div className="w-44">
          <label className={labelCls}>{t('studioImageModel')}</label>
          <select
            data-testid="studio-image-model"
            className={`${inputCls} !py-1.5 !rounded-lg`}
            value={imageModel}
            onChange={(e) => setImageModel(e.target.value)}
          >
            <option value="">{t('studioSelectModel')}</option>
            {(selectedImageProvider?.image_models || []).map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </div>
        {imageProviders.length === 0 ? (
          <p className="text-xs text-[#F5B544] pb-2">{t('studioNoImageProviders')}</p>
        ) : (
          !regenReady && (
            <p className="text-xs text-[#F5B544] pb-2" data-testid="studio-gen-settings-hint">
              {t('studioGenSettingsHint')}
            </p>
          )
        )}
      </section>

      {/* 汇总条：总数 / 已有视频 / 缺失 / 待审 + 同步 + 送入剪辑台（无边框盒） */}
      <section
        className="flex flex-wrap items-center gap-3 px-1"
        data-testid="studio-dir-summary"
      >
        <Clapperboard className="w-4 h-4 text-[#6E6BF2]" />
        <span className="text-sm text-white/80" data-testid="studio-dir-summary-text">
          {t('studioDirSummary')
            .replace('{total}', String(totalCount))
            .replace('{ready}', String(readyCount))
            .replace('{missing}', String(missingCount))
            .replace('{pending}', String(pendingCount))}
        </span>
        <div className="flex-1" />
        {loading && <Loader2 className="w-4 h-4 text-[#6E6BF2] animate-spin" />}
        <button
          data-testid="studio-dir-sync"
          onClick={() => void load()}
          disabled={loading}
          className={`${actionBtnCls} bg-white/[0.08] text-white/80 hover:bg-white/[0.12]`}
        >
          <RefreshCw className="w-3.5 h-3.5" />
          {t('studioDirSync')}
        </button>
        <button
          data-testid="studio-send-timeline"
          onClick={handleSend}
          disabled={sendable.length === 0}
          className="px-4 py-1.5 rounded-full text-xs font-medium bg-[#6E6BF2] text-white hover:bg-[#6E6BF2]/90 active:scale-[0.98] transition-all disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5"
        >
          <Scissors className="w-3.5 h-3.5" />
          {t('studioDirSendTimeline')}
        </button>
      </section>

      {error && (
        <div
          data-testid="studio-dir-error"
          className="flex items-center gap-2 text-sm text-[#F26161] bg-[#F26161]/10 border border-[#F26161]/30 rounded-xl px-4 py-2.5"
        >
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          {error}
        </div>
      )}

      {!loading && deskShots.length === 0 && !error && (
        <div className="flex flex-col items-center justify-center text-center py-24 gap-4">
          <div className="w-14 h-14 rounded-2xl bg-white/[0.06] p-4 flex items-center justify-center">
            <Clapperboard className="w-6 h-6 text-white/45" />
          </div>
          <div className="text-[15px] font-semibold text-white/90">
            {t('studioStageDirector')}
          </div>
          <p className="text-xs text-white/45 max-w-[280px]" data-testid="studio-dir-empty">
            {t('studioDirEmpty')}
          </p>
        </div>
      )}

      {/* 剧本结构表：每镜头一行，行间细线分隔 */}
      <div className="flex flex-col divide-y divide-white/[0.05]">
        {deskShots.map((row) => renderRow(row))}
      </div>
    </div>
  );
};
