/**
 * Interest and priority (02-world.md section 5.2). Pure; C02 lint applies (detmath for roots).
 *
 *  1. Focus = player position + velocity x lookAheadS (4 s); in XR the headset position.
 *  2. The wanted set of a level = the units whose AABB meets the disc of the ring radius around the focus, ordered by
 *     `distance x dirWeight` (0.55 ahead, 0.85 to the side, 1.25 behind). The focus chunk and its eight neighbours come first.
 *  3. Unload at 1.35 x the ring radius (`unloadFactor`), least recently used first among the unpinned.
 */
import { CHUNK_EDGE_M, GRID_MIN_M, dhypot, parseChunkKey, type ChunkBounds, type ChunkKey, type ChunkZ } from '@dv/shared';
import { STREAMING } from './plan.ts';

export interface Focus {
  /** Position, ENU metres. */
  x: number;
  z: number;
  /** Velocity, m/s. */
  vx: number;
  vz: number;
}

export interface DirWeights {
  ahead: number;
  side: number;
  behind: number;
}

/** Heading below this speed counts as standing still: every direction weighs the same. */
export const HEADING_MIN_SPEED = 0.5;

/** The look-ahead point of a focus. */
export function lookAheadPoint(f: Focus, seconds: number = STREAMING.lookAheadS): { x: number; z: number } {
  return { x: f.x + f.vx * seconds, z: f.z + f.vz * seconds };
}

export function boundsOf(key: ChunkKey): ChunkBounds {
  const p = parseChunkKey(key) as { z: ChunkZ; x: number; y: number };
  const e = CHUNK_EDGE_M[p.z];
  return { minX: GRID_MIN_M + p.x * e, minZ: GRID_MIN_M + p.y * e, maxX: GRID_MIN_M + (p.x + 1) * e, maxZ: GRID_MIN_M + (p.y + 1) * e };
}

/** Distance from (x, z) to the nearest point of the box (0 inside). */
export function distanceToBox(x: number, z: number, b: ChunkBounds): number {
  const dx = Math.max(b.minX - x, 0, x - b.maxX);
  const dz = Math.max(b.minZ - z, 0, z - b.maxZ);
  return dhypot(dx, dz);
}

/** Whether the AABB meets the disc of radius `r` around (x, z). */
export const discMeetsBox = (x: number, z: number, r: number, b: ChunkBounds): boolean => distanceToBox(x, z, b) <= r;

/** Direction weight of a unit centre as seen from the player along the heading. */
export function dirWeight(f: Focus, cx: number, cz: number, w: DirWeights = STREAMING.dirWeights): number {
  const speed = dhypot(f.vx, f.vz);
  if (speed < HEADING_MIN_SPEED) return 1;
  const dx = cx - f.x;
  const dz = cz - f.z;
  const d = dhypot(dx, dz);
  if (d < 1e-6) return w.ahead;
  const cos = (dx * f.vx + dz * f.vz) / (d * speed);
  return cos >= 0.5 ? w.ahead : cos <= -0.5 ? w.behind : w.side;
}

export interface RankedUnit {
  key: ChunkKey;
  /** Distance of the unit centre from the look-ahead focus. */
  dist: number;
  weight: number;
  /** `dist x weight`; the order of the wanted list. */
  score: number;
  /** In the 3 x 3 around the focus chunk (or the player's chunk): requested before everything else. */
  first: boolean;
}

export interface RankOptions {
  /** Whether a unit exists in the bake (the index lists the tiles). */
  exists: (key: ChunkKey) => boolean;
  weights?: DirWeights;
  lookAheadS?: number;
  /** Put the 3 x 3 around the focus chunk (and the player's chunk) first. True for the finest level. */
  firstRing?: boolean;
}

const cmpRanked = (a: RankedUnit, b: RankedUnit): number => {
  if (a.first !== b.first) return a.first ? -1 : 1;
  if (a.score !== b.score) return a.score - b.score;
  return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
};

/**
 * The wanted units of one level, in request order. Candidates are the grid cells of level `z` whose box meets the disc of
 * radius `radiusM` around the look-ahead point of `focus`.
 */
export function rankUnits(z: ChunkZ, focus: Focus, radiusM: number, o: RankOptions): RankedUnit[] {
  const e = CHUNK_EDGE_M[z];
  const ahead = lookAheadPoint(focus, o.lookAheadS);
  const weights = o.weights ?? STREAMING.dirWeights;
  const ix0 = Math.floor((ahead.x - radiusM - GRID_MIN_M) / e);
  const ix1 = Math.floor((ahead.x + radiusM - GRID_MIN_M) / e);
  const iy0 = Math.floor((ahead.z - radiusM - GRID_MIN_M) / e);
  const iy1 = Math.floor((ahead.z + radiusM - GRID_MIN_M) / e);
  const fx = Math.floor((ahead.x - GRID_MIN_M) / e);
  const fy = Math.floor((ahead.z - GRID_MIN_M) / e);
  const px = Math.floor((focus.x - GRID_MIN_M) / e);
  const py = Math.floor((focus.z - GRID_MIN_M) / e);
  const out: RankedUnit[] = [];
  for (let iy = Math.max(0, iy0); iy <= iy1; iy++) {
    for (let ix = Math.max(0, ix0); ix <= ix1; ix++) {
      const key = `${z}/${ix}/${iy}` as ChunkKey;
      const b: ChunkBounds = { minX: GRID_MIN_M + ix * e, minZ: GRID_MIN_M + iy * e, maxX: GRID_MIN_M + (ix + 1) * e, maxZ: GRID_MIN_M + (iy + 1) * e };
      const near = o.firstRing === true && ((Math.abs(ix - fx) <= 1 && Math.abs(iy - fy) <= 1) || (ix === px && iy === py));
      if (!near && !discMeetsBox(ahead.x, ahead.z, radiusM, b)) continue;
      if (!o.exists(key)) continue;
      const cx = (b.minX + b.maxX) / 2;
      const cz = (b.minZ + b.maxZ) / 2;
      const dist = dhypot(cx - ahead.x, cz - ahead.z);
      const weight = dirWeight(focus, cx, cz, weights);
      out.push({ key, dist, weight, score: dist * weight, first: near });
    }
  }
  return out.sort(cmpRanked);
}

/** Whether `key` is still inside `factor` x `radiusM` of the look-ahead focus (the unload test). */
export function insideRing(key: ChunkKey, focus: Focus, radiusM: number, factor: number, lookAheadS?: number): boolean {
  const a = lookAheadPoint(focus, lookAheadS);
  return discMeetsBox(a.x, a.z, radiusM * factor, boundsOf(key));
}
