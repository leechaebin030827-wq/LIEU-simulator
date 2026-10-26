import { useEffect, useSyncExternalStore } from 'react';
import { getMotorStatus, isFollowing, motorBridgeUp, startFollow, startMotorPolling, stopFollow, stopMotorPolling, subscribeMotor } from '../runtime/motor';
import { toast } from './ui-store';

/** Under the Yaw slider: one switch that makes the real yaw motor follow this slider / the timeline (slowly, within the safe range). */
export function YawLink() {
  useSyncExternalStore(subscribeMotor, () => JSON.stringify(getMotorStatus()) + isFollowing());
  useEffect(() => { startMotorPolling(); return stopMotorPolling; }, []);
  const m = getMotorStatus(), up = motorBridgeUp(), armed = !!m.torque && m.mode === 4 && !!m.profile_ok, on = isFollowing();
  const why = !up ? 'motor bridge is not reachable' : !m.ok ? 'motor not found yet (U2D2 / motor power?)' : m.needs_front ? 'confirm the front first: Hardware ▾ → Set front + Arm' : m.fault ? `fault: ${m.fault}` : !armed ? 'motor is not armed: Hardware ▾ → Set front + Arm' : '';
  return (
    <div className="row" style={{ margin: '2px 0 8px', gap: 8 }}>
      <button className={'ico' + (on ? ' on' : '')} title={why || 'The real yaw motor follows this slider and the timeline. Slow, within ±80°.'}
        onClick={() => { if (on) { stopFollow(); return; } if (why) { toast(`Motor: ${why}`, 'warn'); return; } void startFollow(); }}>
        {on ? '■ Motor linked — click to stop' : '▶ Link yaw to real motor'}
      </button>
      <span className="dim small">{!up ? 'bridge off' : m.ok ? `motor ${m.deg ?? '?'}° · ${m.needs_front ? 'needs front' : armed ? 'ready' : 'not armed'}${m.fault ? ' · FAULT' : ''}` : 'looking for motor…'}</span>
    </div>
  );
}
