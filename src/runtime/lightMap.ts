import type { DesiredState } from '../engine/types';

/**
 * Physical eye/ring mapping, restored from the pre-reset hardware config
 * (backups/hardware-control-before-reset-2026-11-01.zip, hardware/config/hardware.json):
 * HT16K33 "adafruit" row layout, no flips, ring GRBW with offset 0, and a
 * brightness cap (raised from 25% to 35%) within a 400 mA budget for the USB-powered ring.
 */
export const LIGHT_CONFIG = { maxScale: 0.35, budgetMa: 400, ringOffset: 0, ringReverse: false } as const;

/** Virtual row (bit7 = left column) -> Adafruit 8x8 backpack bit order (one-bit rotation). */
export function adafruitRow(row: number): number {
  let out = 0;
  for (let c = 0; c < 8; c++) if ((row >> (7 - c)) & 1) out |= 1 << ((c + 7) % 8);
  return out;
}

/** Scales the ring so the estimated draw (20 mA per channel at 255) stays within budget and maxScale. */
export function limitRing(ring: number[], maxScale: number, budgetMa: number): number[] {
  const total = ring.reduce((a, b) => a + b, 0);
  const scale = total ? Math.min(maxScale, budgetMa / ((total * 20) / 255)) : maxScale;
  return ring.map((b) => Math.floor(b * scale));
}

const hex = (bytes: number[]) => bytes.map((b) => b.toString(16).padStart(2, '0')).join('').toUpperCase();

/** Serial lines for the eyes and the ring of one evaluated frame. Pure. */
export function lightLines(state: DesiredState): { eyes: string; ring: string } {
  const dim = (i: number) => Math.round(Math.min(1, Math.max(0, i)) * 15);
  const off = (i: number) => i < 0.03;
  const left = off(state.eyes.leftIntensity) ? new Array(8).fill(0) : state.eyes.left.map(adafruitRow);
  const right = off(state.eyes.rightIntensity) ? new Array(8).fill(0) : state.eyes.right.map(adafruitRow);
  const n = state.ring24.pixels.length, g = state.ring24.brightness, step = LIGHT_CONFIG.ringReverse ? -1 : 1;
  const phys = new Array(n * 4).fill(0);
  state.ring24.pixels.forEach((p, v) => {
    const q = (((step * v + LIGHT_CONFIG.ringOffset) % n) + n) % n;
    for (let k = 0; k < 4; k++) phys[q * 4 + k] = Math.round(p[k] * g);
  });
  return {
    eyes: `EYES ${hex([...left, ...right])} ${dim(state.eyes.leftIntensity)} ${dim(state.eyes.rightIntensity)}`,
    ring: `RING ${hex(limitRing(phys, LIGHT_CONFIG.maxScale, LIGHT_CONFIG.budgetMa))}`,
  };
}
