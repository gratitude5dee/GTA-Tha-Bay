/**
 * Fixtures for the M02c1 service specs: a `ChunkStore` that serves hand-built chunks (or withholds some of them), a minimal world
 * index and a fake engine host for the teleport.
 */
import { chunkBounds, type ChunkKey, type PoiRecord, type LandmarkRecord, type Portal, type SimChunk, type WorldIndex } from '@dv/shared';
import { ChunkStore } from '../../src/sim/streaming/chunk-store.ts';
import type { TeleportHost } from '../../src/sim/api/teleport.ts';
import { BAKE } from './roads.ts';

/**
 * A p0 `ChunkStore` over the given chunks. `deliver(key)` decides which requests are answered at once (default: all); the
 * others stay requested for ever, like a pack that never arrives. `exists` is true for every key in `known` (default: the chunks).
 */
export function storeOf(chunks: readonly SimChunk[], o: { deliver?: (key: ChunkKey) => boolean; known?: readonly ChunkKey[] } = {}): ChunkStore<SimChunk> {
  const byKey = new Map(chunks.map((c) => [c.key, c] as const));
  const known = new Set<ChunkKey>(o.known ?? chunks.map((c) => c.key));
  const store: ChunkStore<SimChunk> = new ChunkStore<SimChunk>({
    levels: ['p0'],
    tier: 'desktop',
    exists: (_level, key) => known.has(key),
    request: (r) => {
      if (o.deliver && !o.deliver(r.key)) return;
      const c = byKey.get(r.key);
      store.settle(r.level, r.key, c ? { ok: true, payload: c } : { ok: true, empty: true });
    },
    now: () => 0,
    retry: { firstDelay: 60, maxDelay: 600, maxAttempts: 3 },
  });
  return store;
}

/** Makes every chunk resident. */
export async function loadAll(store: ChunkStore<SimChunk>, keys: readonly ChunkKey[]): Promise<void> {
  await store.preload(keys.map((key) => ({ level: 'p0' as const, key })));
}

export function landmarkAt(id: string, x: number, z: number, chunk: ChunkKey, o: Partial<LandmarkRecord> = {}): LandmarkRecord {
  return {
    id: id as LandmarkRecord['id'], nameKey: `place.${id.slice(3)}`, lat: 0, lng: 0, x, z, chunk, district: 'd4', nhood: 'civic-center', cls: 'minor',
    asset: `building/${id}` as LandmarkRecord['asset'], replaces: [], swapM: { 'desktop-ultra': 1200, desktop: 1200, 'xr-visionpro': 900, mobile: 500, 'xr-quest': 400, 'mobile-low': 350 },
    skyline: false, arrival: { x, z, yaw: 0 }, roles: [], ...o,
  };
}

export function poiAt(id: string, x: number, z: number, kind: PoiRecord['kind'] = 'cafe', o: Partial<PoiRecord> = {}): PoiRecord {
  return {
    id: id as PoiRecord['id'], nameKey: id, kind, lat: 0, lng: 0, x, y: 0, z, chunk: '9/256/256', nhood: 'civic-center', district: 'd4', pedNode: null, hours: null, landmark: null, ...o,
  };
}

export function indexOf(o: { landmarks?: LandmarkRecord[]; pois?: PoiRecord[]; portals?: Portal[]; transit?: WorldIndex['transit']; districts?: WorldIndex['districts'] } = {}): WorldIndex {
  return {
    schema: 'world-index/1', c08: '1.0.0', bakeId: BAKE, worldSeed: 1, areas: [], tiles: { p0: [], l0: [], l1: [], l2: [] },
    landmarks: o.landmarks ?? [], pois: o.pois ?? [], districts: o.districts ?? [], portals: o.portals ?? [], transit: o.transit ?? [], sources: [],
  };
}

/** Bounds of a chunk key, for placing fixtures. */
export const centreOf = (key: ChunkKey): { x: number; z: number } => {
  const b = chunkBounds(key);
  return { x: (b.minX + b.maxX) / 2, z: (b.minZ + b.maxZ) / 2 };
};

/**
 * A fake engine for the teleport: `begin` starts a move that `active()` reports for `moveTicks` calls of `tick()`, after which the
 * player stands at the target (feet at the requested y). `fades` records the fade directions.
 */
export class FakeHost implements TeleportHost {
  pos: [number, number, number] | null;
  fades: ('out' | 'in')[] = [];
  begun: [number, number, number, number][] = [];
  refuse: 'busy' | null = null;
  /** When true the move ends without the player arriving (the ground never came). */
  stuck = false;
  private moving = 0;
  private target: [number, number, number] | null = null;

  constructor(start: [number, number, number] | null, readonly moveTicks = 20) {
    this.pos = start;
  }

  playerPos(): [number, number, number] | null {
    return this.pos;
  }

  begin(x: number, y: number, z: number, yaw: number): { ok: true } | { ok: false; reason: 'busy' | 'no-player' } {
    if (this.refuse) return { ok: false, reason: this.refuse };
    if (!this.pos) return { ok: false, reason: 'no-player' };
    this.begun.push([x, y, z, yaw]);
    this.target = [x, y, z];
    this.moving = this.moveTicks;
    return { ok: true };
  }

  active(): boolean {
    return this.moving > 0;
  }

  fade(dir: 'out' | 'in'): void {
    this.fades.push(dir);
  }

  /** One sim tick of the fake engine. */
  tick(): void {
    if (this.moving > 0 && --this.moving === 0 && this.target && !this.stuck) this.pos = [...this.target];
  }
}
