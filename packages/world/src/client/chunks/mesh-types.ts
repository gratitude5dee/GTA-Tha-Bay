/**
 * Plain-data mesh buffers: what the mesher job returns from asset.worker and what `ChunkRenderer` turns into three objects.
 * No `three` import, so the worker bundles this without the renderer.
 */
import type { ChunkKey, SignalProgram } from '@dv/shared';

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
  /** L0, meshed with ground cover (M02h3): cells per `CoverClass` 0..7 of the chunk. */
  cover?: number[];
  /** L0 (M02h3): the chunk has cover in its pack (set by the mesh job), so the `cover` layer changes its mesh. */
  coverAvailable?: boolean;
  /** L0 (M02h6): where the furniture records came from (the pack, the mesher, none on `legacy`), how many, and the signal heads. */
  furniture?: { source: 'bake' | 'mesher' | 'none'; records: number; heads: number };
}

/**
 * M02h6: the kinds of `UnitMesh.furniture` records. 0 to 6 are the `RenderChunk.furniture` types of `config/world/furniture.json` (same
 * numbers); `signal` and `wire` are the graph-bound items the mesher adds (a signal assembly per approach, a trolley wire span).
 */
export const FurnitureKind = { stop: 0, hydrant: 1, meter: 2, shelter: 3, bench: 4, pole: 5, oneway: 6, signal: 7, wire: 8 } as const;
export type FurnitureKindName = keyof typeof FurnitureKind;
/** Floats per `UnitMesh.furniture` record: kind, x, y, z (local x and z like the lamps, y absolute), yaw, arg. */
export const FURNITURE_STRIDE = 6;
/** GPU bytes one furniture instance costs (its matrix and two instance floats), counted in `meshBytes`. */
export const FURNITURE_INSTANCE_BYTES = 72;

/** M02h6: a signal head of a unit: what `furniture/signals.ts` evaluates (C08 `signalAspect`). `arg` of a `signal` record indexes this list. */
export interface FurnitureHead {
  junction: number;
  movement: number;
  program: SignalProgram;
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
  /** L0 only (M02h4): x, y, z (local), height in metres, yaw in radians and `form + 8 x tint` per tree (`TREE_STRIDE` floats). */
  trees: Float32Array;
  /** L0 only: x, y, z (local) per street lamp (the baked LAMP records on the terrain, M02b2). The night lights draw them. */
  lamps: Float32Array;
  /**
   * L0 only (M02h6): the street furniture as `FURNITURE_STRIDE` floats per record (`FurnitureKind`, local x, absolute y, local z, yaw, arg:
   * the head index of a `signal`, the span length of a `wire`, else 0), drawn by the global furniture pools; empty on the `legacy` look.
   */
  furniture: Float32Array;
  /** L0 only (M02h6): the signal heads the `signal` records point at. */
  heads: FurnitureHead[];
  /**
   * L0 only (M02h6): the parked slots the render-only dressing may draw on the tier (past the sim's prefix): local x, road y, local z, yaw,
   * slot and density profile per record (`PARKED_STRIDE` in mesher.ts). Absent at L1 and L2.
   */
  parked?: Float32Array;
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
  add(m.furniture);
  if (m.parked) add(m.parked);
  if (m.walk) add(m.walk);
  return [...new Set(out)];
}

/**
 * Bytes of a unit mesh on the GPU: the typed arrays (`surf` and `facade` included: 4 B per vertex, and 8 B more on a building
 * vertex; `road`, 8 B per road vertex), the per-vertex birth time the renderer adds (4 B), the tree records and (M02h6) the furniture
 * instances (`FURNITURE_INSTANCE_BYTES` each).
 */
export const meshBytes = (objects: readonly MeshBuffers[], trees: Float32Array, furniture?: Float32Array): number =>
  objects.reduce(
    (n, o) => n + o.positions.byteLength + o.normals.byteLength + o.colors.byteLength + o.ao.byteLength + o.indices.byteLength + o.surf.byteLength + (o.facade?.byteLength ?? 0) + (o.road?.byteLength ?? 0) + (o.positions.length / 3) * 4,
    0,
  ) + trees.byteLength + (furniture ? (furniture.length / FURNITURE_STRIDE) * FURNITURE_INSTANCE_BYTES : 0);
