import { useEffect, useRef, useState } from 'react';
import { SceneTree } from './ui/SceneTree';
import { Viewport } from './ui/Viewport';
import { Inspector } from './ui/Inspector';
import { Timeline } from './ui/Timeline';
import { Dialogs } from './ui/Dialogs';
import { confirmDialog, openHelp, toast, toggleParts, useUi } from './ui/ui-store';
import { useStore } from './store';
import { HardwareMenu } from './ui/Hardware';
import { autoConnectHw } from './runtime/hardware';
import { startProjectorBroadcast, openProjectorWindow } from './runtime/projectorOut';
import { startTransport } from './runtime/transport';
import { startAutosave, readAutosave } from './runtime/autosave';
import { unlockAudio } from './runtime/audio';
import { validateSequence } from './engine/project';
import { emptySequence } from './engine/edit';
import { Menu, MenuItem, MenuSep, MenuKeep } from './ui/Menu';
import { ExportDialog } from './ui/ExportDialog';
import { openExport } from './ui/exportUi';
import { GROUPS, SCENARIOS, PRESET_IDS, scenarioOf } from './scenarios';

/** Scenario switcher: the button shows what is open now; the list is grouped by purpose, the sequence name can be edited at the bottom. */
function ScenarioMenu({ onPick }: { onPick: (id: string) => void }) {
  const cur = useStore((s) => s.seq.id), title = useStore((s) => s.seq.title);
  const patchSeq = useStore((s) => s.patchSeq);
  const info = scenarioOf(cur);
  return (
    <Menu className="ico scn" width={360} title="시나리오 전환 · Load a scenario"
      label={<><span className="scnnum">{info ? cur.slice(0, 2) : '··'}</span><span className="scntxt">{title || '이름 없음'}</span></>}>
      {GROUPS.map((g) => (
        <div key={g.key} className="exgroup">
          <div className="exhead" title={g.note}><b>{g.title}</b><span>{g.en}</span></div>
          {SCENARIOS.filter((x) => x.group === g.key).map((x) => (
            <button key={x.id} role="menuitem" className={'exitem' + (x.id === cur ? ' cur' : '')} onClick={() => onPick(x.id)}>
              <span className="exnum">{x.id.slice(0, 2)}</span>
              <span className="extxt"><b>{x.label}</b><small>{x.desc}</small></span>
            </button>
          ))}
        </div>
      ))}
      <MenuSep />
      <MenuKeep>
        <label className="exname"><span>이름 (저장 파일명)</span>
          <input type="text" value={title} placeholder="Sequence name" onChange={(e) => patchSeq((q) => { q.title = e.target.value; }, 'title')} />
        </label>
      </MenuKeep>
    </Menu>
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
  const canUndo = useStore((s) => s.past.length > 0), canRedo = useStore((s) => s.future.length > 0);
  const { savedAt, saving, parts } = useUi();
  const fileRef = useRef<HTMLInputElement>(null);

  const openFile = async (f: File) => {
    if (!(await confirmDiscard('Open file'))) return;
    try { await useStore.getState().importFile(f.name, await f.arrayBuffer()); toast(`Loaded: ${f.name}`, 'ok'); }
    catch (x) { toast(`Cannot open file: ${String(x).replace(/^.*Error: /, '')}`, 'warn', 6000); }
  };

  return (
    <div className="top">
      <h1 title="LIEU Sequence Editor">LIEU</h1>
      <div className="grp">
        <ScenarioMenu onPick={async (id) => {
          if (!(await confirmDiscard('Load scenario'))) return;
          try { await loadPresetData(id); toast(`Loaded scenario: ${scenarioOf(id)?.label}`, 'ok'); } catch (x) { toast(String(x), 'warn'); }
        }} />
      </div>
      <div className="grp">
        <Menu label="파일" title="파일 · File">
          <MenuItem onClick={() => void newSequence()}>새로 만들기</MenuItem>
          <MenuItem onClick={() => fileRef.current?.click()}>열기…</MenuItem>
          <MenuSep />
          <MenuItem onClick={saveJson} hint="⌘S">저장 (.lieu.json)</MenuItem>
          <MenuItem onClick={async () => {
            const s = useStore.getState(); const name = `${slug(s.seq.title)}.lieu.zip`;
            download(name, (await s.exportZip()) as BlobPart, 'application/zip'); toast(`Saved as ZIP → ${name}`, 'ok');
          }}>ZIP으로 저장 (업로드한 이미지·소리 포함)</MenuItem>
        </Menu>
        <input ref={fileRef} type="file" hidden accept=".json,.zip" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void openFile(f); }} />
        <button className="ico" onClick={() => useStore.getState().undo()} disabled={!canUndo} title="되돌리기 — Ctrl/⌘+Z">↶ 되돌리기</button>
        <button className="ico" onClick={() => useStore.getState().redo()} disabled={!canRedo} title="다시 실행 — Ctrl/⌘+Shift+Z">↷ 다시</button>
      </div>
      <span className="sp" />
      <span className={'savestate' + (saving ? ' busy' : '')} title="작업 내용은 이 브라우저에 자동 저장됩니다 (업로드한 미디어 제외)">
        {saving ? '저장 중…' : savedAt ? `자동 저장 ${timeLabel(savedAt)}` : '자동 저장 켜짐'}
      </span>
      <span className="badge preview" title="실물 로봇(모터·LED·눈·프로젝터)에는 아무 명령도 보내지 않는 미리보기입니다">PREVIEW ONLY</span>
      <div className="grp out">
        <HardwareMenu />
        <button className="ico" onClick={() => void openProjectorWindow()} title="프로젝터 화면을 두 번째 모니터용 별도 창으로 엽니다 (편집기는 그대로)">프로젝터 창</button>
        <button className="ico cta" onClick={openExport} title="현재 시나리오를 16:9 MP4로 내보내기 — 세로 클로즈업 + 4개 시점">영상 내보내기</button>
      </div>
      <div className="grp">
        <button className="ico" onClick={onPresent} title="편집기를 숨기고 재생 화면만 보기">▶ 발표 모드</button>
        <button className={'ico' + (parts ? ' on' : '')} onClick={toggleParts} title="파트 목록: 부품을 보고, 각 부품이 어느 스테이지에 속하는지 바꿉니다">파트</button>
        <button className="ico" onClick={openHelp} title="사용법과 단축키 (?)">? 도움말</button>
      </div>
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
    startProjectorBroadcast();
    void autoConnectHw();
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
      else if (!typing && (e.key === '?' || (e.key === '/' && e.shiftKey))) { e.preventDefault(); openHelp(); }
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
      <ExportDialog />
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
