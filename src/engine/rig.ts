import { Matrix4, Vector3 } from 'three';
import type { MotionState, RigState, StageId, Vec3 } from './types';

export const DEG = Math.PI / 180;
export type StageMatrices = Record<StageId, Matrix4>;

function aboutPivot(axis: 'y' | 'z', angleRad: number, pivot: Vec3): Matrix4 {
  const T = new Matrix4().makeTranslation(pivot[0], pivot[1], pivot[2]);
  const R = axis === 'y' ? new Matrix4().makeRotationY(angleRad) : new Matrix4().makeRotationZ(angleRad);
  const Ti = new Matrix4().makeTranslation(-pivot[0], -pivot[1], -pivot[2]);
  return T.multiply(R).multiply(Ti);
}

/**
 * Yaw stage:  T(railX) x [P_yaw R_yaw P_yaw^-1] x M_rest (upright centre module).
 * Tilt stage: T(railX) x [P_tilt R_tilt P_tilt^-1] x [P_yaw R_yaw P_yaw^-1] x M_rest, always from rest.
 * The tilt axis is fixed to the column (it does NOT turn with yaw); the shell yaws about its own, tilted, axis.
 * Returns the matrix to LEFT-multiply onto each mesh's rest world matrix for each stage.
 * Pivots are expressed in the REST world frame (hypothesis, user editable).
 */
export function computeStageMatrices(m: MotionState, rig: Pick<RigState, 'pivots'>): StageMatrices {
  const carriage = new Matrix4().makeTranslation(m.railX, 0, 0);
  const yaw = carriage.clone().multiply(aboutPivot('y', m.yawY * DEG, rig.pivots.yaw));
  const tilt = carriage.clone().multiply(aboutPivot('z', m.tiltZ * DEG, rig.pivots.tilt)).multiply(aboutPivot('y', m.yawY * DEG, rig.pivots.yaw));
  return { fixedRail: new Matrix4(), carriage, yaw, tilt };
}

export function applyStage(stage: Matrix4, restWorld: Matrix4, out = new Matrix4()): Matrix4 {
  return out.multiplyMatrices(stage, restWorld);
}

export function transformPoint(stage: Matrix4, p: Vec3): Vec3 {
  const v = new Vector3(...p).applyMatrix4(stage);
  return [v.x, v.y, v.z];
}
