export * from '../../spec/sequence-types';
import type { Rgbw } from '../../spec/sequence-types';

export type StageId = 'fixedRail' | 'carriage' | 'yaw' | 'tilt';
export const STAGES: StageId[] = ['fixedRail', 'carriage', 'yaw', 'tilt'];
export type Vec3 = [number, number, number];

/** User-editable rig hypothesis. NOT a verified linkage; see docs/03_INPUTS_AND_LIMITS.md. */
export type RigState = {
  /** mesh glTF node index -> stage. Every renderable node has exactly one owner. */
  owner: Record<number, StageId>;
  pivots: { yaw: Vec3; tilt: Vec3 };
  /** Stage ownership of emitters / optics (default: follows their source mesh node). */
  emitterNodes: { ring: number; eyeLeft: number; eyeRight: number; projector: number };
};

export type MotionState = { railX: number; yawY: number; tiltZ: number; /** visual-only whole-body lift (m), not a hardware axis */ liftY?: number };

export const BLACK: Rgbw = [0, 0, 0, 0];
export const LED_COUNT = 24;

export type LiveOverride = Partial<{
  motion: Partial<MotionState>;
  pixels: Record<number, Rgbw>;
  eyeLeft: readonly number[];
  eyeRight: readonly number[];
  eyeIntensity: number;
  ringBrightness: number;
  projector: Record<string, number>;
}>;
