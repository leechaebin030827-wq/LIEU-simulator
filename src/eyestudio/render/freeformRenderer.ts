import type { EyeFrame, FreeformGeometry, Side } from '../engine/types';
import { CONTROL_POINTS } from '../engine/params';
import { clamp, clamp01 } from '../engine/util';
import { SYMBOLS } from './symbols';

/**
 * FreeformRenderer — continuous vector eyes (no pixel grid, no 8×8 dependency).
 * Each eye is a closed Catmull-Rom/Bézier curve through CONTROL_POINTS draggable anchors that start on a
 * super-ellipse (corner radius → exponent). Lids, curvature, tilt, squash/stretch are applied as real
 * geometry operations on a densely sampled outline, so shapes truly deform (not just resize).
 */

let ROUND_ITERS = 220;
/** lower for small thumbnails (cheaper corner rounding) */
export const setRoundQuality = (n: number) => { ROUND_ITERS = n; };
export const WORLD_W = 1000;
export const WORLD_H = 520;
const DENSE_PER_SEG = 16;

export interface EyeTransform { cx: number; cy: number; rot: number; halfW: number; halfH: number; curv: number }
export interface EyeGeometryResult {
  side: Side;
  outline: [number, number][]; // world coords, closed polygon
  anchors: [number, number][]; // control points (pre-lid) in world coords
  baseUnit: [number, number][]; // un-offset unit anchors
  tf: EyeTransform;
  closed: boolean;
}

function superEllipseAnchors(cornerRadius: number): [number, number][] {
  const n = 2 + (1 - clamp01(cornerRadius)) * 6.5; // 2 = ellipse … 8.5 = near rectangle
  const pts: [number, number][] = [];
  for (let k = 0; k < CONTROL_POINTS; k++) {
    // start at the top and go clockwise so index 0 is the top-centre anchor
    const th = (k / CONTROL_POINTS) * Math.PI * 2;
    const s = Math.sin(th), c = Math.cos(th);
    pts.push([Math.sign(s) * Math.pow(Math.abs(s), 2 / n), -Math.sign(c) * Math.pow(Math.abs(c), 2 / n)]);
  }
  return pts;
}

/** 12 anchors on a stadium whose caps are semicircles: unit space is [-1,1]^2 scaled to w x h, so the cap's y-radius is w/h. */
function pillAnchors(wh: number): [number, number][] {
  const cr = clamp(wh, 0.05, 1), st = 1 - cr, d = Math.SQRT1_2;
  return [[0, -1], [d, -st - cr * d], [1, -st], [1, 0], [1, st], [d, st + cr * d], [0, 1], [-d, st + cr * d], [-1, st], [-1, 0], [-1, -st], [-d, -st - cr * d]];
}

function catmullDense(pts: [number, number][]): [number, number][] {
  const n = pts.length;
  const out: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n], p1 = pts[i], p2 = pts[(i + 1) % n], p3 = pts[(i + 2) % n];
    for (let s = 0; s < DENSE_PER_SEG; s++) {
      const t = s / DENSE_PER_SEG, t2 = t * t, t3 = t2 * t;
      out.push([
        0.5 * (2 * p1[0] + (-p0[0] + p2[0]) * t + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3),
        0.5 * (2 * p1[1] + (-p0[1] + p2[1]) * t + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3),
      ]);
    }
  }
  return out;
}

function smooth(pts: [number, number][], passes: number): [number, number][] {
  let cur = pts;
  for (let p = 0; p < passes; p++) {
    const n = cur.length;
    cur = cur.map((pt, i) => {
      const a = cur[(i - 1 + n) % n], b = cur[(i + 1) % n];
      return [a[0] * 0.25 + pt[0] * 0.5 + b[0] * 0.25, a[1] * 0.25 + pt[1] * 0.5 + b[1] * 0.25] as [number, number];
    });
  }
  return cur;
}

/** Curvature-adaptive smoothing: sharp vertices (lid/outline intersections) are rounded strongly, flat parts barely move. */
function roundCorners(pts: [number, number][], iters: number): [number, number][] {
  let cur = pts.map((p) => [p[0], p[1]] as [number, number]);
  const n = cur.length;
  for (let it = 0; it < iters; it++) {
    const next = cur.map((p, i) => {
      const a = cur[(i - 1 + n) % n], b = cur[(i + 1) % n];
      const v1x = p[0] - a[0], v1y = p[1] - a[1], v2x = b[0] - p[0], v2y = b[1] - p[1];
      const l1 = Math.hypot(v1x, v1y), l2 = Math.hypot(v2x, v2y);
      if (l1 < 1e-6 || l2 < 1e-6) return p;
      const turn = Math.acos(clamp((v1x * v2x + v1y * v2y) / (l1 * l2), -1, 1));
      const alpha = Math.min(0.5, (turn / 0.12) * 0.5);
      return [p[0] + alpha * ((a[0] + b[0]) / 2 - p[0]), p[1] + alpha * ((a[1] + b[1]) / 2 - p[1])] as [number, number];
    });
    cur = next;
  }
  return cur;
}

function toWorld(u: [number, number], tf: EyeTransform): [number, number] {
  const lx = u[0] * tf.halfW;
  const ly = u[1] * tf.halfH - tf.curv * (1 - u[0] * u[0]) * tf.halfH * 0.3;
  const cos = Math.cos(tf.rot), sin = Math.sin(tf.rot);
  return [tf.cx + lx * cos - ly * sin, tf.cy + lx * sin + ly * cos];
}

/** World → unit-space anchor coordinates (inverse of toWorld, incl. curvature). */
export function worldToUnit(p: [number, number], tf: EyeTransform): [number, number] {
  const cos = Math.cos(-tf.rot), sin = Math.sin(-tf.rot);
  const dx = p[0] - tf.cx, dy = p[1] - tf.cy;
  const lx = dx * cos - dy * sin, ly = dx * sin + dy * cos;
  const ux = lx / tf.halfW;
  const uy = (ly + tf.curv * (1 - ux * ux) * tf.halfH * 0.3) / tf.halfH;
  return [ux, uy];
}

export function buildEye(side: Side, f: EyeFrame, g: FreeformGeometry): EyeGeometryResult {
  const isL = side === 'L';
  const sgn = isL ? -1 : 1; // outward direction
  const scale = g.scale;
  const asym = g.asymmetry;
  let w = (isL ? g.widthL : g.widthR) * scale * f.shape.sx * (1 + (isL ? -asym : asym) * 0.25);
  let h = (isL ? g.heightL : g.heightR) * scale * f.shape.sy * (1 + (isL ? -asym : asym) * 0.25);

  const sq = g.squash, st = g.stretch;
  w *= 1 + 0.4 * sq - 0.3 * st;
  h *= 1 - 0.4 * sq + 0.4 * st;
  // gaze deformation: the eye elongates toward where it looks; curiosity enlarges the outer eye
  w *= 1 + 0.08 * Math.abs(f.gazeX);
  h *= 1 + 0.05 * Math.abs(f.gazeY);
  const outer = Math.sign(f.gazeX) === sgn;
  if (f.curiosity > 0) h *= 1 + f.curiosity * 0.22 * Math.abs(f.gazeX) * (outer ? 1 : -0.35);
  const openF = f.openness;
  if (openF > 1) h *= 1 + (openF - 1) * 0.6;

  const radius = clamp01(g.cornerRadius + f.shape.round * 0.5);
  const unit0 = g.pill ? pillAnchors(w / h) : superEllipseAnchors(radius);
  const off = f.morph ? (isL ? f.morph.L : f.morph.R) : isL ? g.offsetsL : g.offsetsR;
  const k = g.morphIntensity;
  const unit = unit0.map((p, i) => [p[0] + (off[i * 2] ?? 0) * k, p[1] + (off[i * 2 + 1] ?? 0) * k] as [number, number]);

  const spacing = g.spacing * scale;
  const cx = WORLD_W / 2 + g.posX + sgn * (spacing / 2 + w / 2) + f.gazeX * g.gazeRange + f.flickerX * 7;
  const cy = WORLD_H / 2 + g.posY + f.gazeY * g.gazeRange * 0.55 + f.flickerY * 7;
  const rot = ((g.rotation + sgn * (g.tilt * 22 + f.shape.tilt * 18)) * Math.PI) / 180;
  const tf: EyeTransform = { cx, cy, rot, halfW: w / 2, halfH: h / 2, curv: g.curvature };

  const dense = catmullDense(unit);
  const closure = isL ? f.closureL : f.closureR;
  const o = clamp01(f.openness);
  const closeAmt = 1 - o * (1 - closure);
  const lt = clamp(g.upperLid + f.mood.lt, 0, 0.95);
  const lb = clamp(g.lowerLid + f.mood.lb, 0, 0.95);
  const slant = f.mood.sl;
  const arch = f.mood.ar;

  // lids operate in eye-local (pre-rotation) unit-space, relative to the shape's current extent so that
  // dragged control points keep working; then everything is mapped to world.
  let xMin = Infinity, xMax = -Infinity, yMin = Infinity, yMax = -Infinity;
  for (const [ux, uy] of dense) { xMin = Math.min(xMin, ux); xMax = Math.max(xMax, ux); yMin = Math.min(yMin, uy); yMax = Math.max(yMax, uy); }
  const H2 = Math.max(0.01, (yMax - yMin) / 2), W = Math.max(0.01, xMax - xMin), xMid = (xMin + xMax) / 2;
  const topAt = (ux: number) => {
    const u = (ux - xMin) / W; // 0 = left edge … 1 = right edge
    const inner = isL ? u : 1 - u;
    const slantOff = slant >= 0 ? slant * inner * 0.9 : -slant * (1 - inner) * 0.9;
    return yMin + (2 * lt + closeAmt + slantOff) * H2;
  };
  const botAt = (ux: number) => {
    const c = (2 * (ux - xMid)) / W;
    return yMax - (2 * lb + closeAmt + arch * 0.6 * (1 - c * c)) * H2;
  };
  let collapsed = true;
  const clipped = dense.map(([ux, uy]) => {
    const t = topAt(ux), b = botAt(ux);
    if (t >= b) return [ux, (t + b) / 2] as [number, number];
    collapsed = false;
    return [ux, clamp(uy, t, b)] as [number, number];
  });
  let poly = roundCorners(smooth(clipped, 3), ROUND_ITERS);
  if (collapsed || closeAmt > 0.985) {
    // fully closed → thin rounded line
    const minU = Math.min(...dense.map((p) => p[0])), maxU = Math.max(...dense.map((p) => p[0]));
    const thick = Math.max(2.5 / Math.max(1, tf.halfH), 0.02);
    poly = [];
    const N = 24;
    for (let i = 0; i <= N; i++) { const x = minU + ((maxU - minU) * i) / N; poly.push([x, -thick * Math.sin((Math.PI * i) / N) - 0.0]); }
    for (let i = N; i >= 0; i--) { const x = minU + ((maxU - minU) * i) / N; poly.push([x, thick * Math.sin((Math.PI * i) / N)]); }
  }
  return {
    side,
    outline: poly.map((p) => toWorld(p, tf)),
    anchors: unit.map((p) => toWorld(p, tf)),
    baseUnit: unit0,
    tf,
    closed: collapsed || closeAmt > 0.985,
  };
}

export interface FreeformView {
  zoom: number; panX: number; panY: number; bg: string; grid: boolean;
  showOutline: boolean; showPoints: boolean;
}

export function freeformViewTransform(W: number, H: number, v: FreeformView) {
  const fit = Math.min(W / WORLD_W, H / WORLD_H) * 0.92;
  const s = fit * v.zoom;
  return { s, ox: W / 2 + v.panX - (WORLD_W / 2) * s, oy: H / 2 + v.panY - (WORLD_H / 2) * s };
}

export function drawFreeform(
  ctx: CanvasRenderingContext2D, W: number, H: number, eyes: EyeGeometryResult[], g: FreeformGeometry, v: FreeformView,
  selectedPoint?: { side: Side; index: number } | null,
  symbol?: { id: string; w: number; t: number; closure: [number, number] },
) {
  ctx.fillStyle = v.bg;
  ctx.fillRect(0, 0, W, H);
  const { s, ox, oy } = freeformViewTransform(W, H, v);
  ctx.save();
  ctx.translate(ox, oy);
  ctx.scale(s, s);

  if (v.grid) {
    ctx.lineWidth = 1 / s;
    for (let x = 0; x <= WORLD_W; x += 50) { ctx.strokeStyle = x % 250 === 0 ? 'rgba(255,255,255,0.09)' : 'rgba(255,255,255,0.035)'; ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, WORLD_H); ctx.stroke(); }
    for (let y = 0; y <= WORLD_H; y += 50) { ctx.strokeStyle = y % 250 === 0 ? 'rgba(255,255,255,0.09)' : 'rgba(255,255,255,0.035)'; ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(WORLD_W, y); ctx.stroke(); }
    ctx.strokeStyle = 'rgba(215,240,128,0.18)';
    ctx.beginPath(); ctx.moveTo(WORLD_W / 2, 0); ctx.lineTo(WORLD_W / 2, WORLD_H); ctx.moveTo(0, WORLD_H / 2); ctx.lineTo(WORLD_W, WORLD_H / 2); ctx.stroke();
  }

  const symDef = symbol ? SYMBOLS[symbol.id] : undefined;
  const sw = symDef && symbol ? clamp01(symbol.w) : 0;
  ctx.globalAlpha = 1 - sw;
  for (const eye of eyes) {
    ctx.beginPath();
    eye.outline.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
    ctx.closePath();
    ctx.shadowColor = g.eyeColor;
    ctx.shadowBlur = g.glow * 60 * s;
    ctx.fillStyle = g.eyeColor;
    ctx.fill();
    ctx.shadowBlur = 0;
  }
  ctx.globalAlpha = 1;
  if (symDef && symbol && sw > 0) {
    for (const eye of eyes) {
      const tf = eye.tf;
      const cl = eye.side === 'L' ? symbol.closure[0] : symbol.closure[1];
      const pulse = symDef.pulse ? 1 + 0.07 * Math.sin((symbol.t / 1000) * 9) : 1;
      const sc = Math.min(tf.halfW, tf.halfH) * 1.08 * pulse;
      ctx.save();
      ctx.globalAlpha = sw;
      ctx.translate(tf.cx, tf.cy); ctx.rotate(tf.rot);
      ctx.scale(sc, sc * Math.max(0.05, 1 - cl));
      ctx.fillStyle = g.eyeColor; ctx.strokeStyle = g.eyeColor;
      ctx.shadowColor = g.eyeColor; ctx.shadowBlur = g.glow * 60 * s;
      symDef.draw(ctx, eye.side);
      ctx.restore();
    }
  }
  if (v.showOutline) {
    ctx.lineWidth = 1.5 / s;
    ctx.strokeStyle = 'rgba(255,255,255,0.7)';
    for (const eye of eyes) {
      ctx.beginPath();
      eye.outline.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
      ctx.closePath(); ctx.stroke();
    }
  }
  if (v.showPoints) {
    for (const eye of eyes) {
      ctx.strokeStyle = 'rgba(88,166,255,0.55)'; ctx.lineWidth = 1 / s; ctx.setLineDash([4 / s, 4 / s]);
      ctx.beginPath(); eye.anchors.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y))); ctx.closePath(); ctx.stroke(); ctx.setLineDash([]);
      eye.anchors.forEach(([x, y], i) => {
        const sel = selectedPoint && selectedPoint.side === eye.side && selectedPoint.index === i;
        ctx.fillStyle = sel ? '#D7F080' : '#58a6ff';
        ctx.strokeStyle = '#111318'; ctx.lineWidth = 1.5 / s;
        ctx.beginPath(); ctx.arc(x, y, (sel ? 7 : 5) / s, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      });
    }
  }
  ctx.restore();
}

/** Uniform fit of an outline's bounding box into the centre of an 8×8 cell grid. */
export function outlineFit(poly: [number, number][], fit: number) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of poly) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  const bw = Math.max(1, x1 - x0), bh = Math.max(1, y1 - y0);
  const target = 8 * clamp(fit, 0.2, 1);
  return { scale: Math.min(target / bw, target / bh), cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, bw, bh };
}

/** Rasterise a freeform eye outline into an 8×8 boolean grid (used by Convert-to-Matrix). */
export function rasterizeOutline(poly: [number, number][], opts: { threshold: number; fit: number; samples?: number }) {
  const { scale, cx: cxw, cy: cyw } = outlineFit(poly, opts.fit);
  const SS = opts.samples ?? 4;
  const inside = (px: number, py: number) => {
    let c = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [xi, yi] = poly[i], [xj, yj] = poly[j];
      if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) c = !c;
    }
    return c;
  };
  const coverage: number[][] = [];
  const grid: boolean[][] = [];
  for (let r = 0; r < 8; r++) {
    coverage.push([]); grid.push([]);
    for (let c = 0; c < 8; c++) {
      let hit = 0;
      for (let sy = 0; sy < SS; sy++) for (let sx = 0; sx < SS; sx++) {
        const mx = c + (sx + 0.5) / SS, my = r + (sy + 0.5) / SS;
        if (inside(cxw + (mx - 4) / scale, cyw + (my - 4) / scale)) hit++;
      }
      const cov = hit / (SS * SS);
      coverage[r].push(cov);
      grid[r].push(cov >= opts.threshold);
    }
  }
  return { grid, coverage };
}
