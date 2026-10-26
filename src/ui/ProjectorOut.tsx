import { useEffect, useRef, useState } from 'react';
import { PROJ_CHANNEL, type ProjMsg } from '../runtime/projectorOut';

/** Fullscreen projector picture: black everywhere the real projector must stay dark, the clip's graphic where it should light. */
function ProjectorView({ m, hint, onToggleFs }: { m: ProjMsg | null; hint: boolean; onToggleFs: () => void }) {
  const vid = useRef<HTMLVideoElement>(null);
  // mounting of the real projector is unknown: R turns the output 90 degrees, M mirrors it (remembered in this browser)
  const [fix, setFix] = useState<{ rot: number; mirror: boolean }>(() => { try { return { rot: 270, mirror: false, ...JSON.parse(localStorage.getItem('lieu.projfix2') ?? '{}') }; } catch { return { rot: 270, mirror: false }; } });
  useEffect(() => { try { localStorage.setItem('lieu.projfix2', JSON.stringify(fix)); } catch { /* storage unavailable */ } }, [fix]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === 'f' || e.key === 'F') onToggleFs();
      if (e.key === 'r' || e.key === 'R') setFix((f) => ({ ...f, rot: (f.rot + 90) % 360 }));
      if (e.key === 'm' || e.key === 'M') setFix((f) => ({ ...f, mirror: !f.mirror }));
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [onToggleFs]);
  useEffect(() => {
    const v = vid.current;
    if (!v || !m || m.kind !== 'video') return;
    const dur = v.duration || 1e9, target = m.loop ? m.mediaT % dur : Math.min(m.mediaT, dur);
    if (m.playing) { if (Math.abs(v.currentTime - target) > 0.25 && v.readyState > 1) v.currentTime = target; if (v.paused) void v.play().catch(() => undefined); }
    else { v.pause(); if (v.readyState > 1 && Math.abs(v.currentTime - target) > 0.02) v.currentTime = target; }
  }, [m]);
  const style: React.CSSProperties = m ? {
    maxWidth: '100%', maxHeight: '100%', objectFit: 'contain',
    opacity: Math.min(1, m.opacity), filter: `brightness(${Math.min(2, m.brightness)})`,
    transform: `rotate(${m.rotationDeg}deg) scale(${m.scale})`,
  } : {};
  return (
    <div onClick={onToggleFs} style={{ position: 'absolute', inset: 0, background: '#000', display: 'grid', placeItems: 'center', cursor: hint ? 'pointer' : 'none', overflow: 'hidden' }}>
      <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', transform: `rotate(${fix.rot}deg) scaleX(${fix.mirror ? -1 : 1})` }}>
      {m?.url && m.kind === 'image' && <img src={m.url} style={style} alt="" draggable={false} />}
      {m?.url && m.kind === 'video' && <video ref={vid} src={m.url} style={style} muted playsInline loop={m.loop} />}
      </div>
      {hint && <div style={{ position: 'absolute', bottom: 18, left: 0, right: 0, textAlign: 'center', color: '#888', font: '14px system-ui' }}>Drag this window to the projector display, then click or press F for fullscreen · R rotate 90° · M mirror</div>}
    </div>
  );
}

/** Standalone window (/?projector): fed by the editor window over BroadcastChannel. */
export function ProjectorOut() {
  const [m, setM] = useState<ProjMsg | null>(null);
  const [hint, setHint] = useState(true);
  useEffect(() => {
    document.title = 'LIEU projector output';
    const hide = window.setTimeout(() => setHint(false), 6000); // the usage hint never stays on the projected picture
    const ch = new BroadcastChannel(PROJ_CHANNEL);
    ch.onmessage = (e) => setM(e.data as ProjMsg);
    ch.postMessage('hello');
    return () => { ch.close(); window.clearTimeout(hide); };
  }, []);
  const toggleFs = async () => { setHint(false); try { if (document.fullscreenElement) await document.exitFullscreen(); else await document.documentElement.requestFullscreen(); } catch { /* needs a click */ } };
  return <div style={{ position: 'fixed', inset: 0 }}><ProjectorView m={m} hint={hint} onToggleFs={() => void toggleFs()} /></div>;
}
