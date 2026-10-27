import * as THREE from 'three';
import { ArrayBufferTarget, Muxer } from 'mp4-muxer';
import { useStore } from '../store';
import { audioGainAt, evaluateSequenceAt } from '../engine/evaluate';
import type { LieuSequence } from '../engine/types';
import { bridge } from '../three/exportBridge';
import { layout, views, type SizeKey } from './exportViews';
import { scenarioOf } from '../scenarios';

export const videoExportSupported = () => typeof VideoEncoder !== 'undefined' && typeof VideoFrame !== 'undefined' && !!bridge.gl;
export const FPS = 30;

/** "LIEU_01_Boarding_MultiView_1080p30.mp4" for the catalogue scenarios, "LIEU_<title>_MultiView_1080p30.mp4" otherwise. */
export function exportFileName(seq: LieuSequence, size: SizeKey): string {
  const sc = scenarioOf(seq.id);
  const name = sc ? `${seq.id.slice(0, 2)}_${sc.file}` : (seq.title.trim().replace(/[^\w가-힣.-]+/g, '_') || 'Sequence');
  return `LIEU_${name}_MultiView_${size}${FPS}.mp4`;
}

const urlOf = (id: string) => useStore.getState().assets[id]?.url ?? `${import.meta.env.BASE_URL}examples/${id}`;

/** Mixes every audio clip of the sequence offline (same clip / fade / gain rules as the live player, at 1x speed). */
async function mixAudio(seq: LieuSequence, sr: number): Promise<AudioBuffer | null> {
  if (!seq.tracks.audio.length) return null;
  const ctx = new OfflineAudioContext(2, Math.ceil(seq.durationSec * sr), sr);
  const cache = new Map<string, Promise<AudioBuffer | null>>();
  for (const c of seq.tracks.audio) {
    const url = urlOf(c.assetId);
    let p = cache.get(url);
    if (!p) { p = fetch(url).then((r) => r.arrayBuffer()).then((b) => ctx.decodeAudioData(b)).catch(() => null); cache.set(url, p); }
    const buf = await p; if (!buf) continue;
    const src = ctx.createBufferSource(); src.buffer = buf; src.loop = c.loop;
    const g = ctx.createGain(); g.gain.value = 0;
    src.connect(g).connect(ctx.destination);
    g.gain.setValueAtTime(audioGainAt(c, c.fromSec), c.fromSec);
    for (let t = c.fromSec; t <= c.toSec; t += 0.025) g.gain.linearRampToValueAtTime(audioGainAt(c, t), t);
    src.start(c.fromSec, c.mediaOffsetSec, c.toSec - c.fromSec);
  }
  return ctx.startRendering();
}

const mmss = (t: number) => `${Math.floor(t / 60)}:${(t % 60).toFixed(1).padStart(4, '0')}`;

function fit(ctx: CanvasRenderingContext2D, text: string, maxW: number) {
  if (ctx.measureText(text).width <= maxW) return text;
  let s = text; while (s.length > 1 && ctx.measureText(s + '…').width > maxW) s = s.slice(0, -1);
  return s + '…';
}

/** Draws one composite frame of the sequence at time t onto `out` (the multi-view picture, labels and info bar). Needs the live renderer. */
export function renderFrame(out: HTMLCanvasElement, seq: LieuSequence, t: number, size: SizeKey) {
  const { gl, scene, advance } = bridge;
  if (!gl || !scene || !advance) throw new Error('3D view is not ready');
  const st = useStore.getState();
  st.setTime(t, true);
  advance(performance.now());                                   // runs every useFrame (rig, screen picture, LEDs, eyes, projection) for time t
  const L = layout(size), vs = views(size);
  const m = evaluateSequenceAt(seq, t).motion;
  gl.setScissorTest(true);
  const cam = new THREE.PerspectiveCamera();
  for (const v of vs) {
    const p = v.pose({ railX: m.railX, liftY: m.liftY ?? 0 });
    cam.fov = p.fov; cam.aspect = v.rect.w / v.rect.h; cam.near = 0.01; cam.far = 30;
    cam.up.set(...(p.up ?? [0, 1, 0])); cam.position.set(...p.pos); cam.lookAt(new THREE.Vector3(...p.target)); cam.updateProjectionMatrix(); cam.updateMatrixWorld();
    const y = L.h - (v.rect.y + v.rect.h);
    gl.setViewport(v.rect.x, y, v.rect.w, v.rect.h); gl.setScissor(v.rect.x, y, v.rect.w, v.rect.h);
    gl.render(scene, cam);
  }
  gl.setScissorTest(false);

  const ctx = out.getContext('2d')!;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = '#0b0b0d'; ctx.fillRect(0, 0, L.w, L.h);
  ctx.drawImage(gl.domElement, 0, 0, L.w, L.h);
  const k = L.k, FONT = '"Google Sans Flex", -apple-system, "Apple SD Gothic Neo", sans-serif';
  // separators
  ctx.fillStyle = '#0b0b0d';
  ctx.fillRect(L.closeup.w - L.gap / 2, 0, L.gap, L.h);
  ctx.fillRect(L.closeup.w, L.cells[0].h - L.gap / 2, L.w - L.closeup.w, L.gap);
  ctx.fillRect(L.cells[1].x - L.gap / 2, 0, L.gap, L.cells[0].h * 2);
  // view tags
  ctx.textBaseline = 'alphabetic';
  for (const v of vs) {
    const px = 14 * k, py = 14 * k, fs = 15 * k;
    ctx.font = `600 ${fs}px ${FONT}`; const w1 = ctx.measureText(v.label).width;
    ctx.font = `400 ${fs * 0.86}px ${FONT}`; const w2 = ctx.measureText(v.sub).width;
    const bw = w1 + w2 + 38 * k, bh = 30 * k;
    ctx.fillStyle = 'rgba(11,11,13,0.72)'; ctx.fillRect(v.rect.x + px, v.rect.y + py, bw, bh);
    ctx.fillStyle = '#fff'; ctx.font = `600 ${fs}px ${FONT}`; ctx.fillText(v.label, v.rect.x + px + 12 * k, v.rect.y + py + bh * 0.67);
    ctx.fillStyle = 'rgba(255,255,255,0.62)'; ctx.font = `400 ${fs * 0.86}px ${FONT}`; ctx.fillText(v.sub, v.rect.x + px + 24 * k + w1, v.rect.y + py + bh * 0.67);
  }
  // info bar: title · scene caption · time + progress
  const b = L.barRect;
  ctx.fillStyle = '#0b0b0d'; ctx.fillRect(b.x, b.y, b.w, b.h);
  const sc = seq.tracks.events.filter((e) => e.type === 'scene').sort((a, c) => a.tSec - c.tSec).filter((e) => e.tSec <= t + 1e-6).pop() as { payload?: { title?: string } } | undefined;
  const sceneTitle = sc?.payload?.title ?? '';
  const mid = b.y + b.h / 2;
  ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
  ctx.fillStyle = '#fff'; ctx.font = `600 ${19 * k}px ${FONT}`;
  const head = `LIEU  ${scenarioOf(seq.id) ? seq.id.slice(0, 2) + '  ' + scenarioOf(seq.id)!.label : seq.title}`;
  ctx.fillText(head, b.x + 20 * k, mid);
  const hw = ctx.measureText(head).width;
  ctx.fillStyle = 'rgba(255,255,255,0.7)'; ctx.font = `400 ${17 * k}px ${FONT}`;
  const timeW = 230 * k;
  ctx.fillText(fit(ctx, sceneTitle, b.w - hw - timeW - 80 * k), b.x + 20 * k + hw + 28 * k, mid);
  ctx.textAlign = 'right'; ctx.fillStyle = '#fff'; ctx.font = `500 ${17 * k}px ${FONT}`;
  ctx.fillText(`${mmss(t)} / ${mmss(seq.durationSec)}`, b.x + b.w - 20 * k, mid - 3 * k);
  ctx.fillStyle = 'rgba(255,255,255,0.18)'; ctx.fillRect(b.x, b.y + b.h - 4 * k, b.w, 4 * k);
  ctx.fillStyle = '#fff'; ctx.fillRect(b.x, b.y + b.h - 4 * k, b.w * Math.min(1, t / Math.max(0.001, seq.durationSec)), 4 * k);
  ctx.textAlign = 'left';
}

export type ExportOpts = { size: SizeKey; audio: boolean; preview?: HTMLCanvasElement | null; onProgress: (p: number, phase: string) => void; signal: { cancelled: boolean } };

/** Offline, deterministic render at 1x speed: every frame is drawn at its exact time, then H.264 (+ AAC) is muxed to MP4. */
export async function exportMultiViewMp4(opts: ExportOpts): Promise<Blob> {
  const { gl } = bridge;
  if (!gl || !videoExportSupported()) throw new Error('This browser cannot export video (use a recent Chrome / Edge).');
  const st = useStore.getState(), seq = st.seq;
  const L = layout(opts.size), W = L.w, H = L.h;
  const t0 = st.tSec; st.pause();
  const prevRatio = gl.getPixelRatio(), prevSize = gl.getSize(new THREE.Vector2());
  const out = document.createElement('canvas'); out.width = W; out.height = H;
  try {
    let audio: AudioBuffer | null = null;
    if (opts.audio && typeof AudioEncoder !== 'undefined' && (await AudioEncoder.isConfigSupported({ codec: 'mp4a.40.2', sampleRate: 48000, numberOfChannels: 2, bitrate: 192000 })).supported) {
      opts.onProgress(0, 'Mixing audio');
      audio = await mixAudio(seq, 48000);
    }
    const muxer = new Muxer({ target: new ArrayBufferTarget(), video: { codec: 'avc', width: W, height: H }, ...(audio ? { audio: { codec: 'aac' as const, numberOfChannels: 2, sampleRate: 48000 } } : {}), fastStart: 'in-memory' });
    let error: unknown = null;
    const venc = new VideoEncoder({ output: (c, m) => muxer.addVideoChunk(c, m), error: (e) => { error = e; } });
    const vcfg: VideoEncoderConfig = { codec: W * H > 1280 * 720 ? 'avc1.640032' : 'avc1.64001f', width: W, height: H, bitrate: Math.round(W * H * FPS * 0.16), framerate: FPS };
    if (!(await VideoEncoder.isConfigSupported(vcfg)).supported) throw new Error('This browser cannot encode H.264 (use recent Chrome / Edge / Safari).');
    venc.configure(vcfg);

    gl.setPixelRatio(1); gl.setSize(W, H, false);               // the editor canvas is covered by the dialog meanwhile; restored below
    const total = Math.ceil(seq.durationSec * FPS) + 1;
    for (let i = 0; i < total; i++) {
      if (opts.signal.cancelled) throw new Error('cancelled');
      if (error) throw error;
      const t = Math.min(seq.durationSec, i / FPS);
      renderFrame(out, seq, t, opts.size);
      const frame = new VideoFrame(out, { timestamp: Math.round((i * 1e6) / FPS), duration: Math.round(1e6 / FPS) });
      venc.encode(frame, { keyFrame: i % (FPS * 2) === 0 });
      frame.close();
      if (venc.encodeQueueSize > 6) await new Promise((r) => setTimeout(r, 0));
      if (i % 4 === 0) {
        const pc = opts.preview?.getContext('2d'); if (pc) pc.drawImage(out, 0, 0, opts.preview!.width, opts.preview!.height);
        opts.onProgress(i / total * (audio ? 0.94 : 0.98), 'Rendering frames');
        await new Promise((r) => setTimeout(r, 0));
      }
    }
    await venc.flush(); venc.close();
    if (audio) {
      opts.onProgress(0.95, 'Encoding audio');
      const aenc = new AudioEncoder({ output: (c, m) => muxer.addAudioChunk(c, m), error: (e) => { error = e; } });
      aenc.configure({ codec: 'mp4a.40.2', sampleRate: 48000, numberOfChannels: 2, bitrate: 192000 });
      const c0 = audio.getChannelData(0), c1 = audio.getChannelData(Math.min(1, audio.numberOfChannels - 1));
      for (let off = 0; off < audio.length; off += 4096) {
        const n = Math.min(4096, audio.length - off), data = new Float32Array(n * 2);
        data.set(c0.subarray(off, off + n), 0); data.set(c1.subarray(off, off + n), n);
        aenc.encode(new AudioData({ format: 'f32-planar', sampleRate: 48000, numberOfFrames: n, numberOfChannels: 2, timestamp: Math.round((off / 48000) * 1e6), data }));
      }
      await aenc.flush(); aenc.close();
      if (error) throw error;
    }
    muxer.finalize(); opts.onProgress(1, 'Done');
    return new Blob([(muxer.target as ArrayBufferTarget).buffer], { type: 'video/mp4' });
  } finally {
    gl.setPixelRatio(prevRatio); gl.setSize(prevSize.x, prevSize.y, false); gl.setScissorTest(false); gl.setViewport(0, 0, prevSize.x, prevSize.y);
    useStore.getState().setTime(t0);
  }
}
