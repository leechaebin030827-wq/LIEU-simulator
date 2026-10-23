import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../store';
import { getKeys, withKeys, type TrackPath, pathKey, clone, uid } from '../engine/edit';
import { motionWarnings } from '../engine/limits';
import { sortedKeys } from '../engine/interp';
import { unlockAudio } from '../runtime/audio';
import type { Keyframe } from '../engine/types';

type Lane =
  | { id: string; label: string; group: string; kind: 'keys'; path: TrackPath }
  | { id: string; label: string; group: string; kind: 'clips'; clip: 'effect' | 'projector' | 'audio' | 'cue' };

const NUM = (prop: string, label: string): Lane => ({ id: 'pp' + prop, label, group: 'Projector', kind: 'keys', path: { type: 'projProp', prop } });

export function Timeline() {
  const seq = useStore((s) => s.seq);
  const t = useStore((s) => s.tSec);
  const selKeys = useStore((s) => s.selKeys), setSelKeys = useStore((s) => s.setSelKeys);
  const selClip = useStore((s) => s.selClip), setSelClip = useStore((s) => s.setSelClip);
  const setTime = useStore((s) => s.setTime), snapFps = useStore((s) => s.snapFps);
  const commit = useStore((s) => s.commit), addKeyNow = useStore((s) => s.addKeyNow), patchSeq = useStore((s) => s.patchSeq);
  const [pps, setPps] = useState(70);
  const [dragDt, setDragDt] = useState<{ dt: number; ids: Set<string> } | null>(null);
  const [clipDrag, setClipDrag] = useState<{ id: string; from: number; to: number } | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const warns = useMemo(() => motionWarnings(seq), [seq]);
  const [open, setOpen] = useState<Record<string, boolean>>({ Motion: true, Ring: true, Eyes: true, Projector: true, Audio: true, Events: true });

  const lanes: Lane[] = useMemo(() => {
    const L: Lane[] = [
      { id: 'rx', label: 'Rail X', group: 'Motion', kind: 'keys', path: { type: 'motion', ch: 'railX' } },
      { id: 'yw', label: 'Yaw Y', group: 'Motion', kind: 'keys', path: { type: 'motion', ch: 'yawY' } },
      { id: 'tl', label: 'Tilt Z', group: 'Motion', kind: 'keys', path: { type: 'motion', ch: 'tiltZ' } },
      { id: 'rb', label: 'All 24 RGBW', group: 'Ring', kind: 'keys', path: { type: 'ringBase' } },
      { id: 'rbr', label: 'Brightness', group: 'Ring', kind: 'keys', path: { type: 'ringBrightness' } },
      { id: 'rfx', label: 'Effects', group: 'Ring', kind: 'clips', clip: 'effect' },
    ];
    const ov = seq.tracks.ring24.pixelChannelOverrides ?? {};
    for (const [i, chs] of Object.entries(ov)) for (const ch of ['r', 'g', 'b', 'w'] as const) if (chs[ch]?.keys.length) L.push({ id: `px${i}${ch}`, label: `LED #${i} ${ch.toUpperCase()}`, group: 'Ring', kind: 'keys', path: { type: 'pixelCh', index: Number(i), ch } });
    L.push(
      { id: 'el', label: 'Left 8×8', group: 'Eyes', kind: 'keys', path: { type: 'eye', side: 'left' } },
      { id: 'er', label: 'Right 8×8', group: 'Eyes', kind: 'keys', path: { type: 'eye', side: 'right' } },
      { id: 'ei', label: 'Intensity', group: 'Eyes', kind: 'keys', path: { type: 'eyeIntensity', which: 'intensity' } },
    );
    if (seq.tracks.eyes.leftIntensity?.keys.length) L.push({ id: 'eli', label: 'L intensity', group: 'Eyes', kind: 'keys', path: { type: 'eyeIntensity', which: 'leftIntensity' } });
    if (seq.tracks.eyes.rightIntensity?.keys.length) L.push({ id: 'eri', label: 'R intensity', group: 'Eyes', kind: 'keys', path: { type: 'eyeIntensity', which: 'rightIntensity' } });
    L.push({ id: 'pc', label: 'Media source', group: 'Projector', kind: 'clips', clip: 'projector' }, NUM('opacity', 'Opacity'), NUM('brightness', 'Brightness'), NUM('scale', 'Scale'), NUM('rotationDeg', 'Rotation'), NUM('offsetXm', 'Offset X'), NUM('offsetZm', 'Offset Z'));
    for (const k of ['floorHeightYm', 'projectedWidthM', 'opticalAimYawDeg', 'opticalAimPitchDeg', 'opticalOriginXm', 'opticalOriginYm', 'opticalOriginZm', 'focusBlur', 'keystoneTop', 'keystoneBottom'])
      if ((seq.tracks.projector.properties as Record<string, { keys: unknown[] } | undefined>)[k]?.keys.length) L.push(NUM(k, k));
    L.push({ id: 'au', label: 'Voice / SFX', group: 'Audio', kind: 'clips', clip: 'audio' }, { id: 'ev', label: 'Sensor events', group: 'Events', kind: 'clips', clip: 'cue' });
    return L;
  }, [seq]);

  const isEmpty = useMemo(() => {
    const T = seq.tracks;
    const k = (t: { keys: unknown[] }) => t.keys.length;
    return k(T.motion.railX) + k(T.motion.yawY) + k(T.motion.tiltZ) + k(T.ring24.baseFrames) + k(T.ring24.brightness) + k(T.eyes.left) + k(T.eyes.right)
      + T.ring24.effects.length + T.projector.clips.length + T.audio.length + T.events.length === 0;
  }, [seq]);
  const W = seq.durationSec * pps + 60;
  const snap = (x: number) => (snapFps > 0 ? Math.round(x * snapFps) / snapFps : x);
  const xToT = (clientX: number, el: Element) => Math.max(0, Math.min(seq.durationSec, snap((clientX - el.getBoundingClientRect().left) / pps)));

  // Keep playhead visible while playing
  useEffect(() => {
    const sc = scroller.current; if (!sc) return;
    const x = 170 + t * pps;
    if (x > sc.scrollLeft + sc.clientWidth - 40 || x < sc.scrollLeft + 170) sc.scrollLeft = Math.max(0, x - sc.clientWidth / 2);
  }, [Math.floor(t * 2) / 2, pps]); // eslint-disable-line

  const onRuler = (e: React.MouseEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    setTime(xToT(e.clientX, el));
    const mv = (ev: MouseEvent) => setTime(xToT(ev.clientX, el));
    const up = () => { window.removeEventListener('mousemove', mv); window.removeEventListener('mouseup', up); };
    window.addEventListener('mousemove', mv); window.addEventListener('mouseup', up);
  };

  const startKeyDrag = (e: React.MouseEvent, lane: Lane & { kind: 'keys' }, k: Keyframe<unknown>) => {
    e.stopPropagation();
    const isSel = selKeys.some((s) => s.id === k.id);
    let sel = selKeys;
    if (e.shiftKey) sel = isSel ? selKeys.filter((s) => s.id !== k.id) : [...selKeys, { path: lane.path, id: k.id }];
    else if (!isSel) sel = [{ path: lane.path, id: k.id }];
    setSelKeys(sel); setSelClip(null);
    if (!sel.some((s) => s.id === k.id)) return;
    const x0 = e.clientX; let dt = 0;
    const ids = new Set(sel.map((s) => s.id));
    const items = sel.map((s) => ({ ...s, t0: getKeys(seq, s.path).find((q) => q.id === s.id)?.tSec ?? 0 }));
    const minT0 = Math.min(...items.map((i) => i.t0));
    const mv = (ev: MouseEvent) => { dt = snap((ev.clientX - x0) / pps); dt = Math.max(dt, -minT0); setDragDt({ dt, ids }); };
    const up = () => {
      window.removeEventListener('mousemove', mv); window.removeEventListener('mouseup', up); setDragDt(null);
      if (Math.abs(dt) < 1e-6) { setTime(k.tSec); return; }
      let n = useStore.getState().seq;
      for (const it of items) n = withKeys(n, it.path, sortedKeys(getKeys(n, it.path).map((q) => (q.id === it.id ? { ...q, tSec: Math.min(n.durationSec, it.t0 + dt) } : q))));
      commit(n);
    };
    window.addEventListener('mousemove', mv); window.addEventListener('mouseup', up);
  };

  const clipsOf = (kind: 'effect' | 'projector' | 'audio' | 'cue') => kind === 'effect' ? seq.tracks.ring24.effects : kind === 'projector' ? seq.tracks.projector.clips : kind === 'audio' ? seq.tracks.audio : seq.tracks.events;

  const startClipDrag = (e: React.MouseEvent, kind: 'effect' | 'projector' | 'audio' | 'cue', c: any, mode: 'move' | 'l' | 'r') => {
    e.stopPropagation(); setSelClip({ kind, id: c.id }); setSelKeys([]);
    const x0 = e.clientX; const f0 = kind === 'cue' ? c.tSec : c.fromSec, t0 = kind === 'cue' ? c.tSec : c.toSec; let nf = f0, nt = t0;
    const mv = (ev: MouseEvent) => {
      const d = snap((ev.clientX - x0) / pps);
      if (mode === 'move') { nf = Math.max(0, f0 + d); nt = nf + (t0 - f0); } else if (mode === 'l') { nf = Math.min(t0 - 0.05, Math.max(0, f0 + d)); } else { nt = Math.max(f0 + 0.05, t0 + d); }
      setClipDrag({ id: c.id, from: nf, to: nt });
    };
    const up = () => {
      window.removeEventListener('mousemove', mv); window.removeEventListener('mouseup', up); setClipDrag(null);
      if (nf === f0 && nt === t0) return;
      patchSeq((s) => {
        const list = (kind === 'effect' ? s.tracks.ring24.effects : kind === 'projector' ? s.tracks.projector.clips : kind === 'audio' ? s.tracks.audio : s.tracks.events) as any[];
        const x = list.find((q) => q.id === c.id); if (!x) return;
        if (kind === 'cue') x.tSec = nf; else { x.fromSec = nf; x.toSec = nt; }
      });
    };
    window.addEventListener('mousemove', mv); window.addEventListener('mouseup', up);
  };

  const laneDbl = (e: React.MouseEvent<HTMLDivElement>, lane: Lane) => {
    const tt = xToT(e.clientX, e.currentTarget);
    if (lane.kind === 'keys') addKeyNow(lane.path, tt);
    else if (lane.clip === 'cue') patchSeq((s) => { s.tracks.events.push({ id: uid('ev'), tSec: tt, type: 'event', payload: { mock: true } }); });
    else if (lane.clip === 'effect') patchSeq((s) => { s.tracks.ring24.effects.push({ id: uid('fx'), type: 'breathe', fromSec: tt, toSec: Math.min(s.durationSec, tt + 3), seed: 1, priority: s.tracks.ring24.effects.length, blend: 'max', params: { whiteLevel: 200, speedHz: 0.4 } }); });
  };

  // Keyboard: Delete / copy / paste
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName; if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
      const s = useStore.getState();
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        if (s.selKeys.length) s.deleteKeys(s.selKeys);
        else if (s.selClip) { const sc = s.selClip; s.patchSeq((q) => { if (sc.kind === 'effect') q.tracks.ring24.effects = q.tracks.ring24.effects.filter((x) => x.id !== sc.id); else if (sc.kind === 'projector') q.tracks.projector.clips = q.tracks.projector.clips.filter((x) => x.id !== sc.id); else if (sc.kind === 'audio') q.tracks.audio = q.tracks.audio.filter((x) => x.id !== sc.id); else q.tracks.events = q.tracks.events.filter((x) => x.id !== sc.id); }); s.setSelClip(null); }
      } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'c') s.copyKeys();
      else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'v') s.pasteKeys();
    };
    window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey);
  }, []);

  const ticks = useMemo(() => { const out: number[] = []; const step = pps >= 100 ? 0.5 : pps >= 40 ? 1 : 2; for (let x = 0; x <= seq.durationSec + 1e-6; x += step) out.push(x); return out; }, [pps, seq.durationSec]);
  let lastGroup = '';

  return (
    <div className="tl">
      <TransportBar pps={pps} setPps={setPps} />
      {isEmpty && <p className="hint">This sequence is empty. (1) Move the red playhead to a time, then (2) change a value in the inspector on the right to record a key (◆) at that time. You can also double-click a row to add a key. (Help: “? Help” at the top)</p>}
      <div className="tlbody" ref={scroller}>
        <div className="tlgrid" style={{ width: W + 170 }}>
          <div className="ruler"><div className="lbl dim">time (s)</div>
            <div className="trk" style={{ width: W }} onMouseDown={onRuler}>
              {ticks.map((x) => <div className="tick" key={x} style={{ left: x * pps }}>{x}</div>)}
              <div className="tick" style={{ left: seq.durationSec * pps, borderColor: 'var(--warn)' }}>end</div>
            </div>
          </div>
          {lanes.map((lane) => {
            const head = lane.group !== lastGroup; lastGroup = lane.group;
            return (
              <div key={lane.id + 'g'}>
                {head && <div className="lane grp" onClick={() => setOpen({ ...open, [lane.group]: !open[lane.group] })} style={{ cursor: 'pointer' }}><div className="lbl">{open[lane.group] ? '▾' : '▸'} {lane.group}</div></div>}
                {open[lane.group] && (
                  <div className="lane">
                    <div className="lbl" title={lane.label}>{lane.label}</div>
                    <div className="trk" style={{ width: W }} onDoubleClick={(e) => laneDbl(e, lane)} onMouseDown={(e) => { if (e.target === e.currentTarget) { setSelKeys([]); setSelClip(null); } }}>
                      {lane.kind === 'keys' && getKeys(seq, lane.path).map((k) => {
                        const isSel = selKeys.some((s) => s.id === k.id);
                        const dt = dragDt && dragDt.ids.has(k.id) ? dragDt.dt : 0;
                        const hold = k.interpolationToNext === 'hold' || lane.path.type === 'eye';
                        return <div key={k.id} className={'diamond' + (isSel ? ' sel' : '') + (hold ? ' hold' : '')} style={{ left: (k.tSec + dt) * pps }} title={`${(k.tSec + dt).toFixed(3)}s · ${k.interpolationToNext ?? 'linear'}`} onMouseDown={(e) => startKeyDrag(e, lane, k)} />;
                      })}
                      {lane.kind === 'keys' && lane.path.type === 'motion' && warns.filter((w) => w.ch === (lane.path as { ch: string }).ch).map((w, i) => <div key={i} className="bad-seg" style={{ left: Math.max(0, w.tSec - 0.15) * pps, width: 0.3 * pps }} title={`PREVIEW ${w.kind} limit exceeded`} />)}
                      {lane.kind === 'clips' && (clipsOf(lane.clip) as any[]).map((c) => {
                        const isSel = selClip?.id === c.id;
                        const dr = clipDrag?.id === c.id ? clipDrag : null;
                        if (lane.clip === 'cue') { const tt = dr ? dr.from : c.tSec; return <div key={c.id} className={'diamond' + (isSel ? ' sel' : '')} style={{ left: tt * pps, background: '#f783ac' }} title={`${c.type} @${tt.toFixed(2)}s`} onMouseDown={(e) => startClipDrag(e, 'cue', c, 'move')} />; }
                        const f = dr ? dr.from : c.fromSec, to = dr ? dr.to : c.toSec;
                        return <div key={c.id} className={'clip' + (isSel ? ' sel' : '') + (lane.clip === 'audio' ? ' audio' : lane.clip === 'projector' ? ' proj' : '')} style={{ left: f * pps, width: Math.max(6, (to - f) * pps) }} onMouseDown={(e) => startClipDrag(e, lane.clip, c, 'move')}>
                          <span className="h l" onMouseDown={(e) => startClipDrag(e, lane.clip, c, 'l')} />{lane.clip === 'effect' ? c.type : (c.assetId ?? '').split('/').pop()}<span className="h r" onMouseDown={(e) => startClipDrag(e, lane.clip, c, 'r')} />
                        </div>;
                      })}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
          <Playhead pps={pps} />
        </div>
      </div>
      <KeyPanel />
    </div>
  );
}

function Playhead({ pps }: { pps: number }) {
  const t = useStore((s) => s.tSec);
  return <div className="playhead" style={{ left: 170 + t * pps }} />;
}

function KeyPanel() {
  const sel = useStore((s) => s.selKeys), seq = useStore((s) => s.seq), setInterp = useStore((s) => s.setInterp);
  if (sel.length !== 1) return null;
  const k = getKeys(seq, sel[0].path).find((q) => q.id === sel[0].id);
  if (!k) return null;
  const isEye = sel[0].path.type === 'eye';
  return (
    <div style={{ padding: '3px 10px', borderTop: '1px solid var(--line)', display: 'flex', gap: 8, alignItems: 'center' }}>
      <span className="dim">Key @{k.tSec.toFixed(3)}s</span>
      <select disabled={isEye} value={isEye ? 'hold' : k.interpolationToNext ?? 'linear'} onChange={(e) => setInterp(sel[0].path, k.id, e.target.value as 'hold' | 'linear' | 'smoothstep')}>
        <option value="hold">hold</option><option value="linear">linear</option><option value="smoothstep">smoothstep</option>
      </select>
      <span className="dim small">{pathKey(sel[0].path)}</span>
    </div>
  );
}

function TransportBar({ pps, setPps }: { pps: number; setPps: (n: number) => void }) {
  const s = useStore();
  const fmt = (x: number) => x.toFixed(3);
  const step = 1 / (s.snapFps || 30);
  return (
    <div className="transport">
      <button onClick={() => s.setTime(0)} title="Go to start">|◀</button>
      <button onClick={() => s.setTime(s.tSec - step)} title="Back 1 frame (←)">◀</button>
      <button className={'playbtn' + (s.playing ? ' on' : '')} onClick={() => { unlockAudio(); s.playing ? s.pause() : s.play(); }} style={{ width: 70 }} title="Play / Pause (Space)">{s.playing ? '❚❚ Pause' : '▶ Play'}</button>
      <button onClick={() => s.setTime(s.tSec + step)} title="Forward 1 frame (→)">▶</button>
      <button onClick={s.stop} title="Stop and return to start">■</button>
      <button className={s.seq.loop ? 'on' : ''} onClick={s.toggleLoop} title="Repeat from the start when the end is reached">↻ Loop</button>
      <span style={{ fontVariantNumeric: 'tabular-nums', minWidth: 120 }} title="Current time / total length">{fmt(s.tSec)} / {fmt(s.seq.durationSec)} s</span>
      <select value={s.speed} onChange={(e) => s.setSpeed(Number(e.target.value))} title="Playback speed"><option value={0.5}>0.5×</option><option value={0.6}>0.6×</option><option value={0.7}>0.7×</option><option value={1}>1×</option><option value={2}>2×</option></select>
      <label className="dim" title="Total sequence length (seconds)">Length <input type="number" min={1} step={1} value={s.seq.durationSec} onChange={(e) => s.patchSeq((q) => { q.durationSec = Math.max(1, Number(e.target.value)); }, 'dur')} /></label>
      <label className="dim" title="Snap keys and clips to this interval">Snap <select value={s.snapFps} onChange={(e) => useStore.setState({ snapFps: Number(e.target.value) })}><option value={0}>Off</option><option value={10}>1/10 s</option><option value={30}>1/30 s</option><option value={60}>1/60 s</option></select></label>
      <button className={s.autoKey ? 'on' : ''} onClick={() => s.setAutoKey(!s.autoKey)} title="On: changing a value records a key (◆) at the current time. Off: unsaved temporary preview (LIVE)">◆ Auto-key {s.autoKey ? 'on' : 'off'}</button>
      <span style={{ flex: 1 }} />
      <span className="dim" title="Zoom the timeline in/out">Zoom</span><input type="range" min={20} max={240} value={pps} onChange={(e) => setPps(Number(e.target.value))} style={{ width: 90 }} />
    </div>
  );
}
void clone;
