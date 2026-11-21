import { useStore } from '../store';
import { getHwStatus } from './hardware';
import { hardwareOutputsEnabled } from './outputGate';

/** Playback starts at the current preview time; physical final playback starts at zero. */
export async function playWithFinalMonitor() {
  const s = useStore.getState();
  if (getHwStatus().connected && hardwareOutputsEnabled() && s.seq.id === '08_exhibition_final' && s.tSec > 0.001) s.setTime(0);
  useStore.getState().play();
}
