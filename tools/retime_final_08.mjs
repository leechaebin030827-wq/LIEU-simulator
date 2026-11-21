// Re-authors scenes of 08 Final Exhibition for the real robot. Applied on top
// of examples/_backup_08_exhibition_final_before_motion_v42.lieu.json; every
// key outside the edited windows (and the video, audio and events) is kept.
//
//   node tools/retime_final_08.mjs
//
// 1. Seat check (6.83-14 s, plays at 0.8x): left guest, eye contact, smile and
//    a blink while holding; sweep to the right guest, same beat; back to the
//    front by 12.17 s so the robot is already watching when the start button
//    appears, presses at 13.75 s and releases at 14.15 s.
// 2. Joy spin (14.2-22.8 s, from the button release): one full turn, read through the face. Heading
//    (body + yaw) can turn at most 270 deg one way, so a real 360 back to the
//    front is impossible. The face (eyes) is what people track: it turns away
//    to the right and fades as it passes the side (~90 deg, still moving);
//    with the face gone it swings back to the far left side (-120 deg), then
//    re-enters from the left still turning right and stops at the front. Exit
//    right + re-enter left = one turn. The tilt waddles the whole time, also
//    during the swing, so nothing levels off; ring spots show only while the
//    face is visible.
// 3. Cruise beat (28.3-34.2 s): the greeting nod comes straight up into a
//    look up-left, today's weather appears on the projector, then back to the
//    front with a small happy smile.
// 4. Construction rail moves toward the monitor (-0.04 m, end of travel).
// 5. Every nod/bow low point goes to -15 deg (the wobble excluded).
// 6. Pace rule for tilt and rail: never crawl.
import { readFileSync, writeFileSync } from 'node:fs';

const SOURCE = 'examples/_backup_08_exhibition_final_before_motion_v42.lieu.json';
const FILES = ['examples/08_exhibition_final.lieu.json', 'public/examples/08_exhibition_final.lieu.json'];
const MARKER = '[MOTION_V53]';
const PREFIX = { railX: 'rail', bodyYaw: 'body', yawY: 'yaw', tiltZ: 'tilt' };

// [channel, fromSec, toSec, keys]: keys strictly inside (from, to) are replaced.
// Keys whose id ends in _wob are wobble, not nods.
const MOTION = [
  ['yawY', 6.833333, 14, [[7.75, -20], [8.95, -20], [9.8, 0], [10.6, 20], [11.2, 20], [12.17, 0]]],
  ['bodyYaw', 6.833333, 14, [[7.75, -22], [8.95, -22], [9.8, 0], [10.6, 22], [11.2, 22], [12.17, 0]]],
  ['tiltZ', 6.833333, 14, [[7.75, -15], [8.95, -15], [9.8, -5], [10.6, -15], [11.2, -15], [12.17, 3], [13.6, 3]]],
  // Starts on the button release. Heading 0 -> 90 (moving, face fades) -> 120 stop | hidden swing
  // -> -120 | -90 (moving, face back) -> 0. Body carries two thirds of the heading, yaw one third.
  ['yawY', 14.2, 23.5, [[15.6, 30], [16.15, 40], [18.65, -40], [19.2, -30], [20.7, 0]]],
  ['bodyYaw', 14.2, 23.5, [[15.6, 60], [16.15, 80], [18.65, -80], [19.2, -60], [20.7, 0]]],
  // Waddle: one rock every 0.84 s from the release to the settle, never levelling - also while
  // the face is away, so the hidden swing never shows as a "level off and re-seat".
  ['tiltZ', 14.2, 23.5, [...[-10, 13, -15, 15, -15, 15, -15, 12, -8, 4].map((v, k) => [+(14.62 + 0.84 * k).toFixed(2), v]), [22.8, 0]]
    .map(([t, v]) => [t, v, 'wob'])],
  // Greeting nod comes up straight into a look up-left ("nice weather today").
  ['yawY', 23.5, 38.4, [[28.6, 0], [29.9, -35], [31.7, -35], [33.1, 0]]],
  ['bodyYaw', 24.95, 38.4, [[28.6, 0], [29.9, -10], [31.7, -10], [33.1, 0]]],
  ['tiltZ', 28.33, 38.4, [[29.9, 12], [31.7, 12], [33.1, 0], [33.6, 4], [34.2, 0]]],
  // Night aegyo (63-79.5 s), as if it put on an upbeat song (~120 BPM, a beat = 0.5 s): once it is
  // night the head drops as low as it goes (-15 deg) and stays there, shyly looking left and right
  // every bar with a small bob on each beat (never above -11), a slower heartbeat bob with the heart
  // eyes, then home to the front. Dance tilt keys are tagged so they stay bobs.
  ['yawY', 63, 79.5, [[63.5, 0], [64.5, -12], [65.5, 12], [66.5, -12], [67.5, 12], [68.5, -12], [69.5, 12], [70.2, 0],
    [71.2, -6], [72.2, 6], [73, 0], [73.5, -12], [74.5, 12], [75.5, -12], [76.5, 12], [77.5, -12], [78.4, 5], [79.2, 0]]],
  ['bodyYaw', 63, 79.5, [[63.5, 0], [64.5, -8], [65.5, 8], [66.5, -8], [67.5, 8], [68.5, -8], [69.5, 8], [70.2, 0],
    [71.2, -4], [72.2, 4], [73, 0], [73.5, -8], [74.5, 8], [75.5, -8], [76.5, 8], [77.5, -8], [78.4, 3], [79.2, 0]]],
  ['tiltZ', 63, 79.5, [[64.2, -15], ...[64.5, 65.5, 66.5, 67.5, 68.5, 69.5].flatMap((t) => [[t, -15], [t + 0.5, -11]]),
    ...[70.45, 71.35, 72.25].flatMap((t) => [[t, -15], [t + 0.45, -12]]),
    ...[73.5, 74.5, 75.5, 76.5, 77.5].flatMap((t) => [[t, -15], [t + 0.5, -11]]), [79.3, 0]].map(([t, v]) => [t, v, 'wob'])],
  // Positive railX moves toward the monitor; -0.04 m is the calibrated end of travel.
  ['railX', 40.2, 47, [[43, -0.04], [43.9, -0.04]]],
];

// Eyes (both sides), replaced strictly inside the windows.
const SHAPES = {
  open: [[0, 16, 56, 56, 56, 56, 16, 0], [0, 8, 28, 28, 28, 28, 8, 0]],
  smile: [[0, 16, 56, 56, 56, 0, 0, 0], [0, 8, 28, 28, 28, 0, 0, 0]],
  half: [[0, 0, 16, 56, 56, 0, 0, 0], [0, 0, 8, 28, 28, 0, 0, 0]],
  closed: [[0, 0, 0, 56, 56, 0, 0, 0], [0, 0, 0, 28, 28, 0, 0, 0]],
  upLeft: [[32, 112, 112, 112, 112, 32, 0, 0], [16, 56, 56, 56, 56, 16, 0, 0]],
  // Mini hearts that fit the three-column eyes; alternating them makes the heart beat.
  heart: [[0, 40, 56, 56, 16, 0, 0, 0], [0, 20, 28, 28, 8, 0, 0, 0]],
  heartSmall: [[0, 0, 40, 56, 16, 0, 0, 0], [0, 0, 20, 28, 8, 0, 0, 0]],
  winkLeft: [[0, 0, 0, 0, 56, 0, 0, 0], [0, 8, 28, 28, 28, 0, 0, 0]],
};
const blink = (t, back) => [[t, 'half'], [+(t + 0.07).toFixed(3), 'closed'], [+(t + 0.19).toFixed(3), back]];
const EYES = [
  [6.84, 23.49, [
    [7.75, 'open'], [7.95, 'smile'], ...blink(8.4, 'smile'),     // left guest: contact, smile, blink
    [9, 'open'], [10.6, 'open'], [10.75, 'smile'], ...blink(10.9, 'smile'), // right guest, same beat
    [11.2, 'open'], [13.75, 'smile'],                              // watch the button, joy on press
  ]],
  [27.83, 38.39, [
    [29, 'upLeft'], ...blink(31, 'upLeft'), [32.6, 'open'], [33.2, 'smile'], [34.8, 'open'], ...blink(36.5, 'open'),
  ]],
  // Night aegyo: smiling, a wink each verse, beating heart eyes while it looks down.
  [62.9, 79.49, [
    [63, 'smile'], [66, 'winkLeft'], [66.3, 'smile'],
    ...[70, 70.45, 70.9, 71.35, 71.8, 72.25, 72.7].map((t, i) => [t, i % 2 ? 'heartSmall' : 'heart']),
    [73, 'smile'], [76, 'winkLeft'], [76.3, 'smile'],
  ]],
];
// Eye intensity inside (from, to): the face fades as it passes the right side
// and comes back as it reaches the left side.
const INTENSITY = [[13.76, 23.49, [[15.35, 0.9], [15.6, 0], [18.95, 0], [19.2, 0.9]]]];

// Ring layers on top of the existing scene colours (appended so scene lookups keep their order).
const fx = (id, type, fromSec, toSec, params) => ({ id, type, fromSec, toSec, seed: 1, priority: 1, blend: 'max', params });
const RING = [
  // Two warm spots fixed on the ring, only while the face is visible: they show the turn, and are
  // gone during the hidden swing so nothing on the donut is seen turning back.
  ...[[14.2, 15.6, 'out'], [18.95, 20.7, 'in']].flatMap(([from, to, tag]) => [0, 12].map((phase, k) =>
    fx(`fx_spin_spot_${tag}_${k}`, 'chase', from, to, { color: [255, 200, 80, 40], speedHz: 0, width: 4, direction: 1, phase }))),
  fx('fx_weather_sun', 'breathe', 29.9, 34.6, { color: [255, 170, 40, 30], speedHz: 0.3 }),
];
// Night dance lighting (replaces every ring effect that starts in 63-79.5 s): a soft
// light-pink breath under everything, pink/lavender waves while it dances, a heartbeat
// pulse for the heart eyes, and twinkles in the last verse.
const NIGHT = { from: 63, to: 79.5 };
const night = (id, type, fromSec, toSec, params, priority = 1) => ({ ...fx(id, type, fromSec, toSec, params), priority });
const NIGHT_RING = [
  night('fx_night_pink', 'breathe', 63, 79.5, { color: [255, 150, 190, 50], speedHz: 0.5 }, 0),
  night('fx_night_wave_pink', 'wave', 63.5, 70, { color: [255, 110, 170, 30], speedHz: 0.5, width: 24, direction: 1 }),
  night('fx_night_wave_lilac', 'wave', 63.5, 70, { color: [190, 150, 255, 20], speedHz: 0.5, width: 24, direction: -1 }),
  night('fx_night_heartbeat', 'pulse', 70, 73, { color: [255, 60, 110, 20], periodSec: 0.9 }),
  night('fx_night_wave_end', 'wave', 73, 79.5, { color: [255, 120, 180, 40], speedHz: 0.5, width: 24, direction: 1 }),
  night('fx_night_twinkle', 'sparkle', 73, 79.5, { color: [255, 220, 240, 120], rateHz: 6, density: 0.15 }),
];
// Projector: stars while dancing, hearts with the heart eyes.
const NIGHT_PROJECTOR = [
  ['media/aegyo_stars_1.svg', 63, 70], ['media/aegyo_hearts.svg', 70, 73.5], ['media/aegyo_stars_3.svg', 73.5, 79.5],
];

// UI click when the on-screen start button is pressed (screen_button pressDown 13.75 s).
// nativeRate keeps its pitch although 08 plays at 0.8x before drive start. The file already
// peaks at full scale, so it plays at gain 1.
const START_BUTTON_SOUND = {
  id: 'start_button_press', fromSec: 13.75, toSec: 14.6, assetId: 'media/sfx_start_button.mp3',
  mediaOffsetSec: 0, gain: 1, fadeInSec: 0, fadeOutSec: 0, loop: false, nativeRate: true,
};
// Deep chime as the detour route appears on the projector (proj_detour_1, 47 s). The file
// peaks at only ~0.3, so it plays at gain 3 (peak ~0.92).
const DETOUR_CHIME = {
  id: 'detour_chime', fromSec: 47, toSec: 49.2, assetId: 'media/sfx_detour_chime.mp3',
  mediaOffsetSec: 0, gain: 3, fadeInSec: 0, fadeOutSec: 0, loop: false, nativeRate: true,
};
// A soft UI tick on every blink: wherever either eye closes (two lit rows or fewer, coming
// from an open eye), across the whole scenario. The file's attack starts ~0.066 s in, so the
// clip starts slightly early to land on the closing frame.
// Only the blinks of the opening seat check (eye contact with each guest) get the tick.
const BLINK_SOUND = { assetId: 'media/sfx_blink_ui.mp3', lead: 0.05, length: 1.3, gain: 1, from: 6.833333, to: 14 };
function blinkSounds(eyes) {
  const lit = (rows) => rows.filter((row) => row).length;
  const times = [];
  for (const side of ['left', 'right']) {
    eyes[side].keys.forEach((key, i) => {
      const prev = eyes[side].keys[i - 1];
      if (prev && lit(key.value) <= 2 && lit(prev.value) >= 3 && key.tSec > BLINK_SOUND.from && key.tSec < BLINK_SOUND.to) times.push(key.tSec);
    });
  }
  const unique = [...new Set(times.map((t) => +t.toFixed(3)))].sort((a, b) => a - b)
    .filter((t, i, all) => i === 0 || t - all[i - 1] > 0.15);
  return unique.map((t, i) => ({
    id: `blink_sfx_${i}`, fromSec: +(t - BLINK_SOUND.lead).toFixed(3), toSec: +(t - BLINK_SOUND.lead + BLINK_SOUND.length).toFixed(3),
    assetId: BLINK_SOUND.assetId, mediaOffsetSec: 0, gain: BLINK_SOUND.gain, fadeInSec: 0, fadeOutSec: 0, loop: false, nativeRate: true,
  }));
}
const WEATHER = { id: 'proj_weather', fromSec: 30, toSec: 34.6, assetId: 'media/weather_today.svg', visible: true };
const WEATHER_OPACITY = [[29.6, 0], [30, 0.85], [34.2, 0.85], [34.6, 0]];

const FULL_NOD = -15;
function fullNods(keys) {
  const groups = [];
  for (const k of keys) {
    const g = groups[groups.length - 1];
    if (g && g.value === k.value) g.keys.push(k); else groups.push({ value: k.value, keys: [k] });
  }
  groups.forEach((g, i) => {
    if (g.keys.some((k) => k.id.endsWith('_wob'))) return;
    const prev = groups[i - 1]?.value ?? Infinity, next = groups[i + 1]?.value ?? Infinity;
    if (g.value <= -2 && g.value < prev && g.value < next) for (const k of g.keys) k.value = FULL_NOD;
  });
  return keys;
}

const rateAt = (t) => (t < 14 ? 0.8 : 1); // 08 plays at 0.8x before drive start
const railRaw = (m) => (m <= -0.12 ? 242 + (m + 0.12) * 138200 : 242 + (m + 0.12) * 48387.5);
const PACE = {
  tiltZ: { size: (a, b) => Math.abs(b - a), speed: 12, minSec: 0.5 },
  railX: { size: (a, b) => Math.abs(railRaw(b) - railRaw(a)), speed: 500, minSec: 1 },
};
function pace(channel, keys) {
  const rule = PACE[channel];
  const out = [];
  keys.forEach((a, i) => {
    out.push(a);
    const b = keys[i + 1];
    if (!b || a.interpolationToNext !== 'smoothstep') return;
    const size = rule.size(a.value, b.value);
    if (size < 1e-6) return;
    const realSec = (b.tSec - a.tSec) / rateAt(a.tSec);
    const needSec = Math.max(rule.minSec, size / rule.speed);
    if (realSec <= needSec * 1.05) return;
    out.push({ id: `${a.id}_paced`, tSec: +(a.tSec + needSec * rateAt(a.tSec)).toFixed(3), value: b.value, interpolationToNext: 'smoothstep' });
  });
  return out;
}

const replaceInside = (keys, from, to, added) =>
  [...keys.filter((k) => k.tSec <= from + 1e-6 || k.tSec >= to - 1e-6), ...added].sort((a, b) => a.tSec - b.tSec);

const seq = JSON.parse(readFileSync(SOURCE, 'utf8'));
const motion = seq.tracks.motion;
for (const [channel, from, to, keys] of MOTION) {
  const track = motion[channel];
  if (!track.keys.some((k) => Math.abs(k.tSec - from) < 1e-3) || !track.keys.some((k) => Math.abs(k.tSec - to) < 1e-3)) {
    throw new Error(`${channel}: expected keys at ${from} and ${to}`);
  }
  track.keys = replaceInside(track.keys, from, to, keys.map(([tSec, value, tag], i) => ({
    id: `${PREFIX[channel]}_v45_${from}_${i}${tag ? `_${tag}` : ''}`, tSec, value, interpolationToNext: 'smoothstep',
  })));
}
for (const [from, to, keys] of EYES) {
  ['left', 'right'].forEach((side, s) => {
    const track = seq.tracks.eyes[side];
    track.keys = replaceInside(track.keys, from, to, keys.map(([tSec, shape], i) => ({
      id: `eye_${side[0]}_v45_${from}_${i}`, tSec, value: SHAPES[shape][s], interpolationToNext: 'hold',
    })));
  });
}
for (const [from, to, keys] of INTENSITY) {
  const track = seq.tracks.eyes.intensity;
  track.keys = replaceInside(track.keys, from, to, keys.map(([tSec, value], i) => ({ id: `eye_int_v45_${i}`, tSec, value, interpolationToNext: 'smoothstep' })));
}
seq.tracks.ring24.effects = seq.tracks.ring24.effects.filter((e) => e.fromSec < NIGHT.from || e.fromSec >= NIGHT.to);
seq.tracks.ring24.effects.push(...RING, ...NIGHT_RING);
seq.tracks.projector.clips = [
  ...seq.tracks.projector.clips.filter((c) => c.fromSec < NIGHT.from || c.fromSec >= NIGHT.to),
  ...NIGHT_PROJECTOR.map(([assetId, fromSec, toSec], i) => ({ id: `proj_night_${i}`, fromSec, toSec, assetId, visible: true })),
].sort((a, b) => a.fromSec - b.fromSec);
// No spinning in the night scene any more, so its spin whoosh goes.
seq.tracks.audio = seq.tracks.audio.filter((clip) => clip.id !== 'aegyo_spin');
seq.tracks.audio.push(START_BUTTON_SOUND, DETOUR_CHIME, ...blinkSounds(seq.tracks.eyes));
// The exhibition video's own sound (extracted from the mp4) is muted; the clip stays on the
// timeline so it can be turned back on by raising its gain.
const main = seq.tracks.audio.find((clip) => clip.id === 'exhibition_audio');
main.gain = 0;
delete main.gainTrack;
seq.tracks.projector.clips = [...seq.tracks.projector.clips, WEATHER].sort((a, b) => a.fromSec - b.fromSec);
// The route now tries the alley on the right, finds it closed and carries on straight (detour_1-3 show this).
const EVENT_LABELS = { detour_route: '우측 골목 진입 시도 → 공사로 막힘 → 직진 안내', resume_drive: '직진 주행 재개' };
for (const event of seq.tracks.events) if (EVENT_LABELS[event.type]) event.payload.label = EVENT_LABELS[event.type];
const opacity = seq.tracks.projector.properties.opacity;
opacity.keys = replaceInside(opacity.keys, 3.633333, 47, WEATHER_OPACITY.map(([tSec, value], i) => ({ id: `proj_op_weather_${i}`, tSec, value, interpolationToNext: 'smoothstep' })));

motion.tiltZ.keys = fullNods(motion.tiltZ.keys);
for (const channel of Object.keys(PACE)) motion[channel].keys = pace(channel, motion[channel].keys);

seq.notes += ` ${MARKER} 착석 확인을 눈맞춤·미소·깜빡임 박자에 맞추고 시작 버튼 전에 정면 복귀, 시작 버튼 누를 때 UI 클릭음과 우회경로 투사 때 차임, 전시 영상(mp4) 소리는 음소거, 처음 좌우 살피기 깜빡임에만 효과음, 밤이 되면 고개를 최대한 숙인 채(-15° 근처) 신나는 노래에 맞춰 웃으며 좌우를 보며 애교, 하트 눈·연분홍 조명, 버튼을 떼자마자 뒤뚱뒤뚱 빙그르르 한 바퀴(얼굴이 오른쪽으로 돌아 사라지고, 안 보이는 사이 반대편으로 넘어가 왼쪽에서 다시 나타나 정면에 멈춤, 틸트는 끝까지 계속 흔들림), 인사 끄덕임에서 바로 왼쪽 위를 보고 오늘 날씨 투사 후 미소, 공사 확인 레일은 모니터 쪽 끝(-0.04 m)까지, 숙이는 동작은 -15°, 고개·레일은 느린 이동 없음.`;
for (const file of FILES) {
  writeFileSync(file, `${JSON.stringify(seq, null, 2)}\n`);
  console.log(`wrote ${file}`);
}
