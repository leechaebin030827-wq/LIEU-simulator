import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { useGLTF } from '@react-three/drei';
import * as THREE from 'three';
import { useStore } from '../store';
import { computeStageMatrices } from '../engine/rig';
import { frame, shell } from './runtime';
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
  // 'Screen' material: swap the GLB's blank placeholder texture for the seat/window image (same texture object, so opaque clones follow).
  for (const r of found) {
    const ms = Array.isArray(r.orig) ? r.orig : [r.orig];
    for (const m of ms as THREE.MeshStandardMaterial[]) {
      if (m.name !== 'Screen' || !m.map || m.userData.screenImage) continue;
      m.userData.screenImage = true;
      const tex = m.map, img = new Image();
      img.onload = () => { tex.image = img; tex.needsUpdate = true; m.emissive.set('#ffffff'); m.emissiveMap = tex; m.emissiveIntensity = 0.55; m.needsUpdate = true; };
      img.src = `${import.meta.env.BASE_URL}assets/screen.jpg`;
    }
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
    if (m?.color) { m.color.set('#a8c3c7'); m.roughness = 0.5; m.metalness = 0; m.needsUpdate = true; }
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
