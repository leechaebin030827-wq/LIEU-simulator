import { useStore } from '../store';
import { followStep, YAW_MOTOR } from '../engine/motorPlan';

/** Yaw motor client. The page only asks the local bridge (hardware/pi: python -m lieu_hw serve); range, slow profile, fault latch and watchdog
 *  are enforced there. Nothing moves until the person presses Arm, and Follow only sends goals that the slow, limited plan allows. */
export type MotorStatus = { ok: boolean; error?: string; detail?: string; torque?: boolean; mode?: number; profile_ok?: boolean; deg?: number | null; hw_error?: number; fault?: string | null; follow?: boolean; needs_front?: boolean; searching?: boolean; limit_deg?: number; max_vel?: number };
export const BRIDGE_PORT = 8787; // not 8765: a stray http.server on this machine was answering there
const BASE = `http://127.0.0.1:${BRIDGE_PORT}`;
const listeners = new Set<() => void>();
let status: MotorStatus = { ok: false, error: 'bridge not running' };
let poll = 0, followTimer = 0, lastSent = NaN;
let bridgeUp = false;

export const getMotorStatus = () => status;
export const motorBridgeUp = () => bridgeUp;
export const subscribeMotor = (f: () => void) => { listeners.add(f); return () => { listeners.delete(f); }; };
const emit = () => listeners.forEach((f) => f());

async function call(path: string, body?: object): Promise<MotorStatus> {
  try {
    const r = await fetch(BASE + path, body === undefined ? undefined : { method: 'POST', headers: { 'content-type': 'application/json', 'x-lieu': '1' }, body: JSON.stringify(body) });
    return await r.json();
  } catch (e) { return { ok: false, error: 'bridge not running', detail: String(e) }; }
}

export async function refreshMotor() {
  const s = await call('/status');
  bridgeUp = s.error !== 'bridge not running';
  status = s; emit();
}
export function startMotorPolling() { if (!poll) { void refreshMotor(); poll = window.setInterval(() => void refreshMotor(), 250); } }
export function stopMotorPolling() { window.clearInterval(poll); poll = 0; }

export async function motorAct(name: 'arm' | 'hold' | 'release' | 'clear' | 'setup') {
  if (name !== 'arm') stopFollow();
  const r = await call('/' + name, {});
  await refreshMotor();
  return r;
}
export async function motorGoto(deg: number) { stopFollow(); const r = await call('/goal', { deg, follow: false }); await refreshMotor(); return r; }

export const isFollowing = () => followTimer !== 0 || approaching;
let approaching = false, lastSentAt = 0;
export function stopFollow() {
  approaching = false;
  if (followTimer) { window.clearInterval(followTimer); followTimer = 0; void call('/hold', {}); }
  emit();
}
/** What the editor shows for yaw right now: timeline value plus any slider/live override (so the Yaw slider drives the motor too). */
const wantNow = () => useStore.getState().evalNow().motion.yawY;
const clampDeg = (d: number) => Math.max(-YAW_MOTOR.limitDeg, Math.min(YAW_MOTOR.limitDeg, d));
/** First move (slowly, via the motor's own slow profile) to where the editor's yaw is now; only then follow it, so the bridge's tracking watchdog stays meaningful.
 *  While following, goals come out of followStep (speed + acceleration capped), so dragging the slider or scrubbing never commands a jump. */
export async function startFollow() {
  if (followTimer || approaching) return;
  approaching = true; emit();
  const t0 = performance.now();
  while (approaching) {
    const target = clampDeg(wantNow()), r = await call('/goal', { deg: target, follow: false });
    if (!r.ok) { approaching = false; await refreshMotor(); emit(); return; }
    await refreshMotor();
    if (Math.abs((status.deg ?? 1e9) - target) < 1.5) break;
    if (performance.now() - t0 > 60000) { approaching = false; emit(); return; }
    await new Promise((res) => setTimeout(res, 250));
  }
  if (!approaching) return;
  approaching = false; lastSent = NaN; lastSentAt = 0;
  let x = status.deg ?? clampDeg(wantNow()), v = 0, busy = false;
  const dt = 1 / 30;
  followTimer = window.setInterval(async () => {
    const r0 = followStep(x, v, wantNow(), dt);
    x = r0.x; v = r0.v;
    const now = performance.now();
    if (Number.isFinite(lastSent) && Math.abs(x - lastSent) < 0.05 && now - lastSentAt < 300) return; // quiet, but keep the bridge watchdog fed
    if (busy) return;
    busy = true; lastSent = x; lastSentAt = now;
    const r = await call('/goal', { deg: x, follow: true });
    busy = false;
    if (!r.ok) { window.clearInterval(followTimer); followTimer = 0; await refreshMotor(); emit(); }
  }, 1000 / 30);
  emit();
}
