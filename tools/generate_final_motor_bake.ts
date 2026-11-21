import { readFileSync, writeFileSync } from 'node:fs';
import { validateSequence } from '../src/engine/project.ts';
import { evaluateSequenceAt } from '../src/engine/evaluate.ts';
import { elapsedAtScenarioTime, scenarioTimeAtElapsed } from '../src/runtime/playbackRate.ts';

const seq = validateSequence(JSON.parse(readFileSync('examples/08_exhibition_final.lieu.json', 'utf8')));
const fps = 20;
const wallDuration = elapsedAtScenarioTime(seq, seq.durationSec);
const count = Math.floor(wallDuration * fps + 1e-6) + 1;
const rows: string[] = [];
for (let i = 0; i < count; i++) {
  const scenarioT = scenarioTimeAtElapsed(seq, Math.min(wallDuration, i / fps));
  const m = evaluateSequenceAt(seq, scenarioT).motion;
  rows.push(`  {${Math.round(m.yawY * 100)}, ${Math.round(m.tiltZ * 100)}, ${Math.round((m.bodyYaw ?? 0) * 100)}}`);
}
const body = `#pragma once
#include <Arduino.h>

// Generated from examples/08_exhibition_final.lieu.json by
// tools/generate_final_motor_bake.ts. Frames use wall-clock time, including
// the authored 0.8x opening, so they stay aligned with the monitor video.
static const uint16_t FINAL_MOTOR_FPS = ${fps};
static const uint16_t FINAL_MOTOR_FRAME_COUNT = ${count};
static const uint32_t FINAL_MOTOR_DURATION_MS = ${Math.round(wallDuration * 1000)}UL;
static const int16_t FINAL_MOTOR_FRAMES[FINAL_MOTOR_FRAME_COUNT][3] PROGMEM = {
${rows.join(',\n')}
};
`;
writeFileSync('hardware/firmware/lieu_uno_r4/final_motor_bake.h', body);
console.log(`generated ${count} frames, ${wallDuration.toFixed(3)} s, ${count * 6} bytes`);
