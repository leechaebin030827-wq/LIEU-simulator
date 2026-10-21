import { useStore } from '../store';
import { useUi } from '../ui/ui-store';

const KEY = 'lieu.autosave.v1';

/** Debounced autosave of the current project JSON to localStorage (uploaded media files are not stored). */
export function startAutosave() {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let lastSeq = useStore.getState().seq, lastRig = useStore.getState().rig;
  useStore.subscribe((s) => {
    if (s.seq === lastSeq && s.rig === lastRig) return;
    lastSeq = s.seq; lastRig = s.rig;
    useUi.setState({ saving: true });
    clearTimeout(timer);
    timer = setTimeout(() => {
      try { localStorage.setItem(KEY, JSON.stringify({ savedAt: Date.now(), json: useStore.getState().exportJson() })); useUi.setState({ savedAt: Date.now(), saving: false }); }
      catch { useUi.setState({ saving: false }); }
    }, 700);
  });
}

export function readAutosave(): { savedAt: number; json: string } | null {
  try { const v = localStorage.getItem(KEY); return v ? JSON.parse(v) : null; } catch { return null; }
}
export function clearAutosave() { try { localStorage.removeItem(KEY); } catch { /* ignore */ } }
