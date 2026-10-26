import { describe, expect, it } from 'vitest';
import { DEFAULT_HW, configPacket, framePacket, limitRing, mapRow, packet, toDevice } from '../runtime/hardware';
import { evaluateSequenceAt } from '../engine/evaluate';
import { validateSequence } from '../engine/project';
import { readFileSync } from 'node:fs';

describe('hardware mapping (mirrors hardware/pi/lieu_hw)', () => {
  it('eye layouts', () => {
    expect(mapRow(0b10000000, 'msb_left', false)).toBe(0b10000000);
    expect(mapRow(0b10000000, 'lsb_left', false)).toBe(0b00000001);
    expect(mapRow(0b10000000, 'adafruit', false)).toBe(0b10000000);
    expect(mapRow(0b01000000, 'adafruit', false)).toBe(0b00000001);
    expect(mapRow(0b10000000, 'msb_left', true)).toBe(0b00000001);
  });
  it('ring budget limiter', () => {
    const out = limitRing(new Array(96).fill(255), 1, 400);
    expect(out.reduce((a, b) => a + b, 0) * 20 / 255).toBeLessThanOrEqual(400);
  });
  it('packet layout and checksum', () => {
    const s = evaluateSequenceAt(validateSequence(JSON.parse(readFileSync('examples/05_web_cover.lieu.json', 'utf8'))), 1);
    const p = framePacket(toDevice(s, DEFAULT_HW));
    expect(p.length).toBe(2 + 2 + 114 + 1);
    expect([p[0], p[1], p[2], p[3]]).toEqual([0xaa, 0x55, 1, 114]);
    expect(p[p.length - 1]).toBe(p.slice(2, -1).reduce((a, b) => a + b, 0) & 255);
    expect(configPacket(DEFAULT_HW)[2]).toBe(2);
    expect(packet(3)).toEqual(Uint8Array.from([0xaa, 0x55, 3, 0, 3]));
  });
});
