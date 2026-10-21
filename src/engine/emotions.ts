import type { EyeRows8 } from './types';
import { mirrorRows } from './eyePresets';

/** One pose of both eyes held for `ms`. Rows top->bottom, bit7 = leftmost column of that eye (same as EYE_PRESETS). */
export type EmotionFrame = { l: EyeRows8; r: EyeRows8; ms: number };
export type Emotion = { id: string; label: string; frames: EmotionFrame[] };

const px = (...rows: string[]): EyeRows8 => rows.map((s) => parseInt(s.replace(/\./g, '0').replace(/#/g, '1'), 2));
/** Right eye = horizontal mirror of the left eye (the face is symmetric unless a frame says otherwise). */
const sym = (l: EyeRows8, ms: number): EmotionFrame => ({ l, r: mirrorRows(l), ms });
const pair = (l: EyeRows8, r: EyeRows8, ms: number): EmotionFrame => ({ l, r, ms });
const shift = (rows: EyeRows8, dx: number): EyeRows8 => rows.map((v) => (dx >= 0 ? (v >> dx) & 0xff : (v << -dx) & 0xff));

const up = (rows: EyeRows8): EyeRows8 => [...rows.slice(1), 0];

// ---- eye shapes (left-eye view; outer corner = column 0) -------------------------------------------------------------
const OPEN = px('........', '..####..', '.######.', '.######.', '.######.', '.######.', '..####..', '........');
const HALF = px('........', '........', '........', '..####..', '.######.', '.######.', '..####..', '........');
const SHUT = px('........', '........', '........', '........', '.######.', '........', '........', '........');
const ARC = px('........', '........', '..####..', '.##..##.', '.#....#.', '........', '........', '........'); // ^ happy
const SAD = px('........', '....###.', '..#####.', '.######.', '.######.', '.######.', '..####..', '........');
const ANGRY = px('........', '.###....', '.#####..', '.######.', '.######.', '..####..', '........', '........');
const WIDE = px('..####..', '.######.', '########', '###..###', '###..###', '########', '.######.', '..####..');
const SLEEPY = px('........', '........', '........', '........', '.######.', '.######.', '..####..', '........');
const HEART_S = px('........', '........', '.##..##.', '.######.', '..####..', '...##...', '........', '........');
const HEART_L = px('........', '.##..##.', '########', '########', '.######.', '..####..', '...##...', '........');
const STAR_L = px('...##...', '...##...', '.######.', '########', '.######.', '...##...', '..#..#..', '.#....#.');
const STAR_S = px('........', '........', '...##...', '..####..', '...##...', '........', '........', '........');
const SQUINT = px('........', '........', '........', '.######.', '.######.', '........', '........', '........');
const SMALL = px('........', '........', '...##...', '..####..', '..####..', '...##...', '........', '........');

// perimeter of an 8x8 ring, clockwise, for the dizzy spinner
const RING: [number, number][] = [[0, 2], [0, 3], [0, 4], [0, 5], [1, 6], [2, 7], [3, 7], [4, 7], [5, 7], [6, 6], [7, 5], [7, 4], [7, 3], [7, 2], [6, 1], [5, 0], [4, 0], [3, 0], [2, 0], [1, 1]];
const ringArc = (start: number, len: number): EyeRows8 => {
  const rows = new Array(8).fill(0);
  for (let i = 0; i < len; i++) { const [r, c] = RING[(start + i) % RING.length]; rows[r] |= 1 << (7 - c); }
  rows[3] |= 0b00011000; rows[4] |= 0b00011000; // centre dot
  return rows;
};

const blinkCycle = (open: EyeRows8, holdMs: number): EmotionFrame[] => [sym(open, holdMs), sym(HALF, 60), sym(SHUT, 90), sym(HALF, 60)];

export const EMOTIONS: Emotion[] = [
  { id: 'neutral', label: 'Neutral', frames: [...blinkCycle(OPEN, 1800), ...blinkCycle(OPEN, 900)] },
  { id: 'happy', label: 'Happy', frames: [sym(ARC, 700), sym(up(ARC), 160), sym(ARC, 160), sym(up(ARC), 160), sym(ARC, 900)] },
  { id: 'sad', label: 'Sad', frames: [sym(SAD, 1600), sym(HALF, 120), sym(SAD, 900), sym(SHUT, 140), sym(SAD, 1200)] },
  { id: 'angry', label: 'Angry', frames: [sym(ANGRY, 1400), sym(SQUINT, 120), sym(ANGRY, 1000)] },
  { id: 'surprised', label: 'Surprised', frames: [sym(OPEN, 140), sym(WIDE, 1300), sym(OPEN, 200), sym(WIDE, 500)] },
  { id: 'sleepy', label: 'Sleepy', frames: [sym(OPEN, 500), sym(SLEEPY, 500), sym(HALF, 300), sym(SHUT, 900), sym(SLEEPY, 250), sym(SHUT, 1200), sym(OPEN, 150), sym(SLEEPY, 400)] },
  { id: 'love', label: 'Love', frames: [sym(HEART_L, 380), sym(HEART_S, 260), sym(HEART_L, 380), sym(HEART_S, 260), sym(HEART_L, 700)] },
  { id: 'wink', label: 'Wink', frames: [sym(OPEN, 1100), pair(OPEN, mirrorRows(ARC), 700), sym(OPEN, 700)] },
  { id: 'confused', label: 'Confused', frames: [pair(OPEN, mirrorRows(SMALL), 900), pair(shift(OPEN, 1), mirrorRows(shift(SQUINT, -1)), 700), pair(OPEN, mirrorRows(SMALL), 900)] },
  { id: 'dizzy', label: 'Dizzy', frames: Array.from({ length: 10 }, (_, i) => pair(ringArc(i * 2, 8), ringArc(-i * 2 + 20, 8), 110)) },
  { id: 'excited', label: 'Excited', frames: [sym(STAR_L, 220), sym(STAR_S, 160), sym(STAR_L, 220), sym(STAR_S, 160), sym(STAR_L, 220), sym(STAR_S, 160), sym(STAR_L, 500)] },
  { id: 'look_around', label: 'Look around', frames: [sym(OPEN, 600), sym(shift(OPEN, -2), 700), sym(OPEN, 300), sym(shift(OPEN, 2), 700), sym(OPEN, 400)] },
];

export const emotionById = (id: string) => EMOTIONS.find((e) => e.id === id);
export const emotionDurationMs = (e: Emotion) => e.frames.reduce((a, f) => a + f.ms, 0);

/** The frame active `tMs` into an emotion that loops back to its first frame. */
export function emotionFrameAt(e: Emotion, tMs: number): EmotionFrame {
  let t = tMs % emotionDurationMs(e);
  for (const f of e.frames) { if (t < f.ms) return f; t -= f.ms; }
  return e.frames[e.frames.length - 1];
}

export type ExportOpts = { fps: number; minSec: number; gapSec: number };
export const DEFAULT_EXPORT: ExportOpts = { fps: 30, minSec: 3, gapSec: 0.4 };

/**
 * Per-video-frame eye bitmaps for a list of emotions played back to back. Each emotion repeats its whole cycle until it has
 * lasted at least `minSec` (so blinks/animations are never cut in half), followed by `gapSec` of dark eyes.
 */
export function buildEmotionTimeline(list: Emotion[], o: ExportOpts): { l: EyeRows8; r: EyeRows8 }[] {
  const out: { l: EyeRows8; r: EyeRows8 }[] = [];
  const off = new Array(8).fill(0);
  for (const e of list) {
    const cycle = emotionDurationMs(e);
    const total = Math.max(1, Math.ceil((o.minSec * 1000) / cycle)) * cycle;
    const n = Math.round((total / 1000) * o.fps);
    for (let i = 0; i < n; i++) { const f = emotionFrameAt(e, ((i + 0.5) / o.fps) * 1000); out.push({ l: f.l, r: f.r }); }
    for (let i = 0; i < Math.round(o.gapSec * o.fps); i++) out.push({ l: off, r: off });
  }
  return out;
}

/** Pure black/white 16x8 -> W x H (2:1) gray frame. Lit dots are white discs on black; the two 8x8 eyes sit side by side. */
export function renderGrayFrame(l: EyeRows8, r: EyeRows8, W: number, H: number): Uint8Array {
  const img = new Uint8Array(W * H);
  const cell = W / 16, rad = cell * 0.4;
  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 16; col++) {
      const rows = col < 8 ? l : r, c = col & 7;
      if (((rows[row] >> (7 - c)) & 1) === 0) continue;
      const cx = (col + 0.5) * cell, cy = (row + 0.5) * cell;
      for (let y = Math.max(0, Math.floor(cy - rad - 1)); y <= Math.min(H - 1, Math.ceil(cy + rad + 1)); y++) {
        for (let x = Math.max(0, Math.floor(cx - rad - 1)); x <= Math.min(W - 1, Math.ceil(cx + rad + 1)); x++) {
          const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
          const a = Math.max(0, Math.min(1, rad + 0.5 - d)); // 1px antialiased edge
          const v = Math.round(a * 255);
          if (v > img[y * W + x]) img[y * W + x] = v;
        }
      }
    }
  }
  return img;
}
