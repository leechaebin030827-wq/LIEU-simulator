import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import led from '../../config/LIEU_LED_Calibration.json';
import { useStore } from '../store';
import { frame, shell } from './runtime';
import type { StageId } from '../engine/types';
import { getBit } from '../engine/eyePresets';

const GLOW_VERT = /* glsl */ `
attribute vec3 color; attribute float size; varying vec3 vColor;
uniform float uScale;
void main(){ vColor=color; vec4 mv=modelViewMatrix*vec4(position,1.0); gl_PointSize=size*uScale/(-mv.z); gl_Position=projectionMatrix*mv; }`;
const GLOW_FRAG = /* glsl */ `
varying vec3 vColor; uniform float uCore;
void main(){ vec2 d=gl_PointCoord-0.5; float r=length(d)*2.0; if(r>1.0) discard;
  float core=smoothstep(uCore,0.0,r); float halo=pow(1.0-r,2.2);
  gl_FragColor=vec4(vColor*(0.35*halo+0.9*core),1.0); }`;

function glowMaterial(scale: number, core: number) {
  return new THREE.ShaderMaterial({
    vertexShader: GLOW_VERT, fragmentShader: GLOW_FRAG, transparent: true, depthWrite: false,
    blending: THREE.AdditiveBlending, uniforms: { uScale: { value: scale }, uCore: { value: core } },
  });
}

/** Group whose matrix follows the stage that currently owns `node`. */
function StageGroup({ node, children }: { node: number; children: React.ReactNode }) {
  const ref = useRef<THREE.Group>(null);
  useFrame(() => {
    const g = ref.current; if (!g || !frame.stages) return;
    const stage: StageId = useStore.getState().rig.owner[node] ?? 'carriage';
    g.matrix.copy(frame.stages[stage]); g.matrixWorldNeedsUpdate = true;
  }, -5);
  return <group ref={ref} matrixAutoUpdate={false}>{children}</group>;
}

const ringPts = led.ring24.pixels as { virtualIndex: number; worldPositionMeters: number[] }[];
/** Eye dots are drawn without depth test (they sit just behind the shell holes) but fade out when viewed from behind/side. */
const EYE_VERT = /* glsl */ `
attribute vec3 color; attribute float size; varying vec3 vColor; varying float vFace;
uniform float uScale;
void main(){
  vec4 wp = modelMatrix*vec4(position,1.0);
  vec3 n = normalize(mat3(modelMatrix)*vec3(1.0,0.0,0.0));
  vFace = smoothstep(0.15, 0.4, dot(normalize(cameraPosition-wp.xyz), n));
  vColor = color; vec4 mv = viewMatrix*wp; gl_PointSize = size*uScale/(-mv.z); gl_Position = projectionMatrix*mv; }`;
const EYE_FRAG = /* glsl */ `
varying vec3 vColor; varying float vFace;
void main(){ vec2 d=gl_PointCoord-0.5; float r=length(d)*2.0; if(r>1.0) discard;
  float core=smoothstep(0.62,0.18,r);           // bright hot centre
  float halo=pow(1.0-r,1.6)*1.7;                // soft bloom-like falloff
  vec3 c=vColor*(1.9*core+halo)+vec3(core*core)*0.6*vColor; // overdrive towards white
  gl_FragColor=vec4(c*vFace,1.0); }`;
function eyeMaterial(scale: number) {
  return new THREE.ShaderMaterial({ vertexShader: EYE_VERT, fragmentShader: EYE_FRAG, transparent: true, depthWrite: false, depthTest: false,
    blending: THREE.AdditiveBlending, uniforms: { uScale: { value: scale } } });
}
const eyePx = led.eyes as { meshNodeIndex: number; pixels: { row: number; col: number; matrixIndex: number; worldPositionMeters: number[] }[] }[];

function RingGlow() {
  const geo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(ringPts.flatMap((p) => p.worldPositionMeters.map((v, i) => (i === 1 ? v - 0.0006 : v))), 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(24 * 3), 3));
    g.setAttribute('size', new THREE.Float32BufferAttribute(new Float32Array(24).fill(0.016), 1));
    return g;
  }, []);
  const mat = useMemo(() => glowMaterial(900, 0.35), []);
  const light = useRef<THREE.PointLight>(null);
  const diffuse = useRef<THREE.MeshBasicMaterial>(null);
  const sel = useRef<THREE.Points>(null);
  useFrame(() => {
    const st = frame.state; if (!st) return;
    const v = useStore.getState();
    const col = geo.getAttribute('color') as THREE.BufferAttribute;
    const b = st.ring24.brightness;
    let ar = 0, ag = 0, ab = 0;
    for (let i = 0; i < 24; i++) {
      const [r, g, bl, w] = st.ring24.pixels[i];
      // W is a separate physical channel; preview adds it as neutral white. Source data is untouched.
      const R = Math.min(1, (r + w * 0.95) / 255) * b, G = Math.min(1, (g + w * 0.95) / 255) * b, B = Math.min(1, (bl + w * 0.9) / 255) * b;
      col.setXYZ(i, R, G, B); ar += R; ag += G; ab += B;
    }
    col.needsUpdate = true;
    mat.visible = v.view.showLedGlow;
    if (light.current) { light.current.color.setRGB(ar / 24, ag / 24, ab / 24); light.current.intensity = Math.min(1.2, (ar + ag + ab) / 24) * 0.6; }
    if (diffuse.current) diffuse.current.color.setRGB(ar / 24 * 0.9, ag / 24 * 0.9, ab / 24 * 0.9);
    // selection ring
    const size = geo.getAttribute('size') as THREE.BufferAttribute;
    for (let i = 0; i < 24; i++) size.setX(i, v.selectedLeds.includes(i) ? 0.024 : 0.016);
    size.needsUpdate = true;
  });
  return (
    <StageGroup node={133}>
      <points ref={sel} geometry={geo} material={mat} frustumCulled={false} renderOrder={5} />
      <pointLight ref={light} position={[0, -0.05, 0]} distance={0.6} decay={2} />
      {/* diffuser tint over the LED shade footprint (disc), not raw LED spheres */}
      <mesh position={[0, -0.0268, 0]} rotation={[Math.PI / 2, 0, 0]} renderOrder={4}>
        <ringGeometry args={[0.0215, 0.0345, 48]} />
        <meshBasicMaterial ref={diffuse} transparent opacity={0.55} blending={THREE.AdditiveBlending} depthWrite={false} side={THREE.DoubleSide} />
      </mesh>
      <PickTargets />
    </StageGroup>
  );
}

function PickTargets() {
  const select = useStore((s) => s.selectLeds);
  return (
    <>
      {ringPts.map((p) => (
        <mesh key={p.virtualIndex} position={p.worldPositionMeters as [number, number, number]}
          onClick={(e) => { e.stopPropagation(); select([p.virtualIndex], e.shiftKey); }}>
          <sphereGeometry args={[0.0042, 8, 8]} />
          <meshBasicMaterial transparent opacity={0} depthWrite={false} />
        </mesh>
      ))}
    </>
  );
}

/** Lift lit dots toward the shell surface (+X) so they show in the holes instead of behind the board. */
const EYE_LIFT = 0.0008;

type Seat = { pos: [number, number, number]; normal: THREE.Vector3 };

function EyeGlow({ side }: { side: 'left' | 'right' }) {
  const data = eyePx[side === 'left' ? 0 : 1];
  const node = side === 'left' ? 13 : 8;
  // Lit dots sit on the smooth outer surface (height-field built from the shell) just above the sealing patch.
  const seats = useMemo<Seat[]>(() => data.pixels.map((p) => {
    const q = shell.surface?.sample(p.worldPositionMeters[1], p.worldPositionMeters[2]);
    if (!q) return { pos: [p.worldPositionMeters[0] + EYE_LIFT, p.worldPositionMeters[1], p.worldPositionMeters[2]] as [number, number, number], normal: new THREE.Vector3(1, 0, 0) };
    return { pos: [q.pos[0] + q.normal.x * 0.0002, q.pos[1] + q.normal.y * 0.0002, q.pos[2] + q.normal.z * 0.0002] as [number, number, number], normal: q.normal };
  }), [data]);
  const geo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(seats.flatMap((q) => q.pos), 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(64 * 3), 3));
    g.setAttribute('size', new THREE.Float32BufferAttribute(new Float32Array(64).fill(0.0064), 1));
    return g;
  }, [data, seats]);
  const mat = useMemo(() => eyeMaterial(900), []);
  const tint = useMemo(() => new THREE.Color(), []);
  useFrame(() => {
    const st = frame.state; if (!st) return;
    const v = useStore.getState().view;
    tint.set(v.eyeColor);
    const rows = st.eyes[side];
    const k = side === 'left' ? st.eyes.leftIntensity : st.eyes.rightIntensity;
    const col = geo.getAttribute('color') as THREE.BufferAttribute;
    data.pixels.forEach((p, i) => {
      const on = getBit(rows, p.row, p.col);
      const f = on ? 4.5 * k : 0; // unlit dots show only the shell-colored hole interior
      col.setXYZ(i, tint.r * f, tint.g * f, tint.b * f);
    });
    col.needsUpdate = true;
  });
  return <StageGroup node={node}><points geometry={geo} material={mat} frustumCulled={false} renderOrder={5} /></StageGroup>;
}

function PivotGizmos() {
  const show = useStore((s) => s.view.showPivots);
  const pv = useStore((s) => s.rig.pivots);
  if (!show) return null;
  return (
    <>
      <StageGroupFor stage="carriage">
        <group position={pv.yaw}>
          <Axis dir={[0, 1, 0]} color="#3ddc97" label="Yaw Y" />
        </group>
      </StageGroupFor>
      <StageGroupFor stage="carriage">
        <group position={pv.tilt}>
          <Axis dir={[0, 0, 1]} color="#ff6b6b" label="Tilt Z" />
        </group>
      </StageGroupFor>
      <StageGroupFor stage="fixedRail">
        <Axis dir={[1, 0, 0]} color="#4dabf7" label="Rail X" origin={[-0.15, 0.197, 0.06]} len={0.3} />
      </StageGroupFor>
    </>
  );
}

function StageGroupFor({ stage, children }: { stage: StageId; children: React.ReactNode }) {
  const ref = useRef<THREE.Group>(null);
  useFrame(() => { const g = ref.current; if (g && frame.stages) { g.matrix.copy(frame.stages[stage]); g.matrixWorldNeedsUpdate = true; } }, -5);
  return <group ref={ref} matrixAutoUpdate={false}>{children}</group>;
}

function Axis({ dir, color, origin = [0, 0, 0], len = 0.14 }: { dir: [number, number, number]; color: string; label?: string; origin?: [number, number, number]; len?: number }) {
  const geo = useMemo(() => new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(...origin).addScaledVector(new THREE.Vector3(...dir), -len / 2),
    new THREE.Vector3(...origin).addScaledVector(new THREE.Vector3(...dir), len / 2),
  ]), [dir, origin, len]);
  return (
    <>
      <line>
        <primitive object={geo} attach="geometry" />
        <lineBasicMaterial color={color} depthTest={false} transparent opacity={0.9} />
      </line>
      <mesh position={origin} renderOrder={10}><sphereGeometry args={[0.003, 10, 10]} /><meshBasicMaterial color={color} depthTest={false} /></mesh>
    </>
  );
}

function OuterHalo() {
  const on = useStore((s) => s.view.outerHalo);
  const mat = useRef<THREE.MeshBasicMaterial>(null);
  useFrame(() => { if (mat.current && frame.state) { const p = frame.state.ring24.pixels; const w = p.reduce((a, q) => a + q[3], 0) / 24 / 255; mat.current.opacity = 0.15 + 0.6 * w * frame.state.ring24.brightness; } });
  if (!on) return null;
  return (
    <StageGroupFor stage="carriage">
      {/* visualOnlyOuterHalo: decorative layer. Not a hardware channel (no confirmed outer LED). */}
      <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, 0.02, 0]}>
        <torusGeometry args={[0.13, 0.002, 8, 96]} />
        <meshBasicMaterial ref={mat} color="#ffffff" transparent blending={THREE.AdditiveBlending} depthWrite={false} />
      </mesh>
    </StageGroupFor>
  );
}

export function Emitters() {
  return (
    <>
      <RingGlow />
      <EyeGlow side="left" />
      <EyeGlow side="right" />
      <PivotGizmos />
      <OuterHalo />
    </>
  );
}
