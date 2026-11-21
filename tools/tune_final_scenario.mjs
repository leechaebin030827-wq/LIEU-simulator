import fs from 'node:fs';

const path = 'examples/08_exhibition_final.lieu.json';
const seq = JSON.parse(fs.readFileSync(path, 'utf8'));
const key = (id, tSec, value, last = false) => ({ id, tSec, value, interpolationToNext: last ? 'hold' : 'smoothstep' });
const track = (prefix, points) => ({ kind: 'numeric', keys: points.map(([t, v], i) => key(`${prefix}_${i}`, t, v, i === points.length - 1)) });

// Same 82.24 s master-video timing, expressed as a calm service partner:
// one deliberate gesture per story beat, long rests, and no decorative oscillation.
seq.notes = '[SERVICE_V6] 전시 통합 영상 82.24초에 맞춘 서비스 시퀀스. 오른쪽 탑승 안내 후 정면 복귀, 젠틀한 링 호흡과 좌우 착석 확인, 전 자세 0도 복귀, 시작 버튼 입력 뒤 웃는 눈으로 회전하며 출발을 알립니다.';
seq.tracks.motion.railX = track('rail', [
  [0, -0.12], [14.2, -0.12], [18.4, -0.08],
  [40.5, -0.08], [43.5, -0.02], [47, -0.02], [49.5, -0.07],
  [69, -0.07], [72, -0.04], [78.5, -0.04], [82.24, -0.07],
]);
seq.tracks.motion.bodyYaw = track('body', [
  [0, 0], [6.4, 0], [7.4, -12], [8.4, -12], [9.8, 12], [10.8, 12], [12, 0],
  [14.2, 0], [18.4, 165], [19, 165], [23.2, 0], [25.5, 0], [40, 0],
  [48, 0], [50.5, 6], [54, 6], [57, 0], [69, 0],
  [72, 8], [78.5, 8], [81, 0], [82.24, 0],
]);
seq.tracks.motion.yawY = track('yaw', [
  [0, 90], [3.7, 90], [6.4, 0],
  [7.4, -18], [8.4, -18], [9.8, 18], [10.8, 18], [12, 0],
  [14.2, 0], [25.5, 0], [40, 0],
  [42.2, -18], [43.7, -18], [46, 18], [47.2, 18], [48.5, 0],
  [50.5, 12], [53.5, 12], [55.5, 0], [69, 0],
  [71.5, -10], [73.5, 0], [76, 10], [78, 0], [82.24, 0],
]);
seq.tracks.motion.tiltZ = track('tilt', [
  [0, 0], [6.4, 0], [7.4, 0], [8.2, -8], [8.8, -8],
  [9.8, -3], [10.6, -8], [11.2, -8], [12, 0],
  [14.2, 0], [25.5, 0], [40, -6],
  [42.2, -3], [44, -3], [46, -5], [48.5, -6],
  [50.5, -4], [53.5, -4], [55.5, -6], [69, -6],
  [79, -6], [80, -11], [81.2, -11], [82.24, -6],
]);

// The projector is body-mounted. Aim the artwork itself 90 degrees to the
// right, then finish its fade before the yaw head starts returning at 3.7 s.
const welcome = seq.tracks.projector.clips.find((clip) => clip.id === 'proj_welcome');
if (welcome) { welcome.fromSec = 0.7; welcome.toSec = 3.7; welcome.assetId = 'media/welcome.svg'; }
const projectorOpacity = seq.tracks.projector.properties.opacity.keys;
const welcomeHold = projectorOpacity.find((item) => item.id === 'proj_op_3');
const welcomeOff = projectorOpacity.find((item) => item.id === 'proj_op_4');
if (welcomeHold) { welcomeHold.tSec = 3; welcomeHold.value = 0.78; }
if (welcomeOff) { welcomeOff.tSec = 3.7; welcomeOff.value = 0; }
const projectorRotation = seq.tracks.projector.properties.rotationDeg.keys[0];
// The projected screen's readable front is body-right +90° in the preview.
// The HIDE LAB artwork itself therefore needs no additional rotation.
if (projectorRotation) projectorRotation.value = 0;

seq.tracks.ring24.brightness = track('br', [
  [0, 0.58], [3.7, 0.58], [6.4, 0.68], [12, 0.68], [13.7, 0.85], [15, 0.72], [25.5, 0.68],
  [40, 0.82], [48, 0.78], [57, 0.68], [69, 0.8], [82.24, 0.72],
]);
const fx = (id, type, fromSec, toSec, priority, blend, params, seed = 1) => ({ id, type, fromSec, toSec, seed, priority, blend, params });
seq.tracks.ring24.effects = [
  fx('fx_welcome', 'breathe', 0, 13.7, 0, 'max', { color: [55, 155, 220, 30], speedHz: 0.22 }),
  fx('fx_ready', 'pulse', 13.7, 15, 0, 'max', { color: [35, 210, 135, 30], periodSec: 1.3 }),
  fx('fx_depart', 'breathe', 15, 40, 0, 'max', { color: [35, 125, 210, 26], speedHz: 0.24 }),
  fx('fx_construction', 'breathe', 40, 48, 0, 'max', { color: [230, 135, 35, 28], speedHz: 0.38 }),
  fx('fx_detour', 'wave', 48, 57, 0, 'max', { color: [35, 205, 145, 24], speedHz: 0.32, width: 10, direction: 1 }),
  fx('fx_resume', 'breathe', 57, 69, 0, 'max', { color: [40, 145, 215, 26], speedHz: 0.24 }),
  fx('fx_evening', 'breathe', 69, 82.24, 0, 'max', { color: [135, 95, 205, 24], speedHz: 0.28 }),
];
seq.tracks.eyes.intensity = track('eye_i', [[0, 0.78], [6.4, 0.86], [12, 0.82], [13.7, 0.9], [25.5, 0.82], [40, 0.92], [57, 0.84], [69, 0.88], [82.24, 0.82]]);

const HAPPY = [0, 0, 24, 36, 66, 0, 0, 0];
const L = { open: [0, 16, 56, 56, 56, 56, 16, 0], soft: [0, 0, 16, 56, 56, 16, 0, 0], left: [0, 32, 112, 112, 112, 112, 32, 0], right: [0, 8, 28, 28, 28, 28, 8, 0] };
const R = { open: [0, 8, 28, 28, 28, 28, 8, 0], soft: [0, 0, 8, 28, 28, 8, 0, 0], left: [0, 16, 56, 56, 56, 56, 16, 0], right: [0, 4, 14, 14, 14, 14, 4, 0] };
const eyeTrack = (prefix, points) => ({ kind: 'hold', keys: points.map(([tSec, value], i) => ({ id: `${prefix}_${i}`, tSec, value, interpolationToNext: 'hold' })) });
seq.tracks.eyes.left = eyeTrack('eye_l', [[0, L.open], [3.7, L.open], [7.4, L.left], [8.2, HAPPY], [8.8, L.left], [9.8, L.right], [10.6, HAPPY], [11.2, L.right], [12, L.open], [13.7, HAPPY], [23.2, L.soft], [23.5, L.open], [42.2, L.left], [46, L.right], [48.5, L.open], [72.5, L.soft], [72.8, L.open], [79.7, L.soft], [80, L.open], [82.24, L.open]]);
seq.tracks.eyes.right = eyeTrack('eye_r', [[0, R.open], [3.7, R.open], [7.4, R.left], [8.2, HAPPY], [8.8, R.left], [9.8, R.right], [10.6, HAPPY], [11.2, R.right], [12, R.open], [13.7, HAPPY], [23.2, R.soft], [23.5, R.open], [42.2, R.left], [46, R.right], [48.5, R.open], [72.5, R.soft], [72.8, R.open], [79.7, R.soft], [80, R.open], [82.24, R.open]]);

const seatbelt = seq.tracks.events.find((event) => event.id === 'mark_seatbelt_check');
if (seatbelt) { seatbelt.tSec = 6.4; seatbelt.payload.label = '좌우 승객 착석 확인 / 눈맞춤과 미소'; }

const json = `${JSON.stringify(seq, null, 2)}\n`;
fs.writeFileSync(path, json);
fs.writeFileSync('public/examples/08_exhibition_final.lieu.json', json);

for (const ch of ['bodyYaw', 'yawY', 'tiltZ']) {
  const keys = seq.tracks.motion[ch].keys;
  let maxVel = 0, maxAcc = 0, segment = null;
  for (let i = 1; i < keys.length; i++) {
    const dt = keys[i].tSec - keys[i - 1].tSec;
    const dv = Math.abs(keys[i].value - keys[i - 1].value);
    const vel = 1.5 * dv / dt;
    const acc = 6 * dv / (dt * dt);
    if (vel > maxVel) { maxVel = vel; segment = [keys[i - 1].tSec, keys[i].tSec]; }
    maxAcc = Math.max(maxAcc, acc);
  }
  console.log(`${ch}: peak ${maxVel.toFixed(2)} deg/s, ${maxAcc.toFixed(2)} deg/s^2, segment ${segment.join('-')}s`);
}
