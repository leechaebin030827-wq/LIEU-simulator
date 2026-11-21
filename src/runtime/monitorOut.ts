import { extScreen } from './projectorOut';
import { useStore } from '../store';
import { hardwareOutputsEnabled, subscribeHardwareOutputs } from './outputGate';
import { getHwStatus } from './hardware';

export const SCREEN_CHANNEL = 'lieu-passenger-screen';

let screenChannel: BroadcastChannel | null = null;
let screenReceiverSeenAt = -Infinity;
let screenFramePending = false;
let monitorActive = false;
let unsubscribeMode: (() => void) | null = null;

type MonitorModeMessage = { type: 'output-mode'; active: boolean };

function refreshMonitorMode() {
  const next = hardwareOutputsEnabled() && useStore.getState().playing;
  if (next === monitorActive) return;
  monitorActive = next;
  (window as Window & { __lieuHardwarePlaybackActive?: boolean }).__lieuHardwarePlaybackActive = next;
  screenChannel?.postMessage({ type: 'output-mode', active: next } satisfies MonitorModeMessage);
}

/**
 * Backup transport for browsers that deliberately remove `window.opener` from
 * popup windows. The normal same-origin canvas path stays zero-copy; frames
 * are only cloned while an output window is actively asking for them.
 */
export function startMonitorBroadcast(canvas: HTMLCanvasElement) {
  if (screenChannel || typeof BroadcastChannel === 'undefined' || typeof createImageBitmap === 'undefined') return;
  screenChannel = new BroadcastChannel(SCREEN_CHANNEL);
  (window as Window & { __lieuHardwarePlaybackActive?: boolean }).__lieuHardwarePlaybackActive = false;
  unsubscribeMode = subscribeHardwareOutputs(refreshMonitorMode);
  const unsubscribeStore = useStore.subscribe((state, previous) => {
    if (state.playing !== previous.playing) refreshMonitorMode();
  });
  const stop = unsubscribeMode;
  unsubscribeMode = () => { stop?.(); unsubscribeStore(); };
  screenChannel.onmessage = (e) => {
    // Ignore legacy `hello`: old TV windows sent it forever even while the
    // zero-copy opener path worked, forcing needless full-HD frame clones.
    if (e.data === 'fallback-v2') { screenReceiverSeenAt = performance.now(); screenChannel?.postMessage({ type: 'output-mode', active: monitorActive } satisfies MonitorModeMessage); }
    else if (e.data === 'direct') screenReceiverSeenAt = -Infinity;
  };
  refreshMonitorMode();
  window.setInterval(() => {
    if (!monitorActive || !screenChannel || screenFramePending || performance.now() - screenReceiverSeenAt > 2000) return;
    screenFramePending = true;
    void createImageBitmap(canvas).then((bitmap) => {
      screenChannel?.postMessage(bitmap);
      bitmap.close();
    }).catch(() => undefined).finally(() => { screenFramePending = false; });
  }, 1000 / 15);
}

/**
 * Open the exact passenger monitor picture on the attached TV. This is kept
 * separate from the floor-projector output: the TV gets video + passenger UI,
 * while the projector keeps receiving only projection graphics on black.
 */
export async function openMonitorWindow() {
  if (!getHwStatus().connected) return;
  // Open synchronously while the button click still owns browser user
  // activation. Awaiting the display-permission result first makes Safari and
  // some Chromium popup policies silently block the output window.
  const url = new URL(location.href);
  url.search = '?screen'; url.hash = '';
  const w = window.open(url.href, 'lieu-passenger-monitor', 'popup,width=1080,height=720');
  if (!w) return;
  try {
    // Physical installation order: projector is external display 1, passenger
    // TV is external display 2.
    const ext: any = await extScreen(1);
    if (ext) { w.moveTo(ext.left, ext.top); w.resizeTo(ext.width, ext.height); }
  } catch { /* permission denied: leave it open so the user can drag it to the TV */ }
  // Keep the editor as Chrome's last active window. Otherwise clicking the
  // Chrome Dock icon later reactivates this borderless/black output window,
  // which looks exactly like Chrome has frozen even though every process is
  // idle. Fullscreen is entered by the explicit click inside the output.
  window.focus();
}

