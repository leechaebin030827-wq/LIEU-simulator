import { composeScreen, screenOut, SCREEN_H, SCREEN_W, type SceneCaption, type TvCopy } from './screenOut';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { useGLTF } from '@react-three/drei';
import * as THREE from 'three';
import { useStore } from '../store';
import { computeStageMatrices } from '../engine/rig';
import { frame, shell } from './runtime';
import { drawStartButton, type ButtonTimes } from './startButton';
import type { StageId } from '../engine/types';
import { Emitters } from './Emitters';
import { Projection } from './Projection';
import { buildEyeSurface } from './eyeSurface';
import { publishScreenClock } from '../runtime/screenClock';
import { videoStats, watchVideo } from '../runtime/videoStatus';
import { reportIncident } from '../runtime/incidents';

const VIDEO_RESEEK_SEC = 0.5; // beyond this drift the monitor video is re-seeked; below it the rate is nudged
import { playbackRateAt } from '../runtime/playbackRate';

export type RigMesh = { mesh: THREE.Mesh; node: number; rest: THREE.Matrix4; orig: THREE.Material | THREE.Material[] };

function nodeOf(o: THREE.Object3D, assoc: Map<unknown, { nodes?: number }>): number | null {
  for (let p: THREE.Object3D | null = o; p; p = p.parent) {
    const a = assoc.get(p);
    if (a && a.nodes !== undefined) return a.nodes;
  }
  return null;
}

const EYE_BOARD_NODES = [7, 8, 9, 12, 13, 14, 134];
const LOWER_COLUMN_NODES = [17, 18, 139];
const EYE_BOARD_MAT = new THREE.MeshStandardMaterial({ color: '#050607', roughness: 0.95, metalness: 0 });
type Built = { root: THREE.Group; meshes: RigMesh[] };
// Stored on the cached glTF scene (not module state) so a dev hot-reload of this file never rebuilds an already re-parented rig.
const RIG_KEY = '__lieuRig';

type GltfLike = { scene: THREE.Group; parser: { associations: Map<unknown, { nodes?: number }> } };
function buildRig(gltf: GltfLike, onAssetReady: () => void) {
  const hit = (gltf.scene.userData as Record<string, Built | undefined>)[RIG_KEY];
  if (hit) return hit;
  const scene = gltf.scene;
  scene.updateMatrixWorld(true);
  const found: RigMesh[] = [];
  scene.traverse((o) => {
    if (!(o as THREE.Mesh).isMesh) return;
    const node = nodeOf(o, gltf.parser.associations);
    if (node === null) return;
    const mesh = o as THREE.Mesh;
    found.push({ mesh, node, rest: mesh.matrixWorld.clone(), orig: mesh.material });
  });
  // 'Screen' material: the seat/window image shown exactly as authored -- unlit, no tone mapping, no lighting/bloom/tint.
  const screenMat = (m: THREE.MeshStandardMaterial) => {
    if (m.name !== 'Screen' || !m.map) return m;
    const tex = m.map;
    tex.colorSpace = THREE.SRGBColorSpace;
    const img = new Image();
    img.onload = () => { tex.image = img; tex.needsUpdate = true; screenCtl.img = img; onAssetReady(); };
    img.src = `${import.meta.env.BASE_URL}assets/screen.jpg`; // still image until the video is ready (and if it never is)
    const outTex = new THREE.CanvasTexture(screenOut.canvas);
    outTex.colorSpace = THREE.SRGBColorSpace; outTex.flipY = tex.flipY; outTex.wrapS = tex.wrapS; outTex.wrapT = tex.wrapT;
    outTex.offset.copy(tex.offset); outTex.repeat.copy(tex.repeat); outTex.rotation = tex.rotation; outTex.center.copy(tex.center);
    screenCtl.outTex = outTex;
    const mat = new THREE.MeshBasicMaterial({ name: 'Screen', map: outTex, color: '#ffffff', toneMapped: false, fog: false, side: m.side });
    // Looping muted video as the screen content, drawn with the same UV transform as the glTF texture.
    const video = document.createElement('video');
    video.preload = 'none'; video.loop = true; video.muted = true; video.defaultPlaybackRate = 0.5; video.playbackRate = 0.5; video.playsInline = true; video.autoplay = false; video.crossOrigin = 'anonymous';
    video.src = `${import.meta.env.BASE_URL}assets/screen.mp4`;
    video.addEventListener('loadeddata', () => {
      const vt = new THREE.VideoTexture(video);
      vt.colorSpace = THREE.SRGBColorSpace; vt.flipY = tex.flipY; vt.wrapS = tex.wrapS; vt.wrapT = tex.wrapT;
      vt.offset.copy(tex.offset); vt.repeat.copy(tex.repeat); vt.rotation = tex.rotation; vt.center.copy(tex.center);
      screenCtl.vt = vt; applyScreen();
      onAssetReady();
    });
    Object.assign(screenCtl, { mat, still: tex, video });
    return mat;
  };
  for (const r of found) {
    r.orig = Array.isArray(r.orig) ? r.orig.map((m) => screenMat(m as THREE.MeshStandardMaterial)) : screenMat(r.orig as THREE.MeshStandardMaterial);
    r.mesh.material = r.orig;
  }
  // Body shells take the column's COLOR only (not its glossy/metallic finish).
  const colMat = found.find((r) => r.node === 132)?.orig as THREE.MeshStandardMaterial | undefined;
  if (colMat?.color) for (const nodeId of [135, 138]) {
    const m = found.find((r) => r.node === nodeId)?.orig as THREE.MeshStandardMaterial | undefined;
    if (m?.color) m.color.copy(colMat.color);
  }
  // Pale grey-teal satin body colour (reference render); column, shell and cap share it.
  for (const nodeId of [132, 135, 138]) {
    const m = found.find((r) => r.node === nodeId)?.orig as THREE.MeshStandardMaterial | undefined;
    if (m?.color) { m.color.set('#a7bfce'); m.roughness = 0.5; m.metalness = 0; m.needsUpdate = true; }
  }
  // The column then takes the shell's material (same matte finish as the donut body).
  const colRig = found.find((r) => r.node === 132), bodyMat = found.find((r) => r.node === 135)?.orig;
  if (colRig && bodyMat) { colRig.orig = bodyMat; colRig.mesh.material = bodyMat; }
  // Lower part of the column (projector body / beam holder hanging under the donut) gets the same material.
  if (bodyMat) for (const r of found) if (LOWER_COLUMN_NODES.includes(r.node)) { r.orig = bodyMat; r.mesh.material = bodyMat; }
  // Eye boards sit behind holes in the shell: render them dark so only the lit dots on the outer surface read as eyes.
    const shellRig = found.find((r) => r.node === 135);
  if (shellRig) { shell.mesh = shellRig.mesh; shell.rest = shellRig.rest.clone(); }
  for (const r of found) if (EYE_BOARD_NODES.includes(r.node)) { r.orig = EYE_BOARD_MAT; r.mesh.material = EYE_BOARD_MAT; }
  // Seal the eye holes: a smooth height-field patch over every hole, drawn with the shell's own material.
  if (shellRig) {
    const top = found.find((r) => r.node === 138);
    const surf = buildEyeSurface([{ mesh: shellRig.mesh, rest: shellRig.rest }, ...(top ? [{ mesh: top.mesh, rest: top.rest }] : [])]);
    if (surf) {
      shell.surface = surf;
      const cm = new THREE.Mesh(surf.patch, shellRig.orig as THREE.Material);
      cm.frustumCulled = false;
      found.push({ mesh: cm, node: 135, rest: new THREE.Matrix4(), orig: shellRig.orig });
    }
  }
  // Detach into a flat root so animation is restWorldMatrix x stage, never re-parenting accumulation.
  const root = new THREE.Group();
  for (const r of found) {
    root.add(r.mesh);
    r.mesh.matrixAutoUpdate = false;
    r.mesh.matrix.copy(r.rest);
    r.mesh.matrixWorldNeedsUpdate = true;
  }
  const out = { root, meshes: found };
  (gltf.scene.userData as Record<string, Built>)[RIG_KEY] = out;
  return out;
}

/**
 * The CAD export contains 310 fixed stand/frame meshes, mostly repeated bolts,
 * brackets and extrusion pieces. Rendering every copy as its own Mesh costs
 * hundreds of draw calls even though there are only 34 unique
 * geometry/material combinations. Keep the 60 motion-owned robot meshes
 * independent, but batch the fixed CAD copies into InstancedMesh objects.
 *
 * This runs on the already cached rig as well, so a dev hot update can compact
 * the current scene without reparsing/reparenting the GLB.
 */
function compactStaticMeshes(built: Built): Built {
  const meta = built.root.userData as { lieuStaticInstanced?: boolean };
  if (meta.lieuStaticInstanced) return built;

  const groups = new Map<string, RigMesh[]>();
  for (const r of built.meshes) {
    // The configured moving/carriage mesh ids are 0..141 and Rail is 143.
    // Everything above 143 belongs to the fixed exhibition frame/stand.
    if (r.node <= 143 || !(r.mesh as THREE.Mesh).geometry) continue;
    const materials = Array.isArray(r.orig) ? r.orig : [r.orig];
    const key = `${r.mesh.geometry.uuid}|${materials.map((m) => m.uuid).join(',')}`;
    const group = groups.get(key);
    if (group) group.push(r); else groups.set(key, [r]);
  }

  const replaced = new Set<RigMesh>();
  const instances: RigMesh[] = [];
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const first = group[0];
    const mesh = new THREE.InstancedMesh(first.mesh.geometry, first.orig, group.length);
    mesh.name = `LIEU fixed instances ×${group.length}`;
    mesh.matrixAutoUpdate = false;
    mesh.frustumCulled = false;
    mesh.castShadow = first.mesh.castShadow;
    mesh.receiveShadow = first.mesh.receiveShadow;
    group.forEach((r, i) => {
      mesh.setMatrixAt(i, r.rest);
      built.root.remove(r.mesh);
      replaced.add(r);
    });
    mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);
    mesh.instanceMatrix.needsUpdate = true;
    built.root.add(mesh);
    instances.push({ mesh, node: -1, rest: new THREE.Matrix4(), orig: first.orig });
  }

  built.meshes = [...built.meshes.filter((r) => !replaced.has(r)), ...instances];
  meta.lieuStaticInstanced = true;
  return built;
}

/** Screen content per scenario: 01_* shows the still photo, every other scenario the looping video (half speed). */
const screenCtl: { mat?: THREE.MeshBasicMaterial; still?: THREE.Texture; video?: HTMLVideoElement; vt?: THREE.Texture; wantVideo: boolean; img?: HTMLImageElement; btn?: { canvas: HTMLCanvasElement; tex: THREE.CanvasTexture }; btnShown: boolean; outTex?: THREE.CanvasTexture; src: 'still' | 'video' | 'clip' | 'btn' } = { wantVideo: false, btnShown: false, src: 'still' };
export const screenWantsVideo = (seqId: string) => /^0[34]_/.test(seqId);
function applyScreen() {
  const { mat, still, video, vt, wantVideo } = screenCtl;
  if (!mat || !still || !video) return;
  if (wantVideo && !vt) {
    // Only scenarios 03/04 use this legacy loop. Do not fetch its 5 MB file
    // during every app refresh when the final exhibition uses another source.
    if (video.preload === 'none') { video.preload = 'auto'; video.load(); }
    screenCtl.src = 'still';
    return;
  }
  if (wantVideo && vt) {
    screenCtl.src = 'video';
    video.playbackRate = 0.5;
    void video.play().catch(() => { /* autoplay blocked: stays on the still image */ });
  } else {
    screenCtl.src = screenCtl.btnShown && screenCtl.btn ? 'btn' : 'still';
    video.pause();
  }
}

/**
 * Cue-driven screen video ('screen_video' cue, payload {clips:[{src, from, dur, accel, decel}]}), treated like the wheels of the car: the clip
 * covers its whole length in `dur` scenario seconds, speeding up from rest over `accel` s (0 = already moving), cruising, and braking to a
 * smooth stop over `decel` s exactly on its last frame. It holds the last frame until the next clip and shows the first frame before the
 * first one. A reversed clip is just a pre-reversed file. Everything is a function of scenario time, so pause/scrub/loop show the same frame.
 */
type ScreenClip = { src: string; from: number; dur: number; accel?: number; decel?: number; hold?: 'first' | 'last' };
/** playback position (s) and speed (video-s per scenario-s) of a clip of length D at local time s */
function clipState(c: ScreenClip, D: number, s: number): { pos: number; v: number } {
  const T = Math.max(0.1, c.dur), a = Math.min(c.accel ?? 0, T / 2), d = Math.min(c.decel ?? 0, T / 2);
  if (s <= 0) return { pos: 0, v: 0 };
  if (s >= T) return { pos: D, v: 0 };
  const vc = D / (T - a / 2 - d / 2);
  if (a > 0 && s < a) return { pos: (vc * s * s) / (2 * a), v: (vc * s) / a };
  if (s < T - d) return { pos: (vc * a) / 2 + vc * (s - a), v: vc };
  const r = T - s;
  return { pos: D - (vc * r * r) / (2 * d), v: (vc * r) / d };
}
/** Inverse of clipState: visible media position -> scenario-local seconds. */
function scenarioTimeAtVideoPos(c: ScreenClip, D: number, pos: number): number {
  const T = Math.max(0.1, c.dur), a = Math.min(c.accel ?? 0, T / 2), d = Math.min(c.decel ?? 0, T / 2);
  const vc = D / (T - a / 2 - d / 2);
  if (a > 0 && pos < vc * a / 2) return Math.sqrt((2 * a * Math.max(0, pos)) / vc);
  if (d > 0 && pos > D - vc * d / 2) return T - Math.sqrt((2 * d * Math.max(0, D - pos)) / vc);
  return a + (pos - vc * a / 2) / vc;
}
const clipVids = new Map<string, HTMLVideoElement>();
let clipActive = false;
// Frames are copied into a canvas texture only when the video has a real frame ready (not while seeking), so the screen can never go black.
let clipCanvas: { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D; tex: THREE.CanvasTexture } | null = null;
// The small canvas above is intentionally cheap for the 3D robot texture. The
// passenger TV receives the decoded video element directly at its native
// 1080x1920 resolution instead of upscaling that 464x832 preview.
let clipOutputSource: CanvasImageSource | null = null;
function clipVideo(src: string, activate: boolean) {
  let v = clipVids.get(src);
  if (!v) {
    v = document.createElement('video');
    v.preload = 'none'; v.muted = true; v.playsInline = true; v.crossOrigin = 'anonymous';
    v.src = `${import.meta.env.BASE_URL}${src}`;
    clipVids.set(src, v);
  }
  // The exhibition master is 43 MB. Loading it on a paused t=0 refresh was
  // the dominant startup stall; fetch/decode only after Play or an explicit seek.
  if (activate && v.preload === 'none') { v.preload = 'auto'; v.load(); }
  return v;
}
function updateScreenClips(clips: ScreenClip[] | null, t: number, playing: boolean, transportRate = 1) {
  const { mat, still, img } = screenCtl;
  if (!mat || !still || !img) return;
  if (!clips || !clips.length) {
    clipOutputSource = null;
    if (clipActive) { clipActive = false; clipVids.forEach((v) => v.pause()); applyScreen(); }
    publishScreenClock(null);
    return;
  }
  if (!clipCanvas) {
    const canvas = document.createElement('canvas'); canvas.width = 464; canvas.height = 832;
    const ctx = canvas.getContext('2d')!; ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace; tex.flipY = still.flipY; tex.wrapS = still.wrapS; tex.wrapT = still.wrapT;
    tex.offset.copy(still.offset); tex.repeat.copy(still.repeat); tex.rotation = still.rotation; tex.center.copy(still.center);
    clipCanvas = { canvas, ctx, tex };
  }
  if (!clipActive) { clipActive = true; screenCtl.video?.pause(); screenCtl.src = 'clip'; }
  let cur = 0;
  clips.forEach((c, i) => { if (t >= c.from) cur = i; });
  const active = clips[cur];
  const v = clipVideo(active.src, playing || t > 0.05);
  videoStats.el = v; videoStats.src = active.src; watchVideo(v);
  clipVids.forEach((other, src) => { if (src !== active.src) other.pause(); });
  if (v.duration > 0) {
    const D = v.duration;
    const st = active.hold === 'first' ? { pos: 0, v: 0 }
      : active.hold === 'last' ? { pos: D, v: 0 }
        : clipState(active, D, t - active.from);
    const target = Math.min(st.pos, D - 0.04);
    if (playing && st.v >= 0.1) {
      // Small drift is absorbed by nudging the playback rate (+/-10%). Seeking the 43 MB
      // master on every 0.08 s of drift forced a keyframe decode each time, stalling the
      // video - and with it the clock the robot follows - again and again.
      const base = Math.min(16, st.v * transportRate);
      const drift = v.currentTime - target;
      videoStats.lastDrift = drift;
      if (Math.abs(drift) > VIDEO_RESEEK_SEC) {
        v.currentTime = target; v.playbackRate = base; videoStats.seeks++;
        reportIncident('video-seek', `영상이 타임라인보다 ${drift > 0 ? '+' : ''}${drift.toFixed(2)}s 어긋나 재탐색`);
      }
      else v.playbackRate = base * Math.min(1.1, Math.max(0.9, 1 - drift * 0.5));
      if (v.paused) void v.play().catch(() => { /* autoplay blocked */ });
    } else {
      if (!v.paused) v.pause();
      if (Math.abs(v.currentTime - target) > 0.01) v.currentTime = target;
    }
  }
  if (v && v.readyState >= 2 && !v.seeking && v.videoWidth > 0) {
    clipCanvas.ctx.drawImage(v, 0, 0, clipCanvas.canvas.width, clipCanvas.canvas.height);
    clipCanvas.tex.needsUpdate = true;
    clipOutputSource = v;
  } else {
    clipOutputSource = clipCanvas.canvas;
  }
  publishScreenClock(playing && v && v.readyState >= 2 && !v.seeking && !v.paused
    ? active.from + scenarioTimeAtVideoPos(active, v.duration, v.currentTime)
    : null);
}

/** Per frame: while the scenario's 'screen_button' cue window is active, show the still with the glass start button drawn on it. */
function updateStartButton(b: ButtonTimes | null, t: number) {
  const { mat, still, img } = screenCtl;
  if (!mat || !still || !img || screenCtl.wantVideo) return;
  if (!screenCtl.btn) {
    const canvas = document.createElement('canvas'); canvas.width = SCREEN_W; canvas.height = SCREEN_H;
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace; tex.flipY = still.flipY; tex.wrapS = still.wrapS; tex.wrapT = still.wrapT;
    tex.offset.copy(still.offset); tex.repeat.copy(still.repeat); tex.rotation = still.rotation; tex.center.copy(still.center);
    screenCtl.btn = { canvas, tex };
  }
  const { canvas, tex } = screenCtl.btn;
  // For the exhibition master clip, compose the button over the current video frame,
  // not over the legacy screen.jpg still. clipCanvas always retains the last good frame.
  const background = clipActive ? clipOutputSource ?? clipCanvas?.canvas ?? img : img;
  const on = !!b && drawStartButton(canvas.getContext('2d')!, canvas.width, canvas.height, background, b, t);
  if (on) tex.needsUpdate = true;
  // Do not fall back to screen.jpg when the button is outside its active
  // window. Scenario 08 keeps the master MP4 underneath for all 82.24 s; the
  // button is only a temporary overlay on that moving frame.
  if (on !== screenCtl.btnShown) screenCtl.btnShown = on;
  screenCtl.src = on ? 'btn' : clipActive ? 'clip' : screenCtl.wantVideo ? 'video' : 'still';
}

function sceneCaption(events: { type: string; tSec: number; payload?: unknown }[], t: number): SceneCaption | null {
  const scenes = events.filter((e) => e.type === 'scene').sort((a, b) => a.tSec - b.tSec);
  let idx = -1;
  scenes.forEach((e, i) => { if (e.tSec <= t + 1e-6) idx = i; });
  if (idx < 0) return null;
  const p = scenes[idx].payload as { title?: string; desc?: string; tv?: TvCopy } | undefined;
  if (!p?.title) return null;
  return { title: p.title, desc: p.desc, tv: p.tv, idx, total: scenes.length, age: t - scenes[idx].tSec, remain: idx + 1 < scenes.length ? scenes[idx + 1].tSec - t : 1e9,
    prev: idx > 0 ? (() => { const q = scenes[idx - 1].payload as { title?: string; desc?: string; tv?: TvCopy } | undefined; return { tv: q?.tv, title: q?.title ?? '', desc: q?.desc }; })() : undefined };
}

const opaqueCache = new Map<THREE.Material, THREE.Material>();
function opaqueOf(m: THREE.Material): THREE.Material {
  if (!m.transparent) return m;
  let c = opaqueCache.get(m);
  if (!c) { c = m.clone(); c.transparent = false; c.opacity = 1; c.depthWrite = true; if ('color' in c) (c as THREE.MeshStandardMaterial).color.multiplyScalar(0.9); opaqueCache.set(m, c); }
  return c;
}
const hiMat = new THREE.MeshStandardMaterial({ color: '#ff9f1c', emissive: '#ff6a00', emissiveIntensity: 0.6, transparent: true, opacity: 0.85 });

export function Machine({ previewPaused = false }: { previewPaused?: boolean }) {
  const gltf = useGLTF(`${import.meta.env.BASE_URL}assets/LIEU_Senario.glb`) as unknown as GltfLike;
  const { invalidate } = useThree();
  const cachedRig = useMemo(() => buildRig(gltf, invalidate), [gltf, invalidate]);
  const rigBuilt = compactStaticMeshes(cachedRig);
  const tmp = useMemo(() => new THREE.Matrix4(), []);
  const lastSig = useRef('');
  const lastScreenDrawAt = useRef(-Infinity);
  const lastScreenSource = useRef<CanvasImageSource | null>(null);
  const lastScreenSig = useRef('');

  // Connecting real hardware unmounts the preview. Stop every detached video
  // explicitly so Chrome also stops decoding in the background.
  useEffect(() => () => {
    clipVids.forEach((v) => v.pause());
    screenCtl.video?.pause();
    clipActive = false;
    clipOutputSource = null;
    publishScreenClock(null);
  }, []);


  // Manage material mode (opaque override / highlight)
  const opaque = useStore((s) => s.view.opaqueMaterials);
  const selNode = useStore((s) => s.selNode);
  const hide = useStore((s) => s.view.hideMachine);
  useEffect(() => {
    for (const r of rigBuilt.meshes) {
      if (r.node === selNode) r.mesh.material = hiMat;
      else if (opaque) r.mesh.material = Array.isArray(r.orig) ? r.orig.map(opaqueOf) : opaqueOf(r.orig);
      else r.mesh.material = r.orig;
      r.mesh.visible = !hide || r.node === selNode;
    }
    invalidate();
  }, [opaque, selNode, hide, rigBuilt, invalidate]);

  const seqId = useStore((s) => s.seq.id);
  useEffect(() => { screenCtl.wantVideo = screenWantsVideo(seqId); applyScreen(); invalidate(); }, [seqId, rigBuilt, invalidate]);

  // Cutaway: clip the front half (z > 0) with a plane when enabled
  const cutaway = useStore((s) => s.view.cutaway);
  const gl = useThree((s) => s.gl);
  useEffect(() => {
    gl.localClippingEnabled = true;
    const plane = cutaway ? [new THREE.Plane(new THREE.Vector3(0, 0, -1), 0)] : [];
    for (const r of rigBuilt.meshes) for (const m of Array.isArray(r.orig) ? r.orig : [r.orig]) { m.clippingPlanes = plane; m.needsUpdate = true; }
    opaqueCache.forEach((m) => { m.clippingPlanes = plane; m.needsUpdate = true; });
    hiMat.clippingPlanes = plane;
  }, [cutaway, gl, rigBuilt]);

  const updateMonitor = useCallback(() => {
    const s = useStore.getState();
    const st = s.evalNow();
    const cue = s.seq.tracks.events.find((e) => e.type === 'screen_button');
    const vcue = s.seq.tracks.events.find((e) => e.type === 'screen_video');
    updateScreenClips(vcue ? ((vcue.payload as { clips: ScreenClip[] }).clips) : null, st.tSec, s.playing, playbackRateAt(s.seq, st.tSec));
    updateStartButton(cue ? (cue.payload as unknown as ButtonTimes) : null, st.tSec);
    const c = screenCtl;
    const screenSource = c.src === 'clip' ? clipOutputSource ?? clipCanvas?.canvas ?? c.img ?? null : c.src === 'btn' ? c.btn?.canvas ?? null : c.src === 'video' && c.video && c.video.readyState >= 2 ? c.video : c.img ?? null;
    const screenSig = `${s.seq.id}|${c.src}|${st.tSec.toFixed(4)}`;
    const now = performance.now();
    // The source video is 30 fps. Redrawing the full-HD compositing canvas at
    // 60+ fps doubles work without adding a frame. While paused, redraw only
    // on a seek/source change plus a slow heartbeat for late-loading fonts.
    const drawScreen = s.playing
      ? now - lastScreenDrawAt.current >= 1000 / 30
      : screenSource !== lastScreenSource.current || screenSig !== lastScreenSig.current || now - lastScreenDrawAt.current >= 1000;
    if (drawScreen) {
      composeScreen(screenSource, { title: s.seq.title, scene: sceneCaption(s.seq.tracks.events, st.tSec) });
      const loopCue = s.seq.tracks.events.find((e) => e.type === 'screen_loop_transition');
      if (loopCue) {
        const p = loopCue.payload as { from: number; mid?: number; blackFrom?: number; blackUntil?: number; to: number };
        const blackFrom = p.blackFrom ?? p.mid ?? p.from;
        const blackUntil = p.blackUntil ?? p.mid ?? blackFrom;
        const ease = (u: number) => { const x = Math.max(0, Math.min(1, u)); return x * x * (3 - 2 * x); };
        const black = st.tSec < p.from || st.tSec > p.to ? 0
          : st.tSec <= blackFrom ? ease((st.tSec - p.from) / Math.max(1e-6, blackFrom - p.from))
            : st.tSec <= blackUntil ? 1
              : 1 - ease((st.tSec - blackUntil) / Math.max(1e-6, p.to - blackUntil));
        if (black > 0.001) {
          screenOut.ctx.save();
          screenOut.ctx.fillStyle = `rgba(0,0,0,${black})`;
          screenOut.ctx.fillRect(0, 0, screenOut.canvas.width, screenOut.canvas.height);
          screenOut.ctx.restore();
        }
      }
      if (c.outTex) c.outTex.needsUpdate = true;
      lastScreenDrawAt.current = now;
      lastScreenSource.current = screenSource;
      lastScreenSig.current = screenSig;
    }
  }, []);

  // Hardware mode suspends WebGL, but the TV and its video clock must keep
  // advancing. Drive only the monitor compositor while the 3D loop is stopped.
  useEffect(() => {
    if (!previewPaused) return;
    updateMonitor();
    const timer = window.setInterval(updateMonitor, 1000 / 30);
    return () => window.clearInterval(timer);
  }, [previewPaused, updateMonitor]);

  useFrame(() => {
    const s = useStore.getState(), st = s.evalNow();
    if (!previewPaused) updateMonitor();
    const stages = computeStageMatrices(st.motion, s.rig);
    frame.stages = stages; frame.state = st;
    const sig = `${st.motion.railX}|${st.motion.bodyYaw ?? 0}|${st.motion.yawY}|${st.motion.tiltZ}|${JSON.stringify(s.rig.pivots)}|${Object.keys(s.rig.owner).length}`;
    // Ownership may change at any time; recompute all (61 matrix multiplies is trivial).
    void sig; void lastSig;
    for (const r of rigBuilt.meshes) {
      const stage: StageId = s.rig.owner[r.node] ?? 'fixedRail';
      tmp.multiplyMatrices(stages[stage], r.rest);
      r.mesh.matrix.copy(tmp);
      r.mesh.matrixWorldNeedsUpdate = true;
    }
  }, -10);

  return (
    <>
      <primitive object={rigBuilt.root} />
      <Emitters />
      <Projection />
    </>
  );
}

export function useStageOf(node: number): StageId {
  return useStore((s) => s.rig.owner[node] ?? 'fixedRail');
}
