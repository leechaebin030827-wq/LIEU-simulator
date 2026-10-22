import type { MoodId, MoodVec } from './types';
import { MOOD_IDS } from './types';

export const ZERO_MOOD: MoodVec = { lt: 0, lb: 0, sl: 0, ar: 0, op: 0, cur: 0 };

/**
 * Mood definitions as lid / shape modifiers at 100% strength.
 * (Default / Happy / Tired / Angry follow the mood set of FluxGarage RoboEyes conceptually;
 *  Calm, Curious, Attentive, Reassuring, Sleepy are LIEU additions.)
 */
export const MOODS: Record<MoodId, { label: string; vec: MoodVec; hint: string }> = {
  default: { label: 'DEFAULT', vec: { ...ZERO_MOOD }, hint: 'Neutral open eyes' },
  happy: { label: 'HAPPY', vec: { lt: 0, lb: 0.12, sl: 0, ar: 0.55, op: 0, cur: 0 }, hint: 'Cheeks raise lower lid into an arch' },
  tired: { label: 'TIRED', vec: { lt: 0.38, lb: 0, sl: -0.45, ar: 0, op: -0.05, cur: 0 }, hint: 'Heavy upper lids, outer corners droop' },
  angry: { label: 'ANGRY', vec: { lt: 0.15, lb: 0, sl: 0.85, ar: 0, op: 0, cur: 0 }, hint: 'Inner upper lids slant downward' },
  calm: { label: 'CALM', vec: { lt: 0.14, lb: 0.04, sl: 0, ar: 0.12, op: -0.06, cur: 0 }, hint: 'Relaxed, slightly lowered lids' },
  curious: { label: 'CURIOUS', vec: { lt: 0, lb: 0, sl: 0, ar: 0, op: 0.12, cur: 1 }, hint: 'Wide eyes, outer eye grows when looking aside' },
  attentive: { label: 'ATTENTIVE', vec: { lt: 0.08, lb: 0.03, sl: 0.18, ar: 0, op: 0, cur: 0.25 }, hint: 'Focused, gently narrowed' },
  reassuring: { label: 'REASSURING', vec: { lt: 0.08, lb: 0.1, sl: -0.15, ar: 0.35, op: -0.03, cur: 0 }, hint: 'Soft smile-eyes with relaxed brow' },
  surprised: { label: 'SURPRISED', vec: { lt: 0, lb: 0, sl: 0, ar: 0, op: 0.2, cur: 0.6 }, hint: 'Eyes wide open' },
  sad: { label: 'SAD', vec: { lt: 0.3, lb: 0.1, sl: -0.75, ar: 0, op: -0.05, cur: 0 }, hint: 'Droopy outer corners' },
  worried: { label: 'WORRIED', vec: { lt: 0.12, lb: 0, sl: -0.5, ar: 0, op: 0.08, cur: 0.2 }, hint: 'Raised inner brow, wide eyes' },
  irritated: { label: 'IRRITATED', vec: { lt: 0.35, lb: 0.14, sl: 0.5, ar: 0, op: -0.05, cur: 0 }, hint: 'Squinted, flat stare' },
  smug: { label: 'SMUG', vec: { lt: 0.3, lb: 0.1, sl: 0.1, ar: 0.25, op: -0.02, cur: 0 }, hint: 'Half-lidded confident look' },
  excited: { label: 'EXCITED', vec: { lt: 0, lb: 0.08, sl: 0, ar: 0.4, op: 0.12, cur: 0.5 }, hint: 'Bright and wide' },
  shy: { label: 'SHY', vec: { lt: 0.15, lb: 0.22, sl: -0.2, ar: 0.5, op: -0.05, cur: 0 }, hint: 'Soft, bashful eyes' },
  bored: { label: 'BORED', vec: { lt: 0.45, lb: 0, sl: 0, ar: 0, op: -0.08, cur: 0 }, hint: 'Heavy flat lids' },
  suspicious: { label: 'SUSPICIOUS', vec: { lt: 0.32, lb: 0.1, sl: 0.35, ar: 0, op: -0.04, cur: 0 }, hint: 'Narrowed, doubtful' },
  sleepy: { label: 'SLEEPY', vec: { lt: 0.55, lb: 0.05, sl: -0.2, ar: 0, op: -0.15, cur: 0 }, hint: 'Nearly closed, drowsy' },
};

export const isMoodId = (v: unknown): v is MoodId => typeof v === 'string' && (MOOD_IDS as readonly string[]).includes(v);

export function moodVec(id: MoodId, strengthPct: number): MoodVec {
  const s = Math.max(0, strengthPct) / 100;
  const v = MOODS[id].vec;
  return { lt: v.lt * s, lb: v.lb * s, sl: v.sl * s, ar: v.ar * s, op: v.op * s, cur: v.cur * s };
}

export function mixMood(a: MoodVec, b: MoodVec, t: number): MoodVec {
  const m = (x: number, y: number) => x + (y - x) * t;
  return { lt: m(a.lt, b.lt), lb: m(a.lb, b.lb), sl: m(a.sl, b.sl), ar: m(a.ar, b.ar), op: m(a.op, b.op), cur: m(a.cur, b.cur) };
}
