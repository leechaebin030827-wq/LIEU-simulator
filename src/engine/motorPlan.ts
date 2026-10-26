import type { LieuSequence } from './types';
import { evalNumeric } from './interp';
import limits from '../../hardware/config/motor_limits.json';

/** Yaw motor (Dynamixel id 1) plan. DRY RUN ONLY: nothing here talks to a motor. Numbers come from hardware/config/motor_limits.json
 *  (centre / scale measured by hand-moving the axis, safe limits chosen on purpose smaller than the physical +/-90 deg). */
const m = limits.motors['1'];
export const YAW_MOTOR = {
  centerRaw: m.calibration.raw_center_front,
  rawPerDeg: m.calibration.raw_per_robot_deg,
  limitDeg: m.safe.limit_deg,
  maxVel: m.safe.max_vel_deg_s,
  maxAcc: m.safe.max_acc_deg_s2,
};
export type YawMotor = typeof YAW_MOTOR;

export const yawToRaw = (deg: number, c: YawMotor = YAW_MOTOR) => Math.round(c.centerRaw + c.rawPerDeg * deg);

export type YawPlan = {
  fps: number;
  sim: number[];        // what the simulator asks for (deg)
  exec: number[];       // what a slow, limited motor could actually follow (deg)
  raw: number[];        // motor position that corresponds to exec
  clamped: number;      // frames where the request was outside the safe range
  maxLagDeg: number; maxLagAtSec: number;
  maxSimVel: number;    // fastest the simulator asks for (deg/s)
};

/** One 1/fps step of the follower: position clamp + velocity cap + acceleration cap, braking in time to stop on target. Pure. */
export function followStep(x: number, v: number, want: number, dt: number, c: YawMotor = YAW_MOTOR): { x: number; v: number; clamped: boolean } {
  const target = Math.max(-c.limitDeg, Math.min(c.limitDeg, want));
  const err = target - x;
  const vd = Math.max(-c.maxVel, Math.min(c.maxVel, Math.sign(err) * Math.sqrt(1.6 * c.maxAcc * Math.abs(err))));
  const nv = v + Math.max(-c.maxAcc * dt, Math.min(c.maxAcc * dt, vd - v));
  const nx = Math.max(-c.limitDeg, Math.min(c.limitDeg, x + nv * dt));
  return { x: nx, v: (nx - x) / dt, clamped: target !== want }; // if the position clamp bit, the real speed is what is left
}

/** Follows the whole sequence's yaw through followStep (used by the dry run). Pure. */
export function planYaw(seq: LieuSequence, c: YawMotor = YAW_MOTOR, fps = 30): YawPlan {
  const n = Math.floor(seq.durationSec * fps + 1e-6) + 1, dt = 1 / fps;
  const sim: number[] = [], exec: number[] = [], raw: number[] = [];
  let x = Math.max(-c.limitDeg, Math.min(c.limitDeg, evalNumeric(seq.tracks.motion.yawY, 0, 0))), v = 0, clamped = 0, lag = 0, lagAt = 0, maxSimVel = 0, prev = x;
  for (let k = 0; k < n; k++) {
    const want = evalNumeric(seq.tracks.motion.yawY, k * dt, 0);
    if (k) maxSimVel = Math.max(maxSimVel, Math.abs(want - prev) / dt);
    prev = want;
    const r = followStep(x, v, want, dt, c);
    if (r.clamped) clamped++;
    x = r.x; v = r.v;
    sim.push(want); exec.push(x); raw.push(yawToRaw(x, c));
    if (Math.abs(want - x) > lag) { lag = Math.abs(want - x); lagAt = k * dt; }
  }
  return { fps, sim, exec, raw, clamped, maxLagDeg: lag, maxLagAtSec: lagAt, maxSimVel };
}

export const planAt = (p: YawPlan, t: number) => Math.min(p.exec.length - 1, Math.max(0, Math.round(t * p.fps)));
