/**
 * Problem log for the 활성상태 tab and the dev monitor overlay: every hitch is stamped
 * with the timeline time and the monitor-video frame on screen at that moment, so a
 * stutter can be traced to an exact frame of the show.
 */
export type IncidentKind =
  | 'clock-slow'      // timeline slowed to let a lagging video catch up
  | 'clock-snap'      // timeline jumped to the video (seek, loop or video far ahead)
  | 'page-stall'      // the page did not tick for a while (main thread busy / hidden)
  | 'video-seek'      // monitor video hard re-seek (drift > 0.5 s)
  | 'video-wait'      // monitor video ran out of data / decoder stalled
  | 'video-drop'      // decoder dropped frames
  | 'link-slow'       // a serial write to the robot took long
  | 'link-release'    // the controller released torque
  | 'link-rearm'      // the app re-armed after a host-silence release
  | 'link-bad-line'   // the controller dropped damaged command lines
  | 'board-silent';   // no status report from the board

export type Incident = { id: number; at: number; tSec: number; frame: number | null; kind: IncidentKind; detail: string };

const MAX = 300;
let nextId = 1;
const log: Incident[] = [];
const listeners = new Set<() => void>();

let timeline: () => number = () => 0;
let videoFrame: () => number | null = () => null;
/** Wired by the transport (timeline time) and the monitor video (frame on screen). */
export const setIncidentClock = (getTime: () => number) => { timeline = getTime; };
export const setIncidentFrame = (getFrame: () => number | null) => { videoFrame = getFrame; };

export function reportIncident(kind: IncidentKind, detail: string) {
  log.push({ id: nextId++, at: performance.now(), tSec: timeline(), frame: videoFrame(), kind, detail });
  if (log.length > MAX) log.splice(0, log.length - MAX);
  listeners.forEach((l) => l());
}
export const incidents = (): readonly Incident[] => log;
export const clearIncidents = () => { log.length = 0; listeners.forEach((l) => l()); };
export const subscribeIncidents = (l: () => void) => { listeners.add(l); return () => listeners.delete(l); };

export const INCIDENT_LABEL: Record<IncidentKind, string> = {
  'clock-slow': '타임라인 감속 (영상 지연)',
  'clock-snap': '타임라인 점프',
  'page-stall': '페이지 멈춤',
  'video-seek': '모니터 영상 재탐색',
  'video-wait': '모니터 영상 버퍼링',
  'video-drop': '모니터 영상 프레임 손실',
  'link-slow': '로봇 송신 지연',
  'link-release': '토크 해제',
  'link-rearm': '자동 재준비',
  'link-bad-line': '깨진 명령 줄',
  'board-silent': '보드 응답 없음',
};

/** One line, e.g. "f 1234 · 41.13s · 모니터 영상 재탐색 · drift +0.62s". */
export const formatIncident = (i: Incident) =>
  `${i.frame != null ? `f ${String(i.frame).padStart(4)}` : 'f    -'} · ${i.tSec.toFixed(2)}s · ${INCIDENT_LABEL[i.kind]}${i.detail ? ` · ${i.detail}` : ''}`;
