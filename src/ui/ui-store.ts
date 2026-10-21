import { create } from 'zustand';

export type Toast = { id: number; msg: string; kind: 'info' | 'ok' | 'warn' };
export type Dialog = { title: string; body: string; confirmLabel: string; cancelLabel: string; danger: boolean; resolve: (ok: boolean) => void } | null;

type UiState = { toasts: Toast[]; dialog: Dialog; help: boolean; parts: boolean; savedAt: number | null; saving: boolean };
export const useUi = create<UiState>(() => ({ toasts: [], dialog: null, help: false, parts: false, savedAt: null, saving: false }));

let toastId = 1;
export function toast(msg: string, kind: Toast['kind'] = 'info', ms = 3800) {
  const id = toastId++;
  useUi.setState((s) => ({ toasts: [...s.toasts, { id, msg, kind }] }));
  setTimeout(() => useUi.setState((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), ms);
}

/** In-app confirm (window.confirm is blocked/ignored in some embedded browsers). */
export function confirmDialog(title: string, body: string, confirmLabel = 'OK', danger = false, cancelLabel = 'Cancel'): Promise<boolean> {
  return new Promise((resolve) => {
    useUi.setState({ dialog: { title, body, confirmLabel, cancelLabel, danger, resolve: (ok) => { useUi.setState({ dialog: null }); resolve(ok); } } });
  });
}
export const openHelp = () => useUi.setState({ help: true });
export const closeHelp = () => { useUi.setState({ help: false }); try { localStorage.setItem('lieu.seenHelp', '1'); } catch { /* ignore */ } };
export const toggleParts = () => useUi.setState((s) => ({ parts: !s.parts }));
