import type { Camera, Scene, WebGLRenderer } from 'three';

/** Handles to the live r3f renderer, registered by the Viewport so the video exporter can draw extra camera views with the very same scene. */
export const bridge: { gl: WebGLRenderer | null; scene: Scene | null; camera: Camera | null; advance: ((timestamp: number, runGlobalEffects?: boolean) => void) | null } =
  { gl: null, scene: null, camera: null, advance: null };
