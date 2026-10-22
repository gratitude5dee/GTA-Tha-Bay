/**
 * `corridor.bin` (M07a1, BD-M07a1-04): the height grids of the chunks a route crosses, for the headless determinism run.
 * The format and its decoder are `packages/modes/racing/src/qa/corridor.ts`; this file picks the chunks and deflates.
 */
import { deflateRawSync } from 'node:zlib';
import { chunkKeyAt, type ChunkKey } from '../../../../packages/shared/src/index.ts';
import { encodeCorridorRaw, type CorridorChunk } from '../../../../packages/modes/racing/src/qa/corridor.ts';
import type { BakeGraph } from './snap.ts';

/** Metres of margin round the centreline: the chunks within this distance are in the corridor. */
export const CORRIDOR_MARGIN_M = 48;

export function corridorKeys(samples: readonly { x: number; z: number }[]): ChunkKey[] {
  const keys = new Set<ChunkKey>();
  const m = CORRIDOR_MARGIN_M;
  for (const p of samples) for (const dx of [-m, 0, m]) for (const dz of [-m, 0, m]) keys.add(chunkKeyAt(9, p.x + dx, p.z + dz));
  return [...keys].sort();
}

export function buildCorridor(bg: BakeGraph, samples: readonly { x: number; z: number }[]): Uint8Array {
  const keys = corridorKeys(samples);
  bg.ensureChunks(keys);
  const chunks: CorridorChunk[] = [];
  for (const key of keys) {
    const h = bg.heights.get(key);
    if (!h) continue;
    chunks.push({ key, originX: h.originX, originZ: h.originZ, cellM: h.cellM, dm: h.dm });
  }
  return deflateRawSync(encodeCorridorRaw({ bakeId: bg.bakeId, chunks }), { level: 9 });
}
