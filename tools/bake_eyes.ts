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

/** 04_driving_b: "Hey LIEU" -> startled -> giggles -> heart eyes -> wink -> shy -> star-struck excitement -> sweet goodbye smile -> calm. */
const DRIVING_B: Seg[] = [
  { at: 0, blocks: [['mood-default', 3.0], ['mo-surprise', 1.0], ['mo-laugh', 2.6], ['mood-happy', 0.9], ['sym-heart', 3.0], ['mo-happyWink', 1.8], ['mo-shy', 3.0], ['mood-happy-soft', 1.2], ['sym-star', 3.0], ['mo-excited', 2.5], ['mo-gentleGreeting', 3.0], ['mood-happy-soft', 3.0], ['mood-default', 4.0]] },
];

/** 01_boarding: warm welcome -> greeting nod -> smiling, blinking look over the seats -> back to base, calm -> listens for the start button -> joyful bounce on press ->
 *  excited through the spin (the intensity track hides the eyes while the head swings) -> soft smile -> calm. Block lengths match the scenario's own beats (28.5 s). */
const BOARDING: Seg[] = [
  { at: 0, blocks: [['mood-happy-soft', 3.7], ['mo-gentleGreeting', 2.7],
    ['mood-happy-soft', 0.8], ['mo-doubleBlink', 0.64], ['mood-happy-soft', 1.2], ['mo-blink', 0.32], ['mood-happy-soft', 1.0], ['mo-doubleBlink', 0.64], ['mood-happy-soft', 0.8], ['mo-reassuringBlink', 0.8],
    ['mood-happy-soft', 1.6], ['mood-default', 2.4], ['mood-attentive', 1.4], ['mo-joyBounce', 1.4], ['mood-excited', 6.0], ['mood-happy-soft', 1.6], ['mood-default', 1.5]] },
];

/** 03_arrival: calm -> attentive ("almost there") -> curious, blinking look over the cabin -> smile + nod goodbye -> turns to the door side, glad to point -> reassuring blink -> calm (31 s). */
const ARRIVAL: Seg[] = [
  { at: 0, blocks: [['mood-default', 2.2], ['mood-attentive', 4.0],
    ['mood-curious', 1.0], ['mo-curiousInspection', 3.6], ['mo-blink', 0.32], ['mood-curious', 1.84], ['mo-doubleBlink', 0.64], ['mood-attentive', 0.4],
    ['mo-gentleGreeting', 3.2], ['mood-happy-soft', 1.6], ['mo-passengerAttention', 3.2], ['mood-happy-soft', 3.0],
    ['mo-reassuringBlink', 1.0], ['mood-default', 2.0], ['mood-default', 3.0]] },
];

function bake(segs: Seg[]) {
  const out: { t: number; l: number[]; r: number[] }[] = [];
  for (const g of segs) for (const k of bakeKeys(seq(g.blocks), 30)) out.push({ t: Math.round((g.at + k.tSec) * 1000) / 1000, l: [...k.pair.l], r: [...k.pair.r] });
  return out.sort((a, b) => a.t - b.t).filter((k, i, a) => i === 0 || k.t > a[i - 1].t);
}

for (const [name, segs] of [['01_boarding', BOARDING], ['02_driving_a', DRIVING_A], ['03_arrival', ARRIVAL], ['04_driving_b', DRIVING_B]] as const) {
  const keys = bake(segs as Seg[]);
  writeFileSync(`tools/baked_eyes/${name}.json`, JSON.stringify(keys));
  console.log(`${name}:`, keys.length, 'keys');
}
