import type { AudioClip, Cue, DesiredState, EyeRows8, LieuSequence, ProjectorClip, Rgbw, RingFrame } from './types';
import { BLACK, LED_COUNT } from './types';
import { clamp, evalHold, evalNumeric, evalRingFrame } from './interp';
import { blendInto, effectPixel, resolveParams } from './effects';
import { TILT_LIMIT_DEG } from './rigDefaults';

const EMPTY_EYE: EyeRows8 = [0, 0, 0, 0, 0, 0, 0, 0];
const DARK_FRAME: RingFrame = Array.from({ length: LED_COUNT }, () => BLACK);

/** Base frames interpolated only (no overrides / effects). Used by editors to key edits. */
export function evalBaseFrame(seq: LieuSequence, t: number): RingFrame {
  return evalRingFrame(seq.tracks.ring24.baseFrames.keys, t) ?? DARK_FRAME;
}

/**
 * PURE. Same (sequence, tSec) -> same DesiredState regardless of history.
 * No Math.random, no Date, no I/O. Events/audio scheduling live outside.
 */
export function evaluateSequenceAt(seq: LieuSequence, tSec: number): DesiredState {
  const t = tSec;
  const { motion, ring24, eyes, projector, audio } = seq.tracks;

  // --- Ring: base -> per-pixel channel overrides -> effects (priority asc) -> clamp
  const base = evalBaseFrame(seq, t);
  const px: number[][] = base.map((p) => [p[0], p[1], p[2], p[3]]);
  const ov = ring24.pixelChannelOverrides;
  if (ov) {
    for (const [key, ch] of Object.entries(ov)) {
      const i = Number(key);
      if (!(i >= 0 && i < LED_COUNT)) continue;
      (['r', 'g', 'b', 'w'] as const).forEach((c, ci) => {
        const tr = ch[c];
        if (tr && tr.keys.length) px[i][ci] = evalNumeric(tr, t, px[i][ci]);
      });
    }
  }
  const effects = ring24.effects
    .map((e, idx) => ({ e, idx }))
    .filter(({ e }) => t >= e.fromSec && t < e.toSec)
    .sort((a, b) => a.e.priority - b.e.priority || a.idx - b.idx);
  for (const { e } of effects) {
    const params = resolveParams(e, t);
    const rel = t - e.fromSec;
    for (let i = 0; i < LED_COUNT; i++) blendInto(px[i], effectPixel(e, params, rel, i), e.blend);
  }
  const pixels: RingFrame = px.map((p) => [0, 1, 2, 3].map((c) => clamp(Math.round(p[c]), 0, 255)) as unknown as Rgbw);

  // --- Eyes (hold)
  const left = evalHold(eyes.left.keys, t) ?? EMPTY_EYE;
  const right = evalHold(eyes.right.keys, t) ?? EMPTY_EYE;
  const shared = clamp(evalNumeric(eyes.intensity, t, 1), 0, 1);
  const leftIntensity = eyes.leftIntensity?.keys.length ? clamp(evalNumeric(eyes.leftIntensity, t, shared), 0, 1) : shared;
  const rightIntensity = eyes.rightIntensity?.keys.length ? clamp(evalNumeric(eyes.rightIntensity, t, shared), 0, 1) : shared;

  // --- Projector
  const pp = projector.properties;
  const activeClips: ProjectorClip[] = projector.clips.filter((c) => c.visible && t >= c.fromSec && t < c.toSec);
  const extra: Record<string, number> = {};
  for (const k of ['opticalOriginXm', 'opticalOriginYm', 'opticalOriginZm', 'opticalAimYawDeg', 'opticalAimPitchDeg',
    'floorHeightYm', 'projectedWidthM', 'focusBlur', 'keystoneTop', 'keystoneBottom'] as const) {
    const tr = pp[k];
    if (tr && tr.keys.length) extra[k] = evalNumeric(tr, t, 0);
  }

  const activeAudio: AudioClip[] = audio.filter((c) => t >= c.fromSec && t < c.toSec);

  return {
    tSec: t,
    motion: {
      railX: evalNumeric(motion.railX, t, 0),
      yawY: evalNumeric(motion.yawY, t, 0),
      tiltZ: clamp(evalNumeric(motion.tiltZ, t, 0), -TILT_LIMIT_DEG, TILT_LIMIT_DEG),
      ...(motion.liftY?.keys.length ? { liftY: evalNumeric(motion.liftY, t, 0) } : {}),
    },
    ring24: { pixels, brightness: clamp(evalNumeric(ring24.brightness, t, 1), 0, 1) },
    eyes: { left, right, intensity: shared, leftIntensity, rightIntensity },
    projector: {
      activeClips,
      opacity: clamp(evalNumeric(pp.opacity, t, 1), 0, 1),
      brightness: Math.max(0, evalNumeric(pp.brightness, t, 1)),
      rotationDeg: evalNumeric(pp.rotationDeg, t, 0),
      scale: Math.max(0.01, evalNumeric(pp.scale, t, 1)),
      offsetXm: evalNumeric(pp.offsetXm, t, 0),
      offsetZm: evalNumeric(pp.offsetZm, t, 0),
      extraProperties: extra,
    },
    activeAudio,
  };
}

/** Audio gain of a clip at absolute time t (fades + gainTrack). Pure. */
export function audioGainAt(c: AudioClip, t: number): number {
  const rel = t - c.fromSec, left = c.toSec - t;
  let g = c.gain;
  if (c.gainTrack?.keys.length) g *= evalNumeric(c.gainTrack, t, 1);
  if (c.fadeInSec > 0) g *= clamp(rel / c.fadeInSec, 0, 1);
  if (c.fadeOutSec > 0) g *= clamp(left / c.fadeOutSec, 0, 1);
  return Math.max(0, g);
}

/** Cues in the half-open interval (prev, cur]; handles loop wrap when cur < prev. */
export function cuesCrossed(seq: LieuSequence, prev: number, cur: number): Cue[] {
  const ev = seq.tracks.events;
  if (cur >= prev) return ev.filter((c) => c.tSec > prev && c.tSec <= cur);
  return ev.filter((c) => c.tSec > prev || c.tSec <= cur);
}
