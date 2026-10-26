import { useEffect, useRef, useState } from 'react';
import { SceneTree } from './ui/SceneTree';
import { Viewport } from './ui/Viewport';
import { Inspector } from './ui/Inspector';
import { Timeline } from './ui/Timeline';
import { Dialogs } from './ui/Dialogs';
import { confirmDialog, openHelp, toast, toggleParts, useUi } from './ui/ui-store';
import { useStore } from './store';
import { startTransport } from './runtime/transport';
import { startAutosave, readAutosave } from './runtime/autosave';
import { unlockAudio } from './runtime/audio';
import { validateSequence } from './engine/project';
import { emptySequence } from './engine/edit';

const PRESETS: [string, string, string][] = [
  ['01_boarding', 'Boarding', '차량 도착 · 환영 · 인사 · 착석 확인 · 출발(빙그르르)'],
  ['02_driving_a', 'Driving A', '공사 감지 · 앞을 살피고 · 돌아와 우회 안내'],
  ['04_driving_b', 'Driving B', 'Hey LIEU 호출 · 애교 총출동'],
  ['03_arrival', 'Arrival', '곧 도착 · 둘러보기 · 작별 인사 · 문 쪽 안내'],
  ['05_web_cover', '웹 모션 - 표지', '호기심 · 상하좌우 시선 · 눈 감기 · 신남 (21s)'],
];

function ExampleMenu({ onPick }: { onPick: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: 0, top: 0 });
  useEffect(() => {
    if (!open) return;
    const off = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('mousedown', off); window.addEventListener('keydown', esc);
    return () => { window.removeEventListener('mousedown', off); window.removeEventListener('keydown', esc); };
  }, [open]);
  return (
    <div className="exmenu" ref={ref}>
      <button className="ico scn" title="Load a scenario" onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); setPos({ left: r.left, top: r.bottom + 6 }); setOpen((o) => !o); }}>Scenarios <span className="caret">▾</span></button>
      {open && (
        <div className="exlist" style={pos}>
          {PRESETS.map(([id, l, d], i) => (
            <button key={id} className="exitem" onClick={() => { setOpen(false); onPick(id); }}>
              <span className="exnum">{String(i + 1).padStart(2, '0')}</span>
              <span className="extxt"><b>{l}</b><small>{d}</small></span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

const timeLabel = (t: number) => new Date(t).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
const slug = (s: string) => (s.trim().replace(/[^\w가-힣.-]+/g, '_') || 'sequence');

async function loadPresetData(id: string) {
  const r = await fetch(`${import.meta.env.BASE_URL}examples/${id}.lieu.json`, { cache: 'no-store' });
  const seq = validateSequence(await r.json());
  const s = useStore.getState();
  for (const c of seq.tracks.projector.clips) s.registerBuiltin(c.assetId);
  for (const c of seq.tracks.audio) s.registerBuiltin(c.assetId);
  s.loadSequence(seq);
}

/** Ask before throwing away edits (anything done since the last load/import). */
async function confirmDiscard(what: string): Promise<boolean> {
  if (!useStore.getState().past.length) return true;
  return confirmDialog(`${what}`, 'Your edits so far will disappear from the screen.\n(Your last work is autosaved in this browser, but saving to a file is recommended.)', 'Continue', true);
}

function download(name: string, data: BlobPart, type: string) {
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([data], { type })); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

const PRESET_IDS = PRESETS.map((p) => p[0]);

async function saveJson() {
  const s = useStore.getState();
  if (PRESET_IDS.includes(s.seq.id)) {
    try {
      const r = await fetch(`/__save-preset?id=${s.seq.id}`, { method: 'POST', body: JSON.stringify(s.seq, null, 2) });
      if (r.ok) { toast(`Saved → preset ${s.seq.id} (examples/${s.seq.id}.lieu.json overwritten)`, 'ok'); return; }
    } catch { /* fall back to file download */ }
  }
  const name = `${slug(s.seq.title)}.lieu.json`;
  download(name, s.exportJson(), 'application/json');
  toast(`Saved → ${name} (check your Downloads folder)`, 'ok');
}

async function newSequence() {
  if (!(await confirmDialog('New sequence', 'Starts an empty sequence with no keyframes or clips.\nYou can undo this with Ctrl/⌘+Z.', 'New sequence', true))) return;
  const st = useStore.getState();
  st.commit(emptySequence('New sequence')); st.setTime(0); st.clearLive();
  toast('Created an empty sequence. Pick a time on the timeline and change values on the right.', 'ok');
}

function TopBar({ onPresent }: { onPresent: () => void }) {
  const title = useStore((s) => s.seq.title);
  const canUndo = useStore((s) => s.past.length > 0), canRedo = useStore((s) => s.future.length > 0);
  const { savedAt, saving, parts } = useUi();
  const fileRef = useRef<HTMLInputElement>(null);
  const patchSeq = useStore((s) => s.patchSeq);

  const openFile = async (f: File) => {
    if (!(await confirmDiscard('Open file'))) return;
    try { await useStore.getState().importFile(f.name, await f.arrayBuffer()); toast(`Loaded: ${f.name}`, 'ok'); }
    catch (x) { toast(`Cannot open file: ${String(x).replace(/^.*Error: /, '')}`, 'warn', 6000); }
  };

  return (
    <div className="top">
      <h1 title="LIEU Sequence Editor">LIEU</h1>
      <div className="grp">
        <button className="ico" title="Clear all keyframes and start an empty sequence" onClick={() => void newSequence()}>New</button>
        <ExampleMenu onPick={async (id) => {
          if (!(await confirmDiscard('Load scenario'))) return;
          try { await loadPresetData(id); toast(`Loaded scenario: ${PRESETS.find((p) => p[0] === id)?.[1]}`, 'ok'); } catch (x) { toast(String(x), 'warn'); }
        }} />
      </div>
      <div className="grp">
        <input type="text" value={title} title="Sequence name (used as the saved file name)" placeholder="Sequence name" onChange={(e) => patchSeq((q) => { q.title = e.target.value; }, 'title')} style={{ width: 190 }} />
      </div>
      <div className="grp">
        <button className="ico" title="Open file (.lieu.json / .zip)" onClick={() => fileRef.current?.click()}>Open</button>
        <input ref={fileRef} type="file" hidden accept=".json,.zip" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void openFile(f); }} />
        <button className="ico" title="Save the current sequence to a file (.lieu.json) — Ctrl/⌘+S" onClick={saveJson}>Save</button>
        <button className="ico" title="Save as .zip, including uploaded images and sounds" onClick={async () => {
          const s = useStore.getState(); const name = `${slug(s.seq.title)}.lieu.zip`;
          download(name, (await s.exportZip()) as BlobPart, 'application/zip'); toast(`Saved as ZIP → ${name}`, 'ok');
        }}>ZIP</button>
      </div>
      <div className="grp">
        <button className="ico" onClick={() => useStore.getState().undo()} disabled={!canUndo} title="Undo — Ctrl/⌘+Z">Undo</button>
        <button className="ico" onClick={() => useStore.getState().redo()} disabled={!canRedo} title="Redo — Ctrl/⌘+Shift+Z">Redo</button>
      </div>
      <span className="sp" />
      <span className={'savestate' + (saving ? ' busy' : '')} title="Work is autosaved in this browser (uploaded media excluded)">
        {saving ? 'Saving…' : savedAt ? `Autosaved ${timeLabel(savedAt)}` : 'Autosave on'}
      </span>
      <span className="badge preview" title="No commands are sent to the real robot (motors, LEDs, eyes, projector)">PREVIEW ONLY</span>
      <button className="ico" onClick={onPresent} title="Hide the editor and show only the playback view">▶ Present</button>
      <button className={'ico' + (parts ? ' on' : '')} onClick={toggleParts} title="Open the parts list (Scene / Rig): see parts and change which stage each belongs to">Parts ▾</button>
      <button className="ico" onClick={openHelp} title="How to use and keyboard shortcuts">? Help</button>
    </div>
  );
}

export function App() {
  const [tlH, setTlH] = useState(226);
  const [vpW, setVpW] = useState<number | null>(null);
  const showParts = useUi((s) => s.parts);
  const [present, setPresent] = useState(false);

  useEffect(() => {
    startTransport();
    if ((window as unknown as { __lieuInit?: boolean }).__lieuInit) return;
    (window as unknown as { __lieuInit?: boolean }).__lieuInit = true;
    (async () => {
      const saved = readAutosave();
      let restored = false;
      if (saved) {
        try {
          await useStore.getState().importFile('autosave.lieu.json', new TextEncoder().encode(saved.json).buffer as ArrayBuffer);
          toast(`Restored previous work (${timeLabel(saved.savedAt)}). To start over, press 'New'.`, 'ok', 6000);
          restored = true;
        } catch { /* fall through to preset */ }
      }
      if (!restored) await loadPresetData('01_boarding');
      startAutosave();
    })();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (useUi.getState().dialog || useUi.getState().help) return;
      const tag = (e.target as HTMLElement)?.tagName; const typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
      const s = useStore.getState();
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); saveJson(); }
      else if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? s.redo() : s.undo(); }
      else if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); s.redo(); }
      else if (!typing && e.code === 'Space') { e.preventDefault(); unlockAudio(); s.playing ? s.pause() : s.play(); }
      else if (!typing && e.key === 'ArrowLeft') s.setTime(s.tSec - 1 / 30);
      else if (!typing && e.key === 'ArrowRight') s.setTime(s.tSec + 1 / 30);
      else if (e.key === 'Escape') { setPresent(false); useUi.setState({ parts: false }); }
    };
    window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey);
  }, []);

  /** Drag a splitter: `apply` gets the pointer delta from where the drag started. The page is locked to the resize cursor meanwhile. */
  const drag = (e: React.MouseEvent, cls: 'rs-col' | 'rs-row', apply: (dx: number, dy: number) => void) => {
    e.preventDefault();
    const x0 = e.clientX, y0 = e.clientY;
    document.body.classList.add('resizing', cls);
    const mv = (ev: MouseEvent) => apply(ev.clientX - x0, ev.clientY - y0);
    const up = () => { document.body.classList.remove('resizing', cls); window.removeEventListener('mousemove', mv); window.removeEventListener('mouseup', up); };
    window.addEventListener('mousemove', mv); window.addEventListener('mouseup', up);
  };
  const startResize = (e: React.MouseEvent) => {
    const h0 = tlH;
    drag(e, 'rs-row', (_dx, dy) => setTlH(Math.max(120, Math.min(window.innerHeight - 200, h0 - dy))));
  };
  const startVResize = (e: React.MouseEvent) => {
    const w0 = vpW ?? Math.round(window.innerWidth * 0.4);
    drag(e, 'rs-col', (dx) => setVpW(Math.max(280, Math.min(window.innerWidth - 520, w0 + dx))));
  };

  return (
    <>
      <div className={'app' + (present ? ' present' : '')} style={{ ['--tl-h' as string]: tlH + 'px', ...(vpW ? { ['--vp-w' as string]: vpW + 'px' } : {}) }}>
        <TopBar onPresent={() => setPresent(true)} />
        <Viewport />
        <div className="vsplit" onMouseDown={startVResize} title="Drag to resize the 3D view" />
        <div className="work">
          <Inspector />
          <div className="resizer" onMouseDown={startResize} onDoubleClick={() => setTlH((h) => (h > 200 ? 130 : 320))} title="Drag to resize the timeline · double-click to collapse / restore" />
          <Timeline />
        </div>
        {showParts && !present && <div className="treepop"><SceneTree /></div>}
        <div className="presentbar"><PresentBar onExit={() => setPresent(false)} /></div>
      </div>
      <Dialogs />
    </>
  );
}

function PresentBar({ onExit }: { onExit: () => void }) {
  const playing = useStore((s) => s.playing), t = useStore((s) => s.tSec), dur = useStore((s) => s.seq.durationSec);
  const s = useStore.getState();
  return (
    <>
      <button className={'playbtn' + (playing ? ' on' : '')} onClick={() => { unlockAudio(); playing ? s.pause() : s.play(); }}>{playing ? '❚❚ Pause' : '▶ Play'}</button>
      <button onClick={() => useStore.getState().stop()}>■ Stop</button>
      <span>{t.toFixed(2)} / {dur}s</span><span style={{ flex: 1 }} />
      <span className="badge preview">PREVIEW ONLY</span><button onClick={onExit}>Back to editing (Esc)</button>
    </>
  );
}
