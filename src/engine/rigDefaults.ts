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
  // The centre module hanging below (LED shade, NeoPixel ring, projector body and holder) stays upright and only yaws.
  for (const n of CENTER_MODULE_NODES) owner[n] = 'yaw';
  for (const n of cfg.staticMeshes.railNodeIndices) owner[n] = 'fixedRail';
  return {
    owner,
    pivots: { yaw: [...k.restPivotsWorldMeters.yawY] as [number, number, number], tilt: [...k.restPivotsWorldMeters.tiltZ] as [number, number, number] },
    emitterNodes: { ring: 133, eyeLeft: 13, eyeRight: 8, projector: 18 },
  };
}

export const PREVIEW_LIMITS = {
  railX: { range: cfg.actuators.railX.previewOnlyRange as [number, number], maxVel: cfg.actuators.railX.previewOnlyMaxVelocity, maxAcc: cfg.actuators.railX.previewOnlyMaxAcceleration, unit: 'm' },
  yawY: { range: cfg.actuators.yawY.previewOnlyRange as [number, number], maxVel: cfg.actuators.yawY.previewOnlyMaxVelocity, maxAcc: cfg.actuators.yawY.previewOnlyMaxAcceleration, unit: '°' },
  tiltZ: { range: cfg.actuators.tiltZ.previewOnlyRange as [number, number], maxVel: cfg.actuators.tiltZ.previewOnlyMaxVelocity, maxAcc: cfg.actuators.tiltZ.previewOnlyMaxAcceleration, unit: '°' },
} as const;
export type MotionKey = keyof typeof PREVIEW_LIMITS;

/** Hard limit applied to the Tilt axis everywhere (evaluator, sliders, key entry): +/-15 deg. */
export const TILT_LIMIT_DEG = 15;
