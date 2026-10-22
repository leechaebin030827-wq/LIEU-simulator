import type { Project } from './engine/types';
import { evaluateEye } from './engine/controller';
import { generateMatrixFrame, drawMatrix } from './render/matrixRenderer';
import { buildEye, drawFreeform, setRoundQuality } from './render/freeformRenderer';
import { drawHalftone } from './render/halftoneRenderer';

export const BG = '#0b0d10';

/** Render one frame of the project at time t (ms) into a canvas context of CSS size W×H. */
export function drawAt(ctx: CanvasRenderingContext2D, W: number, H: number, project: Project, t: number, bg = BG, compact = false) {
  const f = evaluateEye(project, t, project.mode);
  if (project.mode === 'matrix') {
    const mf = generateMatrixFrame(f, project.matrix.geometry);
    drawMatrix(ctx, W, H, mf, project.matrix.physical, { zoom: 1.1, panX: 0, panY: 0, bg, grid: true, compact: true });
  } else {
    setRoundQuality(compact ? 50 : 220);
    const g = project.freeform.geometry;
    const eyes = [buildEye('L', f, g), buildEye('R', f, g)];
    const view = { zoom: 1.25, panX: 0, panY: 0, bg, grid: false, showOutline: false, showPoints: false };
    const sym = f.symbol ? { id: f.symbol.id, w: f.symbol.w, t: f.t, closure: [f.closureL, f.closureR] as [number, number] } : undefined;
    if (project.variant) drawHalftone(ctx, W, H, eyes, g, view, sym, compact, project.variant === 'halftoneGrid' ? 'grid' : 'smooth');
    else drawFreeform(ctx, W, H, eyes, g, view, null, sym);
  }
}
