import { audioGainAt } from '../engine/evaluate';
import type { LieuSequence } from '../engine/types';

/** WebAudio scheduler. Not part of the pure evaluator: it only follows the single transport clock. */
let ctx: AudioContext | null = null;
const buffers = new Map<string, Promise<AudioBuffer | null>>();
let active: { src: AudioBufferSourceNode; gain: GainNode }[] = [];
let token = 0;

export function unlockAudio() {
  try {
    ctx ??= new AudioContext();
    if (ctx.state === 'suspended') void ctx.resume();
  } catch { /* audio unavailable */ }
}

function load(url: string): Promise<AudioBuffer | null> {
  let p = buffers.get(url);
  if (!p) {
    p = fetch(url).then((r) => r.arrayBuffer()).then((b) => ctx!.decodeAudioData(b)).catch(() => null);
    buffers.set(url, p);
  }
  return p;
}

export function stopAudio() {
  token++;
  for (const a of active) { try { a.src.stop(); } catch { /* already stopped */ } a.src.disconnect(); a.gain.disconnect(); }
  active = [];
}

/** Stop everything and (if playing) schedule clips from transport time tSec at speed. */
export async function syncAudio(seq: LieuSequence, tSec: number, playing: boolean, speed: number, urlOf: (id: string) => string | undefined) {
  stopAudio();
  if (!playing || !ctx) return;
  const my = token;
  const startCtx = ctx.currentTime + 0.03;
  for (const c of seq.tracks.audio) {
    if (c.toSec <= tSec) continue;
    const url = urlOf(c.assetId);
    if (!url) continue;
    const buf = await load(url);
    if (!buf || my !== token || !ctx) continue;
    const src = ctx.createBufferSource(); src.buffer = buf; src.loop = c.loop; src.playbackRate.value = speed;
    const g = ctx.createGain(); g.gain.value = 0;
    const pan = ctx.createStereoPanner();
    src.connect(g).connect(pan).connect(ctx.destination);
    const from = Math.max(c.fromSec, tSec);
    const at = startCtx + (from - tSec) / speed;
    let off = c.mediaOffsetSec + Math.max(0, tSec - c.fromSec);
    if (c.loop && buf.duration > 0) off %= buf.duration;
    const dur = (c.toSec - from);
    // gain automation sampled every 25ms of transport time
    g.gain.setValueAtTime(audioGainAt(c, from), at);
    for (let tt = from; tt <= c.toSec; tt += 0.025) g.gain.linearRampToValueAtTime(audioGainAt(c, tt), at + (tt - from) / speed);
    if (c.panTrack?.keys.length) {
      // pan sampled coarsely; value in [-1,1]
      const first = c.panTrack.keys[0].value; pan.pan.value = Math.max(-1, Math.min(1, first));
    }
    src.start(at, off, dur * speed);
    active.push({ src, gain: g });
  }
}
