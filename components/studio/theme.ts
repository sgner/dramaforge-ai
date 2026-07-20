/**
 * theme.ts — 工作室（StudioPanel + studio/ 子组件）共用的 Runway 暗色样式常量。
 *
 * 纯 className 字符串（Tailwind 任意值），只负责视觉，不含任何交互逻辑。
 * 规范（docs/creator-studio/runway-redesign-brief.md §1）：页面底 #0A0A0B，
 * 面板 #131316 + 1px rgba(255,255,255,0.07) 描边，强调色 Runway 蓝紫 #6E6BF2
 * （hover #817FF5，选中底 rgba(110,107,242,0.14)），语义色 #3ECF8E / #F5B544 / #F26161。
 * 时间线轨道色：视频 #8B7CF6、图像/素材 #E8738C、字幕/文本 #E5C77E、音频 #4CC38A、AI 层 #F2A65A。
 */

// ---------- 色板（供 style 属性 / 动态拼接使用） ----------
export const ACCENT = '#6E6BF2';
export const ACCENT_HOVER = '#817FF5';
export const ACCENT_SOFT = 'rgba(110,107,242,0.14)';
/** 时间线轨道配色（brief §1）。 */
export const TRACK_COLORS = {
  video: '#8B7CF6',
  image: '#E8738C',
  subtitle: '#E5C77E',
  audio: '#4CC38A',
  ai: '#F2A65A',
} as const;
/** 播放头红色（图2：竖线 + 顶部圆点）。 */
export const PLAYHEAD_RED = '#F26161';

// ---------- 基础材质 ----------
/** 面板/卡片：#131316 底 + 1px 淡描边，10px 圆角。 */
export const applePanel = 'bg-[#131316] border border-white/[0.07] rounded-xl';
/** 悬浮/输入底（surface-2）。 */
export const studioSurface2 = 'bg-[#1A1A1F] border border-white/[0.07] rounded-lg';

// ---------- 文本 ----------
/** 小字标签：11px + 中灰。 */
export const appleLabel = 'block text-[11px] font-medium text-white/45 mb-1.5';
/** 检查器分区标题：12px muted。 */
export const studioSectionTitle = 'text-[12px] font-medium text-white/45';

// ---------- 控件 ----------
/** 输入框/下拉：填充式（白 6% 底、无边框），focus 时蓝紫光环。 */
export const appleInput =
  'w-full bg-white/[0.06] rounded-lg px-3.5 py-2.5 text-sm text-[#F5F5F7] ' +
  'focus:outline-none focus:ring-2 focus:ring-[#6E6BF2]/40 transition-all placeholder:text-white/30';
/** 小型动作按钮基础形（导演台/检查器的操作按钮共用，配色在调用处追加）。 */
export const appleActionBtn =
  'px-3 py-1.5 rounded-full text-xs font-medium transition-all flex items-center gap-1 ' +
  'active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed';
/** 主按钮：accent 实心胶囊。 */
export const studioPrimaryBtn = 'bg-[#6E6BF2] text-white hover:bg-[#817FF5]';
/** 次按钮：surface-2 幽灵按钮。 */
export const studioGhostBtn =
  'bg-white/[0.06] text-white/80 hover:bg-white/[0.1] border border-white/[0.07]';

// ---------- 语义徽章（/15 底 + 纯色字 + 同色淡描边；字号在调用处控制） ----------
export const appleBadgeSuccess = 'bg-[#3ECF8E]/15 text-[#3ECF8E] border-[#3ECF8E]/30';
export const appleBadgeWarning = 'bg-[#F5B544]/15 text-[#F5B544] border-[#F5B544]/30';
export const appleBadgeDanger = 'bg-[#F26161]/15 text-[#F26161] border-[#F26161]/30';
export const appleBadgeNeutral = 'bg-white/[0.06] text-white/55 border-white/[0.08]';
