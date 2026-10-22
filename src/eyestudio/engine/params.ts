import type {
  FreeformGeometry, HardwareConfig, MatrixGeometry, MatrixPhysical, ModuleMapping, Project, SharedParams, Timeline,
} from './types';
import { emptyPattern } from './patterns';

export interface ParamSpec {
  key: string;
  label: string;
  min: number;
  max: number;
  step: number;
  def: number;
  unit?: string;
  hint?: string;
}

export const CONTROL_POINTS = 12;

const S = (key: string, label: string, min: number, max: number, step: number, def: number, unit?: string, hint?: string): ParamSpec =>
  ({ key, label, min, max, step, def, unit, hint });

// ------------------------------------------------------------------ shared

export const SHARED_SPECS: Record<string, ParamSpec[]> = {
  Expression: [
    S('moodStrength', 'Mood Strength', 0, 100, 1, 100, '%'),
    S('openness', 'Eye Openness', 0, 1, 0.01, 1),
    S('shapeSX', 'Shape Scale X', 0.5, 1.5, 0.01, 1),
    S('shapeSY', 'Shape Scale Y', 0.5, 1.5, 0.01, 1),
    S('shapeRound', 'Roundness Offset', -1, 1, 0.01, 0),
    S('shapeTilt', 'Shape Tilt', -1, 1, 0.01, 0),
    S('curiosity', 'Curiosity Intensity', 0, 1, 0.01, 0),
  ],
  Gaze: [
    S('gazeX', 'Gaze X', -1, 1, 0.01, 0),
    S('gazeY', 'Gaze Y', -1, 1, 0.01, 0),
  ],
  Blink: [
    S('blinkInterval', 'Blink Interval', 1, 12, 0.1, 4, 's'),
    S('blinkVariation', 'Blink Variation', 0, 1, 0.01, 0.4),
    S('blinkSpeed', 'Blink Speed', 0.25, 3, 0.01, 1, '×'),
    S('blinkStrength', 'Blink Strength', 0, 1, 0.01, 1),
    S('eyelidCloseSpeed', 'Eyelid Closing Speed', 0.25, 3, 0.01, 1, '×'),
    S('eyelidOpenSpeed', 'Eyelid Opening Speed', 0.25, 3, 0.01, 1, '×'),
  ],
  Idle: [
    S('idleSpeed', 'Idle Movement Speed', 0, 3, 0.01, 1, '×'),
    S('microSaccade', 'Micro-Saccade', 0, 1, 0.01, 0.3),
    S('flickerH', 'Horizontal Flicker', 0, 1, 0.01, 0),
    S('flickerV', 'Vertical Flicker', 0, 1, 0.01, 0),
  ],
  Motion: [
    S('motionIntensity', 'Motion Intensity', 0, 2, 0.01, 1),
    S('motionSpeed', 'Motion Speed', 0.25, 3, 0.01, 1, '×'),
  ],
};

export const DEFAULT_SHARED: SharedParams = {
  mood: 'default',
  moodStrength: 100,
  gazeX: 0,
  gazeY: 0,
  openness: 1,
  attentionTarget: 'forward',
  shapeSX: 1,
  shapeSY: 1,
  shapeRound: 0,
  shapeTilt: 0,
  motionIntensity: 1,
  motionSpeed: 1,
  motionEase: 'easeInOut',
  autoBlink: true,
  blinkInterval: 4,
  blinkVariation: 0.4,
  blinkSpeed: 1,
  blinkStrength: 1,
  eyelidCloseSpeed: 1,
  eyelidOpenSpeed: 1,
  idle: true,
  idleSpeed: 1,
  microSaccade: 0.3,
  curiosity: 0,
  flickerH: 0,
  flickerV: 0,
  seed: 1337,
};

export const ATTENTION_TARGETS: Record<string, { label: string; x: number; y: number }> = {
  forward: { label: 'Forward Road', x: 0, y: -0.05 },
  passengerLeft: { label: 'Passenger Left', x: -0.75, y: 0.12 },
  passengerCenter: { label: 'Passenger Center', x: 0, y: 0.2 },
  passengerRight: { label: 'Passenger Right', x: 0.75, y: 0.12 },
  windowLeft: { label: 'Window Left', x: -1, y: -0.2 },
  windowRight: { label: 'Window Right', x: 1, y: -0.2 },
  ceiling: { label: 'Cabin Ceiling', x: 0, y: -0.9 },
};

// ------------------------------------------------------------------ matrix

export const MATRIX_SPECS: Record<string, ParamSpec[]> = {
  'Pixel Size': [
    S('leftW', 'Left Eye Pixel Width', 1, 8, 1, 4, 'px'),
    S('rightW', 'Right Eye Pixel Width', 1, 8, 1, 4, 'px'),
    S('eyeH', 'Eye Pixel Height', 1, 8, 1, 4, 'px'),
    S('asymmetry', 'Asymmetry (R height Δ)', -3, 3, 1, 0, 'px'),
    S('corner', 'Pixel Corner Simulation', 0, 2, 1, 1),
  ],
  Position: [
    S('posX', 'Eye Position X', -3, 3, 1, 0, 'px'),
    S('posY', 'Eye Position Y', -3, 3, 1, 0, 'px'),
    S('offsetL', 'Left Offset', -3, 3, 1, 0, 'px'),
    S('offsetR', 'Right Offset', -3, 3, 1, 0, 'px'),
  ],
  Eyelids: [
    S('upperLid', 'Upper Eyelid Coverage', 0, 0.9, 0.01, 0),
    S('lowerLid', 'Lower Eyelid Coverage', 0, 0.9, 0.01, 0),
  ],
  Timing: [
    S('holdMs', 'Animation Hold Duration', 0, 250, 5, 0, 'ms', 'Frame-hold: 0 = every render frame; otherwise time is quantised so each pixel frame is held this long'),
    S('brightness', 'Brightness Preview', 0.05, 1, 0.01, 1),
  ],
};

export const PHYSICAL_SPECS: ParamSpec[] = [
  S('moduleW', 'Module Width', 10, 120, 0.5, 32, 'mm'),
  S('moduleH', 'Module Height', 10, 120, 0.5, 32, 'mm'),
  S('gap', 'Module Gap', 0, 60, 0.5, 10, 'mm'),
  S('pitchX', 'LED Pitch X', 1, 12, 0.05, 4, 'mm'),
  S('pitchY', 'LED Pitch Y', 1, 12, 0.05, 4, 'mm'),
  S('ledDia', 'LED Diameter', 0.5, 12, 0.05, 3, 'mm'),
];

export const DEFAULT_MATRIX_GEOMETRY: MatrixGeometry = {
  leftW: 4, rightW: 4, eyeH: 4, posX: 0, posY: 0, offsetL: 0, offsetR: 0,
  upperLid: 0, lowerLid: 0, corner: 1, asymmetry: 0, brightness: 1, holdMs: 0,
  usePattern: false, editorLeft: emptyPattern(), editorRight: emptyPattern(),
};

export const DEFAULT_PHYSICAL: MatrixPhysical = {
  moduleW: 32, moduleH: 32, gap: 10, pitchX: 4, pitchY: 4, ledDia: 3, ledShape: 'round',
  orientationL: 0, orientationR: 0, ledColor: '#D7F080', frameVisible: true, gridVisible: true, dimensions: true,
};

const IDENT = [0, 1, 2, 3, 4, 5, 6, 7];
const defMapping = (deviceIndex: number, address: string): ModuleMapping => ({
  deviceIndex, address, rotation: 0, mirrorX: false, mirrorY: false, rowMap: IDENT.slice(), colMap: IDENT.slice(),
});
export const DEFAULT_HARDWARE: HardwareConfig = {
  driver: 'raw', bitOrder: 'msbFirst', swapModules: false, left: defMapping(0, 'TBD'), right: defMapping(1, 'TBD'),
};

// ---------------------------------------------------------------- freeform

export const FREEFORM_SPECS: Record<string, ParamSpec[]> = {
  Geometry: [
    S('widthL', 'Left Eye Width', 40, 360, 1, 230, 'u'),
    S('widthR', 'Right Eye Width', 40, 360, 1, 230, 'u'),
    S('heightL', 'Left Eye Height', 20, 440, 1, 280, 'u'),
    S('heightR', 'Right Eye Height', 20, 440, 1, 280, 'u'),
    S('cornerRadius', 'Corner Radius', 0, 1, 0.01, 0.75),
    S('spacing', 'Eye Spacing', -40, 400, 1, 140, 'u'),
    S('scale', 'Global Scale', 0.3, 2, 0.01, 1),
  ],
  Transform: [
    S('posX', 'Eye Position X', -300, 300, 1, 0, 'u'),
    S('posY', 'Eye Position Y', -200, 200, 1, 0, 'u'),
    S('rotation', 'Eye Rotation', -45, 45, 0.5, 0, '°'),
    S('tilt', 'Eye Tilt', -1, 1, 0.01, 0),
    S('asymmetry', 'Asymmetry', -1, 1, 0.01, 0),
  ],
  Deformation: [
    S('squash', 'Eye Squash', -1, 1, 0.01, 0),
    S('stretch', 'Eye Stretch', -1, 1, 0.01, 0),
    S('curvature', 'Eye Curvature', -1, 1, 0.01, 0),
    S('upperLid', 'Upper Eyelid', 0, 0.9, 0.01, 0),
    S('lowerLid', 'Lower Eyelid', 0, 0.9, 0.01, 0),
    S('morphIntensity', 'Morph Intensity', 0, 2, 0.01, 1),
  ],
  Motion: [
    S('gazeRange', 'Gaze Range', 0, 200, 1, 90, 'u'),
    S('gazeSpeed', 'Gaze Speed', 0.5, 10, 0.1, 3, '×', 'Higher = gaze follows target faster (stateless low-pass lag)'),
    S('springOvershoot', 'Spring / Overshoot', 0, 1, 0.01, 0.25),
    S('glow', 'Glow', 0, 1, 0.01, 0.45),
  ],
};

export const DEFAULT_FREEFORM: FreeformGeometry = {
  widthL: 190, widthR: 190, heightL: 150, heightR: 150, cornerRadius: 0.95, spacing: 150,
  rotation: 0, posX: 0, posY: 0, scale: 1, squash: 0, stretch: 0, tilt: 0, asymmetry: 0,
  upperLid: 0, lowerLid: 0, curvature: 0, morphIntensity: 1, gazeRange: 90, gazeSpeed: 3,
  springOvershoot: 0.25, eyeColor: '#D7F080', glow: 0.45,
  offsetsL: Array(CONTROL_POINTS * 2).fill(0), offsetsR: Array(CONTROL_POINTS * 2).fill(0),
};

// ---------------------------------------------------------------- timeline

export const emptyTimeline = (duration = 8000): Timeline => ({
  duration, loop: true,
  tracks: { mood: [], gazeX: [], gazeY: [], openness: [], shape: [], blinks: [], motions: [], pixel: [], morph: [], symbols: [] },
});

export function defaultProject(): Project {
  return {
    version: 1,
    name: 'LIEU Eye Project',
    mode: 'matrix',
    shared: { ...DEFAULT_SHARED },
    motions: {},
    matrix: { geometry: structuredCloneSafe(DEFAULT_MATRIX_GEOMETRY), physical: { ...DEFAULT_PHYSICAL }, hardware: structuredCloneSafe(DEFAULT_HARDWARE) },
    freeform: { geometry: structuredCloneSafe(DEFAULT_FREEFORM) },
    timeline: emptyTimeline(),
    scenarios: [],
  };
}

function structuredCloneSafe<T>(v: T): T {
  return JSON.parse(JSON.stringify(v));
}

/** Flat lookup of clamping ranges used by the importer/validator. */
export function allSpecs(): Record<string, Record<string, ParamSpec>> {
  const index = (groups: Record<string, ParamSpec[]> | ParamSpec[]) => {
    const list = Array.isArray(groups) ? groups : Object.values(groups).flat();
    return Object.fromEntries(list.map((s) => [s.key, s]));
  };
  return {
    shared: index(SHARED_SPECS),
    matrixGeometry: index(MATRIX_SPECS),
    physical: index(PHYSICAL_SPECS),
    freeform: index(FREEFORM_SPECS),
  };
}
