// Shared type definitions for LIEU Eye Motion Studio.

export type Mode = 'matrix' | 'freeform';
export type Side = 'L' | 'R';

export const MOOD_IDS = [
  'default', 'happy', 'tired', 'angry', 'calm', 'curious', 'attentive', 'reassuring', 'sleepy',
  'surprised', 'sad', 'worried', 'irritated', 'smug', 'excited', 'shy', 'bored', 'suspicious',
] as const;
export type MoodId = (typeof MOOD_IDS)[number];

export const EASE_TYPES = ['linear', 'easeIn', 'easeOut', 'easeInOut', 'spring', 'step', 'bezier'] as const;
export type EaseType = (typeof EASE_TYPES)[number];

export interface Ease {
  type: EaseType;
  /** cubic-bezier control points, used when type === 'bezier' */
  bezier?: [number, number, number, number];
}

/** 8 strings of 8 chars ('0' / '1'), row 0 = top, char 0 = left column. */
export type Pattern = string[];
export interface PatternPair { left: Pattern; right: Pattern }

// ---------------------------------------------------------------- params

export interface SharedParams {
  mood: MoodId;
  moodStrength: number; // 0..100
  gazeX: number; // -1..1
  gazeY: number; // -1..1 (down positive)
  openness: number; // 0..1
  attentionTarget: string;
  shapeSX: number;
  shapeSY: number;
  shapeRound: number;
  shapeTilt: number;
  motionIntensity: number;
  motionSpeed: number;
  motionEase: EaseType;
  autoBlink: boolean;
  blinkInterval: number; // seconds
  blinkVariation: number; // 0..1
  blinkSpeed: number;
  blinkStrength: number;
  eyelidCloseSpeed: number;
  eyelidOpenSpeed: number;
  idle: boolean;
  idleSpeed: number;
  microSaccade: number;
  curiosity: number;
  flickerH: number;
  flickerV: number;
  seed: number;
}

export interface MatrixGeometry {
  leftW: number;
  rightW: number;
  eyeH: number;
  posX: number;
  posY: number;
  offsetL: number;
  offsetR: number;
  upperLid: number;
  lowerLid: number;
  corner: number; // 0..2
  asymmetry: number; // right eye height delta in rows
  brightness: number; // 0..1 preview brightness metadata
  holdMs: number;
  usePattern: boolean;
  /** user-designed default eye (bounding box is used as the base shape; lids/moods still apply) */
  customL?: Pattern | null;
  customR?: Pattern | null;
  editorLeft: Pattern;
  editorRight: Pattern;
}

export interface MatrixPhysical {
  moduleW: number; // mm
  moduleH: number;
  gap: number;
  pitchX: number;
  pitchY: number;
  ledDia: number;
  ledShape: 'round' | 'square';
  orientationL: 0 | 90 | 180 | 270;
  orientationR: 0 | 90 | 180 | 270;
  ledColor: string;
  glow?: number; // light bloom multiplier (1 = default)
  frameVisible: boolean;
  gridVisible: boolean;
  dimensions: boolean;
}

export type DriverType = 'ht16k33' | 'max7219' | 'raw';
export interface ModuleMapping {
  deviceIndex: number;
  address: string; // e.g. "0x70" (I2C) – informational until confirmed
  rotation: 0 | 90 | 180 | 270;
  mirrorX: boolean;
  mirrorY: boolean;
  rowMap: number[]; // logical row -> physical row
  colMap: number[]; // logical col -> physical col
}
export interface HardwareConfig {
  driver: DriverType;
  bitOrder: 'msbFirst' | 'lsbFirst'; // bit 7 = physical column 0 (msbFirst) or bit 0 (lsbFirst)
  swapModules: boolean;
  left: ModuleMapping;
  right: ModuleMapping;
}

export interface FreeformGeometry {
  widthL: number;
  widthR: number;
  heightL: number;
  heightR: number;
  cornerRadius: number; // 0..1
  /** true = outline is a stadium (straight sides, fully round semicircle caps) at the width:height ratio, instead of a superellipse */
  pill?: boolean;
  spacing: number;
  rotation: number; // deg
  posX: number;
  posY: number;
  scale: number;
  squash: number;
  stretch: number;
  tilt: number;
  asymmetry: number;
  upperLid: number;
  lowerLid: number;
  curvature: number;
  morphIntensity: number;
  gazeRange: number;
  gazeSpeed: number;
  springOvershoot: number;
  eyeColor: string;
  glow: number;
  offsetsL: number[]; // 2 * CONTROL_POINTS
  offsetsR: number[];
}

export interface MotionSettings {
  duration: number; // ms for one iteration
  speed: number;
  intensity: number;
  loop: boolean;
  loopCount: number;
  easing: EaseType;
  transition: number; // ms
}

// -------------------------------------------------------------- timeline

export interface KeyBase { id: string; t: number }
export interface NumKey extends KeyBase { v: number; ease: Ease }
export interface MoodKey extends KeyBase { mood: MoodId; strength: number; ease: Ease }
export interface ShapeKey extends KeyBase { sx: number; sy: number; round: number; tilt: number; ease: Ease }
export type BlinkKind = 'blink' | 'double' | 'winkL' | 'winkR' | 'slow';
export interface BlinkEvent extends KeyBase { kind: BlinkKind; duration: number; strength: number }
export interface MotionEvent extends KeyBase {
  motionId: string;
  duration: number;
  speed: number;
  intensity: number;
  loop: boolean;
  loopCount: number;
  easing: EaseType;
  transition: number;
  dirX: number;
  dirY: number;
}
export interface SymbolEvent extends KeyBase { symbol: string; duration: number; fade: number }
export interface PixelKey extends KeyBase { left: Pattern; right: Pattern }
export interface MorphKey extends KeyBase { L: number[]; R: number[]; ease: Ease }

export interface Tracks {
  mood: MoodKey[];
  gazeX: NumKey[];
  gazeY: NumKey[];
  openness: NumKey[];
  shape: ShapeKey[];
  blinks: BlinkEvent[];
  motions: MotionEvent[];
  pixel: PixelKey[];
  morph: MorphKey[];
  symbols: SymbolEvent[];
}
export type TrackName = keyof Tracks;

export interface Timeline {
  duration: number; // ms
  loop: boolean;
  tracks: Tracks;
}

export interface Scenario { id: string; name: string; description?: string; timeline: Timeline }

export interface Project {
  /** studio-only render variant: eyes drawn as halftone dots (uses the freeform geometry) */
  variant?: 'halftone' | 'halftoneGrid';
  version: 1;
  name: string;
  mode: Mode;
  shared: SharedParams;
  motions: Record<string, MotionSettings>;
  matrix: { geometry: MatrixGeometry; physical: MatrixPhysical; hardware: HardwareConfig };
  freeform: { geometry: FreeformGeometry };
  timeline: Timeline;
  scenarios: Scenario[];
}

// -------------------------------------------------------------- frames

export interface MoodVec {
  lt: number; // upper lid coverage
  lb: number; // lower lid coverage
  sl: number; // slant: + inner lid down (angry), - outer lid down (tired)
  ar: number; // lower-lid arch (happy)
  op: number; // openness delta
  cur: number; // curiosity
}

/** Mode-independent semantic eye state produced by the EyeController. */
export interface EyeFrame {
  t: number;
  mode: Mode;
  gazeX: number;
  gazeY: number;
  openness: number;
  closureL: number;
  closureR: number;
  mood: MoodVec;
  moodLabel: string;
  shape: { sx: number; sy: number; round: number; tilt: number };
  curiosity: number;
  flickerX: number;
  flickerY: number;
  pattern?: PatternPair; // pixel-track output (consumed by Matrix only)
  morph?: { L: number[]; R: number[] }; // morph-track output (consumed by Freeform only)
  /** emoji-style eye currently shown (w = 0..1 cross-fade weight) */
  symbol?: { id: string; w: number };
  activeMotions: string[];
  autoBlinking: boolean;
  /** values after tracks / static params but before motion & idle layers */
  base: { gazeX: number; gazeY: number; openness: number; mood: MoodId; moodStrength: number; shape: { sx: number; sy: number; round: number; tilt: number } };
}

export interface MatrixFrame {
  timestamp: number;
  left: boolean[][];
  right: boolean[][];
  brightness: number;
  ledCount: number;
  source: 'eye' | 'pattern' | 'test';
}
