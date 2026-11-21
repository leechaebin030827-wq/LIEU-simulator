import { expect, it } from 'vitest';
import { adafruitRow, lightLines, limitRing } from '../runtime/lightMap';
import type { DesiredState } from '../engine/types';

const state = (over: Partial<DesiredState['eyes']> = {}, pixel: [number, number, number, number] = [0, 0, 0, 0], brightness = 1) => ({
  tSec: 0,
  motion: { railX: -0.12, yawY: 0, tiltZ: 0 },
  ring24: { pixels: Array.from({ length: 24 }, () => pixel), brightness },
  eyes: { left: [0x80, 0x40, 0, 0, 0, 0, 0, 0], right: [0, 0, 0, 0, 0, 0, 0, 0x01], intensity: 1, leftIntensity: 1, rightIntensity: 0.5, ...over },
}) as unknown as DesiredState;

it('maps virtual columns onto the Adafruit backpack bit order', () => {
  expect(adafruitRow(0x80)).toBe(0x80); // column 0 -> bit 7
  expect(adafruitRow(0x40)).toBe(0x01); // column 1 -> bit 0
  expect(adafruitRow(0x01)).toBe(0x40); // column 7 -> bit 6
});

it('formats eyes with per-side dimming and blanks an eye that is off', () => {
  expect(lightLines(state()).eyes).toBe('EYES 80010000000000000000000000000040 15 8');
  expect(lightLines(state({ leftIntensity: 0 })).eyes.startsWith('EYES 0000000000000000')).toBe(true);
});

it('keeps the ring within the power budget and the 35% cap', () => {
  const dim = lightLines(state({}, [40, 0, 0, 0])).ring;
  expect(dim).toMatch(/^RING [0-9A-F]{192}$/);
  expect(dim.slice(5, 7)).toBe('0E'); // 40 x 0.35
  const full = limitRing(new Array(96).fill(255), 0.35, 400);
  expect(full.reduce((a, b) => a + b, 0) * 20 / 255).toBeLessThanOrEqual(400);
});
