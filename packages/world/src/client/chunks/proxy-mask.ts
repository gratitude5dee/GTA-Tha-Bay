/**
 * Proxy masks (M02d1; C08 rule 12). A baked landmark leaves a few extrusions in the chunk meshes as its proxy: footprints whose
 * `BuildingRecord.proxyOf` is the landmark's index + 1. While the landmark's glTF is resident, the chunks that hold such
 * footprints are meshed again with those proxies left out (`meshChunk` option `maskProxies`); beyond the swap distance, or when
 * the model fails to load, they are meshed back. These pure helpers decide which chunks need which mask. No `three`: the same
 * code runs in the unit tests, the layer and the worker.
 */
import type { ChunkKey } from '@dv/shared';

/** The `proxyOf` value of the landmark at `index` of the world index. */
export const proxyIdOf = (landmarkIndex: number): number => landmarkIndex + 1;

/** What a resident L0 chunk reports: the proxies in it and the ones its current mesh leaves out. */
export interface ChunkProxyState {
  key: ChunkKey;
  proxies: readonly number[];
  masked: readonly number[];
}

/** The mask a chunk should carry while the landmarks in `shown` (proxy ids) are resident: sorted, only ids the chunk holds. */
export function desiredMask(proxies: readonly number[], shown: ReadonlySet<number>): number[] {
  return proxies.filter((p) => shown.has(p)).sort((a, b) => a - b);
}

export function sameMask(a: readonly number[], b: readonly number[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

export interface MaskChange {
  key: ChunkKey;
  /** The mask the new mesh must apply (empty: the proxies are meshed back). */
  mask: number[];
}

/** The chunks whose current mesh disagrees with the mask they should carry now. Sorted by key. */
export function staleChunks(chunks: readonly ChunkProxyState[], shown: ReadonlySet<number>): MaskChange[] {
  const out: MaskChange[] = [];
  for (const c of chunks) {
    if (c.proxies.length === 0) continue;
    const want = desiredMask(c.proxies, shown);
    if (!sameMask(want, [...c.masked].sort((a, b) => a - b))) out.push({ key: c.key, mask: want });
  }
  return out.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}

/** The resident chunks that hold a proxy of the landmark `proxyId`. */
export function chunksHolding(chunks: readonly ChunkProxyState[], proxyId: number): ChunkKey[] {
  return chunks.filter((c) => c.proxies.includes(proxyId)).map((c) => c.key);
}
