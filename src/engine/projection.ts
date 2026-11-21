export type Point3 = readonly [number, number, number];

/** Projector optical axis is mechanically fixed to world-down; only its origin may move. */
export function downwardFloorHit(origin: Point3, floorY: number): [number, number, number] | null {
  return floorY < origin[1] ? [origin[0], floorY, origin[2]] : null;
}
