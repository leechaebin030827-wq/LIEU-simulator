// Bakes the scenarios into hardware frames (eyes + 24-LED ring + motion) for the device player (hardware/pi).
//   npx vite-node tools/export_hw_frames.ts [scenario ids...]   ->  hardware/frames/<id>.hw.json
// Same evaluator as the simulator (evaluateSequenceAt), so the device plays exactly what the viewer shows.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { validateSequence } from '../src/engine/project';
import { evaluateSequenceAt } from '../src/engine/evaluate';

const IDS = ['01_boarding', '02_driving_a', '03_arrival', '04_driving_b', '05_web_cover'];
const ids = process.argv.slice(2).length ? process.argv.slice(2) : IDS;
const hex = (a: readonly number[]) => a.map((v) => (v & 255).toString(16).padStart(2, '0')).join('');
/** HT16K33 brightness 0..15 from a 0..1 intensity; below ~3 % the eye counts as off (rows are blanked). */
const bright = (i: number) => Math.round(Math.min(1, Math.max(0, i)) * 15);

mkdirSync('hardware/frames', { recursive: true });
for (const id of ids) {
  const seq = validateSequence(JSON.parse(readFileSync(`examples/${id}.lieu.json`, 'utf8')));
  const fps = seq.fps || 30;
  const n = Math.floor(seq.durationSec * fps + 1e-6) + 1;
  const keys: { t: number; l: string; r: string; bl: number; br: number; ring: string }[] = [];
  const motion: number[][] = [];
  let prev = '';
  for (let k = 0; k < n; k++) {
    const t = Math.min(seq.durationSec, k / fps);
    const s = evaluateSequenceAt(seq, t);
    const off = (i: number) => i < 0.03;
    const l = off(s.eyes.leftIntensity) ? new Array(8).fill(0) : [...s.eyes.left];
    const r = off(s.eyes.rightIntensity) ? new Array(8).fill(0) : [...s.eyes.right];
    const g = s.ring24.brightness;
    const ring = s.ring24.pixels.flatMap((p) => p.map((c) => Math.round(c * g)));
    const key = { t: Math.round(t * 1000) / 1000, l: hex(l), r: hex(r), bl: bright(s.eyes.leftIntensity), br: bright(s.eyes.rightIntensity), ring: hex(ring) };
    const sig = `${key.l}|${key.r}|${key.bl}|${key.br}|${key.ring}`;
    if (sig !== prev) { keys.push(key); prev = sig; }
    const m = s.motion;
    motion.push([+m.railX.toFixed(5), +m.yawY.toFixed(3), +m.tiltZ.toFixed(3)]);
  }
  const out = { schema: 'lieu.hwframes/v1', id, fps, durationSec: seq.durationSec, loop: seq.loop,
    notes: 'eyes: 8 rows hex (bit7 = virtual col0, as in the sequence); ring: 24 x RGBW hex, brightness already applied; motion: [railX m, yawY deg, tiltZ deg] per frame (not driven yet)',
    keys, motion };
  writeFileSync(`hardware/frames/${id}.hw.json`, JSON.stringify(out));
  console.log(id, `${keys.length} keys / ${n} frames`);
}
