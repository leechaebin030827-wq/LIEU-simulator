import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useStore } from '../store';
import { YAW_MOTOR, planAt, planYaw } from '../engine/motorPlan';
import { getMotorStatus, isFollowing, motorAct, motorBridgeUp, motorGoto, startFollow, startMotorPolling, stopFollow, stopMotorPolling, subscribeMotor } from '../runtime/motor';
import { toast } from './ui-store';
import { connectHw, disconnectHw, getHwSettings, getHwStatus, hwSupported, probeEye, requestInfo, setHwSettings, subscribeHw, type EyeLayout } from '../runtime/hardware';

const useHw = () => {
  useSyncExternalStore(subscribeHw, () => getHwStatus().frames + getHwStatus().message + getHwStatus().connected + JSON.stringify(getHwSettings()));
  return { st: getHwStatus(), cfg: getHwSettings() };
};

/** Live yaw motor panel. Talks to the local bridge only; every move is slow and limited there. */
function YawMotorLive() {
  useSyncExternalStore(subscribeMotor, () => JSON.stringify(getMotorStatus()) + isFollowing());
  useEffect(() => { startMotorPolling(); return stopMotorPolling; }, []);
  const m = getMotorStatus(), up = motorBridgeUp(), found = up && m.ok, armed = !!m.torque && m.mode === 4 && !!m.profile_ok, follow = isFollowing();
  const say = async (p: Promise<{ ok: boolean; error?: string }>) => { const r = await p; if (!r.ok) toast(`Motor: ${r.error ?? 'refused'}`, 'warn'); };
  const nudge = (d: number) => void say(motorGoto(Math.max(-YAW_MOTOR.limitDeg, Math.min(YAW_MOTOR.limitDeg, (m.deg ?? 0) + d))));
  return (
    <>
      <small className="hwsec">Yaw motor · live</small>
      {!up && <small className="hwwarn">Bridge not reachable at 127.0.0.1:8787{m.detail ? ` (${m.detail})` : ''}. It starts with the dev server (npm run dev); or: cd hardware/pi && python3 -m lieu_hw serve</small>}
      {up && !found && <small className="hwwarn">{m.error ?? 'looking for the motor…'}</small>}
      {found && (
        <>
          <div className="hwrow"><small>{`${m.deg ?? '?'}° · torque ${m.torque ? 'ON' : 'off'} · ${armed ? 'ready' : 'not armed'}${follow ? ' · FOLLOWING' : ''}`}</small></div>
          {m.fault && <div className="hwrow"><small className="hwwarn">FAULT: {m.fault}</small><button className="ico" onClick={() => void motorAct('clear')}>Clear fault</button></div>}
          {m.needs_front && (
            <div className="hwrow">
              <small className="hwwarn">Motor found. Turn the robot by hand to face exactly front, then confirm (the motor loses its zero when its power is cycled).</small>
              <button className="ico on" onClick={() => { if (window.confirm('Is the robot facing exactly front (0°) right now?\n\nThis saves the current position as 0°, sets the slow speed limits and turns torque ON (the axis will then resist your hand). It does not move by itself.\nArea clear and your hand near the motor power switch?')) void say(motorAct('setup')); }}>Set front + Arm</button>
            </div>
          )}
          {!m.needs_front && (
            <>
              <div className="hwrow">
                <button className="ico" disabled={!armed || follow} onClick={() => void say(motorAct('hold'))}>Hold</button>
                <button className="ico" disabled={!m.torque} onClick={() => void say(motorAct('release'))}>Torque off</button>
                <button className="ico" disabled={follow} title="Re-teach front (only needed if the zero is wrong)" onClick={() => { if (window.confirm('Is the robot facing exactly front (0°) right now?\n\nSaves the current position as 0°. Nothing moves.')) void say(motorAct('setup')); }}>Set front again</button>
              </div>
              <div className="hwrow">
                <button className="ico" disabled={!armed || follow} onClick={() => nudge(-5)}>−5°</button>
                <button className="ico" disabled={!armed || follow} onClick={() => void say(motorGoto(0))}>Go to 0°</button>
                <button className="ico" disabled={!armed || follow} onClick={() => nudge(5)}>+5°</button>
                <button className={'ico' + (follow ? ' on' : '')} disabled={!armed || !!m.fault} title="The motor follows what the Yaw slider / timeline shows, through the slow, limited follower (max speed and ±limit above). Stops and holds when switched off." onClick={() => (follow ? stopFollow() : void startFollow())}>{follow ? '■ Stop following' : '▶ Follow Yaw (slider + timeline)'}</button>
              </div>
            </>
          )}
        </>
      )}
    </>
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
          <YawDryRun />
          <YawMotorLive />
          <small className="hwsec">Keep the ring low while powered from USB.</small>
        </div>
      )}
    </div>
  );
}
