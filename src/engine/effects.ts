import type { EffectClip, LedBlend, Rgbw } from './types';
import { LED_COUNT, BLACK } from './types';
import { clamp, evalNumeric } from './interp';

/** Integer hash -> [0,1). Deterministic: the ONLY randomness source used by effects. */
export function hash01(a: number, b: number, c: number): number {
  let h = (Math.imul(a | 0, 0x9e3779b1) ^ Math.imul(b | 0, 0x85ebca6b) ^ Math.imul(c | 0, 0xc2b2ae35)) >>> 0;
  h ^= h >>> 16; h = Math.imul(h, 0x7feb352d) >>> 0;
  h ^= h >>> 15; h = Math.imul(h, 0x846ca68b) >>> 0;
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

export type Contribution = { rgbw: Rgbw; cover: number };
const NONE: Contribution = { rgbw: BLACK, cover: 0 };
type Params = Record<string, number | string | boolean | number[]>;

const num = (p: Params, k: string, d: number): number => (typeof p[k] === 'number' ? (p[k] as number) : d);
function color(p: Params, k: string): Rgbw | null {
  const v = p[k];
  if (Array.isArray(v) && v.length >= 3) return [v[0], v[1], v[2], v[3] ?? 0];
  return null;
}
/** Peak color: explicit `color` [r,g,b,w] or a warm-white default built from whiteLevel/warmth. */
function peak(p: Params): Rgbw {
  const c = color(p, 'color');
  if (c) return c;
  const w = num(p, 'whiteLevel', 60), warm = num(p, 'warmth', 0);
  return [warm * w, warm * w * 0.5, 0, w];
}
const scale = (c: Rgbw, k: number): Rgbw => [c[0] * k, c[1] * k, c[2] * k, c[3] * k];
const circDist = (a: number, b: number) => { const d = Math.abs(a - b) % LED_COUNT; return Math.min(d, LED_COUNT - d); };

/** Resolve numeric params at time t, overlaying parameterTracks. */
export function resolveParams(clip: EffectClip, t: number): Params {
  const out: Params = { ...clip.params };
  if (clip.parameterTracks) for (const [k, tr] of Object.entries(clip.parameterTracks)) out[k] = evalNumeric(tr, t, num(clip.params, k, 0));
  return out;
}

/** Pure per-pixel effect. rel = seconds since clip start. */
export function effectPixel(clip: EffectClip, p: Params, rel: number, i: number): Contribution {
  const dur = Math.max(1e-6, clip.toSec - clip.fromSec);
  const pk = peak(p);
  switch (clip.type) {
    case 'solid': return { rgbw: pk, cover: 1 };
    case 'breathe': {
      const f = num(p, 'speedHz', 0.5);
      const k = 0.5 - 0.5 * Math.cos(2 * Math.PI * f * rel + num(p, 'phase', 0));
      return { rgbw: scale(pk, k), cover: 1 };
    }
    case 'pulse': {
      const period = Math.max(1e-3, num(p, 'periodSec', 1));
      const k = 0.5 - 0.5 * Math.cos((2 * Math.PI * rel) / period);
      return { rgbw: scale(pk, k), cover: 1 };
    }
    case 'chase': {
      const dir = num(p, 'direction', 1) >= 0 ? 1 : -1;
      const head = (((dir * num(p, 'speedHz', 0.5) * rel * LED_COUNT + num(p, 'phase', 0)) % LED_COUNT) + LED_COUNT) % LED_COUNT;
      const width = Math.max(0.5, num(p, 'width', 4));
      const k = clamp(1 - circDist(i, head) / width, 0, 1);
      return k > 0 ? { rgbw: scale(pk, k), cover: 1 } : NONE;
    }
    case 'wave': {
      const dir = num(p, 'direction', 1) >= 0 ? 1 : -1;
      const wl = Math.max(1, num(p, 'width', 8));
      const k = 0.5 + 0.5 * Math.sin(2 * Math.PI * (i / wl - dir * num(p, 'speedHz', 0.5) * rel) + num(p, 'phase', 0));
      return { rgbw: scale(pk, k), cover: 1 };
    }
    case 'sparkle': {
      const rate = Math.max(0.1, num(p, 'rateHz', 6)), density = clamp(num(p, 'density', 0.25), 0, 1);
      const slot = Math.floor(rel * rate), frac = rel * rate - slot;
      if (hash01(clip.seed, i, slot) > density) return NONE;
      const k = 1 - frac; // decay inside the slot
      return { rgbw: scale(pk, k), cover: 1 };
    }
    case 'gradient': {
      const a = color(p, 'colorA') ?? [0, 0, 0, 0], b = color(p, 'colorB') ?? pk;
      const u = i / (LED_COUNT - 1);
      return { rgbw: [0, 1, 2, 3].map((c) => a[c] + (b[c] - a[c]) * u) as unknown as Rgbw, cover: 1 };
    }
    case 'progress': {
      const frac = clamp(typeof p.fraction === 'number' ? (p.fraction as number) : rel / dur, 0, 1);
      const lit = frac * LED_COUNT;
      const k = clamp(lit - i, 0, 1);
      return k > 0 ? { rgbw: scale(pk, k), cover: 1 } : NONE;
    }
    default: return NONE;
  }
}

export function blendInto(dst: number[], c: Contribution, mode: LedBlend) {
  for (let ch = 0; ch < 4; ch++) {
    const v = c.rgbw[ch];
    if (mode === 'replace') dst[ch] = dst[ch] + (v - dst[ch]) * c.cover;
    else if (mode === 'add') dst[ch] = dst[ch] + v * c.cover;
    else dst[ch] = Math.max(dst[ch], v * c.cover);
  }
}
