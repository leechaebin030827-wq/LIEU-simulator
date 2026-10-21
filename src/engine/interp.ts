import type { Interpolation, Keyframe, NumericTrack, Rgbw, RingFrame } from './types';

export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
export const smoothstep01 = (u: number) => u * u * (3 - 2 * u);

function ease(u: number, mode: Interpolation | undefined): number {
  if (mode === 'hold') return 0;
  if (mode === 'smoothstep') return smoothstep01(u);
  return u;
}

/** Locate the segment [a,b] around t in a time-sorted key list. Pure, O(log n). */
export function segment<T>(keys: readonly Keyframe<T>[], t: number): [Keyframe<T>, Keyframe<T>, number] | null {
  const n = keys.length;
  if (n === 0) return null;
  if (t <= keys[0].tSec) return [keys[0], keys[0], 0];
  if (t >= keys[n - 1].tSec) return [keys[n - 1], keys[n - 1], 0];
  let lo = 0, hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (keys[mid].tSec <= t) lo = mid; else hi = mid;
  }
  const a = keys[lo], b = keys[hi];
  const span = b.tSec - a.tSec;
  return [a, b, span > 0 ? (t - a.tSec) / span : 0];
}

export function sortedKeys<T>(keys: readonly Keyframe<T>[]): Keyframe<T>[] {
  return [...keys].sort((x, y) => x.tSec - y.tSec);
}

export function evalNumeric(track: NumericTrack | undefined, t: number, fallback: number): number {
  if (!track || track.keys.length === 0) return fallback;
  const seg = segment(track.keys, t);
  if (!seg) return fallback;
  const [a, b, u] = seg;
  if (a === b) return a.value;
  const k = ease(u, a.interpolationToNext ?? 'linear');
  return a.value + (b.value - a.value) * k;
}

export function evalRingFrame(keys: readonly Keyframe<RingFrame>[], t: number): RingFrame | null {
  const seg = segment(keys, t);
  if (!seg) return null;
  const [a, b, u] = seg;
  if (a === b) return a.value;
  const k = ease(u, a.interpolationToNext ?? 'linear');
  if (k === 0) return a.value;
  return a.value.map((p, i) => {
    const q = b.value[i];
    return [p[0] + (q[0] - p[0]) * k, p[1] + (q[1] - p[1]) * k, p[2] + (q[2] - p[2]) * k, p[3] + (q[3] - p[3]) * k] as Rgbw;
  });
}

/** Eyes are always step-held. */
export function evalHold<T>(keys: readonly Keyframe<T>[], t: number): T | null {
  if (keys.length === 0) return null;
  let found: Keyframe<T> | null = null;
  for (const k of keys) { if (k.tSec <= t) found = k; else break; }
  return (found ?? keys[0]).value;
}
