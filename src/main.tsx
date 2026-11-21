import { createRoot } from 'react-dom/client';
import '@fontsource/ibm-plex-mono/400.css';
import './ui/styles.css';

async function mount() {
  // Output windows do not need React Three Fiber, the GLB loader, editor state,
  // timeline code, or exporters. Keep those modules out of TV/projector startup
  // so opening an output cannot briefly freeze the editor tab.
  if (location.search.includes('screen')) {
    const { ScreenOut } = await import('./ui/ScreenOut');
    createRoot(document.getElementById('root')!).render(<ScreenOut />);
    return;
  }
  if (location.search.includes('projector')) {
    const { ProjectorOut } = await import('./ui/ProjectorOut');
    createRoot(document.getElementById('root')!).render(<ProjectorOut />);
    return;
  }
  const [{ App }, { useStore }] = await Promise.all([import('./App'), import('./store')]);
  if (import.meta.env.DEV) (window as unknown as { __lieu: typeof useStore }).__lieu = useStore;
  // StrictMode intentionally omitted: the rig builder reparents GLB meshes exactly once.
  createRoot(document.getElementById('root')!).render(<App />);
}

void mount();
