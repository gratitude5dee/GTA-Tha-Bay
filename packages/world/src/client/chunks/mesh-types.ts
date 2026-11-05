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
  /** M02e: `Uint8x4` per vertex: surface id (look/surfaces.ts), palette index, kind/roof code, flags. Uploaded normalised. */
  surf: Uint8Array;
  /** M02e, `buildings` only and only when the look is on: `Int16x4` per vertex, see look/surfaces.ts. Uploaded normalised. */
  facade?: Int16Array;
  /** M02h1, `roads` only and only with the markings on: `Int16x4` per vertex, the lane coordinates of the street paint (look/road-layout.ts). Uploaded normalised. */
  road?: Int16Array;
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
  /** L0: the terrain was meshed at the profile's `nearStride` (the chunk lay within `terrain.nearRingM` of the focus); M02g2. */
  near?: boolean;
  /** L0: the stride of the terrain mesh (1, 2 or 4 posts); M02g2. */
  terrainStride?: number;
  /** L0, with the markings on (M02h1): what the roads object holds, see `RoadMarkStats` in mesher.ts. */
  markings?: { roadVerts: number; patches: number; crosswalks: number; stopBars: number; approaches: number; skipped: number; clipped: number };
  /** L0, with the curbs on (M02h2): the sidewalk ribbons of the roads object, see `CurbStats` in sidewalks.ts. */
  curbs?: { ribbons: number; attached: number; unattached: number; chains: number; curbedM: number; rampCount: number; triangles: number };
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
  /** L0: the `proxyOf` values (landmark index + 1) of the footprints in this chunk, whether or not they are meshed. Empty at L1 and L2. */
  proxies: number[];
  /** L0: the subset of `proxies` left out of the meshes because a landmark model stands in their place (M02d1). */
  masked: number[];
  /**
   * L0 with the curbs on (M02h2): the walk lift mask, one bit per 1 m cell of the chunk (row-major from the north-west corner, 8 KiB), set
   * on full-height curbed sidewalk; pedestrians and the on-foot player figure draw `walkLiftM` higher there (render only).
   */
  walk?: Uint8Array;
  walkLiftM?: number;
  /** Tests only (`MeshChunkOptions.curbDebug`): the curb samples of sidewalks.ts. */
  curbSamples?: { x: number; z: number; roadTop: number; top: number; heightM: number; rampD: number; outerX: number; outerZ: number }[];
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
    add(o.surf);
    if (o.facade) add(o.facade);
    if (o.road) add(o.road);
  }
  add(m.trees);
  add(m.lamps);
  if (m.walk) add(m.walk);
  return [...new Set(out)];
}

/**
 * Bytes of a unit mesh on the GPU: the typed arrays (`surf` and `facade` included: 4 B per vertex, and 8 B more on a building
 * vertex; `road`, 8 B per road vertex), the per-vertex birth time the renderer adds (4 B) and the tree records.
 */
export const meshBytes = (objects: readonly MeshBuffers[], trees: Float32Array): number =>
  objects.reduce(
    (n, o) => n + o.positions.byteLength + o.normals.byteLength + o.colors.byteLength + o.ao.byteLength + o.indices.byteLength + o.surf.byteLength + (o.facade?.byteLength ?? 0) + (o.road?.byteLength ?? 0) + (o.positions.length / 3) * 4,
    0,
  ) + trees.byteLength;
