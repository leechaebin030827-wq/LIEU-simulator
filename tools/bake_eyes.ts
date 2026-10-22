// Bakes eye-motion block sequences (src/eyestudio) into 8x8 bitmap keys for a scenario.
//   npx vite-node tools/bake_eyes.ts   ->  tools/baked_eyes/<scenario>.json  (read by tools/build_scenarios.py)
import { writeFileSync } from 'node:fs';
import { defaultSequence, newBlock, type Sequence } from '../src/eyestudio/assets';
import { bakeKeys } from '../src/eyestudio/bake';

type Seg = { at: number; blocks: [string, number][] };
const seq = (blocks: [string, number][]): Sequence => ({ ...defaultSequence(), blocks: blocks.map(([id, s]) => ({ ...newBlock(id), seconds: s })), blend: 450, shape: 'long' });

/** 02_driving_a: calm wait -> startled by the road work -> worried as it turns away (eyes are off 5.7-13.1 s while the head faces the monitor)
 *  -> thinking when it turns back -> reassuring while it explains the detour -> nod at the route -> relieved smile -> calm. */
const DRIVING_A: Seg[] = [
  { at: 0, blocks: [['mood-default', 4.0], ['mo-surprise', 1.3], ['mood-worried', 1.0]] },
  { at: 13.1, blocks: [['mo-thinking', 2.4], ['mood-attentive', 2.0], ['mood-reassuring', 4.7], ['mo-nod', 1.2], ['mood-attentive', 4.2], ['mood-happy-soft', 2.5], ['mood-default', 9.0]] },
];

function bake(segs: Seg[]) {
  const out: { t: number; l: number[]; r: number[] }[] = [];
  for (const g of segs) for (const k of bakeKeys(seq(g.blocks), 30)) out.push({ t: Math.round((g.at + k.tSec) * 1000) / 1000, l: [...k.pair.l], r: [...k.pair.r] });
  return out.sort((a, b) => a.t - b.t).filter((k, i, a) => i === 0 || k.t > a[i - 1].t);
}

const keys = bake(DRIVING_A);
writeFileSync('tools/baked_eyes/02_driving_a.json', JSON.stringify(keys));
console.log('02_driving_a:', keys.length, 'keys');
