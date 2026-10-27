import { Suspense, useEffect, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls, Environment, Lightformer } from '@react-three/drei';
import * as THREE from 'three';
import { Machine } from '../three/Machine';
import { useStore } from '../store';
import { motionWarnings } from '../engine/limits';
import { PREVIEW_LIMITS } from '../engine/rigDefaults';
import { PROJ_DEFAULTS } from '../three/Projection';
import { bridge } from '../three/exportBridge';

const PRESETS: Record<string, { pos: [number, number, number]; target?: [number, number, number]; up?: [number, number, number] }> = {
  // Default view: robot + screen + stand seen from the front-right, projection text on the floor.
  Persp: { pos: [1.8, -0.1, -2.2], target: [-0.4, -0.7, 0] }, Front: { pos: [1.0, 0.03, 0] }, Side: { pos: [0, 0.03, 1.0] }, Top: { pos: [0, 1.0, 0.001] }, Bottom: { pos: [0, -1.0, 0.001] },
};
let camReq: { name: string; n: number } = { name: 'Persp', n: 0 };
const camListeners = new Set<() => void>();
export const setCamPreset = (name: string) => { camReq = { name, n: camReq.n + 1 }; camListeners.forEach((f) => f()); };

function CameraRig() {
  const camera = useThree((s) => s.camera);
  const controls = useRef<any>(null);
  const { invalidate } = useThree();
  useEffect(() => {
    const apply = () => {
      const p = PRESETS[camReq.name]; if (!p) return;
      const target = new THREE.Vector3(...(p.target ?? [0, 0, 0]));
      camera.position.set(...p.pos); camera.lookAt(target);
      controls.current?.target.copy(target); controls.current?.update(); invalidate();
    };
    apply(); camListeners.add(apply); return () => { camListeners.delete(apply); };
  }, [camera, invalidate]);
  const dom = useThree((st) => st.gl.domElement);
  useEffect(() => {
    // double-click: re-center the orbit target on the robot, keeping the current viewing direction
    const onDbl = () => { const c = controls.current; if (!c) return; c.target.set(0, 0, 0); c.update(); invalidate(); };
    dom.addEventListener('dblclick', onDbl); return () => dom.removeEventListener('dblclick', onDbl);
  }, [dom, invalidate]);
  return <OrbitControls ref={controls} makeDefault enableDamping dampingFactor={0.12} enablePan screenSpacePanning zoomToCursor panSpeed={1.4} rotateSpeed={0.9} zoomSpeed={1.1} minDistance={0.03} maxDistance={8} mouseButtons={{ LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.ROTATE, RIGHT: THREE.MOUSE.PAN }} touches={{ ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN }} />;
}

function Floor() {
  const y = PROJ_DEFAULTS.floorY;
  // Virtual light-grey ground plane at the model's lowest point; the projection lands on it.
  return (
    <mesh position={[0, y - 0.0004, 0]} rotation={[-Math.PI / 2, 0, 0]} renderOrder={-1}>
      <planeGeometry args={[10, 10]} />
      <meshStandardMaterial color="#cfd1d4" roughness={0.95} metalness={0} />
    </mesh>
  );
}

export function Viewport() {
  const view = useStore((s) => s.view);
  const setView = useStore((s) => s.setView);
  const seq = useStore((s) => s.seq);
  const live = useStore((s) => Object.keys(s.live).length > 0);
  const warns = motionWarnings(seq);
  const [cur, setCur] = useState('Persp');
  const [menu, setMenu] = useState(false);
  const tSec = useStore((s) => s.tSec);
  const scenes = seq.tracks.events.filter((e) => e.type === 'scene').sort((a, b) => a.tSec - b.tSec);
  const cap = [...scenes].reverse().find((e) => e.tSec <= tSec + 1e-6) as { payload?: { title?: string; desc?: string } } | undefined;
  return (
    <div className="view">
      <div className="vpbar">
        <div className="seg">
          {Object.keys(PRESETS).map((k) => <button key={k} className={cur === k ? 'on' : ''} title={{ Persp: 'Default view', Front: 'Front (eye side)', Side: 'Side view', Top: 'From above', Bottom: 'From below (LED · projector)' }[k]} onClick={() => { setCur(k); setCamPreset(k); }}>{k}</button>)}
        </div>
        <div className="vpmenu">
          <button className={menu ? 'on' : ''} onClick={() => setMenu(!menu)} title="Display options">Display ▾</button>
          {menu && (
            <div className="vpdrop" onMouseLeave={() => setMenu(false)}>
              {([
                ['opaqueMaterials', 'Opaque', 'On: render all parts opaque. Off: use the original GLB transparency.'],
                ['showPivots', 'Axes', 'Show rotation axes (Yaw/Tilt) and rail direction'],
                ['showBeam', 'Light cone', 'Simulator-only: shows the projector beam as a soft cone down to the projected image'],
                ['showFrustum', 'Projector frustum', 'Outline the area the projector lights on the floor'],
                ['cutaway', 'Cutaway', 'Cut the body in half to see inside'],
                ['outerHalo', 'Outer ring (visual)', 'Decorative outer glow ring (not real hardware)'],
                ['hideMachine', 'Hide body', 'Hide the body to check only the light/projection'],
              ] as const).map(([k, label, tip]) => (
                <label key={k} title={tip}><input type="checkbox" checked={!!view[k]} onChange={() => setView({ [k]: !view[k] })} />{label}</label>
              ))}
            </div>
          )}
        </div>
      </div>
      {cap?.payload?.title && <div className="vpcap"><b>{cap.payload.title}</b>{cap.payload.desc ? <span>{cap.payload.desc}</span> : null}</div>}
      <div className="vpstate" title="Preview only · nothing is sent to the real robot">Preview{live ? <span className="warn"> · LIVE (unsaved)</span> : null}</div>
      {warns.length > 0 && <div className="vpwarn">Preview limit exceeded: {warns.slice(0, 3).map((w) => `${w.ch} ${w.kind}@${w.tSec.toFixed(2)}s`).join(', ')} — not real hardware limits ({Object.entries(PREVIEW_LIMITS).length}axes, demo values)</div>}
      <Canvas camera={{ fov: 40, near: 0.01, far: 30, position: PRESETS.Persp.pos }} gl={{ antialias: true }} dpr={[1, 2]} onPointerMissed={() => undefined}>
        <color attach="background" args={['#d4d5d8']} />
        <hemisphereLight args={['#bcd0ff', '#2a2218', 0.9]} />
        <directionalLight position={[1, 2, 1.5]} intensity={1.6} />
        <directionalLight position={[-1.5, 0.5, -1]} intensity={0.6} />
        <Suspense fallback={null}>
          <Environment resolution={128} environmentIntensity={0.9}>
            <Lightformer form="rect" intensity={2.2} position={[0, 4, 0]} rotation-x={Math.PI / 2} scale={[8, 8, 1]} color="#dfe8ff" />
            <Lightformer form="rect" intensity={1.4} position={[4, 1, 2]} rotation-y={-Math.PI / 2} scale={[6, 3, 1]} color="#fff3e0" />
            <Lightformer form="rect" intensity={1.0} position={[-4, 1, -2]} rotation-y={Math.PI / 2} scale={[6, 3, 1]} color="#cfe0ff" />
            <Lightformer form="rect" intensity={0.5} position={[0, -3, 0]} rotation-x={-Math.PI / 2} scale={[8, 8, 1]} color="#8a7f70" />
          </Environment>
          <Machine />
        </Suspense>
        <Floor />
        <CameraRig />
        <Invalidator />
        <ExportBridge />
      </Canvas>
    </div>
  );
}

/** Hands the live renderer / scene to the video exporter. */
function ExportBridge() {
  const gl = useThree((s) => s.gl), scene = useThree((s) => s.scene), camera = useThree((s) => s.camera), advance = useThree((s) => s.advance);
  useEffect(() => { Object.assign(bridge, { gl, scene, camera, advance }); }, [gl, scene, camera, advance]);
  return null;
}

function Invalidator() { useFrame(() => undefined); return null; }
