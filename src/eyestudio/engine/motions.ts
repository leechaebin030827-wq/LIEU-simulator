import type { BlinkEvent, MoodId, MotionEvent, MotionSettings, NumKey, MoodKey, Timeline, EaseType } from './types';
import { emptyTimeline } from './params';
import { uid } from './util';

/**
 * Motion channels. Each motion is a set of normalised-time key curves (p = 0..1 within one iteration).
 *  gx, gy : absolute gaze target (null value = "stay at the current base gaze")
 *  bl, br : left / right eyelid closure 0..1
 *  op     : openness multiplier
 *  lt, lb, sl, ar : additive lid coverage / slant / arch (mood-vector space)
 *  mw     : weight of the motion's own mood (`mood`) blended over the base mood
 */
export type Chan = 'gx' | 'gy' | 'bl' | 'br' | 'op' | 'lt' | 'lb' | 'sl' | 'ar' | 'mw';
export type ChanKeys = [number, number | null][];

export interface MotionDef {
  id: string;
  label: string;
  desc: string;
  mood?: MoodId;
  channels: Partial<Record<Chan, ChanKeys>>;
  defaults: MotionSettings;
  dirX?: number;
  dirY?: number;
}

const d = (duration: number, o: Partial<MotionSettings> = {}): MotionSettings => ({
  duration, speed: 1, intensity: 1, loop: false, loopCount: 1, easing: 'easeInOut', transition: 120, ...o,
});

function bob(start: number, end: number, n: number, hi: number, lo: number): ChanKeys {
  const keys: ChanKeys = [[0, null]];
  for (let i = 0; i < n; i++) keys.push([start + ((end - start) * i) / (n - 1), i % 2 === 0 ? lo : hi]);
  keys.push([1, null]);
  return keys;
}

const blinkCurve: ChanKeys = [[0, 0], [0.4, 1], [0.52, 1], [1, 0]];

export const MOTION_LIBRARY: MotionDef[] = [
  { id: 'idle', label: 'Idle', desc: 'Slow wandering gaze, as if resting',
    channels: { gx: [[0, null], [0.2, 0.28], [0.42, -0.22], [0.64, 0.16], [0.82, -0.1], [1, null]], gy: [[0, null], [0.3, -0.08], [0.6, 0.08], [1, null]] },
    defaults: d(5000, { loop: true, loopCount: 1, transition: 400 }) },
  { id: 'blink', label: 'Blink', desc: 'Single natural blink', channels: { bl: blinkCurve, br: blinkCurve }, defaults: d(320, { transition: 0 }) },
  { id: 'doubleBlink', label: 'Double Blink', desc: 'Two quick blinks',
    channels: { bl: [[0, 0], [0.14, 1], [0.22, 1], [0.38, 0], [0.5, 0], [0.64, 1], [0.72, 1], [1, 0]], br: [[0, 0], [0.14, 1], [0.22, 1], [0.38, 0], [0.5, 0], [0.64, 1], [0.72, 1], [1, 0]] },
    defaults: d(640, { transition: 0 }) },
  { id: 'winkLeft', label: 'Wink Left', desc: 'Close the left eye only', channels: { bl: [[0, 0], [0.3, 1], [0.65, 1], [1, 0]] }, defaults: d(560, { transition: 0 }) },
  { id: 'winkRight', label: 'Wink Right', desc: 'Close the right eye only', channels: { br: [[0, 0], [0.3, 1], [0.65, 1], [1, 0]] }, defaults: d(560, { transition: 0 }) },
  { id: 'lookLeft', label: 'Look Left', desc: 'Glance to the left and return', channels: { gx: [[0, null], [0.25, -1], [0.7, -1], [1, null]] }, defaults: d(1300) },
  { id: 'lookRight', label: 'Look Right', desc: 'Glance to the right and return', channels: { gx: [[0, null], [0.25, 1], [0.7, 1], [1, null]] }, defaults: d(1300) },
  { id: 'lookUp', label: 'Look Up', desc: 'Glance up and return', channels: { gy: [[0, null], [0.25, -1], [0.7, -1], [1, null]] }, defaults: d(1300) },
  { id: 'lookDown', label: 'Look Down', desc: 'Glance down and return', channels: { gy: [[0, null], [0.25, 1], [0.7, 1], [1, null]] }, defaults: d(1300) },
  { id: 'lookAround', label: 'Look Around', desc: 'Scan left then right',
    channels: { gx: [[0, null], [0.12, -0.9], [0.3, -0.9], [0.46, 0.9], [0.64, 0.9], [0.8, 0], [1, null]], gy: [[0, null], [0.12, -0.2], [0.3, -0.2], [0.46, -0.3], [0.64, -0.3], [0.8, 0.1], [1, null]] },
    defaults: d(3600) },
  { id: 'confused', label: 'Confused', desc: 'Quick side-to-side shake with a skewed brow',
    channels: { gx: [[0, null], [0.1, -0.5], [0.2, 0.5], [0.3, -0.5], [0.4, 0.5], [0.5, -0.3], [0.62, 0.3], [0.78, 0], [1, null]], sl: [[0, 0], [0.15, 0.5], [0.8, 0.5], [1, 0]], lt: [[0, 0], [0.2, 0.15], [0.8, 0.15], [1, 0]] },
    defaults: d(1500) },
  { id: 'laugh', label: 'Laugh', desc: 'Happy eyes bobbing up and down', mood: 'happy',
    channels: { mw: [[0, 0], [0.1, 1], [0.85, 1], [1, 0]], gy: bob(0.08, 0.9, 10, 0.25, -0.35) }, defaults: d(1500, { easing: 'easeOut' }) },
  { id: 'sleep', label: 'Sleep', desc: 'Eyes slowly close and stay closed',
    channels: { bl: [[0, 0], [0.45, 1], [1, 1]], br: [[0, 0], [0.45, 1], [1, 1]], gy: [[0, null], [0.45, 0.3], [1, 0.3]], lt: [[0, 0], [0.5, 0.3], [1, 0.3]] },
    defaults: d(3200, { transition: 150 }) },
  { id: 'wakeUp', label: 'Wake Up', desc: 'Start closed, flutter, then open slowly',
    channels: { bl: [[0, 1], [0.25, 0.9], [0.38, 0.96], [0.6, 0.4], [0.74, 0.55], [1, 0]], br: [[0, 1], [0.25, 0.9], [0.38, 0.96], [0.6, 0.4], [0.74, 0.55], [1, 0]], gy: [[0, 0.3], [0.7, 0.05], [1, null]] },
    defaults: d(2400, { transition: 0 }) },
  { id: 'gentleGreeting', label: 'Gentle Greeting', desc: 'Look toward the passenger, soft smile, one blink', mood: 'happy',
    channels: { gx: [[0, null], [0.2, 0.55], [0.78, 0.55], [1, null]], gy: [[0, null], [0.2, 0.1], [0.78, 0.1], [1, null]], mw: [[0, 0], [0.25, 0.8], [0.72, 0.8], [1, 0]], bl: [[0, 0], [0.5, 0], [0.58, 1], [0.7, 0], [1, 0]], br: [[0, 0], [0.5, 0], [0.58, 1], [0.7, 0], [1, 0]] },
    defaults: d(3200) },
  { id: 'attentiveListening', label: 'Attentive Listening', desc: 'Focused with tiny nods of the gaze', mood: 'attentive',
    channels: { mw: [[0, 0], [0.15, 1], [0.9, 1], [1, 0]], gy: [[0, null], [0.2, 0.12], [0.5, 0.04], [0.8, 0.14], [1, null]], gx: [[0, null], [0.25, 0.12], [0.6, -0.1], [1, null]], bl: [[0, 0], [0.7, 0], [0.76, 1], [0.84, 0], [1, 0]], br: [[0, 0], [0.7, 0], [0.76, 1], [0.84, 0], [1, 0]] },
    defaults: d(4200) },
  { id: 'curiousInspection', label: 'Curious Inspection', desc: 'Wide curious eyes scanning an object', mood: 'curious',
    channels: { mw: [[0, 0], [0.15, 1], [0.9, 1], [1, 0]], gx: [[0, null], [0.2, -0.7], [0.45, -0.7], [0.58, 0.7], [0.82, 0.7], [1, null]], gy: [[0, null], [0.2, -0.15], [0.45, 0.2], [0.82, -0.1], [1, null]] },
    defaults: d(3800) },
  { id: 'lookForwardReturn', label: 'Look Forward and Return', desc: 'Gaze goes to the road ahead, then returns to where it was',
    channels: { gx: [[0, null], [0.25, 0], [0.7, 0], [1, null]], gy: [[0, null], [0.25, -0.05], [0.7, -0.05], [1, null]] },
    defaults: d(2400) },
  { id: 'calmBreathing', label: 'Calm Breathing', desc: 'Slow, subtle lid rise and fall', mood: 'calm',
    channels: { mw: [[0, 1], [1, 1]], op: [[0, 1], [0.5, 0.9], [1, 1]], lt: [[0, 0], [0.5, 0.08], [1, 0]], gy: [[0, null], [0.5, 0.04], [1, null]] },
    defaults: d(4000, { loop: true, loopCount: 3, transition: 500 }) },
  { id: 'reassuringBlink', label: 'Reassuring Blink', desc: 'Slow, warm blink with soft eyes', mood: 'reassuring',
    channels: { bl: [[0, 0], [0.45, 1], [0.6, 1], [1, 0]], br: [[0, 0], [0.45, 1], [0.6, 1], [1, 0]], mw: [[0, 0], [0.3, 1], [0.8, 1], [1, 0]] },
    defaults: d(1000, { transition: 80 }) },
  { id: 'passengerAttention', label: 'Passenger Attention', desc: 'Turn to the passenger, hold attention, brief blink', mood: 'attentive',
    channels: { gx: [[0, null], [0.2, 0.6], [0.82, 0.6], [1, null]], gy: [[0, null], [0.2, 0.12], [0.82, 0.12], [1, null]], mw: [[0, 0], [0.25, 1], [0.85, 1], [1, 0]], bl: [[0, 0], [0.84, 0], [0.9, 1], [0.97, 0], [1, 0]], br: [[0, 0], [0.84, 0], [0.9, 1], [0.97, 0], [1, 0]] },
    defaults: d(3200) },
];

function circle(start: number, end: number, n: number, rx: number, ry: number, ccw = false): { gx: ChanKeys; gy: ChanKeys } {
  const gx: ChanKeys = [[0, null]], gy: ChanKeys = [[0, null]];
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI * 2 * (ccw ? -1 : 1);
    const t = start + ((end - start) * i) / n;
    gx.push([t, Math.sin(a) * rx]); gy.push([t, -Math.cos(a) * ry * 0.7 + 0.0]);
  }
  gx.push([1, null]); gy.push([1, null]);
  return { gx, gy };
}
const wobble = (amp: number, n: number, start = 0.05, end = 0.95): ChanKeys => {
  const k: ChanKeys = [[0, null]];
  for (let i = 0; i < n; i++) k.push([start + ((end - start) * i) / (n - 1), i % 2 === 0 ? -amp : amp]);
  k.push([1, null]);
  return k;
};
const hold = (v: number, a = 0.2, b = 0.8, start = 0): ChanKeys => [[0, start === 0 ? null : start], [a, v], [b, v], [1, null]];
const mw = (a = 0.2, b = 0.85): ChanKeys => [[0, 0], [a, 1], [b, 1], [1, 0]];
const blinkAt = (t: number, w = 0.07): ChanKeys => [[0, 0], [t - w, 0], [t, 1], [t + w, 0], [1, 0]];
const circ = circle(0.1, 0.9, 16, 0.85, 0.9);
const circR = circle(0.1, 0.9, 16, 0.85, 0.9, true);

MOTION_LIBRARY.push(
  { id: 'nod', label: '끄덕임', desc: 'Nod yes', channels: { gy: [[0, null], [0.2, 0.55], [0.4, 0], [0.6, 0.55], [0.8, 0], [1, null]] }, defaults: d(1200) },
  { id: 'shakeNo', label: '아니요', desc: 'Shake no', channels: { gx: wobble(0.6, 6) }, defaults: d(1300) },
  { id: 'surprise', label: '놀람', desc: 'Wide-eyed surprise', mood: 'surprised', channels: { mw: mw(0.1, 0.85), op: [[0, 1], [0.1, 1.15], [0.8, 1.15], [1, 1]], gy: [[0, null], [0.1, -0.25], [0.8, -0.25], [1, null]] }, defaults: d(1600, { easing: 'easeOut' }) },
  { id: 'cry', label: '울먹임', desc: 'Welling up', mood: 'sad', channels: { mw: mw(0.2, 0.9), gy: hold(0.4, 0.25, 0.85), gx: wobble(0.06, 8), bl: [[0, 0], [0.4, 0], [0.5, 0.5], [0.6, 0], [1, 0]], br: [[0, 0], [0.4, 0], [0.5, 0.5], [0.6, 0], [1, 0]] }, defaults: d(3000) },
  { id: 'shy', label: '수줍음', desc: 'Look away shyly', mood: 'shy', channels: { mw: mw(0.2, 0.85), gx: hold(0.7, 0.25, 0.75), gy: hold(0.35, 0.25, 0.75), bl: blinkAt(0.5, 0.1), br: blinkAt(0.5, 0.1) }, defaults: d(2600) },
  { id: 'proud', label: '우쭐', desc: 'Chin-up smug look', mood: 'smug', channels: { mw: mw(0.2, 0.85), gy: hold(-0.35, 0.25, 0.8), gx: hold(0, 0.25, 0.8) }, defaults: d(2400) },
  { id: 'thinking', label: '생각 중', desc: 'Look up and aside, thinking', mood: 'attentive', channels: { mw: mw(0.2, 0.85), gx: hold(0.55, 0.2, 0.8), gy: hold(-0.6, 0.2, 0.8), bl: blinkAt(0.55) , br: blinkAt(0.55) }, defaults: d(3000) },
  { id: 'excited', label: '신남', desc: 'Bouncy and bright', mood: 'excited', channels: { mw: mw(0.12, 0.88), gy: bob(0.1, 0.9, 12, 0.22, -0.3) }, defaults: d(2000) },
  { id: 'yawn', label: '하품', desc: 'Sleepy yawn', mood: 'sleepy', channels: { mw: mw(0.25, 0.8), bl: [[0, 0], [0.3, 0.5], [0.5, 1], [0.7, 1], [1, 0]], br: [[0, 0], [0.3, 0.5], [0.5, 1], [0.7, 1], [1, 0]], gy: [[0, null], [0.3, -0.25], [0.7, 0.1], [1, null]] }, defaults: d(2600) },
  { id: 'squint', label: '찡그림', desc: 'Squint and glare', mood: 'irritated', channels: { mw: mw(0.15, 0.85), gx: hold(0, 0.2, 0.85) }, defaults: d(1800) },
  { id: 'glare', label: '노려보기', desc: 'Angry stare', mood: 'angry', channels: { mw: mw(0.15, 0.9), gx: hold(0, 0.2, 0.9), gy: hold(0.05, 0.2, 0.9) }, defaults: d(2200) },
  { id: 'happyWink', label: '윙크 (웃음)', desc: 'Smiling wink', mood: 'happy', channels: { mw: mw(0.15, 0.85), bl: [[0, 0], [0.35, 0], [0.45, 1], [0.7, 1], [0.8, 0], [1, 0]] }, defaults: d(1500) },
  { id: 'rollEyes', label: '눈 굴리기', desc: 'Roll eyes clockwise', mood: 'bored', channels: { gx: circ.gx, gy: circ.gy, mw: mw(0.1, 0.9) }, defaults: d(2400) },
  { id: 'rollEyesBack', label: '눈 굴리기 ↺', desc: 'Roll eyes counter-clockwise', channels: { gx: circR.gx, gy: circR.gy }, defaults: d(2400) },
  { id: 'sideGlance', label: '곁눈질', desc: 'Suspicious sideways glance', mood: 'suspicious', channels: { mw: mw(0.15, 0.85), gx: hold(0.9, 0.2, 0.8), gy: hold(0.05, 0.2, 0.8) }, defaults: d(2200) },
  { id: 'peek', label: '살짝 엿보기', desc: 'Quick peek and back', channels: { gx: [[0, null], [0.18, 0.9], [0.4, 0.9], [0.55, null], [1, null]], bl: blinkAt(0.7), br: blinkAt(0.7) }, defaults: d(1600) },
  { id: 'tripleBlink', label: '연속 깜빡', desc: 'Three quick blinks', channels: { bl: [[0, 0], [0.08, 1], [0.16, 0], [0.34, 0], [0.42, 1], [0.5, 0], [0.68, 0], [0.76, 1], [0.84, 0], [1, 0]], br: [[0, 0], [0.08, 1], [0.16, 0], [0.34, 0], [0.42, 1], [0.5, 0], [0.68, 0], [0.76, 1], [0.84, 0], [1, 0]] }, defaults: d(1100, { transition: 0 }) },
  { id: 'closeEyes', label: '눈 감기', desc: 'Close eyes for a moment', channels: { bl: [[0, 0], [0.25, 1], [0.75, 1], [1, 0]], br: [[0, 0], [0.25, 1], [0.75, 1], [1, 0]] }, defaults: d(1800) },
  { id: 'sleepyBlink', label: '졸린 깜빡임', desc: 'Slow drowsy blinks', mood: 'sleepy', channels: { mw: mw(0.1, 0.9), bl: [[0, 0], [0.2, 0.9], [0.3, 0.2], [0.55, 0.2], [0.7, 1], [0.85, 0.4], [1, 0]], br: [[0, 0], [0.2, 0.9], [0.3, 0.2], [0.55, 0.2], [0.7, 1], [0.85, 0.4], [1, 0]] }, defaults: d(2600) },
  { id: 'worry', label: '걱정', desc: 'Anxious trembling gaze', mood: 'worried', channels: { mw: mw(0.15, 0.9), gx: wobble(0.14, 12, 0.15, 0.85), gy: hold(0.1, 0.2, 0.85) }, defaults: d(2400) },
  { id: 'sweep', label: '훑어보기 ▶', desc: 'Scan left to right', channels: { gx: [[0, null], [0.15, -0.9], [0.85, 0.9], [1, null]] }, defaults: d(2400) },
  { id: 'sweepBack', label: '훑어보기 ◀', desc: 'Scan right to left', channels: { gx: [[0, null], [0.15, 0.9], [0.85, -0.9], [1, null]] }, defaults: d(2400) },
  { id: 'scanVertical', label: '위아래 훑기', desc: 'Scan up and down', channels: { gy: [[0, null], [0.15, -0.9], [0.5, 0.9], [0.85, -0.2], [1, null]] }, defaults: d(2200) },
  { id: 'upLeft', label: '왼쪽 위 보기', desc: 'Look up-left', channels: { gx: hold(-0.9, 0.25, 0.7), gy: hold(-0.8, 0.25, 0.7) }, defaults: d(1500) },
  { id: 'upRight', label: '오른쪽 위 보기', desc: 'Look up-right', channels: { gx: hold(0.9, 0.25, 0.7), gy: hold(-0.8, 0.25, 0.7) }, defaults: d(1500) },
  { id: 'downLeft', label: '왼쪽 아래 보기', desc: 'Look down-left', channels: { gx: hold(-0.9, 0.25, 0.7), gy: hold(0.8, 0.25, 0.7) }, defaults: d(1500) },
  { id: 'downRight', label: '오른쪽 아래 보기', desc: 'Look down-right', channels: { gx: hold(0.9, 0.25, 0.7), gy: hold(0.8, 0.25, 0.7) }, defaults: d(1500) },
  { id: 'focusStare', label: '정면 응시', desc: 'Steady focused stare ahead', mood: 'attentive', channels: { mw: mw(0.2, 0.85), gx: hold(0, 0.2, 0.9), gy: hold(0, 0.2, 0.9) }, defaults: d(3000) },
  { id: 'glanceLeftQuick', label: '왼쪽 힐끗', desc: 'Quick glance left', channels: { gx: [[0, null], [0.12, -0.95], [0.3, -0.95], [0.42, null], [1, null]] }, defaults: d(1000) },
  { id: 'glanceRightQuick', label: '오른쪽 힐끗', desc: 'Quick glance right', channels: { gx: [[0, null], [0.12, 0.95], [0.3, 0.95], [0.42, null], [1, null]] }, defaults: d(1000) },
  { id: 'lookDownSad', label: '고개 숙임', desc: 'Lower gaze, downcast', mood: 'sad', channels: { mw: mw(0.2, 0.85), gy: hold(0.7, 0.25, 0.8), gx: hold(0, 0.25, 0.8) }, defaults: d(2400) },
  { id: 'joyBounce', label: '기쁨 반짝', desc: 'Happy sparkle', mood: 'happy', channels: { mw: mw(0.12, 0.88), op: [[0, 1], [0.2, 1.1], [0.35, 1], [0.5, 1.1], [0.65, 1], [1, 1]], gy: bob(0.1, 0.8, 6, -0.1, -0.35) }, defaults: d(1800) },
);

export const MOTION_BY_ID: Record<string, MotionDef> = Object.fromEntries(MOTION_LIBRARY.map((m) => [m.id, m]));

export const defaultMotionSettings = (id: string): MotionSettings => ({ ...(MOTION_BY_ID[id]?.defaults ?? d(1000)) });

export function makeMotionEvent(motionId: string, t: number, overrides: Partial<MotionEvent> = {}, settings?: MotionSettings): MotionEvent {
  const s = settings ?? defaultMotionSettings(motionId);
  const def = MOTION_BY_ID[motionId];
  return {
    id: uid('mo'), t, motionId, duration: s.duration, speed: s.speed, intensity: s.intensity, loop: s.loop,
    loopCount: s.loopCount, easing: s.easing, transition: s.transition, dirX: def?.dirX ?? 1, dirY: def?.dirY ?? 1, ...overrides,
  };
}

export const motionTotalMs = (e: MotionEvent, globalSpeed = 1) =>
  (e.duration / Math.max(0.05, e.speed * globalSpeed)) * (e.loop ? Math.max(1, e.loopCount) : 1);

// ------------------------------------------------------------- scenarios

const E = { type: 'easeInOut' as EaseType };
const nk = (t: number, v: number): NumKey => ({ id: uid('k'), t, v, ease: { ...E } });
const mk = (t: number, mood: MoodId, strength: number): MoodKey => ({ id: uid('k'), t, mood, strength, ease: { ...E } });
const bk = (t: number, kind: BlinkEvent['kind'], duration = 360, strength = 1): BlinkEvent => ({ id: uid('b'), t, kind, duration, strength });

export interface BuiltinScenario { id: string; name: string; subtitle: string; description: string; build: () => Timeline }

export const BUILTIN_SCENARIOS: BuiltinScenario[] = [
  {
    id: 'scn-hospitality', name: 'Scenario 01 — Hospitality', subtitle: 'Passenger boarding',
    description: 'Slowly opens eyes → looks toward the passenger → one soft blink → returns to default.',
    build: () => {
      const tl = emptyTimeline(7500);
      tl.tracks.motions.push(
        makeMotionEvent('wakeUp', 0, { duration: 2600, speed: 1 }),
        makeMotionEvent('gentleGreeting', 2900, { duration: 3200, dirX: 1 }),
      );
      tl.tracks.blinks.push(bk(5200, 'slow', 520));
      tl.tracks.mood.push(mk(0, 'default', 100), mk(3200, 'happy', 45), mk(6200, 'default', 100));
      tl.tracks.gazeX.push(nk(0, 0));
      tl.tracks.gazeY.push(nk(0, 0));
      return tl;
    },
  },
  {
    id: 'scn-reassurance', name: 'Scenario 02 — Reassurance', subtitle: 'Road work / obstacle ahead',
    description: 'Eyes move forward → hold gaze → short scan around → return to passenger → soft reassuring look.',
    build: () => {
      const tl = emptyTimeline(9000);
      tl.tracks.gazeX.push(nk(0, 0.45), nk(600, 0), nk(2000, 0), nk(4300, 0.45), nk(9000, 0.45));
      tl.tracks.gazeY.push(nk(0, 0.12), nk(600, -0.08), nk(2000, -0.08), nk(4300, 0.12), nk(9000, 0.12));
      tl.tracks.mood.push(mk(0, 'default', 100), mk(700, 'attentive', 85), mk(4300, 'attentive', 40), mk(5300, 'reassuring', 100), mk(8600, 'default', 100));
      tl.tracks.motions.push(
        makeMotionEvent('lookAround', 2100, { duration: 1900, intensity: 0.55 }),
        makeMotionEvent('reassuringBlink', 5500, { duration: 1100 }),
      );
      return tl;
    },
  },
  {
    id: 'scn-social-care', name: 'Scenario 03 — Social Care', subtitle: 'Seat belt released',
    description: 'Looks toward that passenger → quiet focus → short guiding blink → returns to default.',
    build: () => {
      const tl = emptyTimeline(6800);
      tl.tracks.gazeX.push(nk(0, 0), nk(500, -0.7), nk(4300, -0.7), nk(5200, 0), nk(6800, 0));
      tl.tracks.gazeY.push(nk(0, 0), nk(500, 0.15), nk(4300, 0.15), nk(5200, 0), nk(6800, 0));
      tl.tracks.mood.push(mk(0, 'default', 100), mk(900, 'attentive', 90), mk(4800, 'attentive', 90), mk(5600, 'default', 100));
      tl.tracks.blinks.push(bk(3300, 'blink', 380));
      return tl;
    },
  },
];

export function isBuiltinMotion(id: string) { return id in MOTION_BY_ID; }
