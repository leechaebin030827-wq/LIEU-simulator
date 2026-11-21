import { useStore } from '../store';
import { cuesCrossed, evaluateSequenceAt } from '../engine/evaluate';
import { syncAudio, stopAudio } from './audio';
import { readScreenClock } from './screenClock';
import { playbackRateAt } from './playbackRate';
import { sendHardwareFrame, offHardware, sendHardwareLights, lightsOffHardware, getHwStatus, HARDWARE_PLAYOUT_SEC, setAutoRearmCheck } from './hardware';
import { hardwareOutputsEnabled } from './outputGate';
import { reportIncident, setIncidentClock } from './incidents';

// A host-silence release in the middle of playback is re-armed so the show goes on.
setAutoRearmCheck(() => useStore.getState().playing);
setIncidentClock(() => useStore.getState().tSec);

/** Single clock: transport time derived from performance.now() anchor, never from frame counts. */
let anchorPerf = 0, anchorT = 0, lastT = 0, lastPlaying = false, lastDirty = -1, lastRate = 1, raf = 0, lastTick = -Infinity, slowing = false;
const PAGE_STALL_MS = 150; // a tick gap this long is logged as a page stall
let motionStallNoted = false;
// The clock never freezes for a lagging video: with the TV/projector windows open the
// video routinely falls >0.12 s behind for a moment, and freezing the clock froze the
// robot and the eyes with it. It slows down instead (to no less than MIN_CATCHUP_RATE
// of normal speed) while it pulls back onto the video.
const VIDEO_AHEAD_SNAP_SEC = 0.25; // video ahead by more than this: jump forward to it
const VIDEO_JUMP_SEC = 1;          // video behind by more than this: a seek or loop wrap, snap to it
const VIDEO_PULL = 0.15;           // share of the drift corrected per 30 Hz tick
const MIN_CATCHUP_RATE = 0.3;

/** Live playback diagnostics (window.__lieuStats in the browser console). */
export const transportStats = { ticks: 0, holds: 0, snaps: 0, maxTickGapMs: 0, lastVideoErrSec: 0, worstVideoLagSec: 0 };
if (typeof window !== 'undefined') {
  const w = window as Window & { __lieuStats?: Record<string, unknown> };
  w.__lieuStats = { ...(w.__lieuStats ?? {}), transport: transportStats, tSec: () => useStore.getState().tSec, playing: () => useStore.getState().playing };
}

// requestAnimationFrame stops whenever the page is hidden (minimised, another tab,
// covered by the TV/projector window). A worker timer keeps the 30 Hz tick - and
// with it the robot, eyes and ring - running; the tick gate drops the duplicates
// while both run.
let ticker: Worker | null = null;
function startBackgroundTicks(tick: () => void) {
  if (ticker || typeof Worker === 'undefined' || typeof Blob === 'undefined' || typeof URL.createObjectURL !== 'function') return;
  try {
    const url = URL.createObjectURL(new Blob(['setInterval(() => postMessage(0), 1000 / 30);'], { type: 'text/javascript' }));
    ticker = new Worker(url);
    URL.revokeObjectURL(url);
    ticker.onmessage = tick;
  } catch { ticker = null; }
}

export function startTransport() {
  if (raf) return;
  const loop = () => {
    raf = requestAnimationFrame(loop);
    tick();
  };
  const tick = () => {
    const s = useStore.getState();
    const now = performance.now();
    const rate = playbackRateAt(s.seq, s.tSec);
    // Update React subscribers at authored frame rate, not display refresh rate.
    const changed = s.dirtyAudio !== lastDirty || s.playing !== lastPlaying || rate !== lastRate;
    if (!changed && now - lastTick < 1000 / 30 - 0.5) return;
    if (s.playing && lastPlaying && Number.isFinite(lastTick)) {
      transportStats.maxTickGapMs = Math.max(transportStats.maxTickGapMs, now - lastTick);
      if (now - lastTick > PAGE_STALL_MS) reportIncident('page-stall', `${Math.round(now - lastTick)}ms 동안 갱신 없음`);
    }
    transportStats.ticks++;
    lastTick = now;
    if (s.playing && (!lastPlaying || s.dirtyAudio !== lastDirty || rate !== lastRate)) { anchorPerf = now; anchorT = s.tSec; lastT = s.tSec; }
    if (s.playing) {
      // When the monitor MP4 is active, follow the frame that was actually
      // decoded and drawn in the viewport. performance.now() is only a
      // start-up/fallback clock; it must never run the robot ahead of video.
      // video.currentTime advances in uneven steps, so it steers the smooth
      // clock instead of replacing it every tick: seeks snap, stalls hold, and
      // small drift is pulled in gradually so motor goals stay evenly spaced.
      const videoT = readScreenClock();
      const predicted = anchorT + ((now - anchorPerf) / 1000) * rate;
      let t = predicted;
      if (videoT !== null) {
        const err = videoT - predicted;
        transportStats.lastVideoErrSec = err;
        transportStats.worstVideoLagSec = Math.min(transportStats.worstVideoLagSec, err);
        if (err > VIDEO_AHEAD_SNAP_SEC || err < -VIDEO_JUMP_SEC) { t = videoT; transportStats.snaps++; reportIncident('clock-snap', `영상과 ${err.toFixed(2)}s 차이`); }
        else {
          t = predicted + err * VIDEO_PULL;
          const slowest = lastT + (predicted - lastT) * MIN_CATCHUP_RATE;
          if (t < slowest) { t = slowest; transportStats.holds++; } // counts ticks spent slowed down
          const nowSlowing = t === slowest;
          if (nowSlowing && !slowing) reportIncident('clock-slow', `영상이 ${(-err).toFixed(2)}s 늦음`);
          slowing = nowSlowing;
        }
        anchorPerf = now; anchorT = t;
      }
      const dur = s.seq.durationSec;
      let wrapped = false;
      if (t >= dur) {
        if (s.seq.loop) { t = t % dur; anchorPerf = now; anchorT = t; wrapped = true; }
        else { t = dur; }
      }
      const crossed = wrapped || t >= lastT ? cuesCrossed(s.seq, lastT, t) : [];
      for (const c of crossed) s.logEvent(`${t.toFixed(2)}s  event: ${c.type}`);
      s.setTime(t, true);
      lastT = t;
      if (wrapped) void syncAudio(s.seq, t, true, playbackRateAt(s.seq, t), urlOf);
      if (t >= dur && !s.seq.loop) { s.pause(); }
    } else lastT = s.tSec;
    if (s.dirtyAudio !== lastDirty || s.playing !== lastPlaying) {
      if (s.playing) void syncAudio(s.seq, s.tSec, true, rate, urlOf); else stopAudio();
      lastDirty = s.dirtyAudio;
    }
    const current = useStore.getState();
    if (current.playing && hardwareOutputsEnabled()) {
      // The firmware plays frames HARDWARE_PLAYOUT_SEC late (jitter buffer), so send the pose that far ahead.
      const dur = current.seq.durationSec;
      let lead = current.tSec + HARDWARE_PLAYOUT_SEC * playbackRateAt(current.seq, current.tSec);
      if (lead >= dur) lead = current.seq.loop ? lead - dur : dur;
      void sendHardwareFrame(evaluateSequenceAt(current.seq, lead).motion);
    }
    else if (!current.playing && lastPlaying && hardwareOutputsEnabled()) void offHardware();
    // Armed but outputs locked while playing: the robot would hold still with torque on.
    const stalled = current.playing && getHwStatus().playbackArmed && !hardwareOutputsEnabled();
    if (stalled && !motionStallNoted) reportIncident('link-release', '준비 상태인데 출력이 잠겨 모션 전송이 멈춤');
    motionStallNoted = stalled;
    // Eyes and ring follow every playback while connected, armed or not.
    if (current.playing && getHwStatus().connected) void sendHardwareLights(current.evalNow());
    else if (!current.playing && lastPlaying) void lightsOffHardware();
    lastPlaying = current.playing;
    lastRate = playbackRateAt(s.seq, useStore.getState().tSec);
  };
  raf = requestAnimationFrame(loop);
  startBackgroundTicks(tick);
}

const urlOf = (id: string) => useStore.getState().assets[id]?.url ?? `${import.meta.env.BASE_URL}examples/${id}`;

export function stopTransport() {
  cancelAnimationFrame(raf); raf = 0;
  ticker?.terminate(); ticker = null;
  lastPlaying = false; lastDirty = -1; lastRate = 1; lastTick = -Infinity;
  stopAudio();
  if (hardwareOutputsEnabled()) void offHardware();
  void lightsOffHardware();
}
if (import.meta.hot) import.meta.hot.dispose(stopTransport);
