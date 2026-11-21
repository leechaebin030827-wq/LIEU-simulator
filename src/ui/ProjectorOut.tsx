import { useEffect, useRef, useState } from 'react';
import { fullscreenOutput, PROJ_CHANNEL, type ProjMsg } from '../runtime/projectorOut';
import { startOutputReporter } from '../runtime/outputStatus';

/** Fullscreen projector picture: black everywhere the real projector must stay dark, the clip's graphic where it should light. */
function ProjectorView({ m, hint, onToggleFs }: { m: ProjMsg | null; hint: boolean; onToggleFs: () => void }) {
  const vid = useRef<HTMLVideoElement>(null);
  // Physical projector is mounted 90° counter-clockwise from the previous
  // front orientation. R still permits installation-day adjustment.
  const [fix, setFix] = useState<{ rot: number; mirror: boolean }>(() => { try { return { rot: -90, mirror: false, ...JSON.parse(localStorage.getItem('lieu.projfix4') ?? '{}') }; } catch { return { rot: -90, mirror: false }; } });
  useEffect(() => { try { localStorage.setItem('lieu.projfix4', JSON.stringify(fix)); } catch { /* storage unavailable */ } }, [fix]);
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
    if (m.playing) { v.playbackRate = 1; if (Math.abs(v.currentTime - target) > 0.75 && v.readyState > 1) v.currentTime = target; if (v.paused) void v.play().catch(() => undefined); }
    else { v.pause(); if (v.readyState > 1 && Math.abs(v.currentTime - target) > 0.02) v.currentTime = target; }
  }, [m]);
  const style: React.CSSProperties = m ? {
    maxWidth: '100%', maxHeight: '100%', objectFit: 'contain',
    opacity: Math.min(1, m.opacity), filter: `brightness(${Math.min(2, m.brightness)})`,
    transform: `rotate(${m.rotationDeg}deg) scale(${m.scale})`,
  } : {};
  const quarterTurn = Math.abs(fix.rot % 180) === 90;
  return (
    <div style={{ position: 'absolute', inset: 0, background: '#000', display: 'grid', placeItems: 'center', cursor: hint ? 'pointer' : 'none', overflow: 'hidden' }}>
      <div style={{ position: 'absolute', left: '50%', top: '50%', width: quarterTurn ? '100vh' : '100vw', height: quarterTurn ? '100vw' : '100vh', display: 'grid', placeItems: 'center', transform: `translate(-50%, -50%) rotate(${fix.rot}deg) scaleX(${fix.mirror ? -1 : 1})` }}>
      {m?.url && m.kind === 'image' && <img src={m.url} style={style} alt="" draggable={false} />}
      {m?.url && m.kind === 'video' && <video ref={vid} src={m.url} style={style} muted playsInline loop={m.loop} />}
      </div>
      {hint && <div style={{ position: 'absolute', bottom: 18, left: 0, right: 0, textAlign: 'center', color: '#aaa', font: '14px system-ui' }}>
        {!m?.url && <div style={{ marginBottom: 8, color: '#fff' }}>현재 타임라인 구간에는 프로젝션이 없습니다 — 재생하면 지정 장면에서 자동 표시됩니다</div>}
        프로젝터 출력 · 클릭하면 전체화면 · 기본 방향 반시계 90° · R 90° 회전 · M 좌우반전
      </div>}
    </div>
  );
}

/** Standalone window (/?projector): fed by the editor window over BroadcastChannel. */
export function ProjectorOut() {
  const [m, setM] = useState<ProjMsg | null>(null);
  const visualKey = useRef('');
  const [hint, setHint] = useState(true);
  const [fsError, setFsError] = useState('');
  const [isFullscreen, setIsFullscreen] = useState(false);
  useEffect(() => {
    document.title = 'LIEU projector output';
    const hide = window.setTimeout(() => setHint(false), 6000); // the usage hint never stays on the projected picture
    const ch = new BroadcastChannel(PROJ_CHANNEL);
    ch.onmessage = (e) => {
      const next = e.data as ProjMsg;
      // mediaT is a clock correction, not visual React state. Ignore ordinary
      // playing heartbeats unless the video has drifted enough to need a seek.
      const key = JSON.stringify({ ...next, mediaT: 0 });
      const video = document.querySelector<HTMLVideoElement>('video');
      const duration = video?.duration || 1e9;
      const target = next.loop ? next.mediaT % duration : Math.min(next.mediaT, duration);
      const drifted = !!video && video.readyState > 1 && Math.abs(video.currentTime - target) > 0.75;
      if (key !== visualKey.current || drifted || !next.playing) {
        visualKey.current = key;
        setM(next);
      }
    };
    const hello = window.setInterval(() => ch.postMessage('hello'), 1000);
    ch.postMessage('hello');
    return () => { ch.close(); window.clearInterval(hello); window.clearTimeout(hide); };
  }, []);
  // the browser's title/tab bar only goes away in real fullscreen, which Chrome allows only after a user gesture inside this window: the first press / key / touch does it
  useEffect(() => {
    document.documentElement.style.background = '#000'; document.body.style.background = '#000';
    const changed = () => setIsFullscreen(!!document.fullscreenElement);
    const releaseFocus = () => {
      if (!document.fullscreenElement) return;
      const editor = window.opener;
      if (editor && !editor.closed) window.setTimeout(() => {
        try { editor.focus(); } catch { /* focus can be browser-restricted */ }
      }, 80);
    };
    document.addEventListener('fullscreenchange', changed);
    window.addEventListener('focus', releaseFocus);
    if (document.hasFocus()) releaseFocus();
    const enter = (e: Event) => { if ((e as KeyboardEvent).key?.toLowerCase() === 'f') return; if (!document.fullscreenElement) void fullscreenOutput(0).catch(() => setFsError('이 창을 프로젝터 화면으로 옮긴 뒤 버튼을 다시 눌러주세요.')); };
    window.addEventListener('pointerdown', enter, { once: true }); window.addEventListener('keydown', enter, { once: true });
    return () => { document.removeEventListener('fullscreenchange', changed); window.removeEventListener('focus', releaseFocus); window.removeEventListener('pointerdown', enter); window.removeEventListener('keydown', enter); };
  }, []);
  // Report what the projector actually shows (frames presented per second, the clip, dropped video frames).
  const latest = useRef<ProjMsg | null>(null);
  latest.current = m;
  useEffect(() => {
    const reporter = startOutputReporter('projector', () => {
      const cur = latest.current;
      const video = document.querySelector<HTMLVideoElement>('video');
      return {
        fullscreen: !!document.fullscreenElement,
        showing: !!cur?.url && cur.opacity > 0.01,
        detail: cur?.url ? decodeURIComponent(cur.url.split('/').pop() ?? '') : '프로젝션 없음 (검은 화면)',
        videoDropped: video?.getVideoPlaybackQuality?.().droppedVideoFrames,
      };
    });
    let raf = 0;
    const tick = () => { raf = requestAnimationFrame(tick); if (latest.current?.url) reporter.frame(); };
    raf = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(raf); reporter.stop(); };
  }, []);
  const toggleFs = async () => { setHint(false); setFsError(''); try { if (document.fullscreenElement) await document.exitFullscreen(); else await fullscreenOutput(0); } catch { setFsError('자동 이동이 막혔습니다. 이 창을 프로젝터 화면으로 옮긴 뒤 버튼을 다시 눌러주세요.'); } };
  return <div style={{ position: 'fixed', inset: 0 }}>
    <ProjectorView m={m} hint={hint} onToggleFs={() => void toggleFs()} />
    {!isFullscreen && <div style={{ position: 'absolute', top: 18, right: 18, zIndex: 2, display: 'grid', justifyItems: 'end', gap: 8 }}>
      <button onClick={(e) => { e.stopPropagation(); void toggleFs(); }} style={{ padding: '14px 20px', border: '1px solid rgba(255,255,255,.4)', borderRadius: 12, background: 'rgba(0,0,0,.72)', color: '#fff', font: '600 16px system-ui', cursor: 'pointer' }}>프로젝터로 보내기 · 전체화면</button>
      {fsError && <div style={{ maxWidth: 360, padding: '9px 12px', borderRadius: 8, background: 'rgba(0,0,0,.78)', color: '#fff', font: '13px system-ui' }}>{fsError}</div>}
    </div>}
  </div>;
}
