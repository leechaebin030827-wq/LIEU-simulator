import { expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { validateSequence } from '../engine/project';
import { evaluateSequenceAt } from '../engine/evaluate';
import { motionToRawExact, FIRMWARE_MAX_RAW_PER_SEC, COMMISSIONED_MAX_RAW_PER_SEC2, SAFE_RAW } from '../runtime/hardwareMap';
import type { SafeAxis } from '../runtime/hardware';
import { playbackRateAt } from '../runtime/playbackRate';

const AXES: SafeAxis[] = ['yaw', 'tilt', 'body', 'rail'];
const SPEED_HEADROOM = 0.65;
const load = () => validateSequence(JSON.parse(readFileSync('examples/09_smooth_motion.lieu.json', 'utf8')));

it('09 smooth motion stays well inside the real motors\' speed and acceleration', () => {
  const seq = load();
  const h = 1 / 100;
  const at = (t: number) => motionToRawExact(evaluateSequenceAt(seq, Math.min(seq.durationSec, Math.max(0, t))).motion);
  const peakV = { yaw: 0, tilt: 0, body: 0, rail: 0 }, peakA = { yaw: 0, tilt: 0, body: 0, rail: 0 };
  const whereV = { ...peakV }, whereA = { ...peakA };
  for (let t = h; t < seq.durationSec - h; t += h) {
    const a = at(t - h), b = at(t), c = at(t + h);
    for (const axis of AXES) {
      const v = Math.abs(c[axis] - a[axis]) / (2 * h);
      const acc = Math.abs(c[axis] - 2 * b[axis] + a[axis]) / (h * h);
      if (v > peakV[axis]) { peakV[axis] = v; whereV[axis] = t; }
      if (acc > peakA[axis]) { peakA[axis] = acc; whereA[axis] = t; }
      expect(b[axis]).toBeGreaterThanOrEqual(SAFE_RAW[axis].min);
      expect(b[axis]).toBeLessThanOrEqual(SAFE_RAW[axis].max);
    }
  }
  for (const axis of AXES) {
    expect.soft(peakV[axis], `${axis} speed ${Math.round(peakV[axis])} raw/s at ${whereV[axis].toFixed(2)}s`)
      .toBeLessThanOrEqual(FIRMWARE_MAX_RAW_PER_SEC[axis] * SPEED_HEADROOM);
    expect.soft(peakA[axis], `${axis} accel ${Math.round(peakA[axis])} raw/s² at ${whereA[axis].toFixed(2)}s`)
      .toBeLessThanOrEqual(COMMISSIONED_MAX_RAW_PER_SEC2[axis]);
  }
});

it('08 never crawls the rail below 1 rpm or the tilt below its stick-slip speed', () => {
  const seq = validateSequence(JSON.parse(readFileSync('examples/08_exhibition_final.lieu.json', 'utf8')));
  const h = 1 / 100;
  const at = (t: number) => motionToRawExact(evaluateSequenceAt(seq, Math.min(seq.durationSec, Math.max(0, t))).motion);
  // [axis, below this raw/s is a crawl, still-motion floor, longest allowed crawl (the ends of a smooth start/stop)]
  const rules: [SafeAxis, number, number, number][] = [['rail', 4096 / 60, 3, 0.3], ['tilt', 28, 1, 0.35]];
  for (const [axis, crawl, still, longest] of rules) {
    let since = -1, worst = 0, worstAt = 0;
    for (let t = h; t < seq.durationSec - h; t += h) {
      const v = Math.abs(at(t + h)[axis] - at(t - h)[axis]) / (2 * h) * playbackRateAt(seq, t);
      if (v > still && v < crawl) { if (since < 0) since = t; if (t - since > worst) { worst = t - since; worstAt = since; } }
      else since = -1;
    }
    expect(worst, `${axis} crawls for ${worst.toFixed(2)}s from ${worstAt.toFixed(2)}s`).toBeLessThanOrEqual(longest);
  }
});

it('09 smooth motion loops back to its opening pose', () => {
  const seq = load();
  expect(evaluateSequenceAt(seq, seq.durationSec).motion).toEqual(evaluateSequenceAt(seq, 0).motion);
});
