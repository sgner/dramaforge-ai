/**
 * 全局轻量 toast 事件总线。
 *
 * 背景：App.tsx 的 addToast/toast 状态没有通过 props 下钻，
 * 组件（hooks、画布组件、services 纯模块）拿不到它，过去只能用原生 alert()。
 * 这里提供一个进程内单例 emitter：任何地方调用 toast.* 发事件，
 * App 顶层订阅后转发给自己的 toast 系统渲染，侵入最小。
 *
 * 注意：无订阅者时（如单测环境直接跑 hooks/services）消息不会静默丢失，
 * 会落到 console.warn，便于排查。
 */

export type ToastType = 'success' | 'error' | 'info' | 'warning';

export type ToastListener = (type: ToastType, message: string) => void;

const listeners = new Set<ToastListener>();

/** 订阅 toast 事件，返回取消订阅函数。 */
export function subscribeToast(listener: ToastListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** 发送一条 toast。无订阅者时降级为 console.warn。 */
export function showToast(type: ToastType, message: string): void {
  if (listeners.size === 0) {
    console.warn(`[toast:${type}] ${message}`);
    return;
  }
  listeners.forEach((listener) => listener(type, message));
}

export const toast = {
  success: (message: string) => showToast('success', message),
  error: (message: string) => showToast('error', message),
  info: (message: string) => showToast('info', message),
  warning: (message: string) => showToast('warning', message),
};
