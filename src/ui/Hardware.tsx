import { useSyncExternalStore } from 'react';
import { armHardwarePlayback, connectHw, disconnectHw, getHwStatus, hwSupported, offHardware, subscribeHw, type SafeAxis } from '../runtime/hardware';
import { Menu, MenuKeep } from './Menu';
import { useStore } from '../store';
import { unlockAudio } from '../runtime/audio';

const LABEL: Record<SafeAxis, string> = { yaw: 'Yaw', tilt: 'Tilt', body: 'Body', rail: 'Rail' };

export function HardwareModeBadge() {
  const state = useSyncExternalStore(subscribeHw, getHwStatus);
  if (!state.connected) return <span className="badge hardware locked">OUTPUT LOCKED</span>;
  const active = state.activeAxis || state.playbackArmed;
  return <button className={'badge hardware ' + (active ? 'active' : 'locked')} onClick={() => void offHardware()} title="즉시 전체 토크 OFF">
    {state.playbackArmed ? 'TIMELINE READY · OFF' : state.activeAxis ? `${state.activeAxis.toUpperCase()} ACTIVE · OFF` : 'HW SAFE · LOCKED'}
  </button>;
}

function AxisReadout({ axis }: { axis: SafeAxis }) {
  const state = useSyncExternalStore(subscribeHw, getHwStatus);
  return (
    <div className="mcard">
      <div className="mhead"><b>{LABEL[axis]}</b><span>raw {state.raw[axis] ?? '—'}</span></div>
      <small>4축 Sync Write</small>
    </div>
  );
}

export function HardwareMenu() {
  const state = useSyncExternalStore(subscribeHw, getHwStatus);
  const supported = hwSupported();
  const playing = useStore((store) => store.playing);
  const tSec = useStore((store) => store.tSec);
  return (
    <Menu label="하드웨어" title="UNO R4 안전 제어" align="right" width={468}>
      <MenuKeep>
        <div className="hwpanel">
          <section className="hwstep current">
            <div className="hwstephead"><span className="hwstepnum">7</span><div><b>Stage 7 동기 제어</b><small>{state.message}</small></div></div>
            {!supported && <p className="hwwarn">이 브라우저는 USB 시리얼 연결을 지원하지 않습니다. Chrome 또는 Edge에서 이 주소를 열어주세요.</p>}
            {!state.connected ? <button className="hwprimary" disabled={!supported || state.busy} onClick={() => void connectHw()}>{state.busy ? '연결 중…' : supported ? 'UNO R4 연결' : 'Chrome/Edge 필요'}</button>
              : <button className="linkbtn" onClick={() => void disconnectHw()}>연결 해제</button>}
          </section>
          {state.connected && <section className="hwstep current">
            <div className="hwstephead"><span className="hwstepnum">▶</span><div><b>4축 타임라인</b><small>실측 전체 좌표를 4축 Sync Write로 동시에 전송합니다.</small></div></div>
            {state.playbackArmed
              ? <button className="estop wide" onClick={() => void offHardware()}>4축 타임라인 OFF</button>
              : <button className="hwprimary wide" disabled={!!state.activeAxis} onClick={() => void armHardwarePlayback()}>4축 타임라인 준비</button>}
            <div className="hwtransport">
              <button onClick={() => useStore.getState().stop()}>■ 0초로 이동</button>
              <button className="hwprimary" disabled={!state.playbackArmed || playing} onClick={() => { unlockAudio(); useStore.getState().play(); }}>▶ 재생</button>
              <button disabled={!playing} onClick={() => useStore.getState().pause()}>❚❚ 일시정지</button>
              <span>{tSec.toFixed(1)}초</span>
            </div>
          </section>}
          <section className="hwstep motors">
            {(['yaw', 'tilt', 'body', 'rail'] as SafeAxis[]).map((axis) => <AxisReadout key={axis} axis={axis} />)}
            <p className="hwwarn">모든 동작 프레임은 4축 Sync Write로 동시에 전송됩니다. 창이 숨겨지거나 heartbeat가 750ms 끊기면 전체 토크가 해제됩니다.</p>
          </section>
        </div>
      </MenuKeep>
    </Menu>
  );
}
