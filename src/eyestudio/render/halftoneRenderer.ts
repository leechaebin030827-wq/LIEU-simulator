import type { FreeformGeometry } from '../engine/types';
import { drawFreeform, freeformViewTransform, type EyeGeometryResult, type FreeformView } from './freeformRenderer';

/**
 * Halftone ("vent-hole") eyes: the freeform eye shape (moods, lids, blinks, gaze, emoji…) is rendered to a hidden
 * coverage mask, then re-drawn as a lattice of large dots plus small dots in the gaps between them. Dot size follows
 * local coverage, so dots are big in the middle of the eye and shrink toward its edge.
 */
let mask: HTMLCanvasElement | null = null;

export function drawHalftone(
  ctx: CanvasRenderingContext2D, W: number, H: number, eyes: EyeGeometryResult[], g: FreeformGeometry, v: FreeformView,
  symbol?: { id: string; w: number; t: number; closure: [number, number] }, compact = false,
  style: 'smooth' | 'grid' = 'smooth',
) {
  const mw = Math.max(8, Math.round(W / 2)), mh = Math.max(8, Math.round(H / 2));
  if (!mask) mask = document.createElement('canvas');
  if (mask.width !== mw || mask.height !== mh) { mask.width = mw; mask.height = mh; }
  const mctx = mask.getContext('2d', { willReadFrequently: true })!;
  mctx.setTransform(1, 0, 0, 1, 0, 0);
  drawFreeform(mctx, mw, mh, eyes, { ...g, eyeColor: '#ffffff', glow: 0 }, { ...v, bg: '#000000', grid: false, showOutline: false, showPoints: false }, null, symbol);
  const data = mctx.getImageData(0, 0, mw, mh).data;
  const cov = (x: number, y: number) => {
    const ix = Math.min(mw - 1, Math.max(0, Math.round((x * mw) / W))), iy = Math.min(mh - 1, Math.max(0, Math.round((y * mh) / H)));
    return data[(iy * mw + ix) * 4] / 255;
  };

  ctx.fillStyle = v.bg;
  ctx.fillRect(0, 0, W, H);
  const { s } = freeformViewTransform(W, H, v);
  ctx.fillStyle = g.eyeColor;

  if (style === 'grid') {
    // matrix-like: coarser lattice, hard on/off with only three dot sizes, stair-stepped edges
    const p = (compact ? 30 : 18) * s;
    for (const layer of [0, 1]) {
      const off = layer ? p / 2 : 0;
      ctx.beginPath();
      for (let y = off; y < H + p; y += p) {
        for (let x = off; x < W + p; x += p) {
          const c = cov(x, y);
          let r = 0;
          if (layer === 0) r = c > 0.9 ? p * 0.43 : c > 0.5 ? p * 0.25 : 0;
          else r = c > 0.95 ? p * 0.12 : 0;
          if (r <= 0) continue;
          ctx.moveTo(x + r, y);
          ctx.arc(x, y, r, 0, Math.PI * 2);
        }
      }
      ctx.fill();
    }
    return;
  }

  // freeform-like: finer lattice, dot radius follows smooth local coverage (big in the middle, tiny at the edge)
  const p = (compact ? 22 : 11) * s;
  const ring = p * 0.5;
  const sample = (x: number, y: number) => {
    let a = cov(x, y) * 2;
    for (let k = 0; k < 6; k++) { const t = (k * Math.PI) / 3; a += cov(x + Math.cos(t) * ring, y + Math.sin(t) * ring); }
    return a / 8;
  };
  for (const layer of [0, 1]) {
    // layer 0: big dots on a square lattice; layer 1: small dots at the centres of the lattice cells
    const off = layer ? p / 2 : 0;
    const rMax = layer ? p * 0.21 : p * 0.4;
    ctx.beginPath();
    for (let y = off; y < H + p; y += p) {
      for (let x = off; x < W + p; x += p) {
        const c = sample(x, y);
        if (c < 0.1) continue;
        const r = rMax * Math.pow(Math.min(1, c), layer ? 1.1 : 1.6);
        if (r < 0.3) continue;
        ctx.moveTo(x + r, y);
        ctx.arc(x, y, r, 0, Math.PI * 2);
      }
    }
    ctx.fill();
  }
}
