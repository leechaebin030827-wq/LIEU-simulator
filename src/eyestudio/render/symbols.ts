import type { Pattern, Side } from '../engine/types';

/**
 * Emoji-style eyes (hearts, stars, …). Each symbol has an 8×8 LED pattern (Matrix, binary) and a vector drawing
 * (Freeform, unit space: centre 0,0, radius ≈ 1, uniformly scaled to the eye size).
 */
export interface SymbolDef {
  id: string;
  label: string;
  /** LED pattern for one eye; `t` (ms) allows 2-frame animation such as a beating heart */
  matrix: (t: number, side: Side) => Pattern;
  draw: (ctx: CanvasRenderingContext2D, side: Side) => void;
  pulse?: boolean; // gentle size pulse in Freeform
}

const P = (s: string): Pattern => s.trim().split(/\s+/);
const flip = (p: Pattern): Pattern => p.map((r) => r.split('').reverse().join(''));

function stroke(ctx: CanvasRenderingContext2D, lw: number, fn: () => void) {
  ctx.lineWidth = lw; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.beginPath(); fn(); ctx.stroke();
}
function poly(ctx: CanvasRenderingContext2D, pts: [number, number][], round = 0.12) {
  ctx.beginPath(); pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.closePath();
  ctx.fill(); ctx.lineWidth = round; ctx.lineJoin = 'round'; ctx.stroke();
}
const star = (n: number, ro: number, ri: number): [number, number][] =>
  Array.from({ length: n * 2 }, (_, i) => { const a = -Math.PI / 2 + (i * Math.PI) / n; const r = i % 2 ? ri : ro; return [Math.cos(a) * r, Math.sin(a) * r]; });

const heartBig = P('00000000 01100110 11111111 11111111 01111110 00111100 00011000 00000000');
const heartSmall = P('00000000 00000000 01100110 01111110 00111100 00011000 00000000 00000000');
const arcUp = P('00000000 00011000 00111100 01100110 11000011 00000000 00000000 00000000');
const arcDown = P('00000000 00000000 00000000 11000011 01100110 00111100 00011000 00000000');
const gt = P('00000000 11000000 01110000 00011100 00011100 01110000 11000000 00000000');
const line = P('00000000 00000000 00000000 01111110 00000000 00000000 00000000 00000000');

export const SYMBOLS: Record<string, SymbolDef> = {
  heart: {
    id: 'heart', label: '하트', pulse: true,
    matrix: (t) => (Math.floor(t / 380) % 2 ? heartSmall : heartBig),
    draw: (c) => { c.beginPath(); c.moveTo(0, 0.95); c.bezierCurveTo(-1.3, 0.15, -0.95, -0.95, 0, -0.38); c.bezierCurveTo(0.95, -0.95, 1.3, 0.15, 0, 0.95); c.fill(); },
  },
  star: {
    id: 'star', label: '별', pulse: true,
    matrix: () => P('00011000 00011000 11111111 01111110 00111100 00111100 01100110 01000010'),
    draw: (c) => poly(c, star(5, 1, 0.48), 0.16),
  },
  sparkle: {
    id: 'sparkle', label: '반짝',
    matrix: (t) => (Math.floor(t / 450) % 2 ? P('00000000 00011000 00011000 00111100 00111100 00011000 00011000 00000000') : P('00011000 00011000 00111100 11111111 11111111 00111100 00011000 00011000')),
    draw: (c) => { c.beginPath(); c.moveTo(0, -1); c.quadraticCurveTo(0.12, -0.12, 1, 0); c.quadraticCurveTo(0.12, 0.12, 0, 1); c.quadraticCurveTo(-0.12, 0.12, -1, 0); c.quadraticCurveTo(-0.12, -0.12, 0, -1); c.fill(); },
  },
  joy: {
    id: 'joy', label: '^ ^ 기쁨',
    matrix: () => arcUp,
    draw: (c) => stroke(c, 0.3, () => c.arc(0, 0.45, 0.75, Math.PI * 1.1, Math.PI * 1.9)),
  },
  cheer: {
    id: 'cheer', label: '> < 신남',
    matrix: (_t, side) => (side === 'L' ? gt : flip(gt)),
    draw: (c, side) => { const s = side === 'L' ? 1 : -1; stroke(c, 0.3, () => { c.moveTo(-0.7 * s, -0.7); c.lineTo(0.6 * s, 0); c.lineTo(-0.7 * s, 0.7); }); },
  },
  dizzy: {
    id: 'dizzy', label: 'X 눈',
    matrix: () => P('10000001 11000011 01100110 00111100 00111100 01100110 11000011 10000001'),
    draw: (c) => stroke(c, 0.3, () => { c.moveTo(-0.72, -0.72); c.lineTo(0.72, 0.72); c.moveTo(0.72, -0.72); c.lineTo(-0.72, 0.72); }),
  },
  spiral: {
    id: 'spiral', label: '@ 어지러움',
    matrix: (t) => (Math.floor(t / 300) % 2 ? P('00111100 01000010 10011001 10100101 10100101 10011101 01000000 00111100') : P('00111100 01000000 10111001 10100101 10100101 10011001 01000010 00111100')),
    draw: (c) => stroke(c, 0.15, () => { for (let i = 0; i <= 80; i++) { const a = (i / 80) * Math.PI * 5.2; const r = 0.06 + (i / 80) * 0.9; const x = Math.cos(a) * r, y = Math.sin(a) * r; if (i) c.lineTo(x, y); else c.moveTo(x, y); } }),
  },
  sleep: {
    id: 'sleep', label: '- - 졸음',
    matrix: () => line,
    draw: (c) => stroke(c, 0.3, () => { c.moveTo(-0.8, 0); c.lineTo(0.8, 0); }),
  },
  cry: {
    id: 'cry', label: '˘ ˘ 울음',
    matrix: () => arcDown,
    draw: (c) => stroke(c, 0.3, () => c.arc(0, -0.45, 0.75, Math.PI * 0.1, Math.PI * 0.9)),
  },
  ring: {
    id: 'ring', label: 'O O 놀람',
    matrix: () => P('00111100 01100110 11000011 11000011 11000011 11000011 01100110 00111100'),
    draw: (c) => stroke(c, 0.3, () => c.arc(0, 0, 0.78, 0, Math.PI * 2)),
  },
  moon: {
    id: 'moon', label: '달',
    matrix: (_t, side) => (side === 'L' ? P('00111000 01110000 11100000 11100000 11100000 11100000 01110000 00111000') : P('00011100 00001110 00000111 00000111 00000111 00000111 00001110 00011100')),
    draw: (c, side) => { const s = side === 'L' ? 1 : -1; c.beginPath(); c.arc(0, 0, 0.95, 0, Math.PI * 2); c.arc(0.45 * s, -0.05, 0.8, 0, Math.PI * 2, true); c.fill('evenodd'); },
  },
  dot: {
    id: 'dot', label: '• • 점 눈',
    matrix: () => P('00000000 00000000 00011000 00111100 00111100 00011000 00000000 00000000'),
    draw: (c) => { c.beginPath(); c.arc(0, 0, 0.42, 0, Math.PI * 2); c.fill(); },
  },
  diamond: {
    id: 'diamond', label: '다이아',
    matrix: () => P('00011000 00111100 01111110 11111111 01111110 00111100 00011000 00000000'),
    draw: (c) => poly(c, [[0, -1], [0.78, 0], [0, 1], [-0.78, 0]], 0.14),
  },
  wink: {
    id: 'wink', label: '^ - 윙크',
    matrix: (_t, side) => (side === 'L' ? arcUp : line),
    draw: (c, side) => (side === 'L' ? stroke(c, 0.3, () => c.arc(0, 0.45, 0.75, Math.PI * 1.1, Math.PI * 1.9)) : stroke(c, 0.3, () => { c.moveTo(-0.8, 0); c.lineTo(0.8, 0); })),
  },
  bigeye: {
    id: 'bigeye', label: '왕눈',
    matrix: () => P('00111100 01111110 11111111 11111111 11111111 11111111 01111110 00111100'),
    draw: (c) => { c.beginPath(); c.arc(0, 0, 0.95, 0, Math.PI * 2); c.fill(); },
  },
};
export const SYMBOL_IDS = Object.keys(SYMBOLS);
