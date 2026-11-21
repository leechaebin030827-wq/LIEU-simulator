import type { MotionState } from '../engine/types';
import type { SafeAxis } from './hardware';

export type SafeRawFrame = Record<SafeAxis, number>;

export const SAFE_RAW = {
  yaw: { min: -3362, center: 1692, max: 8543 },
  tilt: { min: 1829, center: 2055, max: 2248 },
  body: { min: -5073, center: 2184, max: 9312 },
  rail: { min: -2522, center: 242, max: 4113 },
} as const;

/**
 * STAGE7 firmware streaming speed caps in raw units per second
 * (Profile Velocity x 0.229 rpm x 4096 / 60). Authored motion faster than this
 * makes the real robot fall behind the simulator.
 */
export const FIRMWARE_MAX_RAW_PER_SEC: SafeRawFrame = { yaw: 3439, tilt: 782, body: 1250, rail: 1250 };
/**
 * Commissioned STAGE7 Profile Acceleration per axis in raw units per second²
 * (x 214.577 rev/min² x 4096 / 3600). With the motor profile disabled while
 * streaming, authored motion above this is felt as jerks.
 */
export const COMMISSIONED_MAX_RAW_PER_SEC2: SafeRawFrame = { yaw: 4883, tilt: 2441, body: 3662, rail: 2441 };

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

/**
 * Two calibrated straight lines (min->center, center->max) with different
 * slopes. A plain two-segment map makes the motor's speed jump whenever the
 * axis crosses center while moving, which is felt as a jerk. Within +/-knee of
 * the center the lines are joined by two cubic Hermite halves that still pass
 * exactly through the calibrated center and blend the slopes (C1-continuous).
 */
function kneeMap(x: number, x0: number, xc: number, x1: number, y0: number, yc: number, y1: number, knee: number): number {
  const sL = (yc - y0) / (xc - x0), sR = (y1 - yc) / (x1 - xc), sM = (sL + sR) / 2;
  const d = x - xc;
  if (d <= -knee) return yc + sL * d;
  if (d >= knee) return yc + sR * d;
  const s = d < 0 ? sL : sR;            // outer slope of this half
  const pa = d < 0 ? yc - sL * knee : yc; // half start value
  const pb = d < 0 ? yc : yc + sR * knee; // half end value
  const ma = d < 0 ? s : sM, mb = d < 0 ? sM : s;
  const u = d < 0 ? (d + knee) / knee : d / knee;
  const u2 = u * u, u3 = u2 * u;
  return (2 * u3 - 3 * u2 + 1) * pa + (u3 - 2 * u2 + u) * knee * ma + (-2 * u3 + 3 * u2) * pb + (u3 - u2) * knee * mb;
}

/** Maps authored motion into the already-validated narrow commissioning windows. */
export function motionToSafeRaw(motion: MotionState): SafeRawFrame {
  const exact = motionToRawExact(motion);
  return { yaw: Math.round(exact.yaw), tilt: Math.round(exact.tilt), body: Math.round(exact.body), rail: Math.round(exact.rail) };
}

/** Same mapping without rounding, for speed and acceleration analysis. */
export function motionToRawExact(motion: MotionState): SafeRawFrame {
  const yawDeg = clamp(motion.yawY, -90, 90);
  const yaw = kneeMap(yawDeg, -90, 0, 90, SAFE_RAW.yaw.min, SAFE_RAW.yaw.center, SAFE_RAW.yaw.max, 30);
  // Negative tilt is the measured forward direction (larger raw value).
  const tiltDeg = clamp(motion.tiltZ, -15, 15);
  const tilt = kneeMap(tiltDeg, -15, 0, 15, SAFE_RAW.tilt.max, SAFE_RAW.tilt.center, SAFE_RAW.tilt.min, 4);
  const bodyDeg = clamp(motion.bodyYaw ?? 0, -180, 180);
  const body = kneeMap(bodyDeg, -180, 0, 180, SAFE_RAW.body.min, SAFE_RAW.body.center, SAFE_RAW.body.max, 20);
  // The exhibition sequence's measured default is railX=-0.12. Preserve it exactly.
  const railX = clamp(motion.railX, -0.14, -0.04);
  const rail = kneeMap(railX, -0.14, -0.12, -0.04, SAFE_RAW.rail.min, SAFE_RAW.rail.center, SAFE_RAW.rail.max, 0.012);
  return { yaw, tilt, body, rail };
}
