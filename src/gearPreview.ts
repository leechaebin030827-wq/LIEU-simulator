import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

/** Yaw 기어 미리보기. 모터 / 하드웨어 브리지와 무관한 정적 뷰어다. */
const NP = 17;   // MOCK : GLB 의 피니언 형상에서 센 잇수. 실물 확인 전
const NR = 118;  // MOCK : GLB 의 링 기어 형상에서 센 잇수. 실물 확인 전

const el = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const ui = { play: el<HTMLInputElement>('play'), ang: el<HTMLInputElement>('ang'), spd: el<HTMLInputElement>('spd'), ph: el<HTMLInputElement>('ph'),
  shell: el<HTMLInputElement>('shell'), lower: el<HTMLInputElement>('lower'), out: el<HTMLElement>('out'), vp: el<HTMLElement>('vp'), vs: el<HTMLElement>('vs'), vph: el<HTMLElement>('vph'), err: el<HTMLElement>('err') };

const renderer = new THREE.WebGLRenderer({ canvas: el<HTMLCanvasElement>('c'), antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x111014);
const camera = new THREE.PerspectiveCamera(35, 1, 0.005, 10);
camera.position.set(-0.19, 0.2, 0.2);   // 피니언(x = -88mm) 쪽에서 맞물림이 보이게
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(-0.085, -0.005, 0);
controls.enableDamping = true;
scene.add(new THREE.HemisphereLight(0xffffff, 0x303040, 1.6));
const sun = new THREE.DirectionalLight(0xffffff, 2.2);
sun.position.set(0.5, 1, 0.6);
scene.add(sun);
scene.add(new THREE.GridHelper(0.6, 12, 0x34343e, 0x23232b));

type Role = 'ring' | 'pinion' | 'motor' | 'bearing' | 'shell' | 'other';
const ROLES: Array<[string, Role]> = [['베어링_기어', 'pinion'], ['베어링_하부', 'ring'], ['베어링_상부', 'bearing'], ['베어링_중부', 'bearing'], ['XL,XC-330', 'motor'],
  ['루_상부', 'shell'], ['루_하부', 'shell'], ['눈_LED_가이드', 'shell']];
const COLOR: Record<Role, number> = { ring: 0xff9a3c, pinion: 0x4fd1ff, motor: 0x9aa0b4, bearing: 0xc9c9d6, shell: 0xe6e6ee, other: 0x70707c };
const roleOf = (name: string): Role => ROLES.find(([k]) => name.includes(k))?.[1] ?? 'other';

/** 이름이 맞는 가장 바깥 노드(래퍼). 그 노드를 돌리면 아래 메쉬가 같이 돈다. */
const topNodes = (root: THREE.Object3D, key: string) => {
  const found: THREE.Object3D[] = [];
  root.traverse((o) => { if (o.name.includes(key) && !found.some((f) => f !== o && isAncestor(f, o))) found.push(o); });
  return found;
};
const isAncestor = (a: THREE.Object3D, b: THREE.Object3D) => { for (let p = b.parent; p; p = p.parent) if (p === a) return true; return false; };

let pinion: THREE.Object3D | null = null, ring: THREE.Object3D | null = null;
/** 링 기어와 접촉(간격 0.2mm 이하)으로 이어진 부품 묶음. 월드 원점을 지나는 Y 축으로 같이 돈다. */
const spin = new THREE.Group();
scene.add(spin);
const SPIN_KEYS = ['베어링_하부', '루_하부', '눈_LED_가이드', 'KeyStudio', 'Body154'];
const shellMeshes: THREE.Object3D[] = [];

new GLTFLoader().load(`${import.meta.env.BASE_URL}assets/LIEU_for_web.glb`, (gltf) => {
  const model = gltf.scene;
  model.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    let role: Role = 'other';
    for (let p: THREE.Object3D | null = o; p; p = p.parent) { const r = roleOf(p.name); if (r !== 'other') { role = r; break; } }
    const gear = role === 'ring' || role === 'pinion';
    m.material = new THREE.MeshStandardMaterial({ color: COLOR[role], metalness: 0.2, roughness: 0.55, transparent: !gear, opacity: gear ? 1 : role === 'shell' ? 0.16 : 0.5, depthWrite: gear });
    if (role === 'shell') shellMeshes.push(m);
  });
  scene.add(model);
  model.updateMatrixWorld(true);
  pinion = topNodes(model, '베어링_기어')[0] ?? null;
  ring = topNodes(model, '베어링_하부')[0] ?? null;
  SPIN_KEYS.forEach((k) => topNodes(model, k).forEach((n) => spin.attach(n)));   // attach : 월드 위치를 그대로 두고 pivot 으로 옮긴다
  const box = new THREE.Box3().setFromObject(model);
  ui.err.textContent = pinion && ring ? '' : `기어 노드를 못 찾았습니다 (pinion=${!!pinion}, ring=${!!ring}). 모델 크기 ${box.getSize(new THREE.Vector3()).toArray().map((v) => v.toFixed(3)).join(' x ')} m`;
}, undefined, (e) => { ui.err.textContent = `GLB 로드 실패: ${String(e)}`; });

const resize = () => { renderer.setSize(innerWidth, innerHeight, false); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); };
addEventListener('resize', resize); resize();

const rad = THREE.MathUtils.degToRad;
let angle = 0, last = performance.now();
ui.ang.addEventListener('input', () => { angle = Number(ui.ang.value); ui.play.checked = false; });
const loop = (now: number) => {
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  const spd = Number(ui.spd.value), ph = Number(ui.ph.value);
  if (ui.play.checked) { angle += spd * dt; if (angle > 720) angle -= 1440; ui.ang.value = String(angle); }
  const ringAngle = -angle * NP / NR;   // 외접 기어 쌍 : 피니언과 링은 반대 방향
  if (pinion) pinion.rotation.y = rad(angle + ph);
  spin.rotation.y = ui.lower.checked ? rad(ringAngle) : 0;
  if (ring) ring.rotation.y = ui.lower.checked ? 0 : rad(ringAngle);   // 묶음을 끄면 링 기어만 돈다
  shellMeshes.forEach((m) => { m.visible = ui.shell.checked; });
  ui.vp.textContent = `${angle.toFixed(1)}°`; ui.vs.textContent = `${spd}°/s`; ui.vph.textContent = `${ph}°`;
  ui.out.innerHTML = `피니언 θp = ${(angle + ph).toFixed(1)}°<br>링 θr = ${ringAngle.toFixed(2)}°<br>Np / Nr = ${NP} / ${NR} (MOCK)<br>감속비 = 1 : ${(NR / NP).toFixed(2)}`;
  controls.update();
  renderer.render(scene, camera);
  requestAnimationFrame(loop);
};
requestAnimationFrame(loop);
