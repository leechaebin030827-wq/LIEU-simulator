/**
 * LIEU Sequence Editor: TypeScript DATA CONTRACT, not a complete runtime.
 * v1 preview-only schema. GLB and physical hardware calibration are stored separately.
 * Optional fields allow richer keyframe controls without breaking 3 sample sequences.
 */
export type Interpolation = 'hold' | 'linear' | 'smoothstep';
export type Keyframe<T> = {
  id: string;
  tSec: number;
  value: T;
  interpolationToNext?: Interpolation;
};
export type NumericTrack = { kind: 'numeric'; keys: Keyframe<number>[] };
export type Rgbw = readonly [number, number, number, number]; // R,G,B,W bytes 0..255, independent white
export type RingFrame = Rgbw[]; // exactly 24; immutable inside the pure evaluator
export type RingTrack = { kind: 'rgbw24'; keys: Keyframe<RingFrame>[] };
export type EyeRows8 = readonly number[]; // 8 rows, each 0..255, bit7 = virtual screen col0
export type EyeTrack = { kind: 'eyeBitmap'; keys: Keyframe<EyeRows8>[] };
export type EffectName = 'solid' | 'breathe' | 'chase' | 'wave' | 'sparkle' | 'pulse' | 'gradient' | 'progress';
export type LedBlend = 'replace' | 'add' | 'max';
export type EffectClip = {
  id: string;
  type: EffectName;
  fromSec: number;
  toSec: number;
  seed: number; // deterministic time-indexed animation, NEVER Math.random() during playback
  priority: number;
  blend: LedBlend;
  params: Record<string, number | string | boolean | number[]>;
  /** Optionally keyframe effect parameters (speed, width, phase, whiteLevel...). */
  parameterTracks?: Record<string, NumericTrack>;
};
export type RingPixelChannels = {
  r?: NumericTrack;
  g?: NumericTrack;
  b?: NumericTrack;
  w?: NumericTrack;
};
export type ProjectorClip = {
  id: string;
  fromSec: number;
  toSec: number;
  assetId: string;
  visible: boolean;
  mediaOffsetSec?: number;
  loopMedia?: boolean;
};
export type AudioClip = {
  id: string;
  fromSec: number;
  toSec: number;
  assetId: string;
  mediaOffsetSec: number;
  gain: number;
  fadeInSec: number;
  fadeOutSec: number;
  loop: boolean;
  gainTrack?: NumericTrack;
  panTrack?: NumericTrack;
};
export type Cue = {
  id: string;
  tSec: number;
  type: string;
  payload: Record<string, unknown>;
};
export type ProjectorPropertyTracks = {
  opacity: NumericTrack;
  brightness: NumericTrack;
  rotationDeg: NumericTrack;
  scale: NumericTrack;
  offsetXm: NumericTrack;
  offsetZm: NumericTrack;
  // Calibration defaults remain in rig config; these optional tracks are PREVIEW authoring overrides.
  opticalOriginXm?: NumericTrack;
  opticalOriginYm?: NumericTrack;
  opticalOriginZm?: NumericTrack;
  opticalAimYawDeg?: NumericTrack;
  opticalAimPitchDeg?: NumericTrack;
  floorHeightYm?: NumericTrack;
  projectedWidthM?: NumericTrack;
  focusBlur?: NumericTrack;
  keystoneTop?: NumericTrack;
  keystoneBottom?: NumericTrack;
};
export type LieuSequence = {
  schema: 'lieu.sequence/v1';
  id: string;
  title: string;
  durationSec: number;
  fps: number;
  loop: boolean;
  demoPreviewOnly?: boolean;
  notes?: string;
  tracks: {
    motion: { railX: NumericTrack; yawY: NumericTrack; tiltZ: NumericTrack };
    ring24: {
      baseFrames: RingTrack;
      brightness: NumericTrack;
      effects: EffectClip[];
      /** Explicit per-pixel overrides take precedence over baseFrame, before effect layer. */
      pixelChannelOverrides?: Record<string, RingPixelChannels>; // virtual LED index keys '0'..'23'
    };
    eyes: {
      left: EyeTrack;
      right: EyeTrack;
      intensity: NumericTrack;
      /** When present, left/right intensity overrides shared intensity individually. */
      leftIntensity?: NumericTrack;
      rightIntensity?: NumericTrack;
    };
    projector: { clips: ProjectorClip[]; properties: ProjectorPropertyTracks };
    audio: AudioClip[];
    events: Cue[];
  };
};
export type DesiredState = {
  tSec: number;
  motion: { railX: number; yawY: number; tiltZ: number };
  ring24: { pixels: RingFrame; brightness: number };
  eyes: {
    left: EyeRows8;
    right: EyeRows8;
    intensity: number;
    leftIntensity: number;
    rightIntensity: number;
  };
  projector: {
    activeClips: ProjectorClip[];
    opacity: number;
    brightness: number;
    rotationDeg: number;
    scale: number;
    offsetXm: number;
    offsetZm: number;
    /** Optional evaluated projection/origin/aim/size properties included by renderer. */
    extraProperties?: Record<string, number>;
  };
  activeAudio: AudioClip[];
};
export type PhysicalMotionCalibration = {
  controller: string | null;
  model: string | null;
  min: number | null;
  max: number | null;
  maxSpeed: number | null;
  maxAccel: number | null;
  maxJerk: number | null;
  home: number | null;
  gearRatio: number | null;
  invert: boolean | null;
};
