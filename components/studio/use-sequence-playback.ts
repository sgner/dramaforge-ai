/**
 * useSequencePlayback — 剪辑台序列预览播放 hook。
 *
 * 以 100ms interval 推进播放头（对齐 0.1s 网格避免浮点漂移）；
 * playTime 到达总时长时停在末尾并自动暂停。返回当前 clip 下标与起点，
 * 供节目监视器同步 <video>、时间线移动 playhead。
 */
import { useCallback, useEffect, useMemo, useState } from 'react';

const TICK_SEC = 0.1;
const TICK_MS = 100;

export interface SequencePlayback {
  /** 当前播放头位置（秒，0..total）。 */
  playTime: number;
  playing: boolean;
  /** 当前 clip 下标（空序列为 -1）。 */
  currentIndex: number;
  /** 当前 clip 在序列中的起点（秒）。 */
  clipStart: number;
  /** 序列总时长（秒）。 */
  total: number;
  play: () => void;
  pause: () => void;
  toggle: () => void;
  /** 跳转播放头（clamp 到 0..total）。 */
  seek: (sec: number) => void;
  /** 跳到上一/下一 clip 起点。 */
  stepClip: (dir: -1 | 1) => void;
}

export function useSequencePlayback(items: { sec: number }[]): SequencePlayback {
  const [playTime, setPlayTime] = useState(0);
  const [playing, setPlaying] = useState(false);

  const total = useMemo(() => items.reduce((sum, it) => sum + (it.sec || 0), 0), [items]);
  // 每个 clip 的起点秒数
  const starts = useMemo(() => {
    const arr: number[] = [];
    let acc = 0;
    for (const it of items) {
      arr.push(acc);
      acc += it.sec || 0;
    }
    return arr;
  }, [items]);

  // 时间线变化后收敛播放头；清空序列时停止播放
  useEffect(() => {
    setPlayTime((p) => Math.min(p, total));
    if (total === 0) setPlaying(false);
  }, [total]);

  // 播放推进
  useEffect(() => {
    if (!playing) return;
    const id = setInterval(() => {
      setPlayTime((prev) => Math.min(Math.round((prev + TICK_SEC) * 10) / 10, total));
    }, TICK_MS);
    return () => clearInterval(id);
  }, [playing, total]);

  // 播到末尾：停在 total 并暂停
  useEffect(() => {
    if (playing && playTime >= total) setPlaying(false);
  }, [playing, playTime, total]);

  const currentIndex = useMemo(() => {
    if (items.length === 0) return -1;
    for (let i = starts.length - 1; i >= 0; i--) {
      if (playTime >= starts[i]) return i;
    }
    return 0;
  }, [items.length, starts, playTime]);

  const play = useCallback(() => {
    // 已停在末尾时从头再播
    setPlayTime((p) => (p >= total ? 0 : p));
    setPlaying(true);
  }, [total]);

  const pause = useCallback(() => setPlaying(false), []);

  const toggle = useCallback(() => {
    if (playing) pause();
    else play();
  }, [playing, play, pause]);

  const seek = useCallback(
    (sec: number) => {
      setPlayTime(Math.min(Math.max(0, sec), total));
    },
    [total]
  );

  const stepClip = useCallback(
    (dir: -1 | 1) => {
      if (items.length === 0) return;
      const idx = Math.min(Math.max(0, currentIndex + dir), items.length - 1);
      setPlayTime(starts[idx] ?? 0);
    },
    [currentIndex, items.length, starts]
  );

  const clipStart = currentIndex >= 0 ? starts[currentIndex] : 0;

  return { playTime, playing, currentIndex, clipStart, total, play, pause, toggle, seek, stepClip };
}
