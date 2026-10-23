/** Glass "출발" (start) button drawn over the screen still. Pure function of time: scrubbing / looping always gives the same picture. */
export type ButtonTimes = { show: number; pressDown: number; hold: number; release: number; hide: number; gone: number };

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const easeOut = (x: number) => 1 - Math.pow(1 - clamp01(x), 3);
const easeInOut = (x: number) => { const t = clamp01(x); return t * t * (3 - 2 * t); };
const FONT = '"IBM Plex Sans KR", "IBM Plex Sans", -apple-system, "Apple SD Gothic Neo", sans-serif';
// canvas never downloads a webfont by itself: ask once for the glyphs used below
let fontAsked = false;
const askFont = () => { if (fontAsked || typeof document === 'undefined' || !document.fonts) return; fontAsked = true; void document.fonts.load('600 40px "IBM Plex Sans KR"', '출발').catch(() => undefined); void document.fonts.load('500 40px "IBM Plex Sans"', 'START').catch(() => undefined); };

export const buttonActive = (b: ButtonTimes, t: number) => t >= b.show && t <= b.gone;

/**
 * Draws background `img` plus the button at time t. Returns false (and draws nothing) outside [show, gone].
 * Quiet frosted-glass disc: blurred picture behind, hairline rim, "출발" + a small START label, a slow tap-hint ripple while it waits,
 * and a soft press / release. Pure function of time.
 */
export function drawStartButton(ctx: CanvasRenderingContext2D, W: number, H: number, img: CanvasImageSource, b: ButtonTimes, t: number): boolean {
  if (!buttonActive(b, t)) return false;
  askFont();
  const appear = easeOut((t - b.show) / 0.55);
  const dismiss = easeInOut((t - b.hide) / (b.gone - b.hide));
  const alpha = appear * (1 - dismiss);
  // press: ease down, hold, then a damped spring back (slight overshoot above 1)
  let press = easeInOut((t - b.pressDown) / (b.hold - b.pressDown));
  if (t >= b.release) { const r = t - b.release; press = Math.exp(-7.5 * r) * Math.cos(10 * r); }
  const scale = (0.92 + 0.08 * appear) * (1 - 0.06 * press) * (1 + 0.05 * dismiss);
  const pressed = clamp01(press);
  const u = W / 940;

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, W, H);
  ctx.drawImage(img, 0, 0, W, H);

  const cx = W / 2, cy = H / 2, R = W * 0.17;

  // tap hint: a hairline ring that breathes outward while the button waits to be pressed
  if (t < b.pressDown) {
    const ph = ((t - b.show) / 1.9) % 1;
    ctx.save(); ctx.translate(cx, cy); ctx.globalAlpha = alpha * 0.5 * (1 - ph) * easeOut((t - b.show) / 0.8);
    ctx.lineWidth = 2 * u; ctx.strokeStyle = '#fff';
    ctx.beginPath(); ctx.arc(0, 0, R * scale * (1.08 + 0.55 * easeOut(ph)), 0, Math.PI * 2); ctx.stroke(); ctx.restore();
  }

  ctx.save();
  ctx.translate(cx, cy); ctx.scale(scale, scale); ctx.globalAlpha = alpha;

  // soft shadow (tighter when pressed)
  ctx.save();
  ctx.shadowColor = `rgba(8,14,28,${0.34 - 0.12 * pressed})`; ctx.shadowBlur = 60 * u - 24 * u * pressed; ctx.shadowOffsetY = 26 * u - 14 * u * pressed;
  ctx.fillStyle = 'rgba(255,255,255,0.01)'; ctx.beginPath(); ctx.arc(0, 0, R, 0, Math.PI * 2); ctx.fill();
  ctx.restore();

  // frosted glass: the picture behind, blurred and saturated, clipped to the disc
  ctx.save();
  ctx.beginPath(); ctx.arc(0, 0, R, 0, Math.PI * 2); ctx.clip();
  ctx.save(); ctx.scale(1 / scale, 1 / scale); ctx.translate(-cx, -cy);
  try { ctx.filter = `blur(${7 * u}px) saturate(1.5) brightness(1.05)`; } catch { /* filter unsupported: plain tint below */ }
  ctx.drawImage(img, -60, -60, W + 120, H + 120);
  ctx.filter = 'none';
  ctx.restore();
  const tone = ctx.createLinearGradient(0, -R, 0, R);
  tone.addColorStop(0, `rgba(255,255,255,${0.14 + 0.12 * pressed})`); tone.addColorStop(0.55, `rgba(14,20,34,${0.03})`); tone.addColorStop(1, `rgba(14,20,34,${0.15 - 0.08 * pressed})`);
  ctx.fillStyle = tone; ctx.fillRect(-R, -R, 2 * R, 2 * R);
  ctx.restore();

  // hairline rim + a thin inner highlight along the top edge
  const rim = ctx.createLinearGradient(-R, -R, R, R);
  rim.addColorStop(0, 'rgba(255,255,255,0.8)'); rim.addColorStop(0.4, 'rgba(255,255,255,0.16)'); rim.addColorStop(0.7, 'rgba(255,255,255,0.12)'); rim.addColorStop(1, 'rgba(255,255,255,0.45)');
  ctx.lineWidth = 2.5 * u; ctx.strokeStyle = rim; ctx.beginPath(); ctx.arc(0, 0, R - 1.5 * u, 0, Math.PI * 2); ctx.stroke();
  const hi = ctx.createLinearGradient(0, -R, 0, 0);
  hi.addColorStop(0, 'rgba(255,255,255,0.5)'); hi.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.lineWidth = 4 * u; ctx.strokeStyle = hi; ctx.beginPath(); ctx.arc(0, 0, R - 6 * u, Math.PI * 1.08, Math.PI * 1.92); ctx.stroke();

  // label
  ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
  ctx.shadowColor = 'rgba(8,14,28,0.3)'; ctx.shadowBlur = 14 * u; ctx.shadowOffsetY = 3 * u;
  ctx.fillStyle = '#fff'; ctx.font = `600 ${Math.round(R * 0.5)}px ${FONT}`;
  if ('letterSpacing' in ctx) (ctx as unknown as { letterSpacing: string }).letterSpacing = `${-1 * u}px`;
  ctx.fillText('출발', 0, R * 0.12);
  ctx.shadowColor = 'transparent';
  ctx.fillStyle = 'rgba(255,255,255,0.7)'; ctx.font = `500 ${Math.round(R * 0.12)}px "IBM Plex Sans", ${FONT}`;
  if ('letterSpacing' in ctx) (ctx as unknown as { letterSpacing: string }).letterSpacing = `${R * 0.045}px`;
  ctx.fillText('START', R * 0.02, R * 0.46);
  if ('letterSpacing' in ctx) (ctx as unknown as { letterSpacing: string }).letterSpacing = '0px';
  ctx.restore();

  // release ripple
  const rp = (t - b.release) / 0.55;
  if (rp > 0 && rp < 1) {
    ctx.save(); ctx.translate(cx, cy);
    ctx.lineWidth = 3 * u * (1 - rp); ctx.strokeStyle = `rgba(255,255,255,${0.6 * (1 - rp)})`;
    ctx.beginPath(); ctx.arc(0, 0, R * (1 + 0.6 * easeOut(rp)), 0, Math.PI * 2); ctx.stroke();
    ctx.restore();
  }
  ctx.globalAlpha = 1;
  return true;
}
