import { ArrayBufferTarget, Muxer } from 'mp4-muxer';
import type { EyeRows8 } from '../engine/types';
import type { Project } from './engine/types';
import { evaluateEye } from './engine/controller';
import { generateMatrixFrame } from './render/matrixRenderer';
import { buildProject, totalMs, type Sequence } from './assets';
import { drawAt } from './draw';

export type EyePair = { l: EyeRows8; r: EyeRows8 };

/** boolean[8][8] (row 0 = top, col 0 = left) -> 8 row bytes, bit7 = leftmost column (same as EyeRows8). */
const toRows = (g: boolean[][]): EyeRows8 => g.map((row) => row.reduce((a, on, c) => (on ? a | (1 << (7 - c)) : a), 0));

/** Pure: the same (project, t) always gives the same pair of 8x8 bitmaps. */
export function eyesAt(project: Project, tMs: number): EyePair {
  const mf = generateMatrixFrame(evaluateEye(project, tMs, 'matrix'), project.matrix.geometry);
  return { l: toRows(mf.left), r: toRows(mf.right) };
}

/** Matrix project: used for the 8x8 bitmaps that go on the robot. */
export const projectOf = (seq: Sequence): Project => buildProject({ ...seq, mode: 'matrix' });

const same = (a: EyeRows8, b: EyeRows8) => a.every((v, i) => v === b[i]);

/** Sample the sequence at `fps` and keep only the frames where either eye changes (eye keys are hold keys). */
export function bakeKeys(seq: Sequence, fps = 30): { tSec: number; pair: EyePair }[] {
  const p = projectOf(seq);
  const n = Math.ceil((totalMs(seq) / 1000) * fps);
  const out: { tSec: number; pair: EyePair }[] = [];
  for (let i = 0; i < n; i++) {
    const pair = eyesAt(p, (i * 1000) / fps);
    const last = out[out.length - 1];
    if (!last || !same(last.pair.l, pair.l) || !same(last.pair.r, pair.r)) out.push({ tSec: i / fps, pair });
  }
  return out;
}

/** 16x8 (2:1) pure black/white frame: white discs on black, both 8x8 eyes side by side. */
function drawBW(ctx: CanvasRenderingContext2D, W: number, H: number, { l, r }: EyePair) {
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#fff';
  const cell = W / 16;
  for (let row = 0; row < 8; row++) for (let col = 0; col < 16; col++) {
    const rows = col < 8 ? l : r, c = col & 7;
    if (((rows[row] >> (7 - c)) & 1) === 0) continue;
    ctx.beginPath(); ctx.arc((col + 0.5) * cell, (row + 0.5) * cell, cell * 0.4, 0, Math.PI * 2); ctx.fill();
  }
}

export const mp4Supported = () => typeof VideoEncoder !== 'undefined' && typeof VideoFrame !== 'undefined';

/** Offline, deterministic render: every frame is drawn at its exact time and encoded to H.264 (WebCodecs + mp4-muxer). */
/** matrix -> B/W 8x8 dots; any other look -> colour render of that style. */
export async function exportSequenceMp4(seq: Sequence, width: number, fps: number, onProgress: (p: number) => void): Promise<Blob> {
  const W = Math.max(32, Math.round(width / 16) * 16), H = W / 2;
  const canvas = document.createElement('canvas'); canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  const muxer = new Muxer({ target: new ArrayBufferTarget(), video: { codec: 'avc', width: W, height: H }, fastStart: 'in-memory' });
  let error: unknown = null;
  const encoder = new VideoEncoder({ output: (c, m) => muxer.addVideoChunk(c, m), error: (e) => { error = e; } });
  const config: VideoEncoderConfig = { codec: W * H > 1280 * 720 ? 'avc1.640032' : 'avc1.64001f', width: W, height: H, bitrate: W * H * fps * 0.12, framerate: fps };
  if (!(await VideoEncoder.isConfigSupported(config)).supported) throw new Error('This browser cannot encode H.264 (use recent Chrome / Edge / Safari).');
  encoder.configure(config);
  const p = projectOf(seq), fp = buildProject(seq);
  const total = Math.ceil((totalMs(seq) / 1000) * fps);
  for (let i = 0; i < total; i++) {
    if (error) throw error;
    if (seq.mode !== 'matrix') { ctx.setTransform(1, 0, 0, 1, 0, 0); drawAt(ctx, W, H, fp, (i * 1000) / fps, seq.bg); }
    else drawBW(ctx, W, H, eyesAt(p, (i * 1000) / fps));
    const frame = new VideoFrame(canvas, { timestamp: Math.round((i * 1e6) / fps), duration: Math.round(1e6 / fps) });
    encoder.encode(frame, { keyFrame: i % (fps * 2) === 0 });
    frame.close();
    if (encoder.encodeQueueSize > 8) await new Promise((r) => setTimeout(r, 0));
    if (i % 5 === 0) { onProgress(i / total); await new Promise((r) => setTimeout(r, 0)); }
  }
  await encoder.flush(); muxer.finalize(); encoder.close(); onProgress(1);
  return new Blob([(muxer.target as ArrayBufferTarget).buffer], { type: 'video/mp4' });
}
