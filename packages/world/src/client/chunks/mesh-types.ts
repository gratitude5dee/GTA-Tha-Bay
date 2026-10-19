/**
 * Plain-data mesh buffers: what the mesher job returns from asset.worker and what `ChunkRenderer` turns into three objects.
 * No `three` import, so the worker bundles this without the renderer.
 */
import type { ChunkKey } from '@dv/shared';

export type ObjectKind = 'terrain' | 'buildings' | 'roads' | 'massing' | 'vegetation' | 'furniture' | 'extras';

/** One render object (an indexed triangle mesh). Positions are local to the unit's north-west corner; `y` is absolute. */
export interface MeshBuffers {
  kind: ObjectKind;
  positions: Float32Array;
  normals: Float32Array;
  /** Linear RGB, 3 floats per vertex. */
  colors: Float32Array;
  /** Baked vertex ambient occlusion, 1 = open, 0 = closed (`aAO`). */
  ao: Float32Array;
  indices: Uint16Array | Uint32Array;
  /** minX, minY, minZ, maxX, maxY, maxZ in the same local frame. */
  bounds: [number, number, number, number, number, number];
}

export interface MeshStats {
  triangles: number;
  vertices: number;
  buildings: number;
  skipped: number;
  /** Largest triangle count of one building. */
  maxBuildingTris: number;
  /** The profile's skip rule dropped buildings: a re-mesh is due when the focus comes within `beyondM` of the chunk. */
  filtered: boolean;
  /** Bytes of the typed arrays. */
  bytes: number;
}

/** The result of meshing one unit (an L0 chunk, an L1 tile or an L2 block). */
export interface UnitMesh {
  level: 'l0' | 'l1' | 'l2';
  key: ChunkKey;
  /** North-west corner of the unit, ENU metres: the position of the object group. */
  originX: number;
  originZ: number;
  /** At most six objects (the terrain, buildings, roads and so on). */
  objects: MeshBuffers[];
  /** L0 only: x, y, z (local), scale, species per tree. */
  trees: Float32Array;
  /** L0 only: x, y, z (local) per street lamp (the baked LAMP records on the terrain, M02b2). The night lights draw them. */
  lamps: Float32Array;
  stats: MeshStats;
}

/** All the buffers of a unit mesh, for the transfer list. */
export function transferListOf(m: UnitMesh): ArrayBuffer[] {
  const out: ArrayBuffer[] = [];
  const add = (a: ArrayBufferView): void => {
    if (a.buffer instanceof ArrayBuffer) out.push(a.buffer);
  };
  for (const o of m.objects) {
    add(o.positions);
    add(o.normals);
    add(o.colors);
    add(o.ao);
    add(o.indices);
  }
  add(m.trees);
  add(m.lamps);
  return [...new Set(out)];
}

/** Bytes of a unit mesh on the GPU: the typed arrays, the per-vertex birth time the renderer adds (4 B) and the tree records. */
export const meshBytes = (objects: readonly MeshBuffers[], trees: Float32Array): number =>
  objects.reduce((n, o) => n + o.positions.byteLength + o.normals.byteLength + o.colors.byteLength + o.ao.byteLength + o.indices.byteLength + (o.positions.length / 3) * 4, 0) + trees.byteLength;
