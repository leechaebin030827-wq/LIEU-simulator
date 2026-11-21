import { useEffect, useRef, useSyncExternalStore } from 'react';
import { useStore } from '../store';
import { SCREEN_H, SCREEN_W, screenOut } from '../three/screenOut';
import { DevOverlay } from './DevOverlay';
import { getHwStatus, subscribeHw } from '../runtime/hardware';
import { hardwareOutputsEnabled, subscribeHardwareOutputs } from '../runtime/outputGate';

/** Full-screen mirror only during physical playback; preview stays in the 3D editor. */
export function FinalMonitor() {
  const playingFinal = useStore((s) => s.playing && s.seq.id === '08_exhibition_final');
  const hardwareConnected = useSyncExternalStore(subscribeHw, () => getHwStatus().connected, () => false);
  const outputsEnabled = useSyncExternalStore(subscribeHardwareOutputs, hardwareOutputsEnabled, () => false);
  const active = playingFinal && hardwareConnected && outputsEnabled;
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!active) return;
    let raf = 0, last = -Infinity;
    const draw = (now: number) => {
      raf = requestAnimationFrame(draw);
      if (now - last < 1000 / 30) return;
      last = now;
      const dst = canvas.current;
      const ctx = dst?.getContext('2d');
      if (!dst || !ctx) return;
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(screenOut.canvas, 0, 0, dst.width, dst.height);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [active]);

  if (!active) return null;
  return <div className="final-monitor"><canvas ref={canvas} width={SCREEN_W} height={SCREEN_H} /><DevOverlay source={() => window} /></div>;
}
