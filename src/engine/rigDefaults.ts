import type { RigState, StageId } from './types';
import cfg from '../../config/LIEU_Simulator_Config.json';

const COLUMN_NODE = 132;
const CENTER_MODULE_NODES = [17, 18, 133, 139];

/** Build the default (hypothesis) ownership from config: yaw candidates are placed in tilt; remaining parts stay on carriage; Rail fixed. */
export function defaultRig(): RigState {
  const k = cfg.previewKinematics;
  const owner: Record<number, StageId> = {};
  for (const n of cfg.allCarriageMeshes) owner[n] = 'carriage';
  for (const n of k.yawCandidateMeshNodeIndices) owner[n] = 'yaw';
  // Everything riding on the yaw drive (bearings, LED ring/shade, projector, holder, tilt axes) also tilts with the shell.
  for (const n of k.tiltCandidateMeshNodeIndices) owner[n] = 'tilt';
  for (const n of k.yawCandidateMeshNodeIndices) owner[n] = 'tilt';
  // Motor / idler assemblies and other loose parts inside the donut tilt with it; only the column (and the rail) stay put.
  for (const n of cfg.allCarriageMeshes) if (n !== COLUMN_NODE) owner[n] = 'tilt';
  // The centre lighting module stays upright and yaws with the head.
  for (const n of CENTER_MODULE_NODES) owner[n] = 'yaw';
  // The projector is fixed to the body/carriage, not the yaw head.
  owner[18] = 'carriage';
  for (const n of cfg.staticMeshes.railNodeIndices) owner[n] = 'fixedRail';
  return {
    owner,
    pivots: { yaw: [...k.restPivotsWorldMeters.yawY] as [number, number, number], tilt: [...k.restPivotsWorldMeters.tiltZ] as [number, number, number] },
    emitterNodes: { ring: 133, eyeLeft: 13, eyeRight: 8, projector: 18 },
  };
}

export const PREVIEW_LIMITS = {
  railX: { range: cfg.actuators.railX.previewOnlyRange as [number, number], maxVel: cfg.actuators.railX.previewOnlyMaxVelocity, maxAcc: cfg.actuators.railX.previewOnlyMaxAcceleration, unit: 'm' },
  // 08 Final Exhibition peak envelopes. The small numeric margin prevents the
  // 30 fps finite-difference checker from flagging an exact smoothstep peak.
  // The joy spin turns the body up to +/-180 deg at up to ~100 deg/s and turns
  // around (~235 deg/s^2) only while the face is out of sight.
  bodyYaw: { range: [-180, 180] as [number, number], maxVel: 100, maxAcc: 250, unit: '°' },
  // The measured yaw travel is asymmetric around physical front. Keep the
  // commissioned left margin at -70°, while allowing the verified +90° right pose.
  yawY: { range: [-70, 90] as [number, number], maxVel: 60.5, maxAcc: 270, unit: '°' },
  // The joy-spin wobble rocks -15/+15 deg in ~0.85 s (peaks ~57 deg/s, ~285 deg/s^2).
  tiltZ: { range: [-15, 15] as [number, number], maxVel: 60, maxAcc: 300, unit: '°' },
} as const;
export type MotionKey = keyof typeof PREVIEW_LIMITS;

/** Hard limit applied to the Tilt axis everywhere (evaluator, sliders, key entry): +/-15 deg. */
export const TILT_LIMIT_DEG = 15;
