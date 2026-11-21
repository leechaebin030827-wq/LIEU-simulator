// Builds scenario 09 "Smooth Motion": the familiar gestures (nod, shake, curious
// look, bow, look-around, approach) re-authored for the real motors.
//
//   node tools/build_smooth_motion_09.mjs
//
// Smoothness rules, checked by src/__tests__/hardwareMotion.test.ts in raw
// motor units:
// - peak speed <= 65% of the STAGE7 firmware velocity cap per axis;
// - peak acceleration <= the axis' commissioned Profile Acceleration;
// - every gesture starts and ends at rest with a short hold, and fast
//   back-and-forth gestures use few, wide keys instead of many tiny ones;
// - the loop ends in the start pose.
import { readFileSync, writeFileSync } from 'node:fs';

const ID = '09_smooth_motion';
const DURATION = 60;
const HOME = { railX: -0.12, bodyYaw: 0, yawY: 0, tiltZ: 0 };

// Each gesture: [label, start, { channel: [[t, value], ...] }]. Times are
// absolute; every channel not listed holds its home value.
const GESTURES = [
  ['숨쉬기', 3, { tiltZ: [[3, 0], [5.5, -3], [8, 0]] }],
  ['끄덕끄덕', 9, { tiltZ: [[9, 0], [9.7, -8], [10.4, -1], [11.1, -8], [12, 0]] }],
  ['도리도리', 13, { yawY: [[13, 0], [14.1, -10], [15.5, 10], [16.9, -10], [18, 0]] }],
  ['갸웃', 19, {
    yawY: [[19, 0], [20.5, 20], [21.5, 20], [23.9, -20], [24.9, -20], [26.4, 0]],
    tiltZ: [[19, 0], [20.5, -5], [24.9, -5], [26.4, 0]],
  }],
  ['인사', 27, { tiltZ: [[27, 0], [28.2, -10], [29.2, -10], [30.6, 0]] }],
  ['둘러보기', 32, {
    bodyYaw: [[32, 0], [34.5, 30], [35.5, 30], [40.5, -30], [41.5, -30], [44, 0]],
    yawY: [[32, 0], [34.5, 30], [35.5, 30], [40.5, -30], [41.5, -30], [44, 0]],
  }],
  ['다가가서 끄덕', 45, {
    railX: [[45, -0.12], [49, -0.08], [51, -0.08], [55, -0.12]],
    tiltZ: [[49, 0], [49.7, -6], [50.5, 0]],
  }],
];

// Eye shapes in the 08 design language (3 lit columns at most per row).
// Positive yaw turns toward the right-side guest, so the eyes look that way first.
const EYE = {
  open: [[0, 16, 56, 56, 56, 56, 16, 0], [0, 8, 28, 28, 28, 28, 8, 0]],
  happy: [[0, 16, 56, 56, 56, 0, 0, 0], [0, 8, 28, 28, 28, 0, 0, 0]],
  blink: [[0, 0, 0, 56, 56, 0, 0, 0], [0, 0, 0, 28, 28, 0, 0, 0]],
  closed: [[0, 0, 0, 0, 56, 0, 0, 0], [0, 0, 0, 0, 28, 0, 0, 0]],
  lookRight: [[0, 8, 28, 28, 28, 28, 8, 0], [0, 4, 14, 14, 14, 14, 4, 0]],
  lookLeft: [[0, 32, 112, 112, 112, 112, 32, 0], [0, 16, 56, 56, 56, 56, 16, 0]],
};
const BLINK_SEC = 0.12;
const EYES = [
  [0, 'open'], ['blink', 2], ['blink', 6.2],
  [9, 'happy'], [12.3, 'open'],                              // 끄덕끄덕
  [13.6, 'lookLeft'], [14.8, 'lookRight'], [16.2, 'lookLeft'], [17.5, 'open'], ['blink', 18.2], // 도리도리
  [19.6, 'lookRight'], [22.4, 'lookLeft'], [25.6, 'open'],   // 갸웃
  [27.5, 'closed'], [29.3, 'happy'], [31, 'open'],          // 인사
  [33, 'lookRight'], ['blink', 35.6], [37.6, 'lookLeft'], ['blink', 41], [43, 'open'], // 둘러보기
  [48.6, 'happy'], [51.6, 'open'], ['blink', 54],           // 다가가서 끄덕
  ['blink', 57.5],
];

function eyeKeys(side) {
  const keys = [];
  let current = 'open';
  const push = (tSec, shape) => keys.push({ id: `eye_${side ? 'r' : 'l'}_${keys.length}`, tSec, value: EYE[shape][side], interpolationToNext: 'hold' });
  for (const [a, b] of EYES) {
    if (a === 'blink') { push(b, 'blink'); push(+(b + BLINK_SEC).toFixed(3), current); }
    else { current = b; push(a, b); }
  }
  return keys;
}

// Ring: a dim warm base all the time, plus one gesture-colored layer on top.
const fx = (id, type, fromSec, toSec, params, priority = 1) => ({ id, type, fromSec, toSec, seed: 1, priority, blend: 'max', params });
const RING_EFFECTS = [
  fx('fx_base', 'solid', 0, DURATION, { color: [18, 8, 0, 22] }, 0),
  fx('fx_breath', 'breathe', 3, 8, { color: [40, 140, 200, 30], speedHz: 0.2 }),
  fx('fx_nod', 'pulse', 9, 12.5, { color: [40, 200, 90, 20], periodSec: 1.4 }),
  fx('fx_shake', 'breathe', 13, 18.2, { color: [230, 140, 20, 20], speedHz: 0.38 }),
  fx('fx_curious', 'wave', 19, 26.4, { color: [150, 90, 230, 20], speedHz: 0.25, width: 12 }),
  fx('fx_bow', 'breathe', 27, 31, { color: [200, 110, 30, 120], speedHz: 0.25 }),
  fx('fx_look', 'chase', 32, 44, { color: [40, 170, 230, 40], speedHz: 0.12, width: 6 }),
  fx('fx_approach', 'breathe', 45, 55.5, { color: [235, 70, 140, 30], speedHz: 0.2 }),
];

function buildTrack(channel) {
  const pts = [[0, HOME[channel]]];
  for (const [, , moves] of GESTURES) {
    for (const [t, v] of moves[channel] ?? []) {
      const last = pts[pts.length - 1];
      if (t < last[0]) throw new Error(`${channel}: key at ${t} is before ${last[0]}`);
      if (t === last[0]) { if (v !== last[1]) throw new Error(`${channel}: two values at ${t}`); continue; }
      pts.push([t, v]);
    }
  }
  if (pts[pts.length - 1][1] !== HOME[channel]) throw new Error(`${channel}: does not end at home`);
  pts.push([DURATION, HOME[channel]]);
  const prefix = { railX: 'rail', bodyYaw: 'body', yawY: 'yaw', tiltZ: 'tilt' }[channel];
  return {
    kind: 'numeric',
    keys: pts.map(([tSec, value], i) => ({
      id: `${prefix}_${i}`,
      tSec,
      value,
      interpolationToNext: i === pts.length - 1 ? 'hold' : 'smoothstep',
    })),
  };
}

const seq = JSON.parse(readFileSync('examples/06_custom.lieu.json', 'utf8'));
seq.id = ID;
seq.title = '09 Smooth Motion';
seq.durationSec = DURATION;
seq.notes = '[SMOOTH_V1] 끄덕끄덕 · 도리도리 · 갸웃 · 인사 · 둘러보기 · 다가가기를 실제 모터 속도/가속 한계 안에서 다시 짠 모션 전용 시나리오입니다. tools/build_smooth_motion_09.mjs 로 생성합니다.';
seq.tracks.motion = Object.fromEntries(['railX', 'bodyYaw', 'yawY', 'tiltZ'].map((c) => [c, buildTrack(c)]));
for (const key of seq.tracks.ring24.brightness.keys) key.tSec = Math.min(key.tSec, DURATION);
seq.tracks.ring24.effects = RING_EFFECTS;
seq.tracks.eyes.left.keys = eyeKeys(0);
seq.tracks.eyes.right.keys = eyeKeys(1);
seq.tracks.events = GESTURES.map(([label, tSec], i) => ({ id: `gesture_${i}`, tSec, type: 'gesture', payload: { label } }));

const json = `${JSON.stringify(seq, null, 2)}\n`;
for (const dir of ['examples', 'public/examples']) {
  writeFileSync(`${dir}/${ID}.lieu.json`, json);
  console.log(`wrote ${dir}/${ID}.lieu.json`);
}
