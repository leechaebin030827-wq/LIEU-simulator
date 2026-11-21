/**
 * The video actually visible on LIEU's monitor is the master playback clock.
 *
 * A decoded video can briefly stall even while requestAnimationFrame keeps
 * running. Publishing its real media time here makes every other output
 * (motion, eyes, LEDs and hardware) hold the same visible frame instead of
 * drifting ahead on a separate performance.now() clock.
 */
let scenarioT: number | null = null;
let publishedAt = 0;

export function publishScreenClock(t: number | null) {
  scenarioT = Number.isFinite(t) ? t : null;
  publishedAt = performance.now();
}

export function readScreenClock(maxAgeMs = 250): number | null {
  if (scenarioT === null || performance.now() - publishedAt > maxAgeMs) return null;
  return scenarioT;
}

