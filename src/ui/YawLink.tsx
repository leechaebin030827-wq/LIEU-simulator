import { useEffect, useSyncExternalStore } from 'react';
import { getMotorStatus, isFollowing, motorBridgeUp, startFollow, startMotorPolling, stopFollow, stopMotorPolling, subscribeMotor, type Axis } from '../runtime/motor';
import { toast } from './ui-store';

/** Under a slider: one switch that makes the real motor of that axis follow this slider / the timeline (slowly, within the safe range). */
export function AxisLink({ axis }: { axis: Axis }) {
  useSyncExternalStore(subscribeMotor, () => JSON.stringify(getMotorStatus(axis)) + isFollowing(axis));
  useEffect(() => { startMotorPolling(); return stopMotorPolling; }, []);
  const m = getMotorStatus(axis), up = motorBridgeUp(), armed = !!m.torque && m.mode === 4 && !!m.profile_ok, on = isFollowing(axis);
  const where = axis === 'yaw' ? 'Hardware ▾ → Set front + Arm' : 'Hardware ▾ → Tilt → Arm';
  const why = !up ? 'motor bridge is not reachable' : !m.ok ? `${axis} motor not found yet (U2D2 / motor power?)` : m.needs_front ? `confirm the front first: ${where}` : m.fault ? `fault: ${m.fault}` : !armed ? `motor is not armed: ${where}` : '';
  return (
    <div className="row" style={{ margin: '2px 0 8px', gap: 8 }}>
      <button className={'ico' + (on ? ' on' : '')} title={why || `The real ${axis} motor follows this slider and the timeline. Slow, within ±${m.limit_deg ?? '?'}°.`}
        onClick={() => { if (on) { stopFollow(axis); return; } if (why) { toast(`Motor: ${why}`, 'warn'); return; } void startFollow(axis); }}>
        {on ? '■ Motor linked — click to stop' : `▶ Link ${axis} to real motor`}
      </button>
      <span className="dim small">{!up ? 'bridge off' : m.ok ? `motor ${m.deg ?? '?'}° · ${m.needs_front ? 'needs front' : armed ? 'ready' : 'not armed'}${m.fault ? ' · FAULT' : ''}` : 'looking for motor…'}</span>
    </div>
  );
}
export const YawLink = () => <AxisLink axis="yaw" />;
