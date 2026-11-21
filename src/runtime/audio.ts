import { audioGainAt } from '../engine/evaluate';
import type { LieuSequence } from '../engine/types';

/** WebAudio scheduler. Not part of the pure evaluator: it only follows the single transport clock. */
let ctx: AudioContext | null = null;
const buffers = new Map<string, Promise<AudioBuffer | null>>();
let active: { src: AudioBufferSourceNode; gain: GainNode; pan: StereoPannerNode }[] = [];
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
    p = fetch(url).then((r) => { if (!r.ok) throw new Error(`Audio HTTP ${r.status}`); return r.arrayBuffer(); }).then((b) => ctx!.decodeAudioData(b)).catch(() => null);
    buffers.set(url, p);
  }
  return p;
}

export function stopAudio() {
  token++;
  for (const a of active) { try { a.src.stop(); } catch { /* already stopped */ } a.src.disconnect(); a.gain.disconnect(); a.pan.disconnect(); }
  active = [];
}

/** Stop everything and (if playing) schedule clips from transport time tSec at speed. */
export async function syncAudio(seq: LieuSequence, tSec: number, playing: boolean, speed: number, urlOf: (id: string) => string | undefined) {
  stopAudio();
  if (!playing || !ctx) return;
  const my = token, startedAt = performance.now();
  const clips = seq.tracks.audio.filter((c) => c.toSec > tSec);
  const urls = new Set(clips.map((c) => urlOf(c.assetId)).filter((url): url is string => !!url));
  // Retain only media needed by this sequence, instead of every scenario ever opened.
  for (const url of buffers.keys()) if (!urls.has(url)) buffers.delete(url);
  const loaded = await Promise.all([...urls].map(async (url) => [url, await load(url)] as const));
  if (my !== token || !ctx) return;
  const decoded = new Map(loaded);
  const startCtx = ctx.currentTime + 0.03;
  // Decoding can take seconds on first play. Skip that elapsed media, rather than
  // starting stale audio at a past AudioContext timestamp after the video advanced.
  const currentT = tSec + (performance.now() - startedAt) / 1000 * speed + 0.03 * speed;
  for (const c of clips) {
    const url = urlOf(c.assetId), buf = url ? decoded.get(url) : null;
    if (!buf || c.toSec <= currentT) continue;
    const from = Math.max(c.fromSec, currentT);
    const at = startCtx + (from - currentT) / speed;
    // Media seconds per scenario second: follows the scenario speed unless the clip keeps its native pitch.
    const mediaRate = c.nativeRate ? 1 / speed : 1;
    let off = c.mediaOffsetSec + Math.max(0, currentT - c.fromSec) * mediaRate;
    if (c.loop && buf.duration > 0) off %= buf.duration;
    if (!c.loop && off >= buf.duration) continue;
    const src = ctx.createBufferSource(); src.buffer = buf; src.loop = c.loop; src.playbackRate.value = c.nativeRate ? 1 : speed;
    const g = ctx.createGain(); g.gain.value = 0;
    const pan = ctx.createStereoPanner();
    src.connect(g).connect(pan).connect(ctx.destination);
    g.gain.setValueAtTime(audioGainAt(c, from), at);
    for (let tt = from; tt <= c.toSec; tt += 0.025) g.gain.linearRampToValueAtTime(audioGainAt(c, tt), at + (tt - from) / speed);
    if (c.panTrack?.keys.length) pan.pan.value = Math.max(-1, Math.min(1, c.panTrack.keys[0].value));
    const entry = { src, gain: g, pan };
    src.onended = () => {
      src.disconnect(); g.disconnect(); pan.disconnect();
      active = active.filter((a) => a !== entry);
    };
    src.start(at, off, (c.toSec - from) * mediaRate);
    active.push(entry);
  }
}
