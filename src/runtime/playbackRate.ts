import type { LieuSequence } from '../engine/types';

/**
 * Final Exhibition boards passengers more gently, then returns to real time
 * once the authored drive-start cue is reached.
 */
export function playbackRateAt(seq: LieuSequence, tSec: number): number {
  if (seq.id !== '08_exhibition_final') return 1;
  const driveStart = seq.tracks.events.find((event) => event.type === 'drive_start')?.tSec ?? 14;
  return tSec < driveStart ? 0.8 : 1;
}

export function playbackRateBreaks(seq: LieuSequence): number[] {
  if (seq.id !== '08_exhibition_final') return [];
  return [seq.tracks.events.find((event) => event.type === 'drive_start')?.tSec ?? 14];
}

/** Wall-clock seconds elapsed when authored scenario time reaches tSec. */
export function elapsedAtScenarioTime(seq: LieuSequence, tSec: number): number {
  const end = Math.max(0, Math.min(seq.durationSec, tSec));
  const points = [0, ...playbackRateBreaks(seq).filter((t) => t > 0 && t < end), end];
  let elapsed = 0;
  for (let i = 1; i < points.length; i++) {
    const from = points[i - 1], to = points[i];
    elapsed += (to - from) / playbackRateAt(seq, from + 1e-6);
  }
  return elapsed;
}

/** Authored scenario time corresponding to wall-clock playback time. */
export function scenarioTimeAtElapsed(seq: LieuSequence, elapsedSec: number): number {
  let elapsed = Math.max(0, elapsedSec), from = 0;
  for (const to of [...playbackRateBreaks(seq), seq.durationSec]) {
    const rate = playbackRateAt(seq, from + 1e-6);
    const span = (to - from) / rate;
    if (elapsed <= span) return Math.min(seq.durationSec, from + elapsed * rate);
    elapsed -= span;
    from = to;
  }
  return seq.durationSec;
}
