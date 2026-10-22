import { useRef, useState } from 'react';
import { useStore, assetKind } from '../store';
import { KeyBtn, NumRow, Section, rgbCss, useDesired } from './widgets';
import { PREVIEW_LIMITS } from '../engine/rigDefaults';
import { EYE_PRESETS, getBit, invertRows, mirrorRows, setBit } from '../engine/eyePresets';
import { uid, setEyeBitmap } from '../engine/edit';
import { EMOTIONS, DEFAULT_EXPORT, emotionFrameAt, emotionDurationMs, type Emotion } from '../engine/emotions';
import type { EffectClip, EffectName, LedBlend, Rgbw } from '../engine/types';
import { LED_COUNT } from '../engine/types';
import { unlockAudio } from '../runtime/audio';
import { EyeStudio } from './EyeStudio';

type Tab = 'motion' | 'ring' | 'eyes' | 'proj' | 'audio' | 'events' | 'rig';

export function Inspector() {
  const [tab, setTab] = useState<Tab>('motion');
  const selClip = useStore((s) => s.selClip);
  const tabs: [Tab, string, string][] = [['motion', 'Motion', 'Rail · Yaw · Tilt'], ['ring', 'LED Ring', 'NeoPixel ×24 (RGBW)'], ['eyes', 'Eyes', 'Two 8x8 dot eyes'], ['proj', 'Projector', 'Floor-projected video/image'], ['audio', 'Audio', 'Voice and sound-effect clips'], ['events', 'Events', 'Sensor triggers (virtual)'], ['rig', 'Rig/HW', 'Part assignment · unknown hardware values']];
  return (
    <div className="insp">
      <div className="tabs">{tabs.map(([k, l, d]) => <button key={k} className={tab === k ? 'on' : ''} title={d} onClick={() => setTab(k)}>{l}</button>)}</div>
      <KeyStatus />
      {selClip && <ClipEditor />}
      {tab === 'motion' && <Motion />}
      {tab === 'ring' && <Ring />}
      {tab === 'eyes' && <EyesTab />}
      {tab === 'proj' && <Projector />}
      {tab === 'audio' && <AudioTab />}
      {tab === 'events' && <Events />}
      {tab === 'rig' && <Rig />}
    </div>
  );
}

function KeyStatus() {
  const autoKey = useStore((s) => s.autoKey), t = useStore((s) => s.tSec);
  const live = useStore((s) => Object.keys(s.live).length > 0);
  return autoKey
    ? <div className="statusline on" title="Changing a value records a key at the current time">◆ Auto-key on · changes are recorded at <span className="pill">{t.toFixed(2)}s</span></div>
    : <div className="statusline off" title="Temporary values disappear when you move the time">⚠ Auto-key off · changed values are an unsaved preview{live ? ' (LIVE)' : ''}</div>;
}

function Motion() {
  const d = useDesired();
  const setMotion = useStore((s) => s.setMotion);
  const L = PREVIEW_LIMITS;
  return (
    <>
      <Section title="Motion (3 preview axes)">
        <NumRow label="Rail X" value={d.motion.railX * 1000} min={-300} max={50} step={1} unit="mm" digits={1} onChange={(v) => setMotion('railX', v / 1000)} path={{ type: 'motion', ch: 'railX' }} warnRange={[L.railX.range[0] * 1000, L.railX.range[1] * 1000]} />
        <NumRow label="Yaw (rotation)" value={d.motion.yawY} min={-90} max={90} step={0.5} unit="°" digits={1} onChange={(v) => setMotion('yawY', v)} path={{ type: 'motion', ch: 'yawY' }} warnRange={L.yawY.range as [number, number]} />
        <NumRow label="Tilt" value={d.motion.tiltZ} min={-15} max={15} step={0.25} unit="°" digits={2} onChange={(v) => setMotion('tiltZ', v)} path={{ type: 'motion', ch: 'tiltZ' }} warnRange={L.tiltZ.range as [number, number]} />
        <div className="note">Preview range: Rail {L.railX.range[0] * 1000}~{L.railX.range[1] * 1000} mm · Yaw ±{L.yawY.range[1]}° · Tilt ±{L.tiltZ.range[1]}° — <b>demo values only</b>, not the real mechanical safe range. The rail GLB length (612 mm) is not the usable stroke.</div>
      </Section>
    </>
  );
}

const hex2 = (v: number) => Math.round(v).toString(16).padStart(2, '0');

function Ring() {
  const d = useDesired();
  const sel = useStore((s) => s.selectedLeds), selectLeds = useStore((s) => s.selectedLeds && s.selectLeds);
  const setPixels = useStore((s) => s.setPixels);
  const setBri = useStore((s) => s.setRingBrightness);
  const addEffect = useStore((s) => s.patchSeq);
  const t = useStore((s) => s.tSec);
  const [fx, setFx] = useState<EffectName>('breathe');
  const first = sel.length ? d.ring24.pixels[sel[0]] : ([0, 0, 0, 0] as Rgbw);
  const mixed = (c: number) => sel.some((i) => d.ring24.pixels[i][c] !== first[c]);
  const setCh = (c: number, v: number) => {
    const e: Record<number, Rgbw> = {};
    for (const i of sel) { const p = [...d.ring24.pixels[i]] as number[]; p[c] = Math.max(0, Math.min(255, Math.round(v))); e[i] = p as unknown as Rgbw; }
    setPixels(e);
  };
  const fill = (rgbw: Rgbw) => { const e: Record<number, Rgbw> = {}; for (const i of sel.length ? sel : [...Array(LED_COUNT).keys()]) e[i] = rgbw; setPixels(e); };
  const rotate = (n: number) => { const e: Record<number, Rgbw> = {}; for (let i = 0; i < LED_COUNT; i++) e[i] = d.ring24.pixels[(i - n + LED_COUNT) % LED_COUNT]; setPixels(e); };
  const gradient = () => { const idx = sel.length > 1 ? [...sel].sort((a, b) => a - b) : [...Array(LED_COUNT).keys()]; const a = d.ring24.pixels[idx[0]], b = d.ring24.pixels[idx[idx.length - 1]]; const e: Record<number, Rgbw> = {}; idx.forEach((i, k) => { const u = k / Math.max(1, idx.length - 1); e[i] = [0, 1, 2, 3].map((c) => Math.round(a[c] + (b[c] - a[c]) * u)) as unknown as Rgbw; }); setPixels(e); };
  const addFx = () => addEffect((s) => { s.tracks.ring24.effects.push({ id: uid('fx'), type: fx, fromSec: t, toSec: Math.min(s.durationSec, t + 3), seed: 1 + s.tracks.ring24.effects.length, priority: s.tracks.ring24.effects.length, blend: 'max', params: defaultParams(fx) }); });
  return (
    <>
      <Section title="NeoPixel 24 RGBW" right={<span className="dim">virtual idx · pixel0 = +X</span>}>
        <RingPicker />
        <div className="chips" style={{ marginTop: 6 }}>
          <button onClick={() => selectLeds([...Array(LED_COUNT).keys()])}>All</button><button onClick={() => selectLeds([])}>None</button>
          <button onClick={() => selectLeds([...Array(LED_COUNT).keys()].filter((i) => !sel.includes(i)))}>Invert</button>
          <button onClick={() => selectLeds([...Array(LED_COUNT).keys()].filter((i) => i % 2 === 0))}>Even</button>
          <button onClick={() => selectLeds([...Array(LED_COUNT).keys()].filter((i) => i % 2 === 1))}>Odd</button>
          <button onClick={() => rotate(1)}>⟳ +1</button><button onClick={() => rotate(-1)}>⟲ −1</button>
        </div>
        <div className="note">Selected: {sel.length ? sel.map((i) => '#' + i).join(' ') : 'none'} (Shift = add)</div>
      </Section>
      <Section title="Color (selected)" right={<span style={{ background: rgbCss(first), width: 40, height: 12, display: 'inline-block', borderRadius: 3, border: '1px solid #fff3' }} />}>
        {(['R', 'G', 'B', 'W'] as const).map((n, c) => (
          <div className="row" key={n}><label>{n}{mixed(c) ? ' (mixed)' : ''}</label>
            <input type="range" min={0} max={255} value={first[c]} disabled={!sel.length} onChange={(e) => setCh(c, Number(e.target.value))} />
            <input type="number" min={0} max={255} value={Math.round(first[c])} disabled={!sel.length} onChange={(e) => setCh(c, Number(e.target.value))} />
          </div>
        ))}
        <div className="row"><label>Picker</label><input type="color" disabled={!sel.length} value={`#${hex2(first[0])}${hex2(first[1])}${hex2(first[2])}`} onChange={(e) => { const h = e.target.value; const r = parseInt(h.slice(1, 3), 16), g = parseInt(h.slice(3, 5), 16), b = parseInt(h.slice(5, 7), 16); const ee: Record<number, Rgbw> = {}; for (const i of sel) ee[i] = [r, g, b, d.ring24.pixels[i][3]]; setPixels(ee); }} /><span className="dim small">RGB only · W kept</span></div>
        <div className="chips">
          <button onClick={() => fill([0, 0, 0, 0])}>Off</button><button onClick={() => fill([0, 0, 0, 255])}>W 255</button><button onClick={() => fill([255, 255, 255, 0])}>RGB white</button>
          <button onClick={() => fill([255, 0, 0, 0])}>Red</button><button onClick={() => fill([0, 255, 0, 0])}>Green</button><button onClick={() => fill([0, 0, 255, 0])}>Blue</button><button onClick={gradient}>Gradient</button>
        </div>
        <NumRow label="Brightness" value={d.ring24.brightness} min={0} max={1} step={0.01} onChange={setBri} path={{ type: 'ringBrightness' }} />
        <div className="row"><label>Frame ◆</label><KeyBtn path={{ type: 'ringBase' }} /><span className="dim small">Key for the full 24-pixel frame at the current time</span></div>
        <div className="note">W is kept as an independent channel and is only composited to white in the preview. Physical LED0 / direction / byte order are <b>UNKNOWN</b>.</div>
      </Section>
      <Section title="Effect clips" right={<span />}>
        <div className="row"><select value={fx} onChange={(e) => setFx(e.target.value as EffectName)}>{['solid', 'breathe', 'chase', 'wave', 'pulse', 'sparkle', 'gradient', 'progress'].map((x) => <option key={x}>{x}</option>)}</select><button onClick={addFx}>+ Add at current time</button></div>
        <div className="note">Select, move and resize clips in the timeline Effects lane. Effects are deterministic, computed from seed and time.</div>
      </Section>
    </>
  );
}

function defaultParams(t: EffectName): EffectClip['params'] {
  switch (t) {
    case 'chase': return { whiteLevel: 200, speedHz: 0.5, width: 4, direction: 1 };
    case 'wave': return { whiteLevel: 150, speedHz: 0.5, width: 8, direction: 1 };
    case 'pulse': return { whiteLevel: 200, periodSec: 1.5 };
    case 'sparkle': return { whiteLevel: 255, rateHz: 6, density: 0.25 };
    case 'gradient': return { colorA: [255, 0, 80, 0], colorB: [0, 120, 255, 0] };
    case 'progress': return { whiteLevel: 220 };
    case 'solid': return { whiteLevel: 120 };
    default: return { whiteLevel: 200, speedHz: 0.4 };
  }
}

function RingPicker() {
  const d = useDesired();
  const sel = useStore((s) => s.selectedLeds), select = useStore((s) => s.selectLeds);
  const R = 70, C = 90;
  return (
    <svg width="100%" viewBox="0 0 180 180" style={{ maxHeight: 190 }}>
      <circle cx={C} cy={C} r={R + 14} fill="#0f1115" stroke="#2c313a" />
      {Array.from({ length: LED_COUNT }, (_, i) => {
        const a = (i * 15 * Math.PI) / 180; // virtual 0 at +X (right), increases toward +Z (down on screen from top view)
        const x = C + Math.cos(a) * R, y = C + Math.sin(a) * R;
        const on = sel.includes(i);
        return (
          <g key={i} onClick={(e) => select([i], e.shiftKey)} style={{ cursor: 'pointer' }}>
            <circle cx={x} cy={y} r={9} fill={rgbCssB(d.ring24.pixels[i], d.ring24.brightness)} stroke={on ? '#fff' : '#3a404b'} strokeWidth={on ? 2.5 : 1} />
            <text x={x} y={y + 3} fontSize={8} textAnchor="middle" fill={on ? '#fff' : '#9aa3b2'} style={{ pointerEvents: 'none', mixBlendMode: 'difference' }}>{i}</text>
          </g>
        );
      })}
      <text x={C} y={C - 4} textAnchor="middle" fontSize={9} fill="#6b7280">top view</text>
      <text x={C} y={C + 8} textAnchor="middle" fontSize={9} fill="#6b7280">#0 → +X (front)</text>
    </svg>
  );
}
const rgbCssB = (p: readonly number[], b: number) => rgbCss(p, Math.max(0.15, b));

function EyeEditor({ side }: { side: 'left' | 'right' }) {
  const d = useDesired();
  const setEye = useStore((s) => s.setEye);
  const color = useStore((s) => s.view.eyeColor);
  const rows = d.eyes[side];
  const paint = useRef<boolean | null>(null);
  const k = side === 'left' ? d.eyes.leftIntensity : d.eyes.rightIntensity;
  return (
    <div style={{ marginBottom: 10 }}>
      <div className="row"><b>{side === 'left' ? 'Left eye (screen L)' : 'Right eye (screen R)'}</b><span className="sp" style={{ flex: 1 }} /><KeyBtn path={{ type: 'eye', side }} /></div>
      <div className="eyegrid" style={{ ['--eye' as string]: color }} onMouseUp={() => { paint.current = null; }} onMouseLeave={() => { paint.current = null; }}>
        {Array.from({ length: 64 }, (_, i) => {
          const r = i >> 3, c = i & 7, on = getBit(rows, r, c);
          return <i key={i} className={on ? 'on' : ''}
            onMouseDown={() => { paint.current = !on; setEye(side, setBit(rows, r, c, !on)); }}
            onMouseEnter={() => { if (paint.current !== null && on !== paint.current) setEye(side, setBit(rows, r, c, paint.current)); }} />;
        })}
      </div>
      <div className="chips" style={{ marginTop: 4 }}>
        {Object.keys(EYE_PRESETS).map((p) => <button key={p} onClick={() => setEye(side, EYE_PRESETS[p])}>{p}</button>)}
        <button onClick={() => setEye(side, invertRows(rows))}>invert</button><button onClick={() => setEye(side, mirrorRows(rows))}>mirror</button>
        <button onClick={() => setEye(side === 'left' ? 'right' : 'left', rows)}>→ copy to {side === 'left' ? 'R' : 'L'}</button>
      </div>
      <NumRow label="Intensity" value={k} min={0} max={1} step={0.01} onChange={(v) => useStore.getState().setEyeIntensity(side === 'left' ? 'leftIntensity' : 'rightIntensity', v)} path={{ type: 'eyeIntensity', which: side === 'left' ? 'leftIntensity' : 'rightIntensity' }} />
    </div>
  );
}


let emoTimer = 0;
function Emotions() {
  const [sel, setSel] = useState<string[]>([]);
  const [width, setWidth] = useState(1280);
  const [minSec, setMinSec] = useState(DEFAULT_EXPORT.minSec);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const toggle = (id: string) => setSel((a) => (a.includes(id) ? a.filter((x) => x !== id) : [...a, id]));
  const stopPreview = () => { window.clearInterval(emoTimer); emoTimer = 0; useStore.getState().clearLive(); };
  const preview = (e: Emotion) => {
    stopPreview();
    const t0 = performance.now();
    const tick = () => {
      const ms = performance.now() - t0;
      if (ms > Math.max(emotionDurationMs(e), 2500) * 2) { stopPreview(); return; }
      const f = emotionFrameAt(e, ms);
      useStore.setState((st) => ({ live: { ...st.live, eyeLeft: f.l, eyeRight: f.r } }));
    };
    tick(); emoTimer = window.setInterval(tick, 16);
  };
  const place = (e: Emotion) => {
    stopPreview();
    const { seq, tSec, commit } = useStore.getState();
    let next = seq, t = tSec;
    for (const f of e.frames) { next = setEyeBitmap(setEyeBitmap(next, 'left', t, f.l), 'right', t, f.r); t += f.ms / 1000; }
    commit(next, 'emo' + e.id);
    setMsg(`${e.label}: ${e.frames.length} keys at ${tSec.toFixed(2)}s (${(t - tSec).toFixed(2)}s long)`);
  };
  const exportMp4 = async () => {
    setBusy(true); setMsg('Rendering…');
    try {
      const r = await fetch('/__export-emotions', { method: 'POST', body: JSON.stringify({ ids: sel, width, minSec }) });
      if (!r.ok) throw new Error(await r.text());
      const saved = r.headers.get('X-Saved-As') ?? 'lieu_eyes.mp4';
      const url = URL.createObjectURL(await r.blob());
      const a = document.createElement('a'); a.href = url; a.download = saved.split('/').pop()!; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      setMsg(`Saved ${saved}`);
    } catch (err) { setMsg(`Export failed: ${(err as Error).message}`); }
    setBusy(false);
  };
  return (
    <Section title="Emotions · preview / place / export">
      <div className="chips">
        {EMOTIONS.map((e) => (
          <span key={e.id} style={{ display: 'inline-flex', gap: 2 }}>
            <button className={sel.includes(e.id) ? 'on' : ''} title="Select for MP4 export" onClick={() => toggle(e.id)}>{e.label}</button>
            <button title="Preview on the robot" onClick={() => preview(e)}>▶</button>
            <button title="Place as keyframes at the playhead" onClick={() => place(e)}>+key</button>
          </span>
        ))}
      </div>
      <div className="row" style={{ marginTop: 8 }}>
        <label>Width</label>
        <select value={width} onChange={(e) => setWidth(+e.target.value)}>{[640, 1280, 1920, 2560].map((w) => <option key={w} value={w}>{w}×{w / 2}</option>)}</select>
        <label>Min sec / emotion</label>
        <input type="number" min={0.5} max={30} step={0.5} value={minSec} style={{ width: 56 }} onChange={(e) => setMinSec(+e.target.value || 1)} />
      </div>
      <div className="row">
        <button disabled={busy} onClick={exportMp4}>Export MP4 (2:1 B/W) — {sel.length ? sel.length + ' selected' : 'all emotions'}</button>
        <button onClick={() => { stopPreview(); setSel([]); }}>Stop / clear</button>
      </div>
      {msg && <div className="note">{msg}</div>}
      <div className="note">MP4 is white dots on black, both 8×8 eyes side by side (16×8 = 2:1). Selected emotions play back to back in selection order. Saved copies go to <b>exports/</b>. Emotions are defined in <b>src/engine/emotions.ts</b>.</div>
    </Section>
  );
}

function Eyes() {
  const setView = useStore((s) => s.setView), color = useStore((s) => s.view.eyeColor);
  return (
    <Section title="Eyes · 2 × HT16K33 8×8 (mono)">
      <div className="eyecols"><EyeEditor side="left" /><EyeEditor side="right" /></div>
      <div className="row"><label>Preview color</label><input type="color" value={color} onChange={(e) => setView({ eyeColor: e.target.value })} /><span className="dim small">Real emission color UNKNOWN</span></div>
      <div className="note">Eye patterns are hold keys. Logical left/right is separate from the real I²C address and row/column mapping, which are currently <b>UNKNOWN (null)</b>. Drag over the dots to draw.</div>
    </Section>
  );
}

function EyesTab() { return <><Eyes /><EyeStudio /><Emotions /></>; }

function Projector() {
  const d = useDesired();
  const set = useStore((s) => s.setProjProp);
  const seq = useStore((s) => s.seq), assets = useStore((s) => s.assets), t = useStore((s) => s.tSec);
  const patch = useStore((s) => s.patchSeq), addAsset = useStore((s) => s.addAsset), reg = useStore((s) => s.registerBuiltin);
  const view = useStore((s) => s.view), setView = useStore((s) => s.setView);
  const file = useRef<HTMLInputElement>(null);
  const ex = d.projector.extraProperties ?? {};
  const P = (prop: string) => ({ type: 'projProp' as const, prop });
  const known = Array.from(new Set(['media/welcome.svg', 'media/detour.svg', 'media/seatbelt.svg', ...Object.keys(assets).filter((k) => assetKind(assets[k].mime) !== 'audio' && assetKind(assets[k].mime) !== 'other'), ...seq.tracks.projector.clips.map((c) => c.assetId)]));
  const [asset, setAsset] = useState(known[0]);
  const addClip = () => { reg(asset); patch((s) => { s.tracks.projector.clips.push({ id: uid('pc'), fromSec: t, toSec: Math.min(s.durationSec, t + 4), assetId: asset, visible: true, loopMedia: true }); }); };
  return (
    <>
      <Section title="Projector · Miniray_Beam (node 18)">
        <div className="row"><label>Source</label><select value={asset} onChange={(e) => setAsset(e.target.value)} style={{ flex: 1 }}>{known.map((k) => <option key={k} value={k}>{k}</option>)}</select></div>
        <div className="row"><button onClick={addClip}>+ Add clip (current time)</button><button onClick={() => file.current?.click()}>Upload PNG/SVG/MP4…</button>
          <input ref={file} type="file" hidden accept="image/png,image/svg+xml,image/jpeg,video/mp4,video/webm" onChange={(e) => { const f = e.target.files?.[0]; if (f) { const id = addAsset(f); setAsset(id); } e.target.value = ''; }} /></div>
        <div className="note">Active clips: {d.projector.activeClips.map((c) => c.assetId).join(', ') || 'none (OFF)'}</div>
      </Section>
      <Section title="Projection (keyframable)">
        <NumRow label="Opacity" value={d.projector.opacity} min={0} max={1} step={0.01} onChange={(v) => set('opacity', v, 1)} path={P('opacity')} />
        <NumRow label="Brightness" value={d.projector.brightness} min={0} max={2} step={0.01} onChange={(v) => set('brightness', v, 1)} path={P('brightness')} />
        <NumRow label="Rotation" value={d.projector.rotationDeg} min={-180} max={180} step={1} unit="°" onChange={(v) => set('rotationDeg', v, 0)} path={P('rotationDeg')} />
        <NumRow label="Scale" value={d.projector.scale} min={0.1} max={3} step={0.01} onChange={(v) => set('scale', v, 1)} path={P('scale')} />
        <NumRow label="Offset X" value={d.projector.offsetXm * 100} min={-50} max={50} step={0.5} unit="cm" digits={1} onChange={(v) => set('offsetXm', v / 100, 0)} path={P('offsetXm')} />
        <NumRow label="Offset Z" value={d.projector.offsetZm * 100} min={-50} max={50} step={0.5} unit="cm" digits={1} onChange={(v) => set('offsetZm', v / 100, 0)} path={P('offsetZm')} />
      </Section>
      <Section title="Optics (preview assumptions)">
        <NumRow label="Floor Y" value={(ex.floorHeightYm ?? -1.4881) * 100} min={-200} max={-5} step={1} unit="cm" digits={0} onChange={(v) => set('floorHeightYm', v / 100, -1.4881)} path={P('floorHeightYm')} />
        <NumRow label="Width" value={(ex.projectedWidthM ?? 1.0) * 100} min={5} max={120} step={1} unit="cm" digits={0} onChange={(v) => set('projectedWidthM', v / 100, 1.0)} path={P('projectedWidthM')} />
        <NumRow label="Aim yaw" value={ex.opticalAimYawDeg ?? 0} min={-90} max={90} step={1} unit="°" onChange={(v) => set('opticalAimYawDeg', v, 0)} path={P('opticalAimYawDeg')} />
        <NumRow label="Aim pitch" value={ex.opticalAimPitchDeg ?? 0} min={-45} max={45} step={1} unit="°" onChange={(v) => set('opticalAimPitchDeg', v, 0)} path={P('opticalAimPitchDeg')} />
        <div className="row"><button className={view.showFrustum ? 'on' : ''} onClick={() => setView({ showFrustum: !view.showFrustum })}>Frustum debug</button></div>
        <div className="note">Throw ratio, resolution, lens optical center and focal length are <b>UNKNOWN</b>. Floor raycast + plane texture (MVP); the projection width is an arbitrary assumed value.</div>
      </Section>
    </>
  );
}

function AudioTab() {
  const seq = useStore((s) => s.seq), t = useStore((s) => s.tSec), assets = useStore((s) => s.assets);
  const patch = useStore((s) => s.patchSeq), addAsset = useStore((s) => s.addAsset), reg = useStore((s) => s.registerBuiltin);
  const d = useDesired();
  const file = useRef<HTMLInputElement>(null);
  const known = Array.from(new Set(['media/intro-chime.wav', ...Object.keys(assets).filter((k) => assetKind(assets[k].mime) === 'audio'), ...seq.tracks.audio.map((c) => c.assetId)]));
  const [asset, setAsset] = useState(known[0]);
  return (
    <Section title="Audio (WebAudio)">
      <div className="row"><label>Asset</label><select value={asset} onChange={(e) => setAsset(e.target.value)} style={{ flex: 1 }}>{known.map((k) => <option key={k}>{k}</option>)}</select></div>
      <div className="row"><button onClick={() => { unlockAudio(); reg(asset); patch((s) => { s.tracks.audio.push({ id: uid('au'), fromSec: t, toSec: Math.min(s.durationSec, t + 2), assetId: asset, mediaOffsetSec: 0, gain: 0.5, fadeInSec: 0.05, fadeOutSec: 0.2, loop: false }); }); }}>+ Add clip</button>
        <button onClick={() => file.current?.click()}>Upload audio…</button>
        <input ref={file} type="file" hidden accept="audio/*" onChange={(e) => { const f = e.target.files?.[0]; if (f) setAsset(addAsset(f)); e.target.value = ''; }} /></div>
      <div className="note">Playing audio: {d.activeAudio.map((c) => c.assetId).join(', ') || 'none'} · Gain is a <b>linear factor</b>, not dB. Per browser policy, audio plays only after the Play button is clicked. Duration is the clip length; if longer than the asset, playback ends naturally.</div>
    </Section>
  );
}

const MOCK_EVENTS = ['passenger_arrives', 'passenger_seated', 'belt_off', 'belt_on', 'reroute_requested', 'arrived'];
function Events() {
  const patch = useStore((s) => s.patchSeq), t = useStore((s) => s.tSec), log = useStore((s) => s.eventLog);
  const [custom, setCustom] = useState('');
  const add = (type: string) => patch((s) => { s.tracks.events.push({ id: uid('ev'), tSec: t, type, payload: { mock: true } }); });
  return (
    <Section title="Virtual sensor triggers (mock)">
      <div className="chips">{MOCK_EVENTS.map((e) => <button key={e} onClick={() => add(e)}>{e}</button>)}</div>
      <div className="row" style={{ marginTop: 6 }}><input type="text" placeholder="custom type" value={custom} onChange={(e) => setCustom(e.target.value)} style={{ flex: 1 }} /><button onClick={() => custom && add(custom)}>+ Add</button></div>
      <div className="note">Adds a cue at the current time. Seeking does not fire events; only the (prev, now] interval during Play is logged. The real webcam/sensor geometry is not in the GLB.</div>
      <div className="note" style={{ whiteSpace: 'pre-wrap', maxHeight: 120, overflow: 'auto' }}>{log.slice(-8).join('\n') || '— no events fired —'}</div>
    </Section>
  );
}

function Rig() {
  const rig = useStore((s) => s.rig), setPivot = useStore((s) => s.setPivot), reset = useStore((s) => s.resetRig);
  return (
    <>
      <Section title="Pivot hypothesis (rest world, m)" right={<button onClick={reset}>Reset</button>}>
        {(['yaw', 'tilt'] as const).map((w) => (
          <div key={w}><b>{w === 'yaw' ? 'Yaw pivot (axis +Y)' : 'Tilt pivot (axis +Z)'}</b>
            {(['x', 'y', 'z'] as const).map((a, ai) => (
              <div className="row" key={a}><label>{a}</label><input type="number" step={0.001} value={rig.pivots[w][ai]} onChange={(e) => setPivot(w, ai as 0 | 1 | 2, Number(e.target.value))} /><span className="dim small">m</span></div>
            ))}
          </div>
        ))}
        <div className="note">Pivot, axis and moving-stage assignments are an uncalibrated <b>hypothesis</b> (estimated from AABB centers). Edit assignments per mesh in the Scene Tree on the left.</div>
      </Section>
      <Section title="Hardware calibration (UNKNOWN)">
        <table className="small" style={{ width: '100%', color: 'var(--dim)' }}><tbody>
          {[['Motor model / count', 'null'], ['Axis hard limits · speed · acceleration · jerk', 'null'], ['Gear ratio / homing', 'null'], ['Actual rail stroke', 'null'], ['NeoPixel chipset · LED0 · byte order', 'null / UNKNOWN'], ['Eye I²C address · row/column mapping', 'null'], ['Projector throw / resolution / lens center', 'null']].map(([a, b]) => <tr key={a}><td>{a}</td><td style={{ textAlign: 'right', color: 'var(--key)' }}>{b}</td></tr>)}
        </tbody></table>
        <button disabled style={{ marginTop: 8, width: '100%' }} title="Hardware output is not implemented">Connect hardware — disabled (PREVIEW ONLY)</button>
        <div className="note">This app sends no commands to motors, LEDs or I²C devices. Until calibration is done (docs/03_INPUTS_AND_LIMITS.md questionnaire), HardwareAdapter is a no-op.</div>
      </Section>
    </>
  );
}

function ClipEditor() {
  const sel = useStore((s) => s.selClip)!, seq = useStore((s) => s.seq), patch = useStore((s) => s.patchSeq), setSel = useStore((s) => s.setSelClip);
  const T = seq.tracks;
  const find = () => sel.kind === 'effect' ? T.ring24.effects.find((c) => c.id === sel.id) : sel.kind === 'projector' ? T.projector.clips.find((c) => c.id === sel.id) : sel.kind === 'audio' ? T.audio.find((c) => c.id === sel.id) : T.events.find((c) => c.id === sel.id);
  const c: any = find();
  if (!c) return null;
  const upd = (fn: (x: any) => void) => patch((s) => {
    const list: any[] = sel.kind === 'effect' ? s.tracks.ring24.effects : sel.kind === 'projector' ? s.tracks.projector.clips : sel.kind === 'audio' ? s.tracks.audio : s.tracks.events;
    const x = list.find((q) => q.id === sel.id); if (x) fn(x);
  }, 'clip' + sel.id);
  const del = () => { patch((s) => { const key = sel.kind === 'effect' ? 'ring24' : sel.kind; if (sel.kind === 'effect') s.tracks.ring24.effects = s.tracks.ring24.effects.filter((q) => q.id !== sel.id); else if (sel.kind === 'projector') s.tracks.projector.clips = s.tracks.projector.clips.filter((q) => q.id !== sel.id); else if (sel.kind === 'audio') s.tracks.audio = s.tracks.audio.filter((q) => q.id !== sel.id); else s.tracks.events = s.tracks.events.filter((q) => q.id !== sel.id); void key; }); setSel(null); };
  const num = (label: string, k: string, step = 0.05, min = -1e9, max = 1e9) => <div className="row" key={k}><label>{label}</label><input type="number" step={step} min={min} max={max} value={Number((c[k] ?? 0).toFixed(3))} onChange={(e) => upd((x) => { x[k] = Number(e.target.value); })} /></div>;
  return (
    <Section title={`Clip · ${sel.kind}`} right={<span><button onClick={del}>Delete</button> <button onClick={() => setSel(null)}>×</button></span>}>
      {sel.kind === 'cue' ? (<>
        <div className="row"><label>type</label><input type="text" value={c.type} onChange={(e) => upd((x) => { x.type = e.target.value; })} /></div>{num('t (s)', 'tSec')}</>) : (<>
        {num('from (s)', 'fromSec', 0.05, 0)}{num('to (s)', 'toSec', 0.05, 0)}</>)}
      {sel.kind === 'effect' && (<>
        <div className="row"><label>type</label><select value={c.type} onChange={(e) => upd((x) => { x.type = e.target.value; x.params = defaultParams(e.target.value as EffectName); })}>{['solid', 'breathe', 'chase', 'wave', 'pulse', 'sparkle', 'gradient', 'progress'].map((k) => <option key={k}>{k}</option>)}</select></div>
        <div className="row"><label>blend</label><select value={c.blend} onChange={(e) => upd((x) => { x.blend = e.target.value as LedBlend; })}>{['replace', 'add', 'max'].map((k) => <option key={k}>{k}</option>)}</select></div>
        {num('priority', 'priority', 1)}{num('seed', 'seed', 1)}
        {Object.entries(c.params as Record<string, unknown>).filter(([, v]) => typeof v === 'number').map(([k, v]) => (
          <div className="row" key={k}><label>{k}</label><input type="number" step={0.05} value={v as number} onChange={(e) => upd((x) => { x.params[k] = Number(e.target.value); })} /></div>
        ))}
        <div className="row"><label>color picker</label><input type="color" value={Array.isArray(c.params.color) ? `#${hex2(c.params.color[0])}${hex2(c.params.color[1])}${hex2(c.params.color[2])}` : '#000000'} onChange={(e) => upd((x) => { const h = e.target.value; const w = Array.isArray(x.params.color) ? x.params.color[3] : 0; x.params.color = [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16), w]; })} /><span className="dim small">RGB only · W kept</span></div>
        <div className="row"><label>color RGBW</label>{[0, 1, 2, 3].map((i) => <input key={i} type="number" min={0} max={255} style={{ width: 44 }} value={Array.isArray(c.params.color) ? c.params.color[i] : 0} onChange={(e) => upd((x) => { const a = Array.isArray(x.params.color) ? [...x.params.color] : [0, 0, 0, 0]; a[i] = Number(e.target.value); x.params.color = a; })} />)}</div>
        <div className="note">When color is set, it is used instead of the whiteLevel/warmth default color.</div>
      </>)}
      {sel.kind === 'projector' && (<>
        <div className="row"><label>asset</label><span className="small">{c.assetId}</span></div>
        <div className="row"><label>visible</label><input type="checkbox" checked={c.visible} onChange={(e) => upd((x) => { x.visible = e.target.checked; })} /></div>
        <div className="row"><label>loop media</label><input type="checkbox" checked={c.loopMedia !== false} onChange={(e) => upd((x) => { x.loopMedia = e.target.checked; })} /></div>{num('media off', 'mediaOffsetSec')}</>)}
      {sel.kind === 'audio' && (<>
        <div className="row"><label>asset</label><span className="small">{c.assetId}</span></div>{num('gain (lin)', 'gain', 0.05, 0, 4)}{num('fade in', 'fadeInSec', 0.05, 0)}{num('fade out', 'fadeOutSec', 0.05, 0)}{num('media off', 'mediaOffsetSec', 0.05, 0)}
        <div className="row"><label>loop</label><input type="checkbox" checked={c.loop} onChange={(e) => upd((x) => { x.loop = e.target.checked; })} /></div></>)}
    </Section>
  );
}
