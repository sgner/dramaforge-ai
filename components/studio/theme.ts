/**
 * theme.ts — 工作室（StudioPanel + studio/ 子组件）共用的 Apple HIG 深色样式常量。
 *
 * 纯 className 字符串（Tailwind 任意值），只负责视觉，不含任何交互逻辑。
 * 规范：径向渐变深底 + 无边框填充式面板（白 4~6% 底，靠明度差分区）+ 胶囊控件，
 * 强调色 Apple system blue #0A84FF，语义色 #30D158 / #FFD60E / #FF453A。
 */

// ---------- 基础材质 ----------
/** 填充式面板/卡片：白 4% 底、无边框（区域靠留白与明度差分隔），16px 圆角。 */
export const applePanel = 'bg-white/[0.04] rounded-2xl';

// ---------- 文本 ----------
/** 小字标签：11px + 中灰，取消 uppercase + tracking-wider 的工业感写法。 */
export const appleLabel = 'block text-[11px] font-medium text-white/45 mb-1.5';

// ---------- 控件 ----------
/** 输入框/下拉：填充式（白 6% 底、无边框），focus 时蓝色光环。 */
export const appleInput =
  'w-full bg-white/[0.06] rounded-xl px-4 py-2.5 text-sm text-white/90 ' +
  'focus:outline-none focus:ring-2 focus:ring-[#0A84FF]/40 transition-all placeholder:text-white/30';
/** 小型动作按钮基础形（导演台/检查器的操作按钮共用，配色在调用处追加）。 */
export const appleActionBtn =
  'px-3 py-1.5 rounded-full text-xs font-medium transition-all flex items-center gap-1 ' +
  'active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed';

// ---------- 语义徽章（/15 底 + 纯色字 + 同色淡描边；字号在调用处控制） ----------
export const appleBadgeSuccess = 'bg-[#30D158]/15 text-[#30D158] border-[#30D158]/30';
export const appleBadgeWarning = 'bg-[#FFD60E]/15 text-[#FFD60E] border-[#FFD60E]/30';
export const appleBadgeNeutral = 'bg-white/[0.06] text-white/55 border-white/[0.08]';
