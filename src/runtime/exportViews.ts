/** Multi-view video layout (16:9): one full-height vertical close-up on the left, four other viewpoints in a 2x2 grid beside it, a slim info bar under the grid. */
export type V3 = [number, number, number];
export type CamPose = { pos: V3; target: V3; up?: V3; fov: number };
export type Rect = { x: number; y: number; w: number; h: number };
export type ViewDef = { id: string; label: string; sub: string; rect: Rect; pose: (m: { railX: number; liftY: number }) => CamPose };

export const SIZES = { '1080p': { w: 1920, h: 1080 }, '720p': { w: 1280, h: 720 } } as const;
export type SizeKey = keyof typeof SIZES;

/** All geometry is laid out for 1080p and scaled. */
export function layout(size: SizeKey) {
  const { w, h } = SIZES[size], k = h / 1080;
  const left = Math.round(608 * k), bar = Math.round(56 * k), gap = Math.max(2, Math.round(3 * k));
  const rw = w - left, cw = Math.floor(rw / 2), ch = Math.floor((h - bar) / 2);
  const cells: Rect[] = [
    { x: left, y: 0, w: cw, h: ch }, { x: left + cw, y: 0, w: rw - cw, h: ch },
    { x: left, y: ch, w: cw, h: ch }, { x: left + cw, y: ch, w: rw - cw, h: ch },
  ];
  return { w, h, k, gap, bar, closeup: { x: 0, y: 0, w: left, h } as Rect, cells, barRect: { x: left, y: h - bar, w: rw, h: bar } as Rect };
}

/** World: +X = the way Lieu faces (eye side), +Y up, floor at y = -1.488. The close-up follows the carriage so the face stays framed while it rides the rail. */
export function views(size: SizeKey): ViewDef[] {
  const L = layout(size);
  return [
    // full-height vertical close-up: straight at the face from the front, camera a little below the eyes looking up (low angle)
    { id: 'closeup', label: 'CLOSE-UP', sub: 'FRONT · LOW ANGLE', rect: L.closeup,
      pose: (m) => ({ pos: [m.railX + 0.62, -0.15 + m.liftY, 0], target: [m.railX, 0.035 + m.liftY, 0], fov: 32 }) },
    { id: 'three', label: '3/4 FRONT', sub: 'WHOLE UNIT', rect: L.cells[0], pose: () => ({ pos: [1.35, -0.15, -1.75], target: [-0.35, -0.55, 0], fov: 38 }) },
    { id: 'side', label: 'SIDE', sub: 'RAIL TRAVEL', rect: L.cells[1], pose: () => ({ pos: [-0.12, -0.45, 2.3], target: [-0.12, -0.45, 0], fov: 36 }) },
    { id: 'top', label: 'TOP', sub: 'YAW · RAIL', rect: L.cells[2], pose: () => ({ pos: [-0.13, 1.7, 0.001], target: [-0.13, 0, 0], up: [1, 0, 0], fov: 36 }) },
    { id: 'floor', label: 'FLOOR', sub: 'PROJECTION', rect: L.cells[3], pose: () => ({ pos: [1.25, -0.75, -1.25], target: [0.35, -1.42, 0], fov: 40 }) },
  ];
}
