import type { Pattern, PatternPair } from './types';

export const emptyPattern = (): Pattern => Array.from({ length: 8 }, () => '00000000');
export const fullPattern = (): Pattern => Array.from({ length: 8 }, () => '11111111');

export const patternToGrid = (p: Pattern): boolean[][] =>
  Array.from({ length: 8 }, (_, r) => Array.from({ length: 8 }, (_, c) => p[r]?.[c] === '1'));

export const gridToPattern = (g: boolean[][]): Pattern =>
  g.map((row) => row.map((v) => (v ? '1' : '0')).join(''));

export const emptyGrid = (): boolean[][] => Array.from({ length: 8 }, () => Array<boolean>(8).fill(false));

export function setPixel(p: Pattern, r: number, c: number, on: boolean): Pattern {
  if (r < 0 || r > 7 || c < 0 || c > 7) return p;
  const next = p.slice();
  next[r] = next[r].slice(0, c) + (on ? '1' : '0') + next[r].slice(c + 1);
  return next;
}

export const invertPattern = (p: Pattern): Pattern =>
  p.map((row) => row.split('').map((ch) => (ch === '1' ? '0' : '1')).join(''));

export const flipPatternH = (p: Pattern): Pattern => p.map((row) => row.split('').reverse().join(''));

export const countOn = (p: Pattern) => p.join('').split('1').length - 1;

export function isValidPattern(p: unknown): p is Pattern {
  return Array.isArray(p) && p.length === 8 && p.every((r) => typeof r === 'string' && /^[01]{8}$/.test(r));
}

export const clonePair = (p: PatternPair): PatternPair => ({ left: p.left.slice(), right: p.right.slice() });

const P = (rows: string[]): Pattern => rows;

/** Built-in hand-tuned 8x8 eye expressions (left-eye orientation; right is mirrored where noted). */
export interface BuiltinPixelExpression { id: string; name: string; left: Pattern; right: Pattern }

const round = P(['00000000', '00111100', '01111110', '01111110', '01111110', '01111110', '00111100', '00000000']);
const wide = P(['00000000', '01111110', '01111110', '01111110', '01111110', '01111110', '01111110', '00000000']);
const slim = P(['00000000', '00011000', '00111100', '00111100', '00111100', '00111100', '00011000', '00000000']);
const happyL = P(['00000000', '00000000', '00111100', '01100110', '11000011', '00000000', '00000000', '00000000']);
const tired = P(['00000000', '00000000', '11111110', '01111110', '01111110', '00111100', '00000000', '00000000']);
const angryL = P(['00000000', '11000000', '01110000', '01111110', '01111110', '01111110', '00111100', '00000000']);
const sleepLine = P(['00000000', '00000000', '00000000', '01111110', '00000000', '00000000', '00000000', '00000000']);
const surprise = P(['00111100', '01111110', '11111111', '11111111', '11111111', '11111111', '01111110', '00111100']);
const heart = P(['00000000', '01100110', '11111111', '11111111', '01111110', '00111100', '00011000', '00000000']);

export const BUILTIN_PIXEL_EXPRESSIONS: BuiltinPixelExpression[] = [
  { id: 'px-round', name: 'Round', left: round, right: round },
  { id: 'px-wide', name: 'Wide', left: wide, right: wide },
  { id: 'px-slim', name: 'Slim', left: slim, right: slim },
  { id: 'px-happy', name: 'Happy Arc', left: happyL, right: happyL },
  { id: 'px-tired', name: 'Tired', left: tired, right: tired },
  { id: 'px-angry', name: 'Angry', left: angryL, right: flipPatternH(angryL) },
  { id: 'px-sleep', name: 'Sleep Line', left: sleepLine, right: sleepLine },
  { id: 'px-surprise', name: 'Surprise', left: surprise, right: surprise },
  { id: 'px-heart', name: 'Heart', left: heart, right: heart },
];
