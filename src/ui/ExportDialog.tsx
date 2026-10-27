import { useEffect, useRef, useState } from 'react';
import { useStore } from '../store';
import { toast } from './ui-store';
import { useExp } from './exportUi';
import { exportFileName, exportMultiViewMp4 } from '../runtime/videoExport';
import { layout, views, SIZES, type SizeKey } from '../runtime/exportViews';

const MM = (t: number) => `${Math.floor(t / 60)}:${String(Math.round(t % 60)).padStart(2, '0')}`;

/** Little diagram of the video layout: tall close-up on the left, four views in a 2x2 beside it. */
function LayoutMap({ size }: { size: SizeKey }) {
  const L = layout(size), vs = views(size), s = 100 / L.w;
  return (
    <div className="expmap" style={{ aspectRatio: '16 / 9' }}>
      {vs.map((v) => (
        <div key={v.id} className={'expcell' + (v.id === 'closeup' ? ' tall' : '')} style={{ left: v.rect.x * s + '%', top: (v.rect.y / L.h) * 100 + '%', width: v.rect.w * s + '%', height: (v.rect.h / L.h) * 100 + '%' }}>
          <b>{v.label}</b><small>{v.sub}</small>
        </div>
      ))}
      <div className="expbar" style={{ left: L.barRect.x * s + '%', top: (L.barRect.y / L.h) * 100 + '%', width: L.barRect.w * s + '%', height: (L.barRect.h / L.h) * 100 + '%' }}>title · scene · time</div>
    </div>
  );
}

export function ExportDialog() {
  const open = useExp((s) => s.open);
  const seq = useStore((s) => s.seq);
  const [size, setSize] = useState<SizeKey>('1080p');
  const [audio, setAudio] = useState(true);
  const [busy, setBusy] = useState(false);
  const [prog, setProg] = useState({ p: 0, phase: '' });
  const sig = useRef({ cancelled: false });
  const prev = useRef<HTMLCanvasElement>(null);
  const started = useRef(0);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) useExp.setState({ open: false }); };
    window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey);
  }, [open, busy]);
  if (!open) return null;
  const name = exportFileName(seq, size);
  const start = async () => {
    sig.current = { cancelled: false }; setBusy(true); setProg({ p: 0, phase: 'Preparing' }); started.current = performance.now();
    try {
      const blob = await exportMultiViewMp4({ size, audio, preview: prev.current, signal: sig.current, onProgress: (p, phase) => setProg({ p, phase }) });
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      toast(`Exported → ${name} (${(blob.size / 1048576).toFixed(1)} MB, check your Downloads folder)`, 'ok', 6000);
      useExp.setState({ open: false });
    } catch (x) {
      if (!sig.current.cancelled) toast(`Export failed: ${String((x as Error)?.message ?? x)}`, 'warn', 8000); else toast('Export cancelled', 'info');
    } finally { setBusy(false); }
  };
  const el = (performance.now() - started.current) / 1000, eta = prog.p > 0.03 ? el / prog.p - el : 0;
  return (
    <div className="overlay" onMouseDown={() => { if (!busy) useExp.setState({ open: false }); }}>
      <div className="modal exportdlg" onMouseDown={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <h2>Export video</h2>
        <p className="dim">현재 시나리오를 <b>16:9 MP4</b>로 내보냅니다. 왼쪽은 세로 전체 높이의 클로즈업(정면 · 앙각), 오른쪽은 4개의 다른 시점입니다.</p>
        <LayoutMap size={size} />
        {!busy ? (
          <>
            <div className="exprow">
              <label>Size<select value={size} onChange={(e) => setSize(e.target.value as SizeKey)}>{(Object.keys(SIZES) as SizeKey[]).map((k) => <option key={k} value={k}>{SIZES[k].w} × {SIZES[k].h} ({k})</option>)}</select></label>
              <label className="chk"><input type="checkbox" checked={audio} onChange={(e) => setAudio(e.target.checked)} />Include sound</label>
            </div>
            <div className="expfile"><span>File</span><code>{name}</code></div>
            <p className="dim small">{seq.title} · {MM(seq.durationSec)} · 30 fps · 1× speed. 렌더링은 영상 길이의 절반~1배 정도 걸리고(컴퓨터에 따라 다름), 끝나면 자동으로 다운로드됩니다. 진행 중에는 이 탭을 닫지 마세요.</p>
            <div className="modal-actions"><button onClick={() => useExp.setState({ open: false })}>Cancel</button><button className="on" autoFocus onClick={() => void start()}>Export MP4</button></div>
          </>
        ) : (
          <>
            <canvas ref={prev} className="expprev" width={640} height={360} />
            <div className="expbarwrap"><div style={{ width: Math.round(prog.p * 100) + '%' }} /></div>
            <div className="expstat"><span>{prog.phase}</span><span>{Math.round(prog.p * 100)}%{eta > 1 ? ` · about ${Math.ceil(eta)}s left` : ''}</span></div>
            <div className="modal-actions"><button onClick={() => { sig.current.cancelled = true; }}>Cancel</button></div>
          </>
        )}
      </div>
    </div>
  );
}
