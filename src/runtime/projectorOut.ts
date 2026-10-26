import { useStore, assetKind } from '../store';

/** What the real projector shows: only the clip's graphic on black (no editor, no wallpaper). Sent to the /?projector window. */
export type ProjMsg = {
  url: string | null; kind: 'image' | 'video' | null;
  opacity: number; brightness: number; rotationDeg: number; scale: number;
  playing: boolean; mediaT: number; loop: boolean; // wanted media time in seconds
};
export const PROJ_CHANNEL = 'lieu-projector';

let chan: BroadcastChannel | null = null, last = '', lastAt = 0;

export function currentProjMsg(): ProjMsg {
  const s = useStore.getState(), p = s.evalNow().projector;
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
  chan.onmessage = (e) => { if (e.data === 'hello') last = ''; }; // a new output window asks for the current picture
  window.setInterval(() => {
    const m = currentProjMsg(), key = JSON.stringify({ ...m, mediaT: 0 }); // media time changes constantly: video is resent on a slow beat below
    const now = performance.now();
    if (key !== last || (m.kind === 'video' && m.playing && now - lastAt > 200) || now - lastAt > 1000) { chan!.postMessage(m); last = key; lastAt = now; }
  }, 33);
}

/** Opens ONLY the projector window, covering the second display (the editor window stays on its own screen). A first click in it (or F) makes it true
 *  fullscreen: browsers insist on a user gesture inside the window itself, so we try right away and fall back to that one click. */
export async function openProjectorWindow() {
  let feat = 'popup,width=1280,height=800', ext: any = null;
  try { ext = await extScreen(); } catch { /* no permission: opens on this screen, drag it over */ }
  if (ext) feat = `popup,left=${ext.left},top=${ext.top},width=${ext.width},height=${ext.height}`;
  const w = window.open(`${location.pathname}?projector`, 'lieu-projector', feat);
  if (!w) return;
  w.addEventListener('load', () => { void w.document.documentElement.requestFullscreen?.().catch(() => undefined); });
}

let screens: any = null;
/** The non-primary display (needs Chrome's window-management permission, asked once); null when there is none. */
export async function extScreen(): Promise<any | null> {
  try {
    screens ??= await (window as any).getScreenDetails?.();
    return screens?.screens?.find((x: any) => !x.isPrimary) ?? null;
  } catch { return null; }
}
