import { expect, it } from 'vitest';
import { parseTelemetry } from '../runtime/hardware';

it('parses the controller status line, including a motor that did not answer', () => {
  const tel = parseTelemetry('TEL mode=OFF rx=3 p=2188,2045,2296,x g=2188,2045,2296,242 alert=0,1,0,0 torque=0000 eyes=1,0 lights=0 i2c=2 bad=5', 7);
  expect(tel).toEqual({
    at: 7, mode: 'OFF', responded: 3,
    present: [2188, 2045, 2296, null], goal: [2188, 2045, 2296, 242],
    alert: [false, true, false, false], torque: [false, false, false, false],
    eyes: [true, false], lightsActive: false, i2cErrors: 2, badLines: 5,
  });
  expect(parseTelemetry('STATUS active=NONE id1=1 id2=2 id3=3 id4=4 torque=0000', 0)).toBeNull();
});
