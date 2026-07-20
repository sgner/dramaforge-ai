/**
 * 剪辑台时间显示工具：秒数 → mm:ss（普通用户可读，不用帧计数时间码）。
 */

/** 秒数格式化为 mm:ss。 */
export const formatSec = (sec: number): string => {
  const s = Math.max(0, Math.round(sec));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
};
