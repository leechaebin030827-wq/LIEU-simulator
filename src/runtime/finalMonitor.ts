import { useStore } from '../store';

/** Preview-only playback. No physical preparation or device command is sent. */
export async function playWithFinalMonitor() {
  const s = useStore.getState();
  if (s.seq.id === '08_exhibition_final' && s.tSec > 0.001) s.setTime(0);
  useStore.getState().play();
}
