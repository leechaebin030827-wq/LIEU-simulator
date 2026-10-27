// Caps the yaw speed of scenarios:  npx vite-node tools/limit_yaw_speed.ts [maxDegPerSec=60] [scenario ids...]
// The yaw track is sampled at 30 fps, passed through a two-sided slew limiter (backward pass: starts moving early so it still arrives on time;
// forward pass: guarantees the cap), then written back as linear keys (collinear keys dropped). Only yawY changes. A backup of the previous
// file is kept as examples/_backup_<id>_before_yawcap.lieu.json. Re-running with the same cap changes nothing. (build_scenarios.py regenerates
// the unlimited yaw: run this tool after it.)
import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { evaluateSequenceAt } from '../src/engine/evaluate';
import { validateSequence } from '../src/engine/project';

const cap = Number(process.argv[2]) || 60;
const ids = process.argv.slice(3).length ? process.argv.slice(3) : ['01_boarding', '02_driving_a', '03_arrival', '04_driving_b', '05_web_cover', '07_bonus_aegyo'];

export function limitSlew(x: number[], vMax: number, fps: number): number[] {
  const step = vMax / fps, z = [...x];
  for (let i = z.length - 2; i >= 0; i--) z[i] = Math.min(z[i + 1] + step, Math.max(z[i + 1] - step, z[i]));
  const y = [...z];
  for (let i = 1; i < y.length; i++) y[i] = Math.min(y[i - 1] + step, Math.max(y[i - 1] - step, y[i]));
  return y;
}

/** Keep a key only where the line between its neighbours is off by more than tol degrees. */
function simplify(t: number[], v: number[], tol = 0.05): number[] {
  const keep = [0];
  let a = 0;
  for (let i = 2; i < t.length; i++) {
    const ok = (() => { for (let j = a + 1; j < i; j++) { const u = (t[j] - t[a]) / (t[i] - t[a]); if (Math.abs(v[a] + (v[i] - v[a]) * u - v[j]) > tol) return false; } return true; })();
    if (!ok) { keep.push(i - 1); a = i - 1; }
  }
  keep.push(t.length - 1);
  return keep;
}

for (const id of ids) {
  const file = `examples/${id}.lieu.json`;
  const raw = JSON.parse(readFileSync(file, 'utf8'));
  const seq = validateSequence(raw);
  const fps = seq.fps || 30, n = Math.floor(seq.durationSec * fps + 1e-6) + 1;
  const t = Array.from({ length: n }, (_, k) => k / fps), before = t.map((s) => evaluateSequenceAt(seq, s).motion.yawY);
  const after = limitSlew(before, cap, fps);
  const speed = (a: number[]) => Math.max(...a.slice(1).map((v, i) => Math.abs(v - a[i]) * fps));
  const maxErr = Math.max(...before.map((v, i) => Math.abs(v - after[i])));
  if (maxErr < 0.01) { console.log(`${id}: already within ${cap} deg/s (max ${speed(before).toFixed(0)}), unchanged`); continue; }
  const backup = `examples/_backup_${id}_before_yawcap.lieu.json`;
  if (!existsSync(backup)) copyFileSync(file, backup);
  const kept = simplify(t, after);
  raw.tracks.motion.yawY = { kind: 'numeric', keys: kept.map((i, j) => ({ id: `yaw_${j}`, tSec: Math.round(t[i] * 10000) / 10000, value: Math.round(after[i] * 1000) / 1000, interpolationToNext: 'linear' })) };
  raw.notes = `${raw.notes ?? ''} [요 속도 ${cap}°/s 이하로 제한됨 (tools/limit_yaw_speed.ts)]`.trim();
  const text = JSON.stringify(raw, null, 2);
  for (const dir of ['examples', 'public/examples']) writeFileSync(`${dir}/${id}.lieu.json`, text);
  console.log(`${id}: ${speed(before).toFixed(0)} -> ${speed(after).toFixed(0)} deg/s, max shift from original ${maxErr.toFixed(1)} deg, ${kept.length} yaw keys`);
}
