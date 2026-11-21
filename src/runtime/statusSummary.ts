import { useStore } from '../store';
import { getHwStatus, hardwareStats, type Telemetry } from './hardware';
import { transportStats } from './transport';
import { videoStats } from './videoStatus';
import { outputStatus, type OutputSeen } from './outputStatus';
import { incidents, formatIncident } from './incidents';

export type Level = 'ok' | 'warn' | 'bad' | 'off';
export const LEVEL_COLOR: Record<Level, string> = { ok: '#3fb950', warn: '#e3a008', bad: '#f85149', off: '#6e7681' };
export const LEVEL_LABEL: Record<Level, string> = { ok: '정상', warn: '주의', bad: '오류', off: '꺼짐' };

/** Calibrated motors in ID order; tracking tolerance mirrors the STAGE7 firmware. */
export const MOTORS = [
  { id: 1, axis: '고개 좌우 (Yaw)', model: 'XC330-T288', tolerance: 1200 },
  { id: 2, axis: '고개 끄덕 (Tilt)', model: 'XM430-W350', tolerance: 100 },
  { id: 3, axis: '몸통 회전 (Body)', model: 'XC330-T288', tolerance: 1200 },
  { id: 4, axis: '천장 레일 (Rail)', model: 'XM430-W350', tolerance: 800 },
];
export const TELEMETRY_STALE_MS = 2000;
const OUTPUT_STALE_MS = 2500;

export const worst = (levels: Level[]): Level => (['bad', 'warn', 'ok', 'off'] as Level[]).find((l) => levels.includes(l)) ?? 'off';

export function motorLevel(tel: Telemetry | null, fresh: boolean, i: number): { level: Level; note: string } {
  if (!tel || !fresh) return { level: 'off', note: '보고 없음' };
  const present = tel.present[i];
  if (present == null) return { level: 'bad', note: '응답 없음 (배선·전원·ID 확인)' };
  if (tel.alert[i]) return { level: 'bad', note: '하드웨어 오류 (과부하·과열·전압)' };
  if (tel.mode === 'ALL' && !tel.torque[i]) return { level: 'bad', note: '토크 꺼짐' };
  if (tel.mode === 'ALL' && Math.abs(present - tel.goal[i]) > MOTORS[i].tolerance) return { level: 'warn', note: '목표를 늦게 따라감' };
  if (tel.mode !== 'ALL') return { level: 'ok', note: '응답함 · 토크 꺼짐(대기)' };
  return { level: 'ok', note: '동작 중' };
}

export function outputLevel(o: OutputSeen | null, now: number, shouldShow: boolean): { level: Level; text: string } {
  if (!o || now - o.at > OUTPUT_STALE_MS) return { level: shouldShow ? 'bad' : 'off', text: '창 닫힘 / 응답 없음' };
  if (shouldShow && !o.showing) return { level: 'warn', text: '창은 열림 · 표시 안 함' };
  if (o.showing && o.fps < 15) return { level: 'warn', text: `표시 느림 ${o.fps} fps` };
  if (!o.fullscreen) return { level: 'warn', text: '전체화면 아님' };
  return { level: o.showing ? 'ok' : 'off', text: o.showing ? `표시 중 ${o.fps} fps` : '대기 (검은 화면)' };
}

/** Measured decode rate of the monitor video, sampled by statusSummary() callers. */
const decode = { frames: 0, at: 0, fps: 0 };
function sampleDecodeFps(now: number) {
  const q = videoStats.el?.getVideoPlaybackQuality?.();
  if (!q) return 0;
  if (!decode.at) { decode.frames = q.totalVideoFrames; decode.at = now; }
  else if (now - decode.at >= 900) { decode.fps = Math.round(((q.totalVideoFrames - decode.frames) * 1000) / (now - decode.at)); decode.frames = q.totalVideoFrames; decode.at = now; }
  return decode.fps;
}

export type Summary = {
  rows: { name: string; level: Level; note: string }[];
  playing: boolean; tSec: number;
  videoFrame: number | null; videoFps: number; decodeFps: number;
  recent: string[];
};

/** One snapshot of every output's health; shared by the 활성상태 tab and the dev monitor overlay. */
export function statusSummary(): Summary {
  const now = performance.now();
  const { playing, tSec } = useStore.getState();
  const desired = useStore.getState().evalNow();
  const hw = getHwStatus(), tel = hw.telemetry, fresh = !!tel && now - tel.at < TELEMETRY_STALE_MS;
  const body = [0, 1, 2].map((i) => motorLevel(tel, fresh, i));
  const rail = motorLevel(tel, fresh, 3);
  const eyesLevel: Level = !hw.connected || !fresh ? 'off' : worst([...tel!.eyes.map((ok): Level => (ok ? 'ok' : 'bad')), tel!.i2cErrors > 0 ? 'warn' : 'ok']);
  const el = videoStats.el, decodeFps = sampleDecodeFps(now);
  const videoPlaying = !!el && !el.paused && el.readyState >= 2;
  const videoLevel: Level = !el || !playing ? 'off' : !videoPlaying ? 'bad' : decodeFps < 20 || Math.abs(transportStats.lastVideoErrSec) > 0.25 ? 'warn' : 'ok';
  const monitorWin = outputLevel(outputStatus('monitor'), now, playing);
  const clip = desired.projector.activeClips[desired.projector.activeClips.length - 1];
  const projWin = outputLevel(outputStatus('projector'), now, playing && !!clip && desired.projector.opacity > 0.01);
  // Armed and playing, but the app has stopped streaming motion: the robot holds still
  // with torque on, which the motor readings alone would show as healthy.
  const motionStalled = playing && fresh && tel!.mode === 'ALL' && now - hardwareStats.lastFrameAt > 1000;
  const bodyLevel = motionStalled ? 'bad' : worst(body.map((b) => b.level));
  return {
    rows: [
      { name: 'LIEU 모터 ID1·2·3', level: bodyLevel, note: !hw.connected ? '연결 안 됨' : !fresh ? '보드 응답 없음' : motionStalled ? '앱이 모션을 안 보냄 (출력 잠김)' : body.find((b) => b.level === bodyLevel)?.note ?? '' },
      { name: '레일 모터 ID4', level: rail.level, note: rail.note },
      { name: '눈 LED (Arduino)', level: eyesLevel, note: !hw.connected || !fresh ? '보고 없음' : tel!.eyes.every(Boolean) ? (tel!.lightsActive ? '표시 중' : '기본 눈') : '매트릭스 응답 없음' },
      { name: '모니터 영상', level: worst([videoLevel, monitorWin.level]), note: `${el ? `${decodeFps}fps 디코드` : '영상 없음'} · TV ${monitorWin.text}` },
      { name: '빔프로젝터', level: projWin.level, note: projWin.text },
    ],
    playing, tSec, videoFrame: videoStats.frame, videoFps: videoStats.fps, decodeFps,
    recent: incidents().slice(-5).reverse().map(formatIncident),
  };
}

// The TV window is a separate page: it reads the editor's snapshot through window.opener.
if (typeof window !== 'undefined') {
  const w = window as Window & { __lieuStats?: Record<string, unknown> };
  w.__lieuStats = { ...(w.__lieuStats ?? {}), summary: statusSummary };
}
