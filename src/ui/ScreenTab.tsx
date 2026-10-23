import { useEffect, useRef } from 'react';
import { screenOut, SCREEN_W, SCREEN_H } from '../three/screenOut';

/** Independent 9:16 view of the TV picture (mirrors exactly what the 3D screen shows). */
export function ScreenTab() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    let raf = 0;
    const loop = () => { const c = ref.current?.getContext('2d'); if (c) c.drawImage(screenOut.canvas, 0, 0); raf = requestAnimationFrame(loop); };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);
  return (
    <div className="scrtab">
      <div className="scrframe" title="TV screen · 9:16 — same picture as on the 3D screen"><canvas ref={ref} width={SCREEN_W} height={SCREEN_H} /></div>
      <p className="scrnote">TV screen · 9:16<br />Video, start button and scenario indicator, exactly as shown on the 3D TV.</p>
    </div>
  );
}
