import * as THREE from 'three';
import led from '../../config/LIEU_LED_Calibration.json';

/**
 * Smooth height-field of the shell's OUTER surface over the eye region, built by rasterizing the outward-facing shell
 * triangles along -X. LED holes and the CAD domes inside them are detected (they lie below the local surface) and filled
 * from their surroundings. Used to (1) cover every hole with a flush, smoothly shaded patch and (2) seat the lit dots.
 */
const Y0 = -0.020, Y1 = 0.016, Z0 = -0.048, Z1 = 0.048, STEP = 0.0004;
const NY = Math.round((Y1 - Y0) / STEP) + 1, NZ = Math.round((Z1 - Z0) / STEP) + 1;
const NONE = -1e9;

export type EyeSurface = {
  patch: THREE.BufferGeometry;
  sample: (y: number, z: number) => { pos: [number, number, number]; normal: THREE.Vector3 } | null;
};

export function buildEyeSurface(shells: { mesh: THREE.Mesh; rest: THREE.Matrix4 }[]): EyeSurface | null {
  const X = new Float32Array(NY * NZ).fill(NONE);
  const idx = (iy: number, iz: number) => iy * NZ + iz;
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), e1 = new THREE.Vector3(), e2 = new THREE.Vector3();
  for (const { mesh, rest } of shells) {
    const g = mesh.geometry as THREE.BufferGeometry;
    const pos = g.getAttribute('position'), index = g.getIndex();
    const tri = (i0: number, i1: number, i2: number) => {
      a.fromBufferAttribute(pos, i0).applyMatrix4(rest); b.fromBufferAttribute(pos, i1).applyMatrix4(rest); c.fromBufferAttribute(pos, i2).applyMatrix4(rest);
      if (Math.max(a.x, b.x, c.x) < 0.09 || Math.min(a.y, b.y, c.y) > Y1 || Math.max(a.y, b.y, c.y) < Y0 || Math.min(a.z, b.z, c.z) > Z1 || Math.max(a.z, b.z, c.z) < Z0) return;
      e1.subVectors(b, a); e2.subVectors(c, a);
      const nx = e1.y * e2.z - e1.z * e2.y; // x component of the face normal (unnormalized)
      const len = e1.clone().cross(e2).length() || 1;
      if (Math.abs(nx) / len < 0.1) return; // walls / steep: skip
      // 2-D barycentric raster in (y,z)
      const d = (b.y - a.y) * (c.z - a.z) - (c.y - a.y) * (b.z - a.z);
      if (Math.abs(d) < 1e-14) return;
      const minY = Math.max(0, Math.floor((Math.min(a.y, b.y, c.y) - Y0) / STEP)), maxY = Math.min(NY - 1, Math.ceil((Math.max(a.y, b.y, c.y) - Y0) / STEP));
      const minZ = Math.max(0, Math.floor((Math.min(a.z, b.z, c.z) - Z0) / STEP)), maxZ = Math.min(NZ - 1, Math.ceil((Math.max(a.z, b.z, c.z) - Z0) / STEP));
      for (let iy = minY; iy <= maxY; iy++) {
        const y = Y0 + iy * STEP;
        for (let iz = minZ; iz <= maxZ; iz++) {
          const z = Z0 + iz * STEP;
          const l1 = ((y - a.y) * (c.z - a.z) - (c.y - a.y) * (z - a.z)) / d;
          const l2 = ((b.y - a.y) * (z - a.z) - (y - a.y) * (b.z - a.z)) / d;
          if (l1 < -1e-6 || l2 < -1e-6 || l1 + l2 > 1 + 1e-6) continue;
          const x = a.x + l1 * (b.x - a.x) + l2 * (c.x - a.x);
          if (x > X[idx(iy, iz)]) X[idx(iy, iz)] = x;
        }
      }
    };
    if (index) for (let t = 0; t < index.count; t += 3) tri(index.getX(t), index.getX(t + 1), index.getX(t + 2));
    else for (let t = 0; t < pos.count; t += 3) tri(t, t + 1, t + 2);
  }

  // The shell is smooth over the eye footprint, so fit a low-order polynomial x(y,z) per eye to the rasterized outer surface,
  // rejecting hole cells (domes / floors lie below the surface) iteratively. This gives a perfectly smooth patch surface.
  const deg = 4;
  const terms: [number, number][] = [];
  for (let i = 0; i <= deg; i++) for (let j = 0; i + j <= deg; j++) terms.push([i, j]);
  const T = terms.length;
  const polys: { yLo: number; yHi: number; zLo: number; zHi: number; coef: Float64Array; yc: number; zc: number }[] = [];
  for (const e of led.eyes) {
    const ys = e.pixels.map((p) => p.worldPositionMeters[1]), zs = e.pixels.map((p) => p.worldPositionMeters[2]);
    const yLo = Math.min(...ys) - 0.0085, yHi = Math.max(...ys) + 0.0035, zLo = Math.min(...zs) - 0.0035, zHi = Math.max(...zs) + 0.0035;
    const yc = (yLo + yHi) / 2, zc = (zLo + zHi) / 2;
    const cells: { u: number; v: number; x: number; k: number }[] = [];
    for (let iy = 0; iy < NY; iy++) for (let iz = 0; iz < NZ; iz++) {
      const y = Y0 + iy * STEP, z = Z0 + iz * STEP;
      if (y < yLo - 0.002 || y > yHi + 0.002 || z < zLo - 0.002 || z > zHi + 0.002) continue;
      const k = idx(iy, iz); if (X[k] === NONE) continue;
      cells.push({ u: (y - yc) / 0.01, v: (z - zc) / 0.03, x: X[k], k });
    }
    const coef = new Float64Array(T);
    let use = cells.map(() => true);
    for (let it = 0; it < 8; it++) {
      const A = Array.from({ length: T }, () => new Float64Array(T + 1));
      cells.forEach((c, ci) => {
        if (!use[ci]) return;
        const f = terms.map(([i, j]) => Math.pow(c.u, i) * Math.pow(c.v, j));
        for (let r = 0; r < T; r++) { for (let q = 0; q < T; q++) A[r][q] += f[r] * f[q]; A[r][T] += f[r] * c.x; }
      });
      for (let col = 0; col < T; col++) { // Gaussian elimination with partial pivoting
        let piv = col; for (let r = col + 1; r < T; r++) if (Math.abs(A[r][col]) > Math.abs(A[piv][col])) piv = r;
        [A[col], A[piv]] = [A[piv], A[col]];
        const d = A[col][col] || 1e-18;
        for (let r = col + 1; r < T; r++) { const f = A[r][col] / d; for (let q = col; q <= T; q++) A[r][q] -= f * A[col][q]; }
      }
      for (let r = T - 1; r >= 0; r--) { let sum = A[r][T]; for (let q = r + 1; q < T; q++) sum -= A[r][q] * coef[q]; coef[r] = sum / (A[r][r] || 1e-18); }
      // reject holes (well below the fit) and spikes (well above)
      const tol = it < 3 ? 0.0004 : 0.00012;
      let changed = false;
      cells.forEach((c, ci) => {
        const fx = terms.reduce((acc, [i, j], ti) => acc + coef[ti] * Math.pow(c.u, i) * Math.pow(c.v, j), 0);
        const keep = c.x - fx > -tol && c.x - fx < tol * 0.6;
        if (keep !== use[ci]) { use[ci] = keep; changed = true; }
      });
      if (!changed && it > 3) break;
    }
    polys.push({ yLo, yHi, zLo, zHi, coef, yc, zc });
  }
  const polyAt = (y: number, z: number): number | null => {
    for (const p of polys) {
      if (y < p.yLo || y > p.yHi || z < p.zLo || z > p.zHi) continue;
      const u = (y - p.yc) / 0.01, v = (z - p.zc) / 0.03;
      return terms.reduce((acc, [i, j], ti) => acc + p.coef[ti] * Math.pow(u, i) * Math.pow(v, j), 0);
    }
    return null;
  };
  // Replace the grid heights inside the eye footprints with the fitted smooth surface
  for (let iy = 0; iy < NY; iy++) for (let iz = 0; iz < NZ; iz++) {
    const v = polyAt(Y0 + iy * STEP, Z0 + iz * STEP);
    if (v !== null) X[idx(iy, iz)] = v;
  }

  const at = (iy: number, iz: number) => X[idx(Math.min(NY - 1, Math.max(0, iy)), Math.min(NZ - 1, Math.max(0, iz)))];
  const normalAt = (iy: number, iz: number) => {
    const dxdy = (at(iy + 1, iz) - at(iy - 1, iz)) / (2 * STEP), dxdz = (at(iy, iz + 1) - at(iy, iz - 1)) / (2 * STEP);
    return new THREE.Vector3(1, -dxdy, -dxdz).normalize();
  };
  const sample = (y: number, z: number) => {
    const fy = (y - Y0) / STEP, fz = (z - Z0) / STEP;
    const iy = Math.round(fy), iz = Math.round(fz);
    if (iy < 1 || iz < 1 || iy >= NY - 1 || iz >= NZ - 1 || X[idx(iy, iz)] === NONE) return null;
    // bilinear height
    const y0 = Math.floor(fy), z0 = Math.floor(fz), ty = fy - y0, tz = fz - z0;
    const x = at(y0, z0) * (1 - ty) * (1 - tz) + at(y0 + 1, z0) * ty * (1 - tz) + at(y0, z0 + 1) * (1 - ty) * tz + at(y0 + 1, z0 + 1) * ty * tz;
    return { pos: [x, y, z] as [number, number, number], normal: normalAt(iy, iz) };
  };

  // Patch: the eye-matrix footprint of each eye (chip bounding box grown to include the holes drilled along the curved shell normal,
  // which sit lower than the chips on the lower rows), rounded to cells.
  const inPatch = new Uint8Array(NY * NZ);
  for (const e of led.eyes) {
    const ys = e.pixels.map((p) => p.worldPositionMeters[1]), zs = e.pixels.map((p) => p.worldPositionMeters[2]);
    const yLo = Math.min(...ys) - 0.0075, yHi = Math.max(...ys) + 0.0021, zLo = Math.min(...zs) - 0.0021, zHi = Math.max(...zs) + 0.0021;
    for (let iy = 0; iy < NY; iy++) for (let iz = 0; iz < NZ; iz++) {
      const y = Y0 + iy * STEP, z = Z0 + iz * STEP;
      if (y >= yLo && y <= yHi && z >= zLo && z <= zHi) inPatch[idx(iy, iz)] = 1;
    }
  }
  const verts: number[] = [], norms: number[] = [], ids = new Int32Array(NY * NZ).fill(-1);
  const vid = (iy: number, iz: number) => {
    const k = idx(iy, iz);
    if (ids[k] >= 0) return ids[k];
    const nrm = normalAt(iy, iz);
    // lift the patch slightly above the fitted surface (more in the middle, tapering to ~0 at the footprint edge so it blends in)
    const y0 = Y0 + iy * STEP, z0 = Z0 + iz * STEP;
    let edge = 1;
    for (const pl of polys) if (y0 >= pl.yLo && y0 <= pl.yHi && z0 >= pl.zLo && z0 <= pl.zHi) edge = Math.min(1, Math.min(y0 - pl.yLo, pl.yHi - y0, z0 - pl.zLo, pl.zHi - z0) / 0.0035);
    const bias = 0.00012 + 0.0005 * edge * edge * (3 - 2 * edge);
    const x = X[k] + nrm.x * bias, y = y0 + nrm.y * bias, z = z0 + nrm.z * bias;
    ids[k] = verts.length / 3; verts.push(x, y, z); norms.push(nrm.x, nrm.y, nrm.z);
    return ids[k];
  };
  const index: number[] = [];
  for (let iy = 0; iy < NY - 1; iy++) for (let iz = 0; iz < NZ - 1; iz++) {
    if (!(inPatch[idx(iy, iz)] && inPatch[idx(iy + 1, iz)] && inPatch[idx(iy, iz + 1)] && inPatch[idx(iy + 1, iz + 1)])) continue;
    if (X[idx(iy, iz)] === NONE || X[idx(iy + 1, iz + 1)] === NONE) continue;
    const p00 = vid(iy, iz), p10 = vid(iy + 1, iz), p01 = vid(iy, iz + 1), p11 = vid(iy + 1, iz + 1);
    // winding so the front face looks toward +X: (y,z) grid -> normal = dy x dz = +X
    index.push(p00, p10, p11, p00, p11, p01);
  }
  const patch = new THREE.BufferGeometry();
  patch.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  patch.setAttribute('normal', new THREE.Float32BufferAttribute(norms, 3));
  patch.setIndex(index);
  return { patch, sample };
}
