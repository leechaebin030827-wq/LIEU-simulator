import { describe, expect, it } from 'vitest';
import { motionToSafeRaw, SAFE_RAW } from '../runtime/hardwareMap';

describe('narrow hardware timeline mapping', () => {
  it('keeps the coordinated default at the measured raw references', () => {
    expect(motionToSafeRaw({ yawY: 0, tiltZ: 0, bodyYaw: 0, railX: -0.12 })).toEqual({
      yaw: SAFE_RAW.yaw.center,
      tilt: SAFE_RAW.tilt.center,
      body: SAFE_RAW.body.center,
      rail: SAFE_RAW.rail.center,
    });
  });

  it('clamps authored values to the verified narrow windows', () => {
    expect(motionToSafeRaw({ yawY: -999, tiltZ: 999, bodyYaw: -999, railX: -999 })).toEqual({
      yaw: SAFE_RAW.yaw.min,
      tilt: SAFE_RAW.tilt.min,
      body: SAFE_RAW.body.min,
      rail: SAFE_RAW.rail.min,
    });
    expect(motionToSafeRaw({ yawY: 999, tiltZ: -999, bodyYaw: 999, railX: 999 })).toEqual({
      yaw: SAFE_RAW.yaw.max,
      tilt: SAFE_RAW.tilt.max,
      body: SAFE_RAW.body.max,
      rail: SAFE_RAW.rail.max,
    });
  });
});
