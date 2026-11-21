import { useEffect, useState } from 'react';
import { LEVEL_COLOR, type Summary } from '../runtime/statusSummary';

type StatsWindow = Window & { __lieuStats?: { summary?: () => Summary } };

/**
 * Dev-only status readout on the monitor screens (top-right): each output's health,
 * the monitor-video frame on screen, and the latest problems stamped with their
 * frame. `source` is the window that runs the show (this page, or the editor that
 * opened the TV window). Hidden in the exhibition build.
 */
export function DevOverlay({ source }: { source: () => Window | null }) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setTick((n) => n + 1), 250);
    return () => window.clearInterval(id);
  }, []);
  if (!import.meta.env.DEV) return null;
  let s: Summary | undefined;
  try { s = (source() as StatsWindow | null)?.__lieuStats?.summary?.(); } catch { s = undefined; }
  if (!s) return null;
  return (
    <div style={{ position: 'absolute', top: 10, right: 10, zIndex: 50, width: 330, padding: '8px 10px', borderRadius: 4, background: 'rgba(0,0,0,.66)', color: '#e6e6e6', font: '11px/1.45 ui-monospace, Menlo, Consolas, monospace', pointerEvents: 'none' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
        <span>{s.playing ? '▶' : '❚❚'} {s.tSec.toFixed(2)}s</span>
        <span>영상 f {s.videoFrame ?? '-'} · {s.videoFps}fps · 디코드 {s.decodeFps}fps</span>
      </div>
      {s.rows.map((r) => (
        <div key={r.name} style={{ display: 'flex', gap: 6, alignItems: 'baseline' }}>
          <span style={{ width: 8, height: 8, borderRadius: 4, background: LEVEL_COLOR[r.level], flex: 'none', alignSelf: 'center' }} />
          <span style={{ width: 118, flex: 'none' }}>{r.name}</span>
          <span style={{ opacity: 0.75, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.note}</span>
        </div>
      ))}
      {s.recent.length > 0 && <div style={{ marginTop: 5, paddingTop: 4, borderTop: '1px solid rgba(255,255,255,.15)' }}>
        {s.recent.map((line, i) => <div key={i} style={{ color: '#ffb38a', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{line}</div>)}
      </div>}
    </div>
  );
}
