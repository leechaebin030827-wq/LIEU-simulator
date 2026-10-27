import { useStore } from '../store';
import { followStep, TILT_MOTOR, YAW_MOTOR, type Limits } from '../engine/motorPlan';

/** Motor client for the yaw and tilt axes. The page only asks the local bridge (hardware/pi: python -m lieu_hw serve); range, slow profile,
 *  fault latch and watchdog are enforced there. Nothing moves until the person presses Arm, and Follow only sends goals that the slow,
 *  limited follower allows. */
export type Axis = 'yaw' | 'tilt';
export type MotorStatus = { ok: boolean; error?: string; detail?: string; torque?: boolean; mode?: number; profile_ok?: boolean; deg?: number | null; hw_error?: number; fault?: string | null; follow?: boolean; needs_front?: boolean; searching?: boolean; limit_deg?: number; max_vel?: number; axes?: Record<Axis, MotorStatus> };
export const BRIDGE_PORT = 8787; // not 8765: a stray http.server on this machine was answering there
const BASE = `http://127.0.0.1:${BRIDGE_PORT}`;
const listeners = new Set<() => void>();
let status: MotorStatus = { ok: false, error: 'bridge not running' };
let poll = 0, bridgeUp = false, inflight = false;
type FollowState = { timer: number; approaching: boolean; lastSent: number; lastSentAt: number };
const follow: Record<Axis, FollowState> = { yaw: { timer: 0, approaching: false, lastSent: NaN, lastSentAt: 0 }, tilt: { timer: 0, approaching: false, lastSent: NaN, lastSentAt: 0 } };
const LIMITS: Record<Axis, Limits> = { yaw: YAW_MOTOR, tilt: TILT_MOTOR };

/** Status of one axis (the yaw fields are also at the top level for older bridges). */
export const getMotorStatus = (axis: Axis = 'yaw'): MotorStatus => status.axes?.[axis] ?? (axis === 'yaw' ? status : { ok: false, error: 'tilt motor not reported by the bridge' });
export const motorBridgeUp = () => bridgeUp;
export const subscribeMotor = (f: () => void) => { listeners.add(f); return () => { listeners.delete(f); }; };
const emit = () => listeners.forEach((f) => f());

async function call(path: string, body?: object): Promise<MotorStatus> {
  try {
    const signal = AbortSignal.timeout(body === undefined ? 1500 : 4000); // never wait forever on the bridge
    const r = await fetch(BASE + path, body === undefined ? { signal } : { signal, method: 'POST', headers: { 'content-type': 'application/json', 'x-lieu': '1' }, body: JSON.stringify(body) });
    return await r.json();
  } catch (e) { return { ok: false, error: 'bridge not running', detail: String(e) }; }
}

export async function refreshMotor() {
  if (inflight) return; // one poll at a time: slow answers must not pile up
  inflight = true;
  const s = await call('/status').finally(() => { inflight = false; });
  bridgeUp = s.error !== 'bridge not running';
  status = s; emit();
}
export function startMotorPolling() { if (!poll) { void refreshMotor(); poll = window.setInterval(() => void refreshMotor(), 250); } }
export function stopMotorPolling() { window.clearInterval(poll); poll = 0; }

export async function motorAct(name: 'arm' | 'hold' | 'release' | 'clear' | 'setup', axis: Axis = 'yaw') {
  if (name !== 'arm') stopFollow(axis);
  const r = await call('/' + name, { axis });
  await refreshMotor();
  return r;
}
export async function motorGoto(deg: number, axis: Axis = 'yaw') { stopFollow(axis); const r = await call('/goal', { axis, deg, follow: false }); await refreshMotor(); return r; }

export const isFollowing = (axis: Axis = 'yaw') => follow[axis].timer !== 0 || follow[axis].approaching;
export function stopFollow(axis: Axis = 'yaw') {
  const f = follow[axis];
  f.approaching = false;
  if (f.timer) { window.clearInterval(f.timer); f.timer = 0; void call('/hold', { axis }); }
  emit();
}
/** What the editor shows for this axis right now: timeline value plus any slider/live override (so the slider drives the motor too). */
const wantNow = (axis: Axis) => { const m = useStore.getState().evalNow().motion; return axis === 'yaw' ? m.yawY : m.tiltZ; };
const clampDeg = (axis: Axis, d: number) => Math.max(-LIMITS[axis].limitDeg, Math.min(LIMITS[axis].limitDeg, d));

/** First move (slowly, via the motor's own slow profile) to where the editor's value is now; only then follow it, so the bridge's tracking watchdog stays
 *  meaningful. While following, goals come out of followStep (speed + acceleration capped), so dragging the slider or scrubbing never commands a jump. */
export async function startFollow(axis: Axis = 'yaw') {
  const f = follow[axis];
  if (f.timer || f.approaching) return;
  f.approaching = true; emit();
  const t0 = performance.now();
  while (f.approaching) {
    const target = clampDeg(axis, wantNow(axis)), r = await call('/goal', { axis, deg: target, follow: false });
    if (!r.ok) { f.approaching = false; await refreshMotor(); emit(); return; }
    await refreshMotor();
    if (Math.abs((getMotorStatus(axis).deg ?? 1e9) - target) < 1.5) break;
    if (performance.now() - t0 > 60000) { f.approaching = false; emit(); return; }
    await new Promise((res) => setTimeout(res, 250));
  }
  if (!f.approaching) return;
  f.approaching = false; f.lastSent = NaN; f.lastSentAt = 0;
  let x = getMotorStatus(axis).deg ?? clampDeg(axis, wantNow(axis)), v = 0, busy = false;
  const dt = 1 / 30;
  f.timer = window.setInterval(async () => {
    const r0 = followStep(x, v, wantNow(axis), dt, LIMITS[axis]);
    x = r0.x; v = r0.v;
    const now = performance.now();
    if (Number.isFinite(f.lastSent) && Math.abs(x - f.lastSent) < 0.05 && now - f.lastSentAt < 300) return; // quiet, but keep the bridge watchdog fed
    if (busy) return;
    busy = true; f.lastSent = x; f.lastSentAt = now;
    const r = await call('/goal', { axis, deg: x, follow: true });
    busy = false;
    if (!r.ok) { window.clearInterval(f.timer); f.timer = 0; await refreshMotor(); emit(); }
  }, 1000 / 30);
  emit();
}
