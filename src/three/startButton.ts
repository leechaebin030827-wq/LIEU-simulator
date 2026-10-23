/** Glass "출발" (start) button drawn over the screen still. Pure function of time: scrubbing / looping always gives the same picture. */
export type ButtonTimes = { show: number; pressDown: number; hold: number; release: number; hide: number; gone: number };

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const easeOut = (x: number) => 1 - Math.pow(1 - clamp01(x), 3);
const easeInOut = (x: number) => { const t = clamp01(x); return t * t * (3 - 2 * t); };
const FONT = '"IBM Plex Sans KR", "IBM Plex Sans", -apple-system, "Apple SD Gothic Neo", sans-serif';
// canvas never downloads a webfont by itself: ask once for the glyphs used below
let fontAsked = false;
const askFont = () => { if (fontAsked || typeof document === 'undefined' || !document.fonts) return; fontAsked = true; void document.fonts.load('600 40px "IBM Plex Sans KR"', '출발').catch(() => undefined); void document.fonts.load('500 40px "IBM Plex Sans KR"', '목적지서울역도착예정분').catch(() => undefined); void document.fonts.load('600 40px "IBM Plex Sans"', '14').catch(() => undefined); };

export const buttonActive = (b: ButtonTimes, t: number) => t >= b.show && t <= b.gone;

const DEST = { name: '서울역', eta: '14', etaUnit: '분' };

function rr(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) { ctx.beginPath(); ctx.roundRect(x, y, w, h, r); }

/** Frosted-glass rounded rectangle over the picture: blurred copy of the still, faint white tint, hairline rim with a specular falloff. */
function glassBox(ctx: CanvasRenderingContext2D, img: CanvasImageSource, W: number, H: number, x: number, y: number, w: number, h: number, r: number, u: number, lit: number) {
  ctx.save(); ctx.shadowColor = `rgba(8,14,28,${0.26 - 0.1 * lit})`; ctx.shadowBlur = 46 * u; ctx.shadowOffsetY = 16 * u; rr(ctx, x, y, w, h, r); ctx.fillStyle = 'rgba(255,255,255,0.01)'; ctx.fill(); ctx.restore();
  ctx.save(); rr(ctx, x, y, w, h, r); ctx.clip();
  try { ctx.filter = `blur(${9 * u}px) saturate(1.5) brightness(1.06)`; } catch { /* tint only */ }
  ctx.drawImage(img, -40, -40, W + 80, H + 80); ctx.filter = 'none';
  const tone = ctx.createLinearGradient(0, y, 0, y + h);
  tone.addColorStop(0, `rgba(255,255,255,${0.2 + 0.16 * lit})`); tone.addColorStop(1, `rgba(255,255,255,${0.1 + 0.14 * lit})`);
  ctx.fillStyle = tone; ctx.fillRect(x, y, w, h);
  ctx.restore();
  const rim = ctx.createLinearGradient(x, y, x + w, y + h);
  rim.addColorStop(0, 'rgba(255,255,255,0.8)'); rim.addColorStop(0.4, 'rgba(255,255,255,0.22)'); rim.addColorStop(0.7, 'rgba(255,255,255,0.18)'); rim.addColorStop(1, 'rgba(255,255,255,0.5)');
  rr(ctx, x + 1.5 * u, y + 1.5 * u, w - 3 * u, h - 3 * u, r - 1.5 * u); ctx.lineWidth = 2.5 * u; ctx.strokeStyle = rim; ctx.stroke();
}

let mapLayer: HTMLCanvasElement | null = null;
/** Route map as white line art straight on the picture (no card): faint streets, a river, the route, here and the destination. Edges fade out. */
function drawMap(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, u: number, t: number, pulse: number) {
  if (!mapLayer || mapLayer.width !== Math.round(w) || mapLayer.height !== Math.round(h)) { mapLayer = document.createElement('canvas'); mapLayer.width = Math.round(w); mapLayer.height = Math.round(h); }
  const m = mapLayer.getContext('2d')!;
  m.setTransform(1, 0, 0, 1, 0, 0); m.clearRect(0, 0, w, h);
  m.lineCap = 'round'; m.lineJoin = 'round';
  // streets
  m.strokeStyle = 'rgba(255,255,255,0.15)'; m.lineWidth = 2.5 * u;
  for (const gx of [0.08, 0.2, 0.35, 0.5, 0.65, 0.8, 0.92]) { m.beginPath(); m.moveTo(w * gx, 0); m.lineTo(w * gx, h); m.stroke(); }
  for (const gy of [0.08, 0.22, 0.36, 0.5, 0.65, 0.8, 0.92]) { m.beginPath(); m.moveTo(0, h * gy); m.lineTo(w, h * gy); m.stroke(); }
  m.strokeStyle = 'rgba(255,255,255,0.26)'; m.lineWidth = 4 * u;
  for (const gx of [0.2, 0.5, 0.8]) { m.beginPath(); m.moveTo(w * gx, 0); m.lineTo(w * gx, h); m.stroke(); }
  for (const gy of [0.22, 0.5, 0.8]) { m.beginPath(); m.moveTo(0, h * gy); m.lineTo(w, h * gy); m.stroke(); }
  // river
  m.strokeStyle = 'rgba(255,255,255,0.16)'; m.lineWidth = 46 * u;
  m.beginPath(); m.moveTo(-30 * u, h * 0.78); m.bezierCurveTo(w * 0.3, h * 0.62, w * 0.55, h * 0.95, w + 30 * u, h * 0.55); m.stroke();
  // route
  const pts: [number, number][] = [[w * 0.2, h * 0.9], [w * 0.2, h * 0.5], [w * 0.5, h * 0.5], [w * 0.5, h * 0.22], [w * 0.8, h * 0.22], [w * 0.8, h * 0.12]];
  const path = () => { m.beginPath(); pts.forEach(([px, py], k) => (k ? m.lineTo(px, py) : m.moveTo(px, py))); };
  m.save(); m.shadowColor = 'rgba(255,255,255,0.55)'; m.shadowBlur = 18 * u; path(); m.strokeStyle = '#fff'; m.lineWidth = 11 * u; m.stroke(); m.restore();
  path(); m.strokeStyle = 'rgba(255,255,255,0.95)'; m.lineWidth = 11 * u; m.stroke();
  path(); m.strokeStyle = 'rgba(40,60,90,0.55)'; m.lineWidth = 3.5 * u; m.setLineDash([2 * u, 26 * u]); m.lineDashOffset = -t * 60 * u; m.stroke(); m.setLineDash([]);
  // here: ring
  m.beginPath(); m.arc(pts[0][0], pts[0][1], 15 * u, 0, Math.PI * 2); m.fillStyle = 'rgba(255,255,255,0.25)'; m.fill(); m.lineWidth = 5 * u; m.strokeStyle = '#fff'; m.stroke();
  // destination: white pin with a soft pulse
  const [dx, dy] = pts[pts.length - 1];
  m.beginPath(); m.arc(dx, dy, (24 + 44 * pulse) * u, 0, Math.PI * 2); m.strokeStyle = `rgba(255,255,255,${0.7 * (1 - pulse)})`; m.lineWidth = 3 * u; m.stroke();
  m.save(); m.shadowColor = 'rgba(0,0,0,0.3)'; m.shadowBlur = 14 * u; m.beginPath(); m.arc(dx, dy, 25 * u, 0, Math.PI * 2); m.fillStyle = '#fff'; m.fill(); m.restore();
  m.beginPath(); m.arc(dx, dy, 9 * u, 0, Math.PI * 2); m.fillStyle = 'rgba(40,60,90,0.7)'; m.fill();
  // fade the edges so it floats on the picture
  m.globalCompositeOperation = 'destination-in';
  const gx = m.createLinearGradient(0, 0, w, 0); gx.addColorStop(0, 'rgba(0,0,0,0)'); gx.addColorStop(0.1, 'rgba(0,0,0,1)'); gx.addColorStop(0.9, 'rgba(0,0,0,1)'); gx.addColorStop(1, 'rgba(0,0,0,0)');
  m.fillStyle = gx; m.fillRect(0, 0, w, h);
  const gy = m.createLinearGradient(0, 0, 0, h); gy.addColorStop(0, 'rgba(0,0,0,0)'); gy.addColorStop(0.12, 'rgba(0,0,0,1)'); gy.addColorStop(0.88, 'rgba(0,0,0,1)'); gy.addColorStop(1, 'rgba(0,0,0,0)');
  m.fillStyle = gy; m.fillRect(0, 0, w, h);
  m.globalCompositeOperation = 'source-over';
  ctx.drawImage(mapLayer, x, y, w, h);
}

/**
 * The in-cabin "ready to go" screen, in the style of robotaxi ride screens but kept minimal and all white: destination + ETA as plain type, a white
 * line-art route map straight on the picture, and one frosted-glass rounded-rectangle Start button under it — the only boxed element.
 * The scenario caption card sits above. Press: the glass lights up and dips, a ring runs out from its edge; then the sheet slides away. Returns false outside [show, gone].
 */
export function drawStartButton(ctx: CanvasRenderingContext2D, W: number, H: number, img: CanvasImageSource, b: ButtonTimes, t: number): boolean {
  if (!buttonActive(b, t)) return false;
  askFont();
  const appear = easeOut((t - b.show) / 0.6);
  const dismiss = easeInOut((t - b.hide) / (b.gone - b.hide));
  const alpha = appear * (1 - dismiss);
  let press = easeInOut((t - b.pressDown) / (b.hold - b.pressDown));
  if (t >= b.release) { const r = t - b.release; press = Math.exp(-7.5 * r) * Math.cos(10 * r); }
  const pressed = clamp01(press);
  const u = W / 940;
  const lift = (1 - appear) * 46 * u + dismiss * 30 * u;       // slides up into place, drops away when dismissed

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, W, H);
  ctx.drawImage(img, 0, 0, W, H);
  ctx.fillStyle = `rgba(8,14,28,${0.3 * alpha})`; ctx.fillRect(0, 0, W, H);   // calm the scene a little so the white type reads

  const X = 64 * u, CW = W - 128 * u;
  ctx.save(); ctx.globalAlpha = alpha; ctx.translate(0, lift);
  ctx.textBaseline = 'alphabetic';
  ctx.shadowColor = 'rgba(8,14,28,0.55)'; ctx.shadowBlur = 20 * u; ctx.shadowOffsetY = 3 * u;

  // destination: type only
  const dy = H * 0.292;
  ctx.textAlign = 'left';
  ctx.fillStyle = 'rgba(255,255,255,0.92)'; ctx.font = `600 ${25 * u}px ${FONT}`; ctx.fillText('목적지', X, dy);
  ctx.fillStyle = '#fff'; ctx.font = `600 ${68 * u}px ${FONT}`; if ('letterSpacing' in ctx) (ctx as unknown as { letterSpacing: string }).letterSpacing = `${-1.5 * u}px`;
  ctx.fillText(DEST.name, X, dy + 72 * u);
  ctx.textAlign = 'right';
  ctx.fillStyle = 'rgba(255,255,255,0.92)'; ctx.font = `600 ${25 * u}px ${FONT}`; if ('letterSpacing' in ctx) (ctx as unknown as { letterSpacing: string }).letterSpacing = '0px';
  ctx.fillText('도착 예정', X + CW, dy);
  ctx.fillStyle = '#fff'; ctx.font = `600 ${68 * u}px ${FONT}`; if ('letterSpacing' in ctx) (ctx as unknown as { letterSpacing: string }).letterSpacing = `${-1.5 * u}px`;
  ctx.fillText(`${DEST.eta}${DEST.etaUnit}`, X + CW, dy + 72 * u);
  if ('letterSpacing' in ctx) (ctx as unknown as { letterSpacing: string }).letterSpacing = '0px';

  // route map: white line art
  const my = dy + 112 * u, mh = H * 0.31;
  ctx.shadowColor = 'transparent';
  drawMap(ctx, X - 20 * u, my, CW + 40 * u, mh, u, t, ((t - b.show) / 2.2) % 1);

  // the one boxed element: a wide frosted-glass rounded-rectangle Start button
  const by = my + mh + 24 * u, bh = 142 * u, sc = 1 - 0.035 * pressed;
  const bw = CW * sc, bx = X + (CW - bw) / 2, bhh = bh * sc, byy = by + (bh - bhh) / 2 + 5 * u * pressed;
  glassBox(ctx, img, W, H, bx, byy, bw, bhh, 46 * u, u, pressed);
  ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.shadowColor = 'rgba(8,14,28,0.3)'; ctx.shadowBlur = 12 * u; ctx.shadowOffsetY = 2 * u;
  ctx.font = `600 ${56 * u}px ${FONT}`; if ('letterSpacing' in ctx) (ctx as unknown as { letterSpacing: string }).letterSpacing = `${-1 * u}px`;
  ctx.fillText('출발', W / 2 - 34 * u, byy + bhh / 2 + 3 * u);
  if ('letterSpacing' in ctx) (ctx as unknown as { letterSpacing: string }).letterSpacing = '0px';
  const cx0 = W / 2 + 60 * u, cy0 = byy + bhh / 2;
  ctx.strokeStyle = '#fff'; ctx.lineWidth = 6.5 * u; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.beginPath(); ctx.moveTo(cx0 - 10 * u, cy0 - 17 * u); ctx.lineTo(cx0 + 10 * u, cy0); ctx.lineTo(cx0 - 10 * u, cy0 + 17 * u); ctx.stroke();
  ctx.shadowColor = 'transparent';
  // tap hint: a hairline ring breathing out of the button while it waits
  if (t < b.pressDown) {
    const ph = ((t - b.show) / 1.8) % 1;
    ctx.save(); ctx.globalAlpha *= 0.6 * (1 - ph) * easeOut((t - b.show) / 0.9); ctx.strokeStyle = '#fff'; ctx.lineWidth = 3 * u;
    rr(ctx, bx - 14 * u * ph, byy - 14 * u * ph, bw + 28 * u * ph, bhh + 28 * u * ph, (46 + 14 * ph) * u); ctx.stroke(); ctx.restore();
  }
  const rp = (t - b.release) / 0.55;
  if (rp > 0 && rp < 1) {
    ctx.save(); ctx.globalAlpha *= 0.75 * (1 - rp); ctx.strokeStyle = '#fff'; ctx.lineWidth = 4 * u * (1 - rp);
    const e = 26 * u * easeOut(rp); rr(ctx, bx - e, byy - e, bw + 2 * e, bhh + 2 * e, 46 * u + e); ctx.stroke(); ctx.restore();
  }
  ctx.restore();
  ctx.globalAlpha = 1;
  return true;
}
