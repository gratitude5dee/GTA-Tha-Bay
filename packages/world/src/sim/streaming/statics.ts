/**
 * The statics feed (02-world.md section 5.2 rule 6): the colliders of the resident `p0` chunks go into the physics backend, at most
 * ONE chunk per tick, nearest to the focus first (ties by key), and leave again when the chunk is evicted or drifts beyond
 * 1.35 x the physics radius. A `p0` chunk that failed to load becomes an invisible wall (a tall box over the chunk), so the
 * player cannot walk into the void. Pure apart from the backend calls; C02 lint applies.
 */
import { toStaticShapeSet, type ChunkKey, type SimChunk } from '@dv/shared';
import type { PhysicsBackend } from '@dv/engine/sim';
import type { ChunkStore } from './chunk-store.ts';
import { STREAMING } from './plan.ts';
import { boundsOf, insideRing, rankUnits, type Focus } from './priority.ts';

type StaticsBackend = Pick<PhysicsBackend, 'addChunkStatics' | 'removeChunkStatics'>;

/** Wall box: base 100 m below the sea, 600 m high. */
const WALL_BASE_M = -100;
const WALL_HEIGHT_M = 600;

/** A prism pack for a box over the whole chunk (C08 `PrismPack`: [nVerts, baseY, heightM, x0, z0, ...]). */
export function wallPrism(key: ChunkKey): Float32Array {
  const b = boundsOf(key);
  return Float32Array.from([4, WALL_BASE_M, WALL_HEIGHT_M, b.minX, b.minZ, b.maxX, b.minZ, b.maxX, b.maxZ, b.minX, b.maxZ]);
}

export interface StaticsStep {
  /** Chunk whose colliders were added this tick, or null. */
  added: ChunkKey | null;
  /** True when the chunk got a wall instead of terrain. */
  wall: boolean;
  removed: ChunkKey[];
}

export class StaticsFeeder {
  /** Chunks with terrain colliders in the backend. */
  readonly terrain = new Set<ChunkKey>();
  /** Failed chunks with an invisible wall in the backend. */
  readonly walls = new Set<ChunkKey>();

  constructor(private readonly backend: StaticsBackend) {}

  /** Keys with anything in the backend, sorted. */
  keys(): ChunkKey[] {
    return [...this.terrain, ...this.walls].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  }

  has(key: ChunkKey): boolean {
    return this.terrain.has(key);
  }

  /** The store evicted `key`: its colliders go at once. */
  drop(key: ChunkKey): boolean {
    let had = false;
    if (this.terrain.delete(key)) had = true;
    if (this.walls.delete(key)) had = true;
    if (had) this.backend.removeChunkStatics(key);
    return had;
  }

  /**
   * One tick of the feed: remove the colliders that fell out of 1.35 x `physicsM`, then add the nearest chunk that is ready (or
   * failed) and has none yet. At most one add per call.
   */
  step(store: ChunkStore<SimChunk>, focus: Focus, physicsM: number, also: Focus | null = null): StaticsStep {
    const removed: ChunkKey[] = [];
    for (const key of this.keys()) {
      const gone = !store.unit('p0', key);
      const keep = insideRing(key, focus, physicsM, STREAMING.unloadFactor) || (also !== null && insideRing(key, also, physicsM, STREAMING.unloadFactor));
      if (gone || !keep) {
        this.drop(key);
        removed.push(key);
      }
    }
    // The player's own neighbourhood first; then, while a teleport is pending, the destination's (its colliders must be there for
    // the ground probe, and the player's are kept meanwhile).
    for (const f of also ? [focus, also] : [focus]) {
      const ranked = rankUnits(9, f, physicsM, {
        exists: (k) => {
          const u = store.unit('p0', k);
          return u !== null && (u.state === 'ready' || u.state === 'failed');
        },
        firstRing: true,
      });
      for (const r of ranked) {
        if (this.terrain.has(r.key) || this.walls.has(r.key)) continue;
        const u = store.unit('p0', r.key);
        if (!u) continue;
        if (u.state === 'ready' && u.payload) {
          this.backend.addChunkStatics(r.key, toStaticShapeSet(u.payload));
          this.terrain.add(r.key);
          return { added: r.key, wall: false, removed };
        }
        if (u.state === 'failed') {
          this.backend.addChunkStatics(r.key, { prisms: wallPrism(r.key) });
          this.walls.add(r.key);
          return { added: r.key, wall: true, removed };
        }
      }
    }
    return { added: null, wall: false, removed };
  }
}
