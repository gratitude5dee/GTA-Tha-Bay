/**
 * `corridor.bin` (M07a1, BD-M07a1-04): the ground under a route, for the headless determinism run. The format and its decoder are
 * `packages/modes/racing/src/qa/corridor.ts`; this file picks the chunks, grades them to the route and deflates.
 *
 * Grading (BD-M07a1-06): the bake's terrain has local dips and cuts next to the road (rail cuts, creek beds, bridge approaches)
 * that a 4 m height grid turns into 1 m walls; the real game covers them with decks and the ray-cast suspension rides over what
 * it can. The headless run is a proof of determinism, not of the terrain, so every post within 9 m of the centreline is set to
 * the road's own height and blended back to the terrain over the next 11 m. A bridge becomes a causeway.
 */
import { deflateRawSync } from 'node:zlib';
import { chunkKeyAt, type ChunkKey } from '../../../../packages/shared/src/index.ts';
import { encodeCorridorRaw, type CorridorChunk } from '../../../../packages/modes/racing/src/qa/corridor.ts';
import type { BakeGraph } from './snap.ts';

/** Metres of margin round the centreline: the chunks within this distance are in the corridor. */
export const CORRIDOR_MARGIN_M = 48;
export const FLAT_M = 9;
export const BLEND_M = 11;
const BUCKET_M = 16;

interface Sample { x: number; y: number; z: number }

export function corridorKeys(samples: readonly { x: number; z: number }[]): ChunkKey[] {
  const keys = new Set<ChunkKey>();
  const m = CORRIDOR_MARGIN_M;
  for (const p of samples) for (const dx of [-m, 0, m]) for (const dz of [-m, 0, m]) keys.add(chunkKeyAt(9, p.x + dx, p.z + dz));
  return [...keys].sort();
}

/** A spatial index of the centreline segments for the nearest-segment query. */
function segmentIndex(samples: readonly Sample[]): (x: number, z: number) => { d: number; y: number } | null {
  const buckets = new Map<string, number[]>();
  const key = (bx: number, bz: number): string => `${bx},${bz}`;
  for (let i = 0; i + 1 < samples.length; i++) {
    const a = samples[i] as Sample;
    const b = samples[i + 1] as Sample;
    const x0 = Math.floor(Math.min(a.x, b.x) / BUCKET_M);
    const x1 = Math.floor(Math.max(a.x, b.x) / BUCKET_M);
    const z0 = Math.floor(Math.min(a.z, b.z) / BUCKET_M);
    const z1 = Math.floor(Math.max(a.z, b.z) / BUCKET_M);
    for (let bx = x0; bx <= x1; bx++) for (let bz = z0; bz <= z1; bz++) (buckets.get(key(bx, bz)) ?? buckets.set(key(bx, bz), []).get(key(bx, bz))!).push(i);
  }
  return (x, z) => {
    const cx = Math.floor(x / BUCKET_M);
    const cz = Math.floor(z / BUCKET_M);
    let best = Infinity;
    let by = 0;
    for (let bx = cx - 2; bx <= cx + 2; bx++) {
      for (let bz = cz - 2; bz <= cz + 2; bz++) {
        for (const i of buckets.get(key(bx, bz)) ?? []) {
          const a = samples[i] as Sample;
          const b = samples[i + 1] as Sample;
          const dx = b.x - a.x;
          const dz = b.z - a.z;
          const l2 = dx * dx + dz * dz;
          const t = l2 > 0 ? Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / l2)) : 0;
          const ex = x - (a.x + dx * t);
          const ez = z - (a.z + dz * t);
          const d2 = ex * ex + ez * ez;
          if (d2 < best) {
            best = d2;
            by = a.y + (b.y - a.y) * t;
          }
        }
      }
    }
    return best === Infinity ? null : { d: Math.sqrt(best), y: by };
  };
}

/** Grades a chunk's height grid (decimetres) to the route; returns a new array. */
export function gradeChunk(dm: Int16Array, originX: number, originZ: number, cellM: number, near: ReturnType<typeof segmentIndex>): Int16Array {
  const out = new Int16Array(dm);
  for (let j = 0; j < 65; j++) {
    for (let i = 0; i < 65; i++) {
      const r = near(originX + i * cellM, originZ + j * cellM);
      if (!r || r.d > FLAT_M + BLEND_M) continue;
      const ground = (dm[j * 65 + i] as number) * 0.1;
      const k = r.d <= FLAT_M ? 0 : (r.d - FLAT_M) / BLEND_M;
      out[j * 65 + i] = Math.round((r.y * (1 - k) + ground * k) * 10);
    }
  }
  return out;
}

export function buildCorridor(bg: BakeGraph, samples: readonly Sample[]): Uint8Array {
  const keys = corridorKeys(samples);
  bg.ensureChunks(keys);
  const near = segmentIndex(samples);
  const chunks: CorridorChunk[] = [];
  for (const key of keys) {
    const h = bg.heights.get(key);
    if (!h) continue;
    chunks.push({
      key, originX: h.originX, originZ: h.originZ, cellM: h.cellM, dm: gradeChunk(h.dm, h.originX, h.originZ, h.cellM, near),
      decks: bg.decks.get(key) ?? new Float32Array(0),
    });
  }
  return deflateRawSync(encodeCorridorRaw({ bakeId: bg.bakeId, chunks }), { level: 9 });
}
