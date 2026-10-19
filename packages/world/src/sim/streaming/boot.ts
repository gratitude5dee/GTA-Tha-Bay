/**
 * World boot (02-world.md section 5.1): which world to boot, and what it needs first. Pure; C02 lint applies.
 *
 * `bootChoice` is the rule of M02b1 (DL-668 part 2): an explicit `?world=<id>` (QA builds) wins over a catalog that holds
 * `data/world-index` and boots that engine scenario on the M01b2 path; with no flag the baked world boots when the catalog has a
 * world index, and the gray-box otherwise. Production builds parse no flag, so they pass `null`.
 */
import { CHUNK_EDGE_M, packRefOf, parseChunkKey, sampleHeight, ancestorKey, type ChunkKey, type QualityTierId, type SimChunk, type WorldIndex } from '@dv/shared';
import { basePlan } from './plan.ts';
import { rankUnits } from './priority.ts';
import type { Level } from './chunk-store.ts';

export type BootKind = 'baked' | 'graybox' | 'scenario';

/** The four cases of the boot rule. `world` is `QaFlags.world`; `hasWorldIndex` is whether the catalog resolves `data/world-index`. */
export function bootChoice(world: string | null, hasWorldIndex: boolean): BootKind {
  if (world === null) return hasWorldIndex ? 'baked' : 'graybox';
  return world === 'civic-graybox' ? 'graybox' : 'scenario';
}

/** The pack coordinates the bake wrote, per family, as sets of `x-y` host coordinates. */
export type TileSets = Readonly<Record<'p0' | 'l0' | 'l1' | 'l2', ReadonlySet<string>>>;

export function tileSets(index: Pick<WorldIndex, 'tiles'>): TileSets {
  return { p0: new Set(index.tiles.p0), l0: new Set(index.tiles.l0), l1: new Set(index.tiles.l1), l2: new Set(index.tiles.l2) };
}

/** Whether the bake has a pack holding this unit. A unit inside an existing pack may still be empty; the loader settles that as `empty`. */
export function unitExists(sets: TileSets, level: Level, key: ChunkKey): boolean {
  const z = level === 'l1' ? 5 : level === 'l2' ? 3 : 7;
  const host = parseChunkKey(ancestorKey(key, z));
  return host !== null && sets[level].has(`${host.x}-${host.y}`);
}

/** `world_pack/<family>-<x>-<y>` of the pack that holds a unit. */
export const packAssetOf = (level: Level, key: ChunkKey): string => packRefOf(key, level);

export interface SpawnPose {
  x: number;
  z: number;
  yaw: number;
}

/**
 * Where the player starts: the arrival pose of City Hall (`lm.city-hall`), else of the first landmark, else the ENU origin.
 * The bake guarantees an arrival pose is on ground at least 3 m from water and prisms.
 */
export function spawnPose(index: Pick<WorldIndex, 'landmarks'>): SpawnPose {
  const hall = index.landmarks.find((l) => l.id === 'lm.city-hall') ?? index.landmarks[0];
  return hall ? { x: hall.arrival.x, z: hall.arrival.z, yaw: hall.arrival.yaw } : { x: 0, z: 0, yaw: 0 };
}

/** Terrain height under (x, z) from decoded `p0` chunks, or null when none covers it. */
export function groundHeightAt(chunks: readonly SimChunk[], x: number, z: number): number | null {
  for (const c of chunks) {
    const h = c.height;
    const span = h.cellM * 64;
    if (x >= h.originX && x <= h.originX + span && z >= h.originZ && z <= h.originZ + span) return sampleHeight(h, x, z);
  }
  return null;
}

/** The ring "one tile ring" of the boot set, metres: the radius of the nine tiles around the spawn tile. */
export const ONE_TILE_RING_M = CHUNK_EDGE_M[7];

export interface BootSet {
  /** `world_pack/p0-*` inside the physics radius plus one chunk. */
  p0: string[];
  /** `world_pack/l0-*` inside `min(r0, one tile ring)`. */
  l0: string[];
  l1: string[];
  l2: string[];
  /** The backdrop packs of the tier: the DEM (and massing) on the desktop tiers, the card atlas elsewhere. */
  far: string[];
  /** Packs the reveal waits for: the spawn chunk's `p0` and `l0`, and the first backdrop pack. */
  critical: string[];
}

export interface BootSetOptions {
  /** `world.massing` and `world.cards` from config/platform-flags.json. */
  massing: boolean;
  cards: boolean;
}

/** The backdrop mode of a tier: ring plus massing on the desktop tiers, skyline cards elsewhere (maps part 4.3, R-MAP-02). */
export function backdropOf(tier: QualityTierId): { ring: boolean; cardsKm: 10 | 20 | null; ringKm: 80 | null } {
  if (tier === 'desktop-ultra' || tier === 'desktop') return { ring: true, ringKm: 80, cardsKm: null };
  return { ring: false, ringKm: null, cardsKm: tier === 'mobile-low' || tier === 'xr-quest' ? 10 : 20 };
}

/**
 * The boot set for a spawn point: the packs the world needs before and just after the first frame, in the order they are
 * requested. The page prefetches and pins them; the reveal waits for `critical`.
 */
export function bootSet(index: Pick<WorldIndex, 'tiles'>, spawn: { x: number; z: number }, tier: QualityTierId, o: BootSetOptions = { massing: true, cards: true }): BootSet {
  const sets = tileSets(index);
  const plan = basePlan(tier);
  const focus = { x: spawn.x, z: spawn.z, vx: 0, vz: 0 };
  const uniq = (list: string[]): string[] => [...new Set(list)];
  const chunks = (radius: number, level: 'p0' | 'l0'): ChunkKey[] =>
    rankUnits(9, focus, radius, { exists: (k) => unitExists(sets, level, k), firstRing: true, lookAheadS: 0 }).map((r) => r.key);
  const p0Keys = chunks(plan.physicsM + CHUNK_EDGE_M[9], 'p0');
  const l0Keys = chunks(Math.min(plan.r0M, ONE_TILE_RING_M), 'l0');
  const p0 = uniq(p0Keys.map((k) => packAssetOf('p0', k)));
  const l0 = uniq(l0Keys.map((k) => packAssetOf('l0', k)));
  const l1 = uniq(rankUnits(7, focus, plan.r1M, { exists: (k) => unitExists(sets, 'l1', k), lookAheadS: 0 }).map((r) => packAssetOf('l1', r.key)));
  const l2 = uniq(rankUnits(5, focus, plan.r2M, { exists: (k) => unitExists(sets, 'l2', k), lookAheadS: 0 }).map((r) => packAssetOf('l2', r.key)));
  // Desktop tiers draw the DEM ring (and the massing); every other tier draws only the skyline cards.
  const far: string[] = [];
  const b = backdropOf(tier);
  if (b.ring) {
    far.push('world_pack/far-bay-dem');
    if (o.massing) far.push('world_pack/far-bay-massing');
  } else if (o.cards) far.push('texture/far-bay-cards');
  const spawnP0 = p0Keys[0] ? packAssetOf('p0', p0Keys[0]) : null;
  const spawnL0 = l0Keys[0] ? packAssetOf('l0', l0Keys[0]) : null;
  const critical = [...(spawnP0 ? [spawnP0] : []), ...(spawnL0 ? [spawnL0] : []), ...(far[0] ? [far[0]] : [])];
  return { p0, l0, l1, l2, far, critical: uniq(critical) };
}
