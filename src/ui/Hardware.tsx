import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useStore } from '../store';
import { TILT_MOTOR, YAW_MOTOR, planAt, planYaw } from '../engine/motorPlan';
import { getMotorStatus, isFollowing, motorAct, motorBridgeUp, motorGoto, startFollow, startMotorPolling, stopFollow, stopMotorPolling, subscribeMotor, type Axis } from '../runtime/motor';
import { toast } from './ui-store';
import { connectHw, disconnectHw, getHwSettings, getHwStatus, hwSupported, probeEye, requestInfo, setHwSettings, subscribeHw, type EyeLayout } from '../runtime/hardware';

const useHw = () => {
  useSyncExternalStore(subscribeHw, () => getHwStatus().frames + getHwStatus().message + getHwStatus().connected + JSON.stringify(getHwSettings()));
  return { st: getHwStatus(), cfg: getHwSettings() };
};

/** Live yaw motor panel. Talks to the local bridge only; every move is slow and limited there. */
/** One motor, one big button. The button does whatever the next step is: switch the motor on (after a confirmation), connect it to the slider, or stop. */
function MotorCard({ axis }: { axis: Axis }) {
  useSyncExternalStore(subscribeMotor, () => JSON.stringify(getMotorStatus(axis)) + isFollowing(axis));
  useEffect(() => { startMotorPolling(); return stopMotorPolling; }, []);
  const m = getMotorStatus(axis), up = motorBridgeUp(), found = up && m.ok, armed = !!m.torque && m.mode === 4 && !!m.profile_ok, on = isFollowing(axis);
  const name = axis === 'yaw' ? 'Yaw · 좌우 회전' : 'Tilt · 끄덕임', lim = m.limit_deg ?? (axis === 'yaw' ? YAW_MOTOR.limitDeg : TILT_MOTOR.limitDeg);
  const say = async (p: Promise<{ ok: boolean; error?: string }>) => { const r = await p; if (!r.ok) toast(`모터: ${r.error ?? '거부됨'}`, 'warn'); return r.ok; };
  const state = !up ? ['off', '브릿지 꺼짐'] : !found ? ['off', '모터 찾는 중…'] : m.fault ? ['err', `오류: ${m.fault}`] : on ? ['on', `실물이 따라가는 중 · ${m.deg}°`] : armed ? ['ready', `준비됨 (토크 켜짐) · ${m.deg}°`] : ['off', `꺼짐 · 손으로 움직일 수 있음 · ${m.deg ?? '?'}°`];
  const start = async () => {
    if (!armed || m.needs_front) {
      const ask = m.needs_front
        ? '로봇이 지금 정확히 정면(0°)을 보고 있나요?\n\n현재 위치를 0°로 저장하고 토크를 켭니다. 켜지면 손으로 돌릴 수 없고, 스스로 움직이지는 않습니다.\n주변이 비었고 모터 전원에 손이 닿나요?'
        : `${axis === 'yaw' ? 'Yaw' : 'Tilt'} 모터의 토크를 켭니다. 켜지면 손으로 돌릴 수 없고, 스스로 움직이지는 않습니다. (최대 ±${lim}°, ${m.max_vel}°/s)\n주변이 비었고 모터 전원에 손이 닿나요?`;
      if (!window.confirm(ask)) return;
      if (!(await say(motorAct(m.needs_front ? 'setup' : 'arm', axis)))) return;
    }
    void startFollow(axis);
  };
  const label = m.fault ? '오류 해제' : on ? '■ 정지' : armed ? '▶ 슬라이더와 연결' : m.needs_front ? '▶ 정면을 맞췄어요 · 시작' : '▶ 시작 (토크 켜기)';
  return (
    <div className="mcard">
      <div className="mhead"><b>{name}</b><span className={'mdot ' + state[0]} />{state[1]}</div>
      {found && (
        <>
          <button className={'hwbig' + (on ? ' stop' : '')} onClick={() => (m.fault ? void motorAct('clear', axis) : on ? stopFollow(axis) : void start())}>{label}</button>
          {axis === 'yaw' && m.needs_front && <small className="hwwarn">먼저 로봇을 손으로 돌려서 정면을 보게 하세요. (모터 전원이 껐다 켜지면 정면을 다시 알려줘야 해요)</small>}
          <div className="mlinks">
            <button className="linkbtn" disabled={!m.torque} onClick={() => void say(motorAct('release', axis))}>토크 끄기 (손으로 움직이기)</button>
            <button className="linkbtn" disabled={!armed || on} onClick={() => void say(motorGoto(0, axis))}>0°로 이동</button>
            {axis === 'yaw' && <button className="linkbtn" disabled={on || m.needs_front} title="정면이 틀어졌을 때만" onClick={() => { if (window.confirm('로봇이 지금 정확히 정면(0°)을 보고 있나요? 현재 위치를 0°로 다시 저장합니다. 움직이지 않습니다.')) void say(motorAct('setup', 'yaw')); }}>정면 다시 잡기</button>}
          </div>
        </>
      )}
      {!up && <small className="hwwarn">npm run dev 로 서버를 켜면 같이 켜져요. ({m.detail ?? ''})</small>}
    </div>
  );
}

/** Dry run of the yaw motor: shows what a slow, limited motor would do for this sequence. NOTHING is sent to any motor. */
function YawDryRun() {
  const seq = useStore((s) => s.seq), t = useStore((s) => s.tSec);
  const plan = useMemo(() => planYaw(seq), [seq]);
  const i = planAt(plan, t), c = YAW_MOTOR;
  return (
    <>
      <small className="hwsec">Yaw motor · dry run (nothing is sent)</small>
      <div className="hwrow"><small>limit ±{c.limitDeg}° · max {c.maxVel}°/s · accel {c.maxAcc}°/s²</small></div>
      <div className="hwrow">
        <small>now: sim {plan.sim[i].toFixed(1)}° → motor follows {plan.exec[i].toFixed(1)}° → raw {plan.raw[i]}</small>
      </div>
      <div className="hwrow">
        <small className={plan.clamped || plan.maxLagDeg > 5 ? 'hwwarn' : ''}>
          whole sequence: fastest ask {plan.maxSimVel.toFixed(0)}°/s · beyond ±{c.limitDeg}° in {(plan.clamped / plan.fps).toFixed(1)} s · biggest lag {plan.maxLagDeg.toFixed(0)}° at {plan.maxLagAtSec.toFixed(1)} s
        </small>
      </div>
    </>
  );
}

export function HardwareMenu() {
  const { st, cfg } = useHw();
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ right: 12, top: 0 });
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const off = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    window.addEventListener('mousedown', off);
    return () => window.removeEventListener('mousedown', off);
  }, [open]);
  const num = (k: 'ringOffset' | 'maxScale' | 'budgetMa', f = 1) => (e: React.ChangeEvent<HTMLInputElement>) => setHwSettings({ [k]: Number(e.target.value) * f } as never);
  return (
    <div className="exmenu" ref={ref}>
      <button className={'ico' + (st.connected ? ' on' : '')} title="Drive the real eyes and ring from this page (Arduino UNO R4 over USB)"
        onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); setPos({ right: Math.max(8, window.innerWidth - r.right), top: r.bottom + 6 }); setOpen((o) => !o); }}>
        {st.connected ? '● ' : ''}Hardware <span className="caret">▾</span>
      </button>
      {open && (
        <div className="exlist hwpanel" style={{ right: pos.right, top: pos.top, left: 'auto' }}>
          <MotorCard axis="yaw" />
          <MotorCard axis="tilt" />
          <details className="hwfold">
            <summary>눈 · 링 (Arduino) {st.connected ? '● 연결됨' : '○ 연결 안 됨'}</summary>
            <div className="hwrow">
              {st.connected
                ? <button className="ico" onClick={() => void disconnectHw()}>Disconnect</button>
                : <button className="ico" disabled={st.busy} onClick={() => void connectHw()}>Connect Arduino…</button>}
              <small>{st.message}{st.connected ? ` · ${st.frames} frames` : ''}</small>
            </div>
            {!hwSupported() && <small className="hwwarn">This browser has no Web Serial. Use Chrome or Edge on localhost. Close Arduino IDE’s serial monitor first.</small>}
            <small className="hwsec">Eyes (verify with the test dot)</small>
            <div className="hwrow">
              <label>layout <select value={cfg.layout} onChange={(e) => setHwSettings({ layout: e.target.value as EyeLayout })}><option value="adafruit">adafruit</option><option value="msb_left">msb_left</option><option value="lsb_left">lsb_left</option></select></label>
              <label><input type="checkbox" checked={cfg.flipX} onChange={(e) => setHwSettings({ flipX: e.target.checked })} /> flip X</label>
              <label><input type="checkbox" checked={cfg.flipY} onChange={(e) => setHwSettings({ flipY: e.target.checked })} /> flip Y</label>
              <label><input type="checkbox" checked={cfg.swap} onChange={(e) => setHwSettings({ swap: e.target.checked })} /> swap L/R</label>
            </div>
            <div className="hwrow">
              <button className="ico" disabled={!st.connected} onClick={() => void probeEye('L', 0, 0)}>L: top-left dot</button>
              <button className="ico" disabled={!st.connected} onClick={() => void probeEye('R', 0, 0)}>R: top-left dot</button>
              <button className="ico" disabled={!st.connected} onClick={() => void requestInfo()}>Ping</button>
            </div>
            <small className="hwsec">Ring</small>
            <div className="hwrow">
              <label>LED0 offset <input type="number" min={0} max={23} value={cfg.ringOffset} onChange={num('ringOffset')} style={{ width: 52 }} /></label>
              <label><input type="checkbox" checked={cfg.ringReverse} onChange={(e) => setHwSettings({ ringReverse: e.target.checked })} /> reverse</label>
            </div>
            <div className="hwrow">
              <label>max brightness % <input type="number" min={1} max={100} value={Math.round(cfg.maxScale * 100)} onChange={num('maxScale', 0.01)} style={{ width: 52 }} /></label>
              <label>budget mA <input type="number" min={50} max={2000} step={50} value={cfg.budgetMa} onChange={num('budgetMa')} style={{ width: 64 }} /></label>
            </div>
            <small className="hwsec">Keep the ring low while powered from USB.</small>
          </details>
          <details className="hwfold">
            <summary>시나리오가 요구하는 요 움직임 (드라이런)</summary>
            <YawDryRun />
          </details>
        </div>
      )}
    </div>
  );
}
