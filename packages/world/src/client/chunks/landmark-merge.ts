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
  let v = 0, i = 0;
  for (const p of prims) {
    positions.set(p.positions, v * 3);
    normals.set(p.normals, v * 3);
    colors.set(p.colors, v * 3);
    for (let k = 0; k < p.indices.length; k++) indices[i + k] = (p.indices[k] as number) + v;
    v += p.positions.length / 3;
    i += p.indices.length;
    for (let k = 0; k < 3; k++) {
      bounds[k] = Math.min(bounds[k] as number, p.bounds[k] as number);
      bounds[k + 3] = Math.max(bounds[k + 3] as number, p.bounds[k + 3] as number);
    }
  }
  if (prims.length === 0) bounds.fill(0);
  return { positions, normals, colors, indices, vertices, triangles: indexCount / 3, bounds };
}
