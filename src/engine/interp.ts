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
  const mode = a.interpolationToNext ?? 'linear';
  if (mode !== 'smoothstep') {
    const k = ease(u, mode);
    return a.value + (b.value - a.value) * k;
  }

  // A per-segment smoothstep comes to a complete stop at every key. That makes
  // a long gesture look like a chain of small robotic nods. Use a bounded cubic
  // Hermite curve instead: it carries velocity through keys that continue in the
  // same direction, but still stops cleanly at holds and direction reversals.
  const keys = track.keys;
  const i = keys.indexOf(a);
  const h = Math.max(1e-9, b.tSec - a.tSec);
  const secant = (p: number, q: number) => {
    const dt = keys[q].tSec - keys[p].tSec;
    return dt > 0 ? (keys[q].value - keys[p].value) / dt : 0;
  };
  const slopeAt = (j: number): number => {
    if (j <= 0 || j >= keys.length - 1) return 0;
    const prevMode = keys[j - 1].interpolationToNext ?? 'linear';
    const nextMode = keys[j].interpolationToNext ?? 'linear';
    if (prevMode !== 'smoothstep' || nextMode !== 'smoothstep') return 0;
    const dl = secant(j - 1, j), dr = secant(j, j + 1);
    if (dl === 0 || dr === 0 || Math.sign(dl) !== Math.sign(dr)) return 0;
    const hl = keys[j].tSec - keys[j - 1].tSec;
    const hr = keys[j + 1].tSec - keys[j].tSec;
    const m = (dl * hr + dr * hl) / Math.max(1e-9, hl + hr);
    return Math.sign(m) * Math.min(Math.abs(m), 3 * Math.min(Math.abs(dl), Math.abs(dr)));
  };
  const m0 = slopeAt(i), m1 = slopeAt(i + 1);
  const u2 = u * u, u3 = u2 * u;
  return (2 * u3 - 3 * u2 + 1) * a.value
    + (u3 - 2 * u2 + u) * h * m0
    + (-2 * u3 + 3 * u2) * b.value
    + (u3 - u2) * h * m1;
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
  return segment(keys, t)![0].value;
}
