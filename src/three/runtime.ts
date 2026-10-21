import { Matrix4, type Mesh } from 'three';
import type { DesiredState } from '../engine/types';
import type { StageMatrices } from '../engine/rig';

/** Per-frame render-side snapshot shared between scene components (render layer only, no authoring state). */
/** Shell mesh (node 135) at rest pose, used to seat the eye dots on the outer surface. */
export const shell: { mesh: Mesh | null; rest: Matrix4 | null; surface: import('./eyeSurface').EyeSurface | null } = { mesh: null, rest: null, surface: null };
export const frame: { stages: StageMatrices | null; state: DesiredState | null } = { stages: null, state: null };
export const IDENT = new Matrix4();
