import { useEffect, useRef, useState } from 'react';
import { Section } from './widgets';
import { useStore } from '../store';
import { getHwStatus, hardwareStats, type Telemetry } from '../runtime/hardware';
import { LEVEL_COLOR, LEVEL_LABEL, MOTORS, TELEMETRY_STALE_MS, motorLevel, outputLevel, worst, type Level } from '../runtime/statusSummary';
import { IncidentLog } from './IncidentLog';
import { transportStats } from '../runtime/transport';
import { videoStats } from '../runtime/videoStatus';
import { outputStatus } from '../runtime/outputStatus';

const COLOR = LEVEL_COLOR, LABEL = LEVEL_LABEL;

function Dot({ level }: { level: Level }) {
  return <span style={{ display: 'inline-block', width: 9, height: 9, borderRadius: 5, background: COLOR[level], marginRight: 6, flex: 'none' }} />;
}
function Badge({ level, text }: { level: Level; text?: string }) {
  return <span style={{ display: 'inline-flex', alignItems: 'center', padding: '1px 7px', borderRadius: 9, border: `1px solid ${COLOR[level]}`, color: COLOR[level], fontSize: 11, whiteSpace: 'nowrap' }}><Dot level={level} />{text ?? LABEL[level]}</span>;
}
function Line({ label, value, level }: { label: string; value: React.ReactNode; level?: Level }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, padding: '3px 0', fontSize: 12 }}>
      <span className="dim">{label}</span>
      <span style={{ color: level ? COLOR[level] : undefined, textAlign: 'right' }}>{value}</span>
    </div>
  );
}
function MotorTable({ rows, tel, fresh }: { rows: number[]; tel: Telemetry | null; fresh: boolean }) {
  return (
    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
      <thead><tr className="dim" style={{ textAlign: 'right' }}>
        <th style={{ textAlign: 'left', fontWeight: 400 }}>모터</th><th style={{ fontWeight: 400 }}>현재</th><th style={{ fontWeight: 400 }}>목표</th><th style={{ fontWeight: 400 }}>오차</th><th style={{ fontWeight: 400 }}>토크</th><th style={{ fontWeight: 400 }}>상태</th>
      </tr></thead>
      <tbody>
        {rows.map((i) => {
          const m = MOTORS[i], { level, note } = motorLevel(tel, fresh, i);
          const present = fresh ? tel?.present[i] : null;
          const goal = fresh && tel?.mode === 'ALL' ? tel.goal[i] : null;
          return (
            <tr key={m.id} title={note} style={{ textAlign: 'right', borderTop: '1px solid rgba(127,127,127,.15)' }}>
              <td style={{ textAlign: 'left', padding: '4px 0' }}><div style={{ display: 'flex', alignItems: 'center' }}><Dot level={level} />ID {m.id} · {m.axis}</div><div className="dim small" style={{ marginLeft: 15 }}>{m.model} · {note}</div></td>
              <td>{present ?? '—'}</td>
              <td>{goal ?? '—'}</td>
              <td>{present != null && goal != null ? present - goal : '—'}</td>
              <td>{fresh && tel ? (tel.torque[i] ? 'ON' : 'off') : '—'}</td>
              <td><Badge level={level} /></td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function EyeGrid({ rows }: { rows: readonly number[] }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(8, 7px)', gap: 1, padding: 3, background: '#111', borderRadius: 3 }}>
      {rows.flatMap((row, r) => Array.from({ length: 8 }, (_, c) => <span key={`${r}-${c}`} style={{ width: 7, height: 7, borderRadius: 1, background: (row >> (7 - c)) & 1 ? '#f2f6ff' : '#2a2d33' }} />))}
    </div>
  );
}

/** Live health of every output: DYNAMIXEL (LIEU body / rail), Arduino eye matrices, monitor video, projector. */
export function StatusTab() {
  const [, setTick] = useState(0);
  const video = useRef({ frames: 0, dropped: 0, at: 0, fps: 0 });
  useEffect(() => {
    const id = window.setInterval(() => {
      const el = videoStats.el, q = el?.getVideoPlaybackQuality?.();
      const now = performance.now(), v = video.current;
      if (q) {
        if (v.at && now - v.at >= 900) { v.fps = Math.round(((q.totalVideoFrames - v.frames) * 1000) / (now - v.at)); v.frames = q.totalVideoFrames; v.at = now; }
        else if (!v.at) { v.frames = q.totalVideoFrames; v.at = now; }
        v.dropped = q.droppedVideoFrames;
      }
      setTick((n) => n + 1);
    }, 500);
    return () => window.clearInterval(id);
  }, []);

  const playing = useStore((s) => s.playing);
  const desired = useStore.getState().evalNow();
  const now = performance.now();
  const hw = getHwStatus(), tel = hw.telemetry, fresh = !!tel && now - tel.at < TELEMETRY_STALE_MS;

  // 1. DYNAMIXEL
  const bodyLevels = [0, 1, 2].map((i) => motorLevel(tel, fresh, i).level), railLevel = motorLevel(tel, fresh, 3).level;
  const linkLevel: Level = !hw.connected ? 'off' : !fresh ? 'bad' : hardwareStats.maxWriteMs > 500 || hardwareStats.readErrors > 0 ? 'warn' : 'ok';
  // 2. Arduino eyes
  const eyeLevels: Level[] = !hw.connected || !fresh ? ['off', 'off'] : tel!.eyes.map((ok) => (ok ? 'ok' : 'bad'));
  const eyesLevel: Level = !hw.connected || !fresh ? 'off' : worst([...eyeLevels, tel!.i2cErrors > 0 ? 'warn' : 'ok']);
  // 3. Monitor video
  const el = videoStats.el, v = video.current;
  const videoPlaying = !!el && !el.paused && el.readyState >= 2;
  const videoLevel: Level = !el ? 'off' : !playing ? 'off' : !videoPlaying ? 'bad' : v.fps < 20 || Math.abs(transportStats.lastVideoErrSec) > 0.25 ? 'warn' : 'ok';
  const monitorWin = outputLevel(outputStatus('monitor'), now, playing);
  // 4. Projector
  const projClip = desired.projector.activeClips[desired.projector.activeClips.length - 1];
  const projShould = playing && !!projClip && desired.projector.opacity > 0.01;
  const projWin = outputLevel(outputStatus('projector'), now, projShould);

  const summary: [string, Level][] = [
    ['LIEU 모터 (ID1·2·3)', worst(bodyLevels)], ['레일 모터 (ID4)', railLevel], ['눈 LED (Arduino)', eyesLevel], ['모니터 영상', worst([videoLevel, monitorWin.level === 'off' ? 'off' : monitorWin.level])], ['빔프로젝터', projWin.level],
  ];

  return (
    <div>
      <Section title="한눈에 보기" right={<span className="dim small">0.5초마다 갱신</span>}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {summary.map(([name, level]) => <span key={name} style={{ display: 'inline-flex', alignItems: 'center', padding: '4px 9px', borderRadius: 7, border: `1px solid ${COLOR[level]}`, fontSize: 12 }}><Dot level={level} />{name}</span>)}
        </div>
        <Line label="보드 연결 (UNO R4 · COM)" value={!hw.connected ? '연결 안 됨' : fresh ? `연결됨 · ${tel!.mode === 'ALL' ? '타임라인 준비됨' : tel!.mode === 'SINGLE' ? '한 축 조작 중' : '토크 꺼짐(대기)'}` : '연결됨 · 보드 응답 없음'} level={linkLevel} />
        <Line label="마지막 메시지" value={hw.message} />
      </Section>

      <IncidentLog />

      <Section title="1-A. 다이나믹셀 · LIEU 본체 (ID 1·2·3)" right={<Badge level={worst(bodyLevels)} />}>
        <MotorTable rows={[0, 1, 2]} tel={tel} fresh={fresh} />
      </Section>
      <Section title="1-B. 다이나믹셀 · 천장 레일 (ID 4)" right={<Badge level={railLevel} />}>
        <MotorTable rows={[3]} tel={tel} fresh={fresh} />
      </Section>
      <Section title="다이나믹셀 통신 (Sync Write 스트림)" right={<Badge level={linkLevel} />}>
        <Line label="보낸 모션 프레임 / 건너뜀" value={`${hardwareStats.framesSent} / ${hardwareStats.framesSkipped}`} level={hardwareStats.framesSkipped > hardwareStats.framesSent * 0.1 ? 'warn' : undefined} />
        <Line label="마지막 모션 프레임" value={hardwareStats.lastFrameAt ? `${((now - hardwareStats.lastFrameAt) / 1000).toFixed(1)}초 전` : '—'} level={playing && hw.playbackArmed && now - hardwareStats.lastFrameAt > 1000 ? 'bad' : undefined} />
        <Line label="송신 시간 (최근 / 최대)" value={`${Math.round(hardwareStats.lastWriteMs)} / ${Math.round(hardwareStats.maxWriteMs)} ms`} level={hardwareStats.maxWriteMs > 500 ? 'warn' : undefined} />
        <Line label="마지막 토크 해제 이유" value={hardwareStats.lastRelease || '—'} level={hardwareStats.lastRelease && hardwareStats.lastRelease !== 'host-off' && !hardwareStats.lastRelease.startsWith('pre-arm') ? 'warn' : undefined} />
        <Line label="자동 재준비 · 수신 오류" value={`${hardwareStats.autoRearms} · ${hardwareStats.readErrors}`} level={hardwareStats.autoRearms || hardwareStats.readErrors ? 'warn' : undefined} />
        <Line label="깨진 명령 줄 (보드 기준)" value={fresh ? tel!.badLines : '—'} level={fresh && tel!.badLines > 0 ? 'warn' : undefined} />
      </Section>

      <Section title="2. 눈 LED 8×8 매트릭스 ×2 (Arduino · HT16K33)" right={<Badge level={eyesLevel} />}>
        <div style={{ display: 'flex', gap: 14, alignItems: 'center', margin: '4px 0 6px' }}>
          {(['왼쪽 눈 0x70', '오른쪽 눈 0x71'] as const).map((name, i) => (
            <div key={name} style={{ display: 'flex', gap: 7, alignItems: 'center' }}>
              <EyeGrid rows={i === 0 ? desired.eyes.left : desired.eyes.right} />
              <div style={{ fontSize: 12 }}><div style={{ display: 'flex', alignItems: 'center' }}><Dot level={eyeLevels[i]} />{name}</div><div className="dim small">{!hw.connected || !fresh ? '보고 없음' : tel!.eyes[i] ? 'I2C 응답함' : 'I2C 응답 없음 (배선·주소 확인)'}</div></div>
            </div>
          ))}
        </div>
        <Line label="눈·링 신호 수신 중" value={fresh ? (tel!.lightsActive ? '예 (타임라인 표시 중)' : '아니오 (기본 눈)') : '—'} level={fresh && playing && !tel!.lightsActive ? 'warn' : undefined} />
        <Line label="I2C 오류 (누적)" value={fresh ? tel!.i2cErrors : '—'} level={fresh && tel!.i2cErrors > 0 ? 'warn' : undefined} />
        <Line label="밝기 (왼 / 오)" value={`${Math.round(desired.eyes.leftIntensity * 100)}% / ${Math.round(desired.eyes.rightIntensity * 100)}%`} />
      </Section>

      <Section title="3. 모니터 영상 (승객 TV)" right={<Badge level={worst([videoLevel, monitorWin.level])} />}>
        <Line label="영상 파일" value={videoStats.src ? videoStats.src.split('/').pop() : '—'} />
        <Line label="지금 화면의 영상 프레임" value={videoStats.frame != null ? `${videoStats.frame} (원본 ${videoStats.fps}fps)` : '—'} />
        <Line label="재생 상태" value={!el ? '영상 없음' : `${videoPlaying ? '재생 중' : el.paused ? '정지' : '버퍼링'} · ${el.currentTime.toFixed(2)}s · ×${el.playbackRate.toFixed(2)}`} level={playing && el && !videoPlaying ? 'bad' : undefined} />
        <Line label="디코드 프레임 (측정)" value={el ? `${v.fps} fps` : '—'} level={playing && el && v.fps < 20 ? 'warn' : undefined} />
        <Line label="버린 프레임 (누적)" value={el ? v.dropped : '—'} level={v.dropped > 30 ? 'warn' : undefined} />
        <Line label="재동기 seek (누적)" value={videoStats.seeks} level={videoStats.seeks > 2 ? 'warn' : undefined} />
        <Line label="영상 ↔ 타임라인 차이" value={`${transportStats.lastVideoErrSec.toFixed(3)} s (최악 ${transportStats.worstVideoLagSec.toFixed(2)})`} level={Math.abs(transportStats.lastVideoErrSec) > 0.25 ? 'warn' : undefined} />
        <Line label="TV 창" value={monitorWin.text} level={monitorWin.level} />
      </Section>

      <Section title="4. 빔프로젝터 영상" right={<Badge level={projWin.level} />}>
        <Line label="지금 나와야 할 장면" value={projClip ? `${projClip.assetId.split('/').pop()} · ${Math.round(desired.projector.opacity * 100)}%` : '없음 (검은 화면)'} />
        <Line label="프로젝터 창" value={projWin.text} level={projWin.level} />
        <Line label="창에 표시 중인 것" value={outputStatus('projector')?.detail ?? '—'} />
        {outputStatus('projector')?.videoDropped != null && <Line label="버린 프레임 (프로젝터 영상)" value={outputStatus('projector')!.videoDropped!} />}
      </Section>
    </div>
  );
}
