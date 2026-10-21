import { useStore } from '../store';
import { cuesCrossed } from '../engine/evaluate';
import { syncAudio, stopAudio } from './audio';

/** Single clock: transport time derived from performance.now() anchor, never from frame counts. */
let anchorPerf = 0, anchorT = 0, lastT = 0, lastPlaying = false, lastDirty = -1, raf = 0;

export function startTransport() {
  if (raf) return;
  const loop = () => {
    raf = requestAnimationFrame(loop);
    const s = useStore.getState();
    const now = performance.now();
    if (s.playing && (!lastPlaying || s.dirtyAudio !== lastDirty)) { anchorPerf = now; anchorT = s.tSec; lastT = s.tSec; }
    if (s.playing) {
      let t = anchorT + ((now - anchorPerf) / 1000) * s.speed;
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
      if (wrapped) void syncAudio(s.seq, t, true, s.speed, urlOf);
      if (t >= dur && !s.seq.loop) { s.pause(); }
    } else lastT = s.tSec;
    if (s.dirtyAudio !== lastDirty || s.playing !== lastPlaying) {
      if (s.playing) void syncAudio(s.seq, s.tSec, true, s.speed, urlOf); else stopAudio();
      lastDirty = s.dirtyAudio;
    }
    lastPlaying = s.playing;
  };
  raf = requestAnimationFrame(loop);
}

const urlOf = (id: string) => useStore.getState().assets[id]?.url ?? `${import.meta.env.BASE_URL}examples/${id}`;
