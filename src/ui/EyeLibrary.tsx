import { useEffect, useRef, useState } from 'react';
import { useStore } from '../store';
import { Section } from './widgets';
import { setEyeBitmap } from '../engine/edit';
import { ASSETS, ASSET_BY_ID, newBlock, totalMs, type Asset } from '../eyestudio/assets';
import { bakeKeys, eyesAt, projectOf } from '../eyestudio/bake';
import { load } from './EyeStudio';

const GROUPS: Asset['group'][] = ['감정', '동작', '시선', '이모지'];
const GROUP_EN: Record<Asset['group'], string> = { 감정: 'Moods', 동작: 'Actions', 시선: 'Gaze', 이모지: 'Symbols' };

/** The whole eye animation library (moods / actions / gaze / symbols) inside the Draw panel: pick one, preview it on the robot, place it at the playhead.
 *  Uses the look settings (pill/round, blend) of the Motion blocks tab so both tabs produce the same keys. */
export function EyeLibrary() {
  const [group, setGroup] = useState<Asset['group']>('감정');
  const [pick, setPick] = useState<string>('mood-default');
  const [secs, setSecs] = useState<number | null>(null);
  const [msg, setMsg] = useState('');
  const timer = useRef(0);
  const a = ASSET_BY_ID[pick];
  const seconds = secs ?? a.seconds;
  const single = () => ({ ...load(), blocks: [{ ...newBlock(pick), seconds }] });

  const stop = () => { cancelAnimationFrame(timer.current); timer.current = 0; useStore.getState().clearLive(); };
  useEffect(() => stop, []); // eslint-disable-line react-hooks/exhaustive-deps
  const preview = (id = pick, sec = seconds) => {
    stop();
    const seq = { ...load(), blocks: [{ ...newBlock(id), seconds: sec }] }, project = projectOf(seq), total = totalMs(seq), t0 = performance.now();
    const tick = () => {
      const tm = performance.now() - t0;
      if (tm >= total) { stop(); return; }
      const p = eyesAt(project, tm);
      useStore.setState((st) => ({ live: { ...st.live, eyeLeft: p.l, eyeRight: p.r } }));
      timer.current = requestAnimationFrame(tick);
    };
    tick();
  };
  const choose = (id: string) => { setPick(id); setSecs(null); preview(id, ASSET_BY_ID[id].seconds); };
  const place = () => {
    stop();
    const { seq: ls, tSec, commit } = useStore.getState();
    const seq = single(), keys = bakeKeys(seq), end = tSec + totalMs(seq) / 1000;
    const clash = [ls.tracks.eyes.left, ls.tracks.eyes.right].reduce((n, tr) => n + tr.keys.filter((k) => k.tSec >= tSec - 1e-6 && k.tSec <= end).length, 0);
    if (clash && !window.confirm(`There are already ${clash} eye keys between ${tSec.toFixed(2)}s and ${end.toFixed(2)}s. Placing will overwrite keys at the same times and mix with the rest. Continue?`)) { setMsg('Cancelled: nothing was placed.'); return; }
    let next = ls;
    for (const k of keys) next = setEyeBitmap(setEyeBitmap(next, 'left', tSec + k.tSec, k.pair.l), 'right', tSec + k.tSec, k.pair.r);
    commit(next, 'eyelib');
    setMsg(`${a.label}: ${keys.length} keys at ${tSec.toFixed(2)}s (${seconds.toFixed(1)}s long).`);
  };

  return (
    <Section title="Animation library · click to preview on the robot">
      <div className="chips" style={{ marginBottom: 6 }}>
        {GROUPS.map((g) => <button key={g} className={group === g ? 'on' : ''} onClick={() => setGroup(g)}>{GROUP_EN[g]}</button>)}
      </div>
      <div className="chips" style={{ maxHeight: 150, overflowY: 'auto' }}>
        {ASSETS.filter((x) => x.group === group).map((x) => <button key={x.id} className={pick === x.id ? 'on' : ''} onClick={() => choose(x.id)}>{x.label}</button>)}
      </div>
      <div className="row" style={{ marginTop: 8 }}>
        <b style={{ fontSize: 12 }}>{a.label}</b><span className="sp" style={{ flex: 1 }} />
        <input type="number" min={a.min} max={a.max} step={0.1} value={seconds} style={{ width: 56 }} onChange={(e) => setSecs(Math.min(a.max, Math.max(a.min, +e.target.value || a.seconds)))} /><span className="dim small">s</span>
        <button onClick={() => preview()}>▶ Preview</button>
        <button onClick={stop}>■</button>
        <button onClick={place} title="Write this animation as eye keys starting at the playhead">+ Place at playhead</button>
      </div>
      {msg && <div className="note">{msg}</div>}
    </Section>
  );
}
