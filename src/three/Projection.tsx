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

export function Projection() {
  const mesh = useRef<THREE.Mesh>(null);
  const lines = useRef<THREE.LineSegments>(null);
  const mat = useMemo(() => new THREE.MeshBasicMaterial({ transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, side: THREE.DoubleSide }), []);
  const geo = useMemo(() => new THREE.PlaneGeometry(1, 1), []);
  const lineGeo = useMemo(() => { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(8 * 3), 3)); return g; }, []);
  const tmp = useMemo(() => ({ o: new THREE.Vector3(), d: new THREE.Vector3(), hit: new THREE.Vector3(), q: new THREE.Quaternion(), e: new THREE.Euler() }), []);
  const ready = useRef(0);
  const lastVideoClip = useRef<string>('');

  useEffect(() => () => { geo.dispose(); mat.dispose(); }, [geo, mat]);

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
      <lineSegments ref={lines} geometry={lineGeo} frustumCulled={false} visible={false}>
        <lineBasicMaterial color="#ffd43b" transparent opacity={0.7} />
      </lineSegments>
    </>
  );
}
