import { useEffect, useRef, useState } from 'react';
import { SCREEN_H, SCREEN_W } from '../three/screenOut';
import { SCREEN_CHANNEL } from '../runtime/monitorOut';
import { fullscreenOutput } from '../runtime/projectorOut';
import { DevOverlay } from './DevOverlay';
import { startOutputReporter } from '../runtime/outputStatus';

type SourceWindow = Window & { __lieuScreenCanvas?: HTMLCanvasElement; __lieuHardwarePlaybackActive?: boolean };

/** Full-screen mirror of the exact canvas used as the robot monitor texture. */
export function ScreenOut() {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [hint, setHint] = useState(true);
  const [fsError, setFsError] = useState('');
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    document.title = 'LIEU passenger monitor';
    document.documentElement.style.background = '#000';
    document.body.style.background = '#000';
    const hide = window.setTimeout(() => setHint(false), 6000);
    const ch = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel(SCREEN_CHANNEL);
    let fallback: ImageBitmap | null = null;
    let fallbackActive = false;
    let lastDirectFrame = -Infinity;
    ch?.addEventListener('message', (e) => {
      if (e.data?.type === 'output-mode') { fallbackActive = !!e.data.active; return; }
      if (!(e.data instanceof ImageBitmap)) return;
      fallback?.close(); fallback = e.data;
    });
    let raf = 0;
    let lastDrawAt = -Infinity;
    let direct = false;
    let lastFallbackRequest = -Infinity;
    const openedAt = performance.now();
    let showing = false;
    const reporter = startOutputReporter('monitor', () => ({
      fullscreen: !!document.fullscreenElement, showing,
      detail: !showing ? '대기 (재생 중 아님)' : direct ? '편집기 화면 직접 복사' : fallback ? '백업 전송(BroadcastChannel)' : '화면 대기 중',
    }));
    const draw = (now: number) => {
      raf = requestAnimationFrame(draw);
      // The source video is 30 fps. Copying the same full-HD frame at 60/120
      // Hz only burns GPU bandwidth and can stall Chrome during editor reload.
      if (now - lastDrawAt < 1000 / 30) return;
      lastDrawAt = now;
      const dst = canvas.current;
      const sourceWindow = window.opener as SourceWindow | null;
      const src = sourceWindow?.__lieuScreenCanvas;
      if (!dst) return;
      const ctx = dst.getContext('2d');
      if (!ctx) return;
      const active = sourceWindow ? !!sourceWindow.__lieuHardwarePlaybackActive : fallbackActive;
      showing = active;
      if (!active) {
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, dst.width, dst.height);
        return;
      }
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      if (src?.width && src.height) {
        ctx.drawImage(src, 0, 0, dst.width, dst.height);
        reporter.frame();
        lastDirectFrame = now;
        if (!direct) { direct = true; ch?.postMessage('direct'); }
      } else {
        direct = false;
        // Give a refreshing same-origin editor time to publish its new canvas.
        // Only ask for costly ImageBitmap fallback when the direct path has
        // genuinely been unavailable for a while.
        if (now - Math.max(lastDirectFrame, openedAt) > 750 && now - lastFallbackRequest > 1000) {
          ch?.postMessage('fallback-v2');
          lastFallbackRequest = now;
        }
      }
      if (!direct && fallback && now - lastDirectFrame > 100) {
        ctx.drawImage(fallback, 0, 0, dst.width, dst.height);
        reporter.frame();
      }
    };
    raf = requestAnimationFrame(draw);
    return () => { window.clearTimeout(hide); cancelAnimationFrame(raf); fallback?.close(); ch?.close(); reporter.stop(); };
  }, []);

  useEffect(() => {
    const changed = () => setIsFullscreen(!!document.fullscreenElement);
    const releaseFocus = () => {
      // A fullscreen output is a passive display. When macOS/Chrome activates
      // it from the Dock, immediately return focus to the editor instead of
      // leaving the user on a black window that appears frozen.
      if (!document.fullscreenElement) return;
      const editor = window.opener;
      if (editor && !editor.closed) window.setTimeout(() => {
        try { editor.focus(); } catch { /* focus can be browser-restricted */ }
      }, 80);
    };
    document.addEventListener('fullscreenchange', changed);
    window.addEventListener('focus', releaseFocus);
    if (document.hasFocus()) releaseFocus();
    const enter = () => {
      setHint(false);
      void fullscreenOutput(1).catch(() => setFsError('자동 이동이 막혔습니다. 이 창을 TV로 옮긴 뒤 아래 버튼을 다시 눌러주세요.'));
    };
    window.addEventListener('pointerdown', enter, { once: true });
    window.addEventListener('keydown', enter, { once: true });
    return () => { document.removeEventListener('fullscreenchange', changed); window.removeEventListener('focus', releaseFocus); window.removeEventListener('pointerdown', enter); window.removeEventListener('keydown', enter); };
  }, []);

  const enterTv = () => {
    setHint(false); setFsError('');
    void fullscreenOutput(1).catch(() => setFsError('자동 이동이 막혔습니다. 이 창을 TV로 옮긴 뒤 버튼을 다시 눌러주세요.'));
  };

  return (
    <div style={{ position: 'fixed', inset: 0, display: 'grid', placeItems: 'center', overflow: 'hidden', background: '#000', cursor: hint ? 'pointer' : 'none' }}>
      <canvas ref={canvas} width={SCREEN_W} height={SCREEN_H} style={{ display: 'block', width: '100vw', height: '100vh', objectFit: 'contain' }} />
      <DevOverlay source={() => window.opener as Window | null} />
      {hint && <div style={{ position: 'absolute', left: 0, right: 0, bottom: 18, color: '#aaa', textAlign: 'center', font: '14px system-ui' }}>TV 화면을 한 번 클릭하면 완전한 전체화면이 됩니다</div>}
      {!isFullscreen && <div style={{ position: 'absolute', top: import.meta.env.DEV ? 'auto' : 18, bottom: import.meta.env.DEV ? 48 : 'auto', right: 18, display: 'grid', justifyItems: 'end', gap: 8 }}>
        <button onClick={(e) => { e.stopPropagation(); enterTv(); }} style={{ padding: '14px 20px', border: '1px solid rgba(255,255,255,.4)', borderRadius: 5, background: 'rgba(0,0,0,.72)', color: '#fff', font: '600 16px system-ui', cursor: 'pointer' }}>TV로 보내기 · 전체화면</button>
        {fsError && <div style={{ maxWidth: 360, padding: '9px 12px', borderRadius: 4, background: 'rgba(0,0,0,.78)', color: '#fff', font: '13px system-ui' }}>{fsError}</div>}
      </div>}
    </div>
  );
}

