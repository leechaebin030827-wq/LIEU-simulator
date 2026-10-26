import { useStore } from '../store';
import type { DesiredState } from '../engine/types';

/** Live output to the UNO R4 test rig over Web Serial (Chrome/Edge). Same mapping + protocol as hardware/pi/lieu_hw
 *  (python mapping.py / protocol.py), so calibration values carry over to hardware.json. Motors are not driven. */
export type EyeLayout = 'adafruit' | 'msb_left' | 'lsb_left';
export type HwSettings = {
  layout: EyeLayout; flipX: boolean; flipY: boolean; swap: boolean;
  addrL: number; addrR: number;
  ringOffset: number; ringReverse: boolean;
  maxScale: number; budgetMa: number;
};
export const DEFAULT_HW: HwSettings = { layout: 'adafruit', flipX: false, flipY: false, swap: false, addrL: 0x70, addrR: 0x71, ringOffset: 0, ringReverse: false, maxScale: 0.25, budgetMa: 400 };

const SYNC = [0xaa, 0x55], T_FRAME = 1, T_CONFIG = 2, T_INFO = 3, T_BLANK = 4, N = 24;

export function packet(type: number, payload: ArrayLike<number> = []): Uint8Array {
  const body = [type, payload.length, ...Array.from(payload)];
  return Uint8Array.from([...SYNC, ...body, body.reduce((a, b) => a + b, 0) & 255]);
}

export function mapRow(row: number, layout: EyeLayout, flipX: boolean): number {
  const cols = Array.from({ length: 8 }, (_, c) => (row >> (7 - c)) & 1);
  if (flipX) cols.reverse();
  let out = 0;
  cols.forEach((on, c) => { if (on) out |= 1 << (layout === 'msb_left' ? 7 - c : layout === 'lsb_left' ? c : (c + 7) % 8); });
  return out;
}

/** Scale so the estimated draw (20 mA per channel at 255) stays within budget and max_scale. */
export function limitRing(ring: number[], maxScale: number, budgetMa: number): number[] {
  const total = ring.reduce((a, b) => a + b, 0);
  const scale = total ? Math.min(maxScale, budgetMa / ((total * 20) / 255)) : maxScale;
  return ring.map((b) => Math.floor(b * scale));
}

export type DeviceFrame = { l: number[]; r: number[]; bl: number; br: number; ring: number[] };

export function toDevice(s: DesiredState, c: HwSettings): DeviceFrame {
  const off = (i: number) => i < 0.03;
  const dim = (i: number) => Math.round(Math.min(1, Math.max(0, i)) * 15);
  let l = off(s.eyes.leftIntensity) ? new Array(8).fill(0) : [...s.eyes.left];
  let r = off(s.eyes.rightIntensity) ? new Array(8).fill(0) : [...s.eyes.right];
  let bl = dim(s.eyes.leftIntensity), br = dim(s.eyes.rightIntensity);
  if (c.swap) { [l, r] = [r, l]; [bl, br] = [br, bl]; }
  const eye = (rows: number[]) => { const m = rows.map((x) => mapRow(x, c.layout, c.flipX)); return c.flipY ? m.reverse() : m; };
  const g = s.ring24.brightness, phys = new Array(N * 4).fill(0), step = c.ringReverse ? -1 : 1;
  s.ring24.pixels.forEach((p, v) => {
    const q = (((step * v + c.ringOffset) % N) + N) % N;
    for (let k = 0; k < 4; k++) phys[q * 4 + k] = Math.round(p[k] * g);
  });
  return { l: eye(l), r: eye(r), bl, br, ring: limitRing(phys, c.maxScale, c.budgetMa) };
}

export const framePacket = (d: DeviceFrame) => packet(T_FRAME, [...d.l, ...d.r, d.bl, d.br, ...d.ring]);
/** Host already limits; the firmware keeps the same budget (+10 %) only as a backstop. */
export const configPacket = (c: HwSettings) => packet(T_CONFIG, [c.addrL, c.addrR, 255, (Math.round(c.budgetMa * 1.1) >> 8) & 255, Math.round(c.budgetMa * 1.1) & 255]);

// ---- connection (browser only) ---------------------------------------------------------------------------------------------
type Status = { connected: boolean; busy: boolean; message: string; frames: number };
let port: any = null, writer: any = null, timer = 0, pending = false, lastKey = '', lastSent = 0;
let settings: HwSettings = loadSettings();
let status: Status = { connected: false, busy: false, message: 'Not connected', frames: 0 };
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((f) => f());

function loadSettings(): HwSettings {
  try { return { ...DEFAULT_HW, ...JSON.parse(localStorage.getItem('lieu.hw') ?? '{}') }; } catch { return { ...DEFAULT_HW }; }
}
export const hwSupported = () => typeof navigator !== 'undefined' && 'serial' in navigator;
export const getHwSettings = () => settings;
export const getHwStatus = () => status;
export function setHwSettings(p: Partial<HwSettings>) {
  settings = { ...settings, ...p };
  try { localStorage.setItem('lieu.hw', JSON.stringify(settings)); } catch { /* storage unavailable */ }
  lastKey = ''; // force a resend with the new mapping
  if (writer && ('addrL' in p || 'addrR' in p || 'budgetMa' in p)) void send(configPacket(settings));
  emit();
}
export function subscribeHw(f: () => void) { listeners.add(f); return () => { listeners.delete(f); }; }
const setStatus = (p: Partial<Status>) => { status = { ...status, ...p }; emit(); };

async function send(bytes: Uint8Array) {
  if (!writer || pending) return;
  pending = true;
  try { await writer.write(bytes); } catch (e) { void disconnectHw(`Write failed: ${(e as Error).message}`); } finally { pending = false; }
}

function tick() {
  if (!writer) return;
  const d = toDevice(useStore.getState().evalNow(), settings);
  const key = [d.l, d.r, d.bl, d.br, d.ring].join('|');
  const now = performance.now();
  if (key !== lastKey || now - lastSent > 250) { // keepalive: firmware blanks after ~2 s of silence
    lastKey = key; lastSent = now;
    void send(framePacket(d));
    status.frames++;
  }
}

async function openPort(p: any) {
  port = p;
  await port.open({ baudRate: 115200 });
  writer = port.writable.getWriter();
  // opening toggles DTR; the R4 may restart, so give it a moment before the first packets
  setStatus({ message: 'Starting…' });
  await new Promise((r) => setTimeout(r, 1800));
  await send(configPacket(settings));
  lastKey = '';
  timer = window.setInterval(tick, 1000 / 30);
  setStatus({ connected: true, busy: false, message: 'Connected', frames: 0 });
}

export async function connectHw() {
  if (!hwSupported()) { setStatus({ message: 'Web Serial needs Chrome or Edge' }); return; }
  setStatus({ busy: true, message: 'Choose the Arduino port…' });
  try {
    await openPort(await (navigator as any).serial.requestPort({ filters: [{ usbVendorId: 0x2341 }] }));
  } catch (e) {
    await disconnectHw(e instanceof Error && e.name === 'NotFoundError' ? 'Not connected' : `Connect failed: ${(e as Error).message}`);
  }
}

/** After the first manual "Connect" the browser remembers the Arduino: from then on it is opened by itself on page load and whenever it is plugged back in. */
let autoStarted = false;
export async function autoConnectHw() {
  if (!hwSupported() || writer || status.busy) return;
  try {
    const known = (await (navigator as any).serial.getPorts()).find((p: any) => p.getInfo?.().usbVendorId === 0x2341);
    if (!known) return;
    setStatus({ busy: true, message: 'Connecting…' });
    await openPort(known);
  } catch (e) { await disconnectHw(`Auto-connect failed: ${(e as Error).message}`); }
  finally { if (!autoStarted) { autoStarted = true; const s = (navigator as any).serial; s.addEventListener('connect', () => void autoConnectHw()); s.addEventListener('disconnect', () => void disconnectHw('Unplugged')); } }
}

export async function disconnectHw(message = 'Not connected') {
  window.clearInterval(timer);
  try { if (writer) { await writer.write(packet(T_BLANK)); writer.releaseLock(); } } catch { /* already gone */ }
  try { await port?.close(); } catch { /* already closed */ }
  writer = null; port = null; pending = false;
  setStatus({ connected: false, busy: false, message });
}

/** Single lit eye pixel (virtual row/col) to calibrate the eye mapping. */
export async function probeEye(side: 'L' | 'R', row: number, col: number) {
  const rows = new Array(8).fill(0); rows[row] = 1 << (7 - col);
  const z = new Array(8).fill(0);
  const m = (a: number[]) => { const o = a.map((x) => mapRow(x, settings.layout, settings.flipX)); return settings.flipY ? o.reverse() : o; };
  const [l, r] = side === 'L' ? [rows, z] : [z, rows];
  const [pl, pr] = settings.swap ? [r, l] : [l, r];
  const hold = window.setInterval(() => void send(packet(T_FRAME, [...m(pl), ...m(pr), 15, 15, ...new Array(96).fill(0)])), 100);
  window.clearInterval(timer); // pause live output while probing
  await new Promise((res) => setTimeout(res, 1500));
  window.clearInterval(hold);
  timer = window.setInterval(tick, 1000 / 30);
}
export const requestInfo = () => send(packet(T_INFO));
