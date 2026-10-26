import { createRoot } from 'react-dom/client';
import { App } from './App';
import { ProjectorOut } from './ui/ProjectorOut';
import '@fontsource/ibm-plex-mono/400.css';
import './ui/styles.css';
import { useStore } from './store';

if (import.meta.env.DEV) (window as unknown as { __lieu: typeof useStore }).__lieu = useStore;

// StrictMode intentionally omitted: the rig builder reparents GLB meshes exactly once.
createRoot(document.getElementById('root')!).render(location.search.includes('projector') ? <ProjectorOut /> : <App />);
