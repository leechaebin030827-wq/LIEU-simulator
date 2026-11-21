import { useSyncExternalStore } from 'react';
import { Section } from './widgets';
import { INCIDENT_LABEL, clearIncidents, formatIncident, incidents, subscribeIncidents, type IncidentKind } from '../runtime/incidents';

// Problems with the robot link or the board in red, the rest (video/clock hitches) in amber.
const SEVERE = new Set<IncidentKind>(['link-release', 'board-silent', 'video-wait', 'page-stall']);

/** Every hitch, newest first, stamped with the monitor-video frame and timeline time. */
export function IncidentLog() {
  const list = useSyncExternalStore(subscribeIncidents, incidents, incidents);
  const rows = [...list].reverse();
  const copy = () => { void navigator.clipboard?.writeText(list.map(formatIncident).join('\n')); };
  return (
    <Section title={`문제 기록 (${list.length})`} right={<span style={{ display: 'flex', gap: 6 }}>
      <button className="linkbtn" disabled={!list.length} onClick={copy}>복사</button>
      <button className="linkbtn" disabled={!list.length} onClick={clearIncidents}>지우기</button>
    </span>}>
      {!rows.length && <div className="dim small">아직 문제가 없습니다. 재생 중 끊김·지연·오류가 생기면 영상 프레임과 시간이 여기에 남습니다.</div>}
      {rows.length > 0 && <div style={{ maxHeight: 260, overflowY: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead><tr className="dim"><th style={{ textAlign: 'right', fontWeight: 400 }}>영상 프레임</th><th style={{ textAlign: 'right', fontWeight: 400 }}>타임라인</th><th style={{ textAlign: 'left', fontWeight: 400, paddingLeft: 10 }}>무슨 일</th></tr></thead>
          <tbody>
            {rows.map((i) => (
              <tr key={i.id} style={{ borderTop: '1px solid rgba(127,127,127,.15)' }}>
                <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{i.frame ?? '—'}</td>
                <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{i.tSec.toFixed(2)}s</td>
                <td style={{ paddingLeft: 10 }}><span style={{ color: SEVERE.has(i.kind) ? '#f85149' : '#e3a008' }}>{INCIDENT_LABEL[i.kind]}</span>{i.detail && <span className="dim"> · {i.detail}</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>}
    </Section>
  );
}
