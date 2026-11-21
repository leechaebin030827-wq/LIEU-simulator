import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const audio = vi.hoisted(() => ({ syncAudio: vi.fn(), stopAudio: vi.fn() }));
vi.mock('../runtime/audio', () => audio);
const clock = vi.hoisted(() => ({ t: null as number | null }));
vi.mock('../runtime/screenClock', () => ({ readScreenClock: () => clock.t }));
let transport: typeof import('../runtime/transport');
let store: typeof import('../store');
let frames: Map<number, FrameRequestCallback>, next: number;
beforeEach(async () => {
  vi.resetModules(); vi.useFakeTimers(); frames = new Map(); next = 1;
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => { const id = next++; frames.set(id, cb); return id; });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
  transport = await import('../runtime/transport'); store = await import('../store');
});
afterEach(() => { clock.t = null; transport.stopTransport(); vi.useRealTimers(); vi.unstubAllGlobals(); });
async function frame(ms: number) {
  await vi.advanceTimersByTimeAsync(ms);
  const pending = [...frames.values()]; frames.clear();
  for (const callback of pending) callback(performance.now());
}
it('keeps one clock, limits display updates, and releases RAF on stop', async () => {
  let changes = 0;
  const unsubscribe = store.useStore.subscribe(() => { changes++; });
  transport.startTransport(); transport.startTransport();
  expect(frames.size).toBe(1);
  store.useStore.getState().play(); await frame(0); changes = 0;
  for (let i = 0; i < 120; i++) await frame(1000 / 120);
  expect(store.useStore.getState().tSec).toBeCloseTo(1, 1);
  expect(changes).toBeLessThanOrEqual(31);
  transport.stopTransport(); expect(frames.size).toBe(0);
  const at = store.useStore.getState().tSec; await frame(1000);
  expect(store.useStore.getState().tSec).toBe(at); unsubscribe();
});
it('handles pause and a manual seek immediately at high refresh rates', async () => {
  transport.startTransport(); const s = store.useStore.getState();
  s.play(); await frame(0); await frame(100); s.pause(); await frame(1);
  const at = store.useStore.getState().tSec; await frame(1000);
  expect(store.useStore.getState().tSec).toBe(at);
  s.setTime(5); s.play(); await frame(1);
  expect(store.useStore.getState().tSec).toBe(5);
});
it('keeps evenly spaced time when the video clock advances in uneven steps', async () => {
  transport.startTransport(); store.useStore.getState().play(); clock.t = 0; await frame(0);
  const times: number[] = [];
  for (let i = 1; i <= 60; i++) {
    clock.t = Math.floor(i / 2) * (2 / 30); // video repeats one frame, then jumps two
    await frame(1000 / 30);
    times.push(store.useStore.getState().tSec);
  }
  const steps = times.slice(1).map((t, i) => t - times[i]);
  for (const step of steps.slice(10)) expect(Math.abs(step - 1 / 30)).toBeLessThan(0.012);
  expect(times[times.length - 1]).toBeCloseTo(clock.t, 1);
});
it('slows down instead of freezing while the video stalls, and snaps on a seek', async () => {
  transport.startTransport(); store.useStore.getState().play(); clock.t = 1; await frame(0);
  let prev = store.useStore.getState().tSec;
  for (let i = 0; i < 30; i++) {
    await frame(1000 / 30);
    const t = store.useStore.getState().tSec;
    expect(t).toBeGreaterThan(prev); // never frozen, never backwards: the robot keeps moving
    prev = t;
  }
  expect(prev).toBeLessThan(1 + 0.6); // but it does not run off ahead of the stalled video
  clock.t = 5; await frame(1000 / 30);
  expect(store.useStore.getState().tSec).toBe(5);
});
