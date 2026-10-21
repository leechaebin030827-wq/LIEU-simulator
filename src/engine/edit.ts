/** Immutable edit helpers. All functions return NEW sequences; the evaluator input is never mutated. */
import type { Keyframe, LieuSequence, NumericTrack, Interpolation, Rgbw, RingFrame } from './types';
import { evalNumeric, sortedKeys } from './interp';
import { evalBaseFrame } from './evaluate';

let idCounter = 0;
export const uid = (p = 'k') => `${p}_${Date.now().toString(36)}_${(idCounter++).toString(36)}`;
export const clone = <T>(v: T): T => structuredClone(v);
const EPS = 1e-4;

export function upsertKey<T>(keys: readonly Keyframe<T>[], tSec: number, value: T, interp?: Interpolation, mkId = uid): Keyframe<T>[] {
  const out = keys.map((k) => ({ ...k }));
  const hit = out.find((k) => Math.abs(k.tSec - tSec) < EPS);
  if (hit) { hit.value = value; if (interp) hit.interpolationToNext = interp; }
  else out.push({ id: mkId(), tSec, value, interpolationToNext: interp ?? 'linear' });
  return sortedKeys(out);
}

/** Numeric track key upsert; first edit on an empty track also seeds a key at t=0 holding `seedValue`. */
export function setNumericKey(tr: NumericTrack, tSec: number, value: number, seedValue: number, interp: Interpolation = 'smoothstep'): NumericTrack {
  let keys = tr.keys;
  if (keys.length === 0 && Math.abs(tSec) > EPS) keys = upsertKey(keys, 0, seedValue, interp);
  return { kind: 'numeric', keys: upsertKey(keys, tSec, value, interp) };
}

export function removeKey<T>(keys: readonly Keyframe<T>[], id: string): Keyframe<T>[] { return keys.filter((k) => k.id !== id); }
export function moveKey<T>(keys: readonly Keyframe<T>[], id: string, tSec: number): Keyframe<T>[] {
  return sortedKeys(keys.map((k) => (k.id === id ? { ...k, tSec: Math.max(0, tSec) } : k)));
}

/** Path addressing a keyframe track inside a sequence. */
export type TrackPath =
  | { type: 'motion'; ch: 'railX' | 'yawY' | 'tiltZ' }
  | { type: 'ringBrightness' }
  | { type: 'ringBase' }
  | { type: 'eye'; side: 'left' | 'right' }
  | { type: 'eyeIntensity'; which: 'intensity' | 'leftIntensity' | 'rightIntensity' }
  | { type: 'projProp'; prop: string }
  | { type: 'pixelCh'; index: number; ch: 'r' | 'g' | 'b' | 'w' };

export const pathKey = (p: TrackPath) => JSON.stringify(p);

type AnyKeys = Keyframe<unknown>[];
export function getKeys(seq: LieuSequence, p: TrackPath): AnyKeys {
  const T = seq.tracks;
  switch (p.type) {
    case 'motion': return T.motion[p.ch].keys as AnyKeys;
    case 'ringBrightness': return T.ring24.brightness.keys as AnyKeys;
    case 'ringBase': return T.ring24.baseFrames.keys as AnyKeys;
    case 'eye': return T.eyes[p.side].keys as AnyKeys;
    case 'eyeIntensity': return (T.eyes[p.which]?.keys ?? []) as AnyKeys;
    case 'projProp': return ((T.projector.properties as Record<string, NumericTrack | undefined>)[p.prop]?.keys ?? []) as AnyKeys;
    case 'pixelCh': return (T.ring24.pixelChannelOverrides?.[String(p.index)]?.[p.ch]?.keys ?? []) as AnyKeys;
  }
}

/** Write a key list back (returns a cloned sequence). */
export function withKeys(seq: LieuSequence, p: TrackPath, keys: AnyKeys): LieuSequence {
  const s = clone(seq);
  const T = s.tracks;
  const num = (k: AnyKeys): NumericTrack => ({ kind: 'numeric', keys: k as Keyframe<number>[] });
  switch (p.type) {
    case 'motion': T.motion[p.ch] = num(keys); break;
    case 'ringBrightness': T.ring24.brightness = num(keys); break;
    case 'ringBase': T.ring24.baseFrames = { kind: 'rgbw24', keys: keys as Keyframe<RingFrame>[] }; break;
    case 'eye': T.eyes[p.side] = { kind: 'eyeBitmap', keys: keys as Keyframe<readonly number[]>[] }; break;
    case 'eyeIntensity': T.eyes[p.which] = num(keys); break;
    case 'projProp': (T.projector.properties as Record<string, NumericTrack>)[p.prop] = num(keys); break;
    case 'pixelCh': {
      const ov = (T.ring24.pixelChannelOverrides ??= {});
      (ov[String(p.index)] ??= {})[p.ch] = num(keys);
      break;
    }
  }
  return s;
}

/** Current value of a numeric path at t (evaluated, keyed or default). */
export function numericAt(seq: LieuSequence, p: TrackPath, t: number, fallback: number): number {
  return evalNumeric({ kind: 'numeric', keys: getKeys(seq, p) as Keyframe<number>[] }, t, fallback);
}

export function setNumeric(seq: LieuSequence, p: TrackPath, t: number, value: number, seed: number, interp: Interpolation = 'smoothstep'): LieuSequence {
  const cur = getKeys(seq, p) as Keyframe<number>[];
  const tr = setNumericKey({ kind: 'numeric', keys: cur }, t, value, seed, interp);
  return withKeys(seq, p, tr.keys);
}

/** Set one RGBW pixel (all channels) into the base frame track at time t. */
export function setRingPixels(seq: LieuSequence, t: number, edits: Record<number, Rgbw>): LieuSequence {
  const keys = seq.tracks.ring24.baseFrames.keys;
  const base = evalBaseFrame(seq, t);
  const next: RingFrame = base.map((p, i) => edits[i] ?? p);
  let ks = keys as Keyframe<RingFrame>[];
  if (ks.length === 0 && Math.abs(t) > EPS) ks = upsertKey(ks, 0, base, 'linear');
  return withKeys(seq, { type: 'ringBase' }, upsertKey(ks, t, next, 'linear'));
}

export function setEyeBitmap(seq: LieuSequence, side: 'left' | 'right', t: number, rows: readonly number[]): LieuSequence {
  const ks = seq.tracks.eyes[side].keys as Keyframe<readonly number[]>[];
  let k = ks;
  if (k.length === 0 && Math.abs(t) > EPS) k = upsertKey(k, 0, [0, 0, 0, 0, 0, 0, 0, 0], 'hold');
  return withKeys(seq, { type: 'eye', side }, upsertKey(k, t, rows, 'hold'));
}

export function setKeyInterp(seq: LieuSequence, p: TrackPath, id: string, interp: Interpolation): LieuSequence {
  return withKeys(seq, p, getKeys(seq, p).map((k) => (k.id === id ? { ...k, interpolationToNext: interp } : k)));
}

export function emptySequence(title = 'New sequence'): LieuSequence {
  const num = (): NumericTrack => ({ kind: 'numeric', keys: [] });
  return {
    schema: 'lieu.sequence/v1', id: uid('seq'), title, durationSec: 10, fps: 30, loop: false, demoPreviewOnly: true,
    tracks: {
      motion: { railX: num(), yawY: num(), tiltZ: num() },
      ring24: { baseFrames: { kind: 'rgbw24', keys: [] }, brightness: num(), effects: [] },
      eyes: { left: { kind: 'eyeBitmap', keys: [] }, right: { kind: 'eyeBitmap', keys: [] }, intensity: num() },
      projector: { clips: [], properties: { opacity: num(), brightness: num(), rotationDeg: num(), scale: num(), offsetXm: num(), offsetZm: num() } },
      audio: [], events: [],
    },
  };
}
