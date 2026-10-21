import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { useStore } from '../store';
import { validateSequence } from '../engine/project';
import { EYE_PRESETS } from '../engine/eyePresets';

const seq = () => validateSequence(JSON.parse(readFileSync('examples/03_arrival.lieu.json', 'utf8')));
const st = () => useStore.getState();

describe('store editing', () => {
  it('auto-key writes keys at playhead; undo/redo restore exactly', () => {
    st().loadSequence(seq());
    const before = JSON.stringify(st().seq);
    st().setAutoKey(true); st().setTime(2.5);
    st().setMotion('tiltZ', 5);
    st().setPixels({ 7: [0, 0, 0, 255] });
    st().setEye('right', EYE_PRESETS.surprise);
    const after = JSON.stringify(st().seq);
    expect(after).not.toBe(before);
    expect(st().evalNow().motion.tiltZ).toBeCloseTo(5);
    expect(st().evalNow().ring24.pixels[7]).toEqual([0, 0, 0, 255]);
    expect(st().evalNow().eyes.right).toEqual(EYE_PRESETS.surprise);
    for (let i = 0; i < 3; i++) st().undo();
    expect(JSON.stringify(st().seq)).toBe(before);
    for (let i = 0; i < 3; i++) st().redo();
    expect(JSON.stringify(st().seq)).toBe(after);
  });
  it('auto-key OFF produces live override that is cleared on seek and never keyed', () => {
    st().loadSequence(seq());
    st().setAutoKey(false); st().setTime(1);
    const before = JSON.stringify(st().seq);
    st().setMotion('yawY', 20);
    expect(st().evalNow().motion.yawY).toBe(20);
    expect(JSON.stringify(st().seq)).toBe(before);
    st().setTime(1.1);
    expect(st().evalNow().motion.yawY).not.toBe(20);
    st().setAutoKey(true);
  });
  it('JSON export -> import keeps keys, clips and unknown calibration', async () => {
    st().loadSequence(seq());
    st().setTime(4); st().setPixels({ 23: [10, 20, 30, 40] });
    const json = st().exportJson();
    const parsed = JSON.parse(json);
    expect(parsed.calibrationStatus.unknowns.eyeLeftI2cAddress).toBeNull();
    expect(parsed.calibrationStatus.verifiedOnHardware).toBe(false);
    const want = JSON.stringify(st().seq);
    st().loadSequence(seq());
    await st().importFile('x.lieu.json', new TextEncoder().encode(json).buffer as ArrayBuffer);
    expect(JSON.stringify(st().seq)).toBe(want);
  });
  it('seek never fires side effects: events only crossed in transport', () => {
    st().loadSequence(seq());
    st().setTime(9); st().setTime(0);
    expect(st().eventLog).toEqual([]);
  });
});
