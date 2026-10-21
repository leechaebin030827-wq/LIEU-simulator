import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { evaluateSequenceAt, cuesCrossed } from '../engine/evaluate';
import { emptySequence, setNumeric, setRingPixels, setEyeBitmap } from '../engine/edit';
import { EYE_PRESETS } from '../engine/eyePresets';
import { migrate, validateSequence, serializeProject, UNKNOWN_CALIBRATION, buildZip, readZip } from '../engine/project';
import { computeStageMatrices } from '../engine/rig';
import { defaultRig } from '../engine/rigDefaults';
import { motionWarnings } from '../engine/limits';
import type { LieuSequence } from '../engine/types';

const ex = (f: string) => JSON.parse(readFileSync(`examples/${f}`, 'utf8'));
const examples = readdirSync('examples').filter((f) => f.endsWith('.lieu.json'));

describe('evaluateSequenceAt', () => {
  it('is history independent (seek determinism) for all examples', () => {
    for (const f of examples) {
      const seq = validateSequence(ex(f));
      const times = [0, 1.37, 3, 4.2, 7.77, 9, seq.durationSec];
      const first = times.map((t) => JSON.stringify(evaluateSequenceAt(seq, t)));
      // evaluate in scrambled order, then again
      for (const t of [...times].reverse()) evaluateSequenceAt(seq, t);
      const again = times.map((t) => JSON.stringify(evaluateSequenceAt(seq, t)));
      expect(again).toEqual(first);
    }
  });
  it('sparkle is deterministic from seed (no Math.random)', () => {
    const seq = emptySequence();
    seq.tracks.ring24.effects.push({ id: 'e', type: 'sparkle', fromSec: 0, toSec: 5, seed: 7, priority: 0, blend: 'max', params: { whiteLevel: 200, density: 0.5 } });
    const a = evaluateSequenceAt(seq, 2.31).ring24.pixels, b = evaluateSequenceAt(seq, 2.31).ring24.pixels;
    expect(a).toEqual(b);
    expect(a.some((p) => p[3] > 0)).toBe(true);
  });
  it('does not mutate its input', () => {
    const seq = validateSequence(ex(examples[0]));
    const snap = JSON.stringify(seq);
    evaluateSequenceAt(seq, 4);
    expect(JSON.stringify(seq)).toBe(snap);
  });
  it('mandatory demo @3s: LED7 W=255, left eye smile, tilt +5, projector welcome.svg', () => {
    let s: LieuSequence = emptySequence();
    s = setRingPixels(s, 3, { 7: [0, 0, 0, 255] });
    s = setEyeBitmap(s, 'left', 3, EYE_PRESETS.smile);
    s = setNumeric(s, { type: 'motion', ch: 'tiltZ' }, 3, 5, 0);
    s.tracks.projector.clips.push({ id: 'p', fromSec: 3, toSec: 6, assetId: 'media/welcome.svg', visible: true });
    for (const t of [3, 0, 3]) {
      const st = evaluateSequenceAt(s, t === 0 ? 3 : t);
      expect(st.ring24.pixels[7][3]).toBe(255);
      expect(st.ring24.pixels.filter((_, i) => i !== 7).every((p) => p[3] === 0)).toBe(true);
      expect(st.eyes.left).toEqual(EYE_PRESETS.smile);
      expect(st.motion.tiltZ).toBeCloseTo(5);
      expect(st.projector.activeClips[0].assetId).toBe('media/welcome.svg');
    }
    expect(evaluateSequenceAt(s, 0).motion.tiltZ).toBeCloseTo(0);
    expect(evaluateSequenceAt(s, 0).ring24.pixels[7][3]).toBe(0);
  });
  it('right eye independent; all 24 LEDs keep RGBW', () => {
    let s = emptySequence();
    const edits: Record<number, [number, number, number, number]> = {};
    for (let i = 0; i < 24; i++) edits[i] = [i * 10, 255 - i, i, 255 - i * 10 > 0 ? 255 - i * 10 : 0];
    s = setRingPixels(s, 0, edits);
    const st = evaluateSequenceAt(s, 0);
    for (let i = 0; i < 24; i++) expect(st.ring24.pixels[i]).toEqual(edits[i]);
    s = setEyeBitmap(s, 'right', 0, EYE_PRESETS.full);
    const e = evaluateSequenceAt(s, 0).eyes;
    expect(e.right).toEqual(EYE_PRESETS.full); expect(e.left).toEqual(EYE_PRESETS.off);
  });
  it('events fire only for crossed interval', () => {
    const seq = validateSequence(ex(examples[0]));
    expect(cuesCrossed(seq, 0, 1).map((c) => c.type)).toEqual(['vehicle_arrived']);
    expect(cuesCrossed(seq, 2, 2.5)).toEqual([]);
  });
});

describe('project IO', () => {
  it('round-trips JSON and zip, preserving unknown calibration', () => {
    const seq = validateSequence(ex(examples[1]));
    const proj = { schema: 'lieu.project/v1' as const, sequence: seq, rig: defaultRig(), assets: [{ assetId: 'up1', filename: 'a.wav', mime: 'audio/wav' }], calibrationStatus: UNKNOWN_CALIBRATION };
    const back: any = migrate(JSON.parse(serializeProject(proj)));
    expect(back.sequence).toEqual(seq);
    expect(back.calibrationStatus.unknowns.eyeLeftI2cAddress).toBeNull();
    const z = readZip(buildZip(proj, { up1: new Uint8Array([1, 2, 3]) }));
    expect(z.project.sequence).toEqual(seq);
    expect(Array.from(z.blobs['up1'])).toEqual([1, 2, 3]);
  });
  it('accepts every bare example and rejects bad schema', () => {
    for (const f of examples) expect(() => migrate(ex(f))).not.toThrow();
    expect(() => migrate({ schema: 'x' })).toThrow();
  });
});

describe('rig', () => {
  it('is recomputed from rest every call (no accumulation) and rail stays fixed', () => {
    const rig = defaultRig();
    expect(rig.owner[143]).toBe('fixedRail');
    const a = computeStageMatrices({ railX: -0.1, yawY: 30, tiltZ: 5 }, rig);
    computeStageMatrices({ railX: 0.2, yawY: -20, tiltZ: 9 }, rig);
    const b = computeStageMatrices({ railX: -0.1, yawY: 30, tiltZ: 5 }, rig);
    expect(a.tilt.elements).toEqual(b.tilt.elements);
    expect(a.fixedRail.elements).toEqual(computeStageMatrices({ railX: 0, yawY: 0, tiltZ: 0 }, rig).fixedRail.elements);
  });
  it('every config mesh node has exactly one owner', () => {
    const rig = defaultRig();
    expect(Object.keys(rig.owner).length).toBe(61);
  });
  it('flags preview-limit violations', () => {
    let s = emptySequence();
    s = setNumeric(s, { type: 'motion', ch: 'yawY' }, 0, 0, 0);
    s = setNumeric(s, { type: 'motion', ch: 'yawY' }, 0.5, 90, 0);
    expect(motionWarnings(s).some((w) => w.ch === 'yawY')).toBe(true);
  });
});

describe('tilt limit', () => {
  it('clamps tilt to +/-15 deg even if keys exceed it', () => {
    let s = emptySequence();
    s = setNumeric(s, { type: 'motion', ch: 'tiltZ' }, 0, 40, 0);
    s = setNumeric(s, { type: 'motion', ch: 'tiltZ' }, 2, -40, 0);
    expect(evaluateSequenceAt(s, 0).motion.tiltZ).toBe(15);
    expect(evaluateSequenceAt(s, 2).motion.tiltZ).toBe(-15);
  });
});
