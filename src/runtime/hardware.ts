import type { DesiredState, MotionState } from '../engine/types';
import { motionToSafeRaw, type SafeRawFrame } from './hardwareMap';
import { lightLines } from './lightMap';
import { reportIncident } from './incidents';
import { setHardwareOutputsEnabled } from './outputGate';

export type SafeAxis = 'yaw' | 'tilt' | 'body' | 'rail';

/** Firmware PLAYOUT_DELAY_MS: motion frames are evaluated this far ahead so the robot stays on the video. */
export const HARDWARE_PLAYOUT_SEC = 0.1;

type SerialReader = ReadableStreamDefaultReader<Uint8Array>;
type SerialWriter = WritableStreamDefaultWriter<Uint8Array>;
type SerialPortLike = {
  readable: ReadableStream<Uint8Array> | null;
  writable: WritableStream<Uint8Array> | null;
  open(options: { baudRate: number; bufferSize?: number }): Promise<void>;
  close(): Promise<void>;
};

export type HardwareStatus = {
  connected: boolean;
  busy: boolean;
  message: string;
  activeAxis: SafeAxis | null;
  playbackArmed: boolean;
  raw: Record<SafeAxis, number | null>;
  goal: number | null;
  torque: string;
  /** Latest TEL line from the controller (every 0.5 s), for the 활성상태 tab. */
  telemetry: Telemetry | null;
};

/** Per motor in ID order 1..4 (yaw, tilt, body, rail). present is null when the motor did not answer. */
export type Telemetry = {
  at: number;
  mode: 'ALL' | 'SINGLE' | 'OFF';
  responded: number;
  present: (number | null)[];
  goal: number[];
  alert: boolean[];
  torque: boolean[];
  eyes: [boolean, boolean];
  lightsActive: boolean;
  i2cErrors: number;
  badLines: number;
};

export function parseTelemetry(line: string, at: number): Telemetry | null {
  const m = line.match(/^TEL mode=(ALL|SINGLE|OFF) rx=(\d) p=([-\dx,]+) g=([-\d,]+) alert=([01,]+) torque=([01]{4}) eyes=([01]),([01]) lights=([01]) i2c=(\d+) bad=(\d+)$/);
  if (!m) return null;
  return {
    at, mode: m[1] as Telemetry['mode'], responded: Number(m[2]),
    present: m[3].split(',').map((v) => (v === 'x' ? null : Number(v))),
    goal: m[4].split(',').map(Number),
    alert: m[5].split(',').map((v) => v === '1'),
    torque: m[6].split('').map((v) => v === '1'),
    eyes: [m[7] === '1', m[8] === '1'],
    lightsActive: m[9] === '1', i2cErrors: Number(m[10]), badLines: Number(m[11]),
  };
}

const listeners = new Set<() => void>();
let status: HardwareStatus = {
  connected: false,
  busy: false,
  message: '안전 컨트롤러 · 연결 안 됨',
  activeAxis: null,
  playbackArmed: false,
  raw: { yaw: null, tilt: null, body: null, rail: null },
  goal: null,
  torque: '0000',
  telemetry: null,
};
let port: SerialPortLike | null = null;
let reader: SerialReader | null = null;
let writer: SerialWriter | null = null;
let generation = 0;
let heartbeat: ReturnType<typeof setInterval> | null = null;
let playbackGoals: SafeRawFrame | null = null;
let frameInFlight = false;
let lightsInFlight = false;
let lightsOn = false;
let lastEyes = '', lastRing = '', lastLightsSentAt = 0, lastRingSentAt = 0;
const LIGHT_KEEPALIVE_MS = 1000; // firmware blanks the lights after 5 s without a line
// A RING line is ~200 bytes; at 30 Hz it alone used most of the 115200-baud link, and the
// UNO R4 WiFi's USB bridge has frozen twice under that load. 10 Hz still looks smooth on the LEDs.
const RING_MIN_INTERVAL_MS = 100;
// A write slower than this is reported in the hardware menu (link congestion or a stalled page).
const SLOW_WRITE_MS = 500;
// Timeline torque released only because the host went quiet: re-arm and carry on.
let lastAutoRearmAt = 0;
const AUTO_REARM_GAP_MS = 2000;
let shouldAutoRearm: () => boolean = () => false;

/** Live link diagnostics, shown by the dev overlay (window.__lieuStats.hardware). */
export const hardwareStats = { lastFrameAt: 0, framesSent: 0, framesSkipped: 0, ringsSent: 0, lastWriteMs: 0, maxWriteMs: 0, slowWrites: 0, autoRearms: 0, readErrors: 0, lastRelease: '' };
if (typeof window !== 'undefined') {
  const w = window as Window & { __lieuStats?: Record<string, unknown> };
  w.__lieuStats = { ...(w.__lieuStats ?? {}), hardware: hardwareStats, hardwareStatus: () => status };
}
const LOCKING_REFUSALS = new Set(['axis-not-ready', 'timeline-not-active', 'outputs-active', 'axis-not-active']);
// No status report for this long means the board (often its USB bridge) stopped answering.
const BOARD_SILENT_MS = 2000;
let boardSilent = false, connectedAt = 0;
/** Set by the transport: whether a host-silence release should be re-armed (i.e. still playing). */
export const setAutoRearmCheck = (check: () => boolean) => { shouldAutoRearm = check; };

const emit = (patch: Partial<HardwareStatus>) => {
  status = { ...status, ...patch };
  listeners.forEach((listener) => listener());
};

export const getHwStatus = () => status;
export const subscribeHw = (listener: () => void) => { listeners.add(listener); return () => listeners.delete(listener); };
export const hwSupported = () => typeof navigator !== 'undefined' && 'serial' in navigator;

const axisFromDevice = (value: string): SafeAxis | null => {
  const axis = value.toLowerCase();
  return axis === 'yaw' || axis === 'tilt' || axis === 'body' || axis === 'rail' ? axis : null;
};

function consumeLine(line: string) {
  const telemetry = parseTelemetry(line, performance.now());
  if (telemetry) {
    const before = status.telemetry?.badLines;
    if (before != null && telemetry.badLines > before) reportIncident('link-bad-line', `보드가 깨진 명령 ${telemetry.badLines - before}줄 버림`);
    if (boardSilent) { boardSilent = false; reportIncident('board-silent', '보고 다시 들어옴'); }
    emit({ telemetry });
    return;
  }
  const state = line.match(/^STATUS active=(NONE|YAW|TILT|BODY|RAIL|ALL) id1=(-?\d+) id2=(-?\d+) id3=(-?\d+) id4=(-?\d+) torque=([01]{4})(?: goal=(-?\d+)| goal1=(-?\d+) goal2=(-?\d+) goal3=(-?\d+) goal4=(-?\d+))?$/);
  if (state) {
    const all = state[1] === 'ALL';
    const raw = { yaw: Number(state[2]), tilt: Number(state[3]), body: Number(state[4]), rail: Number(state[5]) };
    if (all) playbackGoals = {
      yaw: state[8] == null ? raw.yaw : Number(state[8]),
      tilt: state[9] == null ? raw.tilt : Number(state[9]),
      body: state[10] == null ? raw.body : Number(state[10]),
      rail: state[11] == null ? raw.rail : Number(state[11]),
    };
    emit({
      activeAxis: state[1] === 'NONE' || all ? null : axisFromDevice(state[1]),
      playbackArmed: all,
      raw,
      torque: state[6],
      goal: state[7] == null ? null : Number(state[7]),
      message: all ? '4축 Sync Write 타임라인 준비됨' : '안전 컨트롤러 연결됨',
    });
    if (!all) setHardwareOutputsEnabled(false);
    return;
  }
  const armedAll = line.match(/^ARMED axis=ALL raw1=(-?\d+) raw2=(-?\d+) raw3=(-?\d+) raw4=(-?\d+)$/);
  if (armedAll) {
    playbackGoals = { yaw: Number(armedAll[1]), tilt: Number(armedAll[2]), body: Number(armedAll[3]), rail: Number(armedAll[4]) };
    emit({ activeAxis: null, playbackArmed: true, goal: null, torque: '1111', message: '4축 Sync Write 타임라인 준비됨' });
    setHardwareOutputsEnabled(true);
    return;
  }
  const armed = line.match(/^ARMED axis=(YAW|TILT|BODY|RAIL) raw=(-?\d+)$/);
  if (armed) { setHardwareOutputsEnabled(false); emit({ activeAxis: axisFromDevice(armed[1]), playbackArmed: false, goal: Number(armed[2]), message: `${armed[1]} Arm` }); return; }
  const goal = line.match(/^GOAL axis=(YAW|TILT|BODY|RAIL) raw=(-?\d+)$/);
  if (goal) { emit({ goal: Number(goal[2]), message: `${goal[1]} 목표 ${goal[2]}` }); return; }
  const frame = line.match(/^FRAME goal1=(-?\d+) goal2=(-?\d+) goal3=(-?\d+) goal4=(-?\d+)$/);
  if (frame) {
    playbackGoals = { yaw: Number(frame[1]), tilt: Number(frame[2]), body: Number(frame[3]), rail: Number(frame[4]) };
    return;
  }
  if (line.startsWith('RELEASE ')) {
    const wasArmed = status.playbackArmed;
    hardwareStats.lastRelease = line.slice('RELEASE reason='.length);
    playbackGoals = null;
    setHardwareOutputsEnabled(false);
    emit({ activeAxis: null, playbackArmed: false, goal: null, torque: '0000', message: line });
    if (wasArmed) reportIncident('link-release', hardwareStats.lastRelease);
    // The firmware let go because nothing arrived for a few seconds (a stalled page or a
    // congested link), not because of a fault: re-arm at the current pose and keep playing.
    const now = performance.now();
    if (line === 'RELEASE reason=watchdog' && wasArmed && shouldAutoRearm() && now - lastAutoRearmAt > AUTO_REARM_GAP_MS) {
      lastAutoRearmAt = now;
      hardwareStats.autoRearms++;
      reportIncident('link-rearm', '통신 지연으로 풀린 토크를 다시 켬');
      emit({ message: '통신 지연으로 토크 해제 — 자동 재준비 중…' });
      void sendLine('ARM ALL');
    }
    return;
  }
  if (line.startsWith('REFUSE ')) {
    // Only "not armed / cannot arm" refusals lock the outputs. A damaged line the controller
    // could not parse (unknown-command, bad-frame, ...) used to lock them too: the app then
    // stopped sending motion while the eyes/ring kept the link alive, and the robot froze
    // with torque on mid-show.
    const reason = line.match(/reason=([\w-]+)/)?.[1] ?? '';
    if (LOCKING_REFUSALS.has(reason)) setHardwareOutputsEnabled(false);
    else reportIncident('link-bad-line', `보드가 거부: ${reason}`);
    emit({ message: line });
  }
}

async function readLoop(session: number) {
  const decoder = new TextDecoder();
  let pending = '';
  while (session === generation && reader) {
    try {
      const { value, done } = await reader.read();
      if (done) break;
      pending += decoder.decode(value, { stream: true });
      const lines = pending.split(/\r?\n/);
      pending = lines.pop() ?? '';
      lines.map((line) => line.trim()).filter(Boolean).forEach(consumeLine);
    } catch (error) {
      if (session !== generation) return;
      // A framing/overrun error ends this reader, but the port hands out a fresh readable
      // stream: pick it up instead of going deaf to the controller for the rest of the show.
      hardwareStats.readErrors++;
      emit({ message: `수신 오류 후 재연결: ${String(error)}` });
      try { reader?.releaseLock(); } catch { /* already released */ }
      reader = port?.readable ? port.readable.getReader() : null;
      pending = '';
    }
  }
}

/** Appends " ~HH" (low byte of the character sum) so the firmware drops lines damaged on the UART. */
export const withChecksum = (line: string) => {
  let sum = 0;
  for (let i = 0; i < line.length; i++) sum = (sum + line.charCodeAt(i)) & 0xff;
  return `${line} ~${sum.toString(16).padStart(2, '0').toUpperCase()}`;
};

async function sendLine(line: string) {
  if (!writer || !status.connected) return false;
  const began = performance.now();
  try {
    await writer.write(new TextEncoder().encode(`${line}\n`));
    const took = performance.now() - began;
    hardwareStats.lastWriteMs = took;
    hardwareStats.maxWriteMs = Math.max(hardwareStats.maxWriteMs, took);
    if (took > SLOW_WRITE_MS) {
      hardwareStats.slowWrites++;
      reportIncident('link-slow', `${line.split(' ')[0]} 송신 ${Math.round(took)}ms`);
      emit({ message: `송신 지연 ${Math.round(took)}ms (USB 연결 혼잡)` });
    }
    return true;
  } catch (error) { emit({ message: `송신 실패: ${String(error)}` }); return false; }
}

export async function connectHw() {
  if (!hwSupported() || status.busy || status.connected) return;
  emit({ busy: true, message: 'UNO R4 연결 중…' });
  try {
    const serial = (navigator as Navigator & { serial: { requestPort(options?: unknown): Promise<SerialPortLike> } }).serial;
    port = await serial.requestPort({ filters: [{ usbVendorId: 0x2341 }] });
    // The 255-byte default buffer nearly fills with one RING line, so writes queued behind it.
    await port.open({ baudRate: 115200, bufferSize: 8192 });
    if (!port.readable || !port.writable) throw new Error('Serial streams unavailable');
    reader = port.readable.getReader();
    writer = port.writable.getWriter();
    const session = ++generation;
    connectedAt = performance.now(); boardSilent = false;
    emit({ connected: true, busy: false, message: '연결됨 · 출력 잠금', activeAxis: null, playbackArmed: false, torque: '0000' });
    void readLoop(session);
    heartbeat = setInterval(() => {
      if (status.activeAxis || status.playbackArmed) void sendLine(withChecksum('HEARTBEAT'));
      // The board reports every 0.5 s; silence means its USB bridge or firmware stopped.
      const lastReport = status.telemetry?.at ?? connectedAt;
      if (!boardSilent && performance.now() - lastReport > BOARD_SILENT_MS) {
        boardSilent = true;
        reportIncident('board-silent', `${((performance.now() - lastReport) / 1000).toFixed(1)}s 동안 보고 없음 (USB 다시 꽂기 필요할 수 있음)`);
        emit({ message: '보드 응답 없음 — USB 케이블을 다시 꽂아 주세요' });
      }
    }, 250);
    await sendLine('INFO');
    await sendLine('STATUS');
  } catch (error) {
    emit({ connected: false, busy: false, message: `연결 실패: ${String(error)}` });
  }
}

export async function offHardware() {
  setHardwareOutputsEnabled(false);
  await sendLine('OFF');
  setTimeout(() => { if (status.connected) void sendLine('STATUS'); }, 100);
}

export async function disconnectHw(reason = '연결 해제') {
  ++generation;
  if (heartbeat) { clearInterval(heartbeat); heartbeat = null; }
  try { await sendLine('OFF'); } catch { /* best effort */ }
  try { await reader?.cancel(); } catch { /* best effort */ }
  try { reader?.releaseLock(); } catch { /* best effort */ }
  try { writer?.releaseLock(); } catch { /* best effort */ }
  reader = null; writer = null;
  try { await port?.close(); } catch { /* best effort */ }
  port = null;
  playbackGoals = null;
  lightsOn = false; lastEyes = ''; lastRing = ''; lastLightsSentAt = 0; lastRingSentAt = 0;
  setHardwareOutputsEnabled(false);
  emit({ connected: false, busy: false, activeAxis: null, playbackArmed: false, goal: null, torque: '0000', message: reason, telemetry: null });
}

export async function armHardwareAxis(axis: SafeAxis) {
  if (!status.connected) return false;
  setHardwareOutputsEnabled(false);
  return sendLine(`ARM ${axis.toUpperCase()}`);
}

export async function armHardwarePlayback() {
  if (!status.connected || status.activeAxis || status.playbackArmed) return false;
  setHardwareOutputsEnabled(false);
  emit({ message: '4축 Sync Write · 현재 위치에서 준비 중…' });
  return sendLine('ARM ALL');
}

export async function sendHardwareFrame(motion: MotionState) {
  if (status.connected && status.playbackArmed && frameInFlight) hardwareStats.framesSkipped++;
  if (!status.connected || !status.playbackArmed || !playbackGoals || frameInFlight) return false;
  frameInFlight = true;
  try {
    const next = motionToSafeRaw(motion);
    // Every frame carries the exact goal of all four axes and the host time it
    // belongs to. The firmware buffers frames and plays them HARDWARE_PLAYOUT_SEC
    // later on a smooth curve, so USB/timer jitter never makes the motors pause.
    const now = performance.now();
    const sent = await sendLine(withChecksum(`FRAMET ${Math.round(now) >>> 0} ${next.yaw} ${next.tilt} ${next.body} ${next.rail}`));
    if (sent) { playbackGoals = next; hardwareStats.framesSent++; hardwareStats.lastFrameAt = performance.now(); }
    return sent;
  } finally {
    frameInFlight = false;
  }
}

/**
 * Streams the eyes and ring of the current frame. Needs only a connection, not
 * an armed timeline: lights never move anything. Unchanged lines are skipped
 * except for a periodic keep-alive.
 */
export async function sendHardwareLights(state: DesiredState) {
  if (!status.connected || lightsInFlight) return false;
  lightsInFlight = true;
  try {
    const { eyes, ring } = lightLines(state);
    const now = performance.now();
    const keepAlive = now - lastLightsSentAt > LIGHT_KEEPALIVE_MS;
    if (eyes !== lastEyes || keepAlive) { if (!(await sendLine(withChecksum(eyes)))) return false; lastEyes = eyes; }
    if ((ring !== lastRing && now - lastRingSentAt >= RING_MIN_INTERVAL_MS) || keepAlive) {
      if (!(await sendLine(withChecksum(ring)))) return false;
      lastRing = ring; lastRingSentAt = now; hardwareStats.ringsSent++;
    }
    if (keepAlive) lastLightsSentAt = now;
    lightsOn = true;
    return true;
  } finally {
    lightsInFlight = false;
  }
}

/** Ring off, neutral eyes. */
export async function lightsOffHardware() {
  if (!lightsOn) return;
  lightsOn = false;
  lastEyes = ''; lastRing = ''; lastLightsSentAt = 0; lastRingSentAt = 0;
  await sendLine('LIGHTS_OFF');
}

export async function stepHardwareAxis(axis: SafeAxis, deltaRaw: number) {
  if (status.activeAxis !== axis) return false;
  const base = status.goal ?? status.raw[axis];
  if (base == null) return false;
  const sent = await sendLine(`MOVE ${axis.toUpperCase()} ${Math.round(base + deltaRaw)}`);
  if (sent) setTimeout(() => { if (status.connected) void sendLine('STATUS'); }, 120);
  return sent;
}

// No release on visibilitychange: the transport keeps ticking from a worker while
// the page is hidden (TV/projector window on top, another tab), and if the page
// truly stalls the firmware holds the pose and releases torque after 5 s (and the app re-arms).
