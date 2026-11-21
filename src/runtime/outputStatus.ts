/**
 * The TV monitor and projector windows report what they are actually putting on
 * screen once a second, so the editor's 활성상태 tab can tell "window closed" from
 * "window open but drawing nothing" from "drawing at N fps".
 */
export const OUTPUT_STATUS_CHANNEL = 'lieu-output-status';

export type OutputKind = 'monitor' | 'projector';
export type OutputReport = {
  kind: OutputKind;
  fps: number;              // frames actually drawn/presented in the last second
  fullscreen: boolean;
  showing: boolean;         // something is on screen (not the idle black)
  detail: string;           // e.g. the clip shown, or "direct"/"fallback" source
  videoDropped?: number;    // for a video clip: decoder dropped frames so far
};
export type OutputSeen = OutputReport & { at: number };

/** Output window side: call every frame you draw; reports once a second. */
export function startOutputReporter(kind: OutputKind, snapshot: () => Omit<OutputReport, 'kind' | 'fps'>) {
  if (typeof BroadcastChannel === 'undefined') return { frame: () => undefined, stop: () => undefined };
  const ch = new BroadcastChannel(OUTPUT_STATUS_CHANNEL);
  let frames = 0;
  const id = window.setInterval(() => {
    ch.postMessage({ kind, fps: frames, ...snapshot() } satisfies OutputReport);
    frames = 0;
  }, 1000);
  return { frame: () => { frames++; }, stop: () => { window.clearInterval(id); ch.close(); } };
}

/** Editor side: latest report per output window. */
const seen: Partial<Record<OutputKind, OutputSeen>> = {};
let listening = false;
export function outputStatus(kind: OutputKind): OutputSeen | null {
  if (!listening && typeof BroadcastChannel !== 'undefined') {
    listening = true;
    new BroadcastChannel(OUTPUT_STATUS_CHANNEL).onmessage = (e) => {
      const r = e.data as OutputReport;
      if (r?.kind === 'monitor' || r?.kind === 'projector') seen[r.kind] = { ...r, at: performance.now() };
    };
  }
  return seen[kind] ?? null;
}
