import { composeScreen, screenOut, type SceneCaption, type TvCopy } from './screenOut';
import { useEffect, useMemo, useRef } from 'react';
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
function buildRig(gltf: GltfLike) {
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
    img.onload = () => { tex.image = img; tex.needsUpdate = true; screenCtl.img = img; };
    img.src = `${import.meta.env.BASE_URL}assets/screen.jpg`; // still image until the video is ready (and if it never is)
    const outTex = new THREE.CanvasTexture(screenOut.canvas);
    outTex.colorSpace = THREE.SRGBColorSpace; outTex.flipY = tex.flipY; outTex.wrapS = tex.wrapS; outTex.wrapT = tex.wrapT;
    outTex.offset.copy(tex.offset); outTex.repeat.copy(tex.repeat); outTex.rotation = tex.rotation; outTex.center.copy(tex.center);
    screenCtl.outTex = outTex;
    const mat = new THREE.MeshBasicMaterial({ name: 'Screen', map: outTex, color: '#ffffff', toneMapped: false, fog: false, side: m.side });
    // Looping muted video as the screen content, drawn with the same UV transform as the glTF texture.
    const video = document.createElement('video');
    video.src = `${import.meta.env.BASE_URL}assets/screen.mp4`;
    video.loop = true; video.muted = true; video.defaultPlaybackRate = 0.5; video.playbackRate = 0.5; video.playsInline = true; video.autoplay = true; video.crossOrigin = 'anonymous';
    video.addEventListener('loadeddata', () => {
      const vt = new THREE.VideoTexture(video);
      vt.colorSpace = THREE.SRGBColorSpace; vt.flipY = tex.flipY; vt.wrapS = tex.wrapS; vt.wrapT = tex.wrapT;
      vt.offset.copy(tex.offset); vt.repeat.copy(tex.repeat); vt.rotation = tex.rotation; vt.center.copy(tex.center);
      screenCtl.vt = vt; applyScreen();
    });
    video.load();
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

/** Screen content per scenario: 01_* shows the still photo, every other scenario the looping video (half speed). */
const screenCtl: { mat?: THREE.MeshBasicMaterial; still?: THREE.Texture; video?: HTMLVideoElement; vt?: THREE.Texture; wantVideo: boolean; img?: HTMLImageElement; btn?: { canvas: HTMLCanvasElement; tex: THREE.CanvasTexture }; btnShown: boolean; outTex?: THREE.CanvasTexture; src: 'still' | 'video' | 'clip' | 'btn' } = { wantVideo: false, btnShown: false, src: 'still' };
export const screenWantsVideo = (seqId: string) => /^0[34]_/.test(seqId);
function applyScreen() {
  const { mat, still, video, vt, wantVideo } = screenCtl;
  if (!mat || !still || !video) return;
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
type ScreenClip = { src: string; from: number; dur: number; accel?: number; decel?: number };
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
const clipVids = new Map<string, HTMLVideoElement>();
let clipActive = false;
// Frames are copied into a canvas texture only when the video has a real frame ready (not while seeking), so the screen can never go black.
let clipCanvas: { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D; tex: THREE.CanvasTexture } | null = null;
function clipVideo(src: string) {
  let v = clipVids.get(src);
  if (!v) {
    v = document.createElement('video');
    v.src = `${import.meta.env.BASE_URL}${src}`; v.muted = true; v.playsInline = true; v.preload = 'auto'; v.crossOrigin = 'anonymous';
    v.load(); clipVids.set(src, v);
  }
  return v;
}
function updateScreenClips(clips: ScreenClip[] | null, t: number, playing: boolean, speed: number) {
  const { mat, still, img } = screenCtl;
  if (!mat || !still || !img) return;
  if (!clips || !clips.length) {
    if (clipActive) { clipActive = false; clipVids.forEach((v) => v.pause()); applyScreen(); }
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
  clips.forEach((c, i) => {
    const v = clipVideo(c.src);
    if (!(v.duration > 0)) return;
    const D = v.duration, st = i === cur ? clipState(c, D, t - c.from) : { pos: 0, v: 0 };
    const target = Math.min(st.pos, D - 0.04);
    if (playing && st.v >= 0.1 && st.v * speed >= 0.0625) {   // browsers only play between 1/16x and 16x: slower than that pins the frame
      v.playbackRate = Math.min(16, st.v * speed);
      if (Math.abs(v.currentTime - target) > 0.25) v.currentTime = target;
      if (v.paused) void v.play().catch(() => { /* autoplay blocked */ });
    } else { // standing still, scrubbing, or crawling slower than a browser can play: pin the frame
      if (!v.paused) v.pause();
      if (Math.abs(v.currentTime - target) > 0.01) v.currentTime = target;
    }
  });
  const v = clipVids.get(clips[cur].src);
  if (v && v.readyState >= 2 && !v.seeking && v.videoWidth > 0) {
    clipCanvas.ctx.drawImage(v, 0, 0, clipCanvas.canvas.width, clipCanvas.canvas.height);
    clipCanvas.tex.needsUpdate = true;
  }
}

/** Per frame: while the scenario's 'screen_button' cue window is active, show the still with the glass start button drawn on it. */
function updateStartButton(b: ButtonTimes | null, t: number) {
  const { mat, still, img } = screenCtl;
  if (!mat || !still || !img || screenCtl.wantVideo) return;
  if (!screenCtl.btn) {
    const canvas = document.createElement('canvas'); canvas.width = 940; canvas.height = 1672;
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace; tex.flipY = still.flipY; tex.wrapS = still.wrapS; tex.wrapT = still.wrapT;
    tex.offset.copy(still.offset); tex.repeat.copy(still.repeat); tex.rotation = still.rotation; tex.center.copy(still.center);
    screenCtl.btn = { canvas, tex };
  }
  const { canvas, tex } = screenCtl.btn;
  const on = !!b && drawStartButton(canvas.getContext('2d')!, canvas.width, canvas.height, img, b, t);
  if (on) tex.needsUpdate = true;
  if (on !== screenCtl.btnShown) { screenCtl.btnShown = on; screenCtl.src = on ? 'btn' : 'still'; }
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

export function Machine() {
  const gltf = useGLTF(`${import.meta.env.BASE_URL}assets/LIEU_Senario.glb`) as unknown as GltfLike;
  const rigBuilt = useMemo(() => buildRig(gltf), [gltf]);
  const tmp = useMemo(() => new THREE.Matrix4(), []);
  const lastSig = useRef('');
  const { invalidate } = useThree();

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

  useFrame(() => {
    const s = useStore.getState();
    const st = s.evalNow();
    const cue = s.seq.tracks.events.find((e) => e.type === 'screen_button');
    const vcue = s.seq.tracks.events.find((e) => e.type === 'screen_video');
    updateScreenClips(vcue ? ((vcue.payload as { clips: ScreenClip[] }).clips) : null, st.tSec, s.playing, s.speed);
    updateStartButton(cue ? (cue.payload as unknown as ButtonTimes) : null, st.tSec);
    const c = screenCtl;
    composeScreen(c.src === 'clip' ? clipCanvas?.canvas ?? null : c.src === 'btn' ? c.btn?.canvas ?? null : c.src === 'video' && c.video && c.video.readyState >= 2 ? c.video : c.img ?? null, { title: s.seq.title, scene: sceneCaption(s.seq.tracks.events, st.tSec) });
    if (c.outTex) c.outTex.needsUpdate = true;
    const stages = computeStageMatrices(st.motion, s.rig);
    frame.stages = stages; frame.state = st;
    const sig = `${st.motion.railX}|${st.motion.yawY}|${st.motion.tiltZ}|${JSON.stringify(s.rig.pivots)}|${Object.keys(s.rig.owner).length}`;
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
