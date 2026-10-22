import type {
  BlinkEvent, Ease, EyeFrame, Mode, MoodKey, MoodVec, NumKey, PixelKey, MorphKey, Project, ShapeKey, Timeline,
} from './types';
import { MOODS, ZERO_MOOD, mixMood, moodVec } from './mood';
import { MOTION_BY_ID, motionTotalMs, type Chan, type ChanKeys } from './motions';
import { applyEase, clamp, clamp01, hash01, lerp, sampleKeys, smoothstep } from './util';

/**
 * EyeController — the single, pure, deterministic source of truth for the eye's *semantic* state.
 * evaluateEye(project, t) always returns the same frame for the same inputs (no Math.random, no Date).
 * Both renderers (Matrix / Freeform) consume the resulting EyeFrame.
 *
 * Layer priority (highest wins): Motion events > Timeline blink events > Keyframed/static base
 *   > Idle drift & micro-saccade (faded out while a motion is active) > Auto blink (suppressed while
 *   any motion/blink event is active, or when the eyes are nearly closed).
 */

// --------------------------------------------------------------- tracks

const sortedIndex = (keys: { t: number }[], t: number) => {
  // index of the last key with key.t <= t, or -1
  let lo = 0, hi = keys.length - 1, ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (keys[mid].t <= t) { ans = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return ans;
};

function evalNum(keys: NumKey[], t: number, fallback: number, overshoot: number): number {
  if (keys.length === 0) return fallback;
  const i = sortedIndex(keys, t);
  if (i < 0) return keys[0].v;
  if (i >= keys.length - 1) return keys[keys.length - 1].v;
  const a = keys[i], b = keys[i + 1];
  const x = (t - a.t) / Math.max(1, b.t - a.t);
  return lerp(a.v, b.v, applyEase(a.ease, x, overshoot));
}

function evalMood(keys: MoodKey[], t: number, fallback: MoodVec): { vec: MoodVec; label: string; id: MoodKey['mood']; strength: number } | null {
  if (keys.length === 0) return null;
  const vecOf = (k: MoodKey) => moodVec(k.mood, k.strength);
  const i = sortedIndex(keys, t);
  if (i < 0) return { vec: vecOf(keys[0]), label: MOODS[keys[0].mood].label, id: keys[0].mood, strength: keys[0].strength };
  const a = keys[i];
  if (i >= keys.length - 1) return { vec: vecOf(a), label: MOODS[a.mood].label, id: a.mood, strength: a.strength };
  const b = keys[i + 1];
  const x = applyEase(a.ease, (t - a.t) / Math.max(1, b.t - a.t));
  const dominant = x < 0.5 ? a : b;
  void fallback;
  return { vec: mixMood(vecOf(a), vecOf(b), x), label: MOODS[dominant.mood].label, id: dominant.mood, strength: lerp(a.strength, b.strength, x) };
}

function evalShape(keys: ShapeKey[], t: number, fb: { sx: number; sy: number; round: number; tilt: number }) {
  if (keys.length === 0) return fb;
  const i = sortedIndex(keys, t);
  if (i < 0) return { sx: keys[0].sx, sy: keys[0].sy, round: keys[0].round, tilt: keys[0].tilt };
  if (i >= keys.length - 1) { const k = keys[keys.length - 1]; return { sx: k.sx, sy: k.sy, round: k.round, tilt: k.tilt }; }
  const a = keys[i], b = keys[i + 1];
  const x = applyEase(a.ease, (t - a.t) / Math.max(1, b.t - a.t));
  return { sx: lerp(a.sx, b.sx, x), sy: lerp(a.sy, b.sy, x), round: lerp(a.round, b.round, x), tilt: lerp(a.tilt, b.tilt, x) };
}

function evalPixel(keys: PixelKey[], t: number) {
  const i = sortedIndex(keys, t);
  return i < 0 ? undefined : { left: keys[i].left, right: keys[i].right };
}

function evalMorph(keys: MorphKey[], t: number) {
  if (keys.length === 0) return undefined;
  const i = sortedIndex(keys, t);
  const pick = (L: number[], R: number[]) => ({ L: L.slice(), R: R.slice() });
  if (i < 0) return pick(keys[0].L, keys[0].R);
  if (i >= keys.length - 1) return pick(keys[keys.length - 1].L, keys[keys.length - 1].R);
  const a = keys[i], b = keys[i + 1];
  const x = applyEase(a.ease, (t - a.t) / Math.max(1, b.t - a.t));
  return pick(a.L.map((v, n) => lerp(v, b.L[n] ?? v, x)), a.R.map((v, n) => lerp(v, b.R[n] ?? v, x)));
}

// ---------------------------------------------------------------- blink

/** Pre-generated (seeded) auto-blink schedule: identical on every run for the same settings. */
const blinkCache = new Map<string, { starts: Float64Array; doubles: Uint8Array }>();
function blinkSchedule(seed: number, intervalS: number, variation: number) {
  const key = `${seed}|${intervalS.toFixed(2)}|${variation.toFixed(2)}`;
  let s = blinkCache.get(key);
  if (s) return s;
  const starts: number[] = [];
  const doubles: number[] = [];
  let t = intervalS * 1000 * (0.55 + 0.45 * hash01(seed, 0, 11));
  for (let i = 0; t < 20 * 60 * 1000 && i < 6000; i++) {
    starts.push(t);
    doubles.push(hash01(seed, i, 29) < 0.12 ? 1 : 0);
    const iv = intervalS * 1000 * (1 + variation * (2 * hash01(seed, i, 7) - 1));
    t += Math.max(600, iv);
  }
  if (blinkCache.size > 24) blinkCache.clear();
  s = { starts: Float64Array.from(starts), doubles: Uint8Array.from(doubles) };
  blinkCache.set(key, s);
  return s;
}

/** closure over one pulse: close for closeFrac of p, hold, open. */
function pulse(p: number, closeFrac: number, holdFrac = 0): number {
  if (p <= 0 || p >= 1) return 0;
  const openStart = closeFrac + holdFrac;
  if (p < closeFrac) return smoothstep(p / closeFrac);
  if (p < openStart) return 1;
  return 1 - smoothstep((p - openStart) / Math.max(0.001, 1 - openStart));
}

function eventClosure(ev: BlinkEvent, t: number, blinkSpeed: number, closeFrac: number, strength: number): [number, number] {
  const dur = ev.duration / Math.max(0.05, blinkSpeed);
  const total = ev.kind === 'double' ? dur * 1.8 : dur;
  const lt = t - ev.t;
  if (lt < 0 || lt > total) return [0, 0];
  const peak = clamp01(ev.strength) * strength;
  let c: number;
  switch (ev.kind) {
    case 'double': { const h = total / 2; c = lt < h ? pulse(lt / h, closeFrac) : pulse((lt - h) / h, closeFrac); break; }
    case 'slow': c = pulse(lt / total, 0.34, 0.24); break;
    case 'winkL': case 'winkR': c = pulse(lt / total, closeFrac, 0.25); break;
    default: c = pulse(lt / total, closeFrac);
  }
  c *= peak;
  return [ev.kind === 'winkR' ? 0 : c, ev.kind === 'winkL' ? 0 : c];
}

// ----------------------------------------------------------------- idle

function idleOffset(t: number, seed: number, speed: number): [number, number] {
  const tt = t * speed;
  const ph = (n: number) => hash01(seed, n, 3) * Math.PI * 2;
  const x = 0.5 * Math.sin(0.00105 * tt + ph(1)) + 0.3 * Math.sin(0.0026 * tt + ph(2)) + 0.2 * Math.sin(0.0047 * tt + ph(3));
  const y = 0.5 * Math.sin(0.0009 * tt + ph(4)) + 0.3 * Math.sin(0.0021 * tt + ph(5));
  return [x * 0.3, y * 0.16];
}

function saccadeOffset(t: number, seed: number, amount: number): [number, number] {
  if (amount <= 0) return [0, 0];
  const SLOT = 380, RISE = 70;
  const slot = Math.floor(t / SLOT);
  const vec = (s: number): [number, number] => hash01(seed, s, 41) < 0.65
    ? [(hash01(seed, s, 43) - 0.5) * 2, (hash01(seed, s, 47) - 0.5) * 1.2] : [0, 0];
  const cur = vec(slot), prev = vec(slot - 1);
  const k = smoothstep((t - slot * SLOT) / RISE);
  return [lerp(prev[0], cur[0], k) * 0.1 * amount, lerp(prev[1], cur[1], k) * 0.1 * amount];
}

// ------------------------------------------------------------- core eval

type Shape = { sx: number; sy: number; round: number; tilt: number };

interface Core {
  gx: number; gy: number; open: number; mood: MoodVec; moodLabel: string; clL: number; clR: number;
  motionActive: boolean; autoBlinking: boolean; active: string[]; base: EyeFrame['base'];
  shape: Shape; flickerX: number; flickerY: number; curiosity: number;
}

function chanSample(keys: ChanKeys, p: number, ease: Ease, nullVal: number, scale: number, overshoot: number): number {
  const mapped: [number, number][] = keys.map(([kt, v]) => [kt, v === null ? nullVal : v * scale]);
  return sampleKeys(mapped, p, ease, overshoot);
}

function core(project: Project, t: number, mode: Mode, tl: Timeline): Core {
  const sh = project.shared;
  const tr = tl.tracks;
  const overshoot = mode === 'freeform' ? project.freeform.geometry.springOvershoot : 0;

  // ---- base layer: keyframes or static params
  const baseGx = evalNum(tr.gazeX, t, sh.gazeX, overshoot);
  const baseGy = evalNum(tr.gazeY, t, sh.gazeY, overshoot);
  const baseOpen = evalNum(tr.openness, t, sh.openness, 0);
  const staticMood = moodVec(sh.mood, sh.moodStrength);
  const moodEval = evalMood(tr.mood, t, staticMood);
  let mood: MoodVec = moodEval ? moodEval.vec : staticMood;
  const baseMoodId = moodEval ? moodEval.id : sh.mood;
  const baseMoodStrength = moodEval ? moodEval.strength : sh.moodStrength;
  let moodLabel = moodEval ? moodEval.label : MOODS[sh.mood].label;
  const baseShape = evalShape(tr.shape, t, { sx: sh.shapeSX, sy: sh.shapeSY, round: sh.shapeRound, tilt: sh.shapeTilt });

  // ---- idle layer (deterministic drift)
  let gx = baseGx, gy = baseGy;
  if (sh.idle && sh.idleSpeed > 0) {
    const [ix, iy] = idleOffset(t, sh.seed, sh.idleSpeed);
    gx += ix; gy += iy;
  }
  const [sx, sy] = saccadeOffset(t, sh.seed, sh.microSaccade);
  gx += sx; gy += sy;

  // ---- motion layer
  let open = baseOpen;
  let clL = 0, clR = 0;
  let aLt = 0, aLb = 0, aSl = 0, aAr = 0;
  let motionW = 0;
  const active: string[] = [];
  for (const ev of tr.motions) {
    const def = MOTION_BY_ID[ev.motionId];
    if (!def) continue;
    const total = motionTotalMs(ev, sh.motionSpeed);
    const lt = t - ev.t;
    if (lt < 0 || lt > total) continue;
    const iters = ev.loop ? Math.max(1, ev.loopCount) : 1;
    const iter = total / iters;
    const p = lt >= total ? 1 : (lt % iter) / iter;
    const trans = Math.min(ev.transition, total / 2);
    const w = trans <= 0 ? 1 : smoothstep(Math.min(lt / trans, (total - lt) / trans, 1));
    const ease: Ease = { type: ev.easing };
    const I = ev.intensity * sh.motionIntensity;
    motionW = Math.max(motionW, w);
    if (w > 0.02) active.push(ev.motionId);
    const ch = def.channels;
    const get = (c: Chan, nullVal: number, scale: number, os = 0) => (ch[c] ? chanSample(ch[c]!, p, ease, nullVal, scale, os) : null);
    const vgx = get('gx', gx, I * ev.dirX, overshoot); if (vgx !== null) gx = lerp(gx, clamp(vgx, -1.2, 1.2), w);
    const vgy = get('gy', gy, I * ev.dirY, overshoot); if (vgy !== null) gy = lerp(gy, clamp(vgy, -1.2, 1.2), w);
    const vbl = get('bl', 0, 1); if (vbl !== null) clL = Math.max(clL, clamp01(vbl) * w);
    const vbr = get('br', 0, 1); if (vbr !== null) clR = Math.max(clR, clamp01(vbr) * w);
    const vop = get('op', 1, 1); if (vop !== null) open *= lerp(1, vop, w);
    const vlt = get('lt', 0, I); if (vlt !== null) aLt += vlt * w;
    const vlb = get('lb', 0, I); if (vlb !== null) aLb += vlb * w;
    const vsl = get('sl', 0, I); if (vsl !== null) aSl += vsl * w;
    const var_ = get('ar', 0, I); if (var_ !== null) aAr += var_ * w;
    const vmw = get('mw', 0, 1);
    if (vmw !== null && def.mood) {
      const blend = clamp01(vmw * w);
      mood = mixMood(mood, moodVec(def.mood, 100 * clamp(I, 0, 1.5)), blend);
      if (blend > 0.5) moodLabel = MOODS[def.mood].label;
    }
  }
  mood = { ...mood, lt: mood.lt + aLt, lb: mood.lb + aLb, sl: mood.sl + aSl, ar: mood.ar + aAr };

  // ---- blink events (timeline)
  const closeT = 0.4 / sh.eyelidCloseSpeed, openT = 0.6 / sh.eyelidOpenSpeed;
  const closeFrac = clamp(closeT / (closeT + openT), 0.15, 0.7);
  const blinkSpeed = sh.blinkSpeed / (closeT + openT);
  let eventActive = false;
  for (const ev of tr.blinks) {
    const [a, b] = eventClosure(ev, t, blinkSpeed, closeFrac, sh.blinkStrength);
    if (a > 0 || b > 0) eventActive = true;
    clL = Math.max(clL, a); clR = Math.max(clR, b);
  }

  // ---- auto blink (lowest priority)
  let autoBlinking = false;
  const openNow = clamp01(open + mood.op);
  if (sh.autoBlink && motionW < 0.05 && !eventActive && openNow > 0.35 && clL === 0 && clR === 0) {
    const sched = blinkSchedule(sh.seed, sh.blinkInterval, sh.blinkVariation);
    const i = lowerBound(sched.starts, t);
    for (let j = Math.max(0, i - 1); j <= i && j < sched.starts.length; j++) {
      const dur = (280 / Math.max(0.05, blinkSpeed)) * (sched.doubles[j] ? 1.8 : 1);
      const lt = t - sched.starts[j];
      if (lt >= 0 && lt <= dur) {
        const c = sched.doubles[j]
          ? (lt < dur / 2 ? pulse(lt / (dur / 2), closeFrac) : pulse((lt - dur / 2) / (dur / 2), closeFrac))
          : pulse(lt / dur, closeFrac);
        const v = c * sh.blinkStrength;
        if (v > 0) { clL = v; clR = v; autoBlinking = true; }
      }
    }
  }

  // ---- flicker (deterministic alternating displacement, as in RoboEyes' H/V flicker concept)
  const fs = Math.floor(t / 55);
  const fsign = fs % 2 === 0 ? 1 : -1;
  const flickerX = sh.flickerH * fsign;
  const flickerY = sh.flickerV * fsign * (hash01(sh.seed, fs, 5) > 0.5 ? 1 : -1);

  return {
    gx: clamp(gx, -1, 1), gy: clamp(gy, -1, 1), open, mood, moodLabel, clL, clR,
    motionActive: motionW >= 0.05, autoBlinking, active, flickerX, flickerY,
    shape: baseShape,
    curiosity: clamp01(sh.curiosity + mood.cur),
    base: { gazeX: baseGx, gazeY: baseGy, openness: baseOpen, mood: baseMoodId, moodStrength: baseMoodStrength, shape: baseShape },
  };
}

function lowerBound(arr: Float64Array, t: number): number {
  // index of last element <= t (0 if none)
  let lo = 0, hi = arr.length - 1, ans = 0;
  while (lo <= hi) { const mid = (lo + hi) >> 1; if (arr[mid] <= t) { ans = mid; lo = mid + 1; } else hi = mid - 1; }
  return ans;
}

// ------------------------------------------------------------- public API

export function evaluateEye(project: Project, tMs: number, mode: Mode = project.mode, timeline: Timeline = project.timeline): EyeFrame {
  const hold = mode === 'matrix' ? project.matrix.geometry.holdMs : 0;
  const t = hold > 0 ? Math.floor(Math.max(0, tMs) / hold) * hold : Math.max(0, tMs);
  const c = core(project, t, mode, timeline);

  let gx = c.gx, gy = c.gy;
  if (mode === 'freeform') {
    // stateless low-pass: average the target over a short trailing window (Gaze Speed)
    const tau = 300 / Math.max(0.5, project.freeform.geometry.gazeSpeed);
    let sx = 0, sy = 0;
    const N = 5;
    for (let k = 0; k < N; k++) {
      const cc = k === 0 ? c : core(project, Math.max(0, t - (k * tau) / (N - 1)), mode, timeline);
      sx += cc.gx; sy += cc.gy;
    }
    gx = sx / N; gy = sy / N;
  }

  const tr = timeline.tracks;
  let symbol: EyeFrame['symbol'];
  for (const ev of tr.symbols ?? []) {
    const lt = t - ev.t;
    if (lt < 0 || lt > ev.duration) continue;
    const fade = Math.max(1, Math.min(ev.fade, ev.duration / 2));
    const w = smoothstep(Math.min(lt / fade, (ev.duration - lt) / fade, 1));
    if (!symbol || w >= symbol.w) symbol = { id: ev.symbol, w };
  }
  const pattern = mode === 'matrix' ? evalPixel(tr.pixel, t) : undefined;
  const morph = mode === 'freeform' ? evalMorph(tr.morph, t) : undefined;

  return {
    t: tMs, mode, gazeX: gx, gazeY: gy,
    openness: clamp(c.open + c.mood.op, 0, 1.2),
    closureL: clamp01(c.clL), closureR: clamp01(c.clR),
    mood: c.mood, moodLabel: c.moodLabel, shape: c.shape, curiosity: c.curiosity,
    flickerX: c.flickerX, flickerY: c.flickerY, pattern, morph, symbol,
    activeMotions: c.active, autoBlinking: c.autoBlinking, base: c.base,
  };
}

export { ZERO_MOOD };
