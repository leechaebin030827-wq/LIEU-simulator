import { create } from 'zustand';
import { toast } from './ui-store';
import { videoExportSupported } from '../runtime/videoExport';

export const useExp = create<{ open: boolean }>(() => ({ open: false }));
export const openExport = () => {
  if (!videoExportSupported()) { toast('Video export needs a recent Chrome / Edge, and the 3D view must be loaded.', 'warn', 5000); return; }
  useExp.setState({ open: true });
};
