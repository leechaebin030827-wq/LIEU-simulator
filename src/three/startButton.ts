/** Glass "출발" (start) button drawn over the screen still. Pure function of time: scrubbing / looping always gives the same picture. */
export type ButtonTimes = { show: number; pressDown: number; hold: number; release: number; hide: number; gone: number };

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const easeOut = (x: number) => 1 - Math.pow(1 - clamp01(x), 3);
const easeInOut = (x: number) => { const t = clamp01(x); return t * t * (3 - 2 * t); };
const FONT = '-apple-system, "SF Pro Display", "Apple SD Gothic Neo", "Noto Sans KR", "Helvetica Neue", sans-serif';

export const buttonActive = (b: ButtonTimes, t: number) => t >= b.show && t <= b.gone;

/** Draws background `img` plus the button at time t. Returns false (and draws nothing) outside [show, gone]. */
export function drawStartButton(ctx: CanvasRenderingContext2D, W: number, H: number, img: CanvasImageSource, b: ButtonTimes, t: number): boolean {
  if (!buttonActive(b, t)) return false;
  const appear = easeOut((t - b.show) / 0.55);
  const dismiss = easeInOut((t - b.hide) / (b.gone - b.hide));
  const alpha = appear * (1 - dismiss);
  // press: ease down, hold, then a damped spring back (slight overshoot above 1)
  let press = easeInOut((t - b.pressDown) / (b.hold - b.pressDown));
  if (t >= b.release) { const r = t - b.release; press = Math.exp(-7.5 * r) * Math.cos(10 * r); }
  const scale = (0.9 + 0.1 * appear) * (1 - 0.085 * press) * (1 + 0.07 * dismiss);
  const pressed = clamp01(press);

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, W, H);
  ctx.drawImage(img, 0, 0, W, H);
  ctx.fillStyle = `rgba(8,12,24,${0.22 * alpha})`; // dim the scene a little so the glass reads
  ctx.fillRect(0, 0, W, H);

  const cx = W / 2, cy = H / 2, R = W * 0.35;
  ctx.save();
  ctx.translate(cx, cy); ctx.scale(scale, scale); ctx.globalAlpha = alpha;

  // soft drop shadow (tighter when pressed)
  ctx.save();
  ctx.shadowColor = `rgba(10,20,40,${0.38 - 0.14 * pressed})`; ctx.shadowBlur = 70 - 30 * pressed; ctx.shadowOffsetY = 34 - 20 * pressed;
  ctx.fillStyle = 'rgba(255,255,255,0.01)'; ctx.beginPath(); ctx.arc(0, 0, R, 0, Math.PI * 2); ctx.fill();
  ctx.restore();

  // frosted glass: the scene behind, blurred and saturated, clipped to the button
  ctx.save();
  ctx.beginPath(); ctx.arc(0, 0, R, 0, Math.PI * 2); ctx.clip();
  const sx = scale || 1;
  ctx.save(); ctx.scale(1 / sx, 1 / sx); ctx.translate(-cx, -cy);
  try { ctx.filter = 'blur(26px) saturate(1.5) brightness(1.12)'; } catch { /* filter unsupported: plain tint below */ }
  ctx.drawImage(img, -60, -60, W + 120, H + 120);
  ctx.filter = 'none';
  ctx.restore();
  const fill = ctx.createLinearGradient(-R, -R, R, R);
  fill.addColorStop(0, `rgba(255,255,255,${0.34 + 0.12 * pressed})`); fill.addColorStop(1, `rgba(255,255,255,${0.14 + 0.1 * pressed})`);
  ctx.fillStyle = fill; ctx.fillRect(-R, -R, 2 * R, 2 * R);
  // glossy top highlight
  const gloss = ctx.createLinearGradient(0, -R, 0, 0);
  gloss.addColorStop(0, `rgba(255,255,255,${0.42 * (1 - 0.6 * pressed)})`); gloss.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = gloss; ctx.beginPath(); ctx.ellipse(0, -R * 0.52, R * 0.82, R * 0.46, 0, 0, Math.PI * 2); ctx.fill();
  ctx.restore();

  // rim light
  const rim = ctx.createLinearGradient(-R, -R, R, R);
  rim.addColorStop(0, 'rgba(255,255,255,0.95)'); rim.addColorStop(0.45, 'rgba(255,255,255,0.12)'); rim.addColorStop(0.55, 'rgba(255,255,255,0.12)'); rim.addColorStop(1, 'rgba(255,255,255,0.55)');
  ctx.lineWidth = 4; ctx.strokeStyle = rim; ctx.beginPath(); ctx.arc(0, 0, R - 2, 0, Math.PI * 2); ctx.stroke();

  // label
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.shadowColor = 'rgba(10,20,40,0.35)'; ctx.shadowBlur = 18; ctx.shadowOffsetY = 4;
  ctx.fillStyle = 'rgba(255,255,255,0.97)'; ctx.font = `700 ${Math.round(R * 0.44)}px ${FONT}`;
  ctx.fillText('출발', 0, -R * 0.04);
  ctx.shadowColor = 'transparent';
  ctx.fillStyle = 'rgba(255,255,255,0.72)'; ctx.font = `600 ${Math.round(R * 0.12)}px ${FONT}`;
  ctx.fillText('S T A R T', 0, R * 0.36);
  ctx.restore();

  // release ripple
  const rp = (t - b.release) / 0.55;
  if (rp > 0 && rp < 1) {
    ctx.save(); ctx.translate(cx, cy);
    ctx.lineWidth = 6 * (1 - rp); ctx.strokeStyle = `rgba(255,255,255,${0.55 * (1 - rp)})`;
    ctx.beginPath(); ctx.arc(0, 0, R * (1 + 0.55 * easeOut(rp)), 0, Math.PI * 2); ctx.stroke();
    ctx.restore();
  }
  ctx.globalAlpha = 1;
  return true;
}
