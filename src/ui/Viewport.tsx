import { Suspense, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls, Environment, Lightformer } from '@react-three/drei';
import * as THREE from 'three';
import { Machine } from '../three/Machine';
import { useStore } from '../store';
import { motionWarnings } from '../engine/limits';
import { PREVIEW_LIMITS } from '../engine/rigDefaults';
import { PROJ_DEFAULTS } from '../three/Projection';
import { bridge } from '../three/exportBridge';
import { getHwStatus, subscribeHw } from '../runtime/hardware';
import { hardwareOutputsEnabled, subscribeHardwareOutputs } from '../runtime/outputGate';

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

/** Keep the editor preview below display-white so LED brightness steps do not clip together. */
function PreviewExposure() {
  const gl = useThree((s) => s.gl);
  useEffect(() => {
    gl.toneMapping = THREE.ACESFilmicToneMapping;
    gl.toneMappingExposure = 0.82;
    gl.outputColorSpace = THREE.SRGBColorSpace;
    gl.shadowMap.needsUpdate = true;
  }, [gl]);
  return null;
}

export function Viewport() {
  const view = useStore((s) => s.view);
  const setView = useStore((s) => s.setView);
  const seq = useStore((s) => s.seq);
  const live = useStore((s) => Object.keys(s.live).length > 0);
  const playing = useStore((s) => s.playing);
  const hardwareConnected = useSyncExternalStore(subscribeHw, () => getHwStatus().connected, () => false);
  const hardwareOutputs = useSyncExternalStore(subscribeHardwareOutputs, hardwareOutputsEnabled, () => false);
  const hardwarePlaying = hardwareConnected && hardwareOutputs && playing;
  const warns = useMemo(() => motionWarnings(seq), [seq]);
  const [cur, setCur] = useState('Persp');
  const [menu, setMenu] = useState(false);
  const tSec = useStore((s) => s.tSec);
  const scenes = useMemo(() => seq.tracks.events.filter((e) => e.type === 'scene').sort((a, b) => a.tSec - b.tSec), [seq]);
  const cap = [...scenes].reverse().find((e) => e.tSec <= tSec + 1e-6) as { payload?: { title?: string; desc?: string } } | undefined;
  return (
    <div className="view">
      <div className="vpbar">
        <div className="seg">
          {Object.keys(PRESETS).map((k) => <button key={k} disabled={hardwarePlaying} className={cur === k ? 'on' : ''} title={{ Persp: 'Default view', Front: 'Front (eye side)', Side: 'Side view', Top: 'From above', Bottom: 'From below (LED · projector)' }[k]} onClick={() => { setCur(k); setCamPreset(k); }}>{k}</button>)}
        </div>
        <div className="vpmenu">
          <button disabled={hardwarePlaying} className={menu ? 'on' : ''} onClick={() => setMenu(!menu)} title="Display options">Display ▾</button>
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
      <div className={'vp-runstate' + (hardwarePlaying ? ' hardware-playing' : '')}>
        {hardwarePlaying ? '● HARDWARE PLAYING' : hardwareConnected && hardwareOutputs ? 'HARDWARE READY · Preview' : hardwareConnected ? 'MOTION EDIT · Hardware connected' : 'Preview'}
        {live ? <span className="warn"> · LIVE (unsaved)</span> : null}
      </div>
      {hardwarePlaying && (
        <div className="vp-hardware-playing-overlay">
          <b>HARDWARE PLAYING</b>
          <span>실장치 · TV · 프로젝터가 타임라인을 실행 중입니다.</span>
          <small>웹 3D는 부하를 줄이기 위해 마지막 프레임에서 디밍됩니다.</small>
        </div>
      )}
      <div className="vpstate" title={hardwareConnected ? '실장치 연결 중에는 브라우저 부하를 줄이기 위해 3D 프리뷰를 끄니다' : 'Preview only · nothing is sent to the real robot'}>{hardwareConnected ? '하드웨어 연결됨' : 'Preview'}{live ? <span className="warn"> · LIVE (unsaved)</span> : null}</div>
      {!hardwareConnected && warns.length > 0 && <div className="vpwarn">가상 프리뷰 기준 초과: {warns.slice(0, 3).map((w) => `${w.ch} ${w.kind}@${w.tSec.toFixed(2)}s`).join(', ')} — 참고용 {Object.entries(PREVIEW_LIMITS).length}축 기준이며, 이 경고로 실장치가 정지하지는 않습니다.</div>}
      {false && hardwareConnected && (
        <div className="vp-hardware-offline">
          <b>3D 프리뷰 중지</b>
          <span>실장치 연결 중에는 3D만 쉬고 TV 영상과 프로젝터는 계속 재생합니다.</span>
          <small>하드웨어 연결을 끊으면 프리뷰가 자동으로 다시 켜집니다.</small>
        </div>
      )}
      <Canvas frameloop={hardwarePlaying ? 'never' : 'demand'} camera={{ fov: 40, near: 0.01, far: 30, position: PRESETS.Persp.pos }} gl={{ antialias: true }} dpr={[1, 1.25]} onPointerMissed={() => undefined}>
        <color attach="background" args={['#d4d5d8']} />
        <hemisphereLight args={['#bcd0ff', '#2a2218', 0.68]} />
        <directionalLight position={[1, 2, 1.5]} intensity={1.15} />
        <directionalLight position={[-1.5, 0.5, -1]} intensity={0.42} />
        <Suspense fallback={null}>
          <Environment resolution={128} environmentIntensity={0.68}>
            <Lightformer form="rect" intensity={1.55} position={[0, 4, 0]} rotation-x={Math.PI / 2} scale={[8, 8, 1]} color="#dfe8ff" />
            <Lightformer form="rect" intensity={0.95} position={[4, 1, 2]} rotation-y={-Math.PI / 2} scale={[6, 3, 1]} color="#fff3e0" />
            <Lightformer form="rect" intensity={0.7} position={[-4, 1, -2]} rotation-y={Math.PI / 2} scale={[6, 3, 1]} color="#cfe0ff" />
            <Lightformer form="rect" intensity={0.3} position={[0, -3, 0]} rotation-x={-Math.PI / 2} scale={[8, 8, 1]} color="#8a7f70" />
          </Environment>
          <Machine previewPaused={hardwarePlaying} />
        </Suspense>
        <Floor />
        <CameraRig />
        <RenderDriver playing={playing && !hardwarePlaying} />
        <PreviewExposure />
        <ExportBridge />
      </Canvas>
    </div>
  );
}

/** Hands the live renderer / scene to the video exporter. */
function ExportBridge() {
  const gl = useThree((s) => s.gl), scene = useThree((s) => s.scene), camera = useThree((s) => s.camera), advance = useThree((s) => s.advance);
  useEffect(() => {
    Object.assign(bridge, { gl, scene, camera, advance });
    return () => { Object.assign(bridge, { gl: null, scene: null, camera: null, advance: null }); };
  }, [gl, scene, camera, advance]);
  return null;
}

/**
 * The sequence and all output media are authored at 30 fps. Rendering the
 * editor WebGL view at a Retina panel's 60/120 fps adds no timeline detail but
 * competes with the full-HD TV canvas, projector video and WindowServer. Keep
 * the editor demand-driven and issue at most one frame per authored frame.
 */
function RenderDriver({ playing }: { playing: boolean }) {
  const invalidate = useThree((s) => s.invalidate);
  const tSec = useStore((s) => s.tSec);
  const seq = useStore((s) => s.seq);
  const live = useStore((s) => s.live);

  // Paused seeks and edits still need an immediate fresh frame.
  useEffect(() => {
    if (!playing) invalidate();
  }, [playing, tSec, seq, live, invalidate]);

  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let last = -Infinity;
    const tick = (now: number) => {
      if (now - last >= 1000 / 30) {
        last = now;
        invalidate();
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, invalidate]);
  return null;
}
