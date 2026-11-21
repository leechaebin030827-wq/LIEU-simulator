import { useStore, assetKind } from '../store';
import { hardwareOutputsEnabled } from './outputGate';
import { getHwStatus } from './hardware';

/** What the real projector shows: only the clip's graphic on black (no editor, no wallpaper). Sent to the /?projector window. */
export type ProjMsg = {
  url: string | null; kind: 'image' | 'video' | null;
  opacity: number; brightness: number; rotationDeg: number; scale: number;
  playing: boolean; mediaT: number; loop: boolean; // wanted media time in seconds
};
export const PROJ_CHANNEL = 'lieu-projector';

let chan: BroadcastChannel | null = null, last = '', lastAt = 0;
let receiverSeenAt = -Infinity;

export function currentProjMsg(): ProjMsg {
  const s = useStore.getState();
  if (!hardwareOutputsEnabled() || !s.playing) return { url: null, kind: null, opacity: 0, brightness: 1, rotationDeg: 0, scale: 1, playing: false, mediaT: 0, loop: true };
  const p = s.evalNow().projector;
  const clip = p.activeClips[p.activeClips.length - 1];
  if (!clip || p.opacity <= 0.001) return { url: null, kind: null, opacity: 0, brightness: 1, rotationDeg: 0, scale: 1, playing: s.playing, mediaT: 0, loop: true };
  const a = s.assets[clip.assetId];
  const mime = a?.mime ?? (clip.assetId.endsWith('.svg') ? 'image/svg+xml' : clip.assetId.match(/\.(mp4|webm|mov)$/) ? 'video/mp4' : 'image/png');
  const url = a?.url ?? new URL(`${import.meta.env.BASE_URL}examples/${clip.assetId}`, location.href).href;
  const k = assetKind(mime);
  return {
    url, kind: k === 'video' ? 'video' : k === 'image' ? 'image' : null,
    opacity: p.opacity, brightness: p.brightness, rotationDeg: p.rotationDeg, scale: p.scale,
    playing: s.playing, mediaT: Math.max(0, s.tSec - clip.fromSec + (clip.mediaOffsetSec ?? 0)), loop: clip.loopMedia !== false,
  };
}

export function startProjectorBroadcast() {
  if (chan || typeof BroadcastChannel === 'undefined') return;
  chan = new BroadcastChannel(PROJ_CHANNEL);
  chan.onmessage = (e) => {
    if (e.data === 'hello') {
      receiverSeenAt = performance.now();
      last = '';
    }
  }; // a new output window asks for the current picture
  window.setInterval(() => {
    // Do no projector work until an output window is alive. The output sends a
    // heartbeat, so closing it also stops this loop from evaluating the full
    // sequence forever in the editor tab.
    const now = performance.now();
    if (now - receiverSeenAt > 2500) return;
    const m = currentProjMsg(), key = JSON.stringify({ ...m, mediaT: 0 }); // media time changes constantly: video is resent on a slow beat below
    // The video element advances on its own. A one-second correction is enough
    // to prevent drift; seeking it five times a second causes decode thrash in
    // Chromium, especially while the editor is also rendering WebGL.
    if (key !== last || (m.kind === 'video' && m.playing && now - lastAt > 1000) || now - lastAt > 2000) {
      chan!.postMessage(m); last = key; lastAt = now;
    }
  }, 100);
}

/** Opens ONLY the projector window, covering the second display (the editor window stays on its own screen). A first click in it (or F) makes it true
 *  fullscreen: browsers insist on a user gesture inside the window itself, so we try right away and fall back to that one click. */
export async function openProjectorWindow() {
  if (!getHwStatus().connected) return;
  // Open synchronously while the button click still owns user activation.
  // Awaiting getScreenDetails first makes popup blockers reject this window.
  const url = new URL(location.href);
  url.search = '?projector'; url.hash = '';
  const w = window.open(url.href, 'lieu-projector', 'popup,width=1280,height=800');
  if (!w) return;
  try {
    // Physical installation order: projector is external display 1, passenger
    // TV is external display 2. A single external display is still used.
    const ext = await extScreen(0);
    if (ext) { w.moveTo(ext.left, ext.top); w.resizeTo(ext.width, ext.height); }
  } catch { /* permission denied: leave it open so it can be dragged */ }
  // Do not leave the black output as Chrome's last active window. macOS will
  // otherwise restore that fullscreen Space when Chrome is clicked in the
  // Dock, making the healthy editor appear to be frozen.
  window.focus();
}

let screens: any = null;
/** The non-primary display (needs Chrome's window-management permission, asked once); null when there is none. */
export async function extScreen(preferredIndex = 0): Promise<any | null> {
  try {
    screens ??= await (window as any).getScreenDetails?.();
    const external = screens?.screens?.filter((x: any) => !x.isPrimary) ?? [];
    return external[preferredIndex] ?? external[0] ?? null;
  } catch { return null; }
}

/** Move this output window to the requested external display and enter real
 * browser fullscreen. Must be called from a click/key gesture. If the browser
 * cannot enumerate displays, fullscreen applies to whichever display the
 * window is currently on (so dragging it to the TV first remains reliable). */
export async function fullscreenOutput(preferredIndex = 0): Promise<boolean> {
  const ext = await extScreen(preferredIndex);
  if (ext) {
    window.moveTo(ext.left, ext.top);
    window.resizeTo(ext.width, ext.height);
  }
  if (!document.fullscreenElement) {
    const opts = ext ? ({ screen: ext } as FullscreenOptions) : undefined;
    await document.documentElement.requestFullscreen(opts);
  }
  // Once the external display is in fullscreen, hand keyboard focus back to
  // the editor on the primary display. The output keeps rendering normally.
  const editor = window.opener;
  if (editor && !editor.closed) {
    window.setTimeout(() => {
      try { editor.focus(); } catch { /* cross-window focus may be restricted */ }
    }, 120);
  }
  return !!ext;
}
