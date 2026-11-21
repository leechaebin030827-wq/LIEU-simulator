const listeners = new Set<() => void>();
let enabled = false;

/** Session-only master gate. It always returns to false after reload or a hardware release. */
export const hardwareOutputsEnabled = () => enabled;
export const setHardwareOutputsEnabled = (next: boolean) => {
  if (enabled === next) return;
  enabled = next;
  listeners.forEach((listener) => listener());
};
export const subscribeHardwareOutputs = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};
