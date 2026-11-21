import { offHardware } from './hardware';

export type Axis = 'yaw' | 'tilt' | 'body' | 'rail';

export async function holdAllMotors(): Promise<void> {
  await offHardware();
}
