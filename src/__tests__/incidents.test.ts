import { expect, it } from 'vitest';
import { clearIncidents, formatIncident, incidents, reportIncident, setIncidentClock, setIncidentFrame } from '../runtime/incidents';

it('stamps every problem with the timeline time and the video frame on screen', () => {
  clearIncidents();
  setIncidentClock(() => 41.126);
  setIncidentFrame(() => 1234);
  reportIncident('video-seek', '영상이 타임라인보다 +0.62s 어긋나 재탐색');
  setIncidentFrame(() => null);
  reportIncident('board-silent', '2.1s 동안 보고 없음');
  const [seek, silent] = incidents();
  expect(seek).toEqual(expect.objectContaining({ kind: 'video-seek', tSec: 41.126, frame: 1234 }));
  expect(formatIncident(seek)).toBe('f 1234 · 41.13s · 모니터 영상 재탐색 · 영상이 타임라인보다 +0.62s 어긋나 재탐색');
  expect(formatIncident(silent)).toBe('f    - · 41.13s · 보드 응답 없음 · 2.1s 동안 보고 없음');
});
