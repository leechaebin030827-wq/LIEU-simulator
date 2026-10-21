import type { EyeRows8 } from './types';

/** bit7 = virtual screen column 0 (left). Rows top->bottom. Presets are only starting points. */
const r = (...rows: string[]): EyeRows8 => rows.map((s) => parseInt(s.replace(/\./g, '0').replace(/#/g, '1'), 2));

export const EYE_PRESETS: Record<string, EyeRows8> = {
  off: r('........', '........', '........', '........', '........', '........', '........', '........'),
  neutral: r('........', '...###..', '...###..', '...###..', '...###..', '...###..', '...###..', '........'),
  blink: r('........', '........', '........', '.######.', '.######.', '........', '........', '........'),
  smile: r('........', '........', '..####..', '.##..##.', '.#....#.', '........', '........', '........'),
  surprise: r('..####..', '.######.', '##....##', '##....##', '##....##', '##....##', '.######.', '..####..'),
  look_left: r('........', '..####..', '.##..##.', '.#....#.', '.##..##.', '..####..', '........', '........'),
  look_right: r('........', '..####..', '.##..##.', '.#....#.', '.##..##.', '..####..', '........', '........'),
  heart: r('........', '.##..##.', '########', '########', '.######.', '..####..', '...##...', '........'),
  full: r('########', '########', '########', '########', '########', '########', '########', '########'),
};
// Pupil-shifted looks (computed from neutral eye outline)
EYE_PRESETS.look_left = r('........', '..####..', '.##..###', '.#....##', '.##..###', '..####..', '........', '........').map((v) => v);
EYE_PRESETS.look_right = r('........', '..####..', '###..##.', '##....#.', '###..##.', '..####..', '........', '........');

export const getBit = (rows: readonly number[], row: number, col: number) => ((rows[row] >> (7 - col)) & 1) === 1;
export function setBit(rows: readonly number[], row: number, col: number, on: boolean): number[] {
  const out = [...rows];
  const m = 1 << (7 - col);
  out[row] = on ? out[row] | m : out[row] & ~m & 0xff;
  return out;
}
export const invertRows = (rows: readonly number[]) => rows.map((v) => ~v & 0xff);
export const mirrorRows = (rows: readonly number[]) => rows.map((v) => { let o = 0; for (let b = 0; b < 8; b++) if (v & (1 << b)) o |= 1 << (7 - b); return o; });
