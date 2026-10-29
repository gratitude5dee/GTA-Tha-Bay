/**
 * One draw object per landmark (M02d2). A landmark model comes with one primitive per material class (matte, metal, glass: up to
 * three), but the world draws every one of them with the same vertex-colour material (the PBR factors are for the Blender art pass,
 * M10d2), so at runtime the primitives are one mesh: the render-object budget (`maxRenderObjects`, counted in view) pays one object
 * per landmark instead of two or three, which the skyline set and the full-fidelity models together need on `mobile` and
 * `mobile-low`. The asset keeps its primitives and the per-class budgets of `config/asset-budgets.json`. No `three` import.
 */
import type { LandmarkPrimitive } from './landmark-glb.ts';

export interface MergedLandmark {
  positions: Float32Array;
  normals: Float32Array;
  colors: Float32Array;
  indices: Uint16Array | Uint32Array;
  vertices: number;
  triangles: number;
  /** minX, minY, minZ, maxX, maxY, maxZ. */
  bounds: [number, number, number, number, number, number];
  /** M02g2: the area-weighted mean vertex colour (linear RGB): what the look's landmark material fades to at a distance. */
  mean: [number, number, number];
}

/** Concatenates the primitives (positions, normals, colours, indices shifted by the vertices before them). */
export function mergePrimitives(prims: readonly LandmarkPrimitive[]): MergedLandmark {
  let vertices = 0, indexCount = 0;
  for (const p of prims) {
    vertices += p.positions.length / 3;
    indexCount += p.indices.length;
  }
  const positions = new Float32Array(vertices * 3);
  const normals = new Float32Array(vertices * 3);
  const colors = new Float32Array(vertices * 3);
  const indices = vertices > 65535 ? new Uint32Array(indexCount) : new Uint16Array(indexCount);
  const bounds: MergedLandmark['bounds'] = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
  const sum = [0, 0, 0];
  let area = 0;
  let v = 0, i = 0;
  for (const p of prims) {
    positions.set(p.positions, v * 3);
    normals.set(p.normals, v * 3);
    colors.set(p.colors, v * 3);
    for (let k = 0; k < p.indices.length; k++) indices[i + k] = (p.indices[k] as number) + v;
    // The mean colour: each triangle's mean of its three vertex colours, weighted by its area.
    for (let k = 0; k + 2 < p.indices.length; k += 3) {
      const a = p.indices[k] as number, b = p.indices[k + 1] as number, c = p.indices[k + 2] as number;
      const ax = p.positions[a * 3] as number, ay = p.positions[a * 3 + 1] as number, az = p.positions[a * 3 + 2] as number;
      const ux = (p.positions[b * 3] as number) - ax, uy = (p.positions[b * 3 + 1] as number) - ay, uz = (p.positions[b * 3 + 2] as number) - az;
      const wx = (p.positions[c * 3] as number) - ax, wy = (p.positions[c * 3 + 1] as number) - ay, wz = (p.positions[c * 3 + 2] as number) - az;
      const tri = 0.5 * Math.hypot(uy * wz - uz * wy, uz * wx - ux * wz, ux * wy - uy * wx);
      if (!(tri > 0)) continue;
      area += tri;
      for (let ch = 0; ch < 3; ch++) sum[ch] = (sum[ch] as number) + tri * (((p.colors[a * 3 + ch] as number) + (p.colors[b * 3 + ch] as number) + (p.colors[c * 3 + ch] as number)) / 3);
    }
    v += p.positions.length / 3;
    i += p.indices.length;
    for (let k = 0; k < 3; k++) {
      bounds[k] = Math.min(bounds[k] as number, p.bounds[k] as number);
      bounds[k + 3] = Math.max(bounds[k + 3] as number, p.bounds[k + 3] as number);
    }
  }
  if (prims.length === 0) bounds.fill(0);
  const mean: MergedLandmark['mean'] = area > 0 ? [(sum[0] as number) / area, (sum[1] as number) / area, (sum[2] as number) / area] : [0.5, 0.5, 0.5];
  return { positions, normals, colors, indices, vertices, triangles: indexCount / 3, bounds, mean };
}
