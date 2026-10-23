import { create } from 'zustand';
import type { DesiredState, LieuSequence, RigState, Rgbw, Cue, Interpolation } from './engine/types';
import type { LiveOverride } from './engine/types';
import { evaluateSequenceAt, cuesCrossed } from './engine/evaluate';
import {
  clone, emptySequence, setEyeBitmap, setNumeric, setRingPixels, getKeys, withKeys, moveKey, removeKey, setKeyInterp, uid,
  type TrackPath, numericAt,
} from './engine/edit';
import { defaultRig, TILT_LIMIT_DEG } from './engine/rigDefaults';
import { migrate, validateSequence, UNKNOWN_CALIBRATION, type AssetRecord, type ProjectFile, buildZip, readZip, serializeProject } from './engine/project';

const HISTORY_CAP = 100;
export type Selection = { path: TrackPath; id: string }[];
export type ClipSel = { kind: 'effect' | 'projector' | 'audio' | 'cue'; id: string } | null;

type State = {
  seq: LieuSequence;
  rig: RigState;
  assets: Record<string, AssetRecord & { url: string }>;
  blobs: Record<string, Blob>;
  // transport
  tSec: number;
  playing: boolean;
  loop: boolean;
  speed: number;
  // editing
  autoKey: boolean;
  snapFps: number;
  live: LiveOverride;
  selectedLeds: number[];
  selKeys: Selection;
  selClip: ClipSel;
  selNode: number | null;
  clipboard: { path: TrackPath; tRel: number; value: unknown; interp?: Interpolation }[] | null;
  eventLog: string[];
  past: LieuSequence[];
  future: LieuSequence[];
  dirtyAudio: number; // bumps when audio needs rescheduling
  view: { showPivots: boolean; showFrustum: boolean; opaqueMaterials: boolean; cutaway: boolean; showLedGlow: boolean; outerHalo: boolean; eyeColor: string; bloom: boolean; showAxes: boolean; hideMachine: boolean };
};

type Actions = {
  evalNow: () => DesiredState;
  setTime: (t: number, fromTransport?: boolean) => void;
  play: () => void; pause: () => void; stop: () => void; toggleLoop: () => void; setSpeed: (s: number) => void;
  commit: (next: LieuSequence, coalesceKey?: string) => void;
  undo: () => void; redo: () => void;
  loadSequence: (s: LieuSequence) => void;
  setNumericAt: (p: TrackPath, value: number, seedValue: number) => void;
  setMotion: (ch: 'railX' | 'yawY' | 'tiltZ', v: number) => void;
  setPixels: (edits: Record<number, Rgbw>) => void;
  setEye: (side: 'left' | 'right', rows: readonly number[]) => void;
  setProjProp: (prop: string, v: number, def: number) => void;
  setRingBrightness: (v: number) => void;
  setEyeIntensity: (which: 'intensity' | 'leftIntensity' | 'rightIntensity', v: number) => void;
  addKeyNow: (p: TrackPath, at?: number) => void;
  deleteKeys: (sel: Selection) => void;
  moveKeyTo: (p: TrackPath, id: string, t: number) => void;
  setInterp: (p: TrackPath, id: string, i: Interpolation) => void;
  copyKeys: () => void; pasteKeys: () => void;
  patchSeq: (fn: (s: LieuSequence) => void, coalesceKey?: string) => void;
  selectLeds: (ids: number[], additive?: boolean) => void;
  setSelKeys: (s: Selection) => void;
  setSelClip: (c: ClipSel) => void;
  setNode: (n: number | null) => void;
  setOwner: (node: number, stage: RigState['owner'][number]) => void;
  setPivot: (which: 'yaw' | 'tilt', axis: 0 | 1 | 2, v: number) => void;
  resetRig: () => void;
  setAutoKey: (v: boolean) => void;
  setView: (v: Partial<State['view']>) => void;
  clearLive: () => void;
  logEvent: (s: string) => void;
  addAsset: (file: File) => string;
  registerBuiltin: (assetId: string) => void;
  exportJson: () => string;
  exportZip: () => Promise<Uint8Array>;
  importFile: (name: string, data: ArrayBuffer) => Promise<void>;
};

export const builtinUrl = (assetId: string) => `${import.meta.env.BASE_URL}examples/${assetId}`;
export const assetKind = (mime: string): 'image' | 'video' | 'audio' | 'other' =>
  mime.startsWith('image/') ? 'image' : mime.startsWith('video/') ? 'video' : mime.startsWith('audio/') ? 'audio' : 'other';
const mimeFromName = (n: string) => (/\.svg$/i.test(n) ? 'image/svg+xml' : /\.png$/i.test(n) ? 'image/png' : /\.(jpe?g)$/i.test(n) ? 'image/jpeg' : /\.wav$/i.test(n) ? 'audio/wav' : /\.mp3$/i.test(n) ? 'audio/mpeg' : /\.mp4$/i.test(n) ? 'video/mp4' : /\.webm$/i.test(n) ? 'video/webm' : 'application/octet-stream');

let lastCoalesce = { key: '', at: 0 };

export const useStore = create<State & Actions>((set, get) => ({
  seq: emptySequence('Untitled'),
  rig: defaultRig(),
  assets: {}, blobs: {},
  tSec: 0, playing: false, loop: false, speed: 0.5,
  autoKey: false, snapFps: 30, live: {},
  selectedLeds: [], selKeys: [], selClip: null, selNode: null, clipboard: null, eventLog: [],
  past: [], future: [], dirtyAudio: 0,
  view: { showPivots: true, showFrustum: false, opaqueMaterials: true, cutaway: false, showLedGlow: true, outerHalo: false, eyeColor: '#f2f6ff', bloom: true, showAxes: false, hideMachine: false },

  evalNow: () => applyLive(evaluateSequenceAt(get().seq, get().tSec), get().live),

  setTime: (t, fromTransport) => {
    const { seq } = get();
    const nt = Math.max(0, Math.min(seq.durationSec, t));
    set({ tSec: nt, ...(fromTransport ? {} : { live: {} }) });
    if (!fromTransport) set((s) => ({ dirtyAudio: s.dirtyAudio + 1 }));
  },
  play: () => { const { tSec, seq } = get(); if (tSec >= seq.durationSec - 1e-6) set({ tSec: 0 }); set((s) => ({ playing: true, live: {}, dirtyAudio: s.dirtyAudio + 1 })); },
  pause: () => set((s) => ({ playing: false, dirtyAudio: s.dirtyAudio + 1 })),
  stop: () => set((s) => ({ playing: false, tSec: 0, live: {}, dirtyAudio: s.dirtyAudio + 1 })),
  toggleLoop: () => get().patchSeq((s) => { s.loop = !s.loop; }),
  setSpeed: (speed) => set({ speed }),

  commit: (next, coalesceKey) => {
    const { seq, past } = get();
    const now = performance.now();
    const coalesce = coalesceKey && lastCoalesce.key === coalesceKey && now - lastCoalesce.at < 600;
    lastCoalesce = { key: coalesceKey ?? '', at: now };
    set((s) => ({
      seq: next,
      past: coalesce ? past : [...past.slice(-HISTORY_CAP + 1), seq],
      future: [], live: {}, dirtyAudio: s.dirtyAudio + 1,
    }));
  },
  undo: () => { const { past, seq, future } = get(); if (!past.length) return; set((s) => ({ seq: past[past.length - 1], past: past.slice(0, -1), future: [seq, ...future], live: {}, dirtyAudio: s.dirtyAudio + 1 })); },
  redo: () => { const { past, seq, future } = get(); if (!future.length) return; set((s) => ({ seq: future[0], future: future.slice(1), past: [...past, seq], live: {}, dirtyAudio: s.dirtyAudio + 1 })); },
  loadSequence: (s) => set((st) => ({ seq: s, past: [], future: [], tSec: 0, playing: false, live: {}, selKeys: [], selClip: null, dirtyAudio: st.dirtyAudio + 1 })),

  patchSeq: (fn, k) => { const n = clone(get().seq); fn(n); get().commit(n, k); },

  setNumericAt: (p, value, seedValue) => {
    const { autoKey, tSec, seq } = get();
    if (autoKey) get().commit(setNumeric(seq, p, tSec, value, seedValue), JSON.stringify(p) + 'v');
    else if (p.type === 'motion') set((s) => ({ live: { ...s.live, motion: { ...s.live.motion, [p.ch]: value } } }));
  },
  setMotion: (ch, v) => get().setNumericAt({ type: 'motion', ch }, ch === 'tiltZ' ? Math.max(-TILT_LIMIT_DEG, Math.min(TILT_LIMIT_DEG, v)) : v, numericAt(get().seq, { type: 'motion', ch }, 0, 0)),
  setRingBrightness: (v) => {
    const { autoKey, tSec, seq } = get();
    if (autoKey) get().commit(setNumeric(seq, { type: 'ringBrightness' }, tSec, v, 1, 'linear'), 'rb');
    else set((s) => ({ live: { ...s.live, ringBrightness: v } }));
  },
  setEyeIntensity: (which, v) => {
    const { autoKey, tSec, seq } = get();
    if (autoKey) get().commit(setNumeric(seq, { type: 'eyeIntensity', which }, tSec, v, 1, 'linear'), 'ei' + which);
    else set((s) => ({ live: { ...s.live, eyeIntensity: v } }));
  },
  setPixels: (edits) => {
    const { autoKey, tSec, seq } = get();
    if (autoKey) get().commit(setRingPixels(seq, tSec, edits), 'px' + Object.keys(edits).join(','));
    else set((s) => ({ live: { ...s.live, pixels: { ...s.live.pixels, ...edits } } }));
  },
  setEye: (side, rows) => {
    const { autoKey, tSec, seq } = get();
    if (autoKey) get().commit(setEyeBitmap(seq, side, tSec, rows), 'eye' + side);
    else set((s) => ({ live: { ...s.live, [side === 'left' ? 'eyeLeft' : 'eyeRight']: rows } }));
  },
  setProjProp: (prop, v, def) => {
    const { autoKey, tSec, seq } = get();
    if (autoKey) get().commit(setNumeric(seq, { type: 'projProp', prop }, tSec, v, def), 'pp' + prop);
    else set((s) => ({ live: { ...s.live, projector: { ...s.live.projector, [prop]: v } } }));
  },
  addKeyNow: (p, at) => {
    const { seq } = get();
    const tSec = at ?? get().tSec;
    const st = evaluateSequenceAt(seq, tSec);
    let next: LieuSequence;
    if (p.type === 'ringBase') next = setRingPixels(seq, tSec, {});
    else if (p.type === 'eye') next = setEyeBitmap(seq, p.side, tSec, st.eyes[p.side]);
    else next = setNumeric(seq, p, tSec, numericAt(seq, p, tSec, defaultFor(p, st)), defaultFor(p, st));
    get().commit(next);
  },
  deleteKeys: (sel) => {
    let n = get().seq;
    for (const { path, id } of sel) n = withKeys(n, path, removeKey(getKeys(n, path), id));
    get().commit(n); set({ selKeys: [] });
  },
  moveKeyTo: (p, id, t) => get().commit(withKeys(get().seq, p, moveKey(getKeys(get().seq, p), id, t)), 'mv' + id),
  setInterp: (p, id, i) => get().commit(setKeyInterp(get().seq, p, id, i)),
  copyKeys: () => {
    const { selKeys, seq } = get();
    if (!selKeys.length) return;
    const items = selKeys.flatMap(({ path, id }) => { const k = getKeys(seq, path).find((x) => x.id === id); return k ? [{ path, tRel: k.tSec, value: clone(k.value), interp: k.interpolationToNext }] : []; });
    const t0 = Math.min(...items.map((i) => i.tRel));
    set({ clipboard: items.map((i) => ({ ...i, tRel: i.tRel - t0 })) });
  },
  pasteKeys: () => {
    const { clipboard, tSec } = get();
    if (!clipboard) return;
    let n = get().seq;
    for (const c of clipboard) {
      const ks = getKeys(n, c.path);
      const t = tSec + c.tRel;
      const existing = ks.find((k) => Math.abs(k.tSec - t) < 1e-4);
      const nk = existing ? ks.map((k) => (k === existing ? { ...k, value: clone(c.value) } : k)) : [...ks, { id: uid(), tSec: t, value: clone(c.value), interpolationToNext: c.interp }].sort((a, b) => a.tSec - b.tSec);
      n = withKeys(n, c.path, nk);
    }
    get().commit(n);
  },

  selectLeds: (ids, additive) => set((s) => ({ selectedLeds: additive ? Array.from(new Set([...s.selectedLeds, ...ids])) : ids })),
  setSelKeys: (s) => set({ selKeys: s }),
  setSelClip: (c) => set({ selClip: c }),
  setNode: (n) => set({ selNode: n }),
  setOwner: (node, stage) => set((s) => ({ rig: { ...s.rig, owner: { ...s.rig.owner, [node]: stage } } })),
  setPivot: (which, axis, v) => set((s) => { const p = [...s.rig.pivots[which]] as [number, number, number]; p[axis] = v; return { rig: { ...s.rig, pivots: { ...s.rig.pivots, [which]: p } } }; }),
  resetRig: () => set({ rig: defaultRig() }),
  setAutoKey: (v) => set({ autoKey: v }),
  setView: (v) => set((s) => ({ view: { ...s.view, ...v } })),
  clearLive: () => set({ live: {} }),
  logEvent: (m) => set((s) => ({ eventLog: [...s.eventLog.slice(-30), m] })),

  addAsset: (file) => {
    const id = `upload/${uid('a')}_${file.name}`;
    const mime = file.type || mimeFromName(file.name);
    const url = URL.createObjectURL(file);
    set((s) => ({ assets: { ...s.assets, [id]: { assetId: id, filename: file.name, mime, url } }, blobs: { ...s.blobs, [id]: file } }));
    return id;
  },
  registerBuiltin: (assetId) => set((s) => s.assets[assetId] ? s : ({ assets: { ...s.assets, [assetId]: { assetId, filename: assetId.split('/').pop()!, mime: mimeFromName(assetId), url: builtinUrl(assetId), builtin: true } } })),

  exportJson: () => serializeProject(makeProject(get())),
  exportZip: async () => {
    const s = get();
    const blobs: Record<string, Uint8Array> = {};
    for (const [id, b] of Object.entries(s.blobs)) blobs[id] = new Uint8Array(await b.arrayBuffer());
    return buildZip(makeProject(s), blobs);
  },
  importFile: async (name, data) => {
    let raw: unknown; const blobs: Record<string, Uint8Array> = {};
    if (/\.zip$/i.test(name)) { const z = readZip(new Uint8Array(data)); raw = z.project; Object.assign(blobs, z.blobs); }
    else raw = JSON.parse(new TextDecoder().decode(data));
    const m: any = migrate(raw);
    const seq = validateSequence(m.sequence);
    const assets: ProjectFile['assets'] = m.assets ?? [];
    const next: Record<string, AssetRecord & { url: string }> = {};
    const nb: Record<string, Blob> = {};
    for (const a of assets) {
      const key = a.assetId.replace(/[^\w.\-]/g, '_');
      if (a.builtin || !blobs[key]) { next[a.assetId] = { ...a, url: builtinUrl(a.assetId) }; continue; }
      const blob = new Blob([blobs[key] as BlobPart], { type: a.mime });
      nb[a.assetId] = blob; next[a.assetId] = { ...a, url: URL.createObjectURL(blob) };
    }
    set((s) => ({ assets: { ...s.assets, ...next }, blobs: { ...s.blobs, ...nb }, ...(m.rig ? { rig: m.rig } : {}) }));
    get().loadSequence(seq);
    for (const c of seq.tracks.projector.clips) get().registerBuiltin(c.assetId);
    for (const c of seq.tracks.audio) get().registerBuiltin(c.assetId);
  },
}));

function makeProject(s: State): ProjectFile {
  const used = new Set<string>([...s.seq.tracks.projector.clips.map((c) => c.assetId), ...s.seq.tracks.audio.map((c) => c.assetId)]);
  const assets = [...used].map((id) => { const a = s.assets[id]; return a ? { assetId: a.assetId, filename: a.filename, mime: a.mime, builtin: a.builtin } : { assetId: id, filename: id.split('/').pop()!, mime: mimeFromName(id), builtin: true }; });
  return { schema: 'lieu.project/v1', sequence: s.seq, rig: s.rig, assets, calibrationStatus: UNKNOWN_CALIBRATION };
}

function defaultFor(p: TrackPath, st: DesiredState): number {
  if (p.type === 'motion') return st.motion[p.ch];
  if (p.type === 'ringBrightness') return st.ring24.brightness;
  if (p.type === 'eyeIntensity') return st.eyes[p.which === 'intensity' ? 'intensity' : p.which];
  if (p.type === 'projProp') { const v = (st.projector as unknown as Record<string, number>)[p.prop]; return typeof v === 'number' ? v : 0; }
  return 0;
}

export function applyLive(st: DesiredState, live: LiveOverride): DesiredState {
  if (!live || Object.keys(live).length === 0) return st;
  const n: DesiredState = { ...st, motion: { ...st.motion, ...live.motion } };
  if (live.pixels) n.ring24 = { ...st.ring24, pixels: st.ring24.pixels.map((p, i) => live.pixels![i] ?? p) };
  if (live.ringBrightness !== undefined) n.ring24 = { ...n.ring24, brightness: live.ringBrightness };
  if (live.eyeLeft || live.eyeRight || live.eyeIntensity !== undefined) {
    const ii = live.eyeIntensity;
    n.eyes = { ...st.eyes, left: live.eyeLeft ?? st.eyes.left, right: live.eyeRight ?? st.eyes.right, ...(ii !== undefined ? { intensity: ii, leftIntensity: ii, rightIntensity: ii } : {}) };
  }
  if (live.projector) n.projector = { ...st.projector, ...(live.projector as object) } as DesiredState['projector'];
  return n;
}

export { cuesCrossed };
export type { Cue };
