/**
 * Road triangles of the L0 chunks of a finished bake, with and without the street-markings geometry (M02h1, the ledger of
 * `tests/e2e/markings-ledger.spec.ts`). Run as `tsx tests/support/road-triangles.ts <packs dir> <tier> <chunk key>...`: it prints
 * `{"baseline": n, "after": m}` on one line. A separate process because the mesher reads JSON config by import, which the Playwright loader
 * does not accept; `tsx` does.
 */
import { readFileSync } from 'node:fs';
import { decodeP0, parseChunkKey, type ChunkKey, type QualityTierId, type SimChunk } from '../../packages/shared/src/index.ts';
import { meshChunk } from '../../packages/world/src/client/chunks/mesher.ts';

const [dir, tier, ...keys] = process.argv.slice(2) as [string, QualityTierId, ...ChunkKey[]];
const tiles = new Map<string, SimChunk[]>();
const tris = (markings: boolean): number => {
  let n = 0;
  for (const key of keys) {
    const p = parseChunkKey(key) as { x: number; y: number };
    const name = `${p.x >> 2}-${p.y >> 2}`;
    let sims = tiles.get(name);
    if (!sims) {
      sims = decodeP0(new Uint8Array(readFileSync(`${dir}/p0-${name}.pack`)));
      tiles.set(name, sims);
    }
    const sim = sims.find((s) => s.key === key);
    if (!sim) continue;
    const m = meshChunk(sim, null, { tier, distM: 0, tile: sims, markings });
    n += (m.objects.find((o) => o.kind === 'roads')?.indices.length ?? 0) / 3;
  }
  return n;
};
process.stdout.write(`${JSON.stringify({ baseline: tris(false), after: tris(true) })}\n`);
