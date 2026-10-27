/**
 * The TV picture as its own 9:16 canvas, independent of the 3D scene: the source (still / video / clip / start button) plus the
 * passenger-facing UI are composed here. The 3D screen mesh uses this canvas as its texture and the editor's "Screen" tab
 * mirrors it, so both always show exactly the same picture.
 */

import './screenFonts.css';

/** All screen UI is laid out in real 4K portrait pixels (2160 x 3840); the canvas just renders it at RENDER_SCALE of that. */
export const DESIGN_W = 2160;
export const DESIGN_H = 3840;
/** 0.25 = 540x960 (light), 0.5 = 1080x1920, 1 = full 4K. Only changes sharpness / cost, never the layout. */
export const RENDER_SCALE = 0.5;
export const SCREEN_W = Math.round(DESIGN_W * RENDER_SCALE);
export const SCREEN_H = Math.round(DESIGN_H * RENDER_SCALE);

export const screenOut = (() => {
  const canvas = document.createElement('canvas');
  canvas.width = SCREEN_W; canvas.height = SCREEN_H;
  return { canvas, ctx: canvas.getContext('2d')! };
})();

/** Passenger-facing copy of a scene: small tag, one friendly headline, one short line of what is happening. */
/** `cta` = something the rider does (say "Hey LIEU", press start): shown big in the middle of the screen. */
export type TvCopy = { tag?: string; head: string; sub?: string; cta?: { text: string; sub?: string } };
export type SceneCaption = { title: string; desc?: string; tv?: TvCopy; idx: number; total: number; age: number; remain: number; prev?: { tv?: TvCopy; title: string; desc?: string } };
export type ScreenInfo = { title: string; scene?: SceneCaption | null };

const SANS = '"Google Sans Flex", -apple-system, "Apple SD Gothic Neo", sans-serif';   // Google Sans Flex has no Hangul: those glyphs come from the system Korean sans
const KR = SANS;
const MONO = SANS;

// Canvas never triggers a webfont download by itself: ask for the exact glyphs we are about to draw; once they arrive the next frame is right.
const asked = new Set<string>();
function needFont(weight: number, family: string, text: string) {
  const key = `${weight}|${family}|${text}`;
  if (asked.has(key) || typeof document === 'undefined' || !document.fonts) return;
  asked.add(key);
  void document.fonts.load(`${weight} 40px "${family}"`, text).catch(() => undefined);
}
const font = (weight: number, px: number, stack = SANS) => `${weight} ${px}px ${stack}`;

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const easeOut = (x: number) => 1 - Math.pow(1 - clamp01(x), 3);

const setSpacing = (ctx: CanvasRenderingContext2D, px: number) => { if ('letterSpacing' in ctx) (ctx as unknown as { letterSpacing: string }).letterSpacing = `${px}px`; };

/** Wrap by character width (Korean has no spaces between every word) and by spaces for Latin text. */
function wrap(ctx: CanvasRenderingContext2D, text: string, maxW: number, maxLines: number): string[] {
  const lines: string[] = []; let cur = '';
  for (const ch of text) {
    const next = cur + ch;
    if (ctx.measureText(next).width > maxW && cur) {
      const sp = cur.lastIndexOf(' ');
      if (ch !== ' ' && sp > cur.length * 0.5 && /[A-Za-z]/.test(ch)) { lines.push(cur.slice(0, sp)); cur = cur.slice(sp + 1) + ch; }
      else { lines.push(cur.trimEnd()); cur = ch === ' ' ? '' : ch; }
    } else cur = next;
  }
  if (cur) lines.push(cur);
  if (lines.length > maxLines) { const l = lines.slice(0, maxLines); l[maxLines - 1] = l[maxLines - 1].replace(/.{1}$/, '…'); return l; }
  return lines;
}

/**
 * Frosted-glass panel (units: 4K pixels): the picture behind it blurred + saturated, a faint neutral tint that deepens toward the
 * bottom for legibility, a hairline edge with a specular top-left falloff, no drop shadow. No gloss blobs, no colour.
 */
function glass(ctx: CanvasRenderingContext2D, bg: CanvasImageSource | null, x: number, y: number, w: number, h: number, r: number) {
  const rr = () => { ctx.beginPath(); ctx.roundRect(x, y, w, h, r); };
  // body
  ctx.save(); rr(); ctx.clip();
  if (bg) {
    try { ctx.filter = `blur(${12 * RENDER_SCALE}px) saturate(1.5) brightness(1.04)`; } catch { /* no ctx.filter: tint only */ }
    ctx.drawImage(bg, -200, -200, DESIGN_W + 400, DESIGN_H + 400); ctx.filter = 'none';
  }
  const tone = ctx.createLinearGradient(0, y, 0, y + h);
  tone.addColorStop(0, 'rgba(255,255,255,0.10)'); tone.addColorStop(0.55, 'rgba(14,20,34,0.03)'); tone.addColorStop(1, 'rgba(14,20,34,0.16)');
  ctx.fillStyle = tone; ctx.fillRect(x, y, w, h);
  ctx.restore();
  // inner top highlight (thin, only the upper edge)
  ctx.save(); rr(); ctx.clip();
  const hi = ctx.createLinearGradient(0, y, 0, y + h * 0.5);
  hi.addColorStop(0, 'rgba(255,255,255,0.5)'); hi.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.beginPath(); ctx.roundRect(x + 3, y + 3, w - 6, h - 6, Math.max(0, r - 3)); ctx.lineWidth = 6; ctx.strokeStyle = hi; ctx.stroke();
  ctx.restore();
  // hairline edge with a diagonal specular falloff
  const edge = ctx.createLinearGradient(x, y, x + w, y + h);
  edge.addColorStop(0, 'rgba(255,255,255,0.55)'); edge.addColorStop(0.3, 'rgba(255,255,255,0.18)'); edge.addColorStop(0.7, 'rgba(255,255,255,0.10)'); edge.addColorStop(1, 'rgba(255,255,255,0.32)');
  ctx.beginPath(); ctx.roundRect(x + 1.5, y + 1.5, w - 3, h - 3, Math.max(0, r - 1.5)); ctx.lineWidth = 3; ctx.strokeStyle = edge; ctx.stroke();
}

const pad2 = (n: number) => String(n).padStart(2, '0');

/** Falls back to the director notes (title/desc) for scenes without passenger copy. */
function copyOf(sc: SceneCaption): TvCopy {
  return sc.tv ?? { head: sc.title.replace(/^[①-⑩]\s*/, ''), sub: sc.desc };
}

const easeInOut = (x: number) => { const t = clamp01(x); return t * t * (3 - 2 * t); };
const easeIn = (x: number) => Math.pow(clamp01(x), 2);

const CARD = { X: 120, W: DESIGN_W - 240, padX: 108, padT: 96, padB: 96, R: 0, META: 60, HEAD: 124, SUB: 72, HEAD_LH: 150, SUB_LH: 106 };
type Layout = { c: TvCopy; hl: string[]; sl: string[]; metaH: number; H: number };

function layoutOf(ctx: CanvasRenderingContext2D, c: TvCopy): Layout {
  const { W, padX, padT, padB, META, HEAD, SUB, HEAD_LH, SUB_LH } = CARD, textW = W - padX * 2;
  needFont(600, 'Google Sans Flex', c.head);
  needFont(400, 'Google Sans Flex', c.sub ?? '');
  if (c.tag) { needFont(500, 'Google Sans Flex', c.tag); }
  ctx.save();
  ctx.font = font(600, HEAD, KR); setSpacing(ctx, -2);
  const hl = wrap(ctx, c.head, textW, 2);
  ctx.font = font(400, SUB, KR); setSpacing(ctx, 0);
  const sl = c.sub ? wrap(ctx, c.sub, textW, 2) : [];
  ctx.restore();
  const metaH = c.tag ? META + 56 : 0;
  return { c, hl, sl, metaH, H: padT + metaH + hl.length * HEAD_LH + (sl.length ? 14 + sl.length * SUB_LH : 0) + 64 + 6 + padB };
}

/** One text element rises 28px into place while fading in (r: 0..1), or drifts up and out when `out` is set. */
function lift(ctx: CanvasRenderingContext2D, alpha: number, dy: number, draw: () => void) {
  if (alpha <= 0.002) return;
  ctx.save(); ctx.globalAlpha *= alpha; ctx.translate(0, dy); draw(); ctx.restore();
}

/** Tag, headline and sub of one layout; `r(k)` = reveal progress of element k (0 tag, 1 headline, 2 sub), `out` = 0..1 leaving. */
function drawContent(ctx: CanvasRenderingContext2D, Y: number, lay: Layout, r: (k: number) => number, out: number) {
  const { X, padX, padT, META, HEAD, SUB, HEAD_LH, SUB_LH } = CARD;
  const al = (k: number) => (out > 0 ? 1 - easeIn(out * 1.6) : r(k));
  const dy = (k: number) => (out > 0 ? -24 * easeInOut(out) : (1 - r(k)) * 28);
  let y = Y + padT;
  ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'left';
  if (lay.c.tag) {
    lift(ctx, al(0), dy(0), () => {
      ctx.fillStyle = 'rgba(255,255,255,0.74)'; ctx.font = font(500, META, KR); setSpacing(ctx, 3);
      ctx.fillText(lay.c.tag!, X + padX, y + META * 0.8); setSpacing(ctx, 0);
    });
    y += lay.metaH;
  }
  lift(ctx, al(1), dy(1), () => {
    ctx.fillStyle = '#fff'; ctx.font = font(600, HEAD, KR); setSpacing(ctx, -2);
    let yy = y + HEAD * 0.86;
    for (const l of lay.hl) { ctx.fillText(l, X + padX, yy); yy += HEAD_LH; }
    setSpacing(ctx, 0);
  });
  y += lay.hl.length * HEAD_LH;
  if (lay.sl.length) {
    lift(ctx, al(2), dy(2), () => {
      ctx.font = font(400, SUB, KR); ctx.fillStyle = 'rgba(255,255,255,0.82)';
      let yy = y + 14 + SUB * 0.84;
      for (const l of lay.sl) { ctx.fillText(l, X + padX, yy); yy += SUB_LH; }
    });
  }
}

/**
 * Passenger card, top of the screen: a quiet meta row (situation tag left, step counter right), one confident headline, one short
 * supporting line, and a hairline that fills as the step plays out. No jargon about the machine. Units: 4K pixels.
 *
 * Micro-interactions (all pure functions of scenario time, so scrub / pause / loop always show the same frame): the card eases in once,
 * on a scene change the old text drifts up and out while the new text rises in line by line, the card height morphs between the two
 * layouts, and the step counter rolls like an odometer.
 */
function drawSceneCard(ctx: CanvasRenderingContext2D, bg: CanvasImageSource | null, sc: SceneCaption) {
  const first = !sc.prev;
  const a = first ? easeOut((sc.age + 0.3) / 0.5) : 1; // first scene: already mostly visible at t=0 so a paused frame still shows it
  if (a <= 0) return;
  const { X, W, padX, padB, R, META } = CARD, textW = W - padX * 2;
  const lay = layoutOf(ctx, copyOf(sc));
  const prevLay = sc.prev ? layoutOf(ctx, sc.prev.tv ?? { head: sc.prev.title.replace(/^[①-⑩]\s*/, ''), sub: sc.prev.desc }) : null;
  const T = first ? 1 : easeInOut(sc.age / 0.55);
  const H = prevLay ? prevLay.H + (lay.H - prevLay.H) * T : lay.H;
  const Y = 288 - (first ? (1 - a) * 96 : 0);
  ctx.save();
  ctx.globalAlpha = a;
  glass(ctx, bg, X, Y, W, H, R);

  // text: leaving content (previous scene) then arriving content, line by line
  const o = first ? 0.3 : 0.12;
  if (prevLay && sc.age < 0.45) drawContent(ctx, Y, prevLay, () => 0, clamp01(sc.age / 0.3));
  drawContent(ctx, Y, lay, (k) => easeOut((sc.age + o - 0.08 * k) / 0.5), 0);

  // step counter: rolls up like an odometer
  needFont(500, 'Google Sans Flex', '0123456789/');
  if (lay.c.tag) {
    const ty = Y + CARD.padT + META * 0.8, rx = X + W - padX;
    const roll = first ? 1 : easeOut(sc.age / 0.5);
    const num = (i: number) => `${pad2(i + 1)} / ${pad2(sc.total)}`;
    ctx.save();
    ctx.beginPath(); ctx.rect(rx - 520, ty - META, 540, META * 1.7); ctx.clip();
    ctx.font = font(500, META, MONO); setSpacing(ctx, 2); ctx.textAlign = 'right'; ctx.textBaseline = 'alphabetic';
    if (roll < 1) { ctx.fillStyle = `rgba(255,255,255,${0.5 * (1 - roll)})`; ctx.fillText(num(sc.idx - 1), rx, ty - roll * META * 0.9); }
    ctx.fillStyle = `rgba(255,255,255,${0.5 * roll})`; ctx.fillText(num(sc.idx), rx, ty + (1 - roll) * META * 0.9);
    ctx.restore();
  }

  // step progress hairline
  const total = sc.age + (sc.remain < 1e8 ? sc.remain : 0), prog = sc.remain < 1e8 && total > 0 ? clamp01(sc.age / total) : 1;
  const ly = Y + H - padB + 4, lx = X + padX;
  ctx.beginPath(); ctx.rect(lx, ly, textW, 6); ctx.fillStyle = 'rgba(255,255,255,0.2)'; ctx.fill();
  if (prog > 0) { ctx.beginPath(); ctx.rect(lx, ly, Math.max(6, textW * prog), 6); ctx.fillStyle = 'rgba(255,255,255,0.9)'; ctx.fill(); }
  ctx.restore();
}

/** Centre prompt for what the rider can do ("Hey LIEU"): a fine live waveform and large type straight on the picture, no box. */
function drawCta(ctx: CanvasRenderingContext2D, sc: SceneCaption) {
  const cta = sc.tv?.cta;
  if (!cta) return;
  const a = easeOut((sc.age + 0.2) / 0.6) * easeOut(sc.remain / 0.4);
  if (a <= 0.001) return;
  needFont(500, 'Google Sans Flex', cta.text); needFont(400, 'Google Sans Flex', cta.sub ?? '');
  const cx = DESIGN_W / 2, cy = DESIGN_H / 2 + 220;
  ctx.save();
  ctx.globalAlpha = a;
  ctx.translate(0, (1 - a) * 40);
  // listening ripple: two hairline rings expanding from the waveform and fading
  for (let k = 0; k < 2; k++) {
    const ph = ((sc.age / 2.6 + k * 0.5) % 1), rr = 120 + ph * 520;
    ctx.save(); ctx.globalAlpha *= (1 - ph) * 0.55;
    ctx.beginPath(); ctx.ellipse(cx, cy - 250, rr * 1.9, rr * 0.5, 0, 0, Math.PI * 2); ctx.lineWidth = 4; ctx.strokeStyle = '#fff'; ctx.stroke(); ctx.restore();
  }
  // waveform: thin bars, envelope peaks in the middle, each breathing at its own phase
  const N = 33, BW = 9, BG = 17, x0 = cx - (N * BW + (N - 1) * BG) / 2, wy = cy - 250;
  ctx.fillStyle = 'rgba(255,255,255,0.92)';
  for (let i = 0; i < N; i++) {
    const env = Math.exp(-Math.pow((i - (N - 1) / 2) / 8.5, 2)), k = 0.5 + 0.5 * Math.sin(sc.age * 3.6 + i * 0.62) * Math.sin(sc.age * 1.7 + i * 0.21);
    const h = 14 + 150 * env * (0.25 + 0.75 * k);
    ctx.beginPath(); ctx.rect(x0 + i * (BW + BG), wy - h / 2, BW, h); ctx.fill();
  }
  ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic'; ctx.fillStyle = '#fff';
  ctx.font = font(500, 300); setSpacing(ctx, -9);
  ctx.fillText(cta.text, cx, cy + 90);
  setSpacing(ctx, 0);
  if (cta.sub) { ctx.font = font(400, 92, KR); ctx.fillStyle = 'rgba(255,255,255,0.88)'; setSpacing(ctx, 2); ctx.fillText(cta.sub, cx, cy + 90 + 170); setSpacing(ctx, 0); }
  ctx.restore();
}

/** Redraw the finished screen picture from the current source. */
export function composeScreen(src: CanvasImageSource | null, info: ScreenInfo) {
  const { ctx } = screenOut;
  ctx.setTransform(RENDER_SCALE, 0, 0, RENDER_SCALE, 0, 0); // everything below is in 4K pixels
  ctx.clearRect(0, 0, DESIGN_W, DESIGN_H);
  if (src) ctx.drawImage(src, 0, 0, DESIGN_W, DESIGN_H);
  if (info.scene) { drawSceneCard(ctx, src, info.scene); drawCta(ctx, info.scene); }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
}
