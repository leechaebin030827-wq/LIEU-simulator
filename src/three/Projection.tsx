import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useStore, assetKind } from '../store';
import { frame } from './runtime';

/** All optical numbers are PREVIEW assumptions: lens position/aim/throw ratio are UNKNOWN on the real unit. */
export const PROJ_DEFAULTS = {
  originRest: [0.000494, -0.0355, 0.000543] as [number, number, number], // bottom face of Miniray_Beam body (node 18)
  floorY: -1.4881, // lowest point of LIEU_Senario.glb (table feet) = ground
  widthM: 1.0,
};

type Media = { tex: THREE.Texture; video?: HTMLVideoElement; aspect: number };
const cache = new Map<string, Media>();

function loadMedia(url: string, mime: string, onReady: () => void): Media | null {
  const hit = cache.get(url);
  if (hit) return hit;
  const kind = assetKind(mime);
  if (kind === 'video') {
    const v = document.createElement('video'); v.src = url; v.loop = true; v.muted = true; v.playsInline = true; v.crossOrigin = 'anonymous';
    const tex = new THREE.VideoTexture(v); tex.colorSpace = THREE.SRGBColorSpace;
    const m: Media = { tex, video: v, aspect: 16 / 9 };
    v.onloadedmetadata = () => { m.aspect = v.videoWidth / Math.max(1, v.videoHeight); onReady(); };
    cache.set(url, m); return m;
  }
  if (kind === 'image') {
    const m: Media = { tex: new THREE.Texture(), aspect: 1 };
    cache.set(url, m);
    const img = new Image(); img.crossOrigin = 'anonymous';
    img.onload = () => {
      // SVG without intrinsic size reports 0; fall back to a square raster
      const w = img.naturalWidth || 1024, h = img.naturalHeight || 1024;
      const c = document.createElement('canvas'); c.width = Math.min(2048, Math.max(256, w)); c.height = Math.round(c.width * (h / w));
      c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
      m.tex = new THREE.CanvasTexture(c); m.tex.colorSpace = THREE.SRGBColorSpace; m.aspect = w / h; onReady();
    };
    img.src = url;
    return m;
  }
  return null;
}

/**
 * Simulator-only indicator: a soft white cone from the lens down to the projected image. Real projectors do not show a visible beam;
 * this only exists so the preview makes it obvious where the projection comes from. Alpha fades from the lens toward the floor and
 * brightens slightly at the silhouette, so it reads as light rather than a solid object.
 */
const beamMat = new THREE.ShaderMaterial({
  transparent: true, depthWrite: false, blending: THREE.NormalBlending, side: THREE.DoubleSide,
  uniforms: { uOpacity: { value: 0 } },
  vertexShader: `varying float vV; varying vec3 vN; varying vec3 vView;
    void main() { vV = position.y + 0.5; vec4 mv = modelViewMatrix * vec4(position, 1.0); vN = normalize(normalMatrix * normal); vView = -mv.xyz; gl_Position = projectionMatrix * mv; }`,
  fragmentShader: `uniform float uOpacity; varying float vV; varying vec3 vN; varying vec3 vView;
    void main() {
      float along = pow(vV, 0.9);                       // 1 at the lens (top of the cylinder), 0 at the floor
      float rim = 1.0 - abs(dot(normalize(vN), normalize(vView)));
      float a = uOpacity * (0.1 + 0.45 * along) * (0.45 + 0.55 * rim);
      gl_FragColor = vec4(vec3(1.0, 0.97, 0.9), a);
    }`,
});

export function Projection() {
  const beam = useRef<THREE.Mesh>(null);
  const beamGeo = useMemo(() => new THREE.CylinderGeometry(0, 1, 1, 64, 1, true), []);
  const mesh = useRef<THREE.Mesh>(null);
  const lines = useRef<THREE.LineSegments>(null);
  const mat = useMemo(() => new THREE.MeshBasicMaterial({ transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, side: THREE.DoubleSide }), []);
  const geo = useMemo(() => new THREE.PlaneGeometry(1, 1), []);
  const lineGeo = useMemo(() => { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(8 * 3), 3)); return g; }, []);
  const tmp = useMemo(() => ({ o: new THREE.Vector3(), d: new THREE.Vector3(), hit: new THREE.Vector3(), q: new THREE.Quaternion(), e: new THREE.Euler() }), []);
  const ready = useRef(0);
  const lastVideoClip = useRef<string>('');

  useEffect(() => () => { geo.dispose(); mat.dispose(); beamGeo.dispose(); }, [geo, mat, beamGeo]);

  useFrame(() => {
    const st = frame.state, stages = frame.stages, m = mesh.current;
    if (!st || !stages || !m) return;
    const store = useStore.getState();
    const clip = st.projector.activeClips[st.projector.activeClips.length - 1];
    const ex = st.projector.extraProperties ?? {};
    const lens = store.rig.owner[store.rig.emitterNodes.projector] ?? 'yaw';
    const M = stages[lens];
    const o0 = PROJ_DEFAULTS.originRest;
    tmp.o.set(o0[0] + (ex.opticalOriginXm ?? 0), o0[1] + (ex.opticalOriginYm ?? 0), o0[2] + (ex.opticalOriginZm ?? 0)).applyMatrix4(M);
    tmp.e.set(0, 0, (ex.opticalAimPitchDeg ?? 0) * Math.PI / 180);
    tmp.d.set(0, -1, 0).applyEuler(tmp.e);
    tmp.e.set(0, (ex.opticalAimYawDeg ?? 0) * Math.PI / 180, 0);
    tmp.d.applyEuler(tmp.e).transformDirection(M).normalize();
    const floorY = ex.floorHeightYm ?? PROJ_DEFAULTS.floorY;
    const hasHit = tmp.d.y < -1e-4;
    const media = clip ? loadMedia(store.assets[clip.assetId]?.url ?? `${import.meta.env.BASE_URL}examples/${clip.assetId}`, store.assets[clip.assetId]?.mime ?? (clip.assetId.endsWith('.svg') ? 'image/svg+xml' : 'image/png'), () => { ready.current++; }) : null;
    const show = !!(clip && media && hasHit && st.projector.opacity > 0.001);
    m.visible = show;
    const bm = beam.current;
    if (bm) bm.visible = false;
    if (!hasHit) { if (lines.current) lines.current.visible = false; return; }
    const tHit = (floorY - tmp.o.y) / tmp.d.y;
    tmp.hit.copy(tmp.o).addScaledVector(tmp.d, tHit);
    const W = (ex.projectedWidthM ?? PROJ_DEFAULTS.widthM) * st.projector.scale;
    const aspect = media?.aspect ?? 1;
    const H = W / aspect;
    m.position.set(tmp.hit.x + st.projector.offsetXm, floorY + 0.0008, tmp.hit.z + st.projector.offsetZm);
    // image up -> +X (robot front); rotation about vertical
    m.rotation.set(-Math.PI / 2, 0, 0); m.rotateZ(-Math.PI / 2 + ((st.projector.rotationDeg + (lens === 'yaw' || lens === 'tilt' ? st.motion.yawY : 0)) * Math.PI) / 180);
    m.scale.set(W, H, 1);
    if (bm) {
      const on = show && store.view.showBeam;
      bm.visible = on;
      if (on) {
        // apex at the lens, base on the projected image (circle around the footprint); cylinder +Y = apex end
        const centre = m.position, axis = tmp.o.clone().sub(centre), L = axis.length();
        bm.position.copy(tmp.o).add(centre).multiplyScalar(0.5);
        bm.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), axis.divideScalar(Math.max(1e-6, L)));
        const R = (0.5 * Math.hypot(W, H)) * (2 / 3);   // base circle at 2/3 of the footprint circle: a slimmer cone
        bm.scale.set(R, L, R);
        beamMat.uniforms.uOpacity.value = Math.min(1, st.projector.opacity * Math.min(1, st.projector.brightness));
      }
    }
    if (show && media) {
      if (mat.map !== media.tex) { mat.map = media.tex; mat.needsUpdate = true; }
      const k = st.projector.opacity * Math.min(2, st.projector.brightness);
      mat.color.setScalar(k); mat.opacity = 1;
      if (media.video) {
        const v = media.video, want = Math.max(0, st.tSec - clip!.fromSec + (clip!.mediaOffsetSec ?? 0));
        const dur = v.duration || 1e9; const target = clip!.loopMedia === false ? Math.min(want, dur) : want % dur;
        if (store.playing) { if (Math.abs(v.currentTime - target) > 0.25 && v.readyState > 1) v.currentTime = target; if (v.paused) void v.play().catch(() => undefined); }
        else { v.pause(); if (v.readyState > 1 && Math.abs(v.currentTime - target) > 0.02) v.currentTime = target; }
        lastVideoClip.current = clip!.id;
      }
    }
    // frustum debug
    const l = lines.current;
    if (l) {
      l.visible = store.view.showFrustum;
      if (l.visible) {
        const p = lineGeo.getAttribute('position') as THREE.BufferAttribute;
        const c: [number, number][] = [[-W / 2, -H / 2], [W / 2, -H / 2], [W / 2, H / 2], [-W / 2, H / 2]];
        const cr = Math.cos(m.rotation.z), sr = Math.sin(m.rotation.z); void cr; void sr;
        const quad = c.map(([x, y]) => new THREE.Vector3(x, y, 0).applyMatrix4(new THREE.Matrix4().compose(m.position, m.quaternion, new THREE.Vector3(1, 1, 1))));
        quad.forEach((q, i) => { p.setXYZ(i * 2, tmp.o.x, tmp.o.y, tmp.o.z); p.setXYZ(i * 2 + 1, q.x, q.y, q.z); });
        p.needsUpdate = true;
      }
    }
  });

  return (
    <>
      <mesh ref={mesh} geometry={geo} material={mat} renderOrder={3} visible={false} />
      <mesh ref={beam} geometry={beamGeo} material={beamMat} renderOrder={4} visible={false} frustumCulled={false} />
      <lineSegments ref={lines} geometry={lineGeo} frustumCulled={false} visible={false}>
        <lineBasicMaterial color="#ffd43b" transparent opacity={0.7} />
      </lineSegments>
    </>
  );
}
