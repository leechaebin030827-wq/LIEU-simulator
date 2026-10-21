import type { LieuSequence } from './types';
import { PREVIEW_LIMITS, type MotionKey } from './rigDefaults';
import { evalNumeric } from './interp';

export type LimitWarning = { ch: MotionKey; kind: 'range' | 'velocity' | 'accel'; tSec: number; value: number; limit: number };

/** Samples a motion channel; flags PREVIEW-limit violations (NOT hardware limits - those are unknown). */
export function motionWarnings(seq: LieuSequence, stepSec = 1 / 30): LimitWarning[] {
  const out: LimitWarning[] = [];
  for (const ch of ['railX', 'yawY', 'tiltZ'] as MotionKey[]) {
    const tr = seq.tracks.motion[ch];
    if (!tr.keys.length) continue;
    const L = PREVIEW_LIMITS[ch];
    let pv = 0, pp = evalNumeric(tr, 0, 0), flaggedV = false, flaggedA = false, flaggedR = false;
    for (let t = stepSec; t <= seq.durationSec + 1e-9; t += stepSec) {
      const v = evalNumeric(tr, t, 0);
      const vel = (v - pp) / stepSec, acc = (vel - pv) / stepSec;
      if (!flaggedR && (v < L.range[0] - 1e-9 || v > L.range[1] + 1e-9)) { out.push({ ch, kind: 'range', tSec: t, value: v, limit: v < L.range[0] ? L.range[0] : L.range[1] }); flaggedR = true; }
      if (!flaggedV && Math.abs(vel) > L.maxVel) { out.push({ ch, kind: 'velocity', tSec: t, value: vel, limit: L.maxVel }); flaggedV = true; }
      if (!flaggedA && t > 2 * stepSec && Math.abs(acc) > L.maxAcc) { out.push({ ch, kind: 'accel', tSec: t, value: acc, limit: L.maxAcc }); flaggedA = true; }
      pv = vel; pp = v;
    }
  }
  return out;
}
