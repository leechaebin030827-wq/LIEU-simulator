import type { Ease } from './types';

export const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
export const clamp01 = (v: number) => clamp(v, 0, 1);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const smoothstep = (x: number) => { const t = clamp01(x); return t * t * (3 - 2 * t); };

let uidCounter = 0;
export const uid = (prefix = 'id') =>
  `${prefix}_${Date.now().toString(36)}${(uidCounter++).toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;

/** Deterministic integer hash -> [0,1). Same inputs always give the same output. */
export function hash01(a: number, b = 0, c = 0): number {
  let h = (Math.imul(a | 0, 0x27d4eb2d) ^ Math.imul(b | 0, 0x165667b1) ^ Math.imul(c | 0, 0x9e3779b1)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h = (h ^ (h >>> 16)) >>> 0;
  return h / 4294967296;
}

// ---------------------------------------------------------------- easing

function cubicBezier(x1: number, y1: number, x2: number, y2: number, x: number): number {
  const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
  const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
  const sx = (t: number) => ((ax * t + bx) * t + cx) * t;
  let lo = 0, hi = 1, t = x;
  for (let i = 0; i < 24; i++) {
    const v = sx(t);
    if (Math.abs(v - x) < 1e-5) break;
    if (v < x) lo = t; else hi = t;
    t = (lo + hi) / 2;
  }
  return ((ay * t + by) * t + cy) * t;
}

/**
 * Evaluate an easing curve. `overshoot` (0..1) adds a decaying bump so a transition
 * passes its target and settles back (used by the Freeform "spring" setting).
 */
export function applyEase(e: Ease | undefined, xRaw: number, overshoot = 0): number {
  const x = clamp01(xRaw);
  let y: number;
  switch (e?.type ?? 'easeInOut') {
    case 'linear': y = x; break;
    case 'easeIn': y = x * x * x; break;
    case 'easeOut': y = 1 - Math.pow(1 - x, 3); break;
    case 'step': return x >= 1 ? 1 : 0;
    case 'spring':
      // ease-out plus a settling bump; `overshoot` strengthens it
      return 1 - Math.pow(1 - x, 3) + (0.3 + overshoot * 0.6) * Math.sin(Math.PI * x) * x * x;
    case 'bezier': {
      const b = e?.bezier ?? [0.42, 0, 0.58, 1];
      y = cubicBezier(b[0], b[1], b[2], b[3], x);
      break;
    }
    default: y = x * x * (3 - 2 * x); // easeInOut (smoothstep)
  }
  if (overshoot > 0) y += overshoot * 0.45 * Math.sin(Math.PI * x) * x * x;
  return y;
}

export const easeFromType = (type: Ease['type']): Ease => ({ type });

/** Piecewise interpolation over [t, value] keys with easing between segments. */
export function sampleKeys(keys: [number, number][], p: number, ease: Ease, overshoot = 0): number {
  if (keys.length === 0) return 0;
  if (p <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i++) {
    if (p <= keys[i][0]) {
      const [t0, v0] = keys[i - 1];
      const [t1, v1] = keys[i];
      const span = t1 - t0;
      const x = span <= 0 ? 1 : (p - t0) / span;
      return lerp(v0, v1, applyEase(ease, x, overshoot));
    }
  }
  return keys[keys.length - 1][1];
}

export function deepClone<T>(v: T): T {
  return typeof structuredClone === 'function' ? structuredClone(v) : JSON.parse(JSON.stringify(v));
}

export const fmt = (v: number, digits = 2) => (Number.isFinite(v) ? v.toFixed(digits) : '0');

export function downloadText(filename: string, text: string, mime = 'application/json') {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
