import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../store';
import { Section } from './widgets';
import { setEyeBitmap } from '../engine/edit';
import { ASSETS, ASSET_BY_ID, defaultSequence, newBlock, totalMs, type Asset, type Sequence } from '../eyestudio/assets';
import { buildProject } from '../eyestudio/assets';
import { drawAt } from '../eyestudio/draw';
import { bakeKeys, eyesAt, exportSequenceMp4, mp4Supported, projectOf } from '../eyestudio/bake';

const GROUPS: Asset['group'][] = ['감정', '동작', '시선', '이모지'];
const GROUP_EN: Record<Asset['group'], string> = { 감정: 'Moods', 동작: 'Actions', 시선: 'Gaze', 이모지: 'Symbols' };
const KEY = 'lieu.eyestudio.v3';

export function load(): Sequence {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Sequence | null;
    if (s && Array.isArray(s.blocks)) return { ...defaultSequence(), ...s, blocks: s.blocks.filter((b) => ASSET_BY_ID[b.assetId]) };
  } catch { /* ignore */ }
  return defaultSequence();
}

let raf = 0;
const PREVIEW_W = 320, PREVIEW_H = 160;

/** Block-based eye motion sequencer (ported from Robot_Eye_GUI_Exporter): moods/actions/gaze/symbols -> 8x8 eye keys. */
export function EyeStudio() {
  const [seq, setSeq] = useState<Sequence>(load);
  const [group, setGroup] = useState<Asset['group']>('감정');
  const [sel, setSel] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [width, setWidth] = useState(1280);
  const [fileName, setFileName] = useState(() => { try { return localStorage.getItem(KEY + '.name') ?? 'lieu_eye_motion'; } catch { return 'lieu_eye_motion'; } });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const cv = useRef<HTMLCanvasElement>(null);
  useEffect(() => { try { localStorage.setItem(KEY, JSON.stringify(seq)); } catch { /* ignore */ } }, [seq]);

  const total = totalMs(seq);
  const project = useMemo(() => projectOf(seq), [seq]);
  const fproject = useMemo(() => buildProject(seq), [seq]);
  const drawPreview = (tMs: number) => {
    const c = cv.current?.getContext('2d'); if (!c) return;
    const dpr = 2; c.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawAt(c, PREVIEW_W, PREVIEW_H, fproject, tMs, seq.bg, true);
  };
  useEffect(() => { if (!raf) drawPreview(0); }); // idle: still frame, refreshed on every edit
  const stop = () => { cancelAnimationFrame(raf); raf = 0; setPlaying(false); useStore.getState().clearLive(); };
  useEffect(() => stop, []); // eslint-disable-line react-hooks/exhaustive-deps
  const play = () => {
    stop(); setPlaying(true);
    const t0 = performance.now();
    const tick = () => {
      const tm = (performance.now() - t0) % total;
      drawPreview(tm);
      const p = eyesAt(project, tm);
      useStore.setState((st) => ({ live: { ...st.live, eyeLeft: p.l, eyeRight: p.r } }));
      raf = requestAnimationFrame(tick);
    };
    tick();
  };
  // edits while playing should be heard immediately: restart on project change
  useEffect(() => { if (raf) play(); }, [project]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { if (raf) play(); }, [fproject]); // eslint-disable-line react-hooks/exhaustive-deps
  const patch = (p: Partial<Sequence>) => setSeq((s) => ({ ...s, ...p }));
  const add = (a: Asset) => setSeq((s) => {
    const b = newBlock(a.id), i = s.blocks.findIndex((x) => x.id === sel);
    const blocks = i < 0 ? [...s.blocks, b] : [...s.blocks.slice(0, i + 1), b, ...s.blocks.slice(i + 1)];
    setSel(b.id);
    return { ...s, blocks };
  });
  const move = (i: number, d: number) => setSeq((s) => {
    const blocks = [...s.blocks], j = i + d;
    if (j < 0 || j >= blocks.length) return s;
    [blocks[i], blocks[j]] = [blocks[j], blocks[i]];
    return { ...s, blocks };
  });
  const setSecs = (id: string, v: number) => setSeq((s) => ({ ...s, blocks: s.blocks.map((b) => (b.id === id ? { ...b, seconds: v } : b)) }));
  const remove = (id: string) => setSeq((s) => ({ ...s, blocks: s.blocks.filter((b) => b.id !== id) }));

  const place = () => {
    stop();
    const { seq: ls, tSec, commit } = useStore.getState();
    const keys = bakeKeys(seq);
    const end = tSec + total / 1000;
    const clash = [ls.tracks.eyes.left, ls.tracks.eyes.right].reduce((n, tr) => n + tr.keys.filter((k) => k.tSec >= tSec - 1e-6 && k.tSec <= end).length, 0);
    if (clash && !window.confirm(`There are already ${clash} eye keys between ${tSec.toFixed(2)}s and ${end.toFixed(2)}s (e.g. the scenario's eyes-off keys). Placing will overwrite keys at the same times and mix with the rest. Continue?`)) { setMsg('Cancelled: nothing was placed.'); return; }
    let next = ls;
    for (const k of keys) next = setEyeBitmap(setEyeBitmap(next, 'left', tSec + k.tSec, k.pair.l), 'right', tSec + k.tSec, k.pair.r);
    commit(next, 'eyestudio');
    setMsg(`Placed ${keys.length} eye keys at ${tSec.toFixed(2)}s (${(total / 1000).toFixed(2)}s long).`);
  };
  const outName = (fileName.trim().replace(/\.mp4$/i, '').replace(/[\\/:*?"<>|]/g, '_') || 'lieu_eye_motion') + '.mp4';
  const exportMp4 = async () => {
    setBusy(true); setMsg('Rendering…');
    try {
      const blob = await exportSequenceMp4(seq, width, 30, (p) => setMsg(`Rendering… ${Math.round(p * 100)}%`));
      const picker = (window as unknown as { showSaveFilePicker?: (o: unknown) => Promise<{ name: string; createWritable: () => Promise<{ write: (b: Blob) => Promise<void>; close: () => Promise<void> }> }> }).showSaveFilePicker;
      let saved = outName;
      if (picker) { // Chrome / Edge: native "Save as" dialog, pre-filled with the file name
        try {
          const h = await picker({ suggestedName: outName, types: [{ description: 'MP4 video', accept: { 'video/mp4': ['.mp4'] } }] });
          const w = await h.createWritable(); await w.write(blob); await w.close(); saved = h.name;
        } catch (e) { if ((e as Error).name === 'AbortError') { setMsg('Save cancelled.'); setBusy(false); return; } throw e; }
      } else {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a'); a.href = url; a.download = outName; a.click();
        setTimeout(() => URL.revokeObjectURL(url), 5000);
      }
      setMsg(`Saved ${saved}`);
    } catch (err) { setMsg(`Export failed: ${(err as Error).message}`); }
    setBusy(false);
  };

  return (
    <Section title="Eye motion blocks · sequence / place / export">
      <div className="chips" style={{ marginBottom: 6 }}>
        {GROUPS.map((g) => <button key={g} className={group === g ? 'on' : ''} onClick={() => setGroup(g)}>{GROUP_EN[g]}</button>)}
      </div>
      <div className="chips" style={{ maxHeight: 130, overflowY: 'auto' }}>
        {ASSETS.filter((a) => a.group === group).map((a) => <button key={a.id} title="Add block after the selected one" onClick={() => add(a)}>{a.label}</button>)}
      </div>
      <div style={{ margin: '8px 0', display: 'flex', flexDirection: 'column', gap: 3 }}>
        {seq.blocks.map((b, i) => {
          const a = ASSET_BY_ID[b.assetId];
          return (
            <div key={b.id} className="row" style={{ margin: 0, background: sel === b.id ? 'var(--panel3)' : undefined, padding: '2px 4px', borderRadius: 4 }} onClick={() => setSel(b.id)}>
              <span style={{ flex: 1, fontSize: 12 }}>{a.label}</span>
              <input type="number" min={a.min} max={a.max} step={0.1} value={b.seconds} style={{ width: 56 }} onChange={(e) => setSecs(b.id, Math.min(a.max, Math.max(a.min, +e.target.value || a.seconds)))} />
              <span className="dim small">s</span>
              <button title="Move up" onClick={() => move(i, -1)}>↑</button><button title="Move down" onClick={() => move(i, 1)}>↓</button>
              <button title="Delete" onClick={() => remove(b.id)}>✕</button>
            </div>
          );
        })}
        {!seq.blocks.length && <div className="note">Click assets above to add blocks.</div>}
      </div>
      <div className="row"><label>Look</label>
        <select value={seq.mode} onChange={(e) => patch({ mode: e.target.value as Sequence['mode'] })}><option value="matrix">8×8 matrix</option><option value="halftoneGrid">Dot grid</option><option value="halftone">Dot curve (fine dots)</option><option value="freeform">Freeform (vector)</option></select>
        <select value={seq.shape} onChange={(e) => patch({ shape: e.target.value as Sequence['shape'] })}><option value="round">Round</option><option value="long">Pill 1:2</option></select>
        <input type="color" value={seq.eyeColor} onChange={(e) => patch({ eyeColor: e.target.value })} />
      </div>
      <div className="row"><label>Glow</label><input type="range" min={0} max={200} step={5} value={seq.glow} onChange={(e) => patch({ glow: +e.target.value })} /><span className="dim small">{seq.glow}%</span></div>
      <canvas ref={cv} width={PREVIEW_W * 2} height={PREVIEW_H * 2} style={{ width: '100%', aspectRatio: '2 / 1', borderRadius: 6, background: seq.bg }} />
      <div className="row"><label>Blend</label><input type="range" min={0} max={1200} step={10} value={seq.blend} onChange={(e) => patch({ blend: +e.target.value })} /><span className="dim small">{seq.blend} ms</span></div>
      <div className="row">
        <button onClick={playing ? stop : play}>{playing ? '■ Stop' : '▶ Preview on robot'}</button>
        <button onClick={place}>+ Place keys at playhead</button>
        <button onClick={() => { stop(); setSeq({ ...seq, blocks: [] }); }}>Clear</button>
        <span className="dim small">{(total / 1000).toFixed(1)}s</span>
      </div>
      <div className="row">
        <label>Width</label>
        <select value={width} onChange={(e) => setWidth(+e.target.value)}>{[640, 1280, 1920, 2560].map((w) => <option key={w} value={w}>{w}×{w / 2}</option>)}</select>
        <input type="text" value={fileName} placeholder="file name" style={{ width: 130 }} onChange={(e) => { setFileName(e.target.value); try { localStorage.setItem(KEY + '.name', e.target.value); } catch { /* ignore */ } }} /><span className="dim small">.mp4</span>
      </div>
      <div className="row">
        <button disabled={busy || !mp4Supported() || !seq.blocks.length} onClick={exportMp4}>Export {seq.mode === 'matrix' ? 'B/W' : 'color'} MP4</button>
      </div>
      {msg && <div className="note">{msg}</div>}
      <div className="note">Moods cross-fade at block boundaries, actions start and end at the current gaze, and seeded idle drift + auto-blink run underneath, so the same time always gives the same frame. The robot always shows the 8×8 version (the other looks are preview + MP4 only, since the LEDs are binary). Placing writes hold keys (30 fps, only where a pixel changes) to both eyes. Ported from Robot_Eye_GUI_Exporter (<b>src/eyestudio/</b>).</div>
    </Section>
  );
}
