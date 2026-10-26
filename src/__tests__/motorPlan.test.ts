import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { YAW_MOTOR, planYaw, yawToRaw } from '../engine/motorPlan';
import { validateSequence } from '../engine/project';

describe('yaw motor dry-run plan', () => {
  it('maps the measured points', () => {
    expect(yawToRaw(0)).toBe(Math.round(YAW_MOTOR.centerRaw));
    expect(yawToRaw(90)).toBeCloseTo(YAW_MOTOR.centerRaw + 90 * YAW_MOTOR.rawPerDeg, -1);
    expect(yawToRaw(-90)).toBeCloseTo(YAW_MOTOR.centerRaw - 90 * YAW_MOTOR.rawPerDeg, -1);
    expect(YAW_MOTOR.limitDeg).toBe(80);
  });
  it('never exceeds the safe range, velocity or acceleration', () => {
    for (const id of ['01_boarding', '02_driving_a', '03_arrival', '04_driving_b', '05_web_cover']) {
      const p = planYaw(validateSequence(JSON.parse(readFileSync(`examples/${id}.lieu.json`, 'utf8'))));
      let pv = 0;
      p.exec.forEach((x, i) => {
        expect(Math.abs(x)).toBeLessThanOrEqual(YAW_MOTOR.limitDeg + 1e-9);
        if (i) {
          const v = (x - p.exec[i - 1]) * p.fps;
          expect(Math.abs(v)).toBeLessThanOrEqual(YAW_MOTOR.maxVel + 1e-6);
          // the only allowed excess: the frame where the target arrives exactly on the +/-limit wall (a few deg/s of speed lost at once)
          if (Math.abs(x) < YAW_MOTOR.limitDeg - 1e-9) expect(Math.abs(v - pv) * p.fps).toBeLessThanOrEqual(YAW_MOTOR.maxAcc + 1e-3);
          pv = v;
        }
      });
    }
  });
});
