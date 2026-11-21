import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { evaluateSequenceAt, cuesCrossed, audioGainAt } from '../engine/evaluate';
import { emptySequence, setNumeric, setRingPixels, setEyeBitmap } from '../engine/edit';
import { EYE_PRESETS } from '../engine/eyePresets';
import { migrate, validateSequence, serializeProject, UNKNOWN_CALIBRATION, buildZip, readZip } from '../engine/project';
import { computeStageMatrices } from '../engine/rig';
import { defaultRig } from '../engine/rigDefaults';
import { motionWarnings } from '../engine/limits';
import { downwardFloorHit } from '../engine/projection';
import type { LieuSequence } from '../engine/types';
import { elapsedAtScenarioTime, playbackRateAt, scenarioTimeAtElapsed } from '../runtime/playbackRate';

const ex = (f: string) => JSON.parse(readFileSync(`examples/${f}`, 'utf8'));
// Backups are authoring snapshots, not shipped scenarios. Including every backup
// made the determinism test do the same expensive sequence work dozens of times.
const examples = readdirSync('examples').filter((f) => f.endsWith('.lieu.json') && !f.startsWith('_backup_'));

describe('evaluateSequenceAt', () => {
  it('final exhibition stays aligned and presents the opening welcome to the right-side guest', () => {
    const seq = validateSequence(ex('08_exhibition_final.lieu.json'));
    expect(seq.durationSec).toBeCloseTo(92.24, 2);
    expect(seq.loop).toBe(true);
    const video = seq.tracks.events.find((e) => e.type === 'screen_video');
    expect((video?.payload.clips as { src: string; dur: number }[])[0]).toEqual(expect.objectContaining({
      src: 'assets/LIEU-Exhibition-Scenario-web.mp4', dur: 82.24,
    }));
    expect(seq.tracks.events.filter((e) => ['drive_start', 'construction_stop', 'night_aegyo'].includes(e.type)).map((e) => e.tSec)).toEqual([14, 38.4, 63]);
    expect(seq.notes).toContain('[SERVICE_V40]');
    expect(seq.tracks.motion.bodyYaw?.keys.length).toBeGreaterThan(10);
    expect(Math.max(...(seq.tracks.motion.bodyYaw?.keys.map((k) => Math.abs(k.value)) ?? []))).toBeLessThanOrEqual(180);
    expect(Math.max(...seq.tracks.motion.yawY.keys.map((k) => Math.abs(k.value)))).toBeLessThanOrEqual(90);
    expect(Math.max(...seq.tracks.motion.tiltZ.keys.map((k) => Math.abs(k.value)))).toBeLessThanOrEqual(15);
    const yawKeys = seq.tracks.motion.yawY.keys;
    const peakYawSpeed = Math.max(...yawKeys.slice(3).map((k, i) => 1.5 * Math.abs(k.value - yawKeys[i + 2].value) / (k.tSec - yawKeys[i + 2].tSec)));
    expect(peakYawSpeed).toBeLessThanOrEqual(60.5);
    expect(evaluateSequenceAt(seq, 0).motion).toEqual(expect.objectContaining({ railX: -0.12, bodyYaw: 0, yawY: 90, tiltZ: 0 }));
    expect(evaluateSequenceAt(seq, 3.633333).motion.yawY).toBeCloseTo(90, 1);
    expect(evaluateSequenceAt(seq, 4.783333).motion.yawY).toBeCloseTo(45, 1);
    expect(evaluateSequenceAt(seq, 5.933333).motion).toEqual(expect.objectContaining({ bodyYaw: 0, yawY: 0, tiltZ: 0 }));
    expect(evaluateSequenceAt(seq, 6.833333).motion).toEqual(expect.objectContaining({ bodyYaw: 0, yawY: 0, tiltZ: 0 }));
    expect(seq.notes).toContain('[MOTION_V53]');
    // Seat check: arrive, eye contact, smile, blink while holding; same beat on the right.
    const smileL = [0, 16, 56, 56, 56, 0, 0, 0], closedL = [0, 0, 0, 56, 56, 0, 0, 0];
    const smileR = [0, 8, 28, 28, 28, 0, 0, 0], closedR = [0, 0, 0, 28, 28, 0, 0, 0];
    expect(evaluateSequenceAt(seq, 8.5).motion).toEqual(expect.objectContaining({ bodyYaw: -22, yawY: -20, tiltZ: -15 }));
    expect(evaluateSequenceAt(seq, 8.0).eyes.left).toEqual(smileL);
    expect(evaluateSequenceAt(seq, 8.5).eyes.left).toEqual(closedL);
    expect(evaluateSequenceAt(seq, 8.6).eyes.left).toEqual(smileL);
    expect(evaluateSequenceAt(seq, 10.95).motion).toEqual(expect.objectContaining({ bodyYaw: 22, yawY: 20, tiltZ: -15 }));
    expect(evaluateSequenceAt(seq, 10.8).eyes.right).toEqual(smileR);
    expect(evaluateSequenceAt(seq, 10.99).eyes.right).toEqual(closedR);
    expect(evaluateSequenceAt(seq, 11.1).eyes.right).toEqual(smileR);
    // Back at the front, watching, before the start button appears (12.17) and is pressed (13.75).
    expect(evaluateSequenceAt(seq, 12.17).motion).toEqual(expect.objectContaining({ bodyYaw: 0, yawY: 0, tiltZ: 3 }));
    expect(evaluateSequenceAt(seq, 13.75).eyes.left).toEqual(smileL);
    // UI click on the start button press, at its own pitch.
    const press = seq.tracks.events.find((event) => event.type === 'screen_button')?.payload.pressDown;
    expect(seq.tracks.audio.find((clip) => clip.assetId === 'media/sfx_start_button.mp3')).toEqual(expect.objectContaining({ fromSec: press, nativeRate: true, gain: 1 }));
    // The exhibition video's own sound is muted.
    const mainTrack = seq.tracks.audio.find((clip) => clip.id === 'exhibition_audio')!;
    for (const t of [0, 12, 30, 50, 80]) expect(audioGainAt(mainTrack, t)).toBe(0);
    // Deep chime exactly when the detour route appears on the projector.
    const detour = seq.tracks.projector.clips.find((clip) => clip.assetId === 'media/detour_1.svg')!;
    expect(seq.tracks.audio.find((clip) => clip.assetId === 'media/sfx_detour_chime.mp3')).toEqual(expect.objectContaining({ fromSec: detour.fromSec }));
    // A blink tick only on the seat-check blinks (eye contact with each guest).
    const litRows = (rows: readonly number[]) => rows.filter((row) => row).length;
    const seatClosings = [...new Set((['left', 'right'] as const).flatMap((side) => seq.tracks.eyes[side].keys
      .filter((key, i, keys) => i > 0 && key.tSec > 6.83 && key.tSec < 14 && litRows(key.value) <= 2 && litRows(keys[i - 1].value) >= 3)
      .map((key) => key.tSec)))];
    const blinkSfx = seq.tracks.audio.filter((clip) => clip.assetId === 'media/sfx_blink_ui.mp3');
    expect(seatClosings).toHaveLength(2);
    expect(blinkSfx).toHaveLength(2);
    for (const t of seatClosings) expect(blinkSfx.some((clip) => Math.abs(clip.fromSec + 0.05 - t) < 0.16)).toBe(true);
    expect(evaluateSequenceAt(seq, 14).motion).toEqual(expect.objectContaining({ bodyYaw: 0, yawY: 0, tiltZ: 0 }));
    expect(seq.tracks.ring24.effects.find((effect) => effect.fromSec <= 13 && effect.toSec > 13)?.type).toBe('breathe');
    // Joy spin, read through the face: whenever the eyes are lit the heading
    // (body + yaw) turns right only; the face fades as it passes the right side
    // (~90 deg, still moving), swings back unseen, and comes back lit from the
    // left side (~-90 deg) still turning right, stopping at the front.
    const heading = (t: number) => { const m = evaluateSequenceAt(seq, t).motion; return (m.bodyYaw ?? 0) + m.yawY; };
    const lit = (t: number) => evaluateSequenceAt(seq, t).eyes.intensity > 0.05;
    for (let t = 14.2; t < 20.65; t += 0.05) if (lit(t) || lit(t + 0.05)) expect(heading(t + 0.05)).toBeGreaterThanOrEqual(heading(t) - 1e-9);
    expect(heading(15.6)).toBeCloseTo(90, 0);
    expect(heading(15.6) - heading(15.5)).toBeGreaterThan(3); // still turning when the face goes
    expect(evaluateSequenceAt(seq, 15.6).eyes.intensity).toBeCloseTo(0, 2);
    expect(heading(19.2)).toBeCloseTo(-90, 0);
    expect(heading(19.2) - heading(19.1)).toBeGreaterThan(3); // already turning when the face returns
    expect(evaluateSequenceAt(seq, 19.2).eyes.intensity).toBeCloseTo(0.9, 2);
    for (let t = 16.15; t < 18.6; t += 0.05) expect(heading(t + 0.05)).toBeLessThan(heading(t)); // the unseen swing
    expect(heading(18.65)).toBeCloseTo(-120, 6);
    // The waddle never levels off between the release and the settle, also during the unseen swing.
    for (let t = 14.6; t < 22.2; t += 0.1) {
      const window = [0, 0.15, 0.3, 0.45, 0.6, 0.75].map((d) => Math.abs(evaluateSequenceAt(seq, t + d).motion.tiltZ));
      expect(Math.max(...window)).toBeGreaterThan(3);
    }
    expect(evaluateSequenceAt(seq, 16.3).motion.tiltZ).toBe(-15);
    expect(evaluateSequenceAt(seq, 17.14).motion.tiltZ).toBe(15);
    expect(evaluateSequenceAt(seq, 20.7).motion).toEqual(expect.objectContaining({ bodyYaw: 0, yawY: 0 }));
    expect(seq.tracks.ring24.effects.filter((effect) => effect.id.startsWith('fx_spin_spot'))
      .every((effect) => effect.toSec <= 15.6 || effect.fromSec >= 18.95)).toBe(true);
    expect(evaluateSequenceAt(seq, 23.5).motion).toEqual(expect.objectContaining({ bodyYaw: 0, yawY: 0, tiltZ: 0 }));
    expect(evaluateSequenceAt(seq, 24.66).motion).toEqual(expect.objectContaining({ bodyYaw: 0, yawY: 0, tiltZ: 2 }));
    expect(evaluateSequenceAt(seq, 25.82).eyes.left).toEqual([0, 16, 56, 56, 56, 0, 0, 0]);
    expect(evaluateSequenceAt(seq, 25.82).eyes.right).toEqual([0, 8, 28, 28, 28, 0, 0, 0]);
    expect(evaluateSequenceAt(seq, 26.4).eyes.left).toEqual([0, 16, 56, 56, 56, 0, 0, 0]);
    expect(evaluateSequenceAt(seq, 26.4).eyes.right).toEqual([0, 8, 28, 28, 28, 0, 0, 0]);
    const forbiddenSmileShapes = new Set([
      JSON.stringify([0, 0, 24, 36, 66, 0, 0, 0]),
      JSON.stringify([0, 24, 60, 102, 195, 195, 0, 0]),
    ]);
    expect([...seq.tracks.eyes.left.keys, ...seq.tracks.eyes.right.keys]
      .some((key) => forbiddenSmileShapes.has(JSON.stringify(key.value)))).toBe(false);
    const smileLeftIds = new Set(['eye_l_2', 'eye_l_3', 'eye_l_check_left_open', 'eye_l_4', 'eye_l_5', 'eye_l_6', 'eye_l_check_right_open', 'eye_l_7', 'eye_l_8', 'eye_l_9', 'eye_l_safety_0', 'eye_l_safety_2', 'eye_l_16', 'eye_l_18']);
    const smileRightIds = new Set(['eye_r_2', 'eye_r_3', 'eye_r_check_left_open', 'eye_r_4', 'eye_r_5', 'eye_r_6', 'eye_r_check_right_open', 'eye_r_7', 'eye_r_8', 'eye_r_9', 'eye_r_safety_0', 'eye_r_safety_1', 'eye_r_safety_2', 'eye_r_16', 'eye_r_18']);
    expect(seq.tracks.eyes.left.keys.filter((key) => smileLeftIds.has(key.id)).every((key) =>
      JSON.stringify(key.value) === JSON.stringify([0, 16, 56, 56, 56, 0, 0, 0]))).toBe(true);
    expect(seq.tracks.eyes.right.keys.filter((key) => smileRightIds.has(key.id)).every((key) =>
      JSON.stringify(key.value) === JSON.stringify([0, 8, 28, 28, 28, 0, 0, 0]))).toBe(true);
    expect(evaluateSequenceAt(seq, 27.37).motion).toEqual(expect.objectContaining({ bodyYaw: 0, yawY: 0, tiltZ: -15 }));
    expect(evaluateSequenceAt(seq, 27.37).eyes.left).toEqual([0, 0, 0, 56, 0, 0, 0, 0]);
    expect(evaluateSequenceAt(seq, 27.37).eyes.right).toEqual([0, 8, 28, 28, 28, 0, 0, 0]);
    expect(evaluateSequenceAt(seq, 28.6).motion).toEqual(expect.objectContaining({ bodyYaw: 0, yawY: 0 }));
    expect(seq.tracks.ring24.effects.find((effect) => effect.fromSec <= 25.5 && effect.toSec > 25.5)?.id).toBe('fx_single_breath');
    expect(seq.tracks.ring24.effects.find((effect) => effect.fromSec <= 35 && effect.toSec > 35)).toEqual(expect.objectContaining({ id: 'fx_cruise_base', type: 'solid' }));
    // Cruise beat: look up to the left while today's weather is projected, then a small smile.
    // Comes up from the greeting nod straight into the look up-left.
    for (let t = 28.33; t < 29.85; t += 0.05) expect(evaluateSequenceAt(seq, t + 0.05).motion.tiltZ).toBeGreaterThan(evaluateSequenceAt(seq, t).motion.tiltZ);
    expect(evaluateSequenceAt(seq, 31).motion).toEqual(expect.objectContaining({ bodyYaw: -10, yawY: -35, tiltZ: 12 }));
    expect(evaluateSequenceAt(seq, 30).eyes.left).toEqual([32, 112, 112, 112, 112, 32, 0, 0]);
    expect(evaluateSequenceAt(seq, 33).projector.activeClips[0]?.assetId).toBe('media/weather_today.svg');
    expect(evaluateSequenceAt(seq, 33).projector.opacity).toBeCloseTo(0.85, 2);
    expect(evaluateSequenceAt(seq, 34).eyes.left).toEqual(smileL);
    expect(evaluateSequenceAt(seq, 34.2).motion).toEqual(expect.objectContaining({ bodyYaw: 0, yawY: 0, tiltZ: 0 }));
    expect(evaluateSequenceAt(seq, 38.4).eyes.intensity).toBeCloseTo(0.82, 2);
    expect(evaluateSequenceAt(seq, 39.6).eyes.intensity).toBeCloseTo(0.82, 2);
    expect(evaluateSequenceAt(seq, 40.2).eyes.intensity).toBeCloseTo(0, 3);
    expect(seq.tracks.ring24.effects.find((effect) => effect.fromSec === 38.4)).toEqual(expect.objectContaining({
      id: 'fx_construction', type: 'solid', toSec: 47,
      params: expect.objectContaining({ color: [255, 190, 35, 34] }),
    }));
    expect(seq.tracks.ring24.effects.find((effect) => effect.id === 'fx_detour')).toEqual(expect.objectContaining({
      type: 'breathe', params: expect.objectContaining({ color: [255, 190, 35, 34], speedHz: 0.22 }),
    }));
    // Night dance lighting: light pink breath under pink/lavender waves, a heartbeat for the heart eyes, twinkles.
    expect(seq.tracks.ring24.effects.filter((effect) => effect.fromSec >= 63 && effect.fromSec < 79.5).map((effect) => [effect.id, effect.type, effect.fromSec, effect.toSec])).toEqual([
      ['fx_night_pink', 'breathe', 63, 79.5],
      ['fx_night_wave_pink', 'wave', 63.5, 70],
      ['fx_night_wave_lilac', 'wave', 63.5, 70],
      ['fx_night_heartbeat', 'pulse', 70, 73],
      ['fx_night_wave_end', 'wave', 73, 79.5],
      ['fx_night_twinkle', 'sparkle', 73, 79.5],
    ]);
    expect(seq.tracks.ring24.effects.find((effect) => effect.id === 'fx_night_return')).toEqual(expect.objectContaining({ type: 'solid', fromSec: 79.5 }));
    for (const t of [57, 63, 79.5, 80, 82.24]) {
      expect(evaluateSequenceAt(seq, t).motion).toEqual(expect.objectContaining({ bodyYaw: 0, yawY: 0, tiltZ: 0 }));
    }
    // Night aegyo: head down near -15 the whole time, looking left and right each bar with a small bob on the beat.
    expect(evaluateSequenceAt(seq, 64.5).motion).toEqual(expect.objectContaining({ bodyYaw: -8, yawY: -12, tiltZ: -15 }));
    expect(evaluateSequenceAt(seq, 65.5).motion).toEqual(expect.objectContaining({ bodyYaw: 8, yawY: 12, tiltZ: -15 }));
    expect(evaluateSequenceAt(seq, 65).motion.tiltZ).toBe(-11);
    expect(evaluateSequenceAt(seq, 71.35).motion.tiltZ).toBe(-15); // heartbeat bob with the heart eyes, still looking down
    expect(evaluateSequenceAt(seq, 77.5).motion).toEqual(expect.objectContaining({ bodyYaw: -8, yawY: -12, tiltZ: -15 }));
    for (let t = 64.2; t < 78; t += 0.1) expect(evaluateSequenceAt(seq, t).motion.tiltZ).toBeLessThanOrEqual(-11);
    expect(evaluateSequenceAt(seq, 40.8).motion).toEqual(expect.objectContaining({ bodyYaw: 90, yawY: 90, tiltZ: 0 }));
    expect(evaluateSequenceAt(seq, 43).motion.railX).toBeCloseTo(-0.04, 3); // toward the monitor, end of calibrated travel
    expect(evaluateSequenceAt(seq, 42.8).motion.bodyYaw).toBeCloseTo(120, 2);
    expect(evaluateSequenceAt(seq, 43.7).motion.bodyYaw).toBeCloseTo(100, 2);
    expect(evaluateSequenceAt(seq, 47).motion).toEqual(expect.objectContaining({ railX: -0.08, bodyYaw: 0, yawY: 0, tiltZ: 0 }));
    expect(evaluateSequenceAt(seq, 50.5).motion.bodyYaw).toBeCloseTo(0, 3);
    expect(evaluateSequenceAt(seq, 50.5).motion.yawY).toBeCloseTo(0, 3);
    expect(evaluateSequenceAt(seq, 54).motion.bodyYaw).toBeCloseTo(0, 3);
    expect(evaluateSequenceAt(seq, 54).motion.yawY).toBeCloseTo(0, 3);
    expect(evaluateSequenceAt(seq, 57).motion.bodyYaw).toBeCloseTo(0, 3);
    expect(evaluateSequenceAt(seq, 45.8).eyes.intensity).toBeCloseTo(0, 3);
    expect(evaluateSequenceAt(seq, 46.6).eyes.intensity).toBeCloseTo(0.92, 2);
    expect(seq.tracks.ring24.effects.filter((effect) => effect.type === 'sparkle').every((effect) => effect.fromSec >= 63 && effect.toSec <= 79.5)).toBe(true);
    expect(seq.tracks.projector.clips.map((clip) => clip.assetId)).toEqual([
      'media/welcome.svg', 'media/weather_today.svg',
      'media/detour_1.svg', 'media/detour_2.svg', 'media/detour_3.svg',
      'media/aegyo_stars_1.svg', 'media/aegyo_hearts.svg', 'media/aegyo_stars_3.svg',
    ]);
    expect(evaluateSequenceAt(seq, 2).projector.activeClips[0]?.assetId).toBe('media/welcome.svg');
    expect(evaluateSequenceAt(seq, 1.7).projector.opacity).toBeCloseTo(0.78, 2);
    expect(evaluateSequenceAt(seq, 3.366667).projector.opacity).toBeCloseTo(0.39, 2);
    expect(evaluateSequenceAt(seq, 3.62).motion.yawY).toBeCloseTo(90, 2);
    expect(evaluateSequenceAt(seq, 3.62).projector.opacity).toBeLessThan(0.01);
    expect(evaluateSequenceAt(seq, 3.633333).projector.activeClips).toEqual([]);
    expect(evaluateSequenceAt(seq, 2).projector.rotationDeg).toBeCloseTo(0, 2);
    expect(evaluateSequenceAt(seq, 8).projector.activeClips).toEqual([]);
    expect(evaluateSequenceAt(seq, 46.9).projector.activeClips).toEqual([]);
    expect(evaluateSequenceAt(seq, 47).projector.activeClips[0]?.assetId).toBe('media/detour_1.svg');
    expect(evaluateSequenceAt(seq, 54).projector.activeClips[0]?.assetId).toBe('media/detour_3.svg');
    expect(evaluateSequenceAt(seq, 78).projector.activeClips[0]?.assetId).toBe('media/aegyo_stars_3.svg');
    // Night eyes: smiling, a wink, and a beating mini heart while it gazes up.
    expect(evaluateSequenceAt(seq, 64).eyes.left).toEqual(smileL);
    expect(evaluateSequenceAt(seq, 66.1).eyes.left).toEqual([0, 0, 0, 0, 56, 0, 0, 0]);
    expect(evaluateSequenceAt(seq, 66.1).eyes.right).toEqual(smileR);
    expect(evaluateSequenceAt(seq, 70.2).eyes.left).toEqual([0, 40, 56, 56, 16, 0, 0, 0]);
    expect(evaluateSequenceAt(seq, 70.6).eyes.left).toEqual([0, 0, 40, 56, 16, 0, 0, 0]);
    expect(evaluateSequenceAt(seq, 71).eyes.right).toEqual([0, 20, 28, 28, 8, 0, 0, 0]);
    expect(evaluateSequenceAt(seq, 71).projector.activeClips[0]?.assetId).toBe('media/aegyo_hearts.svg');
    expect(evaluateSequenceAt(seq, 77).eyes.left).toEqual(smileL);
    expect(evaluateSequenceAt(seq, 66).activeAudio.map((clip) => clip.assetId)).not.toContain('media/sfx_spin_long.wav');
    const loopCue = seq.tracks.events.find((event) => event.type === 'screen_loop_transition');
    expect(loopCue?.payload).toEqual({ from: 82.24, blackFrom: 85.74, blackUntil: 88.74, to: 92.24 });
    expect(evaluateSequenceAt(seq, 85.74).motion).toEqual(expect.objectContaining({ railX: -0.095, bodyYaw: 0, yawY: 30, tiltZ: 0 }));
    expect(evaluateSequenceAt(seq, 92.24).motion).toEqual(expect.objectContaining({ railX: -0.12, bodyYaw: 0, yawY: 90, tiltZ: 0 }));
    const litPixels = (row: number) => row.toString(2).replaceAll('0', '').length;
    for (const key of [...seq.tracks.eyes.left.keys, ...seq.tracks.eyes.right.keys]) {
      expect(key.value.every((row) => litPixels(row) <= 3)).toBe(true);
      expect(key.value.reduce((sum, row) => sum + litPixels(row), 0)).toBeLessThanOrEqual(18);
    }
    expect(motionWarnings(seq)).toEqual([]);
    expect(playbackRateAt(seq, 13.99)).toBe(0.8);
    expect(playbackRateAt(seq, 14)).toBe(1);
    expect(elapsedAtScenarioTime(seq, 14)).toBeCloseTo(17.5, 5);
    expect(elapsedAtScenarioTime(seq, seq.durationSec)).toBeCloseTo(95.74, 2);
    expect(scenarioTimeAtElapsed(seq, 17.5)).toBeCloseTo(14, 5);
  });
  it('is history independent (seek determinism) for all examples', () => {
    for (const f of examples) {
      const seq = validateSequence(ex(f));
      const times = [0, 1.37, 3, 4.2, 7.77, 9, seq.durationSec];
      const first = times.map((t) => JSON.stringify(evaluateSequenceAt(seq, t)));
      // evaluate in scrambled order, then again
      for (const t of [...times].reverse()) evaluateSequenceAt(seq, t);
      const again = times.map((t) => JSON.stringify(evaluateSequenceAt(seq, t)));
      expect(again).toEqual(first);
    }
  });
  it('sparkle is deterministic from seed (no Math.random)', () => {
    const seq = emptySequence();
    seq.tracks.ring24.effects.push({ id: 'e', type: 'sparkle', fromSec: 0, toSec: 5, seed: 7, priority: 0, blend: 'max', params: { whiteLevel: 200, density: 0.5 } });
    const a = evaluateSequenceAt(seq, 2.31).ring24.pixels, b = evaluateSequenceAt(seq, 2.31).ring24.pixels;
    expect(a).toEqual(b);
    expect(a.some((p) => p[3] > 0)).toBe(true);
  });
  it('does not mutate its input', () => {
    const seq = validateSequence(ex(examples[0]));
    const snap = JSON.stringify(seq);
    evaluateSequenceAt(seq, 4);
    expect(JSON.stringify(seq)).toBe(snap);
  });
  it('mandatory demo @3s: LED7 W=255, left eye smile, tilt +5, projector welcome.svg', () => {
    let s: LieuSequence = emptySequence();
    s = setRingPixels(s, 3, { 7: [0, 0, 0, 255] });
    s = setEyeBitmap(s, 'left', 3, EYE_PRESETS.smile);
    s = setNumeric(s, { type: 'motion', ch: 'tiltZ' }, 3, 5, 0);
    s.tracks.projector.clips.push({ id: 'p', fromSec: 3, toSec: 6, assetId: 'media/welcome.svg', visible: true });
    for (const t of [3, 0, 3]) {
      const st = evaluateSequenceAt(s, t === 0 ? 3 : t);
      expect(st.ring24.pixels[7][3]).toBe(255);
      expect(st.ring24.pixels.filter((_, i) => i !== 7).every((p) => p[3] === 0)).toBe(true);
      expect(st.eyes.left).toEqual(EYE_PRESETS.smile);
      expect(st.motion.tiltZ).toBeCloseTo(5);
      expect(st.projector.activeClips[0].assetId).toBe('media/welcome.svg');
    }
    expect(evaluateSequenceAt(s, 0).motion.tiltZ).toBeCloseTo(0);
    expect(evaluateSequenceAt(s, 0).ring24.pixels[7][3]).toBe(0);
  });
  it('right eye independent; all 24 LEDs keep RGBW', () => {
    let s = emptySequence();
    const edits: Record<number, [number, number, number, number]> = {};
    for (let i = 0; i < 24; i++) edits[i] = [i * 10, 255 - i, i, 255 - i * 10 > 0 ? 255 - i * 10 : 0];
    s = setRingPixels(s, 0, edits);
    const st = evaluateSequenceAt(s, 0);
    for (let i = 0; i < 24; i++) expect(st.ring24.pixels[i]).toEqual(edits[i]);
    s = setEyeBitmap(s, 'right', 0, EYE_PRESETS.full);
    const e = evaluateSequenceAt(s, 0).eyes;
    expect(e.right).toEqual(EYE_PRESETS.full); expect(e.left).toEqual(EYE_PRESETS.off);
  });
  it('events fire only for crossed interval', () => {
    const seq = validateSequence(ex(examples[0]));
    expect(cuesCrossed(seq, 0, 1).map((c) => c.type)).toEqual(['vehicle_arrived']);
    expect(cuesCrossed(seq, 2, 2.5)).toEqual([]);
  });
});

describe('project IO', () => {
  it('round-trips JSON and zip, preserving unknown calibration', () => {
    const seq = validateSequence(ex(examples[1]));
    const proj = { schema: 'lieu.project/v1' as const, sequence: seq, rig: defaultRig(), assets: [{ assetId: 'up1', filename: 'a.wav', mime: 'audio/wav' }], calibrationStatus: UNKNOWN_CALIBRATION };
    const back: any = migrate(JSON.parse(serializeProject(proj)));
    expect(back.sequence).toEqual(seq);
    expect(back.calibrationStatus.unknowns.eyeLeftI2cAddress).toBeNull();
    const z = readZip(buildZip(proj, { up1: new Uint8Array([1, 2, 3]) }));
    expect(z.project.sequence).toEqual(seq);
    expect(Array.from(z.blobs['up1'])).toEqual([1, 2, 3]);
  });
  it('accepts every bare example and rejects bad schema', () => {
    for (const f of examples) expect(() => migrate(ex(f))).not.toThrow();
    expect(() => migrate({ schema: 'x' })).toThrow();
  });
});

describe('rig', () => {
  it('keeps the projector hit directly below its moving origin', () => {
    expect(downwardFloorHit([1.2, 0.5, -0.7], -1.4)).toEqual([1.2, -1.4, -0.7]);
    expect(downwardFloorHit([-2, 4, 3], -1.4)).toEqual([-2, -1.4, 3]);
    expect(downwardFloorHit([0, -2, 0], -1.4)).toBeNull();
  });
  it('mounts the projector to the body carriage, independently of yaw', () => {
    expect(defaultRig().owner[18]).toBe('carriage');
  });
  it('is recomputed from rest every call (no accumulation) and rail stays fixed', () => {
    const rig = defaultRig();
    expect(rig.owner[143]).toBe('fixedRail');
    const a = computeStageMatrices({ railX: -0.1, yawY: 30, tiltZ: 5 }, rig);
    computeStageMatrices({ railX: 0.2, yawY: -20, tiltZ: 9 }, rig);
    const b = computeStageMatrices({ railX: -0.1, yawY: 30, tiltZ: 5 }, rig);
    expect(a.tilt.elements).toEqual(b.tilt.elements);
    expect(a.fixedRail.elements).toEqual(computeStageMatrices({ railX: 0, yawY: 0, tiltZ: 0 }, rig).fixedRail.elements);
    expect(computeStageMatrices({ railX: 0, bodyYaw: 45, yawY: 0, tiltZ: 0 }, rig).carriage.elements).not.toEqual(computeStageMatrices({ railX: 0, bodyYaw: 0, yawY: 0, tiltZ: 0 }, rig).carriage.elements);
  });
  it('every config mesh node has exactly one owner', () => {
    const rig = defaultRig();
    expect(Object.keys(rig.owner).length).toBe(61);
  });
  it('flags preview-limit violations', () => {
    let s = emptySequence();
    s = setNumeric(s, { type: 'motion', ch: 'yawY' }, 0, 0, 0);
    s = setNumeric(s, { type: 'motion', ch: 'yawY' }, 0.5, 90, 0);
    expect(motionWarnings(s).some((w) => w.ch === 'yawY')).toBe(true);
  });
});

describe('tilt limit', () => {
  it('clamps tilt to +/-15 deg even if keys exceed it', () => {
    let s = emptySequence();
    s = setNumeric(s, { type: 'motion', ch: 'tiltZ' }, 0, 40, 0);
    s = setNumeric(s, { type: 'motion', ch: 'tiltZ' }, 2, -40, 0);
    expect(evaluateSequenceAt(s, 0).motion.tiltZ).toBe(15);
    expect(evaluateSequenceAt(s, 2).motion.tiltZ).toBe(-15);
  });
});
