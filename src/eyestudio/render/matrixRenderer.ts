import type { EyeFrame, MatrixFrame, MatrixGeometry, MatrixPhysical, Pattern, Side } from '../engine/types';
import { clamp, clamp01 } from '../engine/util';
import { emptyGrid, patternToGrid } from '../engine/patterns';
import { SYMBOLS } from './symbols';

/**
 * MatrixRenderer — two independent 8×8 binary LED grids.
 * Everything here is integer pixel logic: no anti-aliasing, no fractional LEDs.
 * The two modules are NEVER merged into a 16×8 canvas; each is its own boolean[8][8].
 */

const sideOffset = (side: Side, geo: MatrixGeometry) => (side === 'L' ? geo.offsetL : geo.offsetR);

function generatedEye(side: Side, f: EyeFrame, geo: MatrixGeometry): boolean[][] {
  const g = emptyGrid();
  let w = clamp(Math.round((side === 'L' ? geo.leftW : geo.rightW) * f.shape.sx), 1, 8);
  let h = Math.round(geo.eyeH * f.shape.sy + (side === 'R' ? geo.asymmetry : 0));
  const outer = (side === 'L' && f.gazeX < -0.35) || (side === 'R' && f.gazeX > 0.35);
  if (f.curiosity > 0.5 && outer) h += 1; // RoboEyes-style curiosity: outer eye grows when looking aside
  if (f.openness > 1.08) h += 1;
  h = clamp(h, 1, 8);

  // user-designed eye: its bounding box defines the base shape, the mask decides which pixels exist
  let mask: boolean[][] | null = null, mr0 = 0, mc0 = 0;
  const custom = side === 'L' ? geo.customL : geo.customR;
  if (custom) {
    const cg = patternToGrid(custom);
    let rmin = 8, rmax = -1, cmin = 8, cmax = -1;
    for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) if (cg[r][c]) { rmin = Math.min(rmin, r); rmax = Math.max(rmax, r); cmin = Math.min(cmin, c); cmax = Math.max(cmax, c); }
    if (rmax >= 0) { mask = cg; mr0 = rmin; mc0 = cmin; w = cmax - cmin + 1; h = rmax - rmin + 1; }
  }

  const closure = side === 'L' ? f.closureL : f.closureR;
  const o = clamp01(f.openness);
  const lt = clamp(geo.upperLid + f.mood.lt, 0, 0.95);
  const lb = clamp(geo.lowerLid + f.mood.lb, 0, 0.95);
  const slant = f.mood.sl + f.shape.tilt * 0.6;
  const arch = f.mood.ar;

  const baseX = Math.floor((8 - w) / 2);
  const rangeX = Math.max(1, Math.floor((8 - w) / 2));
  const x0 = clamp(baseX + geo.posX + sideOffset(side, geo) + Math.round(f.gazeX * rangeX) + Math.round(f.flickerX), 0, 8 - w);
  const baseY = Math.floor((8 - h) / 2);
  const rangeY = Math.max(1, Math.floor((8 - h) / 2));
  const y0 = clamp(baseY + geo.posY + Math.round(f.gazeY * rangeY) + Math.round(f.flickerY), 0, 8 - h);

  const top = y0 + h * lt;
  const bottom = y0 + h * (1 - lb);
  const mid = (top + bottom) / 2;
  const half = ((bottom - top) / 2) * o * (1 - closure);
  let rows = Math.round(2 * half);
  if (rows < 1) {
    if (closure > 0.5 || o < 0.2) rows = 0; else rows = 1;
  }
  if (rows === 0) {
    // closed eye = a single LED row, as on real hardware
    const r = clamp(Math.round(mid - 0.5), 0, 7);
    for (let c = 0; c < w; c++) g[r][x0 + c] = true;
    return g;
  }
  const rowTop = clamp(Math.round(mid - rows / 2), 0, 8 - rows);
  const rowBottom = rowTop + rows - 1;
  const level = !mask && rows >= 3 && w >= 3 ? clamp(Math.round(geo.corner + f.shape.round * 2), 0, 2) : 0;

  for (let cx = 0; cx < w; cx++) {
    const inner = w === 1 ? 0.5 : side === 'L' ? cx / (w - 1) : 1 - cx / (w - 1);
    let cutTop = slant >= 0 ? Math.round(slant * inner * rows * 0.55) : Math.round(-slant * (1 - inner) * rows * 0.55);
    const centre = (cx - (w - 1) / 2) / (w / 2);
    let cutBot = Math.round(arch * rows * 0.45 * (1 - centre * centre));
    const room = Math.max(0, rows - 1);
    if (cutTop + cutBot > room) { const k = room / (cutTop + cutBot); cutTop = Math.floor(cutTop * k); cutBot = Math.floor(cutBot * k); }
    for (let r = rowTop + cutTop; r <= rowBottom - cutBot; r++) {
      if (level > 0) {
        const dx = Math.min(cx, w - 1 - cx);
        const dy = Math.min(r - rowTop, rowBottom - r);
        if (dx + dy < level && !(level === 2 && (w < 4 || rows < 4) && dx + dy >= 1)) continue;
      }
      if (mask && !mask[r - y0 + mr0]?.[cx + mc0]) continue;
      g[r][x0 + cx] = true;
    }
  }
  return g;
}

function patternEye(src: Pattern, side: Side, f: EyeFrame, geo: MatrixGeometry): boolean[][] {
  const g = patternToGrid(src);
  let rmin = 8, rmax = -1, cmin = 8, cmax = -1;
  for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) if (g[r][c]) { rmin = Math.min(rmin, r); rmax = Math.max(rmax, r); cmin = Math.min(cmin, c); cmax = Math.max(cmax, c); }
  const out = emptyGrid();
  if (rmax < 0) return out;

  const closure = side === 'L' ? f.closureL : f.closureR;
  const vis = clamp01(f.openness) * (1 - closure);
  const bh = rmax - rmin + 1;
  let rows = Math.round(bh * vis);
  const centre = (rmin + rmax) / 2;
  let keepLo = -1, keepHi = -2, line = false;
  if (rows < 1) { if (closure > 0.5 || f.openness < 0.2) line = true; else rows = 1; }
  if (!line) { keepLo = Math.round(centre - (rows - 1) / 2); keepHi = keepLo + rows - 1; }

  const dx = Math.round(f.gazeX * 2) + geo.posX + sideOffset(side, geo) + Math.round(f.flickerX);
  const dy = Math.round(f.gazeY * 1.5) + geo.posY + Math.round(f.flickerY);
  if (line) {
    const r = Math.round(centre) + dy;
    for (let c = cmin; c <= cmax; c++) if (r >= 0 && r < 8 && c + dx >= 0 && c + dx < 8) out[r][c + dx] = true;
    return out;
  }
  for (let r = keepLo; r <= keepHi; r++) {
    if (r < 0 || r > 7) continue;
    for (let c = 0; c < 8; c++) {
      const nr = r + dy, nc = c + dx;
      if (g[r][c] && nr >= 0 && nr < 8 && nc >= 0 && nc < 8) out[nr][nc] = true;
    }
  }
  return out;
}

export function generateMatrixFrame(f: EyeFrame, geo: MatrixGeometry): MatrixFrame {
  let left: boolean[][], right: boolean[][];
  let source: MatrixFrame['source'] = 'eye';
  const sym = f.symbol && f.symbol.w >= 0.5 ? SYMBOLS[f.symbol.id] : undefined;
  if (sym) {
    // emoji eye: whole-pixel patterns, no gaze shift (they already fill the module); blinks still mask rows
    const nf = { ...f, gazeX: 0, gazeY: 0, flickerX: 0, flickerY: 0 };
    const l = patternEye(sym.matrix(f.t, 'L'), 'L', nf, { ...geo, posX: 0, posY: 0, offsetL: 0, offsetR: 0 });
    const r = patternEye(sym.matrix(f.t, 'R'), 'R', nf, { ...geo, posX: 0, posY: 0, offsetL: 0, offsetR: 0 });
    const count = (g: boolean[][]) => g.reduce((a, row) => a + row.filter(Boolean).length, 0);
    return { timestamp: f.t, left: l, right: r, brightness: geo.brightness, ledCount: count(l) + count(r), source: 'pattern' };
  }
  const pat = f.pattern ?? (geo.usePattern ? { left: geo.editorLeft, right: geo.editorRight } : undefined);
  if (pat) {
    left = patternEye(pat.left, 'L', f, geo);
    right = patternEye(pat.right, 'R', f, geo);
    source = 'pattern';
  } else {
    left = generatedEye('L', f, geo);
    right = generatedEye('R', f, geo);
  }
  const count = (g: boolean[][]) => g.reduce((a, row) => a + row.filter(Boolean).length, 0);
  return { timestamp: f.t, left, right, brightness: geo.brightness, ledCount: count(left) + count(right), source };
}

// ----------------------------------------------------------------- draw

export interface MatrixView { zoom: number; panX: number; panY: number; bg: string; grid: boolean; compact?: boolean }

export interface MatrixLayout {
  scale: number; // css px per mm
  modX: [number, number];
  modY: number;
  totalW: number;
}

export function matrixLayout(phys: MatrixPhysical, W: number, H: number, v: MatrixView): MatrixLayout {
  const totalW = phys.moduleW * 2 + phys.gap;
  const fit = Math.min((W * 0.86) / totalW, (H * 0.66) / phys.moduleH);
  const scale = fit * v.zoom;
  const x0 = W / 2 + v.panX - (totalW * scale) / 2;
  const y0 = H / 2 + v.panY - (phys.moduleH * scale) / 2;
  return { scale, modX: [x0, x0 + (phys.moduleW + phys.gap) * scale], modY: y0, totalW };
}

function shade(hex: string, k: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  const ch = (s: number) => Math.round(((n >> s) & 255) * k);
  return `rgb(${ch(16)},${ch(8)},${ch(0)})`;
}

function arrowH(ctx: CanvasRenderingContext2D, x1: number, x2: number, y: number) {
  ctx.beginPath(); ctx.moveTo(x1, y); ctx.lineTo(x2, y);
  ctx.moveTo(x1 + 5, y - 3); ctx.lineTo(x1, y); ctx.lineTo(x1 + 5, y + 3);
  ctx.moveTo(x2 - 5, y - 3); ctx.lineTo(x2, y); ctx.lineTo(x2 - 5, y + 3);
  ctx.stroke();
}
function arrowV(ctx: CanvasRenderingContext2D, x: number, y1: number, y2: number) {
  ctx.beginPath(); ctx.moveTo(x, y1); ctx.lineTo(x, y2);
  ctx.moveTo(x - 3, y1 + 5); ctx.lineTo(x, y1); ctx.lineTo(x + 3, y1 + 5);
  ctx.moveTo(x - 3, y2 - 5); ctx.lineTo(x, y2); ctx.lineTo(x + 3, y2 - 5);
  ctx.stroke();
}

export function drawMatrix(ctx: CanvasRenderingContext2D, W: number, H: number, mf: MatrixFrame, phys: MatrixPhysical, v: MatrixView) {
  ctx.fillStyle = v.bg;
  ctx.fillRect(0, 0, W, H);
  const L = matrixLayout(phys, W, H, v);
  const s = L.scale;
  const gridW = 8 * phys.pitchX, gridH = 8 * phys.pitchY;
  const ledR = Math.max(0.5, (phys.ledDia / 2) * s);
  const grids = [mf.left, mf.right];
  const orient = [phys.orientationL, phys.orientationR];

  ctx.save();
  ctx.imageSmoothingEnabled = false;

  // gap: explicitly empty, no LEDs
  const gapX = L.modX[0] + phys.moduleW * s;
  const gapW = phys.gap * s;
  if (gapW > 1 && !v.compact) {
    ctx.save();
    ctx.beginPath(); ctx.rect(gapX, L.modY, gapW, phys.moduleH * s); ctx.clip();
    ctx.strokeStyle = 'rgba(215,240,128,0.10)';
    ctx.lineWidth = 1;
    for (let d = -phys.moduleH * s; d < gapW + phys.moduleH * s; d += 9) {
      ctx.beginPath(); ctx.moveTo(gapX + d, L.modY + phys.moduleH * s); ctx.lineTo(gapX + d + phys.moduleH * s, L.modY); ctx.stroke();
    }
    ctx.restore();
    ctx.strokeStyle = 'rgba(215,240,128,0.35)'; ctx.setLineDash([4, 4]);
    ctx.strokeRect(gapX + 0.5, L.modY + 0.5, gapW - 1, phys.moduleH * s - 1); ctx.setLineDash([]);
  }

  for (let m = 0; m < 2; m++) {
    const mx = L.modX[m], my = L.modY;
    const mw = phys.moduleW * s, mh = phys.moduleH * s;
    if (phys.frameVisible && !v.compact) {
      ctx.fillStyle = '#0a0c0f';
      ctx.strokeStyle = '#3a424c';
      ctx.lineWidth = 1.5;
      const rad = Math.min(8, 2 * s);
      ctx.beginPath(); ctx.roundRect(Math.round(mx) + 0.5, Math.round(my) + 0.5, Math.round(mw), Math.round(mh), rad); ctx.fill(); ctx.stroke();
      // orientation marker (pin-1 corner) so physical rotation is visible
      const o = orient[m];
      const cx = o === 0 || o === 270 ? mx + 6 : mx + mw - 6;
      const cy = o === 0 || o === 90 ? my + 6 : my + mh - 6;
      ctx.fillStyle = '#5b6672'; ctx.beginPath(); ctx.arc(cx, cy, 2.5, 0, Math.PI * 2); ctx.fill();
    }
    const gx0 = mx + ((phys.moduleW - gridW) / 2) * s;
    const gy0 = my + ((phys.moduleH - gridH) / 2) * s;
    if (v.grid && phys.gridVisible && !v.compact) {
      ctx.strokeStyle = 'rgba(255,255,255,0.05)'; ctx.lineWidth = 1;
      for (let i = 0; i <= 8; i++) {
        const x = Math.round(gx0 + i * phys.pitchX * s) + 0.5, y = Math.round(gy0 + i * phys.pitchY * s) + 0.5;
        ctx.beginPath(); ctx.moveTo(x, gy0); ctx.lineTo(x, gy0 + gridH * s); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(gx0, y); ctx.lineTo(gx0 + gridW * s, y); ctx.stroke();
      }
    }
    const on = shade(phys.ledColor, 0.25 + 0.75 * mf.brightness);
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const px = Math.round(gx0 + (c + 0.5) * phys.pitchX * s);
        const py = Math.round(gy0 + (r + 0.5) * phys.pitchY * s);
        const lit = grids[m][r][c];
        if (!lit && v.compact) continue; // lights-only: unlit LEDs are fully transparent
        if (lit) {
          ctx.shadowColor = phys.ledColor; ctx.shadowBlur = ledR * 1.4 * mf.brightness * (phys.glow ?? 1); ctx.fillStyle = on;
        } else {
          ctx.shadowBlur = 0; ctx.fillStyle = '#171b21';
        }
        if (phys.ledShape === 'round') { ctx.beginPath(); ctx.arc(px, py, ledR, 0, Math.PI * 2); ctx.fill(); }
        else { const d = Math.max(1, Math.round(ledR * 2)); ctx.fillRect(px - d / 2, py - d / 2, d, d); }
        ctx.shadowBlur = 0;
        if (!lit) { ctx.strokeStyle = '#242a32'; ctx.lineWidth = 1; if (phys.ledShape === 'round') { ctx.beginPath(); ctx.arc(px, py, ledR, 0, Math.PI * 2); ctx.stroke(); } }
      }
    }
    if (!v.compact) ctx.fillStyle = '#6b7684'; ctx.font = '10px "Google Sans Flex", sans-serif'; ctx.textAlign = 'center';
    if (!v.compact) ctx.fillText(m === 0 ? 'LEFT 8×8' : 'RIGHT 8×8', mx + mw / 2, my + mh + 14);
  }

  if (phys.dimensions) {
    ctx.strokeStyle = 'rgba(215,240,128,0.85)'; ctx.fillStyle = 'rgba(215,240,128,0.95)';
    ctx.lineWidth = 1; ctx.font = '11px "Google Sans Flex", sans-serif'; ctx.textAlign = 'center';
    const topY = L.modY - 16;
    arrowH(ctx, gapX, gapX + gapW, topY);
    ctx.fillText(`gap ${phys.gap.toFixed(1)} mm`, gapX + gapW / 2, topY - 6);
    const totY = L.modY + phys.moduleH * s + 34;
    const x0 = L.modX[0], x1 = L.modX[1] + phys.moduleW * s;
    arrowH(ctx, x0, x1, totY);
    ctx.fillText(`${L.totalW.toFixed(1)} mm overall`, (x0 + x1) / 2, totY - 6);
    ctx.strokeStyle = 'rgba(215,240,128,0.55)';
    arrowH(ctx, x0, x0 + phys.moduleW * s, topY);
    arrowH(ctx, L.modX[1], x1, topY);
    ctx.fillStyle = 'rgba(215,240,128,0.7)';
    ctx.fillText(`${phys.moduleW} mm`, x0 + (phys.moduleW * s) / 2, topY - 6);
    ctx.fillText(`${phys.moduleW} mm`, L.modX[1] + (phys.moduleW * s) / 2, topY - 6);
    const vx = x0 - 16;
    arrowV(ctx, vx, L.modY, L.modY + phys.moduleH * s);
    ctx.save(); ctx.translate(vx - 6, L.modY + (phys.moduleH * s) / 2); ctx.rotate(-Math.PI / 2);
    ctx.fillText(`${phys.moduleH} mm`, 0, 0); ctx.restore();
    ctx.textAlign = 'left'; ctx.fillStyle = 'rgba(215,240,128,0.7)';
    ctx.fillText(`pitch ${phys.pitchX}×${phys.pitchY} mm · LED ⌀${phys.ledDia} mm · 128 LEDs · no LEDs in gap`, x0, totY + 20);
  }
  ctx.restore();
}
