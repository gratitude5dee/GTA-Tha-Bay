/**
 * `WorldQuery` (M02c1; C08 section 3): ground height, water, neighbourhood and district lookups over the resident `p0` chunks and
 * the district grid.
 *
 *  - `groundY` takes the highest of the heightfield and the slab and hood tops over the point, or, with `yHint`, the surface closest
 *    to the hint (a player under a bridge deck asks with its own height and gets the terrain, one on the deck gets the deck);
 *    null when the chunk is not resident.
 *  - `isWater` reads the 4 m `GroundClass` cells (shallow and deep water); `waterDepth` is the sea-level depth the swim and the
 *    vehicle water wall use.
 *  - `nhoodAt` and `districtAt` read `data/district-grid.v1` (255 and null without one).
 *  - `nearestWalkable` snaps to the pedestrian graph of the resident chunks.
 * Pure; C02 lint applies.
 */
import {
  CHUNK_EDGE_M, GRID_MIN_M, GroundClass, NHOOD_NONE, chunkKeyAt, dsqrt, nhoodIndexAt, sampleHeight,
  type ChunkKey, type DistrictGrid, type DistrictRecord, type SimChunk, type TeleportNode, type WorldQuery,
} from '@dv/shared';

/** What the queries need of a chunk store: `ChunkStore<SimChunk>` fits. */
export interface ChunkSource {
  payload(key: ChunkKey): SimChunk | null;
  ready(key: ChunkKey): boolean;
}

/** Sea level of the bake, metres. */
export const SEA_LEVEL_M = 0;

/** Calls `fn(offset, n, base, height)` for every record of a packed prism list (C08 `PrismPack`). */
export function eachPrism(pack: ArrayLike<number>, fn: (offset: number, n: number, base: number, height: number) => void): void {
  let i = 0;
  while (i + 3 <= pack.length) {
    const n = pack[i] as number;
    if (!(n >= 3) || i + 3 + n * 2 > pack.length) return;
    fn(i + 3, n, pack[i + 1] as number, pack[i + 2] as number);
    i += 3 + n * 2;
  }
}

/** Point in the polygon of `n` vertices at `offset` of a prism pack (even-odd). */
export function inPrism(pack: ArrayLike<number>, offset: number, n: number, x: number, z: number): boolean {
  let inside = false;
  for (let a = 0, b = n - 1; a < n; b = a++) {
    const ax = pack[offset + a * 2] as number, az = pack[offset + a * 2 + 1] as number;
    const bx = pack[offset + b * 2] as number, bz = pack[offset + b * 2 + 1] as number;
    if ((az > z) !== (bz > z) && x < ((bx - ax) * (z - az)) / (bz - az) + ax) inside = !inside;
  }
  return inside;
}

/** Distance from (x, z) to the edge ring of the polygon at `offset`; 0 inside. */
export function distToPrism(pack: ArrayLike<number>, offset: number, n: number, x: number, z: number): number {
  if (inPrism(pack, offset, n, x, z)) return 0;
  let best = Infinity;
  for (let a = 0, b = n - 1; a < n; b = a++) {
    const ax = pack[offset + a * 2] as number, az = pack[offset + a * 2 + 1] as number;
    const bx = pack[offset + b * 2] as number, bz = pack[offset + b * 2 + 1] as number;
    const dx = bx - ax, dz = bz - az;
    const l2 = dx * dx + dz * dz;
    let t = l2 > 0 ? ((x - ax) * dx + (z - az) * dz) / l2 : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const ex = x - (ax + dx * t), ez = z - (az + dz * t);
    const d = ez * ez + ex * ex;
    if (d < best) best = d;
  }
  return dsqrt(best);
}

const NEIGHBOUR_REACH_M = 8;

export class WorldQueryImpl implements WorldQuery {
  private readonly nhoodParent = new Map<string, string>();
  private grid: DistrictGrid | null;

  constructor(
    private readonly chunks: ChunkSource,
    grid: DistrictGrid | null,
    districts: readonly DistrictRecord[],
  ) {
    this.grid = grid;
    for (const d of districts) if (d.kind === 'nhood' && d.parent) this.nhoodParent.set(d.id, d.parent);
  }

  /** Installs the district grid once it has loaded. */
  setGrid(grid: DistrictGrid): void {
    this.grid = grid;
  }

  private chunkAt(x: number, z: number): SimChunk | null {
    return this.chunks.payload(chunkKeyAt(9, x, z));
  }

  /** The resident chunks within `reach` of (x, z): the chunk itself first, then the neighbours whose border is that close. */
  private around(x: number, z: number, reach: number): SimChunk[] {
    const e = CHUNK_EDGE_M[9];
    const i0 = Math.floor((x - reach - GRID_MIN_M) / e), i1 = Math.floor((x + reach - GRID_MIN_M) / e);
    const j0 = Math.floor((z - reach - GRID_MIN_M) / e), j1 = Math.floor((z + reach - GRID_MIN_M) / e);
    const own = chunkKeyAt(9, x, z);
    const out: SimChunk[] = [];
    const first = this.chunks.payload(own);
    if (first) out.push(first);
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const key = `9/${i}/${j}` as ChunkKey;
        if (key === own) continue;
        const c = this.chunks.payload(key);
        if (c) out.push(c);
      }
    }
    return out;
  }

  groundY(x: number, z: number, yHint?: number): number | null {
    const c = this.chunkAt(x, z);
    if (!c) return null;
    const surfaces: number[] = [sampleHeight(c.height, x, z)];
    for (const k of this.around(x, z, NEIGHBOUR_REACH_M)) {
      const add = (base: number, height: number): void => void surfaces.push(base + height);
      for (const pack of [k.slabs, k.hoods]) {
        eachPrism(pack, (o, n, base, height) => {
          if (inPrism(pack, o, n, x, z)) add(base, height);
        });
      }
    }
    if (yHint === undefined || !Number.isFinite(yHint)) {
      let top = surfaces[0] as number;
      for (const s of surfaces) if (s > top) top = s;
      return top;
    }
    let best = surfaces[0] as number;
    for (const s of surfaces) {
      const d = Math.abs(s - yHint), db = Math.abs(best - yHint);
      if (d < db || (d === db && s > best)) best = s;
    }
    return best;
  }

  isWater(x: number, z: number): boolean {
    const c = this.chunkAt(x, z);
    if (!c) return false;
    const i = Math.min(63, Math.max(0, Math.floor((x - c.height.originX) / 4)));
    const j = Math.min(63, Math.max(0, Math.floor((z - c.height.originZ) / 4)));
    const g = c.ground[j * 64 + i] as number;
    return g === GroundClass.Water || g === GroundClass.WaterShallow;
  }

  /** Depth of the water over the terrain at a point, metres (0 on land or where no chunk is resident). */
  waterDepth(x: number, z: number): number {
    if (!this.isWater(x, z)) return 0;
    const c = this.chunkAt(x, z);
    if (!c) return 0;
    const depth = SEA_LEVEL_M - sampleHeight(c.height, x, z);
    return depth > 0 ? depth : 0;
  }

  nhoodAt(x: number, z: number): number {
    return this.grid ? nhoodIndexAt(this.grid, x, z) : NHOOD_NONE;
  }

  districtAt(x: number, z: number): string | null {
    if (!this.grid) return null;
    const i = nhoodIndexAt(this.grid, x, z);
    if (i === NHOOD_NONE) return null;
    const slug = this.grid.nhoods[i];
    return slug === undefined ? null : (this.nhoodParent.get(slug) ?? null);
  }

  chunkReady(k: ChunkKey): boolean {
    return this.chunks.ready(k);
  }

  /** Teleport nodes of the resident chunks within `radiusM` of (x, z), nearest first, ties by id. */
  teleportNodesNear(x: number, z: number, radiusM: number, kind?: TeleportNode['kind']): TeleportNode[] {
    const hits: { n: TeleportNode; d: number }[] = [];
    for (const c of this.around(x, z, radiusM)) {
      for (const n of c.tags.teleportNodes ?? []) {
        if (kind !== undefined && n.kind !== kind) continue;
        const d = dsqrt((n.x - x) * (n.x - x) + (n.z - z) * (n.z - z));
        if (d <= radiusM) hits.push({ n, d });
      }
    }
    hits.sort((a, b) => a.d - b.d || (a.n.id < b.n.id ? -1 : a.n.id > b.n.id ? 1 : 0));
    return hits.map((h) => h.n);
  }

  /** Distance from (x, z) to the nearest building footprint (0 inside one), looking at the chunks within `reach`. */
  distToBuildings(x: number, z: number, reach: number): number {
    let best = Infinity;
    for (const c of this.around(x, z, reach)) {
      eachPrism(c.prisms, (o, n) => {
        const d = distToPrism(c.prisms, o, n, x, z);
        if (d < best) best = d;
      });
    }
    return best;
  }

  nearestWalkable(x: number, z: number, maxM: number): { x: number; y: number; z: number } | null {
    let best: { x: number; y: number; z: number; d: number } | null = null;
    for (const c of this.around(x, z, maxM)) {
      const nodes = c.pedNodes;
      for (const n of nodes) {
        const dx = n.x - x, dz = n.z - z;
        const d = dsqrt(dx * dx + dz * dz);
        if (d <= maxM && (best === null || d < best.d)) best = { x: n.x, y: n.y, z: n.z, d };
      }
      for (const e of c.pedEdges) {
        const a = nodes[e.a], b = nodes[e.b];
        if (!a || !b) continue;
        const dx = b.x - a.x, dz = b.z - a.z;
        const l2 = dx * dx + dz * dz;
        if (l2 <= 0) continue;
        let t = ((x - a.x) * dx + (z - a.z) * dz) / l2;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const px = a.x + dx * t, pz = a.z + dz * t;
        const ex = x - px, ez = z - pz;
        const d = dsqrt(ex * ex + ez * ez);
        if (d <= maxM && (best === null || d < best.d)) best = { x: px, y: a.y + (b.y - a.y) * t, z: pz, d };
      }
    }
    return best ? { x: best.x, y: best.y, z: best.z } : null;
  }
}
